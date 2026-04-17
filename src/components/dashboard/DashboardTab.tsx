import { useState, useEffect } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import '../../lib/chartSetup'
import { monthlyBudget2026, ytdBudget2026, ytdActuals2025 } from '../../data/plData'
import { monthlyActuals2025, monthlyBudget2025, MONTHS_2025_LABELS } from '../../data/plData2025'
import type { EntityName } from '../../data/plData'
import { hoursData2026, hoursData2025, MONTHS_2025, ACTUAL_MONTHS } from '../../data/hoursData'
import { fmt } from '../../lib/format'
import type { BvId, GlobalFilter } from '../../data/types'
import { useAdjustedActuals } from '../../hooks/useAdjustedActuals'
import { useOhwStore } from '../../store/useOhwStore'

const BVS: BvId[] = ['Consultancy', 'Projects', 'Software']

const BV_COLORS: Record<BvId, string> = {
  Consultancy: '#4d8ef8',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
}

// Actuals available per year
const ACTUAL_PERIODS_2026 = ['Jan-26', 'Feb-26', 'Mar-26']

function kpiCard(label: string, value: string, sub?: string, color?: string) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 150 }}>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: color ?? 'var(--t1)', fontFamily: 'var(--mono)', letterSpacing: '-.5px' }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  )
}

interface Props {
  filter: GlobalFilter
  onNav: (tab: 'ohw') => void
}

type ViewMode = 'monthly' | 'ytd'

