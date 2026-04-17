// useRawDataStore.ts
// Slaat alle ruwe rijen van geüploade bestanden op (niet gepersisteerd — per sessie).
// Hierdoor kan de AI-chat specifieke vragen beantwoorden over individuele facturen,
// klanten, aantallen, etc.
import { create } from 'zustand'

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
  addEntry: (entry: RawDataEntry) => void
  approveEntry: (recordId: string) => void
  rejectEntry: (recordId: string) => void
  removeEntry: (recordId: string) => void
  getApproved: (slotId?: string, month?: string) => RawDataEntry[]
  /** Geef alle goedgekeurde rijen terug voor een slot+maand combinatie */
  getRows: (slotId?: string, month?: string) => RawRow[]
}

export const useRawDataStore = create<RawDataStore>()((set, get) => ({
  entries: [],

  addEntry: (entry) =>
    set(s => ({
      entries: [
        ...s.entries.filter(e => e.recordId !== entry.recordId),
        entry,
      ],
    })),

  approveEntry: (recordId) =>
    set(s => ({
      entries: s.entries.map(e => e.recordId === recordId ? { ...e, status: 'approved' } : e),
    })),

  rejectEntry: (recordId) =>
    set(s => ({
      entries: s.entries.map(e => e.recordId === recordId ? { ...e, status: 'rejected' } : e),
    })),

  removeEntry: (recordId) =>
    set(s => ({ entries: s.entries.filter(e => e.recordId !== recordId) })),

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
