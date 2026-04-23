import { Fragment, memo, useState, useCallback } from 'react'
import type { OhwSection as OhwSectionType, OhwRow } from '../../data/types'
import { fmt, parseNL, gv } from '../../lib/format'
import { useNavStore } from '../../store/useNavStore'
import { useEvidenceStore, downloadEvidence, fileIcon, formatFileSize } from '../../store/useEvidenceStore'
import { useOhwStore } from '../../store/useOhwStore'
import { CellCommentPopover } from './CellCommentPopover'

interface Props {
  section: OhwSectionType
  entity?: string  // BV (Consultancy / Projects / Software) — voor bijlagen-lookup
  year?: '2025' | '2026'   // voor store-acties (deleteRow, updateRowContact)
  months: string[]
  onChange: (updated: OhwSectionType) => void
  /** Breedte van de omschrijving-kolom (resizable via drag-handle in header) */
  descColWidth?: number
  /** Breedte van de Contactpersoon-kolom */
  contactColWidth?: number
  /** Row-id die tijdelijk gehighlight moet worden (voor nav-deep-link) */
  flashRowId?: string | null
}

/** Heeft de rij ÉÉN cel met een niet-null, niet-0 waarde? Dan mag verwijderen
 *  niet. Per-cel remarks tellen niet als "waarde". */
function rowHasAnyValue(row: OhwRow): boolean {
  return Object.values(row.values ?? {}).some(v => v !== null && v !== undefined && v !== 0)
}

// Source slot labels for locked rows
const SOURCE_LABELS: Record<string, string> = {
  uren_lijst: 'Uren lijst',
  d_lijst: 'D Lijst',
  ohw: 'OHW Excel',
  missing_hours: 'Missing Hours',
  conceptfacturen: 'Conceptfacturen',
}

