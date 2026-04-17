import { useState, useEffect } from 'react'
import {
  PL_STRUCTURE,
  monthlyActuals2026, monthlyBudget2026,
  ytdActuals2025, ytdBudget2025,
  ytdActuals2026, ytdBudget2026,
} from '../../data/plData'
import type { EntityName } from '../../data/plData'
import { fmt } from '../../lib/format'
import type { BvId, GlobalFilter } from '../../data/types'
import { useAdjustedActuals } from '../../hooks/useAdjustedActuals'

type PeriodId = 'jan26' | 'feb26' | 'mar26' | 'ytd26' | 'fy25'
type EntityTab = 'Totaal' | EntityName

const PERIODS: { id: PeriodId; label: string }[] = [
  { id: 'jan26', label: 'Jan-26' },
  { id: 'feb26', label: 'Feb-26' },
  { id: 'mar26', label: 'Mar-26' },
  { id: 'ytd26', label: 'YTD 2026' },
  { id: 'fy25',  label: 'FY 2025' },
]

const ENTITY_TABS: { id: EntityTab; label: string }[] = [
  { id: 'Totaal',      label: 'Totaal' },
  { id: 'Consultancy', label: 'Consultancy' },
  { id: 'Projects',    label: 'Projects' },
  { id: 'Software',    label: 'Software' },
  { id: 'Holdings',    label: 'Holdings' },
]

const ALL_ENTITIES: EntityName[] = ['Consultancy', 'Projects', 'Software', 'Holdings']
const BV_ENTITIES: EntityName[]  = ['Consultancy', 'Projects', 'Software']

function pctStr(key: string, data: Record<string, number>): string {
  const nom = data['netto_omzet'] ?? 0
  if (nom === 0) return '—'
  const val = key === 'brutomarge_pct' ? (data['brutomarge'] ?? 0) : (data['ebitda'] ?? 0)
  return (val / nom * 100).toFixed(1) + '%'
}

interface Props { filter: GlobalFilter }

