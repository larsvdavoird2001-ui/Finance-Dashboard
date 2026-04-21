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

export function TariffTable() {
  const { entries, updateEntry, addEntry, removeEntry } = useTariffStore()
  const { toasts, showToast } = useToast()
  const [search, setSearch] = useState('')
  const [filterBv, setFilterBv] = useState<string>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTarief, setEditTarief] = useState('')

  const bvs = [...new Set(entries.map(e => e.bedrijf))].sort()

  const filtered = entries.filter(e => {
    if (filterBv !== 'all' && e.bedrijf !== filterBv) return false
    if (search) {
      const s = search.toLowerCase()
      return e.naam.toLowerCase().includes(s) ||
             e.id.includes(s) ||
             e.functie.toLowerCase().includes(s) ||
             e.team.toLowerCase().includes(s)
    }
    return true
  })

  const handleSaveTarief = (id: string) => {
    const val = parseFloat(editTarief.replace(',', '.'))
    if (!isNaN(val) && val >= 0) {
      updateEntry(id, { tarief: val })
      showToast(`Tarief bijgewerkt`, 'g')
    }
    setEditingId(null)
  }

  const handleAdd = () => {
    const id = `new-${Date.now()}`
    const entry: TariffEntry = {
      id, bedrijf: 'Consultancy', naam: '', powerbiNaam: '', stroming: '',
      tarief: 0, fte: null, functie: '', leidingGevende: '', manager: '',
      powerbiNaam2: '', team: '',
    }
    addEntry(entry)
    setEditingId(id)
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <input
          style={{
            background: 'var(--bg3)', border: '1px solid var(--bd2)', borderRadius: 6,
            color: 'var(--t1)', fontSize: 12, padding: '6px 10px', width: 220, outline: 'none',
          }}
          placeholder="Zoek op naam, ID, functie..."
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
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>{filtered.length} medewerkers</span>
        <button className="btn sm primary" style={{ marginLeft: 'auto', fontSize: 11 }} onClick={handleAdd}>
          + Medewerker toevoegen
        </button>
      </div>

      <div className="card">
        <div className="card-hdr">
          <span className="card-title">IC Tarieven 2026</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>
            Tarieven worden gebruikt bij Missing Hours berekening (× uren × 0,9)
          </span>
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 500, overflowY: 'auto' }}>
          <table className="tbl" style={{ fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 2, minWidth: 60 }}>ID</th>
                <th style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 2, minWidth: 80 }}>BV</th>
                <th style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 2, minWidth: 160 }}>Naam</th>
                <th style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 2, minWidth: 100 }}>Functie</th>
                <th style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 2, minWidth: 80 }}>Team</th>
                <th style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 2, minWidth: 80 }}>Stroming</th>
                <th className="r" style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 2, minWidth: 90 }}>Tarief</th>
                <th className="r" style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 2, minWidth: 50 }}>FTE</th>
                <th style={{ position: 'sticky', top: 0, background: 'var(--bg3)', zIndex: 2, width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--t3)', padding: 20 }}>Geen medewerkers gevonden</td></tr>
              )}
              {filtered.map(entry => (
                <tr key={entry.id} className="sub">
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t3)' }}>{entry.id}</td>
                  <td>
                    <span style={{
                      fontSize: 10, padding: '2px 6px', borderRadius: 3, fontWeight: 600,
                      background: `${BV_COLORS[entry.bedrijf] ?? 'var(--t3)'}22`,
                      color: BV_COLORS[entry.bedrijf] ?? 'var(--t3)',
                    }}>
                      {entry.bedrijf}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{entry.naam}</td>
                  <td style={{ color: 'var(--t2)' }}>{entry.functie}</td>
                  <td style={{ color: 'var(--t3)' }}>{entry.team}</td>
                  <td style={{ color: 'var(--t3)' }}>{entry.stroming}</td>
                  <td className="r" style={{ padding: '3px 8px' }}>
                    {editingId === entry.id ? (
                      <input
                        className="ohw-inp"
                        style={{ width: 70, textAlign: 'right' }}
                        autoFocus
                        value={editTarief}
                        onChange={e => setEditTarief(e.target.value)}
                        onBlur={() => handleSaveTarief(entry.id)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveTarief(entry.id) }}
                      />
                    ) : (
                      <span
                        style={{ cursor: 'pointer', fontFamily: 'var(--mono)', fontWeight: 600, color: 'var(--t1)' }}
                        onClick={() => { setEditingId(entry.id); setEditTarief(String(entry.tarief)) }}
                        title="Klik om tarief aan te passen"
                      >
                        € {entry.tarief.toFixed(2)}
                      </span>
                    )}
                  </td>
                  <td className="mono r" style={{ color: 'var(--t3)' }}>
                    {entry.fte != null ? entry.fte : '—'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      className="btn sm ghost"
                      style={{ color: 'var(--red)', padding: '2px 6px', fontSize: 10 }}
                      onClick={() => { removeEntry(entry.id); showToast('Medewerker verwijderd', 'r') }}
                    >✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Toast toasts={toasts} />
    </>
  )
}
