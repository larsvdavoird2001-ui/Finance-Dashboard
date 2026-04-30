import { useMemo, useRef, useState, useEffect } from 'react'
import { useEvidenceStore, fileToBase64, downloadEvidence, formatFileSize, fileIcon } from '../../store/useEvidenceStore'
import type { EvidenceEntry } from '../../store/useEvidenceStore'
import { useOhwStore } from '../../store/useOhwStore'
import { useToast } from '../../hooks/useToast'
import { Toast } from '../common/Toast'
import { useLockedBv } from '../../lib/permissions'
import type { BvId, OhwEntityData, OhwRow } from '../../data/types'

const BVS_FULL: BvId[] = ['Consultancy', 'Projects', 'Software']
const BV_COLORS: Record<BvId, string> = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
}

const MAX_FILE_SIZE = 10 * 1024 * 1024  // 10 MB

interface Props {
  month: string  // bv. 'Mar-26'
  closingMonths: string[]
  onMonthChange: (m: string) => void
}

/** Haal alle OHW-rijen op van een entiteit (alle secties platgeslagen). */
function rowsOfEntity(ent: OhwEntityData | undefined): OhwRow[] {
  if (!ent) return []
  return ent.onderhanden.flatMap(section => section.rows)
}

export function BijlagenSection({ month, closingMonths, onMonthChange }: Props) {
  const evidence = useEvidenceStore(s => s.entries)
  const addEvidence = useEvidenceStore(s => s.addEntry)
  const removeEvidence = useEvidenceStore(s => s.removeEntry)
  const ohwData = useOhwStore(s => s.data2026)
  const { toasts, showToast } = useToast()
  const lockedBv = useLockedBv()
  // Holdings heeft geen OHW-flow, dus voor een Holdings-locked user is er
  // geen koppelbare rij — we tonen geen BVs.
  const BVS: BvId[] = lockedBv && lockedBv !== 'Holdings'
    ? [lockedBv as BvId]
    : (lockedBv === 'Holdings' ? [] : BVS_FULL)

  const fileRef = useRef<HTMLInputElement | null>(null)

  // Form state voor nieuwe upload
  const [uploadBv, setUploadBv] = useState<BvId>(BVS[0] ?? 'Consultancy')
  const [uploadRowId, setUploadRowId] = useState<string>('')
  const [uploadDescription, setUploadDescription] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  // Als de locked BV verandert (bv. account-switch in dezelfde sessie),
  // synchroniseer upload-bv zodat de form niet op de oude waarde blijft hangen.
  useEffect(() => {
    if (lockedBv && lockedBv !== 'Holdings' && uploadBv !== lockedBv) {
      setUploadBv(lockedBv as BvId)
    }
  }, [lockedBv, uploadBv])

  // Filter-state — voor BV-locked users vergrendeld op hun eigen BV.
  const [filterBv, setFilterBv] = useState<BvId | 'all'>(lockedBv && lockedBv !== 'Holdings' ? (lockedBv as BvId) : 'all')
  const [filterRowId, setFilterRowId] = useState<string>('')
  const [showAllMonths, setShowAllMonths] = useState(false)

  // OHW rijen per BV (voor dropdown)
  const rowsByBv = useMemo(() => {
    const out: Record<BvId, OhwRow[]> = { Consultancy: [], Projects: [], Software: [] }
    for (const bv of BVS_FULL) {
      const ent = ohwData.entities.find(e => e.entity === bv)
      out[bv] = rowsOfEntity(ent)
    }
    return out
  }, [ohwData])

  const uploadRows = rowsByBv[uploadBv] ?? []
  const filterRows = filterBv !== 'all' ? (rowsByBv[filterBv] ?? []) : []

  // Gefilterde lijst — voor BV-locked users altijd óók op hun eigen BV
  // (defense-in-depth: zelfs als filterBv ergens ge-overruled is, mag een
  // BV-locked user nooit andermans bijlagen zien).
  const filtered = evidence.filter(e => {
    if (!showAllMonths && e.month !== month) return false
    if (filterBv !== 'all' && e.entity !== filterBv) return false
    if (filterRowId && e.ohwRowId !== filterRowId) return false
    if (lockedBv && e.entity !== lockedBv) return false
    return true
  })

  const handleFilePick = (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      showToast(`Bestand te groot (${formatFileSize(file.size)}) — max 10 MB`, 'r')
      return
    }
    setPendingFile(file)
  }

  const handleSave = async () => {
    if (!pendingFile) { showToast('Kies eerst een bestand', 'r'); return }
    if (!uploadRowId) { showToast('Kies een OHW-rij om te koppelen', 'r'); return }

    setSaving(true)
    try {
      const base64 = await fileToBase64(pendingFile)
      const entry: EvidenceEntry = {
        id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        month,
        entity: uploadBv,
        ohwRowId: uploadRowId,
        fileName: pendingFile.name,
        mimeType: pendingFile.type || 'application/octet-stream',
        fileSize: pendingFile.size,
        fileData: base64,
        description: uploadDescription.trim(),
        uploadedAt: new Date().toLocaleString('nl-NL'),
      }
      addEvidence(entry)
      showToast(`"${pendingFile.name}" gekoppeld aan ${uploadBv} → ${uploadRowId}`, 'g')
      // Reset form (behoud bv + rij keuze zodat user meerdere bestanden in één rij kan stoppen)
      setPendingFile(null)
      setUploadDescription('')
      if (fileRef.current) fileRef.current.value = ''
    } catch (err) {
      showToast(`Fout bij uploaden: ${err instanceof Error ? err.message : String(err)}`, 'r')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (e: EvidenceEntry) => {
    if (!confirm(`Bijlage "${e.fileName}" verwijderen?`)) return
    removeEvidence(e.id)
    showToast('Bijlage verwijderd', 'r')
  }

  const getOhwRowDescription = (entity: string, rowId: string): string => {
    const ent = ohwData.entities.find(e => e.entity === entity)
    if (!ent) return rowId
    const row = rowsOfEntity(ent).find(r => r.id === rowId)
    return row ? row.description : rowId
  }

  return (
    <>
      <div style={{ background: 'var(--bd-blue)', border: '1px solid var(--blue)', borderRadius: 8, padding: '10px 14px', fontSize: 11, color: 'var(--t2)' }}>
        <strong style={{ color: 'var(--blue)' }}>📎 Bijlagen & onderbouwing</strong> — Upload overige bestanden
        (e-mails, contracten, berekeningen, screenshots) als onderbouwing voor specifieke OHW-posten.
        Koppel elk bestand aan een BV + OHW-rij zodat het traceerbaar blijft. Max 10 MB per bestand.
      </div>

      {/* Upload formulier */}
      <div className="card" style={{ border: '1px solid var(--blue)' }}>
        <div className="card-hdr">
          <span className="card-title">Nieuwe bijlage uploaden voor {month}</span>
        </div>
        <div style={{ padding: 14, display: 'grid', gap: 10 }}>
          {/* Bestand drop zone */}
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFilePick(f) }}
            style={{
              border: `2px dashed ${pendingFile ? 'var(--green)' : 'var(--bd2)'}`,
              borderRadius: 7, padding: pendingFile ? '14px 18px' : '22px 14px', textAlign: 'center',
              cursor: 'pointer', background: 'var(--bg3)', transition: 'all .15s',
            }}
          >
            <input
              type="file" ref={fileRef} style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFilePick(f) }}
            />
            {pendingFile ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
                <span style={{ fontSize: 18 }}>{fileIcon(pendingFile.type, pendingFile.name)}</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{pendingFile.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--t3)' }}>{formatFileSize(pendingFile.size)}</div>
                </div>
                <button
                  className="btn sm ghost"
                  onClick={(e) => { e.stopPropagation(); setPendingFile(null); if (fileRef.current) fileRef.current.value = '' }}
                  style={{ fontSize: 10, color: 'var(--red)', marginLeft: 8 }}
                >
                  ✕ Wissen
                </button>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 22, marginBottom: 4 }}>📎</div>
                <div style={{ fontSize: 12, color: 'var(--t2)', fontWeight: 600 }}>Klik of sleep een bestand</div>
                <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 3 }}>PDF, Excel, Word, afbeelding, etc. — max 10 MB</div>
              </div>
            )}
          </div>

          {/* BV + OHW-rij koppeling */}
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10, alignItems: 'center' }}>
            <label style={{ fontSize: 11, color: 'var(--t2)', fontWeight: 600 }}>BV:</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {BVS.map(bv => (
                <button
                  key={bv}
                  onClick={() => { setUploadBv(bv); setUploadRowId('') }}
                  style={{
                    padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${uploadBv === bv ? BV_COLORS[bv] : 'var(--bd2)'}`,
                    background: uploadBv === bv ? `${BV_COLORS[bv]}22` : 'transparent',
                    color: uploadBv === bv ? BV_COLORS[bv] : 'var(--t3)',
                    fontFamily: 'var(--font)',
                  }}
                >{bv}</button>
              ))}
            </div>

            <label style={{ fontSize: 11, color: 'var(--t2)', fontWeight: 600 }}>OHW-rij:</label>
            <select
              value={uploadRowId}
              onChange={e => setUploadRowId(e.target.value)}
              style={{
                background: 'var(--bg1)', border: '1px solid var(--bd3)', borderRadius: 5,
                color: 'var(--t1)', fontSize: 11, padding: '6px 8px', outline: 'none',
                fontFamily: 'var(--font)',
              }}
            >
              <option value="">— kies een OHW-rij ({uploadRows.length} beschikbaar) —</option>
              {uploadRows.map(r => (
                <option key={r.id} value={r.id}>
                  [{r.id}] {r.description.slice(0, 90)}{r.description.length > 90 ? '…' : ''}
                </option>
              ))}
            </select>

            <label style={{ fontSize: 11, color: 'var(--t2)', fontWeight: 600 }}>Toelichting:</label>
            <input
              type="text"
              value={uploadDescription}
              onChange={e => setUploadDescription(e.target.value)}
              placeholder="Bijv. 'Mail klant over factuuracceptatie', 'BAM kontrakt', 'Berekening conceptfacturen Q1'"
              style={{
                background: 'var(--bg1)', border: '1px solid var(--bd3)', borderRadius: 5,
                color: 'var(--t1)', fontSize: 11, padding: '6px 8px', outline: 'none',
                fontFamily: 'var(--font)',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className="btn primary"
              onClick={handleSave}
              disabled={!pendingFile || !uploadRowId || saving}
              style={{ opacity: (!pendingFile || !uploadRowId || saving) ? 0.5 : 1 }}
            >
              {saving ? '⏳ Uploaden...' : '✓ Opslaan & koppelen'}
            </button>
            {!pendingFile && <span style={{ fontSize: 10, color: 'var(--t3)' }}>Kies eerst een bestand</span>}
            {pendingFile && !uploadRowId && <span style={{ fontSize: 10, color: 'var(--amber)' }}>Kies een OHW-rij</span>}
          </div>
        </div>
      </div>

      {/* Lijst van bijlagen */}
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">
            Bijlagen {showAllMonths ? '(alle maanden)' : `voor ${month}`}
          </span>
          <span style={{ fontSize: 10, color: 'var(--t3)', marginLeft: 6 }}>
            {filtered.length} {filtered.length === 1 ? 'bestand' : 'bestanden'}
          </span>

          {/* Filters */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              onClick={() => setShowAllMonths(v => !v)}
              className={`btn sm${showAllMonths ? ' primary' : ' ghost'}`}
              style={{ fontSize: 10 }}
              title="Toon bijlagen van alle maanden (niet alleen huidige)"
            >
              {showAllMonths ? 'Alle maanden' : `Alleen ${month}`}
            </button>
            <select
              value={filterBv}
              onChange={e => { setFilterBv(e.target.value as BvId | 'all'); setFilterRowId('') }}
              style={{
                background: 'var(--bg3)', border: '1px solid var(--bd2)', borderRadius: 5,
                color: 'var(--t1)', fontSize: 11, padding: '4px 8px',
              }}
            >
              <option value="all">Alle BVs</option>
              {BVS.map(bv => <option key={bv} value={bv}>{bv}</option>)}
            </select>
            {filterBv !== 'all' && filterRows.length > 0 && (
              <select
                value={filterRowId}
                onChange={e => setFilterRowId(e.target.value)}
                style={{
                  background: 'var(--bg3)', border: '1px solid var(--bd2)', borderRadius: 5,
                  color: 'var(--t1)', fontSize: 11, padding: '4px 8px', maxWidth: 260,
                }}
              >
                <option value="">Alle rijen</option>
                {filterRows.map(r => (
                  <option key={r.id} value={r.id}>
                    [{r.id}] {r.description.slice(0, 40)}{r.description.length > 40 ? '…' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Lijst */}
        {filtered.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--t3)', fontSize: 12 }}>
            Nog geen bijlagen — upload hierboven een bestand als onderbouwing.
          </div>
        ) : (
          <div style={{ padding: 10, display: 'grid', gap: 8 }}>
            {filtered.map(e => (
              <div
                key={e.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '8px 12px', borderRadius: 7,
                  background: 'var(--bg3)',
                  border: `1px solid ${BV_COLORS[e.entity as BvId] ?? 'var(--bd2)'}44`,
                }}
              >
                <span style={{ fontSize: 22 }}>{fileIcon(e.mimeType, e.fileName)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)' }}>{e.fileName}</div>
                  <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>
                    <span style={{
                      padding: '1px 6px', borderRadius: 3, fontWeight: 700, fontSize: 9,
                      background: `${BV_COLORS[e.entity as BvId] ?? 'var(--t3)'}22`,
                      color: BV_COLORS[e.entity as BvId] ?? 'var(--t3)',
                      marginRight: 6,
                    }}>{e.entity}</span>
                    <span style={{ fontFamily: 'var(--mono)', marginRight: 6 }}>[{e.ohwRowId}]</span>
                    {getOhwRowDescription(e.entity, e.ohwRowId).slice(0, 80)}
                  </div>
                  {e.description && (
                    <div style={{ fontSize: 10, color: 'var(--t2)', marginTop: 3, fontStyle: 'italic' }}>
                      💬 {e.description}
                    </div>
                  )}
                  <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 3 }}>
                    {e.month} · {formatFileSize(e.fileSize)} · {e.uploadedAt}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className="btn sm ghost"
                    onClick={() => downloadEvidence(e)}
                    style={{ fontSize: 10, color: 'var(--blue)' }}
                    title="Downloaden"
                  >↓</button>
                  <button
                    className="btn sm ghost"
                    onClick={() => handleDelete(e)}
                    style={{ fontSize: 10, color: 'var(--red)' }}
                    title="Verwijderen"
                  >✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Month selector */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
        <span style={{ color: 'var(--t3)' }}>Maand voor nieuwe uploads:</span>
        {closingMonths.map(m => (
          <button
            key={m}
            onClick={() => onMonthChange(m)}
            className={`btn sm${month === m ? ' primary' : ' ghost'}`}
            style={{ fontSize: 10 }}
          >{m}</button>
        ))}
      </div>

      <Toast toasts={toasts} />
    </>
  )
}
