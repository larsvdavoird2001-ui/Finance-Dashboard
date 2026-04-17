import { useState, useEffect } from 'react'
import {
  PL_STRUCTURE,
  monthlyActuals2026, monthlyBudget2026,
  ytdActuals2026, ytdBudget2026,
} from '../../data/plData'
import type { EntityName } from '../../data/plData'
import { fmt } from '../../lib/format'
import type { BvId, GlobalFilter } from '../../data/types'
import { useAdjustedActuals } from '../../hooks/useAdjustedActuals'

type PeriodId  = 'jan26' | 'feb26' | 'mar26' | 'ytd26'
type ColType   = 'actual' | 'budget' | 'delta'

const PERIODS: { id: PeriodId; label: string }[] = [
  { id: 'jan26', label: 'Jan-26' },
  { id: 'feb26', label: 'Feb-26' },
  { id: 'mar26', label: 'Mar-26' },
  { id: 'ytd26', label: 'YTD 2026' },
]

const ALL_ENTITIES: EntityName[] = ['Consultancy', 'Projects', 'Software', 'Holdings']

const COL_LABELS: Record<ColType, string> = { actual: 'Actuals', budget: 'Budget', delta: 'Δ' }
const COL_COLORS: Record<ColType, string> = { actual: 'var(--t1)', budget: 'var(--t3)', delta: 'var(--t2)' }

function pctStr(key: string, data: Record<string, number>): string {
  const nom = data['netto_omzet'] ?? 0
  if (nom === 0) return '—'
  const val = key === 'brutomarge_pct' ? (data['brutomarge'] ?? 0) : (data['ebitda'] ?? 0)
  return (val / nom * 100).toFixed(1) + '%'
}

function deltaColor(d: number, key: string): string {
  // For cost lines (negative values), inverse the color logic
  const isCost = key.includes('kosten') || key.includes('amortisatie') || key.includes('afschrijving')
  if (d === 0) return 'var(--t3)'
  if (isCost) return d < 0 ? 'var(--green)' : 'var(--red)'
  return d > 0 ? 'var(--green)' : 'var(--red)'
}

interface Props { filter: GlobalFilter }

