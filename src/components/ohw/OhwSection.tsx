import { Fragment, memo, useState, useCallback } from 'react'
import type { OhwSection as OhwSectionType, OhwRow } from '../../data/types'
import { fmt, parseNL, gv } from '../../lib/format'
import { useNavStore } from '../../store/useNavStore'
import { useEvidenceStore, downloadEvidence, fileIcon, formatFileSize } from '../../store/useEvidenceStore'

interface Props {
  section: OhwSectionType
  entity?: string  // BV (Consultancy / Projects / Software) — voor bijlagen-lookup
  months: string[]
  onChange: (updated: OhwSectionType) => void
}

// Source slot labels for locked rows
const SOURCE_LABELS: Record<string, string> = {
  uren_lijst: 'Uren lijst',
  d_lijst: 'D Lijst',
  ohw: 'OHW Excel',
  missing_hours: 'Missing Hours',
}

// Description cell: tekst afgekapt met ellipsis, schuift open bij focus
// ✕ zit in de eigen last column, niet hier
function DescCell({ row, onSave }: { row: OhwRow; onSave: (desc: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const isTruncatable = (row.description?.length ?? 0) > 38

  // Locked rows: toon alleen tekst, geen input
  if (row.locked) {
    return (
      <td style={{
        paddingLeft: 26,
        position: 'sticky', left: 0,
        background: 'var(--bg2)',
        zIndex: 1,
        boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }} title="Vast veld — wordt gevuld vanuit import">🔒</span>
          <span style={{
            fontSize: 12, color: 'var(--t1)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            maxWidth: 280,
          }} title={row.description}>
            {row.description}
          </span>
          {row.sourceSlot && (
            <span style={{
              fontSize: 9, color: 'var(--blue)', background: 'var(--bd-blue)',
              padding: '1px 5px', borderRadius: 3, flexShrink: 0, fontWeight: 600,
            }}>
              ← {SOURCE_LABELS[row.sourceSlot] ?? row.sourceSlot}
            </span>
          )}
        </div>
      </td>
    )
  }

  return (
    <td style={{
      paddingLeft: 26,
      position: 'sticky', left: 0,
      background: 'var(--bg2)',
      zIndex: expanded ? 6 : 1,
      boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.06)',
    }}>
      {/* Wrapper voor de expand-pijl overlay */}
      <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
        <input
          key={row.id}
          className="ohw-inp"
          style={{
            width: expanded ? 520 : 260,
            textAlign: 'left',
            background: expanded ? 'var(--bg4)' : 'transparent',
            border: expanded ? '1px solid var(--blue)' : 'none',
            // Ellipsis wanneer niet expanded
            overflow: expanded ? 'visible' : 'hidden',
            textOverflow: expanded ? 'clip' : 'ellipsis',
            whiteSpace: 'nowrap',
            // Ruimte voor expand-pijl rechts
            paddingRight: isTruncatable && !expanded ? 20 : 7,
            transition: 'width 0.18s ease, background 0.12s',
            boxShadow: expanded ? '0 4px 16px rgba(0,0,0,0.4)' : 'none',
            position: 'relative', zIndex: 2,
          }}
          defaultValue={row.description}
          placeholder="Omschrijving..."
          title={row.description || undefined}
          onFocus={() => setExpanded(true)}
          onBlur={e => { setExpanded(false); onSave(e.target.value) }}
        />
        {/* Expand-pijl: overlaid rechts in het inputveld */}
        {isTruncatable && !expanded && (
          <span style={{
            position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)',
            fontSize: 11, color: 'var(--t3)', pointerEvents: 'none', zIndex: 3,
            lineHeight: 1,
          }}>›</span>
        )}
      </div>
    </td>
  )
}

