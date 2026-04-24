import { useState, useMemo } from 'react'
import type { BvId } from '../../data/types'
import { useFteStore, FTE_YEARS, monthsForYear } from '../../store/useFteStore'

const BVS: BvId[] = ['Consultancy', 'Projects', 'Software']
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

  const [year, setYear] = useState<'2025' | '2026'>('2026')
  const [metric, setMetric] = useState<Metric>('fte')
  const months = useMemo(() => monthsForYear(year), [year])
  const prevYear = year === '2026' ? '2025' : '2024'

  const getVal = (bv: BvId, month: string, key: 'fte' | 'headcount' | 'fteBudget' | 'headcountBudget'): number | undefined => {
    return entries.find(e => e.bv === bv && e.month === month)?.[key]
  }

  const totalRow = (key: 'fte' | 'headcount' | 'fteBudget' | 'headcountBudget') =>
    months.map(m => {
      const vals = BVS.map(bv => getVal(bv, m, key)).filter((v): v is number => v != null)
      if (vals.length === 0) return null
      return vals.reduce((s, v) => s + v, 0)
    })

  const isFte = metric === 'fte'
  const actualKey: 'fte' | 'headcount' = metric
  const budgetKey: 'fteBudget' | 'headcountBudget' = metric === 'fte' ? 'fteBudget' : 'headcountBudget'
  const unit = isFte ? 'FTE' : 'Headcount'

  // ── Analyse: welke actuals/budgets zijn er? ───────────────────────────────
  // Tel ingevulde actuals en budgets voor huidig jaar+metric
  const actualsFilled = months.map(m => BVS.map(bv => getVal(bv, m, actualKey)).some(v => v != null))
  const budgetsFilled = months.map(m => BVS.map(bv => getVal(bv, m, budgetKey)).some(v => v != null))
  const anyActual = actualsFilled.some(x => x)
  const anyBudget = budgetsFilled.some(x => x)
  const allBudgetFilledForActualsMonths = actualsFilled.every((a, i) => !a || budgetsFilled[i])

  // Laatste maand met actuals per BV
  const lastMonthWithActuals = (bv: BvId): { month: string; idx: number } | null => {
    for (let i = months.length - 1; i >= 0; i--) {
      if (getVal(bv, months[i], actualKey) != null) return { month: months[i], idx: i }
    }
    return null
  }

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
            Per BV per maand — actuals + budget + delta. Alleen ingevulde data wordt vergeleken.
          </span>
        </div>
      </div>

      {/* ── Analyse card: MoM + YoY + budget-status ─────────────── */}
      {anyActual && (
        <div className="card" style={{ overflow: 'visible' }}>
          <div className="card-hdr">
            <span className="card-title">Analyse — {unit} {year}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>
              Alleen ingevulde maanden worden met elkaar vergeleken
            </span>
          </div>
          <div style={{ padding: '12px 14px' }}>

            {/* Budget-status warning */}
            {!anyBudget && (
              <div style={{
                padding: '10px 12px', borderRadius: 7, marginBottom: 12,
                background: 'var(--bd-amber)', border: '1px solid var(--amber)',
                fontSize: 12, color: 'var(--t1)', display: 'flex', gap: 10, alignItems: 'flex-start',
              }}>
                <span style={{ fontSize: 16 }}>⚠</span>
                <div>
                  <strong style={{ color: 'var(--amber)' }}>Budget {unit} voor {year} is nog niet ingevuld.</strong>
                  {' '}
                  Vul hieronder de budgetregels in om actuals-vs-budget analyse en sturing mogelijk te maken.
                  Zolang budget leeg is, tonen we alleen month-over-month en year-over-year vergelijkingen.
                </div>
              </div>
            )}
            {anyBudget && !allBudgetFilledForActualsMonths && (
              <div style={{
                padding: '8px 12px', borderRadius: 7, marginBottom: 12,
                background: 'var(--bd-amber)', border: '1px solid var(--amber)',
                fontSize: 11, color: 'var(--t1)',
              }}>
                ⚠ Budget is niet volledig ingevuld voor alle maanden met actuals — delta's worden alleen getoond waar beide waardes bestaan.
              </div>
            )}

            {/* Per-BV insight blocks */}
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

                // Same month vorig jaar — zelfde suffix '-25' of '-26' vervangen
                const monthName = last.month.slice(0, 3)  // 'Jan', 'Feb', etc
                const prevYearMonth = `${monthName}-${prevYear === '2024' ? '24' : '25'}`
                const yoyVal = getVal(bv, prevYearMonth, actualKey)
                const yoy = yoyVal != null ? currentVal - yoyVal : null

                // Budget-delta alleen als budget voor deze maand is ingevuld
                const budgetVal = getVal(bv, last.month, budgetKey)
                const budgetDelta = budgetVal != null ? currentVal - budgetVal : null

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

                      {budgetDelta != null ? (
                        <div>
                          <span style={{ color: 'var(--t3)' }}>Δ vs budget: </span>
                          <strong style={{ color: budgetDelta === 0 ? 'var(--t2)' : budgetDelta <= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--mono)' }}>
                            {fmtDelta(budgetDelta, isFte)}
                          </strong>
                        </div>
                      ) : (
                        <div style={{ color: 'var(--t3)', fontStyle: 'italic' }}>
                          — budget {last.month} nog niet ingevuld
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Per-BV tabellen ─────────────────────────────────────── */}
      {BVS.map(bv => {
        const actuals = months.map(m => getVal(bv, m, actualKey))
        const budgets = months.map(m => getVal(bv, m, budgetKey))
        const deltas = months.map((_, i) => {
          const a = actuals[i]; const b = budgets[i]
          if (a == null || b == null) return null
          return a - b
        })
        const hasActuals = actuals.some(v => v != null)
        const hasBudget = budgets.some(v => v != null)
        const hasDelta = deltas.some(v => v != null)

        return (
          <div key={bv} className="card" style={{ overflow: 'visible' }}>
            <div className="card-hdr">
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: BV_COLORS[bv], marginRight: 8 }} />
              <span className="card-title">{bv}</span>
              {!hasBudget && (
                <span style={{ marginLeft: 10, fontSize: 10, color: 'var(--amber)', background: 'var(--bd-amber)', padding: '2px 7px', borderRadius: 3, border: '1px solid var(--amber)' }}>
                  ⚠ budget ontbreekt
                </span>
              )}
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
                                // Leeg → clear deze waarde (als die gezet was).
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
                  {/* Budget-rij */}
                  <tr>
                    <td style={{ padding: '6px 12px', fontWeight: 600, color: 'var(--t2)', position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 1 }}>
                      Budget
                      {!hasBudget && <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--amber)' }}>(nog invullen)</span>}
                    </td>
                    {months.map(m => {
                      const v = getVal(bv, m, budgetKey)
                      return (
                        <td key={m} style={{ padding: 2, textAlign: 'right', background: 'var(--bg2)' }}>
                          <input
                            key={`${bv}-${m}-bud-${v ?? ''}`}
                            className="ohw-inp"
                            style={{ width: 80, textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--t2)' }}
                            defaultValue={v != null ? (isFte ? fmtFte(v) : fmtHc(v)) : ''}
                            placeholder="—"
                            onBlur={e => {
                              const raw = e.target.value.trim()
                              if (raw === '') {
                                if (v != null) upsertEntry(bv, m, { [budgetKey]: undefined })
                                return
                              }
                              const parsed = parseNumber(raw)
                              if (parsed === null) return
                              upsertEntry(bv, m, { [budgetKey]: parsed })
                            }}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          />
                        </td>
                      )
                    })}
                  </tr>
                  {/* Δ-rij — alleen tonen als er ÜBERHAUPT een delta berekenbaar is */}
                  {hasDelta && (
                    <tr style={{ background: 'var(--bg3)' }}>
                      <td style={{ padding: '6px 12px', fontWeight: 700, position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 1 }}>
                        Δ (Actuals − Budget)
                      </td>
                      {deltas.map((d, i) => (
                        <td
                          key={i}
                          className="mono r"
                          style={{
                            padding: '5px 8px', fontWeight: 700,
                            color: d == null ? 'var(--t3)' : d === 0 ? 'var(--t2)' : d <= 0 ? 'var(--green)' : 'var(--red)',
                          }}
                          title={d == null ? 'Actuals of budget niet ingevuld — geen delta' : undefined}
                        >
                          {d == null ? '—' : fmtDelta(d, isFte)}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {/* ── Totaal alle BV's ────────────────────────────────────── */}
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
              {anyBudget && (
                <tr>
                  <td style={{ padding: '6px 12px', fontWeight: 600, color: 'var(--t2)', position: 'sticky', left: 0, background: 'var(--bg2)' }}>Budget</td>
                  {totalRow(budgetKey).map((v, i) => (
                    <td key={i} className="mono r" style={{ padding: '5px 8px', fontWeight: 600, color: 'var(--t2)' }}>{isFte ? fmtFte(v) : fmtHc(v)}</td>
                  ))}
                </tr>
              )}
              {anyBudget && (
                <tr style={{ background: 'var(--bg3)' }}>
                  <td style={{ padding: '6px 12px', fontWeight: 700, position: 'sticky', left: 0, background: 'var(--bg3)' }}>Δ</td>
                  {months.map((_, i) => {
                    const a = totalRow(actualKey)[i]
                    const b = totalRow(budgetKey)[i]
                    const d = (a != null && b != null) ? a - b : null
                    return (
                      <td key={i} className="mono r" style={{
                        padding: '5px 8px', fontWeight: 700,
                        color: d == null ? 'var(--t3)' : d === 0 ? 'var(--t2)' : d <= 0 ? 'var(--green)' : 'var(--red)',
                      }}>
                        {d == null ? '—' : fmtDelta(d, isFte)}
                      </td>
                    )
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--t3)', padding: '8px 0' }}>
        💡 <strong>Tip:</strong> een kostenreductie die samenvalt met een daling in FTE/Headcount is een signaal dat de besparing door lagere bezetting komt, niet door efficiëntie. Open de Budget vs Actuals tab om de koppeling tussen FTE en OPEX te zien.
      </div>
    </div>
  )
}
