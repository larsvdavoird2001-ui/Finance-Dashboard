import { useState, useMemo } from 'react'
import type { BvId, FteBv } from '../../data/types'
import { useFteStore, FTE_YEARS, monthsForYear } from '../../store/useFteStore'
import { useLockedBv } from '../../lib/permissions'
import { verticalsForBv, snapshotActuals, VERTICAL_COLORS, type Vertical } from '../../lib/verticals'
import { PERSON_SPEC_MONTH, PERSON_SPEC_SNAPSHOT_DATE } from '../../data/personSpec'

const BVS_FULL: FteBv[] = ['Consultancy', 'Projects', 'Software', 'Holdings']
const BV_COLORS: Record<FteBv, string> = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
  Holdings:    '#8fa3c0',
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
  // BV-locked viewers zien alleen hun eigen BV. Holdings kan ook deelnemen
  // aan FTE-tracking (top-down totaal, geen vertical-breakdown).
  const BVS: FteBv[] = lockedBv
    ? (BVS_FULL.includes(lockedBv as FteBv) ? [lockedBv as FteBv] : [])
    : BVS_FULL

  const [year, setYear] = useState<'2025' | '2026'>('2026')
  const [metric, setMetric] = useState<Metric>('fte')
  const months = useMemo(() => monthsForYear(year), [year])
  const prevYear = year === '2026' ? '2025' : '2024'

  /** Lookup BV-totaal voor (bv, month). */
  const getVal = (bv: FteBv, month: string, key: 'fte' | 'headcount'): number | undefined => {
    return entries.find(e => e.bv === bv && e.month === month && !e.vertical)?.[key]
  }
  /** Lookup vertical-specifiek voor (bv, vertical, month). */
  const getVerticalVal = (
    bv: FteBv, vertical: Vertical, month: string, key: 'fte' | 'headcount',
  ): number | undefined => {
    return entries.find(e => e.bv === bv && e.month === month && e.vertical === vertical)?.[key]
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
  const lastMonthWithActuals = (bv: FteBv): { month: string; idx: number } | null => {
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
            Vul {unit}-totaal per BV per maand in. Onder elk totaal kun je optioneel de
            vertical-breakdown invullen. Snapshot {PERSON_SPEC_SNAPSHOT_DATE} → ref. {PERSON_SPEC_MONTH}.
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
                const prevMonth = last.idx > 0 ? months[last.idx - 1] : null
                const prevVal = prevMonth ? getVal(bv, prevMonth, actualKey) : null
                const mom = prevVal != null ? currentVal - prevVal : null

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

      {/* ── Per-BV tabellen — totaal-rij + (voor productie-BVs) verticals ── */}
      {BVS.map(bv => {
        const actuals = months.map(m => getVal(bv, m, actualKey))
        const hasActuals = actuals.some(v => v != null)
        const verticals = verticalsForBv(bv) // [] voor Holdings
        const snapshot = snapshotActuals(bv)

        // Som van vertical-actuals voor consistency-check
        const verticalSumForMonth = (m: string): number | null => {
          if (verticals.length === 0) return null
          const vals = verticals
            .map(v => getVerticalVal(bv, v, m, actualKey))
            .filter((x): x is number => x != null)
          if (vals.length === 0) return null
          return vals.reduce((s, v) => s + v, 0)
        }

        return (
          <div key={bv} className="card" style={{ overflow: 'visible' }}>
            <div className="card-hdr">
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: BV_COLORS[bv], marginRight: 8 }} />
              <span className="card-title">{bv}</span>
              {!hasActuals && (
                <span style={{ marginLeft: 10, fontSize: 10, color: 'var(--t3)' }}>Geen actuals voor {year}</span>
              )}
              {snapshot && (
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>
                  Snapshot {PERSON_SPEC_MONTH}: <strong style={{ color: BV_COLORS[bv] }}>
                    {isFte ? fmtFte(snapshot.fte) : fmtHc(snapshot.headcount)} {unit.toLowerCase()}
                  </strong>
                </span>
              )}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ minWidth: 'max-content', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 220, position: 'sticky', left: 0, background: 'var(--bg3)', top: 0, zIndex: 3, padding: '6px 12px' }}>{unit}</th>
                    {months.map(m => (
                      <th key={m} className="r" style={{ minWidth: 95, background: 'var(--bg3)', position: 'sticky', top: 0, zIndex: 2, padding: '6px 8px' }}>{m}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Totaal-rij (BV-niveau) */}
                  <tr style={{ background: 'var(--bg3)' }}>
                    <td style={{ padding: '6px 12px', fontWeight: 700, position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 1, color: BV_COLORS[bv] }}>
                      Totaal {bv}
                    </td>
                    {months.map(m => {
                      const v = getVal(bv, m, actualKey)
                      return (
                        <td key={m} style={{ padding: 2, textAlign: 'right', background: 'var(--bg3)' }}>
                          <input
                            key={`${bv}-${m}-actual-${v ?? ''}`}
                            className="ohw-inp"
                            style={{ width: 80, textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700 }}
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

                  {/* Vertical-rijen (alleen productie-BVs) */}
                  {verticals.map(v => (
                    <tr key={v}>
                      <td style={{
                        padding: '4px 12px 4px 28px', fontSize: 11,
                        position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 1,
                        color: VERTICAL_COLORS[v], fontWeight: 600,
                      }}>
                        ↳ {v}
                      </td>
                      {months.map(m => {
                        const vv = getVerticalVal(bv, v, m, actualKey)
                        return (
                          <td key={m} style={{ padding: 2, textAlign: 'right', background: 'var(--bg2)' }}>
                            <input
                              key={`${bv}-${v}-${m}-actual-${vv ?? ''}`}
                              className="ohw-inp"
                              style={{
                                width: 80, textAlign: 'right', fontFamily: 'var(--mono)',
                                fontSize: 11,
                                color: vv == null ? 'var(--t3)' : 'var(--t1)',
                              }}
                              defaultValue={vv != null ? (isFte ? fmtFte(vv) : fmtHc(vv)) : ''}
                              placeholder="—"
                              onBlur={e => {
                                const raw = e.target.value.trim()
                                if (raw === '') {
                                  if (vv != null) upsertEntry(bv as BvId, m, { [actualKey]: undefined }, v)
                                  return
                                }
                                const parsed = parseNumber(raw)
                                if (parsed === null) return
                                upsertEntry(bv as BvId, m, { [actualKey]: parsed }, v)
                              }}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            />
                          </td>
                        )
                      })}
                    </tr>
                  ))}

                  {/* Verschil-rij: som verticals vs ingevoerd totaal */}
                  {verticals.length > 0 && (
                    <tr>
                      <td style={{
                        padding: '4px 12px 4px 28px', fontSize: 10,
                        position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 1,
                        color: 'var(--t3)', fontStyle: 'italic',
                      }}>
                        Σ verticals → check vs totaal
                      </td>
                      {months.map(m => {
                        const sum = verticalSumForMonth(m)
                        const tot = getVal(bv, m, actualKey)
                        const diff = (sum != null && tot != null) ? sum - tot : null
                        const ok = diff != null && Math.abs(diff) < (isFte ? 0.05 : 0.5)
                        return (
                          <td key={m} className="r mono" style={{
                            padding: '4px 8px', fontSize: 10,
                            color: sum == null ? 'var(--t3)' : (tot == null ? 'var(--t3)' : ok ? 'var(--green)' : 'var(--amber)'),
                          }}
                            title={diff != null && !ok ? `Som verticals = ${isFte ? fmtFte(sum!) : fmtHc(sum!)}, totaal = ${isFte ? fmtFte(tot!) : fmtHc(tot!)}, diff = ${fmtDelta(diff, isFte)}` : undefined}
                          >
                            {sum == null ? '—' : isFte ? fmtFte(sum) : fmtHc(sum)}
                            {diff != null && !ok && <span style={{ marginLeft: 3 }}>⚠</span>}
                          </td>
                        )
                      })}
                    </tr>
                  )}
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
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>
            {BVS.join(' + ')}
          </span>
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
        💡 <strong>Budget &amp; capaciteit-%:</strong> ga naar de Budgetten-tab → subtab
        &quot;FTE&quot; om FTE-budgetten en de verdeling productief / verlof /
        improductief / ziek per BV (en per vertical) per maand vast te leggen.
      </div>
    </div>
  )
}
