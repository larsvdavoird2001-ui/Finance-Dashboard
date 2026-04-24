import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx-js-style'
import {
  PL_STRUCTURE,
  ytdActuals2025, ytdBudget2025,
} from '../../data/plData'
import { monthlyActuals2025, monthlyBudget2025, MONTHS_2025_LABELS } from '../../data/plData2025'
import type { EntityName } from '../../data/plData'
import { fmt } from '../../lib/format'
import type { BvId, GlobalFilter } from '../../data/types'
import { useAdjustedActuals } from '../../hooks/useAdjustedActuals'
import { useFteStore } from '../../store/useFteStore'
import { useNavStore } from '../../store/useNavStore'
import { useBudgetStore } from '../../store/useBudgetStore'
import { derivePL, READONLY_KEYS as PL_DERIVED_KEYS } from '../../lib/plDerive'

type ColType = 'actual' | 'budget' | 'delta'

interface Period { id: string; label: string; year: '2025' | '2026'; month?: string; ytdMonths?: string[] }

const PERIODS_2026: Period[] = [
  { id: 'jan26', label: 'Jan-26', year: '2026', month: 'Jan-26' },
  { id: 'feb26', label: 'Feb-26', year: '2026', month: 'Feb-26' },
  { id: 'mar26', label: 'Mar-26', year: '2026', month: 'Mar-26' },
  { id: 'ytd26', label: 'YTD 2026', year: '2026', ytdMonths: ['Jan-26', 'Feb-26', 'Mar-26'] },
]

const PERIODS_2025: Period[] = [
  ...MONTHS_2025_LABELS.map(m => ({ id: m.toLowerCase().replace('-', ''), label: m, year: '2025' as const, month: m })),
  { id: 'ytd25', label: 'YTD 2025', year: '2025', ytdMonths: MONTHS_2025_LABELS },
]

const ALL_ENTITIES: EntityName[] = ['Consultancy', 'Projects', 'Software', 'Holdings']

const COL_LABELS: Record<ColType, string> = { actual: 'Actuals', budget: 'Budget', delta: 'Δ' }
const COL_COLORS: Record<ColType, string> = { actual: 'var(--t1)', budget: 'var(--t3)', delta: 'var(--t2)' }

function pctStr(key: string, data: Record<string, number>): string {
  const nom = data['netto_omzet'] ?? 0
  if (nom === 0) return '—'
  const val = key === 'brutomarge_pct' ? (data['brutomarge'] ?? 0) : (data['ebitda'] ?? 0)
  return (val / nom * 100).toFixed(1) + '%'
}

function deltaColor(d: number, _key: string): string {
  // Costs zijn in plData met negatief teken opgeslagen (bv. directe_kosten: -739500).
  // Daardoor geldt voor zowel omzet- als kostenregels: d = a − b > 0 betekent
  // dat actual gunstiger is dan budget (meer omzet OF minder negatieve kosten).
  // Geen aparte inversie nodig.
  if (d === 0) return 'var(--t3)'
  return d > 0 ? 'var(--green)' : 'var(--red)'
}

interface Props {
  filter: GlobalFilter
  onFilterChange?: (patch: Partial<GlobalFilter>) => void
}