// Description cell: tekst afgekapt met ellipsis, schuift open bij focus.
// ✕ zit in de eigen last column, niet hier.
// Breedte volgt descColWidth zodat de header-resize door de hele tabel heen werkt.
// Sticky-left met offset = contactColWidth (kolom 1 = contact, kolom 2 = desc).
function DescCell({
  row,
  onSave,
  width,
  leftOffset,
}: {
  row: OhwRow
  onSave: (desc: string) => void
  width: number
  leftOffset: number
}) {
  const [expanded, setExpanded] = useState(false)
  // Effectieve input-breedte: houd wat marge tov de cell
  const inputWidth = Math.max(180, width - 40)
  const isTruncatable = (row.description?.length ?? 0) > (width / 8)

  // Locked rows: toon alleen tekst, geen input
  if (row.locked) {
    return (
      <td style={{
        paddingLeft: 26,
        position: 'sticky', left: leftOffset,
        background: 'var(--bg2)',
        zIndex: 1,
        boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.06)',
        width, minWidth: width, maxWidth: width,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: inputWidth }}>
          <span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }} title="Vast veld — wordt gevuld vanuit import">🔒</span>
          <span style={{
            fontSize: 12, color: 'var(--t1)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            flex: 1, minWidth: 0,
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
      position: 'sticky', left: leftOffset,
      background: 'var(--bg2)',
      zIndex: expanded ? 6 : 1,
      boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.06)',
      width, minWidth: width, maxWidth: width,
    }}>
      {/* Wrapper voor de expand-pijl overlay */}
      <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
        <input
          key={row.id}
          className="ohw-inp"
          style={{
            width: expanded ? Math.max(inputWidth, 520) : inputWidth,
            textAlign: 'left',
            background: expanded ? 'var(--bg4)' : 'transparent',
            border: expanded ? '1px solid var(--blue)' : 'none',
            overflow: expanded ? 'visible' : 'hidden',
            textOverflow: expanded ? 'clip' : 'ellipsis',
            whiteSpace: 'nowrap',
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

export const OhwSection = memo(function OhwSection({ section, entity, year = '2026', months, onChange, descColWidth = 340, contactColWidth = 150, flashRowId }: Props) {
  const [open, setOpen] = useState(true)
  const navigateTo = useNavStore(s => s.navigateTo)
  const evidenceEntries = useEvidenceStore(s => s.entries)
  const [expandedEvidenceRow, setExpandedEvidenceRow] = useState<string | null>(null)
  // Handmatige override op een locked cel: { rowId, month, value, remark }
  const [overrideCell, setOverrideCell] = useState<null | { rowId: string; month: string; value: string; remark: string }>(null)
  const updateRowValueStore = useOhwStore(s => s.updateRowValue)
  const updateRowRemarkStore = useOhwStore(s => s.updateRowRemark)
  const updateRowContactStore = useOhwStore(s => s.updateRowContact)
  const deleteRowStore = useOhwStore(s => s.deleteRow)

  const startOverride = (row: OhwRow, month: string) => {
    const currentValue = gv(row.values, month)
    const currentRemark = row.remarks?.[month] ?? ''
    setOverrideCell({
      rowId: row.id,
      month,
      value: currentValue !== 0 ? fmt(currentValue) : '',
      remark: currentRemark,
    })
  }
  const saveOverride = () => {
    if (!overrideCell || !entity) return
    const v = parseNL(overrideCell.value)
    if (!isFinite(v)) return
    if (!overrideCell.remark.trim() || overrideCell.remark.trim().length < 3) return
    updateRowValueStore('2026', entity, overrideCell.rowId, overrideCell.month, v)
    updateRowRemarkStore('2026', entity, overrideCell.rowId, overrideCell.month, overrideCell.remark.trim())
    setOverrideCell(null)
  }
  const cancelOverride = () => setOverrideCell(null)
  const clearOverride = (rowId: string, month: string) => {
    if (!entity) return
    if (!confirm('Handmatige toelichting wissen voor deze cel? (Waarde blijft staan tot volgende upload)')) return
    updateRowRemarkStore('2026', entity, rowId, month, '')
  }

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
    // Voorkom verwijdering van locked rows OF rijen met ingevulde waardes
    const row = section.rows.find(r => r.id === id)
    if (!row || row.locked) return
    if (rowHasAnyValue(row)) return
    // Gebruik store.deleteRow zodat de verwijdering via tombstone persisted
    // wordt — voorkomt dat de rij terugkeert na een Supabase-reload.
    if (entity) deleteRowStore(year, entity, id)
    else onChange({ ...section, rows: section.rows.filter(r => r.id !== id) })
  }, [section, onChange, entity, year, deleteRowStore])

  const updateDescription = useCallback((rowId: string, desc: string) => {
    onChange({ ...section, rows: section.rows.map(r => r.id === rowId ? { ...r, description: desc } : r) })
  }, [section, onChange])

  const stots = months.map(m => section.rows.reduce((s, r) => s + gv(r.values, m), 0))
  const hdrBg = 'var(--bg3)'

  return (
    <>
      {/* ── Section header — per-month totals always visible ─────── */}
      <tr className="grp" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} onClick={() => setOpen(o => !o)}>
        {/* Kolom 1: lege contactpersoon-cel (sticky links) */}
        <td style={{
          position: 'sticky', left: 0, background: hdrBg, zIndex: 2,
          width: contactColWidth, minWidth: contactColWidth,
        }} />
        {/* Kolom 2: sectietitel (sticky met left-offset) */}
        <td style={{
          position: 'sticky', left: contactColWidth, background: hdrBg, zIndex: 2,
          padding: '7px 12px', cursor: 'pointer',
          boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.06)',
          whiteSpace: 'nowrap',
          width: descColWidth, minWidth: descColWidth,
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
          <tr
            id={`ohw-row-${entity}-${row.id}`}
            className="sub"
            style={flashRowId === row.id ? { outline: '2px solid var(--blue)', outlineOffset: '-2px', background: 'rgba(0,169,224,0.08)' } : undefined}
          >
              {/* Kolom 1: Contactpersoon (sticky-left) */}
              <td style={{
                position: 'sticky', left: 0, zIndex: 1,
                background: 'var(--bg2)', padding: '2px 8px',
                width: contactColWidth, minWidth: contactColWidth, maxWidth: contactColWidth,
                boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.05)',
              }}>
                <input
                  className="ohw-inp"
                  style={{ width: '100%', fontSize: 11, textAlign: 'left', background: 'transparent', border: 'none' }}
                  defaultValue={row.contactPerson ?? ''}
                  placeholder="—"
                  onBlur={e => entity && updateRowContactStore(year, entity, row.id, e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  title={row.contactPerson ? `Contact: ${row.contactPerson}` : 'Vul een contactpersoon in (wie weet meer over deze rij)'}
                />
              </td>
              {/* Kolom 2: Omschrijving */}
              <DescCell row={row} onSave={desc => updateDescription(row.id, desc)} width={descColWidth} leftOffset={contactColWidth} />
              {months.map(m => {
                const v = gv(row.values, m)
                const cellRemark = row.remarks?.[m]
                // Locked rows: read-only maar met optionele handmatige override
                if (row.locked) {
                  const clickable = !!row.sourceSlot && v !== 0
                  return (
                    <td key={m} className="mono r" style={{
                      padding: '4px 8px',
                      background: cellRemark ? 'rgba(245,166,35,0.07)' : 'var(--bg2)',
                      fontSize: 12, color: v !== 0 ? 'var(--t1)' : 'var(--t3)',
                      position: 'relative',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                        {cellRemark && (
                          <span
                            style={{ cursor: 'help', fontSize: 10 }}
                            title={`Handmatige toelichting: ${cellRemark}\n(klik ✏ om te wijzigen, klik 💬 om toelichting te verwijderen)`}
                            onClick={(e) => { e.stopPropagation(); clearOverride(row.id, m) }}
                          >💬</span>
                        )}
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
                          <span style={{ fontFamily: 'var(--mono)' }}>{v !== 0 ? fmt(v) : '—'}</span>
                        )}
                        <button
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--t3)', fontSize: 10, padding: '1px 3px',
                          }}
                          title="Handmatig overschrijven (toelichting vereist)"
                          onClick={() => startOverride(row, m)}
                        >✏</button>
                      </div>
                    </td>
                  )
                }
                return (
                  <td
                    key={m}
                    style={{ padding: 2, textAlign: 'right', background: 'var(--bg2)', position: 'relative' }}
                    className="ohw-cell-hoverable"
                  >
                    <input
                      key={`${row.id}-${m}`}
                      className="ohw-inp"
                      defaultValue={v !== 0 ? fmt(v) : ''}
                      placeholder="—"
                      onBlur={e => updateCell(row.id, m, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    />
                    {entity && (
                      <CellCommentPopover
                        remark={cellRemark ?? ''}
                        hasRemark={!!cellRemark}
                        hint={cellRemark ? `Opmerking: ${cellRemark}` : 'Opmerking toevoegen'}
                        onSave={v2 => updateRowRemarkStore(year, entity, row.id, m, v2)}
                      />
                    )}
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
                  {!row.locked && (() => {
                    const hasValue = rowHasAnyValue(row)
                    return (
                      <button
                        className="btn sm ghost"
                        style={{
                          color: hasValue ? 'var(--t3)' : 'var(--red)',
                          padding: '2px 6px',
                          cursor: hasValue ? 'not-allowed' : 'pointer',
                          opacity: hasValue ? 0.4 : 1,
                        }}
                        onClick={() => !hasValue && removeRow(row.id)}
                        title={hasValue ? 'Maak eerst alle cellen leeg om deze rij te kunnen verwijderen' : 'Verwijder deze regel'}
                      >✕</button>
                    )
                  })()}
                </div>
              </td>
            </tr>
            {isEvidenceOpen && rowEvidence.length > 0 && (
              <tr>
                <td colSpan={months.length + 3} style={{ background: 'rgba(245,166,35,0.05)', padding: '6px 26px' }}>
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
            <td colSpan={months.length + 3} style={{ background: 'var(--bg2)', padding: '4px 12px 4px 26px' }}>
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

          {/* Subtotaal-rij is verwijderd: dezelfde totalen staan al in de
              section-header bovenaan (die is altijd zichtbaar), dus een
              herhaling onderaan de uitklap-sectie is dubbel. */}
        </>
      )}

      {/* Override modal — rendered buiten de tabel via portal-achtig fragment.
          Niet een echte portal; React staat dit toe omdat de <> wrapper
          meerdere root-children accepteert. De modal krijgt position:fixed. */}
      {overrideCell && entity && (() => {
        const row = section.rows.find(r => r.id === overrideCell.rowId)
        const remarkValid = overrideCell.remark.trim().length >= 3
        const valueParsed = parseNL(overrideCell.value)
        const valueValid = isFinite(valueParsed)
        return (
          <tr style={{ position: 'relative' }}>
            <td colSpan={months.length + 3} style={{ padding: 0, border: 0, background: 'transparent' }}>
              <div
                onClick={(e) => { if (e.target === e.currentTarget) cancelOverride() }}
                style={{
                  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  zIndex: 9999, padding: 20,
                }}
              >
                <div style={{
                  background: 'var(--bg2)', border: '1px solid var(--bd3)', borderRadius: 12,
                  width: '100%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
                  padding: 20,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: 18 }}>✏</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>Handmatige override</div>
                      <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
                        {entity} · {row?.description?.slice(0, 70) ?? overrideCell.rowId} · <strong>{overrideCell.month}</strong>
                      </div>
                    </div>
                    <button
                      onClick={cancelOverride}
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--t3)', fontSize: 18, cursor: 'pointer' }}
                    >✕</button>
                  </div>

                  <div style={{
                    background: 'var(--bd-amber)', border: '1px solid var(--amber)',
                    borderRadius: 6, padding: '8px 12px', marginBottom: 12,
                    fontSize: 11, color: 'var(--amber)',
                  }}>
                    ⚠ Dit is een <strong>locked rij</strong> die normaal wordt gevuld via {row?.sourceSlot ?? 'een upload'}.
                    Een handmatige override vereist een toelichting. De volgende upload overschrijft deze waarde,
                    maar de toelichting blijft als audit-trail staan.
                  </div>

                  <div style={{ display: 'grid', gap: 10 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--t2)', marginBottom: 4 }}>
                        Waarde (€)
                      </label>
                      <input
                        type="text"
                        value={overrideCell.value}
                        onChange={e => setOverrideCell({ ...overrideCell, value: e.target.value })}
                        placeholder="0"
                        autoFocus
                        className="ohw-inp"
                        style={{ width: '100%', textAlign: 'right', fontSize: 14 }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--t2)', marginBottom: 4 }}>
                        Toelichting <span style={{ color: 'var(--red)' }}>*</span>
                        <span style={{ color: 'var(--t3)', fontWeight: 400, marginLeft: 6 }}>
                          (verplicht, min. 3 tekens — bijv. "Correctie per email X", "Handmatig i.v.m. openstaande inkooporder")
                        </span>
                      </label>
                      <textarea
                        value={overrideCell.remark}
                        onChange={e => setOverrideCell({ ...overrideCell, remark: e.target.value })}
                        placeholder="Waarom wordt deze waarde handmatig gezet?"
                        rows={3}
                        style={{
                          width: '100%', background: 'var(--bg1)', border: `1px solid ${remarkValid ? 'var(--bd3)' : 'var(--red)'}`,
                          borderRadius: 6, color: 'var(--t1)', fontSize: 12, padding: '8px 10px',
                          fontFamily: 'var(--font)', outline: 'none', resize: 'vertical',
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <button
                      className="btn success"
                      disabled={!valueValid || !remarkValid}
                      onClick={saveOverride}
                      style={{ flex: 1, justifyContent: 'center', opacity: (!valueValid || !remarkValid) ? 0.5 : 1 }}
                    >
                      ✓ Override opslaan
                    </button>
                    <button className="btn ghost" onClick={cancelOverride}>
                      Annuleren
                    </button>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        )
      })()}
    </>
  )
})
