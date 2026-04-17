import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ImportRecord } from '../data/types'
import * as XLSX from 'xlsx'

interface ImportStore {
  records: ImportRecord[]
  addRecord: (record: ImportRecord) => void
  approveRecord: (id: string) => void
  rejectRecord: (id: string, reason?: string) => void
  removeRecord: (id: string) => void
  getByMonth: (month: string) => ImportRecord[]
  getApprovedByMonth: (month: string) => ImportRecord[]
  exportPeriod: (months: string[]) => void
}

export const useImportStore = create<ImportStore>()(
  persist(
    (set, get) => ({
      records: [],

      addRecord: (record) =>
        set(s => ({ records: [...s.records, record] })),

      approveRecord: (id) =>
        set(s => ({
          records: s.records.map(r => r.id === id ? { ...r, status: 'approved' } : r),
        })),

      rejectRecord: (id, reason) =>
        set(s => ({
          records: s.records.map(r => r.id === id ? { ...r, status: 'rejected', rejectionReason: reason } : r),
        })),

      removeRecord: (id) =>
        set(s => ({ records: s.records.filter(r => r.id !== id) })),

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
    }),
    {
      name: 'tpg-import-store',
      version: 1,
    }
  )
)
