import { create } from 'zustand'
import type { FteEntry, BvId } from '../data/types'
import { fetchFteEntries, upsertFteEntry, upsertAllFteEntries } from '../lib/db'

const MONTHS = ['Jan-26', 'Feb-26', 'Mar-26']

const BASELINE: Record<BvId, { fte: number; headcount: number }> = {
  Consultancy: { fte: 91.5, headcount: 94 },
  Projects:    { fte: 20.4, headcount: 22 },
  Software:    { fte: 17.8, headcount: 19 },
}

function makeEntries(): FteEntry[] {
  const entries: FteEntry[] = []
  for (const month of MONTHS) {
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

interface FteStore {
  entries: FteEntry[]
  loaded: boolean
  loadFromDb: () => Promise<void>
  updateEntry: (id: string, patch: Partial<Pick<FteEntry, 'fte' | 'headcount'>>) => void
  getEntry:    (bv: BvId, month: string) => FteEntry | undefined
}

export const useFteStore = create<FteStore>((set, get) => ({
  entries: makeEntries(),
  loaded: false,

  loadFromDb: async () => {
    const rows = await fetchFteEntries()
    if (rows.length > 0) {
      set({ entries: rows, loaded: true })
    } else {
      const initial = makeEntries()
      await upsertAllFteEntries(initial)
      set({ loaded: true })
    }
  },

  updateEntry: (id, patch) => {
    set(s => ({ entries: s.entries.map(e => e.id === id ? { ...e, ...patch } : e) }))
    const entry = get().entries.find(e => e.id === id)
    if (entry) upsertFteEntry(entry)
  },

  getEntry: (bv, month) => get().entries.find(e => e.bv === bv && e.month === month),
}))

export const FTE_MONTHS = MONTHS
