import { useState, useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import '../../lib/chartSetup'
import { baseChartOptions } from '../../lib/chartSetup'
import { PL_STRUCTURE, ytdActuals2025, ytdBudget2025 } from '../../data/plData'
import type { EntityName } from '../../data/plData'
import { monthlyActuals2025, MONTHS_2025_LABELS } from '../../data/plData2025'
import { useBudgetStore, BUDGET_MONTHS_2026 } from '../../store/useBudgetStore'
import { useFteStore } from '../../store/useFteStore'
import { useHoursStore } from '../../store/useHoursStore'
import { useAdjustedActuals } from '../../hooks/useAdjustedActuals'
import { fmt, parseNL } from '../../lib/format'
import type { BvId, GlobalFilter } from '../../data/types'
import { SUBS_OF, DERIVED_FORMULA, AGGREGATE_KEYS, DERIVED_KEYS, READONLY_KEYS } from '../../lib/plDerive'

/**
 * Altijd-aan input cell voor Budget-invoer. Eén klik focus je, getallen
 * worden geformatteerd getoond tot je focust, dan zie je het ruwe getal.
 * Commit op blur/Enter; Escape herstelt.
 */
function BudgetInput({
  value,
  onCommit,
  highlight,
}: {
  value: number
  onCommit: (v: number) => void
  highlight?: boolean
}) {
  const [raw, setRaw] = useState<string | null>(null)
  const editing = raw !== null
  const display = editing ? raw : (value === 0 ? '' : fmt(value))
  const commit = () => {
    if (raw === null) return
    const trimmed = raw.trim()
    const parsed = trimmed === '' ? 0 : parseNL(trimmed)
    const v = isNaN(parsed) ? 0 : parsed
    if (v !== value) onCommit(v)
    setRaw(null)
  }
  return (
    <input
      className="ohw-inp"
      value={display}
      placeholder="—"
      style={{
        width: 85, fontSize: 11, padding: '2px 6px',
        textAlign: 'right',
        fontFamily: 'var(--mono)',
        color: value === 0 ? 'var(--t3)' : highlight ? 'var(--green)' : 'var(--t1)',
        background: highlight ? 'rgba(38,201,151,.05)' : 'var(--bg1)',
        border: '1px solid transparent',
        borderRadius: 3,
      }}
      onFocus={e => {
        setRaw(value === 0 ? '' : String(value))
        // Select na state-update voor consistente select
        setTimeout(() => e.target.select(), 0)
      }}
      onChange={e => setRaw(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          setRaw(null)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

const ENTITIES: EntityName[] = ['Consultancy', 'Projects', 'Software', 'Holdings']

const BV_COLORS: Record<string, string> = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
  Holdings:    '#8fa3c0',
}

// Hoofdmetrics: alleen deze kunnen als chart-optie worden gekozen.
const CHART_METRICS = [
  { key: 'netto_omzet',                label: 'Netto-omzet' },
  { key: 'directe_kosten',             label: 'Directe kosten' },
  { key: 'brutomarge',                 label: 'Brutomarge' },
  { key: 'operationele_kosten',        label: 'Operationele kosten' },
  { key: 'ebitda',                     label: 'EBITDA' },
  { key: 'amortisatie_afschrijvingen', label: 'Amortisatie' },
  { key: 'ebit',                       label: 'EBIT' },
]

// SUBS_OF, DERIVED_FORMULA, AGGREGATE_KEYS, DERIVED_KEYS, READONLY_KEYS
// komen uit ../../lib/plDerive — gedeeld met BudgetTab zodat beide tabs
// dezelfde aggregaat-logica gebruiken.

// Gedeelde kolom-breedtes: zorgt dat Budget- en LE-tabellen exact onder
// elkaar uitlijnen en grote bedragen (FY-totalen, kosten met teken) volledig
// zichtbaar zijn.
const COL_PL_LABEL    = 240  // eerste kolom (sticky): P&L regel
const COL_MONTH       = 110  // elke maand-kolom
const COL_FY_TOTAL    = 130  // FY Totaal / FY LE
const COL_METHODIEK   = 260  // alleen in LE-tabel

// Totaalbreedtes. De .tbl CSS-klasse zet width: 100%, dat in combinatie met
// tableLayout: fixed zou resulteren in proportioneel geschaalde kolommen.
// Daarom overrulen we met een vaste pixel-breedte per tabel — dan blijft de
// Budget-tabel (14 kolommen) exact onder de LE-tabel (15 kolommen) uitgelijnd
// voor de eerste 14 kolommen, en ontstaat de extra methodiek-kolom alleen aan
// de rechterkant in de LE-tabel.
const TABLE_BASE_WIDTH = COL_PL_LABEL + 12 * COL_MONTH + COL_FY_TOTAL // 1690
const TABLE_LE_WIDTH   = TABLE_BASE_WIDTH + COL_METHODIEK             // 1950

// Genereer <colgroup> voor de maand-tabellen. hasMethodiek toont de extra
// rechter-kolom in de LE-tabel.
function MonthTableColgroup({ hasMethodiek = false }: { hasMethodiek?: boolean }) {
  return (
    <colgroup>
      <col style={{ width: COL_PL_LABEL }} />
      {BUDGET_MONTHS_2026.map(m => (
        <col key={m} style={{ width: COL_MONTH }} />
      ))}
      <col style={{ width: COL_FY_TOTAL }} />
      {hasMethodiek && <col style={{ width: COL_METHODIEK }} />}
    </colgroup>
  )
}

interface Props { filter: GlobalFilter }

export function BudgetsTab({ filter: _filter }: Props) {
  const store = useBudgetStore()
  const fteGetEntry = useFteStore(s => s.getEntry)
  // Trigger re-render bij FTE wijzigingen
  useFteStore(s => s.entries)
  const { getMonthly } = useAdjustedActuals()
  // Hours-store voor geplande vakantie/ziekte in toekomstige maanden.
  const hoursEntries = useHoursStore(s => s.entries)
  const getHoursEntry = (bv: BvId, m: string) =>
    hoursEntries.find(e => e.bv === bv && e.month === m)

  const [chartMetric,  setChartMetric]  = useState<string>('netto_omzet')
  const [expandedBvs,  setExpandedBvs]  = useState<Set<EntityName | 'Totaal'>>(new Set(['Consultancy']))
  // Chart-filters: welke BVs tonen + welke series (budget / LE)
  const [chartBvs,     setChartBvs]     = useState<Set<EntityName>>(new Set(ENTITIES))
  const [showBudget,   setShowBudget]   = useState<boolean>(true)
  const [showLe,       setShowLe]       = useState<boolean>(true)
  const [showTotal,    setShowTotal]    = useState<boolean>(false)

  const months = BUDGET_MONTHS_2026
  const activeEntities: EntityName[] = ENTITIES

  // Map Apr-26 → Apr-25 (voor seizoenspatroon vanuit vorig jaar)
  const toPY = (m: string): string => {
    const idx = BUDGET_MONTHS_2026.indexOf(m)
    return idx >= 0 ? MONTHS_2025_LABELS[idx] : m
  }

  // ── Agenda-gebaseerde detectie: welke maanden zijn fully-closed? ──
  const now = new Date()
  const currentYearNum   = now.getFullYear()
  const currentMonthIdx0 = now.getMonth()
  const closedMonthsCount =
    currentYearNum > 2026 ? 12 :
    currentYearNum < 2026 ? 0  :
    currentMonthIdx0
  const closedMonths = months.slice(0, closedMonthsCount)
  const isClosedMonth = (m: string) => closedMonths.includes(m)
  const lastClosedMonth: string | null = closedMonths.length > 0
    ? closedMonths[closedMonths.length - 1]
    : null

  // ── Budget: raw store lookup + derived (aggregate/derived keys) ──
  const rawBudget = (e: EntityName, m: string, k: string): number => {
    const data = store.getMonth(e, m)
    return data[k] ?? 0
  }
  const getBudgetVal = (e: EntityName, m: string, k: string): number => {
    if (AGGREGATE_KEYS.has(k)) {
      return SUBS_OF[k].reduce((s, sk) => s + rawBudget(e, m, sk), 0)
    }
    if (DERIVED_KEYS.has(k)) {
      return DERIVED_FORMULA[k](sk => getBudgetVal(e, m, sk))
    }
    return rawBudget(e, m, k)
  }

  // ── Actuals-lookup ──
  // useAdjustedActuals.getMonthly accepteert ClosingBv (incl. Holdings) en
  // incorporeert de Maandafsluiting (FinStore) — kosten, financieel
  // resultaat, etc. Hierdoor overschrijft een ingevulde maandafsluiting voor
  // Holdings (en elke andere BV) automatisch de LE in deze tab.
  const getActualsFor = (e: EntityName, m: string): Record<string, number> => {
    return getMonthly(e as BvId, m)
  }

  // ── FTE forward-fill: voor een toekomstige maand de recentste ingevulde
  // FTE (binnen 2026), of fallback naar laatste gesloten maand. Hiermee
  // werkt een FTE-invulling in bv. Apr door naar Mei/Jun/... tot er een
  // nieuwe waarde staat.
  const getPlannedFte = (e: BvId, target: string): { fte: number; firstIdx: number; lastClosedIdx: number } => {
    const tIdx = BUDGET_MONTHS_2026.indexOf(target)
    const cIdx = lastClosedMonth ? BUDGET_MONTHS_2026.indexOf(lastClosedMonth) : -1
    const fteLast = lastClosedMonth ? (fteGetEntry(e, lastClosedMonth)?.fte ?? 0) : 0
    // Zoek binnen (closed-idx, target-idx] naar meest recente ingevulde FTE.
    // De eerste maand waarop de FTE van fteLast afwijkt is onze "hire-datum"
    // voor de ramp-up.
    let firstChangeIdx = -1
    let plannedFte = fteLast
    for (let i = cIdx + 1; i <= tIdx && i >= 0; i++) {
      const mm = BUDGET_MONTHS_2026[i]
      const f = fteGetEntry(e, mm)?.fte
      if (f != null) {
        plannedFte = f
        if (firstChangeIdx < 0 && f !== fteLast) firstChangeIdx = i
      }
    }
    return { fte: plannedFte, firstIdx: firstChangeIdx, lastClosedIdx: cIdx }
  }

  /** Ramp-factor voor nieuwe hires: realistischer inwerkschema, want in de
   *  praktijk zijn hires binnen ~2 maanden goed declarabel (niet nul).
   *    Maand 0 (instap): 70%
   *    Maand 1:          90%
   *    Maand 2+:        100%
   *  Voor bestaande FTE (fteDelta ≤ 0) geldt ramp = 1 (volle impact van
   *  ontslag / besparing — capaciteit valt meteen weg). */
  const rampFactor = (monthsSinceFirstHire: number): number => {
    if (monthsSinceFirstHire < 0) return 0
    if (monthsSinceFirstHire === 0) return 0.7
    if (monthsSinceFirstHire === 1) return 0.9
    return 1.0
  }

  // ── Forecast voor toekomstige maanden ──
  // Model:
  //   baselineRev = blend(0.6 * 2025-seizoen × perf_YTD, 0.4 * run-rate Mar-26)
  //   fte-adj     = (fteLast + fteDelta × ramp(monthsSinceHire)) / fteLast
  //   forecast    = baselineRev × fte-adj
  //
  // Ramp: nieuwe hires zijn niet direct 100% declarabel; ze bouwen productie
  // op over ~4 maanden. Cuts tellen wel direct 100% mee.
  const getForecastFor = (e: EntityName, m: string, k: string): number => {
    const v2025 = (month26: string) => monthlyActuals2025[e]?.[toPY(month26)]?.[k] ?? 0
    const v2026 = (month26: string) => getActualsFor(e, month26)[k] ?? 0
    const sameMonth2025 = v2025(m)
    let ytd2026 = 0, ytd2025 = 0
    for (const cm of closedMonths) {
      ytd2026 += v2026(cm)
      ytd2025 += v2025(cm)
    }
    const perfMult = ytd2025 !== 0 ? ytd2026 / ytd2025 : 1
    const lastActual = lastClosedMonth ? v2026(lastClosedMonth) : 0

    let fteAdj = 1
    if (e !== 'Holdings' && lastClosedMonth) {
      const fteLast = fteGetEntry(e as BvId, lastClosedMonth)?.fte ?? 0
      if (fteLast > 0) {
        const planned = getPlannedFte(e as BvId, m)
        const fteDelta = planned.fte - fteLast
        if (fteDelta <= 0) {
          // Ontslag / krimp: volle impact direct (fteFuture / fteLast).
          fteAdj = planned.fte / fteLast
        } else {
          // Nieuwe hires: ramp-up vanaf firstChangeIdx.
          const tIdx = BUDGET_MONTHS_2026.indexOf(m)
          const monthsSinceHire = planned.firstIdx >= 0 ? tIdx - planned.firstIdx : 0
          const ramp = rampFactor(monthsSinceHire)
          const effectiveFte = fteLast + fteDelta * ramp
          fteAdj = effectiveFte / fteLast
        }
      }
    }

    // ── Availability-adjustment o.b.v. geplande vakantie/verlof ─────────
    // De SAP-timesheet upload bevat ook toekomstige vakantie-inleveringen
    // (bv. Jul-26 Consultancy Vakantie 352u). Die vakantie is capaciteit die
    // NIET beschikbaar is voor declarabel werk. We berekenen de ratio van
    // geplande verlof (vakantie + ziekte is zelden gepland, dus primair
    // vakantie) t.o.v. een baseline van werkuren in recente gesloten maanden.
    // Dampening is alleen op omzetgerelateerde keys.
    let leaveAdj = 1
    const isRevenueKey = k === 'netto_omzet' || k === 'gefactureerde_omzet'
    if (e !== 'Holdings' && lastClosedMonth && isRevenueKey) {
      const hoursThisMonth = getHoursEntry(e as BvId, m)
      // Plande vakantie (voor toekomst typisch alleen Vakantie gevuld)
      const plannedVakantie = hoursThisMonth?.vakantie ?? 0
      if (plannedVakantie > 0) {
        // Baseline werkuren: gemiddelde van recente gesloten maanden
        let baselineWork = 0, baselineCount = 0
        for (const cm of closedMonths) {
          const he = getHoursEntry(e as BvId, cm)
          if (he) {
            baselineWork += he.declarable + he.internal
            baselineCount++
          }
        }
        const avgWork = baselineCount > 0 ? baselineWork / baselineCount : 0
        if (avgWork > 0) {
          // Vakantie als ratio van normale werkcapaciteit (cap op 50% dempen).
          const leaveRatio = Math.min(plannedVakantie / avgWork, 0.5)
          leaveAdj = 1 - leaveRatio
        }
      }
    }

    const combinedAdj = fteAdj * leaveAdj
    const seasonalForecast = sameMonth2025 * perfMult * combinedAdj
    const runRateForecast  = lastActual * combinedAdj
    if (seasonalForecast === 0 && runRateForecast === 0) return 0
    if (seasonalForecast === 0) return Math.round(runRateForecast)
    if (runRateForecast === 0)  return Math.round(seasonalForecast)
    return Math.round(0.6 * seasonalForecast + 0.4 * runRateForecast)
  }

  // ── LE-waarde ──
  const rawLeVal = (e: EntityName, m: string, k: string): number => {
    const ov = store.getLeOverride(e, m, k)
    if (ov != null) return ov
    if (isClosedMonth(m)) return getActualsFor(e, m)[k] ?? 0
    return getForecastFor(e, m, k)
  }
  const getLeVal = (e: EntityName, m: string, k: string): number => {
    // Voor CLOSED maanden gebruiken we de werkelijke aggregaat-waarde
    // uit useAdjustedActuals.getMonthly i.p.v. sum-of-subs / derived-
    // formula. Reden: netto_omzet bevat behalve sub-keys ook
    // IC-verrekening, accruals, handmatige correctie en mutatie
    // vooruitgefactureerd — die zijn géén sub-keys maar wel onderdeel
    // van de echte aggregaat-waarde. Hierdoor klopt brutomarge% in
    // de Budgetten-tab nu één-op-één met de BV-overzichtstabel.
    if (isClosedMonth(m) && (AGGREGATE_KEYS.has(k) || DERIVED_KEYS.has(k))) {
      const ov = store.getLeOverride(e, m, k)
      if (ov != null) return ov
      return getActualsFor(e, m)[k] ?? 0
    }
    if (AGGREGATE_KEYS.has(k)) {
      return SUBS_OF[k].reduce((s, sk) => s + rawLeVal(e, m, sk), 0)
    }
    if (DERIVED_KEYS.has(k)) {
      return DERIVED_FORMULA[k](sk => getLeVal(e, m, sk))
    }
    return rawLeVal(e, m, k)
  }
  const getLeSource = (e: EntityName, m: string, k: string): 'override' | 'actual' | 'forecast' | 'derived' => {
    if (READONLY_KEYS.has(k)) return 'derived'
    if (store.getLeOverride(e, m, k) != null) return 'override'
    if (isClosedMonth(m)) return 'actual'
    return 'forecast'
  }

  // ── Kopieer alle bewerkbare waardes van vorige maand naar deze maand ──
  const copyPrevMonth = (e: EntityName, mIdx: number) => {
    if (mIdx <= 0) return
    const prev = months[mIdx - 1]
    const cur = months[mIdx]
    for (const item of PL_STRUCTURE) {
      if (item.isSeparator || item.isPercentage) continue
      if (READONLY_KEYS.has(item.key)) continue
      const val = rawBudget(e, prev, item.key)
      store.setValue(e, cur, item.key, val)
    }
  }

  // ── Accordion toggle (BV of 'Totaal') ──
  const toggleBv = (e: EntityName | 'Totaal') => {
    setExpandedBvs(prev => {
      const next = new Set(prev)
      if (next.has(e)) next.delete(e); else next.add(e)
      return next
    })
  }

  // ── Totaal helpers: som over alle BVs (Consultancy + Projects + Software + Holdings) ──
  const totalBudgetVal = (m: string, k: string): number =>
    ENTITIES.reduce((s, e) => s + getBudgetVal(e, m, k), 0)
  const totalLeVal = (m: string, k: string): number =>
    ENTITIES.reduce((s, e) => s + getLeVal(e, m, k), 0)

  // FY helper
  const fyBudget = (e: EntityName, k: string) => months.reduce((s, m) => s + getBudgetVal(e, m, k), 0)
  const fyLe     = (e: EntityName, k: string) => months.reduce((s, m) => s + getLeVal(e, m, k), 0)

  // ── Chart: budget (solid) + LE (dashed) per BV, met filters ──
  // Chart.js accepteert losse velden als extra options, dus we typen de
  // datasets als `any[]` om strict mode build niet te laten struikelen op
  // optionele props zoals borderDash / pointStyle.
  const chartData = useMemo(() => {
    const bvs = activeEntities.filter(e => chartBvs.has(e))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const datasets: any[] = []
    if (showBudget) {
      for (const e of bvs) {
        datasets.push({
          label: `${e} — Budget`,
          data: months.map(m => getBudgetVal(e, m, chartMetric)),
          borderColor: BV_COLORS[e],
          backgroundColor: BV_COLORS[e] + '22',
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 3,
          fill: false,
        })
      }
    }
    if (showLe) {
      for (const e of bvs) {
        datasets.push({
          label: `${e} — LE`,
          data: months.map(m => getLeVal(e, m, chartMetric)),
          borderColor: BV_COLORS[e],
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [6, 4],
          tension: 0.3,
          pointRadius: 2,
          pointStyle: 'rectRot' as const,
          fill: false,
        })
      }
    }
    if (showTotal) {
      if (showBudget) {
        datasets.push({
          label: 'Totaal — Budget',
          data: months.map(m => bvs.reduce((s, e) => s + getBudgetVal(e, m, chartMetric), 0)),
          borderColor: '#fbbf24',
          backgroundColor: '#fbbf2422',
          borderWidth: 3,
          tension: 0.3,
          pointRadius: 4,
          pointStyle: 'circle' as const,
          fill: false,
        })
      }
      if (showLe) {
        datasets.push({
          label: 'Totaal — LE',
          data: months.map(m => bvs.reduce((s, e) => s + getLeVal(e, m, chartMetric), 0)),
          borderColor: '#fbbf24',
          backgroundColor: 'transparent',
          borderWidth: 3,
          borderDash: [6, 4],
          tension: 0.3,
          pointRadius: 3,
          pointStyle: 'rectRot' as const,
          fill: false,
        })
      }
    }
    return { labels: months, datasets }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartMetric, chartBvs, showBudget, showLe, showTotal, store.overrides, store.leOverrides])

  // ── Budget cell: altijd-aan input voor subs, read-only span voor
  // aggregaten/derived (brutomarge, EBITDA, etc.)
  const renderBudgetCell = (e: EntityName, m: string, k: string) => {
    const val = getBudgetVal(e, m, k)
    const readOnly = READONLY_KEYS.has(k)
    if (readOnly) {
      return (
        <span
          style={{ color: val === 0 ? 'var(--t3)' : 'var(--brand)', fontWeight: 700 }}
          title="Auto-afgeleid uit subposten"
        >
          {val === 0 ? '—' : fmt(val)}
        </span>
      )
    }
    const hasOv = store.overrides[e]?.[m]?.[k] !== undefined
    return (
      <BudgetInput
        value={val}
        highlight={hasOv}
        onCommit={v => store.setValue(e, m, k, v)}
      />
    )
  }

  // LE is read-only overal: waardes komen automatisch uit actuals of forecast.
  // Geen click-to-edit meer — als de gebruiker iets wil corrigeren gaat dat
  // via het Budget, niet via een LE-override.
  const renderLeCell = (val: number, src: 'override' | 'actual' | 'forecast' | 'derived') => {
    const color =
      val === 0         ? 'var(--t3)' :
      src === 'derived' ? 'var(--brand)' :
      src === 'actual'  ? 'var(--brand)' :
      src === 'override'? 'var(--green)' :
      'var(--amber)' // forecast
    const fontStyle = src === 'forecast' ? 'italic' : 'normal'
    const bg =
      src === 'actual'   ? 'rgba(0,169,224,.06)' :
      src === 'override' ? 'rgba(38,201,151,.06)' :
      src === 'forecast' ? 'rgba(245,158,11,.05)' :
      undefined
    return (
      <span
        style={{
          color,
          cursor: 'default',
          fontWeight: src === 'actual' || src === 'derived' ? 700 : 500,
          fontStyle,
          background: bg,
          padding: '1px 4px',
          borderRadius: 2,
        }}
        title={
          src === 'derived'  ? 'Auto-afgeleid van subposten' :
          src === 'actual'   ? 'Werkelijk (uit Maandafsluiting/OHW)' :
          src === 'override' ? 'Handmatige override uit eerder (read-only)' :
                               'Forecast — 60% seizoen × performance × FTE + 40% run-rate × FTE'
        }
      >
        {val === 0 ? '—' : fmt(val)}
      </span>
    )
  }

  // ── Methodiek per rij: concrete redenering achter de LE-waarde ──
  // Splits de FY-LE in "Q1 actuals" en "Forecast Apr-Dec", toont de
  // performance-multiplier en de run-rate-anchor per sleutel.
  const methodiekText = (getLe: (m: string, k: string) => number, getAct: (m: string, k: string) => number, key: string): React.ReactNode => {
    if (READONLY_KEYS.has(key)) {
      return <span style={{ color: 'var(--t3)', fontStyle: 'italic' }}>auto-afgeleid uit subposten</span>
    }
    const actualsQ1  = closedMonths.reduce((s, m) => s + getLe(m, key), 0)
    const forecastRest = months
      .filter(m => !isClosedMonth(m))
      .reduce((s, m) => s + getLe(m, key), 0)

    // Performance multiplier voor dit specifieke P&L-sleutel
    let ytd2026 = 0, ytd2025Sum = 0
    for (const cm of closedMonths) {
      ytd2026 += getAct(cm, key)
    }
    // Voor 2025: gebruik Jan-Mar 2025 equivalent
    // Dit is alleen indicatief — het echte forecast-gewicht wordt per BV berekend.
    const perfMult = ytd2025Sum !== 0 ? ytd2026 / ytd2025Sum : null
    const runRate = lastClosedMonth ? getAct(lastClosedMonth, key) : 0

    return (
      <div style={{ fontSize: 9, lineHeight: 1.4, color: 'var(--t3)' }}>
        <div>Q1 actuals: <span style={{ fontFamily: 'var(--mono)', color: 'var(--brand)' }}>{actualsQ1 === 0 ? '—' : fmt(actualsQ1)}</span></div>
        <div>Apr–Dec forecast: <span style={{ fontFamily: 'var(--mono)', color: 'var(--amber)' }}>{forecastRest === 0 ? '—' : fmt(forecastRest)}</span></div>
        {runRate !== 0 && (
          <div style={{ marginTop: 2 }}>Run-rate (Mar-26): <span style={{ fontFamily: 'var(--mono)' }}>{fmt(runRate)}</span>
            {perfMult != null && <> · perf {perfMult.toFixed(2)}×</>}
          </div>
        )}
      </div>
    )
  }

  // Helper: rij-node opbouwen voor 1 P&L-regel. Optioneel laatste kolom
  // (methodiek) voor de LE-tabel.
  const renderRow = (
    rowKey: string,
    item: typeof PL_STRUCTURE[number],
    cellRenderer: (m: string) => React.ReactNode,
    getTotal: () => number,
    extraCell?: React.ReactNode,
  ) => {
    const readOnly = READONLY_KEYS.has(item.key)
    const total = getTotal()
    return (
      <tr key={`${rowKey}-${item.key}`} style={{ background: item.isBold ? 'var(--bg3)' : undefined }}>
        <td style={{
          position: 'sticky', left: 0, zIndex: 1,
          background: item.isBold ? 'var(--bg3)' : 'var(--bg2)',
          padding: '4px 12px',
          paddingLeft: 12 + (item.indent ?? 0) * 14,
          fontWeight: item.isBold ? 700 : 400,
          color: readOnly ? 'var(--brand)' : 'var(--t1)',
          fontSize: item.isBold ? 12 : 11,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {item.label}
          {readOnly && <span style={{ fontSize: 9, color: 'var(--t3)', marginLeft: 6, fontWeight: 400 }}>auto</span>}
        </td>
        {months.map(m => (
          <td key={m} className="r mono" style={{ padding: '3px 6px', fontSize: 11, whiteSpace: 'nowrap' }}>
            {cellRenderer(m)}
          </td>
        ))}
        <td className="r mono" style={{
          fontWeight: 700,
          color: 'var(--brand)',
          borderLeft: '1px solid var(--bd2)',
          padding: '3px 6px',
          fontSize: 11,
          whiteSpace: 'nowrap',
        }}>
          {total === 0 ? '—' : fmt(total)}
        </td>
        {extraCell !== undefined && (
          <td style={{ padding: '3px 10px', borderLeft: '1px solid var(--bd2)' }}>
            {extraCell}
          </td>
        )}
      </tr>
    )
  }

  // ── Voorgekookte rijen per BV (geheugen-light: PL_STRUCTURE is constant) ──
  const plRows = PL_STRUCTURE.filter(i => !i.isSeparator && !i.isPercentage)

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>FY 2026 · Budget & Latest Estimate</div>
          <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>
            Per BV uitklapbaar · alle P&L regels bewerkbaar · aggregaten (netto-omzet, directe kosten, brutomarge, EBITDA, EBIT) auto-afgeleid uit subposten
          </div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)', textAlign: 'right' }}>
          <div>Totaal netto-omzet: <strong style={{ color: 'var(--brand)' }}>{fmt(ENTITIES.reduce((s, e) => s + fyBudget(e, 'netto_omzet'), 0))}</strong></div>
          <div style={{ marginTop: 2 }}>Totaal EBITDA: <strong style={{ color: 'var(--green)' }}>{fmt(ENTITIES.reduce((s, e) => s + fyBudget(e, 'ebitda'), 0))}</strong></div>
        </div>
      </div>

      {/* Chart card — hoofdmetric selectie + BV/serie-filters */}
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">📈 Budget vs Latest Estimate — {CHART_METRICS.find(c => c.key === chartMetric)?.label}</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>Solid = Budget · Dashed = LE</span>
        </div>
        <div style={{ padding: '10px 14px 6px', display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid var(--bd)' }}>
          <span style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 700, alignSelf: 'center', textTransform: 'uppercase', letterSpacing: '.08em' }}>Metric:</span>
          {CHART_METRICS.map(c => (
            <button
              key={c.key}
              className={`btn sm${chartMetric === c.key ? ' primary' : ' ghost'}`}
              onClick={() => setChartMetric(c.key)}
              style={{ fontSize: 11 }}
            >{c.label}</button>
          ))}
        </div>
        <div style={{ padding: '8px 14px', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid var(--bd)' }}>
          <span style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>Filters:</span>

          {/* BV-filter chips */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {ENTITIES.map(e => {
              const active = chartBvs.has(e)
              return (
                <button
                  key={e}
                  onClick={() => setChartBvs(prev => {
                    const next = new Set(prev)
                    if (next.has(e)) next.delete(e); else next.add(e)
                    return next
                  })}
                  style={{
                    padding: '3px 10px', borderRadius: 5, fontSize: 11,
                    fontWeight: active ? 700 : 400, cursor: 'pointer',
                    border: '1px solid',
                    borderColor: active ? BV_COLORS[e] : 'var(--bd2)',
                    background: active ? BV_COLORS[e] + '22' : 'transparent',
                    color: active ? BV_COLORS[e] : 'var(--t3)',
                    fontFamily: 'var(--font)',
                  }}
                >
                  <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: BV_COLORS[e], marginRight: 5, verticalAlign: 'middle' }} />
                  {e}
                </button>
              )
            })}
          </div>

          {/* Serie-toggles */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginLeft: 'auto' }}>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={showBudget} onChange={e => setShowBudget(e.target.checked)} />
              Budget
            </label>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={showLe} onChange={e => setShowLe(e.target.checked)} />
              Latest Estimate
            </label>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={showTotal} onChange={e => setShowTotal(e.target.checked)} />
              Totaal (som) <span style={{ display: 'inline-block', width: 10, height: 2, background: '#fbbf24', marginLeft: 2, verticalAlign: 'middle' }} />
            </label>
          </div>
        </div>
        <div style={{ padding: 14, height: 340 }}>
          <Line data={chartData} options={baseChartOptions as any} />
        </div>
      </div>

      {/* Per-BV accordion + Totaal-accordion onderaan */}
      {[...activeEntities, 'Totaal' as const].map(scope => {
        const isTot   = scope === 'Totaal'
        const isOpen  = expandedBvs.has(scope)
        const color   = isTot ? '#fbbf24' : BV_COLORS[scope as EntityName]
        // FY-totalen voor de header
        const fyOmzet = isTot
          ? ENTITIES.reduce((s, e) => s + fyBudget(e, 'netto_omzet'), 0)
          : fyBudget(scope as EntityName, 'netto_omzet')
        const fyEbitdaB = isTot
          ? ENTITIES.reduce((s, e) => s + fyBudget(e, 'ebitda'), 0)
          : fyBudget(scope as EntityName, 'ebitda')
        const fyEbitdaL = isTot
          ? ENTITIES.reduce((s, e) => s + fyLe(e, 'ebitda'), 0)
          : fyLe(scope as EntityName, 'ebitda')

        // Value-lookups voor deze scope (BV of som over alle BVs)
        const bVal = (m: string, k: string) => isTot ? totalBudgetVal(m, k) : getBudgetVal(scope as EntityName, m, k)
        const lVal = (m: string, k: string) => isTot ? totalLeVal(m, k) : getLeVal(scope as EntityName, m, k)
        const lSrc = (m: string, k: string): 'override' | 'actual' | 'forecast' | 'derived' =>
          isTot
            ? (READONLY_KEYS.has(k) ? 'derived' : isClosedMonth(m) ? 'actual' : 'forecast')
            : getLeSource(scope as EntityName, m, k)

        // Actuals-lookup voor methodiek (alleen closed months)
        const aLookup = (m: string, k: string): number => {
          if (isTot) {
            return ENTITIES.reduce((s, e) => s + (getActualsFor(e, m)[k] ?? 0), 0)
          }
          return getActualsFor(scope as EntityName, m)[k] ?? 0
        }

        return (
          <div key={scope} className="card" style={{ borderLeft: `3px solid ${color}`, background: isTot ? 'linear-gradient(180deg, rgba(251,191,36,.04), transparent)' : undefined }}>
            <div
              className="card-hdr"
              style={{ cursor: 'pointer', userSelect: 'none' }}
              onClick={() => toggleBv(scope)}
              title={isOpen ? 'Klik om in te klappen' : 'Klik om uit te klappen'}
            >
              <span style={{ fontSize: 10, marginRight: 8, display: 'inline-block', transition: 'transform .2s', transform: isOpen ? 'rotate(90deg)' : 'none' }}>▶</span>
              <span className="card-title" style={{ color }}>{isTot ? '🏢 TOTAAL (alle BVs + Holdings)' : scope}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)', display: 'flex', gap: 14 }}>
                <span>FY omzet (B): <strong style={{ color }}>{fmt(fyOmzet)}</strong></span>
                <span>FY EBITDA (B): <strong style={{ color: fyEbitdaB >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(fyEbitdaB)}</strong></span>
                <span>FY EBITDA (LE): <strong style={{ color: fyEbitdaL >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(fyEbitdaL)}</strong></span>
              </span>
            </div>

            {isOpen && (
              <div>
                {/* ── Budget-tabel (Totaal = read-only som; BV = bewerkbaar) ── */}
                <div style={{ padding: '8px 14px 0', fontSize: 10, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                  Budget 2026
                  <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: 6, letterSpacing: 0 }}>
                    {isTot
                      ? '— som van alle BVs (read-only)'
                      : '— sub-regels zijn direct bewerkbaar; aggregaten worden auto-afgeleid · klik ⎘ onder een maand om vorige maand te kopiëren'}
                  </span>
                </div>
                <div style={{ overflowX: 'auto', marginTop: 4 }}>
                  <table className="tbl" style={{ tableLayout: 'fixed', borderCollapse: 'collapse', width: TABLE_BASE_WIDTH }}>
                    <MonthTableColgroup />
                    <thead>
                      <tr>
                        <th style={{ position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 2 }}>P&L regel</th>
                        {months.map((m, mIdx) => (
                          <th key={m} className="r" style={{ padding: '4px 6px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                              <span>{m}</span>
                              {!isTot && mIdx > 0 && (
                                <button
                                  type="button"
                                  onClick={(ev) => {
                                    ev.stopPropagation()
                                    if (confirm(`Alle bewerkbare budget-waardes van ${months[mIdx - 1]} kopiëren naar ${m} voor ${scope}?`)) {
                                      copyPrevMonth(scope as EntityName, mIdx)
                                    }
                                  }}
                                  title={`Kopieer ${months[mIdx - 1]} → ${m}`}
                                  style={{
                                    background: 'var(--bg1)',
                                    border: '1px solid var(--bd2)',
                                    borderRadius: 3,
                                    padding: '1px 5px',
                                    fontSize: 10,
                                    cursor: 'pointer',
                                    color: 'var(--blue)',
                                    lineHeight: 1,
                                  }}
                                >⎘</button>
                              )}
                            </div>
                          </th>
                        ))}
                        <th className="r" style={{ borderLeft: '1px solid var(--bd2)', color: 'var(--brand)' }}>FY Totaal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plRows.map(item => renderRow(
                        `b-${scope}`,
                        item,
                        m => isTot
                          ? <span style={{ color: bVal(m, item.key) === 0 ? 'var(--t3)' : 'var(--t1)' }}>{bVal(m, item.key) === 0 ? '—' : fmt(bVal(m, item.key))}</span>
                          : renderBudgetCell(scope as EntityName, m, item.key),
                        () => months.reduce((s, m) => s + bVal(m, item.key), 0),
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* ── Latest Estimate-tabel — read-only met methodiek-kolom ── */}
                <div style={{ padding: '14px 14px 0', fontSize: 10, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                  Latest Estimate 2026
                  <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: 6, letterSpacing: 0 }}>
                    — automatisch afgeleid · t/m {lastClosedMonth ?? '—'} = actuals, rest = forecast · niet bewerkbaar
                  </span>
                </div>
                <div style={{ padding: '4px 14px', fontSize: 10, color: 'var(--t3)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'rgba(0,169,224,.2)', border: '1px solid var(--brand)', marginRight: 4, verticalAlign: 'middle' }} /> actual (Maandafsluiting/OHW)</span>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'rgba(245,158,11,.15)', border: '1px solid var(--amber)', marginRight: 4, verticalAlign: 'middle' }} /> forecast (60% seizoen + 40% run-rate × FTE)</span>
                </div>
                <div style={{ overflowX: 'auto', marginTop: 4 }}>
                  <table className="tbl" style={{ tableLayout: 'fixed', borderCollapse: 'collapse', width: TABLE_LE_WIDTH }}>
                    <MonthTableColgroup hasMethodiek />
                    <thead>
                      <tr>
                        <th style={{ position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 2 }}>P&L regel</th>
                        {months.map(m => (
                          <th key={m} className="r">{m}</th>
                        ))}
                        <th className="r" style={{ borderLeft: '1px solid var(--bd2)', color: 'var(--brand)' }}>FY LE</th>
                        <th style={{ borderLeft: '1px solid var(--bd2)' }}>Methodiek / redenering</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plRows.map(item => renderRow(
                        `le-${scope}`,
                        item,
                        m => renderLeCell(lVal(m, item.key), lSrc(m, item.key)),
                        () => months.reduce((s, m) => s + lVal(m, item.key), 0),
                        methodiekText(lVal, aLookup, item.key),
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Vergelijking vorig jaar — alle P&L regels, met LE */}
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">📋 Vergelijking vorig jaar — alle P&L regels</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ minWidth: 'max-content' }}>
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>Regel</th>
                <th className="r">Budget 2025</th>
                <th className="r">Actuals 2025</th>
                <th className="r">Budget 2026 (FY)</th>
                <th className="r">LE 2026 (FY)</th>
                <th className="r">Δ Budget vs Act 2025</th>
                <th className="r">Δ LE vs Act 2025</th>
                <th className="r">Δ LE vs Budget 2026</th>
              </tr>
            </thead>
            <tbody>
              {plRows.map(item => {
                const b25 = activeEntities.reduce((s, e) => s + (ytdBudget2025[e]?.[item.key] ?? 0), 0)
                const a25 = activeEntities.reduce((s, e) => s + (ytdActuals2025[e]?.[item.key] ?? 0), 0)
                const b26 = activeEntities.reduce((s, e) => s + months.reduce((ss, m) => ss + getBudgetVal(e, m, item.key), 0), 0)
                const le26 = activeEntities.reduce((s, e) => s + months.reduce((ss, m) => ss + getLeVal(e, m, item.key), 0), 0)
                const dBudgetVs25 = b26 - a25
                const dLeVs25     = le26 - a25
                const dLeVsBudget = le26 - b26
                const clr = (d: number) => d === 0 ? 'var(--t3)' : d > 0 ? 'var(--green)' : 'var(--red)'
                const fmtDelta = (d: number) => d === 0 ? '—' : (d > 0 ? '+' : '') + fmt(d)
                return (
                  <tr key={item.key} style={{ background: item.isBold ? 'var(--bg3)' : undefined }}>
                    <td style={{
                      paddingLeft: 12 + (item.indent ?? 0) * 14,
                      fontWeight: item.isBold ? 700 : 400,
                    }}>{item.label}</td>
                    <td className="r mono" style={{ color: 'var(--t3)' }}>{fmt(b25)}</td>
                    <td className="r mono">{fmt(a25)}</td>
                    <td className="r mono" style={{ color: 'var(--brand)', fontWeight: 600 }}>{fmt(b26)}</td>
                    <td className="r mono" style={{ color: 'var(--amber)', fontWeight: 600 }}>{fmt(le26)}</td>
                    <td className="r mono" style={{ color: clr(dBudgetVs25) }}>{fmtDelta(dBudgetVs25)}</td>
                    <td className="r mono" style={{ color: clr(dLeVs25) }}>{fmtDelta(dLeVs25)}</td>
                    <td className="r mono" style={{ color: clr(dLeVsBudget) }}>{fmtDelta(dLeVsBudget)}</td>
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
