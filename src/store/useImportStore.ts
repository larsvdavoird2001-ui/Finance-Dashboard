import { create } from 'zustand'
import type { ImportRecord } from '../data/types'
import * as XLSX from 'xlsx'
import {
  fetchImportRecords,
  insertImportRecord,
  updateImportRecordStatus,
  deleteImportRecord,
} from '../lib/db'

interface ImportStore {
  records: ImportRecord[]
  loaded: boolean
  loadFromDb: () => Promise<void>
  addRecord: (record: ImportRecord) => void
  approveRecord: (id: string) => void
  rejectRecord: (id: string, reason?: string) => void
  removeRecord: (id: string) => void
  getByMonth: (month: string) => ImportRecord[]
  getApprovedByMonth: (month: string) => ImportRecord[]
  exportPeriod: (months: string[]) => void
}

export const useImportStore = create<ImportStore>()((set, get) => ({
  records: [],
  loaded: false,

  loadFromDb: async () => {
    const rows = await fetchImportRecords()
    set({ records: rows, loaded: true })
  },

  addRecord: (record) => {
    set(s => ({ records: [...s.records, record] }))
    insertImportRecord(record)
  },

  approveRecord: (id) => {
    set(s => ({
      records: s.records.map(r => r.id === id ? { ...r, status: 'approved' } : r),
    }))
    updateImportRecordStatus(id, 'approved')
  },

  rejectRecord: (id, reason) => {
    set(s => ({
      records: s.records.map(r => r.id === id ? { ...r, status: 'rejected', rejectionReason: reason } : r),
    }))
    updateImportRecordStatus(id, 'rejected', reason)
  },

  removeRecord: (id) => {
    set(s => ({ records: s.records.filter(r => r.id !== id) }))
    deleteImportRecord(id)
  },

  getByMonth: (month) =>
    get().records.filter(r => r.month === month),

  getApprovedByMonth: (month) =>
    get().records.filter(r => r.month === month && r.status === 'approved'),

  exportPeriod: (months) => {
    const records = get().records.filter(r => months.includes(r.month) && r.status === 'approved')
    if (records.length === 0) return

    const rows = records.map(r => ({
      'Maand':         r.month,
      'Type':          r.slotLabel,
      'Bestand':       r.fileName,
      'Geüpload op':   r.uploadedAt,
      'Status':        r.status,
      'Consultancy':   r.perBv['Consultancy'] ?? 0,
      'Projects':      r.perBv['Projects'] ?? 0,
      'Software':      r.perBv['Software'] ?? 0,
      'Totaal':        r.totalAmount,
      'Rijen':         r.rowCount,
      'BV kolom':      r.detectedBvCol,
      'Bedrag kolom':  r.detectedAmountCol,
    }))

    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Import log')
    XLSX.writeFile(wb, `TPG_import_log_${months.join('-')}.xlsx`)
  },
}))
