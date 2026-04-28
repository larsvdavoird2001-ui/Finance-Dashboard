/** localStorage backup-mechanisme voor TPG Finance.
 *
 *  Eens per app-start nemen we een snapshot van alle tpg-* keys en
 *  bewaren die in een tpg-backup-<timestamp> namespace. We bewaren de
 *  laatste 5 snapshots. Zo kunnen we — als data ooit weer 'verdwijnt' —
 *  altijd terug naar een eerdere staat zonder een Supabase-backup of
 *  externe opslag nodig te hebben.
 */

const BACKUP_PREFIX = 'tpg-backup-'
const DATA_PREFIX   = 'tpg-'
const KEEP_BACKUPS  = 5
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

function pruneOldBackups(): void {
  const all = listBackups()
  const toDelete = all.slice(KEEP_BACKUPS)
  toDelete.forEach(b => localStorage.removeItem(b.key))
}
