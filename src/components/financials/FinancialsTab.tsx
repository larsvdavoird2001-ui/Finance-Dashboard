import { useState, useEffect } from 'react'
import { Bar } from 'react-chartjs-2'
import '../../lib/chartSetup'
import { CHART_COLORS } from '../../lib/chartSetup'
import {
  PL_STRUCTURE,
  monthlyBudget2026,
  ytdActuals2025, ytdBudget2025,
  ytdBudget2026,
} from '../../data/plData'
import { monthlyActuals2025, monthlyBudget2025 } from '../../data/plData2025'
import type { EntityName } from '../../data/plData'
import { fmt } from '../../lib/format'
import type { BvId, GlobalFilter } from '../../data/types'
import { useAdjustedActuals } from '../../hooks/useAdjustedActuals'

type PeriodId = 'jan26' | 'feb26' | 'mar26' | 'ytd26' | 'fy25' | 'h125' | 'q125'

const PERIODS_2026: { id: PeriodId; label: string }[] = [
  { id: 'jan26', label: 'Jan 2026' },
  { id: 'feb26', label: 'Feb 2026' },
  { id: 'mar26', label: 'Mar 2026' },
  { id: 'ytd26', label: 'YTD 2026' },
]

const PERIODS_2025: { id: PeriodId; label: string }[] = [
  { id: 'q125',  label: 'Q1 2025' },
  { id: 'h125',  label: 'H1 2025' },
  { id: 'fy25',  label: 'FY 2025' },
]

const ALL_BVS: BvId[] = ['Consultancy', 'Projects', 'Software']

function sumMonths(data: Record<string, Record<string, number>>, months: string[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const m of months) {
    for (const [k, v] of Object.entries(data[m] ?? {})) {
      result[k] = (result[k] ?? 0) + v
    }
  }
  return result
}

const Q1_2025  = ['Jan-25','Feb-25','Mar-25']
const H1_2025  = ['Jan-25','Feb-25','Mar-25','Apr-25','May-25','Jun-25']


function getBudget(period: PeriodId, entity: EntityName): Record<string, number> {
  if (period === 'jan26') return monthlyBudget2026[entity]?.['Jan-26'] ?? {}
  if (period === 'feb26') return monthlyBudget2026[entity]?.['Feb-26'] ?? {}
  if (period === 'mar26') return monthlyBudget2026[entity]?.['Mar-26'] ?? {}
  if (period === 'ytd26') return ytdBudget2026[entity] ?? {}
  if (period === 'q125')  return sumMonths(monthlyBudget2025[entity] ?? {}, Q1_2025)
  if (period === 'h125')  return sumMonths(monthlyBudget2025[entity] ?? {}, H1_2025)
  return ytdBudget2025[entity] ?? {}
}

function pct(val: number, base: number) {
  return base !== 0 ? (val / base * 100).toFixed(1) + '%' : '—'
}

const chartOpts = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#7c8aa0', font: { family: 'Inter', size: 11 }, boxWidth: 10 } },
    tooltip: {
      backgroundColor: '#10141f', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
      titleColor: '#dde3f0', bodyColor: '#7c8aa0',
      callbacks: { label: (ctx: { dataset: { label?: string }; parsed: { y: number | null } }) => ` ${ctx.dataset.label}: € ${((ctx.parsed.y ?? 0) / 1000).toFixed(0)}k` },
    },
  },
  scales: {
    x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#3f4d63', font: { family: 'Inter', size: 10 } } },
    y: {
      grid: { color: 'rgba(255,255,255,0.05)' },
      ticks: { color: '#3f4d63', font: { family: 'Inter', size: 10 }, callback: (v: number | string) => `€${(Number(v) / 1000).toFixed(0)}k` },
    },
  },
}

interface Props { filter: GlobalFilter }

