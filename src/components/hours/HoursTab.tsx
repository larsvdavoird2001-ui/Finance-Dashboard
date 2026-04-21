import { useState } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import '../../lib/chartSetup'
import { CHART_COLORS } from '../../lib/chartSetup'
import { hoursData2026, hoursData2025, MONTHS_2026, MONTHS_2025, ACTUAL_MONTHS, CURRENT_MONTH } from '../../data/hoursData'
import type { BvId, GlobalFilter } from '../../data/types'

const BVS: BvId[] = ['Consultancy', 'Projects', 'Software']

const BV_COLORS: Record<BvId, string> = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
}

function kpiCard(label: string, value: string, sub?: string, color?: string, tag?: string) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 160 }}>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{label}</div>
          {tag && <span style={{ fontSize: 9, background: 'var(--bd-blue)', color: 'var(--blue)', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>{tag}</span>}
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: color ?? 'var(--t1)', fontFamily: 'var(--mono)', letterSpacing: '-.5px' }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  )
}

const baseOpts = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#7c8aa0', font: { family: 'Inter', size: 11 }, boxWidth: 10 } },
    tooltip: {
      backgroundColor: '#10141f',
      borderColor: 'rgba(255,255,255,0.1)',
      borderWidth: 1,
      titleColor: '#dde3f0',
      bodyColor: '#7c8aa0',
    },
  },
  scales: {
    x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#3f4d63', font: { family: 'Inter', size: 10 } } },
    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#3f4d63', font: { family: 'Inter', size: 10 } } },
  },
}

interface Props { filter: GlobalFilter }

