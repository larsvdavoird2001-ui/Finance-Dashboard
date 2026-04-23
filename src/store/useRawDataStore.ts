// useRawDataStore.ts
// Slaat alle ruwe rijen van geüploade bestanden op — nu met Supabase persistentie.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  fetchRawData,
  insertRawData,
  updateRawDataStatus,
  deleteRawData,
} from '../lib/db'

export type RawRow = Record<string, unknown>

export interface RawDataEntry {
  recordId: string
  slotId: string
  slotLabel: string
  month: string
  fileName: string
  uploadedAt: string
  rows: RawRow[]
  amountCol: string
  bvCol: string
  status: 'pending' | 'approved' | 'rejected'
}

interface RawDataStore {
  entries: RawDataEntry[]
  loaded: boolean
  loadFromDb: () => Promise<void>
  addEntry: (entry: RawDataEntry) => void
  approveEntry: (recordId: string) => void
  rejectEntry: (recordId: string) => void
  removeEntry: (recordId: string) => void
  getApproved: (slotId?: string, month?: string) => RawDataEntry[]
  getRows: (slotId?: string, month?: string) => RawRow[]
}

export const useRawDataStore = create<RawDataStore>()(
  persist(
    (set, get) => ({
      entries: [],
      loaded: false,

      loadFromDb: async () => {
        try {
          const rows = await fetchRawData()
          if (rows.length > 0) {
            set({ entries: rows as RawDataEntry[], loaded: true })
          } else {
            set({ loaded: true })
          }
        } catch (err) {
          console.warn('[useRawDataStore] Supabase load failed, keeping local state:', err)
          set({ loaded: true })
        }
      },

  addEntry: (entry) => {
    set(s => ({
      entries: [
        ...s.entries.filter(e => e.recordId !== entry.recordId),
        entry,
      ],
    }))
    insertRawData(entry)
  },

  approveEntry: (recordId) => {
    set(s => ({
      entries: s.entries.map(e => e.recordId === recordId ? { ...e, status: 'approved' as const } : e),
    }))
    updateRawDataStatus(recordId, 'approved')
  },

  rejectEntry: (recordId) => {
    set(s => ({
      entries: s.entries.map(e => e.recordId === recordId ? { ...e, status: 'rejected' as const } : e),
    }))
    updateRawDataStatus(recordId, 'rejected')
  },

  removeEntry: (recordId) => {
    set(s => ({ entries: s.entries.filter(e => e.recordId !== recordId) }))
    deleteRawData(recordId)
  },

  getApproved: (slotId, month) => {
    let list = get().entries.filter(e => e.status === 'approved')
    if (slotId) list = list.filter(e => e.slotId === slotId)
    if (month)  list = list.filter(e => e.month === month)
    return list
  },

  getRows: (slotId, month) => {
    const entries = get().getApproved(slotId, month)
    return entries.flatMap(e => e.rows)
  },
    }),
    {
      name: 'tpg-raw-data',
      // Persist alleen de metadata — rows-arrays kunnen tienduizenden
      // records bevatten en overschrijden dan de ~5MB localStorage-quota.
      // De volledige rows blijven beschikbaar via Supabase (fetchRawData
      // laadt ze weer in bij loadFromDb).
      partialize: (state) => ({
        entries: state.entries.map(e => ({ ...e, rows: [] })),
      }) as unknown as RawDataStore,
    },
  ),
)
