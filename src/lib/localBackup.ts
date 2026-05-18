/** localStorage backup-mechanisme voor TPG Finance.
 *
 *  Twee soorten automatische snapshots:
 *    1. start-van-de-dag — bij de eerste app-load van een kalenderdag
 *       maken we 1 snapshot zodat er altijd minstens 1 "verse" backup
 *       per dag is, ook als de gebruiker niets bewerkt.
 *    2. na-elke-wijziging — zodra een Supabase-save afgerond is wordt
 *       een (debounced) snapshot weggeschreven, zodat een rollback
 *       van per ongeluk verwijderde / overschreven data altijd binnen
 *       handbereik is.
 *  We bewaren de laatste KEEP_BACKUPS (20) snapshots — genoeg voor een
 *  paar dagen actieve bewerkingen plus een handvol fallback-dagen.
 */

const BACKUP_PREFIX = 'tpg-backup-'
const DATA_PREFIX   = 'tpg-'
const KEEP_BACKUPS  = 20
// Niet meeloggen in de backup
const IGNORE_KEYS   = new Set(['tpg-last-user'])

interface Snapshot {
  ts: number
  user: string
  keys: Record<string, string>
}

/** Maak een snapshot van de huidige tpg-* keys onder een nieuwe backup-key.
 *  Roept dit op app-start of voordat je iets potentieel destructiefs doet. */
export function snapshotLocalStorage(user: string | null): void {
  try {
    const snap: Snapshot = { ts: Date.now(), user: user ?? '', keys: {} }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      if (!k.startsWith(DATA_PREFIX)) continue
      if (k.startsWith(BACKUP_PREFIX)) continue
      if (IGNORE_KEYS.has(k)) continue
      const v = localStorage.getItem(k)
      if (v != null) snap.keys[k] = v
    }
    if (Object.keys(snap.keys).length === 0) return
    const newKey = `${BACKUP_PREFIX}${snap.ts}`
    localStorage.setItem(newKey, JSON.stringify(snap))
    pruneOldBackups()
    console.info(`[localBackup] snapshot ${newKey} (${Object.keys(snap.keys).length} keys)`)
  } catch (e) {
    console.warn('[localBackup] snapshot failed:', e)
  }
}

/** Maak maximaal één snapshot per kalenderdag. Gebruikt voor de "start van
 *  de dag"-backup zodat we elke dag een vers ankerpunt hebben, ongeacht
 *  hoeveel keer de app gestart wordt. */
export function dailySnapshotIfNeeded(user: string | null): boolean {
  try {
    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    const all = listBackups()
    const alreadyToday = all.some(b => new Date(b.ts).toISOString().slice(0, 10) === today)
    if (alreadyToday) return false
    snapshotLocalStorage(user)
    return true
  } catch (e) {
    console.warn('[localBackup] dailySnapshotIfNeeded failed:', e)
    return false
  }
}

/** Lijst van alle bestaande backups, nieuwste eerst. */
export function listBackups(): Array<{ key: string; ts: number; user: string; keyCount: number }> {
  const out: Array<{ key: string; ts: number; user: string; keyCount: number }> = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k || !k.startsWith(BACKUP_PREFIX)) continue
    try {
      const raw = localStorage.getItem(k)
      if (!raw) continue
      const snap = JSON.parse(raw) as Snapshot
      out.push({ key: k, ts: snap.ts, user: snap.user, keyCount: Object.keys(snap.keys).length })
    } catch { /* skip */ }
  }
  return out.sort((a, b) => b.ts - a.ts)
}

/** Restore een backup terug in localStorage en herlaad de app. */
export function restoreBackup(backupKey: string): { ok: boolean; error?: string } {
  try {
    const raw = localStorage.getItem(backupKey)
    if (!raw) return { ok: false, error: 'Backup niet gevonden' }
    const snap = JSON.parse(raw) as Snapshot
    // Eerst: snapshot van de HUIDIGE staat zodat we kunnen terug-restoren
    snapshotLocalStorage('pre-restore')
    // Dan: huidige tpg-* keys wissen (behalve backups en last-user) en
    // de snapshot terugzetten.
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      if (!k.startsWith(DATA_PREFIX)) continue
      if (k.startsWith(BACKUP_PREFIX)) continue
      if (IGNORE_KEYS.has(k)) continue
      toRemove.push(k)
    }
    toRemove.forEach(k => localStorage.removeItem(k))
    for (const [k, v] of Object.entries(snap.keys)) {
      localStorage.setItem(k, v)
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/** Verwijder een backup. */
export function deleteBackup(backupKey: string): void {
  try { localStorage.removeItem(backupKey) } catch { /* ignore */ }
}

/** Selectief restore: zoek de nieuwste backup waarin alle gevraagde keys
 *  voorkomen en zet die specifieke keys terug in localStorage. Voor het geval
 *  je alleen 'tpg-import-records' + 'tpg-raw-data' wil herstellen zonder de
 *  rest van je app-state te raken. Maakt eerst een pre-restore snapshot. */
export function restoreKeysFromBackups(
  keys: string[],
): { ok: boolean; restored: string[]; fromBackup?: string } {
  try {
    const all = listBackups()
    if (all.length === 0) return { ok: false, restored: [] }
    snapshotLocalStorage('pre-restore-keys')
    for (const b of all) {
      try {
        const raw = localStorage.getItem(b.key)
        if (!raw) continue
        const snap = JSON.parse(raw) as Snapshot
        const present = keys.filter(k => snap.keys[k] != null && snap.keys[k] !== '')
        if (present.length === 0) continue
        for (const k of present) localStorage.setItem(k, snap.keys[k])
        return { ok: true, restored: present, fromBackup: b.key }
      } catch { /* probeer volgende backup */ }
    }
    return { ok: false, restored: [] }
  } catch (e) {
    console.warn('[localBackup] restoreKeysFromBackups failed:', e)
    return { ok: false, restored: [] }
  }
}

function pruneOldBackups(): void {
  const all = listBackups()
  const toDelete = all.slice(KEEP_BACKUPS)
  toDelete.forEach(b => localStorage.removeItem(b.key))
}
