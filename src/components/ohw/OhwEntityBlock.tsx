import { memo, useState, useCallback, useEffect, useRef } from 'react'
import type { OhwEntityData } from '../../data/types'
import { fmt, gv } from '../../lib/format'
import { OhwSection } from './OhwSection'
import { IcSection } from './IcSection'
import { MetricRow } from './MetricRow'
import { OhwCellInput } from './OhwCellInput'
import { useOhwStore } from '../../store/useOhwStore'

interface Props {
  entity: OhwEntityData
  displayMonths: string[]
  onChange: (updated: OhwEntityData) => void
  /** Jaar waar deze entity bij hoort (voor IC-pair store-acties). */
  year: '2025' | '2026'
  /** @deprecated auto-opslaan is nu actief; dit is kosmetisch */
  onSave?: () => void
  /** Externe nav-highlight: blink een rij (rowId) en maak 'm scroll-into-view. */
  highlightRowId?: string | null
}

// Contactpersoon: allerlinks (kolom 1). Krijgt de standaard sticky-left.
const STICKY_LEFT_CONTACT: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 2,
  boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.05)',
}
// Omschrijving (kolom 2): sticky met left-offset = contactkolom-breedte.
const STICKY_LEFT_DESC = (contactWidth: number): React.CSSProperties => ({
  position: 'sticky',
  left: contactWidth,
  zIndex: 2,
  boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.08)',
})

// Persistente kolombreedte in localStorage
const WIDTH_KEY = 'tpg-ohw-desc-col-width'
const DEFAULT_WIDTH = 340
const MIN_WIDTH = 220
const MAX_WIDTH = 800
function loadWidth(): number {
  try {
    const v = parseInt(localStorage.getItem(WIDTH_KEY) ?? '')
    if (isFinite(v) && v >= MIN_WIDTH && v <= MAX_WIDTH) return v
  } catch { /* ignore */ }
  return DEFAULT_WIDTH
}
function saveWidth(v: number) {
  try { localStorage.setItem(WIDTH_KEY, String(v)) } catch { /* ignore */ }
}

const CONTACT_COL_WIDTH = 150

