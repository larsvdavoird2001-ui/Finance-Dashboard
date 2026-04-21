import { useState } from 'react'
import { useTariffStore } from '../../store/useTariffStore'
import type { TariffEntry } from '../../data/types'
import { useToast } from '../../hooks/useToast'
import { Toast } from '../common/Toast'

const BV_COLORS: Record<string, string> = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
  Spanje:      '#f59e0b',
}
const BV_OPTIONS = ['Consultancy', 'Projects', 'Software', 'Spanje', 'Holdings']

/** Losse cel-input componenten — bound aan draft state */
const inputStyle: React.CSSProperties = {
  background: 'var(--bg1)', border: '1px solid var(--bd3)', borderRadius: 4,
  color: 'var(--t1)', fontSize: 11, padding: '3px 6px',
  outline: 'none', width: '100%', fontFamily: 'var(--font)',
}

export function TariffTable() {
  const { entries, updateEntry, addEntry, removeEntry } = useTariffStore()
  const { toasts, showToast } = useToast()
  const [search, setSearch] = useState('')
  const [filterBv, setFilterBv] = useState<string>('all')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<TariffEntry | null>(null)
  /** Entry IDs die brand-new zijn (voor cancel-to-delete gedrag) */
  const [newEntryIds, setNewEntryIds] = useState<Set<string>>(new Set())

  const bvs = [...new Set(entries.map(e => e.bedrijf))].filter(Boolean).sort()

  const hasMissingTariff = (e: TariffEntry) => !e.tarief || e.tarief <= 0

  const filtered = entries.filter(e => {
    if (filterBv !== 'all' && e.bedrijf !== filterBv) return false
    if (onlyMissing && !hasMissingTariff(e)) return false
    if (search) {
      const s = search.toLowerCase()
      return (e.naam?.toLowerCase() ?? '').includes(s) ||
             (e.id ?? '').includes(s) ||
             (e.functie?.toLowerCase() ?? '').includes(s) ||
             (e.team?.toLowerCase() ?? '').includes(s) ||
             (e.powerbiNaam?.toLowerCase() ?? '').includes(s) ||
             (e.powerbiNaam2?.toLowerCase() ?? '').includes(s)
    }
    return true
  })

  const missingCount = entries.filter(hasMissingTariff).length
  const missingByBv: Record<string, number> = {}
  for (const e of entries) {
    if (hasMissingTariff(e)) {
      missingByBv[e.bedrijf || '(geen BV)'] = (missingByBv[e.bedrijf || '(geen BV)'] ?? 0) + 1
    }
  }

  const startEdit = (entry: TariffEntry) => {
    setEditingId(entry.id)
    setDraft({ ...entry })
  }

  const patchDraft = (patch: Partial<TariffEntry>) => {
    setDraft(d => d ? { ...d, ...patch } : d)
  }

  const saveEdit = () => {
    if (!draft || !editingId) return
    if (!draft.naam?.trim() && !draft.powerbiNaam?.trim()) {
      showToast('Naam is verplicht', 'r')
      return
    }
    if (!draft.bedrijf?.trim()) {
      showToast('BV is verplicht', 'r')
      return
    }
    // Commit alle velden
    const { id, ...patch } = draft
    void id
    updateEntry(editingId, patch)
    setNewEntryIds(prev => {
      const next = new Set(prev)
      next.delete(editingId)
      return next
    })
    showToast('Medewerker opgeslagen', 'g')
    setEditingId(null)
    setDraft(null)
  }

  const cancelEdit = () => {
    if (editingId && newEntryIds.has(editingId)) {
      // Brand-new entry — verwijder 'm als user cancelt
      removeEntry(editingId)
      setNewEntryIds(prev => {
        const next = new Set(prev)
        next.delete(editingId)
        return next
      })
      showToast('Toevoegen geannuleerd', 'r')
    }
    setEditingId(null)
    setDraft(null)
  }

  const handleAdd = () => {
    if (editingId) {
      showToast('Sluit eerst de huidige bewerking af', 'r')
      return
    }
    const id = `new-${Date.now()}`
    const entry: TariffEntry = {
      id,
      bedrijf: filterBv !== 'all' ? filterBv : 'Consultancy',
      naam: '', powerbiNaam: '', stroming: '',
      tarief: 0, fte: null, functie: '', leidingGevende: '', manager: '',
      powerbiNaam2: '', team: '',
    }
    addEntry(entry)
    setNewEntryIds(prev => new Set(prev).add(id))
    setEditingId(id)
    setDraft({ ...entry })
    // Scroll naar boven — nieuwe entries verschijnen meestal onderaan
    setTimeout(() => {
      const row = document.getElementById(`tariff-row-${id}`)
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
  }

  const handleDelete = (entry: TariffEntry) => {
    if (!confirm(`Weet je zeker dat je ${entry.naam || entry.id} wilt verwijderen?`)) return
    removeEntry(entry.id)
    showToast('Medewerker verwijderd', 'r')
    if (editingId === entry.id) { setEditingId(null); setDraft(null) }
  }

  // ── Render helpers ──
  const renderEditRow = (entry: TariffEntry) => {
    if (!draft) return null
    return (
      <tr key={entry.id} id={`tariff-row-${entry.id}`} style={{ background: 'rgba(0,169,224,0.08)' }}>
        <td style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--t3)', padding: '4px 8px' }}>
          {newEntryIds.has(entry.id) ? 'NIEUW' : entry.id}
        </td>
        <td style={{ padding: '4px 6px' }}>
          <select
            style={{ ...inputStyle, cursor: 'pointer' }}
            value={draft.bedrijf}
            onChange={e => patchDraft({ bedrijf: e.target.value })}
          >
            {BV_OPTIONS.map(bv => <option key={bv} value={bv}>{bv}</option>)}
          </select>
        </td>
        <td style={{ padding: '4px 6px' }}>
          <input
            style={inputStyle}
            value={draft.naam}
            placeholder="Voor- en achternaam"
            onChange={e => patchDraft({ naam: e.target.value })}
            autoFocus
          />
          <input
            style={{ ...inputStyle, marginTop: 3, fontSize: 10, color: 'var(--t3)' }}
            value={draft.powerbiNaam}
            placeholder="PowerBI-naam (bv. 'Janzen, Kevin')"
            onChange={e => patchDraft({ powerbiNaam: e.target.value })}
          />
          <input
            style={{ ...inputStyle, marginTop: 3, fontSize: 10, color: 'var(--t3)' }}
            value={draft.powerbiNaam2}
            placeholder="SAP alias (bv. 'KJANZEN')"
            onChange={e => patchDraft({ powerbiNaam2: e.target.value })}
          />
        </td>
        <td style={{ padding: '4px 6px' }}>
          <input
            style={inputStyle}
            value={draft.functie}
            placeholder="Functie"
            onChange={e => patchDraft({ functie: e.target.value })}
          />
        </td>
        <td style={{ padding: '4px 6px' }}>
          <input
            style={inputStyle}
            value={draft.team}
            placeholder="Team"
            onChange={e => patchDraft({ team: e.target.value })}
          />
        </td>
        <td style={{ padding: '4px 6px' }}>
          <input
            style={inputStyle}
            value={draft.stroming}
            placeholder="Stroming"
            onChange={e => patchDraft({ stroming: e.target.value })}
          />
        </td>
        <td className="r" style={{ padding: '4px 6px' }}>
          <input
            style={{ ...inputStyle, textAlign: 'right', fontFamily: 'var(--mono)' }}
            value={String(draft.tarief ?? '')}
            placeholder="€/uur"
            onChange={e => {
              const v = parseFloat(e.target.value.replace(',', '.'))
              patchDraft({ tarief: isNaN(v) ? 0 : v })
            }}
            onKeyDown={e => { if (e.key === 'Enter') saveEdit(); else if (e.key === 'Escape') cancelEdit() }}
          />
        </td>
        <td className="r" style={{ padding: '4px 6px' }}>
          <input
            style={{ ...inputStyle, textAlign: 'right', fontFamily: 'var(--mono)' }}
            value={draft.fte == null ? '' : String(draft.fte)}
            placeholder="FTE"
            onChange={e => {
              const raw = e.target.value.trim()
              if (!raw) { patchDraft({ fte: null }); return }
              const v = parseFloat(raw.replace(',', '.'))
              patchDraft({ fte: isNaN(v) ? null : v })
            }}
          />
        </td>
        <td style={{ textAlign: 'center', padding: '4px' }}>
          <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
            <button
              className="btn sm success"
              style={{ padding: '3px 8px', fontSize: 10 }}
              onClick={saveEdit}
              title="Opslaan (Enter)"
            >✓</button>
            <button
              className="btn sm ghost"
              style={{ padding: '3px 8px', fontSize: 10, color: 'var(--t3)' }}
              onClick={cancelEdit}
              title="Annuleren (Esc)"
            >✕</button>
          </div>
        </td>
      </tr>
    )
  }

  const renderDisplayRow = (entry: TariffEntry) => {
    const missing = hasMissingTariff(entry)
    return (
    <tr
      key={entry.id}
      id={`tariff-row-${entry.id}`}
      className="sub"
      style={missing ? { background: 'rgba(239,83,80,0.05)' } : undefined}
    >
      <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t3)' }}>
        {missing && <span style={{ color: 'var(--red)', marginRight: 4 }}>⚠</span>}
        {entry.id}
      </td>
      <td>
        <span style={{
          fontSize: 10, padding: '2px 6px', borderRadius: 3, fontWeight: 600,
          background: `${BV_COLORS[entry.bedrijf] ?? 'var(--t3)'}22`,
          color: BV_COLORS[entry.bedrijf] ?? 'var(--t3)',
        }}>
          {entry.bedrijf || '—'}
        </span>
      </td>
      <td>
        <div style={{ fontWeight: 600 }}>{entry.naam || <span style={{ color: 'var(--t3)' }}>(geen naam)</span>}</div>
        {(entry.powerbiNaam || entry.powerbiNaam2) && (
          <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 1 }}>
            {entry.powerbiNaam}{entry.powerbiNaam && entry.powerbiNaam2 ? ' · ' : ''}{entry.powerbiNaam2}
          </div>
        )}
      </td>
      <td style={{ color: 'var(--t2)' }}>{entry.functie || '—'}</td>
      <td style={{ color: 'var(--t3)' }}>{entry.team || '—'}</td>
      <td style={{ color: 'var(--t3)' }}>{entry.stroming || '—'}</td>
      <td className="r mono" style={{
        fontWeight: 600,
        color: entry.tarief > 0 ? 'var(--t1)' : 'var(--red)',
      }}>
        {entry.tarief > 0 ? `€ ${entry.tarief.toFixed(2)}` : '— (geen tarief)'}
      </td>
      <td className="mono r" style={{ color: 'var(--t3)' }}>
        {entry.fte != null ? entry.fte : '—'}
      </td>
      <td style={{ textAlign: 'center' }}>
        <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
          <button
            className="btn sm ghost"
            style={{ padding: '2px 6px', fontSize: 10, color: 'var(--blue)' }}
            onClick={() => startEdit(entry)}
            title="Bewerken"
          >✎</button>
          <button
            className="btn sm ghost"
            style={{ padding: '2px 6px', fontSize: 10, color: 'var(--red)' }}
            onClick={() => handleDelete(entry)}
            title="Verwijderen"
          >✕</button>
        </div>
      </td>
    </tr>
  )
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <input
          style={{
            background: 'var(--bg3)', border: '1px solid var(--bd2)', borderRadius: 6,
            color: 'var(--t1)', fontSize: 12, padding: '6px 10px', width: 240, outline: 'none',
          }}
          placeholder="Zoek op naam, ID, functie, team, alias..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          style={{
            background: 'var(--bg3)', border: '1px solid var(--bd2)', borderRadius: 6,
            color: 'var(--t1)', fontSize: 12, padding: '6px 8px', outline: 'none', cursor: 'pointer',
          }}
          value={filterBv}
          onChange={e => setFilterBv(e.target.value)}
        >
          <option value="all">Alle BVs ({entries.length})</option>
          {bvs.map(bv => (
            <option key={bv} value={bv}>{bv} ({entries.filter(e => e.bedrijf === bv).length})</option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>{filtered.length} medewerker{filtered.length === 1 ? '' : 's'}</span>
        <button
          onClick={() => setOnlyMissing(v => !v)}
          style={{
            padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            border: '1px solid',
            fontFamily: 'var(--font)',
            borderColor: onlyMissing ? 'var(--red)' : missingCount > 0 ? 'var(--amber)' : 'var(--bd2)',
            background:  onlyMissing ? 'var(--bd-red)' : missingCount > 0 ? 'var(--bd-amber)' : 'transparent',
            color:       onlyMissing ? 'var(--red)' : missingCount > 0 ? 'var(--amber)' : 'var(--t3)',
          }}
          title={missingCount > 0 ? `${missingCount} medewerker(s) zonder IC tarief — klik om alleen deze te tonen` : 'Alle medewerkers hebben een tarief'}
        >
          ⚠ {missingCount} zonder tarief {onlyMissing && '· FILTER AAN'}
        </button>
        <button
          className="btn sm primary"
          style={{ marginLeft: 'auto', fontSize: 11 }}
          onClick={handleAdd}
          disabled={!!editingId}
          title={editingId ? 'Sluit eerst de huidige bewerking af' : 'Nieuwe medewerker toevoegen'}
        >
          + Medewerker toevoegen
        </button>
      </div>

      {/* Per-BV breakdown van medewerkers zonder tarief */}
      {missingCount > 0 && !onlyMissing && (
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
          marginBottom: 8, padding: '6px 10px',
          background: 'rgba(245,166,35,0.08)',
          border: '1px solid rgba(245,166,35,0.3)',
          borderRadius: 6, fontSize: 10, color: 'var(--amber)',
        }}>
          <span style={{ fontWeight: 700 }}>⚠ Ontbrekende tarieven per BV:</span>
          {Object.entries(missingByBv).map(([bv, count]) => (
            <span key={bv} style={{
              padding: '2px 8px', borderRadius: 3,
              background: `${BV_COLORS[bv] ?? 'var(--amber)'}22`,
              color: BV_COLORS[bv] ?? 'var(--amber)',
              fontWeight: 600,
            }}>
              {bv}: {count}
            </span>
          ))}
          <span style={{ color: 'var(--t3)', fontSize: 10, marginLeft: 6 }}>
            → klik op de ⚠ knop hierboven om alleen deze te tonen
          </span>
        </div>
      )}

      <div className="card">
        <div className="card-hdr">
          <span className="card-title">IC Tarieven 2026</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>
            Tarieven worden gebruikt bij Missing Hours berekening (× uren × 0,9) ·
            Klik op ✎ om te bewerken
          </span>
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 550, overflowY: 'auto' }}>
          <table className="tbl" style={{ fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 2, minWidth: 60 }}>ID</th>
                <th style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 2, minWidth: 120 }}>BV</th>
                <th style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 2, minWidth: 200 }}>Naam + aliases</th>
                <th style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 2, minWidth: 120 }}>Functie</th>
                <th style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 2, minWidth: 100 }}>Team</th>
                <th style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 2, minWidth: 100 }}>Stroming</th>
                <th className="r" style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 2, minWidth: 90 }}>Tarief</th>
                <th className="r" style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 2, minWidth: 60 }}>FTE</th>
                <th style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 2, width: 70 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--t3)', padding: 20 }}>Geen medewerkers gevonden</td></tr>
              )}
              {filtered.map(entry =>
                editingId === entry.id ? renderEditRow(entry) : renderDisplayRow(entry)
              )}
            </tbody>
          </table>
        </div>
      </div>
      <Toast toasts={toasts} />
    </>
  )
}
