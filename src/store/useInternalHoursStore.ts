// Interne uren — gedetailleerde uitsplitsing van de niet-declarabele uren
// per BV × maand × categorie (+ per werknemer). Gevuld door de "Interne uren"
// upload in de Maandafsluiting.
//
// Persistentie: Supabase (tabel `internal_hours`) + localStorage als cache,
// zodat de uitsplitsing gedeeld is met alle gebruikers.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BvId } from '../data/types'
import type { InternalHoursEntry } from '../lib/parseInternalHours'
import { fetchInternalHours, upsertInternalHours, deleteAllInternalHours } from '../lib/db'

interface InternalHoursStore {
  entries: InternalHoursEntry[]
  loaded: boolean
  /** Laad uit Supabase + merge met lokale state (DB wint per id). */
  loadFromDb: () => Promise<void>
  /** Bulk-upsert per (bv, maand). Combi's die niet in de batch zitten blijven. */
  upsertBulk: (batch: InternalHoursEntry[]) => void
  /** Eén entry ophalen. */
  getEntry: (bv: BvId, month: string) => InternalHoursEntry | undefined
  /** Alles wissen. */
  clearAll: () => void
}

export const useInternalHoursStore = create<InternalHoursStore>()(
  persist(
    (set, get) => ({
      entries: [],
      loaded: false,

      loadFromDb: async () => {
        let dbRows: InternalHoursEntry[] = []
        try {
          dbRows = await fetchInternalHours()
        } catch (e) {
          console.warn('[useInternalHoursStore] fetch failed — keeping local state:', e)
          set({ loaded: true })
          return
        }
        const local = get().entries
        const byId = new Map(local.map(e => [e.id, e]))
        for (const r of dbRows) byId.set(r.id, r)   // Supabase wint per id
        set({ entries: Array.from(byId.values()), loaded: true })
        const dbIds = new Set(dbRows.map(r => r.id))
        const localOnly = local.filter(e => !dbIds.has(e.id))
        if (localOnly.length > 0) upsertInternalHours(localOnly)
      },

      upsertBulk: (batch) => {
        set(s => {
          const byKey = new Map(s.entries.map(e => [e.id, e]))
          for (const e of batch) byKey.set(e.id, e)
          return { entries: Array.from(byKey.values()) }
        })
        upsertInternalHours(batch)
      },

      getEntry: (bv, month) =>
        get().entries.find(e => e.bv === bv && e.month === month),

      clearAll: () => {
        set({ entries: [] })
        deleteAllInternalHours()
      },
    }),
    { name: 'tpg-internal-hours', partialize: (s) => ({ entries: s.entries }) as unknown as InternalHoursStore },
  ),
)
