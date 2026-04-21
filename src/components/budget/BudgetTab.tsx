import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import {
  PL_STRUCTURE,
  monthlyActuals2026, monthlyBudget2026,
  ytdActuals2026, ytdBudget2026,
  ytdActuals2025, ytdBudget2025,
} from '../../data/plData'
import { monthlyActuals2025, monthlyBudget2025, MONTHS_2025_LABELS } from '../../data/plData2025'
import type { EntityName } from '../../data/plData'
import { fmt } from '../../lib/format'
import type { BvId, GlobalFilter } from '../../data/types'
import { useAdjustedActuals } from '../../hooks/useAdjustedActuals'

type ColType = 'actual' | 'budget' | 'delta'

interface Period { id: string; label: string; year: '2025' | '2026'; month?: string; ytdMonths?: string[] }

const PERIODS_2026: Period[] = [
  { id: 'jan26', label: 'Jan-26', year: '2026', month: 'Jan-26' },
  { id: 'feb26', label: 'Feb-26', year: '2026', month: 'Feb-26' },
  { id: 'mar26', label: 'Mar-26', year: '2026', month: 'Mar-26' },
  { id: 'ytd26', label: 'YTD 2026', year: '2026', ytdMonths: ['Jan-26', 'Feb-26', 'Mar-26'] },
]

const PERIODS_2025: Period[] = [
  ...MONTHS_2025_LABELS.map(m => ({ id: m.toLowerCase().replace('-', ''), label: m, year: '2025' as const, month: m })),
  { id: 'ytd25', label: 'YTD 2025', year: '2025', ytdMonths: MONTHS_2025_LABELS },
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
  const periods: Period[] = filter.year === '2025' ? PERIODS_2025 : PERIODS_2026
  const defaultPeriod = filter.year === '2025' ? 'ytd25' : 'ytd26'

  const [period,    setPeriod]    = useState<string>(defaultPeriod)
  const [colTypes,  setColTypes]  = useState<Set<ColType>>(new Set(['actual', 'budget', 'delta']))

  const { getMonthly, getYtd } = useAdjustedActuals()

  // When year changes, jump to that year's YTD period (prevents mismatch: 2026 periods shown while 2025 selected)
  useEffect(() => {
    setPeriod(filter.year === '2025' ? 'ytd25' : 'ytd26')
  }, [filter.year])

  const visibleEntities: EntityName[] = filter.bv === 'all'
    ? ALL_ENTITIES
    : [filter.bv as EntityName, 'Holdings'].filter(e => ALL_ENTITIES.includes(e as EntityName)) as EntityName[]

  const currentPeriod = periods.find(p => p.id === period) ?? periods[periods.length - 1]

  const getActuals = (p: Period, e: EntityName): Record<string, number> => {
    if (p.year === '2025') {
      if (p.month) return monthlyActuals2025[e]?.[p.month] ?? {}
      return ytdActuals2025[e] ?? {}
    }
    // 2026
    if (e === 'Holdings') {
      if (p.month) return monthlyActuals2026[e]?.[p.month] ?? {}
      return ytdActuals2026[e] ?? {}
    }
    if (p.month) return getMonthly(e as BvId, p.month)
    return getYtd(e as BvId, p.ytdMonths ?? [])
  }

  const getBudget = (p: Period, e: EntityName): Record<string, number> => {
    if (p.year === '2025') {
      if (p.month) return monthlyBudget2025[e]?.[p.month] ?? {}
      return ytdBudget2025[e] ?? {}
    }
    if (p.month) return monthlyBudget2026[e]?.[p.month] ?? {}
    return ytdBudget2026[e] ?? {}
  }

  const allActuals: Record<EntityName, Record<string, number>> = Object.fromEntries(
    visibleEntities.map(e => [e, getActuals(currentPeriod, e)])
  ) as Record<EntityName, Record<string, number>>

  const allBudgets: Record<EntityName, Record<string, number>> = Object.fromEntries(
    visibleEntities.map(e => [e, getBudget(currentPeriod, e)])
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

  const periodLabel = currentPeriod.label
  const activeCols  = (['actual', 'budget', 'delta'] as ColType[]).filter(c => colTypes.has(c))
  const toggleCol   = (c: ColType) => setColTypes(prev => {
    const next = new Set(prev)
    if (next.has(c) && next.size === 1) return prev // keep at least one
    next.has(c) ? next.delete(c) : next.add(c)
    return next
  })

  // Column groups: per visible entity + total
  const entityGroups = [...visibleEntities, 'Totaal' as const]

  // ── Excel export met huidige filters (periode, BV, kolomtypes) ──
  const exportExcel = () => {
    const header: (string | number)[] = [`${periodLabel} — Regel`]
    for (const eg of entityGroups) {
      for (const ct of activeCols) header.push(`${eg} — ${COL_LABELS[ct]}`)
    }
    const rows: (string | number)[][] = [header]

    for (const item of PL_STRUCTURE) {
      if (item.isSeparator) continue
      const label = '  '.repeat(item.indent ?? 0) + item.label
      const row: (string | number)[] = [label]
      if (item.isPercentage) {
        for (const eg of entityGroups) {
          const a = eg === 'Totaal' ? totalActuals : allActuals[eg as EntityName]
          const b = eg === 'Totaal' ? totalBudget  : allBudgets[eg as EntityName]
          for (const ct of activeCols) {
            const d = ct === 'budget' ? b : a
            row.push(pctStr(item.key, d))
          }
        }
      } else {
        for (const eg of entityGroups) {
          const a = eg === 'Totaal' ? (totalActuals[item.key] ?? 0) : (allActuals[eg as EntityName]?.[item.key] ?? 0)
          const b = eg === 'Totaal' ? (totalBudget[item.key]  ?? 0) : (allBudgets[eg as EntityName]?.[item.key] ?? 0)
          for (const ct of activeCols) {
            if (ct === 'actual') row.push(a)
            else if (ct === 'budget') row.push(b)
            else row.push(a - b)
          }
        }
      }
      rows.push(row)
    }

    const ws = XLSX.utils.aoa_to_sheet(rows)
    // Formatteer getallen: Nederlandse euro-notatie
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      for (let c = range.s.c + 1; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c })
        const cell = ws[addr]
        if (cell && typeof cell.v === 'number') cell.z = '#,##0;-#,##0;-'
      }
    }
    // Auto-width per kolom
    ws['!cols'] = header.map((h, i) => ({
      wch: i === 0 ? 32 : Math.max(12, String(h).length + 2),
    }))

    const bvSuffix = filter.bv === 'all' ? 'alle-BVs' : filter.bv
    const fileName = `Budget-vs-Actuals_${periodLabel.replace(/\s+/g, '-')}_${bvSuffix}.xlsx`

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `Budget vs Actuals`)
    XLSX.writeFile(wb, fileName)
  }

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
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {periods.map(p => (
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
              background:  colTypes.has(ct) ? (ct === 'delta' ? 'rgba(251,191,36,.12)' : 'rgba(0,169,224,.12)') : 'transparent',
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

        <button
          className="btn sm success"
          onClick={exportExcel}
          title={`Exporteer huidige selectie (${periodLabel}${filter.bv !== 'all' ? ' · ' + filter.bv : ''}) naar Excel`}
          style={{ fontSize: 11 }}
        >
          ↓ Excel export
        </button>
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
