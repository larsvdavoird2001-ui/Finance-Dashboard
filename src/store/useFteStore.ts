import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { FteEntry, BvId } from '../data/types'
import { fetchFteEntries, upsertFteEntry, upsertAllFteEntries } from '../lib/db'

// Alle maand-codes per jaar. Gebruikt door de FTE-pagina om een compleet
// per-maand overzicht te kunnen tonen, ook al is er nog geen data voor een
// maand ingevoerd.
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const FTE_YEARS: Array<'2025' | '2026'> = ['2025', '2026']
export function monthsForYear(year: '2025' | '2026'): string[] {
  const suffix = year === '2025' ? '25' : '26'
  return MONTH_NAMES.map(m => `${m}-${suffix}`)
}

// Baseline voor de drie actuals-maanden waar we al historische data voor
// hadden. De overige (bud/actuals) velden blijven leeg tot de user ze zelf
// invult.
const BASELINE: Record<BvId, { fte: number; headcount: number }> = {
  Consultancy: { fte: 91.5, headcount: 94 },
  Projects:    { fte: 20.4, headcount: 22 },
  Software:    { fte: 17.8, headcount: 19 },
}
const SEED_MONTHS = ['Jan-26', 'Feb-26', 'Mar-26']

function makeInitialEntries(): FteEntry[] {
  const entries: FteEntry[] = []
  for (const month of SEED_MONTHS) {
    for (const bv of ['Consultancy', 'Projects', 'Software'] as BvId[]) {
      const base = BASELINE[bv]
      entries.push({
        id:        `${bv[0].toLowerCase()}-fte-${month.replace('-', '').toLowerCase()}`,
        bv,
        month,
        fte:       base.fte,
        headcount: base.headcount,
      })
    }
  }
  return entries
}

function entryId(bv: BvId, month: string): string {
  return `${bv[0].toLowerCase()}-fte-${month.replace('-', '').toLowerCase()}`
}

/** Patch-type voor upsertEntry/updateEntry. Waardes kunnen undefined zijn om
 *  een veld te clearen (empty input → entry zonder dat veld). */
type FteFieldPatch = { [K in 'fte' | 'headcount' | 'fteBudget' | 'headcountBudget']?: number | undefined }

interface FteStore {
  entries: FteEntry[]
  loaded: boolean
  loadFromDb: () => Promise<void>
  /** Update een bestaand entry OF creëer 'm als hij nog niet bestaat. */
  upsertEntry: (bv: BvId, month: string, patch: FteFieldPatch) => void
  /** Legacy — updatet via record-id (wordt nu nog gebruikt door inline blok) */
  updateEntry: (id: string, patch: FteFieldPatch) => void
  getEntry:    (bv: BvId, month: string) => FteEntry | undefined
}

export const useFteStore = create<FteStore>()(
  persist(
    (set, get) => ({
      entries: makeInitialEntries(),
      loaded: false,

      loadFromDb: async () => {
        try {
          const rows = await fetchFteEntries()
          if (rows.length > 0) {
            set({ entries: rows, loaded: true })
          } else {
            const current = get().entries
            const initial = makeInitialEntries()
            const isPristine = current.length === initial.length &&
              current.every((e, i) => e.fte === initial[i].fte && e.headcount === initial[i].headcount)
            if (isPristine) await upsertAllFteEntries(initial)
            set({ loaded: true })
          }
        } catch (err) {
          console.warn('[useFteStore] Supabase load failed, keeping local state:', err)
          set({ loaded: true })
        }
      },

      upsertEntry: (bv, month, patch) => {
        const id = entryId(bv, month)
        const existing = get().entries.find(e => e.id === id)
        const next: FteEntry = existing
          ? { ...existing, ...patch }
          : { id, bv, month, fte: 0, headcount: 0, ...patch }
        set(s => {
          const has = s.entries.some(e => e.id === id)
          return {
            entries: has
              ? s.entries.map(e => e.id === id ? next : e)
              : [...s.entries, next],
          }
        })
        upsertFteEntry(next)
      },

      updateEntry: (id, patch) => {
        set(s => ({ entries: s.entries.map(e => e.id === id ? { ...e, ...patch } : e) }))
        const entry = get().entries.find(e => e.id === id)
        if (entry) upsertFteEntry(entry)
      },

      getEntry: (bv, month) => get().entries.find(e => e.bv === bv && e.month === month),
    }),
    {
      name: 'tpg-fte-entries',
      partialize: (state) => ({ entries: state.entries }) as unknown as FteStore,
    },
  ),
)

export const FTE_MONTHS = SEED_MONTHS
