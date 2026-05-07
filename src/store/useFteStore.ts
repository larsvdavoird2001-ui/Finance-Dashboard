import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { FteEntry, FteBv } from '../data/types'
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
const BASELINE: Record<'Consultancy' | 'Projects' | 'Software', { fte: number; headcount: number }> = {
  Consultancy: { fte: 91.5, headcount: 94 },
  Projects:    { fte: 20.4, headcount: 22 },
  Software:    { fte: 17.8, headcount: 19 },
}
const SEED_MONTHS = ['Jan-26', 'Feb-26', 'Mar-26']

function makeInitialEntries(): FteEntry[] {
  const entries: FteEntry[] = []
  for (const month of SEED_MONTHS) {
    for (const bv of ['Consultancy', 'Projects', 'Software'] as const) {
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

/** Normaliseer een vertical-string naar een korte slug die in de entry-id
 *  past. Lege/undefined vertical → 'tot' (BV-totaal). Bestaande pre-vertical
 *  entries (id zonder slug) blijven herkend als BV-totaal voor backwards
 *  compatibility. */
function verticalSlug(vertical: string | undefined): string {
  if (!vertical) return 'tot'
  return vertical.toLowerCase().slice(0, 4).replace(/[^a-z]/g, '')
}

/** Genereer een deterministische ID voor (bv, month, optionele vertical).
 *  - Zonder vertical (BV-totaal): legacy-format `${l}-fte-${monthcode}` →
 *    onveranderd om bestaande Supabase-rijen niet te breken.
 *  - Met vertical: `${l}-${slug}-fte-${monthcode}` (extra segment). */
function entryId(bv: FteBv, month: string, vertical?: string): string {
  const prefix = bv === 'Holdings' ? 'h' : bv[0].toLowerCase()
  const monthCode = month.replace('-', '').toLowerCase()
  if (!vertical) return `${prefix}-fte-${monthCode}`
  return `${prefix}-${verticalSlug(vertical)}-fte-${monthCode}`
}

/** Patch-type voor upsertEntry/updateEntry. Waardes kunnen undefined zijn om
 *  een veld te clearen (empty input → entry zonder dat veld). */
type FteFieldPatch = { [K in 'fte' | 'headcount' | 'fteBudget' | 'headcountBudget']?: number | undefined }

interface FteStore {
  entries: FteEntry[]
  loaded: boolean
  loadFromDb: () => Promise<void>
  /** Update of creëer een entry. Optionele `vertical` selecteert de sub-rij;
   *  zonder vertical wordt de BV-totaal-rij geraakt (legacy gedrag). */
  upsertEntry: (bv: FteBv, month: string, patch: FteFieldPatch, vertical?: string) => void
  /** Legacy — updatet via record-id (wordt nog gebruikt door inline blokken). */
  updateEntry: (id: string, patch: FteFieldPatch) => void
  /** BV-totaal entry (zonder vertical) voor (bv, month). */
  getEntry: (bv: FteBv, month: string) => FteEntry | undefined
  /** Vertical-specifieke entry voor (bv, vertical, month). */
  getVerticalEntry: (bv: FteBv, vertical: string, month: string) => FteEntry | undefined
  /** Alle vertical-entries voor (bv, month) — exclusief de totaal-rij. */
  getVerticalEntries: (bv: FteBv, month: string) => FteEntry[]
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

      upsertEntry: (bv, month, patch, vertical) => {
        const id = entryId(bv, month, vertical)
        const existing = get().entries.find(e => e.id === id)
        const next: FteEntry = existing
          ? { ...existing, ...patch }
          : { id, bv, month, fte: 0, headcount: 0, ...(vertical ? { vertical } : {}), ...patch }
        // Defensief: zorg dat de bv/maand/vertical altijd in zicht blijven
        // ook als patch alleen "leegte" stuurt (clearen van laatste veld).
        if (!next.bv) next.bv = bv
        if (!next.month) next.month = month
        if (vertical && !next.vertical) next.vertical = vertical
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

      getEntry: (bv, month) =>
        get().entries.find(e => e.bv === bv && e.month === month && !e.vertical),

      getVerticalEntry: (bv, vertical, month) =>
        get().entries.find(e => e.bv === bv && e.month === month && e.vertical === vertical),

      getVerticalEntries: (bv, month) =>
        get().entries.filter(e => e.bv === bv && e.month === month && !!e.vertical),
    }),
    {
      name: 'tpg-fte-entries',
      partialize: (state) => ({ entries: state.entries }) as unknown as FteStore,
    },
  ),
)

export const FTE_MONTHS = SEED_MONTHS
