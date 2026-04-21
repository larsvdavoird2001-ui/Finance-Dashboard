import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  fetchEvidence,
  insertEvidence,
  deleteEvidence,
  type EvidenceEntry,
} from '../lib/db'

export type { EvidenceEntry }

interface EvidenceStore {
  entries: EvidenceEntry[]
  loaded: boolean
  loadFromDb: () => Promise<void>
  addEntry: (entry: EvidenceEntry) => void
  removeEntry: (id: string) => void
  getByOhwRow: (entity: string, rowId: string, month?: string) => EvidenceEntry[]
  getByMonth: (month: string) => EvidenceEntry[]
  countByOhwRow: (entity: string, rowId: string) => number
}

export const useEvidenceStore = create<EvidenceStore>()(
  persist(
    (set, get) => ({
      entries: [],
      loaded: false,

      loadFromDb: async () => {
        try {
          const rows = await fetchEvidence()
          if (rows.length > 0) {
            set({ entries: rows, loaded: true })
          } else {
            set({ loaded: true })
          }
        } catch (err) {
          console.warn('[useEvidenceStore] Supabase load failed, keeping local state:', err)
          set({ loaded: true })
        }
      },

  addEntry: (entry) => {
    set(s => ({ entries: [entry, ...s.entries.filter(e => e.id !== entry.id)] }))
    insertEvidence(entry)
  },

  removeEntry: (id) => {
    set(s => ({ entries: s.entries.filter(e => e.id !== id) }))
    deleteEvidence(id)
  },

  getByOhwRow: (entity, rowId, month) => {
    return get().entries.filter(e =>
      e.entity === entity && e.ohwRowId === rowId && (!month || e.month === month),
    )
  },

  getByMonth: (month) => get().entries.filter(e => e.month === month),

  countByOhwRow: (entity, rowId) =>
    get().entries.filter(e => e.entity === entity && e.ohwRowId === rowId).length,
    }),
    {
      name: 'tpg-evidence',
      partialize: (state) => ({ entries: state.entries }) as unknown as EvidenceStore,
    },
  ),
)

/** Convert File → base64 string (prefix "data:mime/type;base64," stripped) */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1] ?? result
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** Trigger browser download of a base64-encoded file */
export function downloadEvidence(entry: EvidenceEntry): void {
  const byteChars = atob(entry.fileData)
  const byteNumbers = new Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i)
  const byteArray = new Uint8Array(byteNumbers)
  const blob = new Blob([byteArray], { type: entry.mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = entry.fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** Icon / emoji per mime type */
export function fileIcon(mimeType: string, fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (mimeType.startsWith('image/')) return '🖼'
  if (ext === 'pdf' || mimeType === 'application/pdf') return '📕'
  if (['xlsx', 'xls', 'csv'].includes(ext)) return '📊'
  if (['docx', 'doc'].includes(ext)) return '📝'
  if (['eml', 'msg'].includes(ext)) return '📧'
  if (['zip', '7z', 'rar'].includes(ext)) return '🗜'
  if (['txt', 'md'].includes(ext)) return '📄'
  return '📎'
}
