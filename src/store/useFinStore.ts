import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ClosingEntry, BvId } from '../data/types'
import { fetchClosingEntries, upsertClosingEntry, upsertAllClosingEntries } from '../lib/db'

// Initial closing data sourced from P02.2026 Maandrapportage actuals
const INITIAL_ENTRIES: ClosingEntry[] = [
  // ── January 2026 ─────────────────────────────────────────────────────────
  {
    id: 'c-jan26', bv: 'Consultancy', month: 'Jan-26',
    factuurvolume: 719770, debiteuren: 0, ohwMutatie: 217688,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {}, remark: '',
  },
  {
    id: 'p-jan26', bv: 'Projects', month: 'Jan-26',
    factuurvolume: 364790, debiteuren: 0, ohwMutatie: 180298,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {}, remark: '',
  },
  {
    id: 's-jan26', bv: 'Software', month: 'Jan-26',
    factuurvolume: 493761, debiteuren: 0, ohwMutatie: -35002,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {}, remark: '',
  },
  // ── February 2026 ────────────────────────────────────────────────────────
  {
    id: 'c-feb26', bv: 'Consultancy', month: 'Feb-26',
    factuurvolume: 797454, debiteuren: 0, ohwMutatie: 205300,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {}, remark: '',
  },
  {
    id: 'p-feb26', bv: 'Projects', month: 'Feb-26',
    factuurvolume: 418811, debiteuren: 0, ohwMutatie: 107890,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {}, remark: '',
  },
  {
    id: 's-feb26', bv: 'Software', month: 'Feb-26',
    factuurvolume: 261030, debiteuren: 0, ohwMutatie: -7000,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {}, remark: '',
  },
  // ── March 2026 (open / empty template) ───────────────────────────────────
  {
    id: 'c-mar26', bv: 'Consultancy', month: 'Mar-26',
    factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {}, remark: '',
  },
  {
    id: 'p-mar26', bv: 'Projects', month: 'Mar-26',
    factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {}, remark: '',
  },
  {
    id: 's-mar26', bv: 'Software', month: 'Mar-26',
    factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {}, remark: '',
  },
]

interface FinStore {
  entries: ClosingEntry[]
  loaded: boolean
  loadFromDb: () => Promise<void>
  updateEntry: (id: string, patch: Partial<Omit<ClosingEntry, 'id'>>) => void
  getEntry: (bv: BvId, month: string) => ClosingEntry | undefined
  getMonthEntries: (month: string) => ClosingEntry[]
}

export const useFinStore = create<FinStore>()(
  persist(
    (set, get) => ({
      entries: INITIAL_ENTRIES,
      loaded: false,

      loadFromDb: async () => {
        // Non-destructieve laad: overschrijf lokale staat ALLEEN als Supabase
        // daadwerkelijk data teruggeeft. Bij fout of leeg antwoord blijft de
        // localStorage-gehydreerde staat behouden — voorkomt data-verlies
        // wanneer Supabase tijdelijk onbereikbaar is of RLS strict is.
        try {
          const rows = await fetchClosingEntries()
          if (rows.length > 0) {
            set({ entries: rows, loaded: true })
          } else {
            // Alleen seeden als er lokaal ook niks aangepast is (initial set)
            const current = get().entries
            const looksLikeDefaults = current.length === INITIAL_ENTRIES.length &&
              current.every(e => e.remark === '' && e.debiteuren === 0)
            if (looksLikeDefaults) {
              await upsertAllClosingEntries(INITIAL_ENTRIES)
            }
            set({ loaded: true })
          }
        } catch (err) {
          console.warn('[useFinStore] Supabase load failed, keeping local state:', err)
          set({ loaded: true })
        }
      },

      updateEntry: (id, patch) => {
        set(s => ({
          entries: s.entries.map(e => e.id === id ? { ...e, ...patch } : e),
        }))
        const entry = get().entries.find(e => e.id === id)
        if (entry) upsertClosingEntry(entry)
      },

      getEntry: (bv, month) =>
        get().entries.find(e => e.bv === bv && e.month === month),

      getMonthEntries: (month) =>
        get().entries.filter(e => e.month === month),
    }),
    {
      name: 'tpg-closing-entries',
      // Alleen entries persisten; `loaded` blijft lokaal bij elke reload false
      partialize: (state) => ({ entries: state.entries }) as unknown as FinStore,
    },
  ),
)

export const CLOSING_MONTHS = ['Jan-26', 'Feb-26', 'Mar-26']
