import { useState, useMemo } from 'react'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import '../../lib/chartSetup'
import { baseChartOptions } from '../../lib/chartSetup'
import { PL_STRUCTURE, ytdBudget2026, ytdActuals2025, ytdBudget2025, monthlyActuals2026 } from '../../data/plData'
import type { EntityName } from '../../data/plData'
import { monthlyActuals2025, MONTHS_2025_LABELS } from '../../data/plData2025'
import { useBudgetStore, BUDGET_MONTHS_2026 } from '../../store/useBudgetStore'
import { useOhwStore } from '../../store/useOhwStore'
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

const DISPLAY_KEYS = [
  { key: 'netto_omzet',                label: 'Netto-omzet',          bold: true  },
  { key: 'directe_kosten',             label: 'Directe kosten',       bold: false, sign: -1 },
  { key: 'brutomarge',                 label: 'Brutomarge',           bold: true  },
  { key: 'operationele_kosten',        label: 'Operationele kosten',  bold: false, sign: -1 },
  { key: 'ebitda',                     label: 'EBITDA',               bold: true  },
  { key: 'amortisatie_afschrijvingen', label: 'Amortisatie',          bold: false, sign: -1 },
  { key: 'ebit',                       label: 'EBIT',                 bold: true  },
]

interface Props { filter: GlobalFilter }

type EditTarget = { kind: 'budget' | 'le'; e: EntityName; m: string; k: string }

