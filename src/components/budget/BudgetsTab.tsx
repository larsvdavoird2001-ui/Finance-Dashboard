import { useState, useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import '../../lib/chartSetup'
import { baseChartOptions } from '../../lib/chartSetup'
import { PL_STRUCTURE, ytdActuals2025, ytdBudget2025 } from '../../data/plData'
import type { EntityName } from '../../data/plData'
import { useLockedBv } from '../../lib/permissions'
import { useBudgetStore, BUDGET_MONTHS_2026 } from '../../store/useBudgetStore'
import { useFteStore } from '../../store/useFteStore'
import { useFinStore } from '../../store/useFinStore'
import { useHoursStore } from '../../store/useHoursStore'
import { useAdjustedActuals } from '../../hooks/useAdjustedActuals'
import { useLatestEstimate } from '../../hooks/useLatestEstimate'
import { fmt, parseNL } from '../../lib/format'
import type { BvId, GlobalFilter } from '../../data/types'
import { SUBS_OF, DERIVED_FORMULA, AGGREGATE_KEYS, DERIVED_KEYS, READONLY_KEYS } from '../../lib/plDerive'
import { BudgetsFteSubtab } from './BudgetsFteSubtab'

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

// (NumberInput is verhuisd naar BudgetsFteSubtab.tsx — daar woont nu de FTE-flow.)

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

// Kost-metrics worden in de tabellen met minteken getoond (P&L-conventie),
// maar in de grafiek geflipt naar positief — een hogere lijn betekent dan
// hogere kosten, wat intuïtiever leest dan "hoe lager hoe duurder".
const CHART_COST_METRICS = new Set(['directe_kosten', 'operationele_kosten', 'amortisatie_afschrijvingen'])
const chartSign = (key: string, v: number): number =>
  CHART_COST_METRICS.has(key) ? Math.abs(v) : v

// ── FTE / Capaciteit-budget keys ────────────────────────────────────────────
// Capaciteit-% (productief/verlof/improductief/ziek) wordt per BV per maand
// opgeslagen in useBudgetStore.overrides via deze pseudo-keys. Hiermee delen
// we het bestaande budget_overrides DB-schema (key/value) zonder een migratie
// nodig te hebben. FTE-budget zelf staat in useFteStore (eigen tabel).
const CAPACITY_KEYS = [
  { key: 'capacity_productive_pct',     label: 'Productief %',   color: 'var(--green)' },
  { key: 'capacity_leave_pct',          label: 'Verlof %',       color: 'var(--blue)'  },
  { key: 'capacity_nonproductive_pct',  label: 'Improductief %', color: 'var(--amber)' },
  { key: 'capacity_sick_pct',           label: 'Ziek %',         color: 'var(--red)'   },
] as const

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

// ── BV-filterbalk bovenin de Budgetten-tab (verhuisd vanuit de Topbar) ──
const BUDGETS_BV_COLORS: Record<string, string> = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
  Holdings:    '#8fa3c0',
}
const BUDGETS_BV_OPTIONS: Array<{ id: GlobalFilter['bv']; label: string; sub?: string }> = [
  { id: 'all',         label: 'Alle BV\'s' },
  { id: 'Consultancy', label: 'Consultancy' },
  { id: 'Projects',    label: 'Projects' },
  { id: 'Software',    label: 'Software' },
  { id: 'Holdings',    label: 'Holdings', sub: 'kosten' },
]
function BudgetsFilterBar({
  filter,
  onFilterChange,
}: {
  filter: GlobalFilter
  onFilterChange: (patch: Partial<GlobalFilter>) => void
}) {
  const lockedBv = useLockedBv()
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', marginBottom: 4 }}>
      <span style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', marginRight: 2 }}>BV:</span>
      {lockedBv ? (
        <span
          title={`Je account is gekoppeld aan ${lockedBv} — je ziet alleen data van deze BV.`}
          style={{
            padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
            border: `1px solid ${BUDGETS_BV_COLORS[lockedBv]}`,
            background: BUDGETS_BV_COLORS[lockedBv] + '22',
            color: BUDGETS_BV_COLORS[lockedBv],
            display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font)',
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: BUDGETS_BV_COLORS[lockedBv], display: 'inline-block', flexShrink: 0 }} />
          {lockedBv}
          <span style={{ fontSize: 9, marginLeft: 2, opacity: 0.7 }}>🔒</span>
        </span>
      ) : (
        <>
          {BUDGETS_BV_OPTIONS.map(o => {
            const isActive = filter.bv === o.id
            const color = o.id !== 'all' ? BUDGETS_BV_COLORS[o.id] : undefined
            return (
              <button
                key={o.id}
                onClick={() => onFilterChange({ bv: o.id })}
                style={{
                  padding: '3px 10px', borderRadius: 5, fontSize: 11,
                  fontWeight: isActive ? 600 : 500, cursor: 'pointer',
                  border: '1px solid', fontFamily: 'var(--font)', transition: 'all .12s',
                  borderColor: isActive ? (color ?? 'rgba(255,255,255,0.25)') : 'var(--bd2)',
                  background: isActive ? (color ? color + '22' : 'var(--bg4)') : 'transparent',
                  color: isActive ? (color ?? 'var(--t1)') : 'var(--t3)',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                {color && (
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: isActive ? color : 'var(--t3)', display: 'inline-block', flexShrink: 0 }} />
                )}
                {o.label}
                {o.sub && (
                  <span style={{ fontSize: 9, color: isActive ? color : 'var(--t3)', opacity: 0.75, marginLeft: 2 }}>({o.sub})</span>
                )}
              </button>
            )
          })}
          {filter.bv !== 'all' && (
            <button
              style={{
                padding: '3px 7px', borderRadius: 5, fontSize: 10, cursor: 'pointer',
                border: '1px solid var(--bd2)', background: 'transparent',
                color: 'var(--t3)', fontFamily: 'var(--font)', marginLeft: 2,
              }}
              onClick={() => onFilterChange({ bv: 'all' })}
              title="Reset BV-filter"
            >✕ Reset</button>
          )}
        </>
      )}
    </div>
  )
}

