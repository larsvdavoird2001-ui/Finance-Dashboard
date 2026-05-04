import { useState, useMemo } from 'react'
import type { BvId } from '../../data/types'
import { useFteStore, FTE_YEARS, monthsForYear } from '../../store/useFteStore'
import { useLockedBv } from '../../lib/permissions'

const BVS_FULL: BvId[] = ['Consultancy', 'Projects', 'Software']
const BV_COLORS: Record<BvId, string> = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
}

type Metric = 'fte' | 'headcount'

/** Parse helper voor Nederlandse decimaalnotatie. */
function parseNumber(raw: string): number | null {
  const normalized = raw.replace(/\s/g, '').replace(',', '.')
  if (!normalized) return null
  const v = parseFloat(normalized)
  return isFinite(v) ? v : null
}

function fmtFte(v: number | undefined | null): string {
  if (v == null) return '—'
  return v.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function fmtHc(v: number | undefined | null): string {
  if (v == null) return '—'
  return String(Math.round(v))
}

function fmtDelta(v: number | undefined | null, isFte: boolean): string {
  if (v == null) return '—'
  const sign = v >= 0 ? '+' : ''
  return sign + (isFte
    ? v.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : String(Math.round(v)))
}

export function FteTab() {
  const entries = useFteStore(s => s.entries)
  const upsertEntry = useFteStore(s => s.upsertEntry)
  const lockedBv = useLockedBv()
  // Holdings heeft geen FTE-flow — voor een Holdings-locked user blijft de
  // lijst leeg. Voor andere BV-locked users tonen we alleen die BV.
  const BVS: BvId[] = lockedBv && lockedBv !== 'Holdings'
    ? [lockedBv as BvId]
    : (lockedBv === 'Holdings' ? [] : BVS_FULL)

  const [year, setYear] = useState<'2025' | '2026'>('2026')
  const [metric, setMetric] = useState<Metric>('fte')
  const months = useMemo(() => monthsForYear(year), [year])
  const prevYear = year === '2026' ? '2025' : '2024'

  const getVal = (bv: BvId, month: string, key: 'fte' | 'headcount'): number | undefined => {
    return entries.find(e => e.bv === bv && e.month === month)?.[key]
  }

  const totalRow = (key: 'fte' | 'headcount') =>
    months.map(m => {
      const vals = BVS.map(bv => getVal(bv, m, key)).filter((v): v is number => v != null)
      if (vals.length === 0) return null
      return vals.reduce((s, v) => s + v, 0)
    })

  const isFte = metric === 'fte'
  const actualKey: 'fte' | 'headcount' = metric
  const unit = isFte ? 'FTE' : 'Headcount'

  // ── Per-BV: laatste maand met actuals ─────────────────────────────────
  const lastMonthWithActuals = (bv: BvId): { month: string; idx: number } | null => {
    for (let i = months.length - 1; i >= 0; i--) {
      if (getVal(bv, months[i], actualKey) != null) return { month: months[i], idx: i }
    }
    return null
  }

  const anyActual = BVS.some(bv => lastMonthWithActuals(bv) !== null)

  return (
    <div className="page">
      {/* ── Filters / header ─────────────────────────────────────── */}
      <div className="card" style={{ overflow: 'visible' }}>
        <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Filters:</span>
          {/* Jaar */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--t3)' }}>Jaar</span>
            <div className="tabs-row">
              {FTE_YEARS.map(y => (
                <button key={y} className={`tab${year === y ? ' active' : ''}`} onClick={() => setYear(y)}>{y}</button>
              ))}
            </div>
          </div>
          {/* Metric */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--t3)' }}>Metric</span>
            <div style={{ display: 'flex', gap: 4, background: 'var(--bg3)', padding: 3, borderRadius: 6 }}>
              {(['fte', 'headcount'] as Metric[]).map(m => (
                <button
                  key={m}
                  onClick={() => setMetric(m)}
                  style={{
                    padding: '5px 12px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                    background: metric === m ? 'var(--bg1)' : 'transparent',
                    color: metric === m ? 'var(--t1)' : 'var(--t3)',
                    border: '1px solid', borderColor: metric === m ? 'var(--bd2)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  {m === 'fte' ? 'FTE' : 'Headcount'}
                </button>
              ))}
            </div>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)' }}>
            Alleen actuals — vul {unit} per BV per maand in. Budget &amp; capaciteit-% staan in de Budgetten-tab.
          </span>
        </div>
      </div>

      {/* ── Analyse card: MoM + YoY (geen budget-delta) ─────────── */}
      {anyActual && (
        <div className="card" style={{ overflow: 'visible' }}>
          <div className="card-hdr">
            <span className="card-title">Analyse — {unit} {year}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>
              Month-over-month + year-over-year per BV
            </span>
          </div>
          <div style={{ padding: '12px 14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
              {BVS.map(bv => {
                const last = lastMonthWithActuals(bv)
                if (!last) return (
                  <div key={bv} style={{ padding: '10px 12px', background: 'var(--bg3)', borderRadius: 6, borderLeft: `3px solid ${BV_COLORS[bv]}`, fontSize: 11, color: 'var(--t3)' }}>
                    <div style={{ fontWeight: 700, color: BV_COLORS[bv], marginBottom: 4 }}>{bv}</div>
                    Geen actuals ingevuld voor {year}.
                  </div>
                )
                const currentVal = getVal(bv, last.month, actualKey)!
                // Vorige maand (alleen als beschikbaar)
                const prevMonth = last.idx > 0 ? months[last.idx - 1] : null
                const prevVal = prevMonth ? getVal(bv, prevMonth, actualKey) : null
                const mom = prevVal != null ? currentVal - prevVal : null

                // Same month vorig jaar
                const monthName = last.month.slice(0, 3)
                const prevYearMonth = `${monthName}-${prevYear === '2024' ? '24' : '25'}`
                const yoyVal = getVal(bv, prevYearMonth, actualKey)
                const yoy = yoyVal != null ? currentVal - yoyVal : null

                return (
                  <div key={bv} style={{
                    padding: '10px 12px', background: 'var(--bg3)', borderRadius: 6,
                    borderLeft: `3px solid ${BV_COLORS[bv]}`, fontSize: 11,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                      <strong style={{ color: BV_COLORS[bv], fontSize: 13 }}>{bv}</strong>
                      <span style={{ color: 'var(--t3)', fontSize: 10 }}>t/m {last.month}</span>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--t1)', marginBottom: 6 }}>
                      {isFte ? fmtFte(currentVal) : fmtHc(currentVal)} {unit.toLowerCase()}
                    </div>
                    <div style={{ display: 'grid', gap: 3, fontSize: 10.5 }}>
                      {mom != null ? (
                        <div>
                          <span style={{ color: 'var(--t3)' }}>Δ vs vorige maand ({prevMonth}): </span>
                          <strong style={{ color: mom === 0 ? 'var(--t2)' : mom < 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--mono)' }}>
                            {fmtDelta(mom, isFte)}
                          </strong>
                          {prevVal && prevVal > 0 && mom !== 0 && (
                            <span style={{ color: 'var(--t3)', marginLeft: 4 }}>({((mom / prevVal) * 100).toFixed(1)}%)</span>
                          )}
                        </div>
                      ) : last.idx === 0 ? (
                        <div style={{ color: 'var(--t3)' }}>— eerste maand van {year}, geen vorige maand beschikbaar</div>
                      ) : (
                        <div style={{ color: 'var(--t3)' }}>— vorige maand ({prevMonth}) niet ingevuld</div>
                      )}

                      {yoy != null ? (
                        <div>
                          <span style={{ color: 'var(--t3)' }}>Δ vs {prevYearMonth}: </span>
                          <strong style={{ color: yoy === 0 ? 'var(--t2)' : yoy < 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--mono)' }}>
                            {fmtDelta(yoy, isFte)}
                          </strong>
                          {yoyVal && yoyVal > 0 && yoy !== 0 && (
                            <span style={{ color: 'var(--t3)', marginLeft: 4 }}>({((yoy / yoyVal) * 100).toFixed(1)}%)</span>
                          )}
                        </div>
                      ) : (
                        <div style={{ color: 'var(--t3)' }}>— geen YoY vergelijking ({prevYearMonth} niet ingevuld)</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Per-BV tabellen — alleen actuals ────────────────────── */}
      {BVS.map(bv => {
        const actuals = months.map(m => getVal(bv, m, actualKey))
        const hasActuals = actuals.some(v => v != null)

        return (
          <div key={bv} className="card" style={{ overflow: 'visible' }}>
            <div className="card-hdr">
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: BV_COLORS[bv], marginRight: 8 }} />
              <span className="card-title">{bv}</span>
              {!hasActuals && (
                <span style={{ marginLeft: 10, fontSize: 10, color: 'var(--t3)' }}>Geen actuals voor {year}</span>
              )}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ minWidth: 'max-content', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 160, position: 'sticky', left: 0, background: 'var(--bg3)', top: 0, zIndex: 3, padding: '6px 12px' }}>{unit}</th>
                    {months.map(m => (
                      <th key={m} className="r" style={{ minWidth: 95, background: 'var(--bg3)', position: 'sticky', top: 0, zIndex: 2, padding: '6px 8px' }}>{m}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Actuals-rij */}
                  <tr>
                    <td style={{ padding: '6px 12px', fontWeight: 600, position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 1 }}>Actuals</td>
                    {months.map(m => {
                      const v = getVal(bv, m, actualKey)
                      return (
                        <td key={m} style={{ padding: 2, textAlign: 'right', background: 'var(--bg2)' }}>
                          <input
                            key={`${bv}-${m}-actual-${v ?? ''}`}
                            className="ohw-inp"
                            style={{ width: 80, textAlign: 'right', fontFamily: 'var(--mono)' }}
                            defaultValue={v != null ? (isFte ? fmtFte(v) : fmtHc(v)) : ''}
                            placeholder="—"
                            onBlur={e => {
                              const raw = e.target.value.trim()
                              if (raw === '') {
                                if (v != null) upsertEntry(bv, m, { [actualKey]: undefined })
                                return
                              }
                              const parsed = parseNumber(raw)
                              if (parsed === null) return
                              upsertEntry(bv, m, { [actualKey]: parsed })
                            }}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          />
                        </td>
                      )
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {/* ── Totaal alle BV's — alleen actuals ───────────────────── */}
      <div className="card" style={{ overflow: 'visible' }}>
        <div className="card-hdr">
          <span className="card-title">Totaal alle BV's — {unit}</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>Consultancy + Projects + Software</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ minWidth: 'max-content', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ minWidth: 160, position: 'sticky', left: 0, background: 'var(--bg3)' }}>{unit}</th>
                {months.map(m => (
                  <th key={m} className="r" style={{ minWidth: 95, background: 'var(--bg3)' }}>{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '6px 12px', fontWeight: 600, position: 'sticky', left: 0, background: 'var(--bg2)' }}>Actuals</td>
                {totalRow(actualKey).map((v, i) => (
                  <td key={i} className="mono r" style={{ padding: '5px 8px', fontWeight: 600 }}>{isFte ? fmtFte(v) : fmtHc(v)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--t3)', padding: '8px 0' }}>
        💡 <strong>Budget &amp; capaciteit-%:</strong> ga naar de Budgetten-tab om FTE-budgetten en de verdeling productief / verlof / improductief / ziek per BV per maand vast te leggen.
      </div>
    </div>
  )
}
