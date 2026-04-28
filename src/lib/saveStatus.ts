import { create } from 'zustand'

/** Observable save-status voor de UI. Wordt door db.ts upsert-functies
 *  bijgewerkt en door de Topbar getoond zodat de gebruiker altijd ziet
 *  wat er met zijn data gebeurt. */

export type SyncState = 'idle' | 'syncing' | 'synced' | 'error'

interface SaveStatusState {
  /** Huidige toestand */
  state: SyncState
  /** Aantal saves nog bezig */
  pending: number
  /** Aantal saves dat sinds load succesvol is */
  successCount: number
  /** Aantal saves dat sinds load gefaald is */
  errorCount: number
  /** Laatste tijd dat alles synced was (ms) */
  lastSyncedAt: number | null
  /** Laatste foutmelding (kort) */
  lastError: string | null
  /** Welke tabellen zijn momenteel aan het schrijven */
  activeTables: Set<string>

  starting: (table: string) => void
  success: (table: string) => void
  failed: (table: string, msg: string) => void
}

export const useSaveStatus = create<SaveStatusState>((set, get) => ({
  state: 'idle',
  pending: 0,
  successCount: 0,
  errorCount: 0,
  lastSyncedAt: null,
  lastError: null,
  activeTables: new Set(),

  starting: (table) => set(s => {
    const active = new Set(s.activeTables)
    active.add(table)
    return {
      state: 'syncing',
      pending: s.pending + 1,
      activeTables: active,
    }
  }),

  success: (table) => set(s => {
    const active = new Set(s.activeTables)
    active.delete(table)
    const newPending = Math.max(0, s.pending - 1)
    const newSuccess = s.successCount + 1
    const isAllDone = newPending === 0 && get().errorCount === s.errorCount
    return {
      pending: newPending,
      successCount: newSuccess,
      activeTables: active,
      state: isAllDone ? 'synced' : (newPending > 0 ? 'syncing' : s.state),
      lastSyncedAt: isAllDone ? Date.now() : s.lastSyncedAt,
    }
  }),

  failed: (table, msg) => set(s => {
    const active = new Set(s.activeTables)
    active.delete(table)
    return {
      pending: Math.max(0, s.pending - 1),
      errorCount: s.errorCount + 1,
      activeTables: active,
      state: 'error',
      lastError: `${table}: ${msg}`,
    }
  }),
}))

/** Wrap een upsert-promise met save-status tracking. Het db.ts-laagje
 *  gebruikt deze helper zodat álle Supabase-writes automatisch zichtbaar
 *  zijn in de UI-indicator. */
export async function trackSave<T>(
  table: string,
  fn: () => Promise<T>,
): Promise<T> {
  const status = useSaveStatus.getState()
  status.starting(table)
  try {
    const result = await fn()
    useSaveStatus.getState().success(table)
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    useSaveStatus.getState().failed(table, msg)
    throw e
  }
}
