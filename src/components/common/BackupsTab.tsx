import { useState, useRef, useMemo } from 'react'
import {
  listBackups,
  restoreBackup,
  deleteBackup,
  snapshotLocalStorage,
} from '../../lib/localBackup'
import { downloadBackupNow, importBackupFile } from '../../lib/dataExport'

interface Props {
  isAdmin: boolean
  currentEmail: string | null
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function fmtDateTime(ts: number): { date: string; time: string; rel: string } {
  const d = new Date(ts)
  const dateStr = d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const timeStr = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  const diffMs = Date.now() - ts
  const minutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  let rel = ''
  if (minutes < 1) rel = 'zojuist'
  else if (minutes < 60) rel = `${minutes} min geleden`
  else if (hours < 24) rel = `${hours} uur geleden`
  else rel = `${days} dag${days === 1 ? '' : 'en'} geleden`
  return { date: dateStr, time: timeStr, rel }
}

function approxStorageSize(): number {
  let total = 0
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k) continue
    const v = localStorage.getItem(k) ?? ''
    total += k.length + v.length
  }
  return total * 2 // UTF-16 = 2 bytes per char in localStorage
}

export function BackupsTab({ isAdmin, currentEmail }: Props) {
  const [backups, setBackups] = useState(() => listBackups())
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const totalLocalSize = useMemo(approxStorageSize, [backups])

  const githubRepoUrl = 'https://github.com/larsvdavoird2001-ui/Finance-Dashboard'
  const githubBackupsUrl = `${githubRepoUrl}/tree/main/backups`
  const githubActionsUrl = `${githubRepoUrl}/actions/workflows/backup-supabase.yml`

  if (!isAdmin) {
    return (
      <div className="page">
        <div className="card" style={{ padding: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--amber)', marginBottom: 8 }}>
            ⚠ Geen toegang
          </div>
          <div style={{ fontSize: 12, color: 'var(--t2)' }}>
            Alleen admins kunnen backups beheren.
          </div>
        </div>
      </div>
    )
  }

  const refresh = () => setBackups(listBackups())

  const onMakeSnapshot = () => {
    snapshotLocalStorage(currentEmail)
    refresh()
    setError(null); setInfo('Snapshot opgeslagen in browser-localStorage.')
  }

  const onDownloadNow = () => {
    setError(null)
    downloadBackupNow(currentEmail)
    setInfo('Backup-bestand wordt gedownload naar je Downloads-map.')
  }

  const onImportClick = () => fileInputRef.current?.click()

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null); setInfo(null)
    if (!confirm(
      `Backup-bestand inlezen: ${file.name}\n\n` +
      `Huidige browser-data wordt overschreven met de inhoud van dit bestand. ` +
      `Een snapshot van de huidige staat wordt eerst gemaakt zodat je terug kunt.\n\n` +
      `Na het inlezen wordt de pagina opnieuw geladen.\n\nDoorgaan?`
    )) {
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

  const onRestore = (key: string, ts: number) => {
    setError(null); setInfo(null)
    if (!confirm(
      `Restore browser-snapshot van ${new Date(ts).toLocaleString('nl-NL')}?\n\n` +
      `Huidige staat wordt eerst geback-upt onder pre-restore-snapshot.\n` +
      `Na restore wordt de pagina opnieuw geladen.`
    )) return
    const r = restoreBackup(key)
    if (!r.ok) {
      setError(r.error ?? 'Restore mislukt')
      return
    }
    setInfo('✓ Restore geslaagd. Pagina wordt opnieuw geladen...')
    setTimeout(() => window.location.reload(), 600)
  }

  const onDelete = (key: string) => {
    if (!confirm('Snapshot verwijderen?')) return
    deleteBackup(key)
    refresh()
  }

  return (
    <div className="page">
      {/* ── Status overview ─────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">🛡 Backup-strategie — drie onafhankelijke vangnetten</span>
        </div>
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <div style={{ padding: 12, background: 'var(--bg2)', borderRadius: 7, border: '1px solid var(--bd2)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
              1. Supabase database
            </div>
            <div style={{ fontSize: 12, color: 'var(--t1)', marginBottom: 6 }}>
              Primaire opslag — gedeeld tussen alle gebruikers
            </div>
            <div style={{ fontSize: 10, color: 'var(--t3)' }}>
              Realtime sync, automatisch bij elke bewerking
            </div>
          </div>
          <div style={{ padding: 12, background: 'var(--bg2)', borderRadius: 7, border: '1px solid var(--bd2)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
              2. Github snapshots
            </div>
            <div style={{ fontSize: 12, color: 'var(--t1)', marginBottom: 6 }}>
              Versie-history in <code style={{ fontSize: 10 }}>backups/</code> map
            </div>
            <div style={{ fontSize: 10, color: 'var(--t3)' }}>
              Elke 6 uur automatisch + handmatig via Actions-tab
            </div>
            <a
              href={githubBackupsUrl}
              target="_blank"
              rel="noreferrer"
              data-rw="ok"
              style={{ display: 'inline-block', marginTop: 6, fontSize: 10, color: 'var(--blue)', textDecoration: 'underline' }}
            >Open op Github →</a>
          </div>
          <div style={{ padding: 12, background: 'var(--bg2)', borderRadius: 7, border: '1px solid var(--bd2)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
              3. Browser & Downloads
            </div>
            <div style={{ fontSize: 12, color: 'var(--t1)', marginBottom: 6 }}>
              Snapshots in browser + .json in Downloads-map
            </div>
            <div style={{ fontSize: 10, color: 'var(--t3)' }}>
              Auto-download elke 24u + handmatig
            </div>
          </div>
        </div>
      </div>

      {/* ── Error / Info banners ────────────────────────────────────────── */}
      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 7, background: 'var(--bd-red)', border: '1px solid var(--red)', color: 'var(--red)', fontSize: 12 }}>
          ⚠ {error}
        </div>
      )}
      {info && (
        <div style={{ padding: '10px 14px', borderRadius: 7, background: 'var(--bd-green)', border: '1px solid var(--green)', color: 'var(--green)', fontSize: 12 }}>
          ✓ {info}
        </div>
      )}

      {/* ── Github Action card ──────────────────────────────────────────── */}
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">🔁 Automatische backups in Git</span>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.6, marginBottom: 12 }}>
            Een Github Action draait elke 6 uur en commit een complete dump van Supabase
            (inclusief alle bewerkingen die in tussentijd zijn gemaakt) naar deze repo.
            Daarmee heb je versie-history van je hele dataset — elke commit is herstelbaar
            via Git.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a
              href={githubActionsUrl}
              target="_blank"
              rel="noreferrer"
              data-rw="ok"
              className="btn sm primary"
              style={{ fontSize: 11, textDecoration: 'none' }}
            >
              🚀 Open Github Actions (handmatig triggeren)
            </a>
            <a
              href={githubBackupsUrl}
              target="_blank"
              rel="noreferrer"
              data-rw="ok"
              className="btn sm ghost"
              style={{ fontSize: 11, textDecoration: 'none' }}
            >
              📂 Bekijk alle backups in repo
            </a>
          </div>
        </div>
      </div>

      {/* ── Lokale acties ───────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">💾 Lokale backup-acties</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>
            localStorage: ~{fmtSize(totalLocalSize)}
          </span>
        </div>
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <button
            data-rw="ok"
            onClick={onDownloadNow}
            className="btn"
            style={{ flexDirection: 'column', padding: 14, textAlign: 'center', height: 'auto' }}
          >
            <span style={{ fontSize: 22 }}>↓</span>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Download .json</span>
            <span style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>
              Bestand naar je Downloads-map
            </span>
          </button>
          <button
            data-rw="ok"
            onClick={onImportClick}
            className="btn"
            style={{ flexDirection: 'column', padding: 14, textAlign: 'center', height: 'auto' }}
          >
            <span style={{ fontSize: 22 }}>↑</span>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Import .json</span>
            <span style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>
              Eerder gedownload bestand inlezen
            </span>
          </button>
          <button
            data-rw="ok"
            onClick={onMakeSnapshot}
            className="btn"
            style={{ flexDirection: 'column', padding: 14, textAlign: 'center', height: 'auto' }}
          >
            <span style={{ fontSize: 22 }}>+</span>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Nieuwe snapshot</span>
            <span style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>
              In browser bewaren
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={onFileChosen}
            data-rw="ok"
          />
        </div>
      </div>

      {/* ── In-browser snapshots tabel ──────────────────────────────────── */}
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">📋 Browser-snapshots</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>
            {backups.length} / 5 max — automatisch opgeslagen bij elke app-start
          </span>
        </div>
        {backups.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--t3)' }}>
            Nog geen snapshots beschikbaar.<br />
            <span style={{ fontSize: 10 }}>De volgende wordt gemaakt zodra de pagina herlaadt.</span>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ minWidth: 130 }}>Datum</th>
                  <th>Tijd</th>
                  <th>Geleden</th>
                  <th>Door</th>
                  <th className="r">Keys</th>
                  <th className="r">Acties</th>
                </tr>
              </thead>
              <tbody>
                {backups.map(b => {
                  const f = fmtDateTime(b.ts)
                  return (
                    <tr key={b.key}>
                      <td>{f.date}</td>
                      <td className="mono">{f.time}</td>
                      <td style={{ color: 'var(--t2)', fontSize: 11 }}>{f.rel}</td>
                      <td style={{ color: 'var(--t2)', fontSize: 11 }}>{b.user || '—'}</td>
                      <td className="mono r">{b.keyCount}</td>
                      <td className="r" style={{ whiteSpace: 'nowrap' }}>
                        <button
                          data-rw="ok"
                          className="btn sm primary"
                          style={{ fontSize: 10, marginRight: 4 }}
                          onClick={() => onRestore(b.key, b.ts)}
                          title="Herstel deze staat (huidige wordt eerst geback-upt)"
                        >↺ Restore</button>
                        <button
                          data-rw="ok"
                          className="btn sm ghost"
                          style={{ fontSize: 10, color: 'var(--red)' }}
                          onClick={() => onDelete(b.key)}
                          title="Verwijder deze snapshot"
                        >✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Recovery-instructies ────────────────────────────────────────── */}
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">🆘 Wat te doen als data toch verdwijnt?</span>
        </div>
        <div style={{ padding: 16, fontSize: 12, color: 'var(--t2)', lineHeight: 1.7 }}>
          <ol style={{ paddingLeft: 22, margin: 0 }}>
            <li><strong style={{ color: 'var(--t1)' }}>Probeer een browser-snapshot</strong> hierboven — klik op "↺ Restore" bij de meest recente.</li>
            <li><strong style={{ color: 'var(--t1)' }}>Importeer een eerder gedownload .json bestand</strong> uit je Downloads-map via "↑ Import .json".</li>
            <li>
              <strong style={{ color: 'var(--t1)' }}>Pak een snapshot uit Github:</strong> open
              <a href={githubBackupsUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}> backups/ in de repo</a>,
              kies een datum, download de JSON, en gebruik "↑ Import .json".
            </li>
            <li>
              <strong style={{ color: 'var(--t1)' }}>Specifieke tabel uit Supabase recoveren?</strong> Open Github,
              vind de gewenste backup-commit, kopieer de tabel-data uit de JSON en zet die als SQL terug in Supabase.
            </li>
          </ol>
        </div>
      </div>
    </div>
  )
}
