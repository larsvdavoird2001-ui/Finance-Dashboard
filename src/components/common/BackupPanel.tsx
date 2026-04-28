import { useState, useRef } from 'react'
import { listBackups, restoreBackup, deleteBackup, snapshotLocalStorage } from '../../lib/localBackup'
import { downloadBackupNow, importBackupFile } from '../../lib/dataExport'

interface Props {
  open: boolean
  onClose: () => void
  currentUserEmail: string | null
}

export function BackupPanel({ open, onClose, currentUserEmail }: Props) {
  const [backups, setBackups] = useState(() => listBackups())
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  if (!open) return null

  const onDownloadNow = () => {
    downloadBackupNow(currentUserEmail)
    setInfo('Backup-bestand wordt gedownload naar je Downloads-map.')
  }

  const onImportClick = () => fileInputRef.current?.click()

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null); setInfo(null)
    if (!confirm(`Backup-bestand inlezen: ${file.name}\n\nHuidige localStorage wordt overschreven met de inhoud van dit bestand. Een snapshot van de huidige staat wordt eerst gemaakt zodat je terug kunt.\n\nNa het inlezen wordt de pagina opnieuw geladen.\n\nDoorgaan?`)) {
      e.target.value = ''
      return
    }
    snapshotLocalStorage('pre-import')
    const r = await importBackupFile(file)
    e.target.value = ''
    if (!r.ok) {
      setError(r.error ?? 'Import mislukt')
      return
    }
    setInfo(`✓ ${r.keys} keys geïmporteerd. Pagina wordt opnieuw geladen...`)
    setTimeout(() => window.location.reload(), 800)
  }

  const refresh = () => setBackups(listBackups())

  const onMakeSnapshot = () => {
    snapshotLocalStorage(currentUserEmail)
    refresh()
    setInfo('Nieuwe snapshot gemaakt.')
  }

  const onRestore = (key: string, ts: number) => {
    setError(null); setInfo(null)
    if (!confirm(`Restore backup van ${new Date(ts).toLocaleString('nl-NL')}?\n\nHuidige staat wordt eerst geback-upt onder pre-restore-snapshot.\nNa restore wordt de pagina opnieuw geladen.`)) return
    const r = restoreBackup(key)
    if (!r.ok) {
      setError(r.error ?? 'Restore mislukt')
      return
    }
    setInfo('Restore geslaagd. Pagina wordt opnieuw geladen...')
    setTimeout(() => window.location.reload(), 600)
  }

  const onDelete = (key: string) => {
    if (!confirm('Backup verwijderen?')) return
    deleteBackup(key)
    refresh()
  }

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,.6)', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 720,
          background: 'var(--bg1)', border: '1px solid var(--bd2)',
          borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,.6)',
          padding: 22, color: 'var(--t1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 18 }}>💾</span>
          <strong style={{ fontSize: 14 }}>Backups & Export</strong>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button data-rw="ok" onClick={onDownloadNow} className="btn sm" style={{ fontSize: 11 }}>
              ↓ Download .json
            </button>
            <button data-rw="ok" onClick={onImportClick} className="btn sm" style={{ fontSize: 11 }}>
              ↑ Import .json
            </button>
            <button data-rw="ok" onClick={onMakeSnapshot} className="btn sm" style={{ fontSize: 11 }}>
              + Snapshot
            </button>
            <button onClick={onClose} className="btn sm ghost" style={{ fontSize: 11 }}>✕</button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={onFileChosen}
          data-rw="ok"
        />

        <div style={{ fontSize: 11, color: 'var(--t2)', lineHeight: 1.55, marginBottom: 14 }}>
          <strong>Download .json</strong>: lokaal bestand van je hele staat. Bewaar dit periodiek op je laptop voor maximale veiligheid.<br/>
          <strong>Import .json</strong>: lees een eerder gedownload backup-bestand terug.<br/>
          <strong>Snapshots</strong>: in-browser kopieën, laatste 5 bewaard. Beperkt — bij wissen van browserdata weg.
        </div>

        {error && (
          <div style={{ padding: '8px 12px', borderRadius: 6, background: 'var(--bd-red)', border: '1px solid var(--red)', color: 'var(--red)', fontSize: 11, marginBottom: 10 }}>
            ⚠ {error}
          </div>
        )}
        {info && (
          <div style={{ padding: '8px 12px', borderRadius: 6, background: 'var(--bd-green)', border: '1px solid var(--green)', color: 'var(--green)', fontSize: 11, marginBottom: 10 }}>
            ✓ {info}
          </div>
        )}

        {backups.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--t3)', padding: 16, textAlign: 'center' }}>
            Nog geen snapshots beschikbaar.
          </div>
        ) : (
          <table className="tbl" style={{ fontSize: 11 }}>
            <thead>
              <tr>
                <th>Tijd</th>
                <th>Gebruiker</th>
                <th className="r">#keys</th>
                <th className="r">Acties</th>
              </tr>
            </thead>
            <tbody>
              {backups.map(b => (
                <tr key={b.key}>
                  <td>{new Date(b.ts).toLocaleString('nl-NL')}</td>
                  <td style={{ color: 'var(--t2)' }}>{b.user || '—'}</td>
                  <td className="mono r">{b.keyCount}</td>
                  <td className="r">
                    <button
                      data-rw="ok"
                      className="btn sm"
                      style={{ fontSize: 10, marginRight: 4 }}
                      onClick={() => onRestore(b.key, b.ts)}
                    >↺ Restore</button>
                    <button
                      data-rw="ok"
                      className="btn sm ghost"
                      style={{ fontSize: 10, color: 'var(--red)' }}
                      onClick={() => onDelete(b.key)}
                    >✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
