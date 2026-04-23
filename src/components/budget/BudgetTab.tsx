import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import {
  PL_STRUCTURE,
  monthlyActuals2026, monthlyBudget2026,
  ytdActuals2026, ytdBudget2026,
  ytdActuals2025, ytdBudget2025,
} from '../../data/plData'
import { monthlyActuals2025, monthlyBudget2025, MONTHS_2025_LABELS } from '../../data/plData2025'
import type { EntityName } from '../../data/plData'
import { fmt } from '../../lib/format'
import type { BvId, GlobalFilter } from '../../data/types'
import { useAdjustedActuals } from '../../hooks/useAdjustedActuals'
import { useFteStore } from '../../store/useFteStore'
import { useNavStore } from '../../store/useNavStore'

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

function deltaColor(d: number, key: string): string {
  // For cost lines (negative values), inverse the color logic
  const isCost = key.includes('kosten') || key.includes('amortisatie') || key.includes('afschrijving')
  if (d === 0) return 'var(--t3)'
  if (isCost) return d < 0 ? 'var(--green)' : 'var(--red)'
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

  // When year changes, jump to that year's YTD period (prevents mismatch: 2026 periods shown while 2025 selected)
  useEffect(() => {
    setPeriod(filter.year === '2025' ? 'ytd25' : 'ytd26')
  }, [filter.year])

  const visibleEntities: EntityName[] = filter.bv === 'all'
    ? ALL_ENTITIES
    : [filter.bv as EntityName, 'Holdings'].filter(e => ALL_ENTITIES.includes(e as EntityName)) as EntityName[]

  const currentPeriod = periods.find(p => p.id === period) ?? periods[periods.length - 1]

  const getActuals = (p: Period, e: EntityName): Record<string, number> => {
    if (p.year === '2025') {
      if (p.month) return monthlyActuals2025[e]?.[p.month] ?? {}
      return ytdActuals2025[e] ?? {}
    }
    // 2026
    if (e === 'Holdings') {
      if (p.month) return monthlyActuals2026[e]?.[p.month] ?? {}
      return ytdActuals2026[e] ?? {}
    }
    if (p.month) return getMonthly(e as BvId, p.month)
    return getYtd(e as BvId, p.ytdMonths ?? [])
  }

  const getBudget = (p: Period, e: EntityName): Record<string, number> => {
    if (p.year === '2025') {
      if (p.month) return monthlyBudget2025[e]?.[p.month] ?? {}
      return ytdBudget2025[e] ?? {}
    }
    if (p.month) return monthlyBudget2026[e]?.[p.month] ?? {}
    return ytdBudget2026[e] ?? {}
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

  // ── Excel export met huidige filters (periode, BV, kolomtypes) ──
  const exportExcel = () => {
    const header: (string | number)[] = [`${periodLabel} — Regel`]
    for (const eg of entityGroups) {
      for (const ct of activeCols) header.push(`${eg} — ${COL_LABELS[ct]}`)
    }
    const rows: (string | number)[][] = [header]

    for (const item of PL_STRUCTURE) {
      if (item.isSeparator) continue
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
    }

    const ws = XLSX.utils.aoa_to_sheet(rows)
    // Formatteer getallen: Nederlandse euro-notatie
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      for (let c = range.s.c + 1; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c })
        const cell = ws[addr]
        if (cell && typeof cell.v === 'number') cell.z = '#,##0;-#,##0;-'
      }
    }
    // Auto-width per kolom
    ws['!cols'] = header.map((h, i) => ({
      wch: i === 0 ? 32 : Math.max(12, String(h).length + 2),
    }))

    const bvSuffix = filter.bv === 'all' ? 'alle-BVs' : filter.bv
    const fileName = `Budget-vs-Actuals_${periodLabel.replace(/\s+/g, '-')}_${bvSuffix}.xlsx`

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `Budget vs Actuals`)
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
  // "Gunstig" = groen. Voor kosten-regels (waarde is negatief in P&L) betekent
  // een NEGATIEVE delta (lagere kosten dan budget) gunstig.
  const isFavourable = (delta: number, isCost: boolean) => isCost ? delta < 0 : delta > 0
  const deltaEbitda = deltaOf('ebitda')
  const deltaEbit   = deltaOf('ebit')
  const deltaBrut   = deltaOf('brutomarge')

  // Sorteer drivers op impact op EBITDA (absoluut). Kosten-delta's gaan IN op
  // EBITDA met omgekeerd teken (lager = gunstig), daarom nemen we -delta als
  // EBITDA-impact voor kosten.
  const driversWithImpact = varianceDrivers
    .map(d => ({ ...d, ebitdaImpact: d.isCost ? -d.delta : d.delta }))
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

  // Bepaal hoofdboodschap + hypothese-lijst. Rekening houdend met
  // ontbrekende data: als actuals OF budget voor een component niet
  // gevuld is, geven we GEEN conclusie maar een status-melding.
  const reasonFor = (d: typeof driversWithImpact[number]): string => {
    const actualsZero = !anyEntityHas(d.key, allActuals)
    const budgetZero  = !anyEntityHas(d.key, allBudgets)
    if (actualsZero && budgetZero) {
      return 'Nog geen actuals én geen budget voor deze component — geen variance-analyse mogelijk.'
    }
    if (budgetZero) {
      return `Actuals gevuld (${fmt(totalActuals[d.key] ?? 0)}), maar budget voor deze component is nog niet ingevuld. Ga naar Budgetten om sturing mogelijk te maken.`
    }
    if (actualsZero) {
      return `Budget staat op ${fmt(totalBudget[d.key] ?? 0)}, maar actuals zijn nog niet geboekt voor deze periode. Wacht tot closing afgerond is voor een betrouwbare analyse.`
    }
    const fav = isFavourable(d.delta, d.isCost)
    if (d.key === 'netto_omzet') {
      return fav ? 'Meer omzet gerealiseerd dan begroot — duidt op sterkere vraag of hogere tarieven.'
                 : 'Minder omzet dan begroot — mogelijk lagere bezetting, uitgestelde projecten of prijsdruk.'
    }
    if (d.key === 'directe_kosten') {
      return fav ? 'Lagere directe kosten dan begroot — efficiëntere inzet of lagere inkoopkosten.'
                 : 'Hogere directe kosten dan begroot — mogelijk meer inhuur, inflatie op materialen of onverwachte overwerk.'
    }
    if (d.key === 'operationele_kosten') {
      if (fteDelta && fteDelta.delta < -0.5) {
        return fav
          ? `Lagere OPEX — loopt samen met lagere bezetting (Δ FTE ${fteDelta.delta.toFixed(1)}). Kostenreductie voornamelijk door personele onderbezetting.`
          : `Hogere OPEX ondanks lagere FTE (Δ ${fteDelta.delta.toFixed(1)}) — duidt op niet-personele lastenverhogingen (ICT, huur, marketing).`
      }
      if (fteDelta && fteDelta.delta > 0.5) {
        return fav
          ? `Lagere OPEX ondanks hogere bezetting (Δ FTE +${fteDelta.delta.toFixed(1)}) — operationele efficiëntieverbetering.`
          : `Hogere OPEX — mogelijk verklaard door hogere bezetting (Δ FTE +${fteDelta.delta.toFixed(1)}).`
      }
      return fav ? 'Lagere operationele kosten dan begroot — efficiëntiewinst of uitgestelde uitgaven.'
                 : 'Hogere operationele kosten dan begroot — onderzoek inflatie, marketing, ICT of algemene kosten.'
    }
    if (d.key === 'amortisatie_afschrijvingen') {
      return fav ? 'Lagere afschrijvingen dan begroot — uitgestelde investeringen of langere afschrijvingstermijn.'
                 : 'Hogere afschrijvingen dan begroot — extra investeringen of kortere termijn.'
    }
    return ''
  }

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

          {/* Top-line: Δ EBITDA samengevat */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
            <div style={{ padding: '10px 12px', borderRadius: 7, background: 'var(--bg3)', border: '1px solid var(--bd2)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
                Δ Brutomarge
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: deltaBrut >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {deltaBrut >= 0 ? '+' : ''}{fmt(deltaBrut)}
              </div>
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
            </div>
            <div style={{ padding: '10px 12px', borderRadius: 7, background: 'var(--bg3)', border: '1px solid var(--bd2)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
                Δ EBIT
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: deltaEbit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {deltaEbit >= 0 ? '+' : ''}{fmt(deltaEbit)}
              </div>
            </div>
          </div>

          {/* Kernboodschap */}
          <div style={{
            padding: '10px 12px', borderRadius: 7, marginBottom: 14,
            background: deltaEbitda >= 0 ? 'var(--bd-green)' : 'var(--bd-amber)',
            border: `1px solid ${deltaEbitda >= 0 ? 'var(--green)' : 'var(--amber)'}`,
            fontSize: 12, color: 'var(--t1)',
          }}>
            <strong>{deltaEbitda >= 0 ? '▲' : '▼'} EBITDA {deltaEbitda >= 0 ? 'boven' : 'onder'} budget</strong>
            {' — '}
            De grootste driver van dit resultaat is <strong>{driversWithImpact[0].label.toLowerCase()}</strong>
            {' ('}
            <span style={{ fontFamily: 'var(--mono)' }}>{driversWithImpact[0].delta >= 0 ? '+' : ''}{fmt(driversWithImpact[0].delta)}</span>
            {' → EBITDA-impact '}
            <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: driversWithImpact[0].ebitdaImpact >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {driversWithImpact[0].ebitdaImpact >= 0 ? '+' : ''}{fmt(driversWithImpact[0].ebitdaImpact)}
            </span>
            {').'}
          </div>

          {/* Driver-lijst met redenen */}
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
            Verschillen per component (gesorteerd op EBITDA-impact)
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {driversWithImpact.map(d => {
              const fav = isFavourable(d.delta, d.isCost)
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
