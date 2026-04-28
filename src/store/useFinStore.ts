import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ClosingEntry, ClosingBv } from '../data/types'
import { fetchClosingEntries, upsertClosingEntry, upsertAllClosingEntries } from '../lib/db'

// Financieel resultaat & vennootschapsbelasting per BV/maand — bekende
// actuals-waardes uit de P&L (plData 2026). Jan/Feb worden voor-ingevuld
// zodat de user ze alleen hoeft te bevestigen / aanpassen; Mar start op 0.
const FIN_RES_JAN: Record<ClosingBv, number> = { Consultancy: -512,  Projects: -242,  Software: -102,   Holdings: -37559 }
const FIN_RES_FEB: Record<ClosingBv, number> = { Consultancy: -382,  Projects: -196,  Software: -7431,  Holdings: -37135 }
const VPB_JAN:     Record<ClosingBv, number> = { Consultancy: 0,     Projects: 0,     Software: 0,      Holdings: 0      }
const VPB_FEB:     Record<ClosingBv, number> = { Consultancy: 0,     Projects: 0,     Software: 0,      Holdings: 0      }

// Initial closing data sourced from P02.2026 Maandrapportage actuals
const INITIAL_ENTRIES: ClosingEntry[] = [
  // ── January 2026 ─────────────────────────────────────────────────────────
  {
    id: 'c-jan26', bv: 'Consultancy', month: 'Jan-26',
    factuurvolume: 719770, debiteuren: 0, ohwMutatie: 217688,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_JAN.Consultancy, vennootschapsbelasting: VPB_JAN.Consultancy,
    remark: '',
  },
  {
    id: 'p-jan26', bv: 'Projects', month: 'Jan-26',
    factuurvolume: 364790, debiteuren: 0, ohwMutatie: 180298,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_JAN.Projects, vennootschapsbelasting: VPB_JAN.Projects,
    remark: '',
  },
  {
    id: 's-jan26', bv: 'Software', month: 'Jan-26',
    factuurvolume: 493761, debiteuren: 0, ohwMutatie: -35002,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_JAN.Software, vennootschapsbelasting: VPB_JAN.Software,
    remark: '',
  },
  // ── February 2026 ────────────────────────────────────────────────────────
  {
    id: 'c-feb26', bv: 'Consultancy', month: 'Feb-26',
    factuurvolume: 797454, debiteuren: 0, ohwMutatie: 205300,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_FEB.Consultancy, vennootschapsbelasting: VPB_FEB.Consultancy,
    remark: '',
  },
  {
    id: 'p-feb26', bv: 'Projects', month: 'Feb-26',
    factuurvolume: 418811, debiteuren: 0, ohwMutatie: 107890,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_FEB.Projects, vennootschapsbelasting: VPB_FEB.Projects,
    remark: '',
  },
  {
    id: 's-feb26', bv: 'Software', month: 'Feb-26',
    factuurvolume: 261030, debiteuren: 0, ohwMutatie: -7000,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_FEB.Software, vennootschapsbelasting: VPB_FEB.Software,
    remark: '',
  },
  // ── March 2026 (open / empty template) ───────────────────────────────────
  {
    id: 'c-mar26', bv: 'Consultancy', month: 'Mar-26',
    factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: 0, vennootschapsbelasting: 0,
    remark: '',
  },
  {
    id: 'p-mar26', bv: 'Projects', month: 'Mar-26',
    factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: 0, vennootschapsbelasting: 0,
    remark: '',
  },
  {
    id: 's-mar26', bv: 'Software', month: 'Mar-26',
    factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: 0, vennootschapsbelasting: 0,
    remark: '',
  },
  // ── Holdings: geen OHW/factuurvolume flow, alleen kosten-invoer ─────
  {
    id: 'h-jan26', bv: 'Holdings', month: 'Jan-26',
    factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_JAN.Holdings, vennootschapsbelasting: VPB_JAN.Holdings,
    remark: '',
  },
  {
    id: 'h-feb26', bv: 'Holdings', month: 'Feb-26',
    factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_FEB.Holdings, vennootschapsbelasting: VPB_FEB.Holdings,
    remark: '',
  },
  {
    id: 'h-mar26', bv: 'Holdings', month: 'Mar-26',
    factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: 0, vennootschapsbelasting: 0,
    remark: '',
  },
]

/** Pre-fill-defaults die read-paden kunnen gebruiken als een persisted entry
 *  de nieuwe velden (financieelResultaat / vennootschapsbelasting) nog niet
 *  heeft. Voorkomt "leeg veld" voor bestaande users die hun store al hadden. */
export function getFinResDefault(bv: ClosingBv, month: string): number {
  if (month === 'Jan-26') return FIN_RES_JAN[bv] ?? 0
  if (month === 'Feb-26') return FIN_RES_FEB[bv] ?? 0
  return 0
}
export function getVpbDefault(bv: ClosingBv, month: string): number {
  if (month === 'Jan-26') return VPB_JAN[bv] ?? 0
  if (month === 'Feb-26') return VPB_FEB[bv] ?? 0
  return 0
}

interface FinStore {
  entries: ClosingEntry[]
  loaded: boolean
  loadFromDb: () => Promise<void>
  updateEntry: (id: string, patch: Partial<Omit<ClosingEntry, 'id'>>) => void
  getEntry: (bv: ClosingBv, month: string) => ClosingEntry | undefined
  getMonthEntries: (month: string) => ClosingEntry[]
  /** Zorgt dat er een entry bestaat voor (bv, month). Returned de entry.
   *  Nodig voor gevallen waar de persisted state een oude versie was
   *  (bv. voor Holdings werd toegevoegd). Lazy create maakt een lege
   *  entry met INITIAL_ENTRIES-defaults. */
  ensureEntry: (bv: ClosingBv, month: string) => ClosingEntry
}

