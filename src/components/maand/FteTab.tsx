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

  const getVal = (bv: BvId, month: string, key: 'fte' | 'headcount' | 'fteBudget' | 'headcountBudget'): number | undefined => {
    return entries.find(e => e.bv === bv && e.month === month)?.[key]
  }

  // ── Totaal-rij (som over 3 BV's) per maand ──
  const totalRow = (key: 'fte' | 'headcount' | 'fteBudget' | 'headcountBudget') =>
    months.map(m => {
      const vals = BVS.map(bv => getVal(bv, m, key)).filter((v): v is number => v != null)
      if (vals.length === 0) return null
      return vals.reduce((s, v) => s + v, 0)
    })

  const isFte = metric === 'fte'
  const actualKey = metric
  const budgetKey = metric === 'fte' ? 'fteBudget' : 'headcountBudget'
  const unit = isFte ? 'FTE' : 'Headcount'

  return (
    <div className="page">
      {/* ── Header: jaar + metric switch ─────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="tabs-row">
          {FTE_YEARS.map(y => (
            <button key={y} className={`tab${year === y ? ' active' : ''}`} onClick={() => setYear(y)}>{y}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg3)', padding: 3, borderRadius: 6 }}>
          {(['fte', 'headcount'] as Metric[]).map(m => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              style={{
                padding: '5px 12px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                background: metric === m ? 'var(--bg1)' : 'transparent',
                color: metric === m ? 'var(--t1)' : 'var(--t3)',
                border: '1px solid',
                borderColor: metric === m ? 'var(--bd2)' : 'transparent',
                cursor: 'pointer',
              }}
            >
              {m === 'fte' ? 'FTE' : 'Headcount'}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>
          Per BV per maand — actuals en budget naast elkaar, met delta ten opzichte van budget.
        </span>
      </div>

      {/* ── Per-BV tabellen — één card per BV met actuals + budget + Δ ── */}
      {BVS.map(bv => {
        const actuals = months.map(m => getVal(bv, m, actualKey))
        const budgets = months.map(m => getVal(bv, m, budgetKey))
        const deltas = months.map((_, i) => {
          const a = actuals[i]; const b = budgets[i]
          if (a == null || b == null) return null
          return a - b
        })
        const ytdActual = actuals.reduce<number>((s, v) => s + (v ?? 0), 0)
        const ytdBudget = budgets.reduce<number>((s, v) => s + (v ?? 0), 0)
        const ytdActualCount = actuals.filter(v => v != null).length
        const ytdBudgetCount = budgets.filter(v => v != null).length
        const avgActual = ytdActualCount > 0 ? ytdActual / ytdActualCount : null
        const avgBudget = ytdBudgetCount > 0 ? ytdBudget / ytdBudgetCount : null

        return (
          <div key={bv} className="card" style={{ overflow: 'visible' }}>
            <div className="card-hdr">
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: BV_COLORS[bv], marginRight: 8 }} />
              <span className="card-title">{bv}</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 14, fontSize: 11, color: 'var(--t3)' }}>
                <span>Gemiddeld actuals: <strong style={{ color: 'var(--t1)', fontFamily: 'var(--mono)' }}>
                  {isFte ? fmtFte(avgActual) : fmtHc(avgActual)}
                </strong></span>
                <span>Gemiddeld budget: <strong style={{ color: 'var(--t2)', fontFamily: 'var(--mono)' }}>
                  {isFte ? fmtFte(avgBudget) : fmtHc(avgBudget)}
                </strong></span>
                {avgActual != null && avgBudget != null && (
                  <span>Δ YTD: <strong style={{
                    color: (avgActual - avgBudget) <= 0 ? 'var(--green)' : 'var(--red)',
                    fontFamily: 'var(--mono)',
                  }}>
                    {fmtDelta(avgActual - avgBudget, isFte)}
                  </strong></span>
                )}
              </span>
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
                    <td style={{ padding: '6px 12px', fontWeight: 600, position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 1 }}>
                      Actuals
                    </td>
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
                              const parsed = parseNumber(e.target.value)
                              if (parsed === null && !e.target.value.trim()) return
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
                              const parsed = parseNumber(e.target.value)
                              if (parsed === null && !e.target.value.trim()) return
                              if (parsed === null) return
                              upsertEntry(bv, m, { [budgetKey]: parsed })
                            }}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          />
                        </td>
                      )
                    })}
                  </tr>

                  {/* Δ-rij (actuals - budget) */}
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
                      >
                        {d == null ? '—' : fmtDelta(d, isFte)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {/* ── Summary per maand over alle BVs samen ───────────────── */}
      <div className="card" style={{ overflow: 'visible' }}>
        <div className="card-hdr">
          <span className="card-title">Totaal alle BV's — {unit}</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>Totalen per maand voor Consultancy + Projects + Software</span>
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
              <tr>
                <td style={{ padding: '6px 12px', fontWeight: 600, color: 'var(--t2)', position: 'sticky', left: 0, background: 'var(--bg2)' }}>Budget</td>
                {totalRow(budgetKey).map((v, i) => (
                  <td key={i} className="mono r" style={{ padding: '5px 8px', fontWeight: 600, color: 'var(--t2)' }}>{isFte ? fmtFte(v) : fmtHc(v)}</td>
                ))}
              </tr>
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
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Hint ─────────────────────────────────────────────────── */}
      <div style={{ fontSize: 11, color: 'var(--t3)', padding: '8px 0' }}>
        💡 <strong>Tip:</strong> deze data kun je gebruiken om kosten-afwijkingen in de Maandafsluiting te linken aan FTE-bewegingen. Een kostenreductie die samenvalt met een daling in FTE/headcount is een signaal dat de reductie door lagere bezetting komt, niet door efficiëntie.
      </div>
    </div>
  )
}
