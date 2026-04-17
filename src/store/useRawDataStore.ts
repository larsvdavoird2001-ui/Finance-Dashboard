// useRawDataStore.ts
// Slaat alle ruwe rijen van geüploade bestanden op — nu met Supabase persistentie.
import { create } from 'zustand'
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

export const useRawDataStore = create<RawDataStore>()((set, get) => ({
  entries: [],
  loaded: false,

  loadFromDb: async () => {
    const rows = await fetchRawData()
    set({ entries: rows as RawDataEntry[], loaded: true })
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
}))