export function BudgetTab({ filter, onFilterChange }: Props) {
  const periods: Period[] = filter.year === '2025' ? PERIODS_2025 : PERIODS_2026
  const defaultPeriod = filter.year === '2025' ? 'ytd25' : 'ytd26'

  const [period,    setPeriod]    = useState<string>(defaultPeriod)
  const [colTypes,  setColTypes]  = useState<Set<ColType>>(new Set(['actual', 'budget', 'delta']))

  const { getMonthly, getYtd } = useAdjustedActuals()
  // Subscribe naar budget-overrides zodat edits in Budgetten-tab live
  // doorwerken in Budget vs Actuals. getBudgetMonth merged source + overrides.
  const getBudgetMonth = useBudgetStore(s => s.getMonth)
  // Zorg dat we re-renderen als overrides veranderen (selector op `overrides`
  // zelf — anders zou Zustand alleen herrenderen bij referentie-verschil van de
  // functie, die stabiel is).
  useBudgetStore(s => s.overrides)

  // When year changes, jump to that year's YTD period (prevents mismatch: 2026 periods shown while 2025 selected)
  useEffect(() => {
    setPeriod(filter.year === '2025' ? 'ytd25' : 'ytd26')
  }, [filter.year])

  // Holdings zit alleen in de totalen / analyse wanneer geen specifieke BV
  // is geselecteerd. Bij een BV-filter toon je ALLEEN die BV — Holdings
  // vervuilt anders de driver-analyse (grote amortisatie-post etc.).
  const visibleEntities: EntityName[] = filter.bv === 'all'
    ? ALL_ENTITIES
    : [filter.bv as EntityName].filter(e => ALL_ENTITIES.includes(e as EntityName)) as EntityName[]

  const currentPeriod = periods.find(p => p.id === period) ?? periods[periods.length - 1]

  const getActuals = (p: Period, e: EntityName): Record<string, number> => {
    if (p.year === '2025') {
      if (p.month) return monthlyActuals2025[e]?.[p.month] ?? {}
      return ytdActuals2025[e] ?? {}
    }
    // 2026: via useAdjustedActuals — die pakt voor alle 4 entities (inclusief
    // Holdings) base plData + live kosten-overrides/breakdowns uit MaandTab.
    if (p.month) return getMonthly(e, p.month)
    return getYtd(e, p.ytdMonths ?? [])
  }

  // Keys waarvoor we via derivePL aggregeren/afleiden. Ook alle items uit
  // PL_STRUCTURE (inclusief sub-regels) worden geïnlude zodat het return
  // object per maand alle regels dekt die de Budget vs Actuals tabel rendert.
  const allPlKeys = Array.from(new Set([
    ...PL_STRUCTURE.filter(i => !i.isSeparator && !i.isPercentage).map(i => i.key),
    ...PL_DERIVED_KEYS,
  ]))

  // Bepaal alle budget-waardes voor één (entity, maand). Aggregaten worden
  // altijd uit subs afgeleid (stale opgeslagen aggregate-overrides worden
  // genegeerd) zodat Budget vs Actuals exact dezelfde cijfers toont als de
  // Budgetten-tab.
  const budgetMap2026 = (e: EntityName, m: string): Record<string, number> => {
    const raw = getBudgetMonth(e, m)
    const lookup = (k: string) => raw[k] ?? 0
    const out: Record<string, number> = {}
    for (const k of allPlKeys) out[k] = derivePL(lookup, k)
    return out
  }

  const getBudget = (p: Period, e: EntityName): Record<string, number> => {
    if (p.year === '2025') {
      if (p.month) return monthlyBudget2025[e]?.[p.month] ?? {}
      return ytdBudget2025[e] ?? {}
    }
    // 2026: haal budget via de store (source + user overrides) met derivatie.
    // Sub-edits in de Budgetten-tab werken direct door, oude/stale aggregate-
    // overrides worden genegeerd ten gunste van som-van-subs.
    if (p.month) return budgetMap2026(e, p.month)
    // YTD: som per plKey over alle YTD-maanden met store-merged derived values.
    const months = p.ytdMonths ?? []
    const sum: Record<string, number> = {}
    for (const m of months) {
      const md = budgetMap2026(e, m)
      for (const k of Object.keys(md)) {
        sum[k] = (sum[k] ?? 0) + (md[k] ?? 0)
      }
    }
    return sum
  }

  const allActuals: Record<EntityName, Record<string, number>> = Object.fromEntries(
    visibleEntities.map(e => [e, getActuals(currentPeriod, e)])
  ) as Record<EntityName, Record<string, number>>

  const allBudgets: Record<EntityName, Record<string, number>> = Object.fromEntries(
    visibleEntities.map(e => [e, getBudget(currentPeriod, e)])
  ) as Record<EntityName, Record<string, number>>

  const totalActuals: Record<string, number> = {}
  const totalBudget:  Record<string, number> = {}
  for (const e of visibleEntities) {
    for (const k of Object.keys(allActuals[e])) {
      totalActuals[k] = (totalActuals[k] ?? 0) + (allActuals[e][k] ?? 0)
    }
    for (const k of Object.keys(allBudgets[e])) {
      totalBudget[k] = (totalBudget[k] ?? 0) + (allBudgets[e][k] ?? 0)
    }
  }

  const periodLabel = currentPeriod.label
  const activeCols  = (['actual', 'budget', 'delta'] as ColType[]).filter(c => colTypes.has(c))
  const toggleCol   = (c: ColType) => setColTypes(prev => {
    const next = new Set(prev)
    if (next.has(c) && next.size === 1) return prev // keep at least one
    next.has(c) ? next.delete(c) : next.add(c)
    return next
  })

  // Column groups: per visible entity + total
  const entityGroups = [...visibleEntities, 'Totaal' as const]

  // ── Excel export met opmaak + filter-info header ─────────────────────────
  const exportExcel = () => {
    // Kleuren in TPG huisstijl
    const BRAND_CYAN   = '00A9E0'
    const HEADER_BG    = '0B1224'  // donker voor kolomheaders
    const HEADER_TXT   = 'FFFFFF'
    const SUB_BG       = 'E8F4FA'  // lichtblauw voor aggregaten (bold rows)
    const INFO_BG      = 'F4F7FB'  // lichtgrijs voor info-blok
    const DELTA_POS    = '1E7A3E'  // groen
    const DELTA_NEG    = 'B4281E'  // rood
    const BORDER_COLOR = 'C7D0DB'

    const border = { style: 'thin', color: { rgb: BORDER_COLOR } } as const
    const allBorders = { top: border, bottom: border, left: border, right: border }
    const fontBase = { name: 'Calibri', sz: 10 }

    const nowStr = new Date().toLocaleString('nl-NL', {
      day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
    const bvLabel   = filter.bv === 'all' ? 'Alle BVs' : filter.bv
    const colsLabel = activeCols.map(c => COL_LABELS[c]).join(', ')

    // ── Info-header bovenaan ───────────────────────────────────────────
    const totalCols = 1 + entityGroups.length * activeCols.length
    const rows: unknown[][] = []
    const merges: XLSX.Range[] = []
    const cellStyles: Record<string, XLSX.CellStyle> = {}

    // Rij 0: titel
    rows.push(['Budget vs Actuals — TPG Finance'])
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } })
    cellStyles['A1'] = {
      font: { ...fontBase, sz: 16, bold: true, color: { rgb: BRAND_CYAN } },
      alignment: { horizontal: 'left', vertical: 'center' },
    }

    // Rij 1: Filter-samenvatting (periode | BV | kolommen | export-datum)
    const filterLine = `Periode: ${periodLabel}   ·   BV-filter: ${bvLabel}   ·   Kolommen: ${colsLabel}   ·   Geëxporteerd: ${nowStr}`
    rows.push([filterLine])
    merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } })
    cellStyles['A2'] = {
      font: { ...fontBase, sz: 10, italic: true, color: { rgb: '52657E' } },
      alignment: { horizontal: 'left' },
      fill: { patternType: 'solid', fgColor: { rgb: INFO_BG } },
    }

    // Rij 2: lege scheidingsrij
    rows.push([''])

    // Rij 3: Entity-header (span over activeCols). Eerste cel leeg.
    const entityHdrRowIdx = rows.length
    const entityHdrRow: (string | number)[] = ['']
    for (const eg of entityGroups) {
      for (let i = 0; i < activeCols.length; i++) {
        entityHdrRow.push(i === 0 ? eg : '')
      }
    }
    rows.push(entityHdrRow)
    // Merge per entity-group over z'n activeCols kolommen
    let col = 1
    for (const eg of entityGroups) {
      if (activeCols.length > 1) {
        merges.push({ s: { r: entityHdrRowIdx, c: col }, e: { r: entityHdrRowIdx, c: col + activeCols.length - 1 } })
      }
      // Style voor elke cel in deze groep (merged of niet)
      for (let i = 0; i < activeCols.length; i++) {
        const addr = XLSX.utils.encode_cell({ r: entityHdrRowIdx, c: col + i })
        cellStyles[addr] = {
          font: { ...fontBase, bold: true, sz: 11, color: { rgb: HEADER_TXT } },
          alignment: { horizontal: 'center', vertical: 'center' },
          fill: { patternType: 'solid', fgColor: { rgb: eg === 'Totaal' ? BRAND_CYAN : HEADER_BG } },
          border: allBorders,
        }
      }
      col += activeCols.length
    }
    // Ook de eerste cel (label kolom) in deze rij stylen
    cellStyles[XLSX.utils.encode_cell({ r: entityHdrRowIdx, c: 0 })] = {
      fill: { patternType: 'solid', fgColor: { rgb: HEADER_BG } },
      border: allBorders,
    }

    // Rij 4: Sub-header (kolomtype labels: Actuals / Budget / Δ)
    const subHdrRowIdx = rows.length
    const subHdrRow: string[] = [`${periodLabel} — Regel`]
    for (const eg of entityGroups) {
      void eg
      for (const ct of activeCols) subHdrRow.push(COL_LABELS[ct])
    }
    rows.push(subHdrRow)
    for (let c = 0; c < totalCols; c++) {
      const addr = XLSX.utils.encode_cell({ r: subHdrRowIdx, c })
      cellStyles[addr] = {
        font: { ...fontBase, bold: true, sz: 10, color: { rgb: HEADER_TXT } },
        alignment: { horizontal: c === 0 ? 'left' : 'right', vertical: 'center' },
        fill: { patternType: 'solid', fgColor: { rgb: HEADER_BG } },
        border: allBorders,
      }
    }

    // ── Data rows ──────────────────────────────────────────────────────
    for (const item of PL_STRUCTURE) {
      if (item.isSeparator) continue
      const rowIdx = rows.length
      const label = '  '.repeat(item.indent ?? 0) + item.label
      const row: (string | number)[] = [label]

      if (item.isPercentage) {
        for (const eg of entityGroups) {
          const a = eg === 'Totaal' ? totalActuals : allActuals[eg as EntityName]
          const b = eg === 'Totaal' ? totalBudget  : allBudgets[eg as EntityName]
          for (const ct of activeCols) {
            const d = ct === 'budget' ? b : a
            row.push(pctStr(item.key, d))
          }
        }
      } else {
        for (const eg of entityGroups) {
          const a = eg === 'Totaal' ? (totalActuals[item.key] ?? 0) : (allActuals[eg as EntityName]?.[item.key] ?? 0)
          const b = eg === 'Totaal' ? (totalBudget[item.key]  ?? 0) : (allBudgets[eg as EntityName]?.[item.key] ?? 0)
          for (const ct of activeCols) {
            if (ct === 'actual') row.push(a)
            else if (ct === 'budget') row.push(b)
            else row.push(a - b)
          }
        }
      }
      rows.push(row)

      // Style voor deze rij
      const isBold = item.isBold ?? false
      const isPct  = item.isPercentage ?? false
      const rowBg = isBold ? SUB_BG : undefined

      // Label-cel (inspring via leading spaces in label-string)
      cellStyles[XLSX.utils.encode_cell({ r: rowIdx, c: 0 })] = {
        font: { ...fontBase, bold: isBold, italic: isPct, sz: 10 },
        alignment: { horizontal: 'left', vertical: 'center' },
        fill: rowBg ? { patternType: 'solid', fgColor: { rgb: rowBg } } : undefined,
        border: allBorders,
      }

      // Data-cellen
      let cIdx = 1
      for (const eg of entityGroups) {
        for (const ct of activeCols) {
          const addr = XLSX.utils.encode_cell({ r: rowIdx, c: cIdx })
          const val = row[cIdx]
          let fontColor: { rgb: string } | undefined
          if (ct === 'delta' && typeof val === 'number') {
            if (val > 0) fontColor = { rgb: DELTA_POS }
            else if (val < 0) fontColor = { rgb: DELTA_NEG }
          } else if (eg === 'Totaal' && typeof val === 'number' && val !== 0) {
            fontColor = { rgb: BRAND_CYAN }
          }
          cellStyles[addr] = {
            font: { ...fontBase, bold: isBold || eg === 'Totaal', italic: isPct, sz: 10, color: fontColor },
            alignment: { horizontal: 'right', vertical: 'center' },
            numFmt: isPct ? undefined : '#,##0;-#,##0;"—"',
            fill: rowBg ? { patternType: 'solid', fgColor: { rgb: rowBg } } : undefined,
            border: allBorders,
          }
          cIdx++
        }
      }
    }

    // ── Sheet opbouwen ────────────────────────────────────────────────
    const ws = XLSX.utils.aoa_to_sheet(rows)

    // Merges
    ws['!merges'] = merges

    // Cell styles toepassen
    for (const [addr, style] of Object.entries(cellStyles)) {
      if (ws[addr]) ws[addr].s = style
      else ws[addr] = { t: 's', v: '', s: style }
    }

    // Kolom-breedtes (eerste breed, rest evenredig)
    ws['!cols'] = Array.from({ length: totalCols }, (_, i) => ({
      wch: i === 0 ? 34 : 14,
    }))

    // Rij-hoogtes (titel iets hoger, headers iets hoger)
    ws['!rows'] = []
    ws['!rows'][0] = { hpx: 28 }   // titel
    ws['!rows'][1] = { hpx: 20 }   // filters
    ws['!rows'][entityHdrRowIdx] = { hpx: 22 }
    ws['!rows'][subHdrRowIdx] = { hpx: 20 }

    // Freeze panes: label-kolom en headers
    ws['!freeze'] = { xSplit: 1, ySplit: subHdrRowIdx + 1 }

    // Page setup: landscape, fit to page width
    ws['!pageSetup'] = { orientation: 'landscape', fitToPage: true }

    const bvSuffix = filter.bv === 'all' ? 'alle-BVs' : filter.bv
    const fileName = `Budget-vs-Actuals_${periodLabel.replace(/\s+/g, '-')}_${bvSuffix}.xlsx`

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Budget vs Actuals')
    XLSX.writeFile(wb, fileName)
  }

  const renderCell = (key: string, a: number, b: number, ct: ColType, bold: boolean) => {
    if (ct === 'actual') {
      return <span style={{ fontWeight: bold ? 700 : 400 }}>{fmt(a)}</span>
    }
    if (ct === 'budget') {
      return <span style={{ color: 'var(--t3)', fontWeight: bold ? 600 : 400 }}>{fmt(b)}</span>
    }
    const d = a - b
    if (d === 0) return <span style={{ color: 'var(--t3)' }}>—</span>
    return (
      <span style={{ color: deltaColor(d, key), fontWeight: bold ? 700 : 400 }}>
        {d > 0 ? '+' : ''}{fmt(d)}
      </span>
    )
  }

  // ── Variance analyse: auto-gegenereerde redenen + koppelingen ──────────
  // Bereken per component (netto_omzet, directe_kosten, operationele_kosten,
  // amortisatie, ebitda, ebit) het verschil tov budget, sorteer op impact,
  // en geef per driver een hypothese over de oorzaak (met FTE-link waar
  // relevant).
  const fteEntries = useFteStore(s => s.entries)
  const navigateTo = useNavStore(s => s.navigateTo)

  const deltaOf = (key: string) => (totalActuals[key] ?? 0) - (totalBudget[key] ?? 0)
  const varianceDrivers = [
    {
      key: 'netto_omzet',
      label: 'Netto-omzet',
      delta: deltaOf('netto_omzet'),
      isCost: false,
    },
    {
      key: 'directe_kosten',
      label: 'Directe kosten',
      delta: deltaOf('directe_kosten'),
      isCost: true,
    },
    {
      key: 'operationele_kosten',
      label: 'Operationele kosten',
      delta: deltaOf('operationele_kosten'),
      isCost: true,
    },
    {
      key: 'amortisatie_afschrijvingen',
      label: 'Amortisatie & afschrijvingen',
      delta: deltaOf('amortisatie_afschrijvingen'),
      isCost: true,
    },
  ]
  // "Gunstig" = actuals beter dan budget. Omdat kosten als NEGATIEVE waarden
  // in plData staan (bv. directe_kosten: -739.500), geldt voor alle regels
  // dezelfde regel: delta > 0 → gunstig (meer omzet of minder negatieve kosten).
  const isFavourable = (delta: number) => delta > 0
  const deltaEbitda = deltaOf('ebitda')
  const deltaEbit   = deltaOf('ebit')
  const deltaBrut   = deltaOf('brutomarge')

  // EBITDA-impact = delta van de component zelf (linear combi: ebitda = omzet +
  // directe_kosten + operationele_kosten, allemaal met hun eigen teken).
  // Geen sign-flip meer voor kosten — die waren al negatief opgeslagen.
  const driversWithImpact = varianceDrivers
    .map(d => ({ ...d, ebitdaImpact: d.delta }))
    .sort((a, b) => Math.abs(b.ebitdaImpact) - Math.abs(a.ebitdaImpact))

  // FTE: check of er een relevante FTE-afwijking is per BV over de periode
  // van currentPeriod. Als currentPeriod.month → één maand, anders gemiddeld
  // over ytdMonths.
  const fteMonthsForPeriod = currentPeriod.month
    ? [currentPeriod.month]
    : (currentPeriod.ytdMonths ?? [])
  const fteDelta = (() => {
    const bvs: BvId[] = visibleEntities.filter(e => e !== 'Holdings') as BvId[]
    let sumActual = 0
    let sumBudget = 0
    let anyData = false
    for (const bv of bvs) {
      for (const m of fteMonthsForPeriod) {
        const e = fteEntries.find(f => f.bv === bv && f.month === m)
        if (!e) continue
        if (e.fte != null) { sumActual += e.fte; anyData = true }
        if (e.fteBudget != null) sumBudget += e.fteBudget
      }
    }
    if (!anyData) return null
    return { actual: sumActual, budget: sumBudget, delta: sumActual - sumBudget }
  })()

  // ── Calendar-closed detectie ───────────────────────────────────
  // Een maand geldt als closed zodra de kalender voorbij is (bv. op 24 apr
  // zijn Jan/Feb/Mar-26 gesloten). Voor closed periodes is 0 een legitieme
  // waarde — dan geen "nog niet ingevuld" melding tonen.
  const MONTH_IDX: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  }
  const now = new Date()
  const nowY = now.getFullYear()
  const nowM = now.getMonth()
  const isCalendarClosedMonth = (label: string): boolean => {
    const [mmm, yy] = label.split('-')
    const y = 2000 + Number(yy)
    const m = MONTH_IDX[mmm] ?? 0
    if (y < nowY) return true
    if (y > nowY) return false
    return m < nowM
  }
  const periodIsClosed = currentPeriod.month
    ? isCalendarClosedMonth(currentPeriod.month)
    : (currentPeriod.ytdMonths ?? []).every(isCalendarClosedMonth)

  // ── Missing-data detectie per component ────────────────────────
  // Bepaal per P&L-key of de actuals en/of budget daadwerkelijk gevuld zijn
  // voor de GESELECTEERDE visibleEntities (dus niet alle BV's). Zo voorkomen
  // we misleidende interpretaties op basis van 0-waarden die eigenlijk
  // 'niet ingevuld' betekenen.
  const anyEntityHas = (key: string, src: Record<EntityName, Record<string, number>>) =>
    visibleEntities.some(e => {
      const v = src[e]?.[key]
      return v != null && v !== 0
    })

  // Als de kern-actuals voor deze periode meaningful zijn (omzet of brutomarge
  // non-zero), dan is de closing effectief gedaan en is 0 op een sub-regel
  // een echte 0 — niet een gap.
  const periodHasMeaningfulActuals =
    anyEntityHas('netto_omzet', allActuals) ||
    anyEntityHas('brutomarge',  allActuals) ||
    anyEntityHas('ebitda',      allActuals)

  // Percentage delta: delta / |budget| × 100 — alleen zinvol als budget != 0
  const pctOf = (delta: number, base: number): string => {
    if (base === 0) return ''
    const p = delta / Math.abs(base) * 100
    return `${p > 0 ? '+' : ''}${p.toFixed(1)}%`
  }

  // ── Omzet/kosten-koppeling: volume- vs efficiency-effect ────────
  // Bij lagere omzet zouden directe kosten proportioneel mee moeten dalen
  // (variabele component). We splitsen volume-effect (kosten volgen omzet)
  // en efficiency/mix-effect (afwijking van de ratio).
  const omzetActual = totalActuals['netto_omzet']    ?? 0
  const omzetBudget = totalBudget['netto_omzet']     ?? 0
  const omzetPct    = omzetBudget !== 0 ? omzetActual / omzetBudget : 1
  const dirKostenActual = totalActuals['directe_kosten'] ?? 0
  const dirKostenBudget = totalBudget['directe_kosten']  ?? 0
  // Verwachte directe_kosten bij proportioneel meeschalen met omzet:
  const dirKostenExpected = dirKostenBudget * omzetPct
  // Efficiency-delta: extra/minder kosten bovenop het volume-effect. >0 =
  // gunstiger dan op omzet-geschaalde verwachting, <0 = ongunstiger.
  const dirKostenEffDelta = dirKostenActual - dirKostenExpected

  // Brutomarge-% actuals vs budget (percentage-points, niet euro's).
  // Costs zijn negatief dus brutomarge = rev + directe_kosten.
  const gm = (rev: number, dc: number) => rev !== 0 ? ((rev + dc) / rev * 100) : NaN
  const gmActual = gm(omzetActual, dirKostenActual)
  const gmBudget = gm(omzetBudget, dirKostenBudget)
  const gmDelta  = (isFinite(gmActual) && isFinite(gmBudget)) ? gmActual - gmBudget : NaN

  // Bepaal hoofdboodschap + hypothese-lijst. Rekening houdend met
  // ontbrekende data: als actuals OF budget voor een component niet
  // gevuld is, geven we GEEN conclusie maar een status-melding — maar
  // alleen voor open, niet-afgesloten periodes.
  const reasonFor = (d: typeof driversWithImpact[number]): string => {
    const actualsZero = !anyEntityHas(d.key, allActuals)
    const budgetZero  = !anyEntityHas(d.key, allBudgets)
    const canFlagMissing = !periodIsClosed && !periodHasMeaningfulActuals

    if (canFlagMissing) {
      if (actualsZero && budgetZero) {
        return 'Nog geen actuals én geen budget voor deze component — geen variance-analyse mogelijk.'
      }
      if (budgetZero) {
        return `Actuals gevuld (${fmt(totalActuals[d.key] ?? 0)}), maar budget is nog niet ingevuld. Ga naar Budgetten om sturing mogelijk te maken.`
      }
      if (actualsZero) {
        return `Budget staat op ${fmt(totalBudget[d.key] ?? 0)}, maar actuals zijn nog niet geboekt. Wacht tot closing afgerond is voor een betrouwbare analyse.`
      }
    }
    // Budget volledig afwezig terwijl actuals er wel zijn → geen basis voor variance.
    if (budgetZero && !actualsZero) {
      return 'Budget voor deze component is 0 — geen vergelijkingsbasis. Leg een target vast in Budgetten.'
    }

    const fav   = isFavourable(d.delta)
    const pct   = pctOf(d.delta, totalBudget[d.key] ?? 0)
    const pctTxt = pct ? ` (${pct} vs budget)` : ''

    if (d.key === 'netto_omzet') {
      if (fav) {
        return `Meer omzet gerealiseerd dan begroot${pctTxt} — sterkere vraag, hogere bezetting of gunstigere mix/tarieven.`
      }
      if (fteDelta && fteDelta.delta < -0.5) {
        return `Minder omzet dan begroot${pctTxt} — loopt samen met onderbezetting (Δ FTE ${fteDelta.delta.toFixed(1)}). Lagere declarabele capaciteit is een plausibele hoofdoorzaak.`
      }
      return `Minder omzet dan begroot${pctTxt} — check bezetting, uitgestelde projecten of prijsdruk. Controleer OHW-mutaties voor timing-effecten.`
    }

    if (d.key === 'directe_kosten') {
      // Efficiency-correctie: hebben de kosten zich bovenop het volume-effect bewogen?
      const effMeaningful = Math.abs(dirKostenEffDelta) > Math.abs(dirKostenBudget || 1) * 0.01
      if (fav) {
        if (effMeaningful && dirKostenEffDelta > 0) {
          return `Lagere directe kosten${pctTxt} — ook gecorrigeerd voor omzet-volume ${fmt(dirKostenEffDelta)} efficiency-winst: goedkopere inkoop of minder inhuur.`
        }
        if (omzetPct < 0.98 && omzetActual !== 0) {
          return `Lagere directe kosten${pctTxt} — grotendeels volume-effect (omzet ${((omzetPct - 1) * 100).toFixed(1)}% vs budget). Weinig structurele efficiency-winst.`
        }
        return `Lagere directe kosten${pctTxt} — efficiëntere inzet, gunstigere inkoop of minder onderaanneming.`
      }
      if (effMeaningful && dirKostenEffDelta < 0) {
        return `Hogere directe kosten${pctTxt} — ook na correctie voor omzet-volume (${fmt(dirKostenEffDelta)} extra) duidt dit op inkoopinflatie of meer inhuur.`
      }
      if (omzetPct > 1.02) {
        return `Hogere directe kosten${pctTxt} — grotendeels volume-effect (omzet +${((omzetPct - 1) * 100).toFixed(1)}% vs budget). Kostenratio lijkt onder controle.`
      }
      return `Hogere directe kosten${pctTxt} — onderzoek inkoopinflatie, overwerk of extra inhuur.`
    }

    if (d.key === 'operationele_kosten') {
      const fteTxt = fteDelta ? `(Δ FTE ${fteDelta.delta >= 0 ? '+' : ''}${fteDelta.delta.toFixed(1)})` : ''
      if (fav) {
        if (fteDelta && fteDelta.delta < -0.5) {
          return `Lagere OPEX${pctTxt} — loopt samen met onderbezetting ${fteTxt}. Groot deel van de besparing is toe te schrijven aan indirecte personeelskosten.`
        }
        if (fteDelta && fteDelta.delta > 0.5) {
          return `Lagere OPEX${pctTxt} ondanks overbezetting ${fteTxt} — echte operationele efficiëntiewinst (huur/ICT/marketing onder budget).`
        }
        return `Lagere OPEX${pctTxt} — efficiëntiewinst of uitgestelde uitgaven (marketing, ICT, training).`
      }
      if (fteDelta && fteDelta.delta > 0.5) {
        return `Hogere OPEX${pctTxt} — mede verklaard door overbezetting ${fteTxt}. Toename deels personeelsgerelateerd.`
      }
      if (fteDelta && fteDelta.delta < -0.5) {
        return `Hogere OPEX${pctTxt} ondanks onderbezetting ${fteTxt} — wijst op niet-personele lastenverhoging (ICT, marketing, huur, accruals).`
      }
      return `Hogere OPEX${pctTxt} — onderzoek inflatie, marketing-pieken, ICT-contracten of algemene kosten.`
    }

    if (d.key === 'amortisatie_afschrijvingen') {
      if (fav) {
        return `Lagere afschrijvingen${pctTxt} — uitgestelde investeringen of langere afschrijvingstermijn. Let op: timing-effect, geen structurele winst.`
      }
      return `Hogere afschrijvingen${pctTxt} — extra capex geactiveerd of kortere afschrijvingstermijn dan begroot.`
    }
    return ''
  }

  return (
    <div className="page">
      {/* ── Filters toolbar — alles op één plek bovenaan ─────────── */}
      <div className="card" style={{ overflow: 'visible' }}>
        <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Filters:</span>

          {/* Jaar (gesynchroniseerd met globale topbar-filter) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--t3)' }}>Jaar</span>
            <div className="tabs-row">
              {(['2025', '2026'] as const).map(y => (
                <button
                  key={y}
                  className={`tab${filter.year === y ? ' active' : ''}`}
                  onClick={() => onFilterChange?.({ year: y })}
                >{y}</button>
              ))}
            </div>
          </div>

          {/* BV (gesynchroniseerd met globale topbar-filter) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--t3)' }}>BV</span>
            <div style={{ display: 'flex', gap: 3, background: 'var(--bg3)', padding: 2, borderRadius: 5 }}>
              {(['all', 'Consultancy', 'Projects', 'Software'] as const).map(b => (
                <button
                  key={b}
                  onClick={() => onFilterChange?.({ bv: b })}
                  style={{
                    padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: filter.bv === b ? 700 : 500,
                    background: filter.bv === b ? 'var(--bg1)' : 'transparent',
                    color: filter.bv === b ? 'var(--t1)' : 'var(--t3)',
                    border: '1px solid', borderColor: filter.bv === b ? 'var(--bd2)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >{b === 'all' ? 'Alle BVs' : b}</button>
              ))}
            </div>
          </div>

          {/* Periode */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--t3)' }}>Periode</span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {periods.map(p => (
                <button
                  key={p.id}
                  className={`btn sm${period === p.id ? ' primary' : ' ghost'}`}
                  onClick={() => setPeriod(p.id)}
                  style={{ fontSize: 11 }}
                >{p.label}</button>
              ))}
            </div>
          </div>

          {/* Kolom-toggles */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--t3)' }}>Kolommen</span>
            {(['actual', 'budget', 'delta'] as ColType[]).map(ct => (
              <button
                key={ct}
                onClick={() => toggleCol(ct)}
                style={{
                  padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: colTypes.has(ct) ? 600 : 400,
                  cursor: 'pointer', border: '1px solid', fontFamily: 'var(--font)', transition: 'all .12s',
                  borderColor: colTypes.has(ct) ? (ct === 'delta' ? 'var(--amber)' : 'var(--blue)') : 'var(--bd2)',
                  background:  colTypes.has(ct) ? (ct === 'delta' ? 'rgba(251,191,36,.12)' : 'rgba(0,169,224,.12)') : 'transparent',
                  color: colTypes.has(ct) ? (ct === 'delta' ? 'var(--amber)' : 'var(--blue)') : 'var(--t3)',
                }}
              >{COL_LABELS[ct]}</button>
            ))}
          </div>

          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--green)', background: 'var(--bd-green)', padding: '2px 7px', borderRadius: 4 }}>
            ● Live OHW
          </span>

          <button
            className="btn sm success"
            onClick={exportExcel}
            title={`Exporteer huidige selectie (${periodLabel}${filter.bv !== 'all' ? ' · ' + filter.bv : ''}) naar Excel`}
            style={{ fontSize: 11 }}
          >
            ↓ Excel export
          </button>
        </div>
      </div>

      {/* ── Analyse & redenen card — top ─────────────────────────── */}
      <div className="card" style={{ borderLeft: `3px solid ${deltaEbitda >= 0 ? 'var(--green)' : 'var(--amber)'}` }}>
        <div className="card-hdr">
          <span className="card-title">Analyse & redenen — {periodLabel}</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>
            {filter.bv === 'all' ? 'Alle BV\'s' : filter.bv} · automatische interpretatie van verschillen
          </span>
        </div>
        <div style={{ padding: '14px 18px' }}>

          {/* Top-line: Δ EBITDA samengevat — met %-referentie en brutomarge-margin */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
            <div style={{ padding: '10px 12px', borderRadius: 7, background: 'var(--bg3)', border: '1px solid var(--bd2)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
                Δ Brutomarge
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: deltaBrut >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {deltaBrut >= 0 ? '+' : ''}{fmt(deltaBrut)}
                <span style={{ fontSize: 11, marginLeft: 6, color: 'var(--t3)', fontWeight: 400 }}>
                  {(totalBudget['brutomarge'] ?? 0) !== 0 ? `(${deltaBrut >= 0 ? '+' : ''}${(deltaBrut / Math.abs(totalBudget['brutomarge']) * 100).toFixed(1)}%)` : ''}
                </span>
              </div>
              {isFinite(gmDelta) && (
                <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 3 }}>
                  Marge-% {gmBudget.toFixed(1)} → {gmActual.toFixed(1)}
                  {' '}
                  <span style={{ color: gmDelta >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                    ({gmDelta >= 0 ? '+' : ''}{gmDelta.toFixed(1)}pp)
                  </span>
                </div>
              )}
            </div>
            <div style={{ padding: '10px 12px', borderRadius: 7, background: 'var(--bg3)', border: `1px solid ${deltaEbitda >= 0 ? 'var(--green)' : 'var(--red)'}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
                Δ EBITDA
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--mono)', color: deltaEbitda >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {deltaEbitda >= 0 ? '+' : ''}{fmt(deltaEbitda)}
                <span style={{ fontSize: 11, marginLeft: 6, color: 'var(--t3)', fontWeight: 400 }}>
                  {(totalBudget['ebitda'] ?? 0) !== 0 ? `(${deltaEbitda >= 0 ? '+' : ''}${(deltaEbitda / Math.abs(totalBudget['ebitda']) * 100).toFixed(1)}%)` : ''}
                </span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 3 }}>
                actuals {fmt(totalActuals['ebitda'] ?? 0)} · budget {fmt(totalBudget['ebitda'] ?? 0)}
              </div>
            </div>
            <div style={{ padding: '10px 12px', borderRadius: 7, background: 'var(--bg3)', border: '1px solid var(--bd2)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
                Δ EBIT
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: deltaEbit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {deltaEbit >= 0 ? '+' : ''}{fmt(deltaEbit)}
                <span style={{ fontSize: 11, marginLeft: 6, color: 'var(--t3)', fontWeight: 400 }}>
                  {(totalBudget['ebit'] ?? 0) !== 0 ? `(${deltaEbit >= 0 ? '+' : ''}${(deltaEbit / Math.abs(totalBudget['ebit']) * 100).toFixed(1)}%)` : ''}
                </span>
              </div>
            </div>
          </div>

          {/* Kernboodschap — samenhang tussen drivers ────────────────── */}
          {(() => {
            const topDriver = driversWithImpact[0]
            const revDelta  = deltaOf('netto_omzet')
            const ebitdaPct = (totalBudget['ebitda'] ?? 0) !== 0
              ? ` (${deltaEbitda >= 0 ? '+' : ''}${(deltaEbitda / Math.abs(totalBudget['ebitda']) * 100).toFixed(1)}%)`
              : ''
            const topDriverPct = (totalBudget[topDriver.key] ?? 0) !== 0
              ? ` (${topDriver.delta >= 0 ? '+' : ''}${(topDriver.delta / Math.abs(totalBudget[topDriver.key]) * 100).toFixed(1)}%)`
              : ''
            // Tweede-orde: beweegt de marge? Is de omzet de echte driver?
            const marginMoved = isFinite(gmDelta) && Math.abs(gmDelta) >= 0.5
            const revenueIsDriver =
              topDriver.key !== 'netto_omzet' &&
              Math.abs(revDelta) > Math.abs(topDriver.delta) * 0.6 &&
              omzetBudget !== 0
            return (
              <div style={{
                padding: '10px 12px', borderRadius: 7, marginBottom: 14,
                background: deltaEbitda >= 0 ? 'var(--bd-green)' : 'var(--bd-amber)',
                border: `1px solid ${deltaEbitda >= 0 ? 'var(--green)' : 'var(--amber)'}`,
                fontSize: 12, color: 'var(--t1)', lineHeight: 1.5,
              }}>
                <strong>{deltaEbitda >= 0 ? '▲' : '▼'} EBITDA {deltaEbitda >= 0 ? 'boven' : 'onder'} budget{ebitdaPct}</strong>
                {' — '}
                Grootste driver: <strong>{topDriver.label.toLowerCase()}</strong>
                {' ('}
                <span style={{ fontFamily: 'var(--mono)' }}>{topDriver.delta >= 0 ? '+' : ''}{fmt(topDriver.delta)}{topDriverPct}</span>
                {').'}
                {marginMoved && (
                  <> Brutomarge-% beweegt <strong style={{ color: gmDelta >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {gmDelta >= 0 ? '+' : ''}{gmDelta.toFixed(1)}pp
                  </strong> — {gmDelta >= 0
                    ? 'mix of efficiency verbetert de ratio.'
                    : 'kostenratio loopt op: controleer inkoopprijzen of tariefdruk.'}</>
                )}
                {revenueIsDriver && (
                  <> Let op: omzet wijkt <span style={{ fontFamily: 'var(--mono)' }}>
                    {((omzetPct - 1) * 100 >= 0 ? '+' : '')}{((omzetPct - 1) * 100).toFixed(1)}%
                  </span> af — een deel van de variance in kosten schuift mee met volume.</>
                )}
              </div>
            )
          })()}

          {/* Driver-lijst met redenen */}
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
            Verschillen per component (gesorteerd op EBITDA-impact)
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {driversWithImpact.map(d => {
              const fav = isFavourable(d.delta)
              const reason = reasonFor(d)
              const absImpact = Math.abs(d.ebitdaImpact)
              const maxImpact = Math.max(...driversWithImpact.map(x => Math.abs(x.ebitdaImpact)), 1)
              const barPct = (absImpact / maxImpact * 100).toFixed(0)
              return (
                <div key={d.key} style={{
                  padding: '8px 10px', borderRadius: 6,
                  background: 'var(--bg2)', border: '1px solid var(--bd)',
                  display: 'grid', gridTemplateColumns: '180px 1fr 140px', gap: 10, alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t1)' }}>{d.label}</div>
                    <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 1 }}>
                      actuals: <span style={{ fontFamily: 'var(--mono)' }}>{fmt(totalActuals[d.key] ?? 0)}</span> · budget: <span style={{ fontFamily: 'var(--mono)' }}>{fmt(totalBudget[d.key] ?? 0)}</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--t2)', lineHeight: 1.4 }}>{reason}</div>
                    <div style={{ marginTop: 4, height: 3, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${barPct}%`, background: fav ? 'var(--green)' : 'var(--red)', transition: 'width 0.3s' }} />
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--mono)', color: fav ? 'var(--green)' : 'var(--red)' }}>
                      {d.delta >= 0 ? '+' : ''}{fmt(d.delta)}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 1 }}>
                      EBITDA-impact: <span style={{ fontWeight: 600, color: d.ebitdaImpact >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {d.ebitdaImpact >= 0 ? '+' : ''}{fmt(d.ebitdaImpact)}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* FTE-koppeling — als er FTE-data is voor deze periode */}
          {fteDelta && (
            <div style={{
              marginTop: 12, padding: '10px 12px', borderRadius: 7,
              background: 'var(--bd-blue)', border: '1px solid var(--blue)',
              fontSize: 11, color: 'var(--t1)', lineHeight: 1.5,
              display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 16 }}>👥</span>
              <div style={{ flex: 1, minWidth: 200 }}>
                <strong>FTE-koppeling</strong>
                {' — '}
                Bezetting actuals: <span style={{ fontFamily: 'var(--mono)' }}>{fteDelta.actual.toFixed(1)}</span>,
                budget: <span style={{ fontFamily: 'var(--mono)' }}>{fteDelta.budget.toFixed(1)}</span>,
                <strong style={{ marginLeft: 4, color: fteDelta.delta <= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--mono)' }}>
                  Δ {fteDelta.delta >= 0 ? '+' : ''}{fteDelta.delta.toFixed(1)}
                </strong>
                {Math.abs(fteDelta.delta) > 0.5 && (
                  <> — {fteDelta.delta < 0
                    ? 'onderbezetting t.o.v. plan; een deel van de OPEX/salariskostenreductie is hieraan toe te schrijven.'
                    : 'overschrijding van bezetting; directe en indirecte personeelskosten mogelijk hoger dan begroot.'}</>
                )}
              </div>
              <button
                onClick={() => navigateTo({ tab: 'maand', section: 'fte' })}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--blue)', fontSize: 11, fontWeight: 600,
                  textDecoration: 'underline', textDecorationStyle: 'dotted',
                  textUnderlineOffset: 3, padding: 0,
                }}
              >
                → FTE tab
              </button>
            </div>
          )}

          {/* Hint-regel */}
          <div style={{ marginTop: 10, fontSize: 10, color: 'var(--t3)', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span>💡 <strong>Lees-richtlijn:</strong> groen = gunstig voor EBITDA (meer omzet OF minder kosten). Voor kosten-regels wordt het teken automatisch omgedraaid.</span>
            <span>Bekijk de details in de tabel hieronder.</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-hdr">
          <span className="card-title">Budget vs Actuals</span>
          <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--t3)' }}>{periodLabel}</span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ minWidth: 'max-content', borderCollapse: 'collapse' }}>
            <thead>
              {/* Entity header */}
              <tr>
                <th style={{ minWidth: 240, padding: '6px 12px', textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 3 }}>
                  {periodLabel}
                </th>
                {entityGroups.map(eg => {
                  const span = activeCols.length
                  const isTot = eg === 'Totaal'
                  return (
                    <th
                      key={eg}
                      colSpan={span}
                      style={{
                        textAlign: 'center', padding: '5px 8px', fontSize: 11,
                        fontWeight: isTot ? 700 : 600,
                        borderLeft: '1px solid var(--bd2)',
                        color: isTot ? 'var(--t1)' : 'var(--t2)',
                        minWidth: span * 105,
                      }}
                    >
                      {eg}
                    </th>
                  )
                })}
              </tr>
              {/* Sub-header: col type labels */}
              <tr style={{ background: 'var(--bg3)' }}>
                <th style={{ position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 3, padding: '4px 12px' }} />
                {entityGroups.map(eg => activeCols.map(ct => (
                  <th
                    key={`${eg}-${ct}`}
                    className="r"
                    style={{
                      minWidth: 105, padding: '3px 8px', fontSize: 10, fontWeight: 600,
                      color: COL_COLORS[ct],
                      borderLeft: ct === activeCols[0] ? '1px solid var(--bd2)' : undefined,
                    }}
                  >
                    {COL_LABELS[ct]}
                  </th>
                )))}
              </tr>
            </thead>

            <tbody>
              {PL_STRUCTURE.map(item => {
                if (item.isSeparator) {
                  return (
                    <tr key={item.key}>
                      <td colSpan={1 + entityGroups.length * activeCols.length} style={{ padding: 0, height: 1, background: 'var(--bd)' }} />
                    </tr>
                  )
                }

                if (item.isPercentage) {
                  return (
                    <tr key={item.key} style={{ background: 'var(--bg1)' }}>
                      <td style={{ padding: '3px 12px', fontSize: 10, color: 'var(--t3)', fontStyle: 'italic', position: 'sticky', left: 0, background: 'var(--bg1)', zIndex: 1 }}>
                        {item.label}
                      </td>
                      {entityGroups.map(eg => activeCols.map(ct => {
                        const a = eg === 'Totaal' ? totalActuals : allActuals[eg as EntityName]
                        const b = eg === 'Totaal' ? totalBudget  : allBudgets[eg as EntityName]
                        const d = ct === 'budget' ? b : a
                        return (
                          <td key={`${eg}-${ct}`} className="mono r" style={{ padding: '3px 8px', fontSize: 10, color: 'var(--t3)', borderLeft: ct === activeCols[0] ? '1px solid var(--bd2)' : undefined }}>
                            {pctStr(item.key, d)}
                          </td>
                        )
                      }))}
                    </tr>
                  )
                }

                return (
                  <tr key={item.key} style={{ background: item.isBold ? 'var(--bg3)' : undefined }}>
                    <td style={{
                      padding: '4px 12px', paddingLeft: 12 + (item.indent ?? 0) * 14,
                      fontWeight: item.isBold ? 700 : 400,
                      position: 'sticky', left: 0, zIndex: 1,
                      background: item.isBold ? 'var(--bg3)' : 'var(--bg2)',
                    }}>
                      {item.label}
                    </td>
                    {entityGroups.map(eg => {
                      const a = eg === 'Totaal' ? (totalActuals[item.key] ?? 0) : (allActuals[eg as EntityName][item.key] ?? 0)
                      const b = eg === 'Totaal' ? (totalBudget[item.key]  ?? 0) : (allBudgets[eg as EntityName][item.key] ?? 0)
                      return activeCols.map(ct => (
                        <td
                          key={`${eg}-${ct}`}
                          className="mono r"
                          style={{
                            padding: '4px 8px',
                            borderLeft: ct === activeCols[0] ? '1px solid var(--bd2)' : undefined,
                            fontWeight: item.isBold ? 700 : 400,
                          }}
                        >
                          {renderCell(item.key, a, b, ct, item.isBold ?? false)}
                        </td>
                      ))
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