export function BudgetsTab({ filter: _filter }: Props) {
  const store = useBudgetStore()
  const ohwData2026 = useOhwStore(s => s.data2026)
  const { getMonthly } = useAdjustedActuals()
  const [metric, setMetric] = useState<string>('netto_omzet')
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [rawInput, setRawInput] = useState('')

  const months = BUDGET_MONTHS_2026
  // Budgetten tab toont altijd ALLE BV's — BV-filter is hier niet relevant.
  const activeEntities: EntityName[] = ENTITIES
  const activeBvs: BvId[] = ['Consultancy', 'Projects', 'Software']

  // Map Apr-26 → Apr-25 (voor seizoenspatroon vanuit vorig jaar)
  const toPY = (m: string): string => {
    const idx = BUDGET_MONTHS_2026.indexOf(m)
    return idx >= 0 ? MONTHS_2025_LABELS[idx] : m
  }

  // ── Effective budget lookup (source + overrides merged by store) ──
  const getVal = (e: EntityName, m: string, k: string): number => {
    const data = store.getMonth(e, m)
    return data[k] ?? 0
  }

  // ── Actuals-lookup: werkelijke cijfers voor gesloten/ingevulde maanden ──
  // BVs gebruiken useAdjustedActuals (OHW + FinStore + base); Holdings gebruikt base-actuals.
  const getActualsFor = (e: EntityName, m: string): Record<string, number> => {
    if (e === 'Holdings') return monthlyActuals2026['Holdings']?.[m] ?? {}
    return getMonthly(e as BvId, m)
  }

  // Heeft deze (BV, maand) echte actuals? (OHW gevuld OF base-actuals bestaat OF FinStore-entry)
  const hasActualsFor = (e: EntityName, m: string): boolean => {
    if (e === 'Holdings') {
      const base = monthlyActuals2026['Holdings']?.[m]
      return !!base && Object.keys(base).length > 0 && (Math.abs(base.netto_omzet ?? 0) > 0 || Math.abs(base.operationele_kosten ?? 0) > 0)
    }
    // BV: OHW heeft netto voor deze maand?
    const ohwEntity = ohwData2026.entities.find(ent => ent.entity === e)
    if (ohwEntity && ohwEntity.nettoOmzet[m] != null) return true
    // Base-actuals gevuld? (Jan/Feb hardcoded)
    const base = monthlyActuals2026[e]?.[m]
    if (base && Object.keys(base).length > 0 && (Math.abs(base.netto_omzet ?? 0) > 0)) return true
    return false
  }

  // LE-waarde voor een cel: override → actual (als maand gesloten is) → budget
  const getLeVal = (e: EntityName, m: string, k: string): number => {
    const ov = store.getLeOverride(e, m, k)
    if (ov != null) return ov
    if (hasActualsFor(e, m)) return getActualsFor(e, m)[k] ?? 0
    return getVal(e, m, k)
  }

  // Bron van de LE-waarde (voor styling)
  const getLeSource = (e: EntityName, m: string, k: string): 'override' | 'actual' | 'budget' => {
    if (store.getLeOverride(e, m, k) != null) return 'override'
    if (hasActualsFor(e, m)) return 'actual'
    return 'budget'
  }

  const metricItem = DISPLAY_KEYS.find(d => d.key === metric) ?? DISPLAY_KEYS[0]
  const sign = metricItem.sign ?? 1
  const display = (v: number) => v * sign  // cost rows: show as positive magnitudes in charts/tables

  // ── Totals per BV, per month, all-year ──
  const ytdPerBv: Record<string, number> = {}
  for (const e of activeEntities) {
    ytdPerBv[e] = months.reduce((s, m) => s + getVal(e, m, metric), 0)
  }
  const ytdTotal = Object.values(ytdPerBv).reduce((a, b) => a + b, 0)

  // ── Chart 1: Budget over het jaar per BV (line) ──
  const lineData = useMemo(() => ({
    labels: months,
    datasets: activeEntities.map(e => ({
      label: e,
      data: months.map(m => display(getVal(e, m, metric))),
      borderColor: BV_COLORS[e],
      backgroundColor: BV_COLORS[e] + '22',
      borderWidth: 2,
      tension: 0.3,
      pointRadius: 3,
      fill: false,
    })),
  }), [activeEntities, metric, store.overrides])

  // ── Chart 2: Pie chart verdeling per BV (totaal jaar) ──
  const pieEntities = activeEntities.filter(e => Math.abs(ytdPerBv[e] ?? 0) > 0)
  const pieData = useMemo(() => ({
    labels: pieEntities,
    datasets: [{
      data: pieEntities.map(e => Math.abs(display(ytdPerBv[e] ?? 0))),
      backgroundColor: pieEntities.map(e => BV_COLORS[e]),
      borderColor: 'var(--bg1)',
      borderWidth: 2,
    }],
  }), [pieEntities.join(','), metric, ytdTotal])

  // ── Chart 3: vs vorig jaar (budget 2025, actuals 2025, budget 2026) ──
  const vsLastYear = useMemo(() => {
    const bvs = activeBvs as BvId[]
    const b25 = bvs.reduce((s, bv) => s + (ytdBudget2025[bv]?.[metric] ?? 0), 0)
    const a25 = bvs.reduce((s, bv) => s + (ytdActuals2025[bv]?.[metric] ?? 0), 0)
    const b26 = bvs.reduce((s, bv) => s + (ytdBudget2026[bv]?.[metric] ?? 0), 0)
    const b26Full = activeEntities.reduce((s, e) => s + months.reduce((ss, m) => ss + getVal(e, m, metric), 0), 0)
    return {
      labels: ['Budget 2025', 'Actuals 2025', 'Budget 2026 (Q1)', 'Budget 2026 (Full)'],
      datasets: [{
        label: metricItem.label,
        data: [b25, a25, b26, b26Full].map(v => v * sign),
        backgroundColor: ['#52657e', '#8fa3c0', BV_COLORS.Consultancy + 'aa', BV_COLORS.Consultancy],
      }],
    }
  }, [metric, activeEntities.join(','), store.overrides])

  // ── Source detection: Jan/Feb/Mar komen uit bron, maar zijn nu ook bewerkbaar ──
  const SOURCE_MONTHS = ['Jan-26', 'Feb-26', 'Mar-26']
  const isSource = (m: string) => SOURCE_MONTHS.includes(m)

  // ── Edit handlers ──
  const startEdit = (kind: 'budget' | 'le', e: EntityName, m: string, k: string) => {
    const cur = kind === 'budget' ? getVal(e, m, k) : getLeVal(e, m, k)
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

  // ── Auto-fill: gebruikt het seizoenspatroon van 2025 om maanden te vullen ──
  // Verdeelt de FY-target volgens de maandelijkse ratio's van 2025-actuals,
  // zodat rustige maanden (juli/augustus) niet hetzelfde krijgen als maart/mei.
  const autoFillRemaining = (e: EntityName) => {
    const fyActuals2025 = ytdActuals2025[e]?.[metric] ?? 0
    const fyBudget2025  = ytdBudget2025[e]?.[metric] ?? 0
    // Target: gebruik 2025 actuals als basis (werkelijk gedrag), anders 2025 budget
    const target = fyActuals2025 !== 0 ? fyActuals2025 : fyBudget2025
    if (target === 0) return

    // Bereken maandweight uit 2025 actuals (fallback naar gelijke verdeling als 0)
    const monthVals2025: Record<string, number> = {}
    let sumAbs = 0
    for (const m of months) {
      const v = monthlyActuals2025[e]?.[toPY(m)]?.[metric] ?? 0
      monthVals2025[m] = v
      sumAbs += Math.abs(v)
    }

    // Gedeelte van target al ingenomen door bron-maanden (Jan/Feb/Mar)
    const sourceFilled = months
      .filter(m => isSource(m))
      .reduce((s, m) => s + getVal(e, m, metric), 0)
    const remainingTarget = target - sourceFilled
    const remainingWeight = months
      .filter(m => !isSource(m))
      .reduce((s, m) => s + Math.abs(monthVals2025[m] ?? 0), 0)

    const empty = months.filter(m => !isSource(m) && !store.hasOverride(e, m))

    for (const m of empty) {
      const w2025 = monthVals2025[m] ?? 0
      let val: number
      if (remainingWeight > 0) {
        // Pro-rata met seizoenspatroon — behoud teken van 2025
        const ratio = Math.abs(w2025) / remainingWeight
        val = Math.round(remainingTarget * ratio * (w2025 < 0 ? -1 : 1))
      } else if (sumAbs > 0) {
        // Fallback: gebruik 2025 pattern zonder target scaling
        val = Math.round(w2025)
      } else {
        // Laatste fallback: uniforme verdeling (alleen als 2025 geheel 0 is)
        val = Math.round(remainingTarget / empty.length)
      }
      store.setValue(e, m, metric, val)
    }
  }

  const clearAllOverrides = (e: EntityName) => {
    if (!confirm(`Alle budget overrides wissen voor ${e}? (Jan–Mar terug naar bron, Apr–Dec leeg)`)) return
    for (const m of months) {
      store.clearMonth(e, m)
    }
  }

  // ── Latest Estimate: vul het hele jaar met hard snapshot ──
  // Gesloten maanden → actuals; toekomst → budget. Alles wordt vastgelegd als override
  // zodat het een echte LE-snapshot is, onafhankelijk van latere wijzigingen in bron.
  const autoFillLatestEstimate = (e: EntityName) => {
    for (const m of months) {
      const val = hasActualsFor(e, m)
        ? (getActualsFor(e, m)[metric] ?? 0)
        : getVal(e, m, metric)
      store.setLeValue(e, m, metric, val)
    }
  }

  const clearLatestEstimate = (e: EntityName) => {
    if (!confirm(`Latest Estimate overrides wissen voor ${e}? (terug naar auto-afgeleid)`)) return
    store.clearAllLe(e)
  }

  return (
    <div className="page">
      {/* Metric & tools */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>
          Regel:
        </span>
        {DISPLAY_KEYS.map(d => (
          <button
            key={d.key}
            className={`btn sm${metric === d.key ? ' primary' : ' ghost'}`}
            onClick={() => setMetric(d.key)}
          >{d.label}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)' }}>
          Jaar 2026 · FY Budget · <strong style={{ color: 'var(--brand)' }}>{fmt(ytdTotal * sign)}</strong>
        </span>
      </div>

      {/* Top KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {activeEntities.map(e => {
          const total = ytdPerBv[e] * sign
          const b25 = (ytdBudget2025[e as EntityName]?.[metric] ?? 0) * sign
          const delta = b25 !== 0 ? ((total - b25) / Math.abs(b25)) * 100 : 0
          return (
            <div key={e} className="card" style={{ padding: '12px 14px', borderLeft: `3px solid ${BV_COLORS[e]}` }}>
              <div style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>{e}</div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', marginTop: 4, color: BV_COLORS[e] }}>{fmt(total)}</div>
              <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
                vs 2025: {b25 !== 0 ? (
                  <span style={{ color: delta >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
                  </span>
                ) : '—'}
              </div>
            </div>
          )
        })}
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
        <div className="card">
          <div className="card-hdr"><span className="card-title">📈 {metricItem.label} — per maand per BV</span></div>
          <div style={{ padding: 14, height: 280 }}>
            <Line data={lineData} options={baseChartOptions as any} />
          </div>
        </div>
        <div className="card">
          <div className="card-hdr"><span className="card-title">🥧 Verdeling FY 2026</span></div>
          <div style={{ padding: 14, height: 280 }}>
            {pieEntities.length > 0
              ? <Doughnut data={pieData} options={{ ...baseChartOptions, scales: undefined } as any} />
              : <div style={{ color: 'var(--t3)', fontSize: 12, textAlign: 'center', marginTop: 80 }}>Nog geen data om te verdelen</div>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-hdr"><span className="card-title">📊 Vergelijking {metricItem.label} — 2025 vs 2026</span></div>
        <div style={{ padding: 14, height: 240 }}>
          <Bar data={vsLastYear} options={baseChartOptions as any} />
        </div>
      </div>

      {/* Full-year BUDGET matrix — elke cel bewerkbaar (ook Jan–Mar) */}
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">📅 Budget matrix — FY 2026</span>
          <span style={{ fontSize: 10, color: 'var(--t3)', marginLeft: 8 }}>
            {metricItem.label} · alle maanden bewerkbaar
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>Klik cel om te bewerken</span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ minWidth: 'max-content' }}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 2, minWidth: 180 }}>BV / Maand</th>
                {months.map(m => (
                  <th key={m} className="r" style={{ minWidth: 95 }}>{m}</th>
                ))}
                <th className="r" style={{ borderLeft: '1px solid var(--bd2)', color: 'var(--brand)', minWidth: 110 }}>FY Totaal</th>
                <th style={{ width: 70 }}></th>
              </tr>
            </thead>
            <tbody>
              {activeEntities.map(e => {
                const rowTotal = months.reduce((s, m) => s + getVal(e, m, metric), 0)
                return (
                  <tr key={e}>
                    <td style={{ position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 1, fontWeight: 600, color: BV_COLORS[e] }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: BV_COLORS[e], marginRight: 6 }} />
                      {e}
                    </td>
                    {months.map(m => {
                      const src = isSource(m)
                      const hasOv = store.hasOverride(e, m)
                      const val = getVal(e, m, metric) * sign
                      const isEditing = editing?.kind === 'budget' && editing.e === e && editing.m === m && editing.k === metric
                      return (
                        <td
                          key={m}
                          className="r mono"
                          style={{
                            padding: '4px 6px',
                            background: hasOv ? 'rgba(38,201,151,.06)' : src ? 'rgba(0,169,224,.04)' : undefined,
                            cursor: 'pointer',
                          }}
                          title={hasOv ? 'Handmatige override' : src ? 'Uit bron (bewerkbaar)' : 'Bewerkbaar'}
                          onClick={() => startEdit('budget', e, m, metric)}
                        >
                          {isEditing ? (
                            <input
                              autoFocus
                              value={rawInput}
                              onChange={ev => setRawInput(ev.target.value)}
                              onBlur={commitEdit}
                              onKeyDown={ev => { if (ev.key === 'Enter') commitEdit(); else if (ev.key === 'Escape') cancelEdit() }}
                              className="ohw-inp"
                              style={{ width: 80, fontSize: 11, padding: '2px 5px' }}
                            />
                          ) : (
                            <span style={{ color: val === 0 ? 'var(--t3)' : hasOv ? 'var(--green)' : 'var(--t1)' }}>
                              {val === 0 ? '—' : fmt(val)}
                            </span>
                          )}
                        </td>
                      )
                    })}
                    <td
                      className="r mono"
                      style={{ fontWeight: 700, color: 'var(--brand)', borderLeft: '1px solid var(--bd2)' }}
                    >
                      {fmt(rowTotal * sign)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 3 }}>
                        <button
                          className="btn sm ghost"
                          title="Vul lege maanden met pro-rata vanuit YTD 2025"
                          style={{ fontSize: 9, padding: '2px 4px' }}
                          onClick={() => autoFillRemaining(e)}
                        >⚡</button>
                        <button
                          className="btn sm ghost"
                          title="Wis alle overrides (terug naar bron)"
                          style={{ fontSize: 9, padding: '2px 4px', color: 'var(--red)' }}
                          onClick={() => clearAllOverrides(e)}
                        >✕</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              <tr className="tot">
                <td style={{ position: 'sticky', left: 0, background: 'var(--bg4)', zIndex: 1 }}>Totaal</td>
                {months.map(m => {
                  const total = activeEntities.reduce((s, e) => s + getVal(e, m, metric), 0) * sign
                  return <td key={m} className="r mono">{total === 0 ? '—' : fmt(total)}</td>
                })}
                <td className="r mono" style={{ color: 'var(--brand)', borderLeft: '1px solid var(--bd2)' }}>
                  {fmt(ytdTotal * sign)}
                </td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Full-year LATEST ESTIMATE matrix — actuals voor gesloten maanden + budget voor rest */}
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">🎯 Latest Estimate — FY 2026</span>
          <span style={{ fontSize: 10, color: 'var(--t3)', marginLeft: 8 }}>
            {metricItem.label} · gesloten maanden = actuals (hard), open maanden = budget
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>⚡ vult het hele jaar · klik cel om te bewerken</span>
        </div>

        <div style={{ padding: '8px 14px 0', display: 'flex', alignItems: 'center', gap: 12, fontSize: 10, color: 'var(--t3)', flexWrap: 'wrap' }}>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'rgba(0,169,224,.2)', border: '1px solid var(--brand)', marginRight: 4, verticalAlign: 'middle' }} /> actual (hard)</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'rgba(143,163,192,.15)', border: '1px solid var(--bd2)', marginRight: 4, verticalAlign: 'middle' }} /> budget (verwacht)</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'rgba(38,201,151,.15)', border: '1px solid var(--green)', marginRight: 4, verticalAlign: 'middle' }} /> handmatig aangepast</span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ minWidth: 'max-content' }}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 2, minWidth: 180 }}>BV / Maand</th>
                {months.map(m => (
                  <th key={m} className="r" style={{ minWidth: 95 }}>{m}</th>
                ))}
                <th className="r" style={{ borderLeft: '1px solid var(--bd2)', color: 'var(--brand)', minWidth: 110 }}>FY LE</th>
                <th style={{ width: 70 }}></th>
              </tr>
            </thead>
            <tbody>
              {activeEntities.map(e => {
                const rowTotal = months.reduce((s, m) => s + getLeVal(e, m, metric), 0)
                return (
                  <tr key={`le-${e}`}>
                    <td style={{ position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 1, fontWeight: 600, color: BV_COLORS[e] }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: BV_COLORS[e], marginRight: 6 }} />
                      {e}
                    </td>
                    {months.map(m => {
                      const src = getLeSource(e, m, metric)
                      const val = getLeVal(e, m, metric) * sign
                      const isEditing = editing?.kind === 'le' && editing.e === e && editing.m === m && editing.k === metric
                      const bg =
                        src === 'actual'   ? 'rgba(0,169,224,.08)' :
                        src === 'override' ? 'rgba(38,201,151,.08)' :
                                             'rgba(143,163,192,.06)'
                      const color =
                        val === 0          ? 'var(--t3)' :
                        src === 'actual'   ? 'var(--brand)' :
                        src === 'override' ? 'var(--green)' :
                                             'var(--t2)'
                      const weight = src === 'actual' ? 700 : 500
                      const style = src === 'budget' ? 'italic' : 'normal'
                      return (
                        <td
                          key={`le-${e}-${m}`}
                          className="r mono"
                          style={{ padding: '4px 6px', background: bg, cursor: 'pointer' }}
                          title={src === 'actual' ? 'Werkelijk (uit OHW/Maandafsluiting)' : src === 'override' ? 'Handmatig aangepast' : 'Budget (verwacht)'}
                          onClick={() => startEdit('le', e, m, metric)}
                        >
                          {isEditing ? (
                            <input
                              autoFocus
                              value={rawInput}
                              onChange={ev => setRawInput(ev.target.value)}
                              onBlur={commitEdit}
                              onKeyDown={ev => { if (ev.key === 'Enter') commitEdit(); else if (ev.key === 'Escape') cancelEdit() }}
                              className="ohw-inp"
                              style={{ width: 80, fontSize: 11, padding: '2px 5px' }}
                            />
                          ) : (
                            <span style={{ color, fontWeight: weight, fontStyle: style }}>
                              {val === 0 ? '—' : fmt(val)}
                            </span>
                          )}
                        </td>
                      )
                    })}
                    <td
                      className="r mono"
                      style={{ fontWeight: 700, color: 'var(--brand)', borderLeft: '1px solid var(--bd2)' }}
                    >
                      {fmt(rowTotal * sign)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 3 }}>
                        <button
                          className="btn sm ghost"
                          title="Vul hele jaar: actuals voor gesloten maanden, budget voor rest"
                          style={{ fontSize: 9, padding: '2px 4px' }}
                          onClick={() => autoFillLatestEstimate(e)}
                        >⚡</button>
                        <button
                          className="btn sm ghost"
                          title="Wis LE-overrides (terug naar auto-afgeleid)"
                          style={{ fontSize: 9, padding: '2px 4px', color: 'var(--red)' }}
                          onClick={() => clearLatestEstimate(e)}
                        >✕</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              <tr className="tot">
                <td style={{ position: 'sticky', left: 0, background: 'var(--bg4)', zIndex: 1 }}>Totaal LE</td>
                {months.map(m => {
                  const total = activeEntities.reduce((s, e) => s + getLeVal(e, m, metric), 0) * sign
                  return <td key={`le-tot-${m}`} className="r mono">{total === 0 ? '—' : fmt(total)}</td>
                })}
                <td className="r mono" style={{ color: 'var(--brand)', borderLeft: '1px solid var(--bd2)' }}>
                  {fmt(activeEntities.reduce((s, e) => s + months.reduce((ss, m) => ss + getLeVal(e, m, metric), 0), 0) * sign)}
                </td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* vs 2025 detail table */}
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
                <th className="r">Budget 2026 (FY, deze tab)</th>
                <th className="r">Δ vs Actuals 2025</th>
                <th className="r">Δ %</th>
              </tr>
            </thead>
            <tbody>
              {PL_STRUCTURE.filter(i => !i.isSeparator && !i.isPercentage).map(item => {
                const b25 = activeEntities.reduce((s, e) => s + (ytdBudget2025[e]?.[item.key] ?? 0), 0)
                const a25 = activeEntities.reduce((s, e) => s + (ytdActuals2025[e]?.[item.key] ?? 0), 0)
                const b26 = activeEntities.reduce((s, e) => s + months.reduce((ss, m) => ss + (store.getMonth(e, m)[item.key] ?? 0), 0), 0)
                const d   = b26 - a25
                const pct = a25 !== 0 ? d / Math.abs(a25) * 100 : 0
                const isCost = item.key.includes('kosten') || item.key.includes('amortisatie') || item.key.includes('afschrijving')
                const deltaColor = d === 0
                  ? 'var(--t3)'
                  : isCost
                    ? d < 0 ? 'var(--green)' : 'var(--red)'
                    : d > 0 ? 'var(--green)' : 'var(--red)'
                return (
                  <tr key={item.key} style={{ background: item.isBold ? 'var(--bg3)' : undefined }}>
                    <td style={{
                      paddingLeft: 12 + (item.indent ?? 0) * 14,
                      fontWeight: item.isBold ? 700 : 400,
                    }}>{item.label}</td>
                    <td className="r mono" style={{ color: 'var(--t3)' }}>{fmt(b25)}</td>
                    <td className="r mono">{fmt(a25)}</td>
                    <td className="r mono" style={{ color: 'var(--brand)', fontWeight: 600 }}>{fmt(b26)}</td>
                    <td className="r mono" style={{ color: deltaColor }}>{d === 0 ? '—' : (d > 0 ? '+' : '') + fmt(d)}</td>
                    <td className="r mono" style={{ color: deltaColor, fontSize: 11 }}>
                      {a25 === 0 ? '—' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`}
                    </td>
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