export const OhwSection = memo(function OhwSection({ section, entity, months, onChange }: Props) {
  const [open, setOpen] = useState(true)
  const navigateTo = useNavStore(s => s.navigateTo)
  const evidenceEntries = useEvidenceStore(s => s.entries)
  const [expandedEvidenceRow, setExpandedEvidenceRow] = useState<string | null>(null)

  const updateCell = useCallback((rowId: string, month: string, raw: string) => {
    const v = parseNL(raw)
    onChange({
      ...section,
      rows: section.rows.map(r => r.id === rowId ? { ...r, values: { ...r.values, [month]: v } } : r),
    })
  }, [section, onChange])

  const addRow = useCallback(() => {
    const newRow: OhwRow = { id: `new-${Date.now()}`, description: '', values: {} }
    onChange({ ...section, rows: [...section.rows, newRow] })
  }, [section, onChange])

  const removeRow = useCallback((id: string) => {
    // Voorkom verwijdering van locked rows
    const row = section.rows.find(r => r.id === id)
    if (row?.locked) return
    onChange({ ...section, rows: section.rows.filter(r => r.id !== id) })
  }, [section, onChange])

  const updateDescription = useCallback((rowId: string, desc: string) => {
    onChange({ ...section, rows: section.rows.map(r => r.id === rowId ? { ...r, description: desc } : r) })
  }, [section, onChange])

  const stots = months.map(m => section.rows.reduce((s, r) => s + gv(r.values, m), 0))
  const hdrBg = 'var(--bg3)'

  return (
    <>
      {/* ── Section header — per-month totals always visible ─────── */}
      <tr className="grp" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} onClick={() => setOpen(o => !o)}>
        <td style={{
          position: 'sticky', left: 0, background: hdrBg,
          padding: '7px 12px', cursor: 'pointer',
          boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.06)',
          whiteSpace: 'nowrap',
        }}>
          <span style={{ fontSize: 9, width: 14, display: 'inline-block', transition: 'transform .2s', transform: open ? '' : 'rotate(-90deg)', marginRight: 4 }}>▼</span>
          <strong style={{ fontSize: 12 }}>{section.title}</strong>
        </td>
        {stots.map((v, i) => (
          <td key={i} className="mono r" style={{ padding: '6px 8px', background: hdrBg, fontWeight: 600, color: v !== 0 ? 'var(--t1)' : 'var(--t3)', fontSize: 12 }}>
            {v !== 0 ? fmt(v) : '—'}
          </td>
        ))}
        <td style={{ background: hdrBg, width: 40 }} />
      </tr>

      {open && (
        <>
          {/* ── Data rows ──────────────────────────────────────────── */}
          {section.rows.map(row => {
            const rowEvidence = entity
              ? evidenceEntries.filter(e => e.entity === entity && e.ohwRowId === row.id)
              : []
            const isEvidenceOpen = expandedEvidenceRow === row.id
            return (
          <Fragment key={row.id}>
          <tr className="sub">
              <DescCell row={row} onSave={desc => updateDescription(row.id, desc)} />
              {months.map(m => {
                const v = gv(row.values, m)
                // Locked rows: alleen lezen, geen bewerking
                if (row.locked) {
                  const clickable = !!row.sourceSlot && v !== 0
                  return (
                    <td key={m} className="mono r" style={{ padding: '4px 8px', background: 'var(--bg2)', fontSize: 12, color: v !== 0 ? 'var(--t1)' : 'var(--t3)' }}>
                      {clickable ? (
                        <button
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: 12,
                            fontWeight: 600, padding: 0, textDecoration: 'underline',
                            textDecorationStyle: 'dotted', textUnderlineOffset: 3,
                          }}
                          title="Ga naar bestand in importoverzicht"
                          onClick={() => navigateTo({
                            tab: 'maand',
                            section: 'import',
                            month: m,
                            slotId: row.sourceSlot!,
                          })}
                        >
                          {fmt(v)}
                        </button>
                      ) : (
                        v !== 0 ? fmt(v) : '—'
                      )}
                    </td>
                  )
                }
                return (
                  <td key={m} style={{ padding: 2, textAlign: 'right', background: 'var(--bg2)' }}>
                    <input
                      key={`${row.id}-${m}`}
                      className="ohw-inp"
                      defaultValue={v !== 0 ? fmt(v) : ''}
                      placeholder="—"
                      onBlur={e => updateCell(row.id, m, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    />
                  </td>
                )
              })}
              {/* ✕ helemaal rechts + bijlagen-badge */}
              <td style={{ background: 'var(--bg2)', width: 60, textAlign: 'center' }}>
                <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                  {rowEvidence.length > 0 && (
                    <button
                      className="btn sm ghost"
                      style={{ color: 'var(--amber)', padding: '2px 5px', fontSize: 10, fontWeight: 700 }}
                      onClick={() => setExpandedEvidenceRow(isEvidenceOpen ? null : row.id)}
                      title={`${rowEvidence.length} bijlage(n) — klik om te bekijken`}
                    >
                      📎 {rowEvidence.length}
                    </button>
                  )}
                  {!row.locked && (
                    <button className="btn sm ghost" style={{ color: 'var(--red)', padding: '2px 6px' }} onClick={() => removeRow(row.id)}>✕</button>
                  )}
                </div>
              </td>
            </tr>
            {isEvidenceOpen && rowEvidence.length > 0 && (
              <tr>
                <td colSpan={months.length + 2} style={{ background: 'rgba(245,166,35,0.05)', padding: '6px 26px' }}>
                  <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginBottom: 4 }}>
                    📎 Onderbouwing ({rowEvidence.length})
                  </div>
                  <div style={{ display: 'grid', gap: 4 }}>
                    {rowEvidence.map(ev => (
                      <div
                        key={ev.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '4px 8px', background: 'var(--bg3)', borderRadius: 5,
                          fontSize: 10,
                        }}
                      >
                        <span style={{ fontSize: 14 }}>{fileIcon(ev.mimeType, ev.fileName)}</span>
                        <span style={{ fontWeight: 600, color: 'var(--t1)', flex: 1 }}>{ev.fileName}</span>
                        {ev.description && (
                          <span style={{ color: 'var(--t3)', fontStyle: 'italic' }}>{ev.description.slice(0, 40)}</span>
                        )}
                        <span style={{ color: 'var(--t3)' }}>{ev.month} · {formatFileSize(ev.fileSize)}</span>
                        <button
                          className="btn sm ghost"
                          style={{ fontSize: 9, color: 'var(--blue)', padding: '1px 5px' }}
                          onClick={() => downloadEvidence(ev)}
                        >↓</button>
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            )}
            </Fragment>
            )
          })}

          {/* ── + Regel toevoegen ───────────────────────────────────── */}
          <tr>
            <td colSpan={months.length + 2} style={{ background: 'var(--bg2)', padding: '4px 12px 4px 26px' }}>
              <button
                className="btn sm"
                style={{
                  background: 'var(--bd-blue)', border: '1px dashed var(--blue)',
                  color: 'var(--blue)', fontSize: 11, padding: '3px 10px',
                  width: '100%', justifyContent: 'center',
                }}
                onClick={addRow}
              >
                + Regel toevoegen aan "{section.title}"
              </button>
            </td>
          </tr>

          {/* ── Subtotaal ──────────────────────────────────────────── */}
          <tr className="stot">
            <td style={{ position: 'sticky', left: 0, background: 'var(--bg3)', fontSize: 12, padding: '5px 12px 5px 26px', fontStyle: 'italic', zIndex: 1, boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.06)' }}>
              Subtotaal {section.title}
            </td>
            {stots.map((v, i) => (
              <td key={i} className="mono r" style={{ padding: '5px 8px', fontWeight: 600, background: 'var(--bg3)' }}>{fmt(v)}</td>
            ))}
            <td style={{ background: 'var(--bg3)', width: 40 }} />
          </tr>

        </>
      )}
    </>
  )
})
