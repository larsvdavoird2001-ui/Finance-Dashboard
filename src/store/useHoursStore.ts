// Geuploade geschreven-uren (SAP Analytics) per BV × maand.
// Gevuld door de geschreven_uren import in de Maandafsluiting.
// Wordt gelezen door Uren Dashboard en de Budgetten LE-forecast om de
// impact van vakantie/ziekte op toekomstige declarable uren mee te nemen.
//
// Persistentie: Supabase (tabel `hours_entries`) + localStorage als cache,
// zodat de uren-data — en daarmee declarabiliteit/ziekte in het rapport —
// gedeeld is met alle gebruikers.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BvId } from '../data/types'
import { fetchHoursEntries, upsertHoursEntries, deleteAllHoursEntries } from '../lib/db'

export interface HoursEntry {
  id: string          // `${bv}-${month}` (bv. 'Consultancy-Jan-26')
  bv: BvId
  month: string       // 'Jan-26'
  /** Werkuren met projecttype dat NIET 'Intern TPG' én NIET 'Niet toegewezen' is.
   *  Dit is de declarabele productiviteit. */
  declarable: number
  /** Werkuren met projecttype 'Intern TPG' — interne, niet-declarabele uren. */
  internal: number
  /** Niet toegewezen / afwezigheid — 'Vakantie' */
  vakantie: number
  /** Niet toegewezen / afwezigheid — 'Ziekte' */
  ziekte: number
  /** Alle overige verlof-types uit 'Niet toegewezen' (bijzonder verlof,
   *  ouderschapsverlof, zwangerschapsverlof, zorgverlof, onbetaald verlof,
   *  bezoek huisarts/specialist/tandarts, kortdurend zorgverlof, etc.). */
  overigVerlof: number
}

interface HoursStore {
  entries: HoursEntry[]
  loaded: boolean
  /** Laad uit Supabase + merge met lokale state (DB wint per id; lokaal-only
   *  rijen blijven staan en worden teruggepusht). */
  loadFromDb: () => Promise<void>
  /** Bulk-upsert: vervang entries per (bv, month) wanneer de geuploade set
   *  diezelfde combi bevat. Voor nieuwe combi's toevoegen. Voor combi's
   *  die NIET in de upload zitten: ongemoeid laten. */
  upsertBulk: (batch: HoursEntry[]) => void
  /** Alle entries voor een specifieke BV/maand. */
  getEntry: (bv: BvId, month: string) => HoursEntry | undefined
  /** Ruw alles wissen. */
  clearAll: () => void
}

export const useHoursStore = create<HoursStore>()(
  persist(
    (set, get) => ({
      entries: [],
      loaded: false,

      loadFromDb: async () => {
        let dbRows: HoursEntry[] = []
        try {
          dbRows = await fetchHoursEntries()
        } catch (e) {
          console.warn('[useHoursStore] fetch failed — keeping local state:', e)
          set({ loaded: true })
          return
        }
        const local = get().entries
        const byId = new Map(local.map(e => [e.id, e]))
        for (const r of dbRows) byId.set(r.id, r)   // Supabase wint per id
        set({ entries: Array.from(byId.values()), loaded: true })
        // Reconcile: lokaal-only entries terugpushen naar Supabase.
        const dbIds = new Set(dbRows.map(r => r.id))
        const localOnly = local.filter(e => !dbIds.has(e.id))
        if (localOnly.length > 0) upsertHoursEntries(localOnly)
      },

      upsertBulk: (batch) => {
        set(s => {
          const byKey = new Map(s.entries.map(e => [e.id, e]))
          for (const e of batch) byKey.set(e.id, e)
          return { entries: Array.from(byKey.values()) }
        })
        upsertHoursEntries(batch)
      },

      getEntry: (bv, month) =>
        get().entries.find(e => e.bv === bv && e.month === month),

      clearAll: () => {
        set({ entries: [] })
        deleteAllHoursEntries()
      },
    }),
    { name: 'tpg-hours-entries', partialize: (s) => ({ entries: s.entries }) as unknown as HoursStore },
  ),
)

/** Bereken declarability % uit een HoursEntry. Capacity = werkuren totaal
 *  (declarable + internal). Verlof telt niet mee in de noemer. */
export function declarabilityPct(e: HoursEntry): number {
  const work = e.declarable + e.internal
  if (work <= 0) return 0
  return (e.declarable / work) * 100
}

/** Alle Niet-toegewezen afwezigheid samen. */
export function totalLeave(e: HoursEntry): number {
  return e.vakantie + e.ziekte + e.overigVerlof
}
