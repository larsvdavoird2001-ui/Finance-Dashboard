import { useState } from 'react'
import type { OhwYearData, OhwEntityData } from '../../data/types'
import { fmt, gv } from '../../lib/format'
import { OhwEntityBlock } from './OhwEntityBlock'

interface Props {
  data2025: OhwYearData
  data2026: OhwYearData
  onEntityChange: (year: '2025' | '2026', entity: OhwEntityData) => void
  showToast: (msg: string, type?: 'g' | 'r') => void
}

const BV_COLORS: Record<string, string> = {
  Projects:    'var(--green)',
  Consultancy: 'var(--blue)',
  Software:    'var(--purple)',
}

export function OhwTab({ data2025, data2026, onEntityChange, showToast }: Props) {
  const [year, setYear] = useState<'2025' | '2026'>('2026')
  const yearData = year === '2025' ? data2025 : data2026
  const { displayMonths, entities } = yearData

  const summaryRows = ['Consultancy', 'Projects', 'Software']

  // Netto omzet totals for summary
  const lastM = displayMonths[displayMonths.length - 1]
  const prevM = displayMonths[displayMonths.length - 2]

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="tabs-row">
          {(['2025', '2026'] as const).map(y => (
            <button key={y} className={`tab${year === y ? ' active' : ''}`} onClick={() => setYear(y)}>{y}</button>
          ))}
        </div>
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>{displayMonths[0]} – {displayMonths[displayMonths.length - 1]}</span>
      </div>

      {/* ── Summary table ─────────────────────────────────────────── */}
      <div className="card" style={{ overflow: 'visible' }}>
        <div className="card-hdr">
          <span className="card-title">Onderhanden Werk — Overzicht</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>Totaal onderhanden per BV · €</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ minWidth: 'max-content', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ minWidth: 160, position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 3 }}>Entiteit</th>
                {displayMonths.map(m => <th key={m} className="r" style={{ minWidth: 130, background: 'var(--bg3)' }}>{m}</th>)}
                <th className="r" style={{ minWidth: 120, background: 'var(--bg3)' }}>Δ vs vorige</th>
                <th className="r" style={{ minWidth: 130, background: 'var(--bg3)' }}>Netto Omzet</th>
                <th className="r" style={{ minWidth: 120, background: 'var(--bg3)' }}>Budget</th>
                <th className="r" style={{ minWidth: 110, background: 'var(--bg3)' }}>Δ Budget</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map(ent => {
                const e = entities.find(x => x.entity === ent)
                if (!e) return null
                const vals = displayMonths.map(m => gv(e.totaalOnderhanden, m))
                const last = vals[vals.length - 1]
                const prev = vals.length >= 2 ? vals[vals.length - 2] : 0
                const diff = last - prev
                const netOmzet = gv(e.nettoOmzet, lastM)
                const budget   = gv(e.budget, lastM)
                const deltaBudget = gv(e.delta, lastM)
                return (
                  <tr key={ent}>
                    <td style={{ position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 2, boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: BV_COLORS[ent], marginRight: 7 }} />
                      <strong>{ent}</strong>
                    </td>
                    {vals.map((v, i) => <td key={i} className="mono r" style={{ background: 'var(--bg2)' }}>{fmt(v)}</td>)}
                    <td className={`mono r ${diff >= 0 ? 'rv' : 'g'}`} style={{ background: 'var(--bg2)', fontWeight: 600 }}>{diff >= 0 ? '+' : ''}{fmt(diff)}</td>
                    <td className="mono r" style={{ background: 'var(--bg2)', color: 'var(--t1)', fontWeight: 600 }}>{fmt(netOmzet)}</td>
                    <td className="mono r" style={{ background: 'var(--bg2)', color: 'var(--t3)' }}>{budget ? fmt(budget) : '—'}</td>
                    <td className="mono r" style={{ background: 'var(--bg2)', color: deltaBudget >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {budget ? (deltaBudget >= 0 ? '+' : '') + fmt(deltaBudget) : '—'}
                    </td>
                  </tr>
                )
              })}
              <tr className="tot">
                <td style={{ position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 2, boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.06)', fontWeight: 700 }}>Totaal</td>
                {displayMonths.map((m, i) => {
                  const tot = entities.reduce((s, e) => s + gv(e.totaalOnderhanden, m), 0)
                  return <td key={i} className="mono r" style={{ background: 'var(--bg3)' }}>{fmt(tot)}</td>
                })}
                <td className="mono r" style={{ background: 'var(--bg3)' }}>
                  {(() => {
                    const last2 = entities.reduce((s, e) => s + gv(e.totaalOnderhanden, lastM), 0)
                    const prev2 = prevM ? entities.reduce((s, e) => s + gv(e.totaalOnderhanden, prevM), 0) : 0
                    const d = last2 - prev2
                    return <span style={{ color: d >= 0 ? 'var(--red)' : 'var(--green)' }}>{d >= 0 ? '+' : ''}{fmt(d)}</span>
                  })()}
                </td>
                <td className="mono r" style={{ background: 'var(--bg3)', fontWeight: 700 }}>{fmt(entities.reduce((s, e) => s + gv(e.nettoOmzet, lastM), 0))}</td>
                <td className="mono r" style={{ background: 'var(--bg3)', color: 'var(--t3)' }}>{fmt(entities.reduce((s, e) => s + gv(e.budget, lastM), 0))}</td>
                <td className="mono r" style={{ background: 'var(--bg3)' }}>
                  {(() => {
                    const d = entities.reduce((s, e) => s + gv(e.delta, lastM), 0)
                    return <span style={{ color: d >= 0 ? 'var(--green)' : 'var(--red)' }}>{d >= 0 ? '+' : ''}{fmt(d)}</span>
                  })()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Entity blocks ─────────────────────────────────────────── */}
      {entities.map(entity => (
        <OhwEntityBlock
          key={entity.entity}
          entity={entity}
          displayMonths={displayMonths}
          onChange={updated => onEntityChange(year, updated)}
          onSave={() => showToast(`OHW ${entity.entity} opgeslagen`, 'g')}
        />
      ))}
    </div>
  )
}