export function FinancialsTab({ filter }: Props) {
  const is2025 = filter.year === '2025'
  const [period, setPeriod] = useState<PeriodId>('mar26')
  const [view, setView] = useState<'summary' | 'pl'>('summary')

  // Sync period with year filter
  useEffect(() => {
    if (filter.year === '2025') setPeriod('fy25')
    else if (filter.year === '2026') setPeriod('mar26')
  }, [filter.year])

  const activePeriods = is2025 ? PERIODS_2025 : PERIODS_2026
  const activeBvs = (filter.bv === 'all' ? ALL_BVS : [filter.bv]) as EntityName[]

  // Live-adjusted actuals (OHW + closing entries)
  const { getMonthly, getYtd } = useAdjustedActuals()

  const getActuals = (p: PeriodId, entity: EntityName): Record<string, number> => {
    if (p === 'jan26') return getMonthly(entity as BvId, 'Jan-26')
    if (p === 'feb26') return getMonthly(entity as BvId, 'Feb-26')
    if (p === 'mar26') return getMonthly(entity as BvId, 'Mar-26')
    if (p === 'ytd26') return getYtd(entity as BvId, ['Jan-26', 'Feb-26', 'Mar-26'])
    if (p === 'q125')  return sumMonths(monthlyActuals2025[entity] ?? {}, Q1_2025)
    if (p === 'h125')  return sumMonths(monthlyActuals2025[entity] ?? {}, H1_2025)
    return ytdActuals2025[entity] ?? {}
  }

  // Aggregate actuals & budget across active BVs
  const totalActuals: Record<string, number> = {}
  const totalBudget: Record<string, number>  = {}
  for (const bv of activeBvs) {
    const a = getActuals(period, bv)
    const b = getBudget(period, bv)
    for (const k of Object.keys(a)) totalActuals[k] = (totalActuals[k] ?? 0) + (a[k] ?? 0)
    for (const k of Object.keys(b)) totalBudget[k]  = (totalBudget[k]  ?? 0) + (b[k] ?? 0)
  }

  // ── Charts ──────────────────────────────────────────────────────────────
  const revenueChart = {
    labels: activeBvs,
    datasets: [
      {
        label: 'Actuals',
        data: activeBvs.map(bv => getActuals(period, bv)['netto_omzet'] ?? 0),
        backgroundColor: activeBvs.map(bv => CHART_COLORS[bv as BvId] ?? '#00a9e0'),
        borderRadius: 4,
      },
      {
        label: 'Budget',
        data: activeBvs.map(bv => getBudget(period, bv)['netto_omzet'] ?? 0),
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderRadius: 4,
      },
    ],
  }

  const marginChart = {
    labels: activeBvs,
    datasets: [
      {
        label: 'Brutomarge Actual',
        data: activeBvs.map(bv => getActuals(period, bv)['brutomarge'] ?? 0),
        backgroundColor: activeBvs.map(bv => CHART_COLORS[bv as BvId] ?? '#00a9e0'),
        borderRadius: 4,
      },
      {
        label: 'Brutomarge Budget',
        data: activeBvs.map(bv => getBudget(period, bv)['brutomarge'] ?? 0),
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderRadius: 4,
      },
    ],
  }

  const periodLabel = [...PERIODS_2026, ...PERIODS_2025].find(p => p.id === period)?.label ?? ''

  return (
    <div className="page">
      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {activePeriods.map(p => (
          <button key={p.id} className={`btn sm${period === p.id ? ' primary' : ' ghost'}`} onClick={() => setPeriod(p.id)}>{p.label}</button>
        ))}
        <div style={{ borderLeft: '1px solid var(--bd)', margin: '0 4px', height: 18 }} />
        <button className={`btn sm${view === 'summary' ? ' primary' : ' ghost'}`} onClick={() => setView('summary')}>Samenvatting</button>
        <button className={`btn sm${view === 'pl'      ? ' primary' : ' ghost'}`} onClick={() => setView('pl')}>P&L Detail</button>
      </div>

      {view === 'summary' && (
        <>
          {/* KPI cards */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {[
              { label: 'Netto-omzet', key: 'netto_omzet', color: undefined },
              { label: 'Brutomarge', key: 'brutomarge', color: 'var(--green)' },
              { label: 'EBITDA', key: 'ebitda', color: undefined },
            ].map(({ label, key, color }) => {
              const a = totalActuals[key] ?? 0
              const b = totalBudget[key]  ?? 0
              const delta = a - b
              const rev = totalActuals['netto_omzet'] ?? 0
              const pctVal = rev > 0 && key !== 'netto_omzet' ? ` · ${(a / rev * 100).toFixed(1)}%` : ''
              return (
                <div className="card" key={key} style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ padding: '14px 16px' }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>{label}</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: color ?? 'var(--t1)', fontFamily: 'var(--mono)', letterSpacing: '-.5px' }}>{fmt(a)}{pctVal}</div>
                    <div style={{ fontSize: 11, color: delta >= 0 ? 'var(--green)' : 'var(--red)', marginTop: 4 }}>
                      {delta >= 0 ? '▲' : '▼'} {fmt(Math.abs(delta))} vs budget
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Charts */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="card">
              <div className="card-hdr">
                <span className="card-title">Omzet per BV — {periodLabel}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>Actual vs Budget</span>
              </div>
              <div style={{ padding: 16, height: 220 }}>
                <Bar data={revenueChart} options={chartOpts} />
              </div>
            </div>
            <div className="card">
              <div className="card-hdr">
                <span className="card-title">Brutomarge per BV — {periodLabel}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>Actual vs Budget</span>
              </div>
              <div style={{ padding: 16, height: 220 }}>
                <Bar data={marginChart} options={chartOpts} />
              </div>
            </div>
          </div>

          {/* BV performance table */}
          <div className="card">
            <div className="card-hdr"><span className="card-title">Financiële prestatie per BV — {periodLabel}</span></div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ minWidth: 140, position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 2 }}>BV</th>
                    <th className="r">Omzet (A)</th>
                    <th className="r">Omzet (B)</th>
                    <th className="r">Δ Omzet</th>
                    <th className="r">Marge (A)</th>
                    <th className="r">Marge %</th>
                    <th className="r">Δ Marge</th>
                    <th className="r">EBITDA (A)</th>
                    <th className="r">EBITDA %</th>
                  </tr>
                </thead>
                <tbody>
                  {activeBvs.map(bv => {
                    const a = getActuals(period, bv)
                    const b = getBudget(period, bv)
                    const revA = a['netto_omzet'] ?? 0, revB = b['netto_omzet'] ?? 0
                    const gmA  = a['brutomarge']  ?? 0, gmB  = b['brutomarge']  ?? 0
                    const ebitda = a['ebitda']    ?? 0
                    return (
                      <tr key={bv}>
                        <td style={{ position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 1 }}>
                          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: CHART_COLORS[bv as BvId] ?? '#00a9e0', marginRight: 6 }} />
                          {bv}
                        </td>
                        <td className="mono r">{fmt(revA)}</td>
                        <td className="mono r" style={{ color: 'var(--t3)' }}>{fmt(revB)}</td>
                        <td className="mono r" style={{ color: revA - revB >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {revA - revB >= 0 ? '+' : ''}{fmt(revA - revB)}
                        </td>
                        <td className="mono r" style={{ color: 'var(--green)', fontWeight: 600 }}>{fmt(gmA)}</td>
                        <td className="mono r" style={{ color: revA > 0 && gmA / revA >= 0.28 ? 'var(--green)' : 'var(--amber)' }}>
                          {pct(gmA, revA)}
                        </td>
                        <td className="mono r" style={{ color: gmA - gmB >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {gmA - gmB >= 0 ? '+' : ''}{fmt(gmA - gmB)}
                        </td>
                        <td className="mono r" style={{ color: ebitda >= 0 ? 'var(--t1)' : 'var(--red)' }}>{fmt(ebitda)}</td>
                        <td className="mono r" style={{ color: revA > 0 && ebitda / revA >= 0.08 ? 'var(--green)' : 'var(--amber)' }}>
                          {pct(ebitda, revA)}
                        </td>
                      </tr>
                    )
                  })}
                  {activeBvs.length > 1 && (
                    <tr className="tot">
                      <td style={{ position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 1, fontWeight: 700 }}>Groep Totaal</td>
                      <td className="mono r">{fmt(totalActuals['netto_omzet'] ?? 0)}</td>
                      <td className="mono r" style={{ color: 'var(--t3)' }}>{fmt(totalBudget['netto_omzet'] ?? 0)}</td>
                      <td className="mono r" style={{ color: (totalActuals['netto_omzet'] ?? 0) - (totalBudget['netto_omzet'] ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {fmt((totalActuals['netto_omzet'] ?? 0) - (totalBudget['netto_omzet'] ?? 0))}
                      </td>
                      <td className="mono r" style={{ color: 'var(--green)', fontWeight: 700 }}>{fmt(totalActuals['brutomarge'] ?? 0)}</td>
                      <td className="mono r" style={{ color: 'var(--green)', fontWeight: 700 }}>
                        {pct(totalActuals['brutomarge'] ?? 0, totalActuals['netto_omzet'] ?? 0)}
                      </td>
                      <td className="mono r" style={{ color: (totalActuals['brutomarge'] ?? 0) - (totalBudget['brutomarge'] ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {fmt((totalActuals['brutomarge'] ?? 0) - (totalBudget['brutomarge'] ?? 0))}
                      </td>
                      <td className="mono r" style={{ fontWeight: 700 }}>{fmt(totalActuals['ebitda'] ?? 0)}</td>
                      <td className="mono r">{pct(totalActuals['ebitda'] ?? 0, totalActuals['netto_omzet'] ?? 0)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {view === 'pl' && (
        <div className="card">
          <div className="card-hdr">
            <span className="card-title">P&L Detail</span>
            <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--t3)' }}>
              {filter.bv === 'all' ? 'Groep' : filter.bv} — {periodLabel}
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ minWidth: 'max-content' }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 280, position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 2 }}>Omschrijving</th>
                  {activeBvs.map(bv => (
                    <th key={bv} className="r" style={{ minWidth: 140 }}>{bv}</th>
                  ))}
                  {activeBvs.length > 1 && <th className="r" style={{ minWidth: 140 }}>Totaal</th>}
                  <th className="r" style={{ minWidth: 140 }}>Budget</th>
                  <th className="r" style={{ minWidth: 120 }}>Delta</th>
                </tr>
              </thead>
              <tbody>
                {PL_STRUCTURE.map(item => {
                  if (item.isSeparator) return (
                    <tr key={item.key}><td colSpan={activeBvs.length + 4} style={{ padding: 0, height: 1, background: 'var(--bd)' }} /></tr>
                  )
                  if (item.isPercentage) {
                    const rev = totalActuals['netto_omzet'] ?? 0
                    const val = item.key === 'brutomarge_pct' ? (totalActuals['brutomarge'] ?? 0) : (totalActuals['ebitda'] ?? 0)
                    return (
                      <tr key={item.key}>
                        <td style={{ padding: '4px 12px', fontSize: 11, color: 'var(--t3)', fontStyle: 'italic', position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 1 }}>{item.label}</td>
                        {activeBvs.map(bv => {
                          const a = getActuals(period, bv)
                          const r = a['netto_omzet'] ?? 0
                          const v = item.key === 'brutomarge_pct' ? (a['brutomarge'] ?? 0) : (a['ebitda'] ?? 0)
                          return <td key={bv} className="mono r" style={{ padding: '4px 8px', fontSize: 11, color: 'var(--t3)' }}>{pct(v, r)}</td>
                        })}
                        {activeBvs.length > 1 && <td className="mono r" style={{ padding: '4px 8px', fontSize: 11, color: 'var(--t3)' }}>{pct(val, rev)}</td>}
                        <td colSpan={2} />
                      </tr>
                    )
                  }
                  return (
                    <tr key={item.key} style={{ background: item.isBold ? 'var(--bg3)' : undefined }}>
                      <td style={{
                        padding: '5px 12px', paddingLeft: 12 + (item.indent ?? 0) * 16,
                        fontWeight: item.isBold ? 700 : 400,
                        position: 'sticky', left: 0,
                        background: item.isBold ? 'var(--bg3)' : 'var(--bg2)', zIndex: 1,
                      }}>{item.label}</td>
                      {activeBvs.map(bv => {
                        const v = getActuals(period, bv)[item.key] ?? 0
                        return <td key={bv} className="mono r" style={{ padding: '5px 8px', fontWeight: item.isBold ? 700 : 400 }}>{fmt(v)}</td>
                      })}
                      {activeBvs.length > 1 && (
                        <td className="mono r" style={{ padding: '5px 8px', fontWeight: item.isBold ? 700 : 400 }}>{fmt(totalActuals[item.key] ?? 0)}</td>
                      )}
                      <td className="mono r" style={{ padding: '5px 8px', color: 'var(--t3)' }}>{fmt(totalBudget[item.key] ?? 0)}</td>
                      <td className="mono r" style={{ padding: '5px 8px' }}>
                        {(() => {
                          const d = (totalActuals[item.key] ?? 0) - (totalBudget[item.key] ?? 0)
                          if (d === 0) return <span style={{ color: 'var(--t3)' }}>—</span>
                          return <span style={{ color: d > 0 ? 'var(--green)' : 'var(--red)', fontWeight: item.isBold ? 700 : 400 }}>
                            {d > 0 ? '+' : ''}{fmt(d)}
                          </span>
                        })()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