export function PlTab({ filter }: Props) {
  const [period, setPeriod] = useState<PeriodId>('ytd26')
  const [entity, setEntity] = useState<EntityTab>('Totaal')

  // Sync entity tab with global BV filter
  useEffect(() => {
    if (filter.bv !== 'all') setEntity(filter.bv as EntityTab)
    else setEntity('Totaal')
  }, [filter.bv])

  // Sync period with year filter
  useEffect(() => {
    if (filter.year === '2025') setPeriod('fy25')
    else if (period === 'fy25') setPeriod('ytd26')
  }, [filter.year])

  const { getMonthly, getYtd } = useAdjustedActuals()

  const getActuals = (p: PeriodId, e: EntityName): Record<string, number> => {
    // Holdings: always use static data (no OHW/closing data for Holdings)
    if (e === 'Holdings') {
      if (p === 'jan26') return monthlyActuals2026[e]?.['Jan-26'] ?? {}
      if (p === 'feb26') return monthlyActuals2026[e]?.['Feb-26'] ?? {}
      if (p === 'mar26') return monthlyActuals2026[e]?.['Mar-26'] ?? {}
      if (p === 'ytd26') return ytdActuals2026[e] ?? {}
      return ytdActuals2025[e] ?? {}
    }
    // Live data for Consultancy / Projects / Software
    if (p === 'jan26') return getMonthly(e as BvId, 'Jan-26')
    if (p === 'feb26') return getMonthly(e as BvId, 'Feb-26')
    if (p === 'mar26') return getMonthly(e as BvId, 'Mar-26')
    if (p === 'ytd26') return getYtd(e as BvId, ['Jan-26', 'Feb-26', 'Mar-26'])
    return ytdActuals2025[e] ?? {}
  }

  const getBudget = (p: PeriodId, e: EntityName): Record<string, number> => {
    if (p === 'jan26') return monthlyBudget2026[e]?.['Jan-26'] ?? {}
    if (p === 'feb26') return monthlyBudget2026[e]?.['Feb-26'] ?? {}
    if (p === 'mar26') return monthlyBudget2026[e]?.['Mar-26'] ?? {}
    if (p === 'ytd26') return ytdBudget2026[e] ?? {}
    return ytdBudget2025[e] ?? {}
  }

  function sumAll(p: PeriodId, getter: (pp: PeriodId, e: EntityName) => Record<string, number>): Record<string, number> {
    const result: Record<string, number> = {}
    for (const ent of ALL_ENTITIES) {
      const d = getter(p, ent)
      for (const k of Object.keys(d)) result[k] = (result[k] ?? 0) + (d[k] ?? 0)
    }
    return result
  }

  // When BV filter active, aggregate only over that BV (+ Holdings for Totaal)
  function sumFiltered(p: PeriodId, getter: (pp: PeriodId, e: EntityName) => Record<string, number>): Record<string, number> {
    const result: Record<string, number> = {}
    const ents: EntityName[] = filter.bv === 'all' ? ALL_ENTITIES : [filter.bv as EntityName]
    for (const ent of ents) {
      const d = getter(p, ent)
      for (const k of Object.keys(d)) result[k] = (result[k] ?? 0) + (d[k] ?? 0)
    }
    return result
  }

  const actuals = entity === 'Totaal'
    ? sumFiltered(period, getActuals)
    : getActuals(period, entity)

  const budget = entity === 'Totaal'
    ? (filter.bv === 'all' ? sumAll(period, getBudget) : getBudget(period, filter.bv as EntityName))
    : getBudget(period, entity)

  const periodLabel = PERIODS.find(p => p.id === period)?.label ?? ''

  // Filter visible entity tabs based on global BV filter
  const visibleEntityTabs = filter.bv === 'all'
    ? ENTITY_TABS
    : ENTITY_TABS.filter(t => t.id === 'Totaal' || t.id === filter.bv)

  const is2025 = period === 'fy25'

  return (
    <div className="page">
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {PERIODS.filter(p => filter.year === '2025' ? p.id === 'fy25' : p.id !== 'fy25').map(p => (
          <button
            key={p.id}
            className={`btn sm${period === p.id ? ' primary' : ' ghost'}`}
            onClick={() => setPeriod(p.id)}
          >{p.label}</button>
        ))}
        <div style={{ borderLeft: '1px solid var(--bd2)', margin: '0 4px', height: 18 }} />
        {visibleEntityTabs.map(e => (
          <button
            key={e.id}
            className={`btn sm${entity === e.id ? ' primary' : ' ghost'}`}
            onClick={() => setEntity(e.id)}
          >{e.label}</button>
        ))}
        {filter.bv !== 'all' && (
          <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--t3)', background: 'var(--bg3)', padding: '2px 7px', borderRadius: 4, border: '1px solid var(--bd2)' }}>
            Gefilterd: {filter.bv}
          </span>
        )}
      </div>

      <div className="card">
        <div className="card-hdr">
          <span className="card-title">P&amp;L Dashboard</span>
          <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--t3)' }}>{entity} — {periodLabel}</span>
          {!is2025 && (
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--green)', background: 'var(--bd-green)', padding: '2px 7px', borderRadius: 4 }}>
              ● Live OHW data
            </span>
          )}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ minWidth: 560, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ minWidth: 280, padding: '6px 12px', textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 2 }}>Omschrijving</th>
                <th className="r" style={{ minWidth: 130, padding: '6px 8px' }}>Actuals</th>
                <th className="r" style={{ minWidth: 130, padding: '6px 8px' }}>Budget</th>
                <th className="r" style={{ minWidth: 130, padding: '6px 8px' }}>Delta</th>
              </tr>
            </thead>
            <tbody>
              {PL_STRUCTURE.map(item => {
                if (item.isSeparator) {
                  return (
                    <tr key={item.key}>
                      <td colSpan={4} style={{ padding: 0, height: 1, background: 'var(--bd)' }} />
                    </tr>
                  )
                }

                if (item.isPercentage) {
                  return (
                    <tr key={item.key} style={{ background: 'var(--bg1)' }}>
                      <td style={{
                        padding: '4px 12px', fontSize: 11, color: 'var(--t3)', fontStyle: 'italic',
                        position: 'sticky', left: 0, background: 'var(--bg1)', zIndex: 1,
                      }}>{item.label}</td>
                      <td className="mono r" style={{ padding: '4px 8px', fontSize: 11, color: 'var(--t2)' }}>{pctStr(item.key, actuals)}</td>
                      <td className="mono r" style={{ padding: '4px 8px', fontSize: 11, color: 'var(--t3)' }}>{pctStr(item.key, budget)}</td>
                      <td />
                    </tr>
                  )
                }

                const a = actuals[item.key] ?? 0
                const b = budget[item.key] ?? 0
                const delta = a - b

                return (
                  <tr key={item.key} style={{ background: item.isBold ? 'var(--bg3)' : undefined }}>
                    <td style={{
                      padding: '5px 12px',
                      paddingLeft: 12 + (item.indent ?? 0) * 16,
                      fontWeight: item.isBold ? 700 : 400,
                      position: 'sticky', left: 0,
                      background: item.isBold ? 'var(--bg3)' : 'var(--bg2)',
                      zIndex: 1,
                    }}>{item.label}</td>
                    <td className="mono r" style={{ padding: '5px 8px', fontWeight: item.isBold ? 700 : 400 }}>{fmt(a)}</td>
                    <td className="mono r" style={{ padding: '5px 8px', color: 'var(--t3)' }}>{fmt(b)}</td>
                    <td className="mono r" style={{ padding: '5px 8px' }}>
                      {delta !== 0 ? (
                        <span style={{ color: delta > 0 ? 'var(--green)' : 'var(--red)', fontWeight: item.isBold ? 700 : 400 }}>
                          {delta > 0 ? '+' : ''}{fmt(delta)}
                        </span>
                      ) : <span style={{ color: 'var(--t3)' }}>—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* BV breakdown for Totaal view */}
      {entity === 'Totaal' && !is2025 && (
        <div className="card">
          <div className="card-hdr">
            <span className="card-title">Netto-omzet per BV — {periodLabel}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>Live · €</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>BV</th>
                  <th className="r">Netto-omzet</th>
                  <th className="r">Budget</th>
                  <th className="r">Δ Budget</th>
                  <th className="r">Brutomarge</th>
                  <th className="r">Marge %</th>
                  <th className="r">EBITDA</th>
                </tr>
              </thead>
              <tbody>
                {BV_ENTITIES.filter(bv => filter.bv === 'all' || bv === filter.bv).map(bv => {
                  const a = getActuals(period, bv)
                  const b = getBudget(period, bv)
                  const rev = a['netto_omzet'] ?? 0
                  const bud = b['netto_omzet'] ?? 0
                  const gm  = a['brutomarge']  ?? 0
                  const ebt = a['ebitda']       ?? 0
                  const pct = rev > 0 ? gm / rev * 100 : 0
                  const BV_COLORS: Record<string, string> = { Consultancy: '#4d8ef8', Projects: '#26c997', Software: '#8b5cf6' }
                  return (
                    <tr key={bv}>
                      <td>
                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: BV_COLORS[bv], marginRight: 6 }} />
                        <strong>{bv}</strong>
                      </td>
                      <td className="mono r">{fmt(rev)}</td>
                      <td className="mono r" style={{ color: 'var(--t3)' }}>{fmt(bud)}</td>
                      <td className="mono r" style={{ color: rev - bud >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                        {rev - bud >= 0 ? '+' : ''}{fmt(rev - bud)}
                      </td>
                      <td className="mono r" style={{ color: gm >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{fmt(gm)}</td>
                      <td className="mono r" style={{ color: pct >= 30 ? 'var(--green)' : pct >= 20 ? 'var(--amber)' : 'var(--red)' }}>{pct.toFixed(1)}%</td>
                      <td className="mono r">{fmt(ebt)}</td>
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