export function HoursTab({ filter }: Props) {
  const [view, setView] = useState<'monthly' | 'bv'>('monthly')
  const [metric, setMetric] = useState<'written' | 'declarable' | 'util'>('written')
  const [showForecast, setShowForecast] = useState(true)

  const is2025 = filter.year === '2025'
  const hoursData = is2025 ? hoursData2025 : hoursData2026
  const months    = is2025 ? MONTHS_2025   : MONTHS_2026

  const activeBvs = filter.bv === 'all' ? BVS : [filter.bv as BvId]

  const allRecords     = hoursData.filter(r => activeBvs.includes(r.bv))
  const actualRecords  = allRecords.filter(r => r.type === 'actual')
  const currentRecords = is2025 ? [] : allRecords.filter(r => r.type === 'current')

  // ── YTD / Full-year actuals ────────────────────────────────────────────
  const ytdWritten  = actualRecords.reduce((a, r) => a + r.written, 0)
  const ytdDecl     = actualRecords.reduce((a, r) => a + r.declarable, 0)
  const ytdNonDecl  = actualRecords.reduce((a, r) => a + r.nonDeclarable, 0)
  const ytdCap      = actualRecords.reduce((a, r) => a + r.capacity, 0)
  const ytdDeclPct  = ytdWritten > 0 ? ytdDecl / ytdWritten * 100 : 0
  const ytdCapUtil  = ytdCap > 0 ? ytdWritten / ytdCap * 100 : 0

  // ── Current month (partial, 2026 only) ────────────────────────────────
  const curWritten = currentRecords.reduce((a, r) => a + r.written, 0)
  const curDecl    = currentRecords.reduce((a, r) => a + r.declarable, 0)
  const curDeclPct = curWritten > 0 ? curDecl / curWritten * 100 : 0

  // ── Full year forecast (2026 only) ─────────────────────────────────────
  const fyWritten = allRecords.reduce((a, r) => a + (r.type !== 'current' ? r.written : 0), 0) + curWritten
  const fyDecl    = allRecords.reduce((a, r) => a + (r.type !== 'current' ? r.declarable : 0), 0) + curDecl

  // ── Monthly trend datasets ─────────────────────────────────────────────
  const displayMonths = is2025
    ? months
    : (showForecast ? MONTHS_2026 : [...ACTUAL_MONTHS, CURRENT_MONTH])

  const getVal = (bv: BvId, m: string) => {
    const r = hoursData.find(x => x.bv === bv && x.month === m)
    if (!r) return null
    if (metric === 'written')    return r.written
    if (metric === 'declarable') return r.declarable
    return r.written > 0 ? r.declarable / r.written * 100 : 0
  }

  const trendDatasets = is2025
    // 2025: all solid lines (all actuals)
    ? activeBvs.map(bv => ({
        label: bv,
        data: displayMonths.map(m => getVal(bv, m)),
        borderColor: CHART_COLORS[bv],
        backgroundColor: CHART_COLORS[bv] + '20',
        borderWidth: 2.5,
        tension: 0.3,
        fill: false,
        pointRadius: 4,
        pointBackgroundColor: CHART_COLORS[bv],
        spanGaps: false,
      }))
    // 2026: actuals solid, forecast dashed
    : activeBvs.flatMap(bv => {
        const color = CHART_COLORS[bv]
        const actualVals = displayMonths.map(m => {
          const r = hoursData.find(x => x.bv === bv && x.month === m)
          if (!r || r.type === 'forecast') return null
          return getVal(bv, m)
        })
        const forecastVals = displayMonths.map(m => {
          const r = hoursData.find(x => x.bv === bv && x.month === m)
          if (!r || r.type === 'actual') return null
          return getVal(bv, m)
        })
        return [
          {
            label: `${bv} (actuals)`,
            data: actualVals,
            borderColor: color,
            backgroundColor: color + '20',
            borderWidth: 2.5,
            tension: 0.3,
            fill: false,
            pointRadius: 4,
            pointBackgroundColor: color,
            spanGaps: false,
          },
          {
            label: `${bv} (forecast)`,
            data: forecastVals,
            borderColor: color,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [5, 4],
            tension: 0.3,
            fill: false,
            pointRadius: 3,
            pointStyle: 'circle' as const,
            pointBackgroundColor: 'transparent',
            pointBorderColor: color,
            spanGaps: true,
          },
        ]
      })

  const trendData = { labels: displayMonths, datasets: trendDatasets }

  // ── BV bar chart ────────────────────────────────────────────────────────
  const bvBar = {
    labels: activeBvs,
    datasets: [
      {
        label: 'Geschreven (actuals)',
        data: activeBvs.map(bv => hoursData.filter(r => r.bv === bv && r.type === 'actual').reduce((a, r) => a + r.written, 0)),
        backgroundColor: activeBvs.map(bv => BV_COLORS[bv]),
        borderRadius: 4,
      },
      {
        label: 'Declarabel (actuals)',
        data: activeBvs.map(bv => hoursData.filter(r => r.bv === bv && r.type === 'actual').reduce((a, r) => a + r.declarable, 0)),
        backgroundColor: activeBvs.map(bv => BV_COLORS[bv] + '55'),
        borderRadius: 4,
      },
    ],
  }

  return (
    <div className="page">
      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className={`btn sm${view === 'monthly' ? ' primary' : ' ghost'}`} onClick={() => setView('monthly')}>Maandtrend</button>
        <button className={`btn sm${view === 'bv'      ? ' primary' : ' ghost'}`} onClick={() => setView('bv')}>Per BV</button>
        <div style={{ borderLeft: '1px solid var(--bd)', margin: '0 4px', height: 18 }} />
        <button className={`btn sm${metric === 'written'    ? ' primary' : ' ghost'}`} onClick={() => setMetric('written')}>Geschreven</button>
        <button className={`btn sm${metric === 'declarable' ? ' primary' : ' ghost'}`} onClick={() => setMetric('declarable')}>Declarabel</button>
        <button className={`btn sm${metric === 'util'       ? ' primary' : ' ghost'}`} onClick={() => setMetric('util')}>Util %</button>
        {!is2025 && (
          <>
            <div style={{ borderLeft: '1px solid var(--bd)', margin: '0 4px', height: 18 }} />
            <button
              className={`btn sm${showForecast ? ' primary' : ' ghost'}`}
              onClick={() => setShowForecast(s => !s)}
              title="Toon/verberg forecast maanden"
            >
              {showForecast ? '📅 Incl. forecast' : '📅 Actuals only'}
            </button>
          </>
        )}
      </div>

      {/* KPI cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {kpiCard(
          'Geschreven uren',
          ytdWritten.toLocaleString('nl-NL'),
          is2025 ? 'FY2025 — alle maanden' : `YTD ${ACTUAL_MONTHS[ACTUAL_MONTHS.length-1]} actuals`,
          undefined,
          is2025 ? 'FY' : 'YTD'
        )}
        {kpiCard('Declarabel', ytdDecl.toLocaleString('nl-NL'), `${ytdDeclPct.toFixed(1)}% van geschreven`, 'var(--green)', is2025 ? 'FY' : 'YTD')}
        {kpiCard('Niet-declarabel', ytdNonDecl.toLocaleString('nl-NL'), `${(100-ytdDeclPct).toFixed(1)}% overhead`, 'var(--amber)', is2025 ? 'FY' : 'YTD')}
        {kpiCard('Bezettingsgraad', `${ytdCapUtil.toFixed(0)}%`, `${ytdWritten.toLocaleString('nl-NL')} / ${ytdCap.toLocaleString('nl-NL')} cap`, ytdCapUtil >= 90 ? 'var(--green)' : ytdCapUtil >= 75 ? 'var(--amber)' : 'var(--red)', is2025 ? 'FY' : 'YTD')}
        {!is2025 && kpiCard(CURRENT_MONTH + ' (lopend)', curWritten.toLocaleString('nl-NL'), `${curDeclPct.toFixed(1)}% declarabel · gedeeltelijk`, 'var(--amber)', 'Nu')}
        {!is2025 && kpiCard('FY2026 forecast', fyWritten.toLocaleString('nl-NL'), `${fyDecl.toLocaleString('nl-NL')} declarabel`, 'var(--t3)', 'FC')}
      </div>

      {/* Legenda actuals vs forecast */}
      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--t2)', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 20, height: 2, background: 'var(--blue)', display: 'inline-block', borderRadius: 1 }} /> Actuals (SAP)
        </span>
        {!is2025 && <>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 20, borderTop: '2px dashed var(--blue)', display: 'inline-block' }} /> Forecast (capaciteitsplan)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, background: 'var(--amber)', borderRadius: '50%', display: 'inline-block' }} /> {CURRENT_MONTH} lopend
          </span>
        </>}
      </div>

      {/* Chart */}
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">{view === 'monthly' ? `Maandtrend Uren ${is2025 ? '2025' : '2026'}` : `Uren per BV (${is2025 ? 'FY2025' : 'YTD actuals'})`}</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>
            {metric === 'util' ? 'Declarabelheid %' : 'Uren'}
            {!is2025 && view === 'monthly' && showForecast && <span style={{ marginLeft: 8, color: 'var(--amber)', fontSize: 9 }}>FORECAST ≥ {CURRENT_MONTH}</span>}
          </span>
        </div>
        <div style={{ padding: 16, height: 280 }}>
          {view === 'monthly'
            ? <Line data={trendData} options={{
                ...baseOpts,
                scales: {
                  ...baseOpts.scales,
                  y: {
                    ...baseOpts.scales.y,
                    ticks: { ...baseOpts.scales.y.ticks, callback: (v: number | string) => metric === 'util' ? `${v}%` : Number(v).toLocaleString('nl-NL') },
                  },
                },
              } as Parameters<typeof Line>[0]['options']} />
            : <Bar data={bvBar} options={baseOpts as Parameters<typeof Bar>[0]['options']} />
          }
        </div>
      </div>

      {/* Detail table */}
      <div className="card">
        <div className="card-hdr"><span className="card-title">Urenverdeling per BV & Maand</span></div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ minWidth: 120 }}>BV</th>
                <th style={{ minWidth: 80 }}>Maand</th>
                <th className="r">Type</th>
                <th className="r">Geschreven</th>
                <th className="r">Declarabel</th>
                <th className="r">Niet-decl.</th>
                <th className="r">Util %</th>
                <th className="r">Capaciteit</th>
                <th className="r">Bezetting %</th>
              </tr>
            </thead>
            <tbody>
              {activeBvs.map(bv => {
                const bvActuals   = hoursData.filter(r => r.bv === bv && r.type === 'actual')
                const bvTotW  = bvActuals.reduce((a, r) => a + r.written, 0)
                const bvTotD  = bvActuals.reduce((a, r) => a + r.declarable, 0)
                const bvTotN  = bvActuals.reduce((a, r) => a + r.nonDeclarable, 0)
                const bvTotC  = bvActuals.reduce((a, r) => a + r.capacity, 0)
                const displayR = is2025
                  ? hoursData.filter(r => r.bv === bv)
                  : showForecast
                    ? hoursData.filter(r => r.bv === bv)
                    : hoursData.filter(r => r.bv === bv && r.type !== 'forecast')
                return [
                  ...displayR.map(r => {
                    const util = r.written > 0 ? r.declarable / r.written * 100 : 0
                    const cap  = r.capacity > 0 ? r.written / r.capacity * 100 : 0
                    const isForecast = r.type === 'forecast'
                    const isCurrent  = r.type === 'current'
                    return (
                      <tr key={`${bv}-${r.month}`} className="sub" style={{ opacity: isForecast ? 0.65 : 1 }}>
                        <td style={{ color: BV_COLORS[bv], fontSize: 11, fontWeight: 600 }}>{bv}</td>
                        <td style={{ fontWeight: 500 }}>{r.month}</td>
                        <td style={{ textAlign: 'right' }}>
                          {isForecast
                            ? <span style={{ fontSize: 9, background: 'var(--bd)', color: 'var(--t3)', padding: '1px 5px', borderRadius: 3 }}>forecast</span>
                            : isCurrent
                              ? <span style={{ fontSize: 9, background: 'var(--bd-amber)', color: 'var(--amber)', padding: '1px 5px', borderRadius: 3 }}>lopend</span>
                              : <span style={{ fontSize: 9, background: 'var(--bd-green)', color: 'var(--green)', padding: '1px 5px', borderRadius: 3 }}>actual</span>
                          }
                        </td>
                        <td className="mono r">{r.written.toLocaleString('nl-NL')}</td>
                        <td className="mono r" style={{ color: 'var(--green)' }}>{r.declarable.toLocaleString('nl-NL')}</td>
                        <td className="mono r" style={{ color: 'var(--amber)' }}>{r.nonDeclarable.toLocaleString('nl-NL')}</td>
                        <td className="mono r" style={{ color: !isForecast ? (util >= 85 ? 'var(--green)' : util >= 70 ? 'var(--amber)' : 'var(--red)') : 'var(--t3)' }}>{util.toFixed(1)}%</td>
                        <td className="mono r" style={{ color: 'var(--t3)' }}>{r.capacity.toLocaleString('nl-NL')}</td>
                        <td className="mono r" style={{ color: !isForecast ? (cap >= 90 ? 'var(--green)' : 'var(--amber)') : 'var(--t3)' }}>{cap.toFixed(0)}%</td>
                      </tr>
                    )
                  }),
                  // BV subtotal (actuals only)
                  <tr key={`${bv}-tot`} className="tot">
                    <td colSpan={3} style={{ fontWeight: 700 }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: BV_COLORS[bv], marginRight: 6 }} />
                      {bv} {is2025 ? 'FY2025' : 'YTD actuals'}
                    </td>
                    <td className="mono r">{bvTotW.toLocaleString('nl-NL')}</td>
                    <td className="mono r" style={{ color: 'var(--green)' }}>{bvTotD.toLocaleString('nl-NL')}</td>
                    <td className="mono r" style={{ color: 'var(--amber)' }}>{bvTotN.toLocaleString('nl-NL')}</td>
                    <td className="mono r" style={{ color: 'var(--green)' }}>{(bvTotW > 0 ? bvTotD / bvTotW * 100 : 0).toFixed(1)}%</td>
                    <td className="mono r" style={{ color: 'var(--t3)' }}>{bvTotC.toLocaleString('nl-NL')}</td>
                    <td className="mono r">{(bvTotC > 0 ? bvTotW / bvTotC * 100 : 0).toFixed(0)}%</td>
                  </tr>,
                ]
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Warning */}
      {ytdDeclPct < 75 && (
        <div style={{ background: 'var(--bd-amber)', border: '1px solid var(--amber)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--amber)' }}>
          ⚠ Gemiddelde declarabelheid {ytdDeclPct.toFixed(1)}% (YTD actuals) ligt onder de norm van 75%. Controleer niet-declarabele uren.
        </div>
      )}
    </div>
  )
}