export function BudgetTab({ filter }: Props) {
  const [period,    setPeriod]    = useState<PeriodId>('ytd26')
  const [colTypes,  setColTypes]  = useState<Set<ColType>>(new Set(['actual', 'budget', 'delta']))

  const { getMonthly, getYtd } = useAdjustedActuals()

  useEffect(() => {
    if (filter.year === '2025') setPeriod('ytd26')
  }, [filter.year])

  const visibleEntities: EntityName[] = filter.bv === 'all'
    ? ALL_ENTITIES
    : [filter.bv as EntityName, 'Holdings'].filter(e => ALL_ENTITIES.includes(e as EntityName)) as EntityName[]

  const getActuals = (p: PeriodId, e: EntityName): Record<string, number> => {
    if (e === 'Holdings') {
      if (p === 'jan26') return monthlyActuals2026[e]?.['Jan-26'] ?? {}
      if (p === 'feb26') return monthlyActuals2026[e]?.['Feb-26'] ?? {}
      if (p === 'mar26') return monthlyActuals2026[e]?.['Mar-26'] ?? {}
      return ytdActuals2026[e] ?? {}
    }
    if (p === 'jan26') return getMonthly(e as BvId, 'Jan-26')
    if (p === 'feb26') return getMonthly(e as BvId, 'Feb-26')
    if (p === 'mar26') return getMonthly(e as BvId, 'Mar-26')
    return getYtd(e as BvId, ['Jan-26', 'Feb-26', 'Mar-26'])
  }

  const getBudget = (p: PeriodId, e: EntityName): Record<string, number> => {
    if (p === 'jan26') return monthlyBudget2026[e]?.['Jan-26'] ?? {}
    if (p === 'feb26') return monthlyBudget2026[e]?.['Feb-26'] ?? {}
    if (p === 'mar26') return monthlyBudget2026[e]?.['Mar-26'] ?? {}
    return ytdBudget2026[e] ?? {}
  }

  const allActuals: Record<EntityName, Record<string, number>> = Object.fromEntries(
    visibleEntities.map(e => [e, getActuals(period, e)])
  ) as Record<EntityName, Record<string, number>>

  const allBudgets: Record<EntityName, Record<string, number>> = Object.fromEntries(
    visibleEntities.map(e => [e, getBudget(period, e)])
  ) as Record<EntityName, Record<string, number>>

  const totalActuals: Record<string, number> = {}
  const totalBudget:  Record<string, number> = {}
  for (const e of visibleEntities) {
    for (const k of Object.keys(allActuals[e])) {
      totalActuals[k] = (totalActuals[k] ?? 0) + (allActuals[e][k] ?? 0)
    }
    for (const k of Object.keys(allBudgets[e])) {
      totalBudget[k] = (totalBudget[k] ?? 0) + (allBudgets[e][k] ?? 0)
    }
  }

  const periodLabel = PERIODS.find(p => p.id === period)?.label ?? ''
  const activeCols  = (['actual', 'budget', 'delta'] as ColType[]).filter(c => colTypes.has(c))
  const toggleCol   = (c: ColType) => setColTypes(prev => {
    const next = new Set(prev)
    if (next.has(c) && next.size === 1) return prev // keep at least one
    next.has(c) ? next.delete(c) : next.add(c)
    return next
  })

  // Column groups: per visible entity + total
  const entityGroups = [...visibleEntities, 'Totaal' as const]

  const renderCell = (key: string, a: number, b: number, ct: ColType, bold: boolean) => {
    if (ct === 'actual') {
      return <span style={{ fontWeight: bold ? 700 : 400 }}>{fmt(a)}</span>
    }
    if (ct === 'budget') {
      return <span style={{ color: 'var(--t3)', fontWeight: bold ? 600 : 400 }}>{fmt(b)}</span>
    }
    const d = a - b
    if (d === 0) return <span style={{ color: 'var(--t3)' }}>—</span>
    return (
      <span style={{ color: deltaColor(d, key), fontWeight: bold ? 700 : 400 }}>
        {d > 0 ? '+' : ''}{fmt(d)}
      </span>
    )
  }

  return (
    <div className="page">
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Period buttons */}
        <div style={{ display: 'flex', gap: 4 }}>
          {PERIODS.map(p => (
            <button
              key={p.id}
              className={`btn sm${period === p.id ? ' primary' : ' ghost'}`}
              onClick={() => setPeriod(p.id)}
            >{p.label}</button>
          ))}
        </div>

        <div style={{ width: 1, height: 18, background: 'var(--bd2)', margin: '0 2px' }} />

        {/* Column type toggles */}
        <span style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 600 }}>Kolommen:</span>
        {(['actual', 'budget', 'delta'] as ColType[]).map(ct => (
          <button
            key={ct}
            onClick={() => toggleCol(ct)}
            style={{
              padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: colTypes.has(ct) ? 600 : 400,
              cursor: 'pointer', border: '1px solid', fontFamily: 'var(--font)', transition: 'all .12s',
              borderColor: colTypes.has(ct) ? (ct === 'delta' ? 'var(--amber)' : 'var(--blue)') : 'var(--bd2)',
              background:  colTypes.has(ct) ? (ct === 'delta' ? 'rgba(251,191,36,.12)' : 'rgba(77,142,248,.12)') : 'transparent',
              color: colTypes.has(ct) ? (ct === 'delta' ? 'var(--amber)' : 'var(--blue)') : 'var(--t3)',
            }}
          >{COL_LABELS[ct]}</button>
        ))}

        {filter.bv !== 'all' && (
          <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--t3)', background: 'var(--bg3)', padding: '2px 7px', borderRadius: 4, border: '1px solid var(--bd2)' }}>
            {filter.bv}
          </span>
        )}

        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--green)', background: 'var(--bd-green)', padding: '2px 7px', borderRadius: 4 }}>
          ● Live OHW
        </span>
      </div>

      <div className="card">
        <div className="card-hdr">
          <span className="card-title">Budget vs Actuals</span>
          <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--t3)' }}>{periodLabel}</span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ minWidth: 'max-content', borderCollapse: 'collapse' }}>
            <thead>
              {/* Entity header */}
              <tr>
                <th style={{ minWidth: 240, padding: '6px 12px', textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 3 }}>
                  {periodLabel}
                </th>
                {entityGroups.map(eg => {
                  const span = activeCols.length
                  const isTot = eg === 'Totaal'
                  return (
                    <th
                      key={eg}
                      colSpan={span}
                      style={{
                        textAlign: 'center', padding: '5px 8px', fontSize: 11,
                        fontWeight: isTot ? 700 : 600,
                        borderLeft: '1px solid var(--bd2)',
                        color: isTot ? 'var(--t1)' : 'var(--t2)',
                        minWidth: span * 105,
                      }}
                    >
                      {eg}
                    </th>
                  )
                })}
              </tr>
              {/* Sub-header: col type labels */}
              <tr style={{ background: 'var(--bg3)' }}>
                <th style={{ position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 3, padding: '4px 12px' }} />
                {entityGroups.map(eg => activeCols.map(ct => (
                  <th
                    key={`${eg}-${ct}`}
                    className="r"
                    style={{
                      minWidth: 105, padding: '3px 8px', fontSize: 10, fontWeight: 600,
                      color: COL_COLORS[ct],
                      borderLeft: ct === activeCols[0] ? '1px solid var(--bd2)' : undefined,
                    }}
                  >
                    {COL_LABELS[ct]}
                  </th>
                )))}
              </tr>
            </thead>

            <tbody>
              {PL_STRUCTURE.map(item => {
                if (item.isSeparator) {
                  return (
                    <tr key={item.key}>
                      <td colSpan={1 + entityGroups.length * activeCols.length} style={{ padding: 0, height: 1, background: 'var(--bd)' }} />
                    </tr>
                  )
                }

                if (item.isPercentage) {
                  return (
                    <tr key={item.key} style={{ background: 'var(--bg1)' }}>
                      <td style={{ padding: '3px 12px', fontSize: 10, color: 'var(--t3)', fontStyle: 'italic', position: 'sticky', left: 0, background: 'var(--bg1)', zIndex: 1 }}>
                        {item.label}
                      </td>
                      {entityGroups.map(eg => activeCols.map(ct => {
                        const a = eg === 'Totaal' ? totalActuals : allActuals[eg as EntityName]
                        const b = eg === 'Totaal' ? totalBudget  : allBudgets[eg as EntityName]
                        const d = ct === 'budget' ? b : a
                        return (
                          <td key={`${eg}-${ct}`} className="mono r" style={{ padding: '3px 8px', fontSize: 10, color: 'var(--t3)', borderLeft: ct === activeCols[0] ? '1px solid var(--bd2)' : undefined }}>
                            {pctStr(item.key, d)}
                          </td>
                        )
                      }))}
                    </tr>
                  )
                }

                return (
                  <tr key={item.key} style={{ background: item.isBold ? 'var(--bg3)' : undefined }}>
                    <td style={{
                      padding: '4px 12px', paddingLeft: 12 + (item.indent ?? 0) * 14,
                      fontWeight: item.isBold ? 700 : 400,
                      position: 'sticky', left: 0, zIndex: 1,
                      background: item.isBold ? 'var(--bg3)' : 'var(--bg2)',
                    }}>
                      {item.label}
                    </td>
                    {entityGroups.map(eg => {
                      const a = eg === 'Totaal' ? (totalActuals[item.key] ?? 0) : (allActuals[eg as EntityName][item.key] ?? 0)
                      const b = eg === 'Totaal' ? (totalBudget[item.key]  ?? 0) : (allBudgets[eg as EntityName][item.key] ?? 0)
                      return activeCols.map(ct => (
                        <td
                          key={`${eg}-${ct}`}
                          className="mono r"
                          style={{
                            padding: '4px 8px',
                            borderLeft: ct === activeCols[0] ? '1px solid var(--bd2)' : undefined,
                            fontWeight: item.isBold ? 700 : 400,
                          }}
                        >
                          {renderCell(item.key, a, b, ct, item.isBold ?? false)}
                        </td>
                      ))
                    })}
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
