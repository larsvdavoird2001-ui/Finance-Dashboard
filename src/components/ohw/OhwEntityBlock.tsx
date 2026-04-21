import { memo, useState, useCallback } from 'react'
import type { OhwEntityData } from '../../data/types'
import { fmt, gv } from '../../lib/format'
import { OhwSection } from './OhwSection'
import { IcSection } from './IcSection'
import { MetricRow } from './MetricRow'

interface Props {
  entity: OhwEntityData
  displayMonths: string[]
  onChange: (updated: OhwEntityData) => void
  /** @deprecated auto-opslaan is nu actief; dit is kosmetisch */
  onSave?: () => void
}

const STICKY: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 2,
  boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.08)',
}

export const OhwEntityBlock = memo(function OhwEntityBlock({ entity, displayMonths, onChange, onSave: _onSave }: Props) {
  const [open, setOpen] = useState(true)
  const isSoftware = entity.entity === 'Software'
  const nc = displayMonths.length
  const lastTot = gv(entity.totaalOnderhanden, displayMonths[nc - 1])
  const firstTot = gv(entity.totaalOnderhanden, displayMonths[0])
  const lastActualTot = gv(entity.totaalOnderhanden, displayMonths[1] ?? displayMonths[0])

  const handleSectionChange = useCallback((idx: number, updated: typeof entity.onderhanden[0]) => {
    const onderhanden = entity.onderhanden.map((s, i) => i === idx ? updated : s)
    onChange({ ...entity, onderhanden })
  }, [entity, onChange])

  const addSection = useCallback(() => {
    const id = `sec-${Date.now()}`
    onChange({
      ...entity,
      onderhanden: [...entity.onderhanden, { id, title: 'Nieuw onderdeel', rows: [] }],
    })
  }, [entity, onChange])

  const handleICChange = useCallback((rows: typeof entity.icVerrekening) =>
    onChange({ ...entity, icVerrekening: rows }), [entity, onChange])

  return (
    <div className="ohw-blk">
      {/* ── Header (always visible) ─────────────────────────────── */}
      <div className={`ohw-hdr${open ? ' open' : ''}`} style={{ borderRadius: open ? 'var(--r2) var(--r2) 0 0' : 'var(--r2)' }} onClick={() => setOpen(o => !o)}>
        <span className="tog">▶</span>
        <span style={{ fontWeight: 700, fontSize: 13.5 }}>{entity.entity}</span>
        <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--t3)', display: 'flex', gap: 12 }}>
          {displayMonths.slice(0, 2).map(m => (
            <span key={m}>
              {m}: <strong style={{ color: 'var(--t1)' }}>{fmt(gv(entity.totaalOnderhanden, m))}</strong>
            </span>
          ))}
          {nc > 2 && (
            <span>
              {displayMonths[nc - 1]}: <strong style={{ color: gv(entity.totaalOnderhanden, displayMonths[nc - 1]) > 0 ? 'var(--amber)' : 'var(--t1)' }}>
                {fmt(gv(entity.totaalOnderhanden, displayMonths[nc - 1]))}
              </strong>
            </span>
          )}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)' }}>
          Δ YTD: <strong style={{ color: lastActualTot - firstTot >= 0 ? 'var(--amber)' : 'var(--green)' }}>
            {lastActualTot - firstTot >= 0 ? '+' : ''}{fmt(lastActualTot - firstTot)}
          </strong>
          &nbsp;&nbsp;OHW: <strong style={{ color: 'var(--t1)' }}>{fmt(lastTot)}</strong>
        </span>
        <div style={{ marginLeft: 12, display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
          <button className="btn sm ghost" style={{ fontSize: 10 }} onClick={addSection}>+ Rubriek</button>
          <span
            style={{
              fontSize: 10, color: 'var(--green)',
              background: 'var(--bd-green)', padding: '2px 8px', borderRadius: 4,
              border: '1px solid var(--green)', fontWeight: 600,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
            title="Elke wijziging wordt direct opgeslagen"
          >
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', animation: 'pulse 2s infinite' }} />
            Auto-opslaan
          </span>
        </div>
      </div>

      {/* ── Table body ──────────────────────────────────────────── */}
      {open && (
        <div style={{ overflowX: 'auto', overflowY: 'visible', borderRadius: '0 0 var(--r2) var(--r2)', borderTop: '1px solid var(--bd)' }}>
          <table className="tbl" style={{ minWidth: 'max-content', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ minWidth: 340, ...STICKY, background: 'var(--bg3)', top: 0, zIndex: 4, padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  Omschrijving
                </th>
                {displayMonths.map(m => (
                  <th key={m} className="r" style={{ minWidth: 120, background: 'var(--bg3)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>{m}</th>
                ))}
                <th style={{ width: 40, background: 'var(--bg3)', borderBottom: '1px solid rgba(255,255,255,0.08)' }} />
              </tr>
            </thead>

            <tbody>
              {/* ── Onderhanden sections ────────────────────────── */}
              {entity.onderhanden.map((sec, i) => (
                <OhwSection key={sec.id} section={sec} entity={entity.entity} months={displayMonths} onChange={u => handleSectionChange(i, u)} />
              ))}

              {/* ── Totaal Onderhanden ─────────────────────────── */}
              <tr style={{ background: 'var(--bg3)' }}>
                <td style={{ ...STICKY, background: 'var(--bg3)', padding: '7px 12px', fontWeight: 700 }}>Totaal Onderhanden</td>
                {displayMonths.map(m => (
                  <td key={m} className="mono r" style={{ padding: '5px 8px', fontWeight: 700, background: 'var(--bg3)' }}>
                    {fmt(gv(entity.totaalOnderhanden, m))}
                  </td>
                ))}
                <td style={{ background: 'var(--bg3)', width: 40 }} />
              </tr>

              {/* ── Software: Vooruitgefactureerd ─────────────── */}
              {isSoftware && entity.vooruitgefactureerd && (
                <>
                  <tr>
                    <td colSpan={nc + 2} style={{ padding: '5px 12px', fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em', background: 'var(--bg3)' }}>
                      Vooruitgefactureerd
                    </td>
                  </tr>
                  {entity.vooruitgefactureerd.map(row => (
                    <tr key={row.id}>
                      <td style={{ paddingLeft: 26, ...STICKY, background: 'var(--bg2)', fontSize: 12 }}>{row.description}</td>
                      {displayMonths.map(m => (
                        <td key={m} className="mono r" style={{ padding: '4px 8px', background: 'var(--bg2)' }}>{fmt(gv(row.values, m))}</td>
                      ))}
                      <td style={{ background: 'var(--bg2)', width: 40 }} />
                    </tr>
                  ))}
                  <MetricRow label="Totaal Vooruitgefactureerd" dict={entity.totaalVooruitgefactureerd} months={displayMonths} bold rowBg="var(--bg3)" />
                  <MetricRow label="Mutatie Vooruitgefactureerd" dict={entity.mutatieVooruitgefactureerd} months={displayMonths} colorize rowBg="var(--bg2)" />
                </>
              )}

              {/* ── Computed rows ─────────────────────────────── */}
              <MetricRow label="Mutatie OHW" dict={entity.mutatieOhw} months={displayMonths} colorize rowBg="var(--bg2)" />
              <MetricRow label="Netto Omzet voor IC" dict={entity.nettoOmzetVoorIC} months={displayMonths} rowBg="var(--bg2)" />

              {/* ── IC Verrekening ─────────────────────────────── */}
              <IcSection rows={entity.icVerrekening} totaalIC={entity.totaalIC} months={displayMonths} onChange={handleICChange} />

              {/* ── Totals & summary ──────────────────────────── */}
              <MetricRow label="Totaal IC" dict={entity.totaalIC} months={displayMonths} bold colorize rowBg="var(--bg3)" />
              <MetricRow label="Netto Omzet" dict={entity.nettoOmzet} months={displayMonths} bold highlight badge="= P&L" />
              <MetricRow label="Budget" dict={entity.budget} months={displayMonths} dimZero rowBg="var(--bg2)" />
              <MetricRow label="Delta (vs Budget)" dict={entity.delta} months={displayMonths} isDelta rowBg="var(--bg2)" />
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
})
