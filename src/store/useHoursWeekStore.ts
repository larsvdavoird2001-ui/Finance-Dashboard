// Geuploade SAP-timesheet uren per BV × ISO-week. Komt uit het NIEUWE
// per-week SAP-format (Kalenderjaar/-week kolom + Missing Hours kolom).
// Wordt gevuld door de geschreven_uren import zodra dat format wordt
// gedetecteerd; de bestaande maand-store (useHoursStore) wordt parallel
// gevoed met de naar maand geaggregeerde versie.
//
// Wordt gebruikt door:
//  - Uren Dashboard week-tab voor exacte per-week getallen + missing-hours
//  - LE-engine voor fijnere planning-aware forecast (toekomstige weken
//    bevatten alleen reeds geregistreerd verlof/ziekte → forecast adjust)
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BvId } from '../data/types'
import { fetchHoursWeekEntries, upsertHoursWeekEntries, deleteAllHoursWeekEntries } from '../lib/db'

export interface HoursWeekEntry {
  /** `${bv}-${year}-W${week}` (week zero-padded) */
  id: string
  bv: BvId
  year: number
  /** ISO 8601 weeknummer 1..53 */
  week: number
  /** Maand-code waar de DONDERDAG van deze week in valt (Jan-26, …). */
  month: string
  /** Begin (maandag) en einde (zondag) van de ISO-week, YYYY-MM-DD. */
  weekStart: string
  weekEnd: string
  declarable: number
  internal: number
  vakantie: number
  ziekte: number
  overigVerlof: number
  /** Totale geplande werktijd voor deze BV in deze week (uit de Geplande
   *  werktijd-rij, kolom Missing Hours). */
  plannedWork: number
  /** Open missing-hours: planned − geregistreerd. 0 als de week volledig
   *  is geboekt. Wordt door de UI getoond als "nog te boeken" per week. */
  missingHoursOpen: number
}

interface HoursWeekStore {
  entries: HoursWeekEntry[]
  loaded: boolean
  /** Laad uit Supabase + merge met lokale state (DB wint per id). */
  loadFromDb: () => Promise<void>
  /** Bulk-upsert per id. Voor (bv, year, week)-combinaties die NIET in de
   *  upload zitten: ongemoeid laten. Voor wel aanwezige: vervangen. */
  upsertBulk: (batch: HoursWeekEntry[]) => void
  /** Lookup voor één (bv, year, week). */
  getEntry: (bv: BvId, year: number, week: number) => HoursWeekEntry | undefined
  /** Alle entries voor één BV in een jaar. */
  forBvYear: (bv: BvId, year: number) => HoursWeekEntry[]
  /** Alles wissen — gebruikt door admin clear-flow. */
  clearAll: () => void
}

const idOf = (bv: BvId, y: number, w: number): string =>
  `${bv}-${y}-W${String(w).padStart(2, '0')}`

export const useHoursWeekStore = create<HoursWeekStore>()(
  persist(
    (set, get) => ({
      entries: [],
      loaded: false,

      loadFromDb: async () => {
        let dbRows: HoursWeekEntry[] = []
        try {
          dbRows = await fetchHoursWeekEntries()
        } catch (e) {
          console.warn('[useHoursWeekStore] fetch failed — keeping local state:', e)
          set({ loaded: true })
          return
        }
        const local = get().entries
        const byId = new Map(local.map(e => [e.id, e]))
        for (const r of dbRows) byId.set(r.id, r)
        set({ entries: Array.from(byId.values()), loaded: true })
        const dbIds = new Set(dbRows.map(r => r.id))
        const localOnly = local.filter(e => !dbIds.has(e.id))
        if (localOnly.length > 0) upsertHoursWeekEntries(localOnly)
      },

      upsertBulk: (batch) => {
        set(s => {
          const byKey = new Map(s.entries.map(e => [e.id, e]))
          for (const e of batch) byKey.set(e.id, e)
          return { entries: Array.from(byKey.values()) }
        })
        upsertHoursWeekEntries(batch)
      },

      getEntry: (bv, year, week) =>
        get().entries.find(e => e.id === idOf(bv, year, week)),

      forBvYear: (bv, year) =>
        get().entries.filter(e => e.bv === bv && e.year === year)
          .sort((a, b) => a.week - b.week),

      clearAll: () => {
        set({ entries: [] })
        deleteAllHoursWeekEntries()
      },
    }),
    {
      name: 'tpg-hours-week-entries',
      partialize: (s) => ({ entries: s.entries }) as unknown as HoursWeekStore,
    },
  ),
)

/** Bepaalt of een ISO-week (in UTC) volledig in het verleden ligt t.o.v.
 *  een gegeven referentiedatum. Gebruik bij upload-cutoff: weken waarvan
 *  de zondag vóór of op `asOf` valt → volledig "actual"; daarna → toekomst
 *  (alleen pre-registered uren zoals geplande vakantie). */
export function isWeekFullyPast(weekEnd: string, asOf: Date = new Date()): boolean {
  const end = new Date(weekEnd + 'T23:59:59Z')
  return end <= asOf
}