interface Props {
  filter: GlobalFilter
  onFilterChange?: (patch: Partial<GlobalFilter>) => void
}

export function BudgetsTab({ filter, onFilterChange }: Props) {
  // BV-locked users zien alleen hun eigen BV in de Budgetten-matrix.
  // Voor admins: alle entiteiten.
  const _lockedBv = useLockedBv()
  const store = useBudgetStore()
  const fteGetEntry = useFteStore(s => s.getEntry)
  const fteUpsert   = useFteStore(s => s.upsertEntry)
  const { getMonthly } = useAdjustedActuals()
  // Maandafsluiting-status: een maand telt pas als 'closed' zodra hij
  // definitief is afgesloten in de Maandafsluiting-tab.
  const finalizedMonths = useFinStore(s => s.finalized)
  // Driver-based LE-engine — vervangt alle eigen forecast-helpers die hier
  // voorheen woonden. `le.getLE` is de single source of truth voor LE-cijfers
  // (driver-based rolling forecast met variance-bridge en reflectie-overlay).
  const le = useLatestEstimate()

  const months = BUDGET_MONTHS_2026
  // BV-scope: hard-locked door user-profiel wint, anders gebruikt het tab-
  // filter (zelfde knoppen die voorheen in de Topbar stonden).
  const activeEntities: EntityName[] = _lockedBv
    ? (ENTITIES.includes(_lockedBv as EntityName) ? [_lockedBv as EntityName] : [])
    : (filter.bv === 'all'
        ? ENTITIES
        : (ENTITIES.includes(filter.bv as EntityName) ? [filter.bv as EntityName] : ENTITIES))
  // Toon "Totaal alle BVs"-aggregaten alleen voor users zonder BV-restrictie
  // en alleen wanneer de filter daadwerkelijk alle BVs toont. Op een
  // single-BV-selectie heeft Totaal geen toegevoegde waarde.
  const showTotalScope = !_lockedBv && filter.bv === 'all'

  // Subtab: financieel (P&L budget+LE) vs FTE & Headcount (FTE-budget + capaciteit
  // per BV per vertical). De FTE-subtab leeft in een eigen component zodat de
  // P&L-flow (chart, accordion, comparison) niet verandert.
  const [subTab, setSubTab] = useState<'financieel' | 'fte'>('financieel')
  const [chartMetric,  setChartMetric]  = useState<string>('netto_omzet')
  const [expandedBvs,  setExpandedBvs]  = useState<Set<EntityName | 'Totaal'>>(
    new Set([activeEntities[0] ?? 'Consultancy'] as Array<EntityName | 'Totaal'>)
  )
  // Chart-filters: welke BVs tonen + welke series (budget / LE)
  const [chartBvs,     setChartBvs]     = useState<Set<EntityName>>(new Set(activeEntities))
  const [showBudget,   setShowBudget]   = useState<boolean>(true)
  const [showLe,       setShowLe]       = useState<boolean>(true)
  const [showTotal,    setShowTotal]    = useState<boolean>(false)

  // ── Closed-detectie: STRIKT alleen wanneer Maandafsluiting definitief is ──
  // Imports/handmatige actuals voor April promoveren de maand NIET naar
  // closed-status; dat gebeurt pas zodra de gebruiker in de Maandafsluiting-
  // tab op "Definitief afsluiten" klikt. Zo blijven de LE-trendlijnen zichtbaar
  // (gestreept) en wordt de Budget vs Actuals-tabel pas op actuals teruggevuld
  // ná die finalize-stap. Q1-historie (Jan/Feb) is via useFinStore eenmalig
  // auto-geseed als finalized zodat die actuals niet als forecast renderen.
  const finalizedSet = useMemo(() => new Set(finalizedMonths.map(f => f.month)), [finalizedMonths])
  const isClosedMonth = (m: string): boolean => finalizedSet.has(m)
  const closedMonths = months.filter(isClosedMonth)
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

  // FTE-helpers (getPlannedFte / rampFactor) zijn verhuisd naar de centrale
  // driver-engine in src/lib/leDrivers.ts en src/lib/fteLe.ts. BudgetsTab
  // consumeert de uitkomst rechtstreeks via `le.getLE` — geen lokale forecast-
  // berekeningen meer.

  // ── LE-waarde (delegeert naar driver-engine in useLatestEstimate) ──
  // Single source of truth voor zowel BudgetsTab (deze) als DashboardTab,
  // BudgetTab en MaandChecklist. Geen lokale forecast-berekeningen meer.
  const getLeVal = (e: EntityName, m: string, k: string): number =>
    le.getLE(e, m, k)
  const getLeSource = (e: EntityName, m: string, k: string): 'override' | 'actual' | 'forecast' | 'derived' | 'budget' => {
    const src = le.getLeSource(e, m, k)
    // Compat: BudgetsTab kende ook een 'budget'-state (forecast=0 én budget≠0).
    // De driver-engine valt sowieso terug op budget wanneer er geen
    // historische basis is, dus we hoeven hier alleen het verschil te tonen
    // tussen "echte forecast" en "geen signaal — toon budget" als visuele cue.
    if (src === 'forecast' && rawBudget(e, m, k) !== 0 && le.getLE(e, m, k) === rawBudget(e, m, k)) {
      return 'budget'
    }
    return src
  }

  // FTE-budget en capaciteit-% bewerken gebeurt nu in de subtab
  // BudgetsFteSubtab. De helpers/getters daarvoor leven daar zelfstandig.
  // copyPrevMonth gebruikt hieronder fteGetEntry/fteUpsert direct.

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
    // Kopieer ook capaciteit-% naar de nieuwe maand
    for (const cap of CAPACITY_KEYS) {
      const v = store.overrides[e]?.[prev]?.[cap.key]
      if (v != null) store.setValue(e, cur, cap.key, v)
    }
    // En FTE-budget (alleen voor productie-BVs)
    if (e !== 'Holdings') {
      const v = fteGetEntry(e as BvId, prev)?.fteBudget
      if (v != null) fteUpsert(e as BvId, cur, { fteBudget: v })
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
          data: months.map(m => chartSign(chartMetric, getBudgetVal(e, m, chartMetric))),
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
          data: months.map(m => chartSign(chartMetric, getLeVal(e, m, chartMetric))),
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
          data: months.map(m => chartSign(chartMetric, bvs.reduce((s, e) => s + getBudgetVal(e, m, chartMetric), 0))),
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
          data: months.map(m => chartSign(chartMetric, bvs.reduce((s, e) => s + getLeVal(e, m, chartMetric), 0))),
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
  }, [chartMetric, chartBvs, showBudget, showLe, showTotal, store.overrides, store.leOverrides, finalizedMonths, useFteStore(s => s.entries), useHoursStore(s => s.entries)])

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
  const renderLeCell = (val: number, src: 'override' | 'actual' | 'forecast' | 'derived' | 'budget') => {
    const color =
      val === 0         ? 'var(--t3)' :
      src === 'derived' ? 'var(--brand)' :
      src === 'actual'  ? 'var(--brand)' :
      src === 'override'? 'var(--green)' :
      src === 'budget'  ? 'var(--blue)' :
      'var(--amber)' // forecast
    const fontStyle = src === 'forecast' ? 'italic' : 'normal'
    const bg =
      src === 'actual'   ? 'rgba(0,169,224,.06)' :
      src === 'override' ? 'rgba(38,201,151,.06)' :
      src === 'forecast' ? 'rgba(245,158,11,.05)' :
      src === 'budget'   ? 'rgba(59,130,246,.06)' :
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
          src === 'budget'   ? 'Geen historische driver-basis — terugval op ingegeven budget' :
                               'Driver-based forecast — rev/FTE × FTE (omzet) / cost-to-revenue ratio of run-rate per FTE (kosten), 50/50 geblendt met het ingegeven budget zodat budget-aanpassingen evenredig doorwerken'
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
      {/* Tab-scope filter (verhuisd vanuit Topbar). Year staat hier niet
          omdat de Budgetten-matrix 2026-only is. */}
      {onFilterChange && (
        <BudgetsFilterBar filter={filter} onFilterChange={onFilterChange} />
      )}

      {/* Subtab switcher: Financieel | FTE */}
      <div className="card" style={{ overflow: 'visible' }}>
        <div style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Onderdeel:</span>
          <div className="tabs-row">
            <button className={`tab${subTab === 'financieel' ? ' active' : ''}`} onClick={() => setSubTab('financieel')}>
              Financieel — P&amp;L budget &amp; LE
            </button>
            <button className={`tab${subTab === 'fte' ? ' active' : ''}`} onClick={() => setSubTab('fte')}>
              FTE
            </button>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>
            {subTab === 'financieel'
              ? 'P&L per BV — bewerkbaar budget, auto-afgeleide LE.'
              : 'FTE-budget per BV en per vertical, capaciteits-% per BV.'}
          </span>
        </div>
      </div>

      {subTab === 'fte' && <BudgetsFteSubtab />}

      {subTab === 'financieel' && (
      <>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>FY 2026 · Budget & Latest Estimate</div>
          <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>
            Per BV uitklapbaar · alle P&L regels bewerkbaar · aggregaten (netto-omzet, directe kosten, brutomarge, EBITDA, EBIT) auto-afgeleid uit subposten
          </div>
        </div>
        {showTotalScope && (
          <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)', textAlign: 'right' }}>
            <div>Totaal netto-omzet: <strong style={{ color: 'var(--brand)' }}>{fmt(ENTITIES.reduce((s, e) => s + fyBudget(e, 'netto_omzet'), 0))}</strong></div>
            <div style={{ marginTop: 2 }}>Totaal EBITDA: <strong style={{ color: 'var(--green)' }}>{fmt(ENTITIES.reduce((s, e) => s + fyBudget(e, 'ebitda'), 0))}</strong></div>
          </div>
        )}
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

          {/* BV-filter chips — alleen de BVs waarvoor de user toegang heeft. */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {activeEntities.map(e => {
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
            {showTotalScope && (
              <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={showTotal} onChange={e => setShowTotal(e.target.checked)} />
                Totaal (som) <span style={{ display: 'inline-block', width: 10, height: 2, background: '#fbbf24', marginLeft: 2, verticalAlign: 'middle' }} />
              </label>
            )}
          </div>
        </div>
        <div style={{ padding: 14, height: 340 }}>
          <Line data={chartData} options={baseChartOptions as any} />
        </div>
      </div>

      {/* Per-BV accordion + Totaal-accordion onderaan (Totaal alleen voor users
          zonder BV-restrictie) */}
      {(showTotalScope ? [...activeEntities, 'Totaal' as const] : [...activeEntities]).map(scope => {
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
        const lSrc = (m: string, k: string): 'override' | 'actual' | 'forecast' | 'derived' | 'budget' =>
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

                {/* ── FTE & Capaciteit-budget — verhuisd naar de subtab
                    "FTE & Headcount" (zie BudgetsFteSubtab.tsx). ── */}

                {/* ── Latest Estimate-tabel — read-only met methodiek-kolom ── */}
                <div style={{ padding: '14px 14px 0', fontSize: 10, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                  Latest Estimate 2026
                  <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: 6, letterSpacing: 0 }}>
                    — automatisch afgeleid · t/m {lastClosedMonth ?? '—'} = actuals, rest = forecast · niet bewerkbaar
                  </span>
                </div>
                <div style={{ padding: '4px 14px', fontSize: 10, color: 'var(--t3)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'rgba(0,169,224,.2)', border: '1px solid var(--brand)', marginRight: 4, verticalAlign: 'middle' }} /> actual (Maandafsluiting/OHW)</span>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'rgba(245,158,11,.15)', border: '1px solid var(--amber)', marginRight: 4, verticalAlign: 'middle' }} /> forecast (driver-based blended 50/50 met budget)</span>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'rgba(59,130,246,.15)', border: '1px solid var(--blue)', marginRight: 4, verticalAlign: 'middle' }} /> budget (geen forecast-signaal — terugval op ingegeven budget)</span>
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
      </>
      )}
    </div>
  )
}
