import { useState } from 'react'
import { useOhwStore } from '../../store/useOhwStore'
import { recomputeEntity } from '../../lib/calc'
import type { OhwEntityData, OhwYearData } from '../../data/types'
import { supabaseEnabled } from '../../lib/supabase'

/** Balkje bovenaan de OHW tab met data-veiligheid tools:
 *  - Herstel oude localStorage snapshot (mocht die er nog zijn)
 *  - Export huidige state als JSON (voor lokale backup)
 *  - Import JSON (restore uit backup)
 *  - Supabase-status indicator (laat zien of sync werkt)
 */
export function OhwBackupBar() {
  const data2025 = useOhwStore(s => s.data2025)
  const data2026 = useOhwStore(s => s.data2026)
  const deletedRowIds = useOhwStore(s => s.deletedRowIds)
  const [status, setStatus] = useState<{ type: 'ok' | 'err' | 'info'; text: string } | null>(null)

  // ── Herstel poging uit localStorage (zoekt overgebleven snapshot) ──
  const tryRestoreFromLocalStorage = () => {
    try {
      const raw = localStorage.getItem('tpg-ohw-data')
      if (!raw) {
        setStatus({ type: 'err', text: 'Geen localStorage backup gevonden onder "tpg-ohw-data".' })
        return
      }
      const parsed = JSON.parse(raw)
      const state = parsed?.state ?? parsed
      if (!state?.data2026?.entities && !state?.data2025?.entities) {
        setStatus({ type: 'err', text: 'localStorage backup gevonden maar geen herkenbare OHW-data.' })
        return
      }
      // Direct naar de store schrijven (bypassing persist — we schrijven ruwe data terug)
      const storeState = useOhwStore.getState()
      const restore2025: OhwYearData = state.data2025?.entities
        ? { ...state.data2025, entities: state.data2025.entities.map((e: OhwEntityData) => recomputeEntity(e, state.data2025.allMonths)) }
        : storeState.data2025
      const restore2026: OhwYearData = state.data2026?.entities
        ? { ...state.data2026, entities: state.data2026.entities.map((e: OhwEntityData) => recomputeEntity(e, state.data2026.allMonths)) }
        : storeState.data2026
      useOhwStore.setState({
        data2025: restore2025,
        data2026: restore2026,
        deletedRowIds: state.deletedRowIds ?? storeState.deletedRowIds,
      })
      setStatus({ type: 'ok', text: '✓ Herstel gelukt — oude localStorage snapshot teruggezet in de store.' })
    } catch (err) {
      setStatus({ type: 'err', text: `Herstellen mislukt: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  // ── Export huidige state als downloadable JSON ──
  const exportJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      data2025,
      data2026,
      deletedRowIds,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tpg-ohw-backup-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setStatus({ type: 'ok', text: '✓ Backup gedownload — bewaar dit bestand.' })
  }

  // ── Import JSON file en zet state terug ──
  const importJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string)
        if (!parsed.data2026?.entities && !parsed.data2025?.entities) {
          setStatus({ type: 'err', text: 'Dit bestand bevat geen geldige OHW-data.' })
          return
        }
        const storeState = useOhwStore.getState()
        const restore2025: OhwYearData = parsed.data2025?.entities
          ? { ...parsed.data2025, entities: parsed.data2025.entities.map((en: OhwEntityData) => recomputeEntity(en, parsed.data2025.allMonths)) }
          : storeState.data2025
        const restore2026: OhwYearData = parsed.data2026?.entities
          ? { ...parsed.data2026, entities: parsed.data2026.entities.map((en: OhwEntityData) => recomputeEntity(en, parsed.data2026.allMonths)) }
          : storeState.data2026
        useOhwStore.setState({
          data2025: restore2025,
          data2026: restore2026,
          deletedRowIds: parsed.deletedRowIds ?? storeState.deletedRowIds,
        })
        setStatus({ type: 'ok', text: `✓ Geïmporteerd uit ${file.name}.` })
      } catch (err) {
        setStatus({ type: 'err', text: `Importeren mislukt: ${err instanceof Error ? err.message : String(err)}` })
      }
    }
    reader.readAsText(file)
    e.target.value = ''   // reset zodat dezelfde file opnieuw kan
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '8px 12px', background: 'var(--bg3)', border: '1px solid var(--bd2)',
      borderRadius: 7, fontSize: 11,
    }}>
      <span style={{ fontWeight: 600, color: 'var(--t2)' }}>💾 Data-veiligheid:</span>

      <button
        onClick={tryRestoreFromLocalStorage}
        className="btn sm ghost"
        style={{ fontSize: 11 }}
        title="Probeer een eventueel overgebleven localStorage snapshot terug te zetten"
      >
        ↺ Herstel lokale backup
      </button>

      <button
        onClick={exportJson}
        className="btn sm"
        style={{ fontSize: 11, background: 'var(--bd-green)', color: 'var(--green)', border: '1px solid var(--green)' }}
        title="Download een JSON backup van je OHW data — bewaar op een veilige plek"
      >
        ↓ Export backup
      </button>

      <label
        className="btn sm ghost"
        style={{ fontSize: 11, cursor: 'pointer' }}
        title="Upload een eerder gemaakte JSON backup om de data terug te zetten"
      >
        ↑ Import JSON
        <input type="file" accept=".json,application/json" onChange={importJson} style={{ display: 'none' }} />
      </label>

      <span style={{ marginLeft: 'auto', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{
          display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
          background: supabaseEnabled ? 'var(--green)' : 'var(--red)',
        }} />
        Supabase sync: <strong style={{ color: supabaseEnabled ? 'var(--green)' : 'var(--red)' }}>
          {supabaseEnabled ? 'actief' : 'UIT — data alleen lokaal'}
        </strong>
      </span>

      {status && (
        <div style={{
          flexBasis: '100%', marginTop: 4, padding: '6px 10px', borderRadius: 5,
          background: status.type === 'ok' ? 'var(--bd-green)' : status.type === 'err' ? 'var(--bd-red)' : 'var(--bd-blue)',
          color: status.type === 'ok' ? 'var(--green)' : status.type === 'err' ? 'var(--red)' : 'var(--blue)',
          border: `1px solid ${status.type === 'ok' ? 'var(--green)' : status.type === 'err' ? 'var(--red)' : 'var(--blue)'}`,
          fontSize: 11,
        }}>{status.text}</div>
      )}
    </div>
  )
}
