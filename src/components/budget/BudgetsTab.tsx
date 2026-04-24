import { useState, useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import '../../lib/chartSetup'
import { baseChartOptions } from '../../lib/chartSetup'
import { PL_STRUCTURE, ytdActuals2025, ytdBudget2025, monthlyActuals2026 } from '../../data/plData'
import type { EntityName } from '../../data/plData'
import { monthlyActuals2025, MONTHS_2025_LABELS } from '../../data/plData2025'
import { useBudgetStore, BUDGET_MONTHS_2026 } from '../../store/useBudgetStore'
import { useFteStore } from '../../store/useFteStore'
import { useAdjustedActuals } from '../../hooks/useAdjustedActuals'
import { fmt, parseNL } from '../../lib/format'
import type { BvId, GlobalFilter } from '../../data/types'

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

// Aggregate keys worden automatisch berekend als som van deze sub-keys.
// Die subs staan in PL_STRUCTURE als indent=1.
const SUBS_OF: Record<string, string[]> = {
  netto_omzet:                ['gefactureerde_omzet', 'omzet_periode_allocatie'],
  directe_kosten:             ['directe_inkoopkosten', 'directe_personeelskosten', 'directe_overige_personeelskosten', 'directe_autokosten'],
  operationele_kosten:        ['indirecte_personeelskosten', 'overige_personeelskosten', 'huisvestingskosten', 'automatiseringskosten', 'indirecte_autokosten', 'verkoopkosten', 'algemene_kosten', 'doorbelaste_kosten'],
  amortisatie_afschrijvingen: ['amortisatie_goodwill', 'amortisatie_software', 'afschrijvingen'],
}

// Derived keys: berekend uit andere aggregate/flat keys (niet uit subs).
const DERIVED_FORMULA: Record<string, (v: (k: string) => number) => number> = {
  brutomarge:      v => v('netto_omzet') + v('directe_kosten'),
  ebitda:          v => v('brutomarge') + v('operationele_kosten'),
  ebit:            v => v('ebitda') + v('amortisatie_afschrijvingen'),
  netto_resultaat: v => v('ebit') + v('financieel_resultaat') + v('vennootschapsbelasting'),
}

const AGGREGATE_KEYS = new Set(Object.keys(SUBS_OF))
const DERIVED_KEYS   = new Set(Object.keys(DERIVED_FORMULA))
const READONLY_KEYS  = new Set([...AGGREGATE_KEYS, ...DERIVED_KEYS])

interface Props { filter: GlobalFilter }

type EditTarget = { kind: 'budget' | 'le'; e: EntityName; m: string; k: string }

export function BudgetsTab({ filter: _filter }: Props) {
  const store = useBudgetStore()
  const fteGetEntry = useFteStore(s => s.getEntry)
  // Trigger re-render bij FTE wijzigingen
  useFteStore(s => s.entries)
  const { getMonthly } = useAdjustedActuals()

  const [chartMetric,  setChartMetric]  = useState<string>('netto_omzet')
  const [expandedBvs,  setExpandedBvs]  = useState<Set<EntityName>>(new Set(['Consultancy']))
  const [editing,      setEditing]      = useState<EditTarget | null>(null)
  const [rawInput,     setRawInput]     = useState('')

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
  const getActualsFor = (e: EntityName, m: string): Record<string, number> => {
    if (e === 'Holdings') return monthlyActuals2026['Holdings']?.[m] ?? {}
    return getMonthly(e as BvId, m)
  }

  // ── Forecast voor toekomstige maanden ──
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
      const fteLast   = fteGetEntry(e as BvId, lastClosedMonth)?.fte ?? 0
      const fteFuture = fteGetEntry(e as BvId, m)?.fte ?? fteLast
      if (fteLast > 0) fteAdj = fteFuture / fteLast
    }
    const seasonalForecast = sameMonth2025 * perfMult * fteAdj
    const runRateForecast  = lastActual * fteAdj
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

  // ── Edit handlers ──
  const startEdit = (kind: 'budget' | 'le', e: EntityName, m: string, k: string) => {
    if (READONLY_KEYS.has(k)) return
    const cur = kind === 'budget' ? rawBudget(e, m, k) : rawLeVal(e, m, k)
    setRawInput(cur === 0 ? '' : String(cur))
    setEditing({ kind, e, m, k })
  }
  const commitEdit = () => {
    if (!editing) return
    const parsed = parseNL(rawInput)
    const v = isNaN(parsed) ? 0 : parsed
    if (editing.kind === 'budget') {
      store.setValue(editing.e, editing.m, editing.k, v)
    } else {
      store.setLeValue(editing.e, editing.m, editing.k, v)
    }
    setEditing(null)
  }
  const cancelEdit = () => setEditing(null)

  // ── BV accordion toggle ──
  const toggleBv = (e: EntityName) => {
    setExpandedBvs(prev => {
      const next = new Set(prev)
      if (next.has(e)) next.delete(e); else next.add(e)
      return next
    })
  }

  // FY helper
  const fyBudget = (e: EntityName, k: string) => months.reduce((s, m) => s + getBudgetVal(e, m, k), 0)
  const fyLe     = (e: EntityName, k: string) => months.reduce((s, m) => s + getLeVal(e, m, k), 0)

  // ── Chart: budget (solid) + LE (dashed) per BV ──
  const chartData = useMemo(() => ({
    labels: months,
    datasets: [
      ...activeEntities.map(e => ({
        label: `${e} — Budget`,
        data: months.map(m => getBudgetVal(e, m, chartMetric)),
        borderColor: BV_COLORS[e],
        backgroundColor: BV_COLORS[e] + '22',
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 3,
        fill: false,
      })),
      ...activeEntities.map(e => ({
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
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [chartMetric, store.overrides, store.leOverrides])

  // ── Renderers voor cellen ──
  const renderBudgetCell = (e: EntityName, m: string, k: string) => {
    const val = getBudgetVal(e, m, k)
    const isEditing = editing?.kind === 'budget' && editing.e === e && editing.m === m && editing.k === k
    const readOnly = READONLY_KEYS.has(k)
    const hasOv = !readOnly && store.overrides[e]?.[m]?.[k] !== undefined

    if (isEditing) {
      return (
        <input
          autoFocus
          value={rawInput}
          onChange={ev => setRawInput(ev.target.value)}
          onBlur={commitEdit}
          onKeyDown={ev => { if (ev.key === 'Enter') commitEdit(); else if (ev.key === 'Escape') cancelEdit() }}
          className="ohw-inp"
          style={{ width: 85, fontSize: 11, padding: '2px 5px' }}
        />
      )
    }
    const color =
      val === 0 ? 'var(--t3)' :
      readOnly  ? 'var(--brand)' :
      hasOv     ? 'var(--green)' : 'var(--t1)'
    return (
      <span
        style={{ color, cursor: readOnly ? 'default' : 'pointer', fontWeight: readOnly ? 700 : 400 }}
        onClick={readOnly ? undefined : () => startEdit('budget', e, m, k)}
        title={readOnly ? 'Auto-afgeleid' : 'Klik om te bewerken'}
      >
        {val === 0 ? '—' : fmt(val)}
      </span>
    )
  }

  const renderLeCell = (e: EntityName, m: string, k: string) => {
    const val = getLeVal(e, m, k)
    const isEditing = editing?.kind === 'le' && editing.e === e && editing.m === m && editing.k === k
    const readOnly = READONLY_KEYS.has(k)
    const src = getLeSource(e, m, k)
    if (isEditing) {
      return (
        <input
          autoFocus
          value={rawInput}
          onChange={ev => setRawInput(ev.target.value)}
          onBlur={commitEdit}
          onKeyDown={ev => { if (ev.key === 'Enter') commitEdit(); else if (ev.key === 'Escape') cancelEdit() }}
          className="ohw-inp"
          style={{ width: 85, fontSize: 11, padding: '2px 5px' }}
        />
      )
    }
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
        style={{ color, cursor: readOnly ? 'default' : 'pointer', fontWeight: src === 'actual' ? 700 : src === 'derived' ? 700 : 500, fontStyle, background: bg, padding: '1px 4px', borderRadius: 2 }}
        onClick={readOnly ? undefined : () => startEdit('le', e, m, k)}
        title={readOnly ? 'Auto-afgeleid' :
               src === 'actual'   ? 'Werkelijk' :
               src === 'override' ? 'Handmatig' :
                                    'Forecast (2025 pattern × perf × FTE × run-rate)'}
      >
        {val === 0 ? '—' : fmt(val)}
      </span>
    )
  }

  // Helper: rij-node opbouwen voor 1 P&L-regel (hergebruikt in Budget en LE tabel)
  const renderRow = (
    e: EntityName,
    item: typeof PL_STRUCTURE[number],
    cellRenderer: (m: string) => React.ReactNode,
    getTotal: () => number,
  ) => {
    const readOnly = READONLY_KEYS.has(item.key)
    const total = getTotal()
    return (
      <tr key={`${e}-${item.key}`} style={{ background: item.isBold ? 'var(--bg3)' : undefined }}>
        <td style={{
          position: 'sticky', left: 0, zIndex: 1,
          background: item.isBold ? 'var(--bg3)' : 'var(--bg2)',
          paddingLeft: 12 + (item.indent ?? 0) * 14,
          padding: '4px 12px',
          fontWeight: item.isBold ? 700 : 400,
          color: readOnly ? 'var(--brand)' : 'var(--t1)',
          minWidth: 220,
          fontSize: item.isBold ? 12 : 11,
        }}>
          {item.label}
          {readOnly && <span style={{ fontSize: 9, color: 'var(--t3)', marginLeft: 6, fontWeight: 400 }}>auto</span>}
        </td>
        {months.map(m => (
          <td key={m} className="r mono" style={{ padding: '3px 6px', fontSize: 11 }}>
            {cellRenderer(m)}
          </td>
        ))}
        <td className="r mono" style={{
          fontWeight: 700,
          color: 'var(--brand)',
          borderLeft: '1px solid var(--bd2)',
          padding: '3px 6px',
          fontSize: 11,
        }}>
          {total === 0 ? '—' : fmt(total)}
        </td>
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

      {/* Chart card — alleen voor hoofdmetrics */}
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">📈 Budget vs Latest Estimate — {CHART_METRICS.find(c => c.key === chartMetric)?.label}</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>Solid = Budget · Dashed = LE</span>
        </div>
        <div style={{ padding: '10px 14px 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CHART_METRICS.map(c => (
            <button
              key={c.key}
              className={`btn sm${chartMetric === c.key ? ' primary' : ' ghost'}`}
              onClick={() => setChartMetric(c.key)}
              style={{ fontSize: 11 }}
            >{c.label}</button>
          ))}
        </div>
        <div style={{ padding: 14, height: 320 }}>
          <Line data={chartData} options={baseChartOptions as any} />
        </div>
      </div>

      {/* Per-BV accordion */}
      {activeEntities.map(e => {
        const isOpen   = expandedBvs.has(e)
        const fyOmzet  = fyBudget(e, 'netto_omzet')
        const fyEbitdaB = fyBudget(e, 'ebitda')
        const fyEbitdaL = fyLe(e, 'ebitda')
        return (
          <div key={e} className="card" style={{ borderLeft: `3px solid ${BV_COLORS[e]}` }}>
            <div
              className="card-hdr"
              style={{ cursor: 'pointer', userSelect: 'none' }}
              onClick={() => toggleBv(e)}
              title={isOpen ? 'Klik om in te klappen' : 'Klik om budget + LE voor deze BV uit te klappen'}
            >
              <span style={{ fontSize: 10, marginRight: 8, display: 'inline-block', transition: 'transform .2s', transform: isOpen ? 'rotate(90deg)' : 'none' }}>▶</span>
              <span className="card-title" style={{ color: BV_COLORS[e] }}>{e}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)', display: 'flex', gap: 14 }}>
                <span>FY omzet (B): <strong style={{ color: BV_COLORS[e] }}>{fmt(fyOmzet)}</strong></span>
                <span>FY EBITDA (B): <strong style={{ color: fyEbitdaB >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(fyEbitdaB)}</strong></span>
                <span>FY EBITDA (LE): <strong style={{ color: fyEbitdaL >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(fyEbitdaL)}</strong></span>
              </span>
            </div>

            {isOpen && (
              <div>
                {/* ── Budget-tabel ── */}
                <div style={{ padding: '8px 14px 0', fontSize: 10, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                  Budget 2026 — klik op cel om te bewerken
                </div>
                <div style={{ overflowX: 'auto', marginTop: 4 }}>
                  <table className="tbl" style={{ minWidth: 'max-content' }}>
                    <thead>
                      <tr>
                        <th style={{ position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 2, minWidth: 220 }}>P&L regel</th>
                        {months.map(m => (
                          <th key={m} className="r" style={{ minWidth: 92 }}>{m}</th>
                        ))}
                        <th className="r" style={{ borderLeft: '1px solid var(--bd2)', color: 'var(--brand)', minWidth: 110 }}>FY Totaal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plRows.map(item => renderRow(
                        e,
                        item,
                        m => renderBudgetCell(e, m, item.key),
                        () => months.reduce((s, m) => s + getBudgetVal(e, m, item.key), 0),
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* ── Latest Estimate-tabel ── */}
                <div style={{ padding: '14px 14px 0', fontSize: 10, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                  Latest Estimate 2026
                  <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: 6, letterSpacing: 0 }}>
                    — t/m {lastClosedMonth ?? '—'} = actuals, rest = forecast · klik cel om handmatig te overrulen
                  </span>
                </div>
                <div style={{ padding: '4px 14px', fontSize: 10, color: 'var(--t3)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'rgba(0,169,224,.2)', border: '1px solid var(--brand)', marginRight: 4, verticalAlign: 'middle' }} /> actual (hard)</span>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'rgba(245,158,11,.15)', border: '1px solid var(--amber)', marginRight: 4, verticalAlign: 'middle' }} /> forecast</span>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'rgba(38,201,151,.15)', border: '1px solid var(--green)', marginRight: 4, verticalAlign: 'middle' }} /> handmatig</span>
                </div>
                <div style={{ overflowX: 'auto', marginTop: 4 }}>
                  <table className="tbl" style={{ minWidth: 'max-content' }}>
                    <thead>
                      <tr>
                        <th style={{ position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 2, minWidth: 220 }}>P&L regel</th>
                        {months.map(m => (
                          <th key={m} className="r" style={{ minWidth: 92 }}>{m}</th>
                        ))}
                        <th className="r" style={{ borderLeft: '1px solid var(--bd2)', color: 'var(--brand)', minWidth: 110 }}>FY LE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plRows.map(item => renderRow(
                        e,
                        item,
                        m => renderLeCell(e, m, item.key),
                        () => months.reduce((s, m) => s + getLeVal(e, m, item.key), 0),
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