/** Merge: voeg ontbrekende INITIAL_ENTRIES toe aan de gegeven lijst.
 *  Critical voor migraties — users met oudere persisted state (bv. zonder
 *  Holdings) krijgen de nieuwe entries er automatisch bij. Hiermee bailt
 *  updateKosten niet meer uit bij Holdings-cellen. */
function mergeWithInitialEntries(existing: ClosingEntry[]): ClosingEntry[] {
  const existingIds = new Set(existing.map(e => e.id))
  const missing = INITIAL_ENTRIES.filter(e => !existingIds.has(e.id))
  return missing.length > 0 ? [...existing, ...missing] : existing
}

export const useFinStore = create<FinStore>()(
  persist(
    (set, get) => ({
      entries: INITIAL_ENTRIES,
      loaded: false,

      loadFromDb: async () => {
        // Merge-laad + reconcile zodat lokaal-only data niet kwijtraakt.
        //  - DB-rij bestaat → DB wint (gedeelde waarheid)
        //  - alleen lokaal → behoud lokaal én push terug naar Supabase
        //  - geen van beide → INITIAL_ENTRIES default
        try {
          const rows = await fetchClosingEntries()
          const dbById = new Map(rows.map(r => [r.id, r]))
          const localEntries = get().entries
          const localOnly: ClosingEntry[] = []

          // Bepaal of een lokale entry "data" heeft (anders dan default).
          const hasLocalData = (e: ClosingEntry): boolean =>
            e.factuurvolume !== 0 || e.debiteuren !== 0 || e.ohwMutatie !== 0 ||
            e.kostencorrectie !== 0 || e.accruals !== 0 ||
            e.handmatigeCorrectie !== 0 || (e.remark ?? '') !== '' ||
            Object.keys(e.kostenOverrides ?? {}).length > 0 ||
            (typeof e.financieelResultaat === 'number') ||
            (typeof e.vennootschapsbelasting === 'number')

          // Bouw merged: DB wint, dan lokaal-only, dan defaults voor wat ontbreekt
          const seen = new Set<string>()
          const merged: ClosingEntry[] = []
          for (const r of rows) { merged.push(r); seen.add(r.id) }
          for (const le of localEntries) {
            if (seen.has(le.id)) continue
            seen.add(le.id)
            merged.push(le)
            if (hasLocalData(le)) localOnly.push(le)
          }
          const finalMerged = mergeWithInitialEntries(merged)
          console.info(`[useFinStore] DB=${rows.length}, local-only=${localOnly.length}, total=${finalMerged.length}`)
          set({ entries: finalMerged, loaded: true })

          // Reconcile: lokaal-only entries pushen naar Supabase
          if (localOnly.length > 0) {
            console.info(`[useFinStore] reconcile: pushing ${localOnly.length} local-only entries`)
            await upsertAllClosingEntries(localOnly)
          }

          // Eerste keer ooit (alles leeg) → seed defaults
          if (rows.length === 0 && localOnly.length === 0) {
            await upsertAllClosingEntries(INITIAL_ENTRIES)
          } else if (finalMerged.length > rows.length + localOnly.length) {
            // Nieuwe BV/maanden in code → push die ook
            const known = new Set([...rows.map(r => r.id), ...localOnly.map(e => e.id)])
            const newOnes = finalMerged.filter(e => !known.has(e.id))
            if (newOnes.length > 0) await upsertAllClosingEntries(newOnes)
          }
          void dbById  // typescript-tevreden, anders 'never used'
        } catch (err) {
          console.error('[useFinStore] Supabase load failed:', err)
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

      ensureEntry: (bv, month) => {
        const existing = get().entries.find(e => e.bv === bv && e.month === month)
        if (existing) return existing
        // Fallback op een INITIAL_ENTRIES-template voor (bv, month) of
        // anders een minimale lege entry.
        const template = INITIAL_ENTRIES.find(e => e.bv === bv && e.month === month)
        const fresh: ClosingEntry = template
          ? { ...template, kostenOverrides: { ...(template.kostenOverrides ?? {}) } }
          : {
              id: `${bv[0].toLowerCase()}-${month.replace('-', '').toLowerCase()}`,
              bv, month,
              factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
              kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
              operationeleKosten: 0, amortisatieAfschrijvingen: 0,
              kostenOverrides: {}, remark: '',
            }
        set(s => ({ entries: [...s.entries, fresh] }))
        upsertClosingEntry(fresh)
        return fresh
      },
    }),
    {
      name: 'tpg-closing-entries',
      // Alleen entries persisten; `loaded` blijft lokaal bij elke reload false
      partialize: (state) => ({ entries: state.entries }) as unknown as FinStore,
      // Bij rehydratie: merge ontbrekende default-entries. Zonder deze stap
      // missen users met oudere localStorage de Holdings-entries, waardoor
      // updateKosten voor Holdings silently failt (entry niet gevonden → bail).
      onRehydrateStorage: () => (state) => {
        if (state && Array.isArray(state.entries)) {
          state.entries = mergeWithInitialEntries(state.entries)
        }
      },
    },
  ),
)

export const CLOSING_MONTHS = ['Jan-26', 'Feb-26', 'Mar-26']
