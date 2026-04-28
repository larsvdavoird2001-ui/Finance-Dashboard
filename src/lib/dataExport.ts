/** Auto-export van alle TPG-data naar een JSON-bestand op de gebruikers PC.
 *  Werkt als ultieme veiligheidsklep: zelfs als Supabase faalt EN localStorage
 *  wordt gewist, kan de gebruiker altijd het JSON-bestand uit zijn Downloads-
 *  map terughalen.
 *
 *  - Eens per app-start (alleen voor admin) downloaden we een snapshot.
 *  - Filename: tpg-finance-backup-<datum>.json
 *  - Bevat: alle tpg-* localStorage keys, niet alleen wat in Supabase staat.
 */

const DATA_PREFIX = 'tpg-'
const BACKUP_PREFIX = 'tpg-backup-'
const IGNORE_KEYS = new Set(['tpg-last-user'])
const LAST_DOWNLOAD_KEY = 'tpg-last-export-ts'
const ONE_DAY_MS = 24 * 60 * 60 * 1000

interface ExportSnapshot {
  exportedAt: string
  user: string
  appVersion: string
  data: Record<string, unknown>
}

/** Verzamel alle tpg-* keys (excl. backups en ignore) als JSON-object. */
function collectData(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k) continue
    if (!k.startsWith(DATA_PREFIX)) continue
    if (k.startsWith(BACKUP_PREFIX)) continue
    if (IGNORE_KEYS.has(k)) continue
    if (k === LAST_DOWNLOAD_KEY) continue
    const v = localStorage.getItem(k)
    if (v == null) continue
    try { out[k] = JSON.parse(v) } catch { out[k] = v }
  }
  return out
}

/** Forceer een download van het backup-bestand. */
export function downloadBackupNow(user: string | null): void {
  try {
    const snap: ExportSnapshot = {
      exportedAt: new Date().toISOString(),
      user: user ?? '',
      appVersion: '10.0',
      data: collectData(),
    }
    const json = JSON.stringify(snap, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const ts = new Date()
    const dateStr = `${ts.getFullYear()}-${String(ts.getMonth()+1).padStart(2,'0')}-${String(ts.getDate()).padStart(2,'0')}_${String(ts.getHours()).padStart(2,'0')}${String(ts.getMinutes()).padStart(2,'0')}`
    const safeUser = (user ?? 'anon').replace(/[^a-z0-9]/gi, '_')
    const filename = `tpg-finance-backup-${dateStr}-${safeUser}.json`
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    localStorage.setItem(LAST_DOWNLOAD_KEY, String(Date.now()))
    console.info(`[dataExport] backup gedownload: ${filename}`)
  } catch (e) {
    console.warn('[dataExport] download mislukt:', e)
  }
}

/** Auto-download als er sinds de laatste download minstens 24 uur voorbij is.
 *  Returnt true als er gedownload is. */
export function autoDownloadIfStale(user: string | null): boolean {
  try {
    const lastTs = Number(localStorage.getItem(LAST_DOWNLOAD_KEY) ?? 0)
    if (Date.now() - lastTs < ONE_DAY_MS) return false
    // Geen data om te exporteren? Skip.
    if (Object.keys(collectData()).length === 0) return false
    downloadBackupNow(user)
    return true
  } catch (e) {
    console.warn('[dataExport] autoDownloadIfStale failed:', e)
    return false
  }
}

/** Importeer een eerder gedownload backup-bestand terug in localStorage. */
export function importBackupFile(file: File): Promise<{ ok: boolean; keys: number; error?: string }> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const txt = String(reader.result ?? '')
        const parsed = JSON.parse(txt) as ExportSnapshot
        if (!parsed.data || typeof parsed.data !== 'object') {
          return resolve({ ok: false, keys: 0, error: 'Ongeldig backup-bestand' })
        }
        let n = 0
        for (const [k, v] of Object.entries(parsed.data)) {
          if (!k.startsWith(DATA_PREFIX)) continue
          if (k.startsWith(BACKUP_PREFIX)) continue
          if (IGNORE_KEYS.has(k)) continue
          const stringValue = typeof v === 'string' ? v : JSON.stringify(v)
          localStorage.setItem(k, stringValue)
          n++
        }
        resolve({ ok: true, keys: n })
      } catch (e) {
        resolve({ ok: false, keys: 0, error: String(e) })
      }
    }
    reader.onerror = () => resolve({ ok: false, keys: 0, error: 'Bestand kon niet gelezen worden' })
    reader.readAsText(file)
  })
}
