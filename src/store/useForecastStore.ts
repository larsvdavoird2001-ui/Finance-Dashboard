// Voorspelling huidige maand — partial-month upload-totalen + handmatige
// OHW-schatting + notes per maand. Pure prognose-input voor de forecastEngine;
// raakt expliciet GEEN OHW-rijen of import_records aan zodat een halverwege-
// de-maand-prognose nooit de echte Maandafsluiting muteert.
//
// Persistentie: Supabase (tabel `forecast_inputs`) + localStorage cache. Iedere
// upload of OHW-bijwerking pusht naar Supabase en wordt via Realtime
// rondgestuurd zodat alle ingelogde gebruikers dezelfde prognose-state delen.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ClosingBv } from '../data/types'
import {
  fetchForecastInputs,
  upsertForecastInput,
  deleteForecastInput,
  deleteForecastInputsForMonth,
} from '../lib/db'

/** Slot-namen voor uploads die in de Voorspelling-tab leven. Spiegelt
 *  (subset van) de Maandafsluiting-slots maar zonder de OHW-write-side-effects. */
export type ForecastSlotId =
  | 'factuurvolume'        // SAP factuurvolume YTD per BV
  | 'geschreven_uren'      // SAP werknemertijden YTD (decl/intern/verlof per BV)
  | 'interne_uren'         // Interne uren YTD per BV
  | 'uren_lijst'           // NTF Uren — netto nog te factureren per BV (OHW pipeline)
  | 'd_lijst'              // D-facturatie OHW (Consultancy)
  | 'conceptfacturen'      // E-Projecten OHW (Projects)
  | 'missing_hours'        // Missing hours × tarief × 0.9 (Consultancy)
  | 'ohw'                  // OHW Excel — onderhanden projecten (Projects)
  | 'ohw_estimate'         // Handmatige OHW-eindstand-schatting per BV (geen file)
  | 'notes'                // Vrije tekst per maand (geen file)

export interface ForecastInputRecord {
  /** `${month}::${slot}` (BV-agnostisch) of `${month}::${slot}::${bv}`. */
  id: string
  month: string
  slot: ForecastSlotId | string
  /** BV-scope wanneer relevant; null voor cross-BV totalen. */
  bv: ClosingBv | null
  /** Slot-specifieke payload. Conventies:
   *  - factuurvolume:    { perBv: { Consultancy, Projects, Software }, total }
   *  - geschreven_uren:  { perBv: {…}, hoursEntries: ParsedHoursEntry[] }
   *  - interne_uren:     { perBv: {…} (totaal interne uren) }
   *  - uren_lijst:       { perBv: {…} (NTF waarde per BV) }
   *  - d_lijst:          { total }
   *  - conceptfacturen:  { total }
   *  - missing_hours:    { total }
   *  - ohw:              { total }
   *  - ohw_estimate:     { value } — per (month, bv)
   *  - notes:            { text } — vrij tekstveld
   */
  payload: Record<string, unknown>
  fileName: string | null
  uploadedBy: string | null
  uploadedAt: string
}

interface ForecastStore {
  records: ForecastInputRecord[]
  loaded: boolean
  loadFromDb: () => Promise<void>

  /** Alle records voor een bepaalde maand. */
  forMonth: (month: string) => ForecastInputRecord[]
  /** Specifiek record voor (maand, slot[, bv]). */
  getRecord: (month: string, slot: string, bv?: ClosingBv | null) => ForecastInputRecord | undefined

  /** Sla een upload-resultaat of handmatige input op. ID wordt automatisch
   *  bepaald uit (month, slot[, bv]). Eerdere records met dezelfde id worden
   *  overschreven. */
  saveInput: (input: Omit<ForecastInputRecord, 'id' | 'uploadedAt'> & { uploadedAt?: string }) => void

  /** Wis een specifieke input (bv. user verwijdert een upload). */
  removeInput: (month: string, slot: string, bv?: ClosingBv | null) => void

  /** Wis alle prognose-inputs voor een maand (reset-knop). */
  clearMonth: (month: string) => void
}

function buildId(month: string, slot: string, bv?: ClosingBv | null): string {
  return bv ? `${month}::${slot}::${bv}` : `${month}::${slot}`
}

export const useForecastStore = create<ForecastStore>()(
  persist(
    (set, get) => ({
      records: [],
      loaded: false,

      loadFromDb: async () => {
        let dbRows: ForecastInputRecord[] = []
        try {
          dbRows = await fetchForecastInputs()
        } catch (e) {
          console.warn('[useForecastStore] fetch failed — keeping local state:', e)
          set({ loaded: true })
          return
        }
        const local = get().records
        const byId = new Map<string, ForecastInputRecord>()
        for (const r of local) byId.set(r.id, r)
        for (const r of dbRows) byId.set(r.id, r) // DB wint per id
        set({ records: Array.from(byId.values()), loaded: true })
        // Reconcile: lokaal-only records terugpushen.
        const dbIds = new Set(dbRows.map(r => r.id))
        for (const r of local) if (!dbIds.has(r.id)) upsertForecastInput(r)
      },

      forMonth: (month) => get().records.filter(r => r.month === month),

      getRecord: (month, slot, bv) => {
        const id = buildId(month, slot, bv ?? null)
        return get().records.find(r => r.id === id)
      },

      saveInput: (input) => {
        const id = buildId(input.month, input.slot, input.bv)
        const now = input.uploadedAt ?? new Date().toISOString()
        const fresh: ForecastInputRecord = { ...input, id, uploadedAt: now }
        set(s => {
          const existing = s.records.findIndex(r => r.id === id)
          const next = existing === -1
            ? [...s.records, fresh]
            : s.records.map((r, i) => i === existing ? fresh : r)
          return { records: next }
        })
        upsertForecastInput(fresh)
      },

      removeInput: (month, slot, bv) => {
        const id = buildId(month, slot, bv ?? null)
        set(s => ({ records: s.records.filter(r => r.id !== id) }))
        deleteForecastInput(id)
      },

      clearMonth: (month) => {
        set(s => ({ records: s.records.filter(r => r.month !== month) }))
        deleteForecastInputsForMonth(month)
      },
    }),
    {
      name: 'tpg-forecast-inputs',
      partialize: (s) => ({ records: s.records }) as unknown as ForecastStore,
    },
  ),
)