export const OhwEntityBlock = memo(function OhwEntityBlock({
  entity, displayMonths, onChange, year, onSave: _onSave, highlightRowId,
}: Props) {
  const [open, setOpen] = useState(true)
  const isSoftware = entity.entity === 'Software'
  const updateRowValueStore = useOhwStore(s => s.updateRowValue)
  const updateRowContact = useOhwStore(s => s.updateRowContact)
  const pruneEmptyRows = useOhwStore(s => s.pruneEmptyRows)
  const nc = displayMonths.length
  const lastTot = gv(entity.totaalOnderhanden, displayMonths[nc - 1])
  const firstTot = gv(entity.totaalOnderhanden, displayMonths[0])
  const lastActualTot = gv(entity.totaalOnderhanden, displayMonths[1] ?? displayMonths[0])

  // ── Resizable description column ──────────────────────────
  const [descWidth, setDescWidth] = useState<number>(() => loadWidth())
  const resizeStartRef = useRef<{ startX: number; startW: number } | null>(null)
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    resizeStartRef.current = { startX: e.clientX, startW: descWidth }
    const move = (ev: MouseEvent) => {
      if (!resizeStartRef.current) return
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, resizeStartRef.current.startW + (ev.clientX - resizeStartRef.current.startX)))
      setDescWidth(next)
    }
    const up = () => {
      if (resizeStartRef.current) {
        saveWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, descWidth)))
      }
      resizeStartRef.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }
  // Persist final width wanneer state verandert (ook fallback als mouseup gemist)
  useEffect(() => { saveWidth(descWidth) }, [descWidth])

  // ── Auto-scroll + highlight wanneer een rij wordt geselecteerd via nav ──
  const [flashRowId, setFlashRowId] = useState<string | null>(null)
  useEffect(() => {
    if (!highlightRowId) return
    // Open block, scroll ernaartoe, flash
    setOpen(true)
    const el = document.getElementById(`ohw-row-${entity.entity}-${highlightRowId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setFlashRowId(highlightRowId)
      const t = setTimeout(() => setFlashRowId(null), 2500)
      return () => clearTimeout(t)
    }
  }, [highlightRowId, entity.entity])

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

  const descColMinWidth = descWidth
  const mutatieRowFlash = flashRowId === 'mutatieOhw'

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
          <button
            className="btn sm ghost"
            style={{ fontSize: 10 }}
            onClick={() => {
              const n = pruneEmptyRows(year, entity.entity)
              if (n === 0) alert('Geen lege rijen om op te ruimen.')
              else alert(`${n} lege ${n === 1 ? 'regel' : 'regels'} verwijderd.`)
            }}
            title="Verwijder alle rijen zonder waardes (locked rijen blijven staan)"
          >
            🧹 Opruim
          </button>
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

      {/* ── Table body ──────────────────────────────────────────────
         Overflow-x: visible zodat `position: sticky; top: 0` op de <th>
         tegen de PAGE-scroll werkt (niet tegen een interne wrapper). Bij een
         wrapper met overflow-x: auto wordt y ook auto volgens CSS-spec,
         waardoor sticky enkel t.o.v. de wrapper plakt. */}
      {open && (
        <div style={{ overflow: 'visible', borderRadius: '0 0 var(--r2) var(--r2)', borderTop: '1px solid var(--bd)' }}>
          <table className="tbl" style={{ minWidth: 'max-content', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                {/* Kolom 1: Contactpersoon — links, sticky */}
                <th style={{
                  ...STICKY_LEFT_CONTACT,
                  minWidth: CONTACT_COL_WIDTH, width: CONTACT_COL_WIDTH,
                  background: 'var(--bg3)', top: 0, zIndex: 6,
                  padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)',
                  whiteSpace: 'nowrap',
                }}>Contactpersoon</th>
                {/* Kolom 2: Omschrijving (resizable) */}
                <th style={{
                  ...STICKY_LEFT_DESC(CONTACT_COL_WIDTH),
                  minWidth: descColMinWidth, width: descColMinWidth,
                  background: 'var(--bg3)', top: 0, zIndex: 5,
                  padding: 0, borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}>
                  <div style={{ position: 'relative', padding: '6px 12px', paddingRight: 18 }}>
                    Omschrijving
                    <div
                      onMouseDown={startResize}
                      title="Sleep om kolom breder/smaller te maken"
                      style={{
                        position: 'absolute', right: 0, top: 0, bottom: 0,
                        width: 8, cursor: 'col-resize',
                        background: 'transparent',
                      }}
                    >
                      <div style={{
                        position: 'absolute', right: 3, top: '25%', bottom: '25%',
                        width: 2, background: 'rgba(255,255,255,0.15)', borderRadius: 1,
                        pointerEvents: 'none',
                      }} />
                    </div>
                  </div>
                </th>
                {displayMonths.map(m => (
                  <th
                    key={m}
                    className="r"
                    style={{
                      minWidth: 120, width: 120, background: 'var(--bg3)',
                      borderBottom: '1px solid rgba(255,255,255,0.08)',
                      position: 'sticky', top: 0, zIndex: 3,
                      padding: '6px 8px',
                    }}
                  >{m}</th>
                ))}
                <th style={{
                  width: 40, minWidth: 40, background: 'var(--bg3)',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                  position: 'sticky', top: 0, zIndex: 3,
                }} />
              </tr>
            </thead>

            <tbody>
              {/* ── Onderhanden sections ────────────────────────── */}
              {entity.onderhanden.map((sec, i) => (
                <OhwSection
                  key={sec.id}
                  section={sec}
                  entity={entity.entity}
                  year={year}
                  months={displayMonths}
                  onChange={u => handleSectionChange(i, u)}
                  descColWidth={descColMinWidth}
                  contactColWidth={CONTACT_COL_WIDTH}
                  flashRowId={flashRowId}
                />
              ))}

              {/* ── Totaal Onderhanden ─────────────────────────── */}
              <tr style={{ background: 'var(--bg3)' }}>
                <td style={{ ...STICKY_LEFT_CONTACT, background: 'var(--bg3)', width: CONTACT_COL_WIDTH, minWidth: CONTACT_COL_WIDTH }} />
                <td style={{ ...STICKY_LEFT_DESC(CONTACT_COL_WIDTH), background: 'var(--bg3)', padding: '7px 12px', fontWeight: 700, width: descColMinWidth, minWidth: descColMinWidth }}>
                  Totaal Onderhanden
                </td>
                {displayMonths.map(m => (
                  <td key={m} className="mono r" style={{ padding: '5px 8px', fontWeight: 700, background: 'var(--bg3)' }}>
                    {fmt(gv(entity.totaalOnderhanden, m))}
                  </td>
                ))}
                <td style={{ background: 'var(--bg3)', width: 40 }} />
              </tr>

              {/* ── Software: Vooruitgefactureerd (editable) ──── */}
              {isSoftware && entity.vooruitgefactureerd && (
                <>
                  <tr>
                    <td colSpan={nc + 3} style={{ padding: '5px 12px', fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em', background: 'var(--bg3)' }}>
                      Vooruitgefactureerd
                    </td>
                  </tr>
                  {entity.vooruitgefactureerd.map(row => (
                    <tr key={row.id}>
                      <td style={{ ...STICKY_LEFT_CONTACT, background: 'var(--bg2)', padding: '2px 8px', width: CONTACT_COL_WIDTH, minWidth: CONTACT_COL_WIDTH }}>
                        <input
                          className="ohw-inp"
                          style={{ width: '100%', fontSize: 11, textAlign: 'left', background: 'transparent', border: 'none' }}
                          defaultValue={row.contactPerson ?? ''}
                          placeholder="—"
                          onBlur={e => updateRowContact(year, entity.entity, row.id, e.target.value)}
                        />
                      </td>
                      <td style={{ paddingLeft: 26, ...STICKY_LEFT_DESC(CONTACT_COL_WIDTH), background: 'var(--bg2)', fontSize: 12, width: descColMinWidth, minWidth: descColMinWidth }}>
                        {row.description}
                      </td>
                      {displayMonths.map(m => {
                        const v = gv(row.values, m)
                        return (
                          <td key={m} style={{ padding: 2, textAlign: 'right', background: 'var(--bg2)' }}>
                            <OhwCellInput
                              value={v}
                              onCommit={next => updateRowValueStore(year, entity.entity, row.id, m, next)}
                              navRow={`vf-${row.id}`}
                              navCol={m}
                            />
                          </td>
                        )
                      })}
                      <td style={{ background: 'var(--bg2)', width: 40 }} />
                    </tr>
                  ))}
                  <MetricRow label="Totaal Vooruitgefactureerd" dict={entity.totaalVooruitgefactureerd} months={displayMonths} bold rowBg="var(--bg3)" contactColWidth={CONTACT_COL_WIDTH} descColWidth={descColMinWidth} />
                  <MetricRow label="Mutatie Vooruitgefactureerd" dict={entity.mutatieVooruitgefactureerd} months={displayMonths} colorize rowBg="var(--bg2)" contactColWidth={CONTACT_COL_WIDTH} descColWidth={descColMinWidth} />
                </>
              )}

              {/* ── Computed rows ─────────────────────────────── */}
              <tr
                id={`ohw-row-${entity.entity}-mutatieOhw`}
                style={mutatieRowFlash ? { outline: '2px solid var(--blue)', outlineOffset: '-2px', background: 'rgba(0,169,224,0.08)', transition: 'background 0.3s' } : undefined}
              >
                <td style={{ ...STICKY_LEFT_CONTACT, background: mutatieRowFlash ? 'rgba(0,169,224,0.12)' : 'var(--bg2)', width: CONTACT_COL_WIDTH, minWidth: CONTACT_COL_WIDTH }} />
                <td style={{ ...STICKY_LEFT_DESC(CONTACT_COL_WIDTH), background: mutatieRowFlash ? 'rgba(0,169,224,0.12)' : 'var(--bg2)', padding: '5px 12px', width: descColMinWidth, minWidth: descColMinWidth }}>
                  Mutatie OHW
                </td>
                {displayMonths.map(m => {
                  const v = gv(entity.mutatieOhw, m)
                  return (
                    <td key={m} className="mono r" style={{ padding: '5px 8px', color: v < 0 ? 'var(--red)' : v > 0 ? 'var(--green)' : 'var(--t3)', background: mutatieRowFlash ? 'rgba(0,169,224,0.08)' : 'var(--bg2)' }}>
                      {fmt(v)}
                    </td>
                  )
                })}
                <td style={{ background: mutatieRowFlash ? 'rgba(0,169,224,0.08)' : 'var(--bg2)', width: 40 }} />
              </tr>
              <MetricRow label="Netto Omzet voor IC" dict={entity.nettoOmzetVoorIC} months={displayMonths} rowBg="var(--bg2)" contactColWidth={CONTACT_COL_WIDTH} descColWidth={descColMinWidth} />

              {/* ── IC Verrekening ─────────────────────────────── */}
              <IcSection
                rows={entity.icVerrekening}
                totaalIC={entity.totaalIC}
                months={displayMonths}
                onChange={handleICChange}
                currentBv={entity.entity as 'Consultancy' | 'Projects' | 'Software'}
                year={year}
                contactColWidth={CONTACT_COL_WIDTH}
                descColWidth={descColMinWidth}
              />

              {/* ── Totals & summary ──────────────────────────── */}
              <MetricRow label="Totaal IC" dict={entity.totaalIC} months={displayMonths} bold colorize rowBg="var(--bg3)" contactColWidth={CONTACT_COL_WIDTH} descColWidth={descColMinWidth} />
              <MetricRow label="Mutatie OHW na IC Verrekening" dict={entity.nettoOmzet} months={displayMonths} bold highlight contactColWidth={CONTACT_COL_WIDTH} descColWidth={descColMinWidth} />
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
})
