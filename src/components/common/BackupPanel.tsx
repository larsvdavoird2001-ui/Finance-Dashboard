import { useState } from 'react'
import { listBackups, restoreBackup, deleteBackup, snapshotLocalStorage } from '../../lib/localBackup'

interface Props {
  open: boolean
  onClose: () => void
  currentUserEmail: string | null
}

export function BackupPanel({ open, onClose, currentUserEmail }: Props) {
  const [backups, setBackups] = useState(() => listBackups())
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

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
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 10 }}>
          <span style={{ fontSize: 18 }}>💾</span>
          <strong style={{ fontSize: 14 }}>localStorage backups</strong>
          <button
            data-rw="ok"
            onClick={onMakeSnapshot}
            className="btn sm"
            style={{ marginLeft: 'auto', fontSize: 11 }}
          >+ Nieuwe snapshot</button>
          <button onClick={onClose} className="btn sm ghost" style={{ fontSize: 11 }}>✕ Sluiten</button>
        </div>

        <div style={{ fontSize: 11, color: 'var(--t2)', lineHeight: 1.55, marginBottom: 14 }}>
          De app maakt automatisch een snapshot van je localStorage bij elke start. De laatste 5 worden bewaard.
          Als data 'verdwijnt' kun je hier terugklikken naar een eerdere staat — daarna laadt de pagina opnieuw met die staat.
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