export function DashboardTab({ filter, onNav }: Props) {
  const is2025 = filter.year === '2025'
  const ACTUAL_PERIODS = is2025 ? MONTHS_2025_LABELS : ACTUAL_PERIODS_2026

  const [period, setPeriod] = useState<string>('Mar-26')
  const [viewMode, setViewMode] = useState<ViewMode>('monthly')

  // Reset period when year changes
  useEffect(() => {
    setPeriod(is2025 ? 'Dec-25' : 'Mar-26')
  }, [is2025])

  const activeBvs = filter.bv === 'all' ? BVS : [filter.bv as BvId]

  // Live-adjusted actuals (OHW + closing entries)
  const { getMonthly, getYtd } = useAdjustedActuals()

  // Live OHW totaal per maand (all BVs summed)
  const ohwData2026 = useOhwStore(s => s.data2026)
  const wipByMonth: Record<string, number> = {}
  for (const m of ohwData2026.allMonths) {
    wipByMonth[m] = ohwData2026.entities.reduce((sum, e) => sum + (e.totaalOnderhanden[m] ?? 0), 0)
  }

  // ── Data selection: monthly or YTD ──────────────────────────────────────
  const getActuals = (bv: BvId, key: string): number => {
    if (is2025) {
      if (viewMode === 'ytd') return ytdActuals2025[bv as EntityName]?.[key] ?? 0
      return monthlyActuals2025[bv as EntityName]?.[period]?.[key] ?? 0
    }
    if (viewMode === 'ytd') return getYtd(bv, ACTUAL_MONTHS)[key] ?? 0
    return getMonthly(bv, period)[key] ?? 0
  }
  const getBudget = (bv: BvId, key: string): number => {
    if (is2025) {
      if (viewMode === 'ytd') return ytdActuals2025[bv as EntityName]?.[key] ?? 0  // use actuals as budget proxy for 2025
      return monthlyBudget2025[bv as EntityName]?.[period]?.[key] ?? 0
    }
    if (viewMode === 'ytd') return ytdBudget2026[bv as EntityName]?.[key] ?? 0
    return monthlyBudget2026[bv as EntityName]?.[period]?.[key] ?? 0
  }
  const getPY = (bv: BvId, key: string): number => {
    if (is2025) return 0  // geen 2024 data beschikbaar
    // Prior year (2025): YTD of monthly approximation
    const fy = ytdActuals2025[bv as EntityName]?.[key] ?? 0
    if (viewMode === 'ytd') return fy
    return Math.round(fy / 12)
  }

  // ── Revenue & margin ─────────────────────────────────────────────────────
  let totalRevenue = 0, totalMargin = 0, totalCosts = 0, totalBudgetRev = 0
  for (const bv of activeBvs) {
    totalRevenue    += getActuals(bv, 'netto_omzet')
    totalMargin     += getActuals(bv, 'brutomarge')
    totalCosts      += Math.abs(getActuals(bv, 'directe_kosten'))
    totalBudgetRev  += getBudget(bv, 'netto_omzet')
  }
  const marginPct = totalRevenue > 0 ? (totalMargin / totalRevenue * 100) : 0
  const revVsBudget = totalBudgetRev > 0 ? (totalRevenue - totalBudgetRev) : 0
  const revVsBudgetPct = totalBudgetRev > 0 ? ((totalRevenue / totalBudgetRev - 1) * 100) : 0

  // ── Hours ─────────────────────────────────────────────────────────────────
  const hoursData = is2025 ? hoursData2025 : hoursData2026
  const hRecords = hoursData.filter(r =>
    (filter.bv === 'all' || r.bv === filter.bv) &&
    (viewMode === 'ytd' ? r.type === 'actual' : r.month === period)
  )
  const totalWritten = hRecords.reduce((a, r) => a + r.written, 0)
  const totalDecl    = hRecords.reduce((a, r) => a + r.declarable, 0)
  const declPct      = totalWritten > 0 ? (totalDecl / totalWritten * 100) : 0

  // ── WIP ───────────────────────────────────────────────────────────────────
  const wipTotal = wipByMonth[period] ?? 0
  const prevPeriod = ACTUAL_PERIODS[ACTUAL_PERIODS.indexOf(period) - 1]
  const wipPrev  = prevPeriod ? (wipByMonth[prevPeriod] ?? 0) : 0
  const wipDelta = wipTotal - wipPrev

  // ── Bar chart ────────────────────────────────────────────────────────────
  const revenueByBvData = {
    labels: activeBvs,
    datasets: [
      {
        label: 'Netto-omzet',
        data: activeBvs.map(bv => getActuals(bv, 'netto_omzet') / 1000),
        backgroundColor: activeBvs.map(bv => BV_COLORS[bv]),
        borderRadius: 4,
        borderSkipped: false,
      },
      {
        label: 'Budget',
        data: activeBvs.map(bv => getBudget(bv, 'netto_omzet') / 1000),
        backgroundColor: activeBvs.map(bv => BV_COLORS[bv] + '33'),
        borderColor: activeBvs.map(bv => BV_COLORS[bv] + '88'),
        borderWidth: 1,
        borderRadius: 4,
        borderSkipped: false,
      },
    ],
  }

  // ── Trend chart (actuals) ─────────────────────────────────────────────────
  const trendMonths = is2025 ? MONTHS_2025 : ACTUAL_MONTHS
  const trendData = {
    labels: trendMonths,
    datasets: activeBvs.map(bv => ({
      label: bv,
      data: trendMonths.map(m =>
        is2025
          ? (monthlyActuals2025[bv as EntityName]?.[m]?.['netto_omzet'] ?? 0) / 1000
          : (getMonthly(bv, m)['netto_omzet'] ?? 0) / 1000
      ),
      borderColor: BV_COLORS[bv],
      backgroundColor: BV_COLORS[bv] + '18',
      tension: 0.3,
      fill: true,
      pointRadius: 5,
      pointBackgroundColor: BV_COLORS[bv],
    })),
  }

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#8fa3c0', font: { family: 'Inter', size: 11 }, boxWidth: 10 } },
      tooltip: {
        backgroundColor: '#0c1120',
        borderColor: 'rgba(255,255,255,0.15)',
        borderWidth: 1,
        titleColor: '#edf1fc',
        bodyColor: '#8fa3c0',
        callbacks: { label: (ctx: { dataset: { label?: string }; parsed: { y: number | null } }) => ` ${ctx.dataset.label}: € ${(ctx.parsed.y ?? 0).toFixed(0)}k` },
      },
    },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#52657e', font: { family: 'Inter', size: 10 } } },
      y: {
        grid: { color: 'rgba(255,255,255,0.06)' },
        ticks: { color: '#52657e', font: { family: 'Inter', size: 10 }, callback: (v: number | string) => `€${v}k` },
      },
    },
  }

  const periodLabel = viewMode === 'ytd' ? `YTD ${ACTUAL_MONTHS[ACTUAL_MONTHS.length-1]}` : period

  return (
    <div className="page">
      {/* Period / view selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="tabs-row">
          <button className={`tab${viewMode === 'monthly' ? ' active' : ''}`} onClick={() => setViewMode('monthly')}>Maandelijks</button>
          <button className={`tab${viewMode === 'ytd' ? ' active' : ''}`} onClick={() => setViewMode('ytd')}>YTD</button>
        </div>
        {viewMode === 'monthly' && (
          <div style={{ display: 'flex', gap: 4 }}>
            {ACTUAL_PERIODS.map(p => (
              <button
                key={p}
                className={`btn sm${period === p ? ' primary' : ' ghost'}`}
                onClick={() => setPeriod(p)}
              >{p}</button>
            ))}
          </div>
        )}
        {filter.bv !== 'all' && (
          <span style={{ marginLeft: 8, fontSize: 11, color: BV_COLORS[filter.bv as BvId] ?? 'var(--blue)', background: 'var(--bd-blue)', padding: '2px 8px', borderRadius: 4 }}>
            {filter.bv}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)' }}>
          {viewMode === 'ytd' ? `YTD t/m ${ACTUAL_MONTHS[ACTUAL_MONTHS.length-1]}` : period}
        </span>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {kpiCard('Netto-omzet', fmt(totalRevenue),
          revVsBudget !== 0
            ? `${revVsBudget >= 0 ? '+' : ''}${fmt(revVsBudget)} vs budget (${revVsBudgetPct >= 0 ? '+' : ''}${revVsBudgetPct.toFixed(1)}%)`
            : 'vs budget: —'
        )}
        {kpiCard('Directe kosten', fmt(-totalCosts), undefined, 'var(--red)')}
        {kpiCard('Brutomarge', fmt(totalMargin), `${marginPct.toFixed(1)}% van omzet`, totalMargin >= 0 ? 'var(--green)' : 'var(--red)')}
        {kpiCard('Geschreven uren', totalWritten.toLocaleString('nl-NL'), `${declPct.toFixed(1)}% declarabel`)}
        {kpiCard('OHW Totaal', fmt(wipTotal), wipDelta >= 0 ? `▲ ${fmt(wipDelta)} vs vorige maand` : `▼ ${fmt(Math.abs(wipDelta))} vs vorige maand`, wipDelta >= 0 ? 'var(--amber)' : 'var(--green)')}
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="card">
          <div className="card-hdr">
            <span className="card-title">Omzet & Budget per BV</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>{periodLabel} · €k</span>
          </div>
          <div style={{ padding: 16, height: 220 }}>
            <Bar data={revenueByBvData} options={chartOpts as Parameters<typeof Bar>[0]['options']} />
          </div>
        </div>

        <div className="card">
          <div className="card-hdr">
            <span className="card-title">Omzet trend {is2025 ? 'FY2025' : 'YTD 2026'}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>Actuals · €k</span>
          </div>
          <div style={{ padding: 16, height: 220 }}>
            <Line data={trendData} options={chartOpts as Parameters<typeof Line>[0]['options']} />
          </div>
        </div>
      </div>

      {/* BV performance table with budget + vorig jaar */}
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">BV Overzicht — {periodLabel}</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ minWidth: 140 }}>BV</th>
                <th className="r">Netto-omzet</th>
                <th className="r">Budget</th>
                <th className="r">Δ Budget</th>
                {!is2025 && <th className="r">VJ {viewMode === 'ytd' ? '2025 YTD' : '∅/mnd'}</th>}
                {!is2025 && <th className="r">Δ VJ</th>}
                <th className="r">Brutomarge</th>
                <th className="r">Marge %</th>
                <th className="r">EBITDA</th>
              </tr>
            </thead>
            <tbody>
              {activeBvs.map(bv => {
                const rev    = getActuals(bv, 'netto_omzet')
                const gm     = getActuals(bv, 'brutomarge')
                const ebitda = getActuals(bv, 'ebitda')
                const bud    = getBudget(bv, 'netto_omzet')
                const py     = getPY(bv, 'netto_omzet')
                const deltaBud = rev - bud
                const deltaPy  = rev - py
                const pct    = rev > 0 ? gm / rev * 100 : 0
                return (
                  <tr key={bv}>
                    <td>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: BV_COLORS[bv], marginRight: 6 }} />
                      <strong>{bv}</strong>
                    </td>
                    <td className="mono r">{fmt(rev)}</td>
                    <td className="mono r" style={{ color: 'var(--t3)' }}>{fmt(bud)}</td>
                    <td className="mono r" style={{ color: deltaBud >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                      {deltaBud >= 0 ? '+' : ''}{fmt(deltaBud)}
                    </td>
                    {!is2025 && <td className="mono r" style={{ color: 'var(--t3)' }}>{fmt(py)}</td>}
                    {!is2025 && <td className="mono r" style={{ color: deltaPy >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {deltaPy >= 0 ? '+' : ''}{fmt(deltaPy)}
                    </td>}
                    <td className="mono r" style={{ color: gm >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{fmt(gm)}</td>
                    <td className="mono r" style={{ color: pct >= 30 ? 'var(--green)' : pct >= 20 ? 'var(--amber)' : 'var(--red)' }}>{pct.toFixed(1)}%</td>
                    <td className="mono r" style={{ color: ebitda >= 0 ? 'var(--t1)' : 'var(--red)' }}>{fmt(ebitda)}</td>
                  </tr>
                )
              })}
              {activeBvs.length > 1 && (() => {
                let rT = 0, cT = 0, gT = 0, eT = 0, bT = 0, pyT = 0
                for (const bv of activeBvs) {
                  rT  += getActuals(bv, 'netto_omzet')
                  cT  += getActuals(bv, 'directe_kosten')
                  gT  += getActuals(bv, 'brutomarge')
                  eT  += getActuals(bv, 'ebitda')
                  bT  += getBudget(bv, 'netto_omzet')
                  pyT += getPY(bv, 'netto_omzet')
                }
                const pT = rT > 0 ? gT / rT * 100 : 0
                const dB = rT - bT, dPy = rT - pyT
                return (
                  <tr className="tot">
                    <td>Totaal</td>
                    <td className="mono r">{fmt(rT)}</td>
                    <td className="mono r" style={{ color: 'var(--t3)' }}>{fmt(bT)}</td>
                    <td className="mono r" style={{ color: dB >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{dB >= 0 ? '+' : ''}{fmt(dB)}</td>
                    {!is2025 && <td className="mono r" style={{ color: 'var(--t3)' }}>{fmt(pyT)}</td>}
                    {!is2025 && <td className="mono r" style={{ color: dPy >= 0 ? 'var(--green)' : 'var(--red)' }}>{dPy >= 0 ? '+' : ''}{fmt(dPy)}</td>}
                    <td className="mono r" style={{ color: 'var(--green)', fontWeight: 700 }}>{fmt(gT)}</td>
                    <td className="mono r" style={{ color: 'var(--green)', fontWeight: 700 }}>{pT.toFixed(1)}%</td>
                    <td className="mono r">{fmt(eT)}</td>
                  </tr>
                )
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* Budget vergelijking details */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* OHW */}
        <div className="card">
          <div className="card-hdr"><span className="card-title">Onderhanden werk (OHW)</span></div>
          <div style={{ padding: 16 }}>
            <div style={{ display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
              {Object.entries(wipByMonth).map(([m, v]) => (
                <div key={m}>
                  <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 2 }}>{m}</div>
                  <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: m === period ? 'var(--amber)' : 'var(--t1)' }}>{fmt(v)}</div>
                </div>
              ))}
            </div>
            <button className="btn sm" onClick={() => onNav('ohw')}>→ OHW Overzicht openen</button>
          </div>
        </div>

        {/* Validatie */}
        <div className="card">
          <div className="card-hdr"><span className="card-title">Validatie</span></div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { ok: totalRevenue > 0,          msg: `Omzet aanwezig (${periodLabel})` },
              { ok: marginPct > 0,             msg: `Brutomarge positief (${marginPct.toFixed(1)}%)` },
              { ok: declPct > 70,              msg: `Declarabelheid > 70% (${declPct.toFixed(1)}%)` },
              { ok: wipTotal === 0 || wipTotal < 3000000, msg: `OHW binnen acceptabele bandbreedte (${fmt(wipTotal)})` },
              { ok: revVsBudget >= 0 || totalBudgetRev === 0, msg: `Omzet vs budget (${revVsBudgetPct >= 0 ? '+' : ''}${revVsBudgetPct.toFixed(1)}%)` },
            ].map((v, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 }}>
                <span style={{ color: v.ok ? 'var(--green)' : 'var(--amber)', fontSize: 13 }}>{v.ok ? '✓' : '⚠'}</span>
                <span style={{ color: v.ok ? 'var(--t2)' : 'var(--amber)' }}>{v.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Budget overzicht kaart */}
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">Budget{!is2025 ? ' & Vorig Jaar' : ''} Vergelijking — {periodLabel}</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ minWidth: 160 }}>BV / KPI</th>
                {activeBvs.map(bv => (
                  <th key={bv} className="r" style={{ minWidth: 130 }}>
                    <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: BV_COLORS[bv], marginRight: 5 }} />
                    {bv}
                  </th>
                ))}
                {activeBvs.length > 1 && <th className="r" style={{ minWidth: 120 }}>Totaal</th>}
              </tr>
            </thead>
            <tbody>
              {[
                { key: 'netto_omzet',   label: 'Netto-omzet' },
                { key: 'brutomarge',    label: 'Brutomarge' },
                { key: 'ebitda',        label: 'EBITDA' },
              ].map(({ key, label }) => {
                const actVals  = activeBvs.map(bv => getActuals(bv, key))
                const budVals  = activeBvs.map(bv => getBudget(bv, key))
                const pyVals   = activeBvs.map(bv => getPY(bv, key))
                const actTot   = actVals.reduce((a, v) => a + v, 0)
                const budTot   = budVals.reduce((a, v) => a + v, 0)
                const pyTot    = pyVals.reduce((a, v) => a + v, 0)
                return [
                  <tr key={`${key}-act`} style={{ background: 'var(--bg2)' }}>
                    <td style={{ padding: '5px 10px' }}>{label} — Actueel</td>
                    {actVals.map((v, i) => <td key={i} className="mono r" style={{ fontWeight: 600 }}>{fmt(v)}</td>)}
                    {activeBvs.length > 1 && <td className="mono r" style={{ fontWeight: 700 }}>{fmt(actTot)}</td>}
                  </tr>,
                  <tr key={`${key}-bud`} style={{ background: 'transparent' }}>
                    <td style={{ padding: '5px 10px', paddingLeft: 22, color: 'var(--t3)', fontSize: 11 }}>Budget</td>
                    {budVals.map((v, i) => <td key={i} className="mono r" style={{ color: 'var(--t3)', fontSize: 11 }}>{fmt(v)}</td>)}
                    {activeBvs.length > 1 && <td className="mono r" style={{ color: 'var(--t3)', fontSize: 11 }}>{fmt(budTot)}</td>}
                  </tr>,
                  <tr key={`${key}-delta`} style={{ background: 'transparent' }}>
                    <td style={{ padding: '5px 10px', paddingLeft: 22, color: 'var(--t3)', fontSize: 11 }}>Δ Budget</td>
                    {actVals.map((v, i) => {
                      const d = v - budVals[i]
                      return <td key={i} className="mono r" style={{ fontSize: 11, color: d >= 0 ? 'var(--green)' : 'var(--red)' }}>{d >= 0 ? '+' : ''}{fmt(d)}</td>
                    })}
                    {activeBvs.length > 1 && (() => {
                      const d = actTot - budTot
                      return <td className="mono r" style={{ fontSize: 11, color: d >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{d >= 0 ? '+' : ''}{fmt(d)}</td>
                    })()}
                  </tr>,
                  !is2025 && <tr key={`${key}-py`} style={{ background: 'transparent', borderBottom: '1px solid var(--bd)' }}>
                    <td style={{ padding: '5px 10px', paddingLeft: 22, color: 'var(--t3)', fontSize: 11 }}>Vorig jaar</td>
                    {pyVals.map((v, i) => <td key={i} className="mono r" style={{ color: 'var(--t3)', fontSize: 11 }}>{fmt(v)}</td>)}
                    {activeBvs.length > 1 && <td className="mono r" style={{ color: 'var(--t3)', fontSize: 11 }}>{fmt(pyTot)}</td>}
                  </tr>,
                ]
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
