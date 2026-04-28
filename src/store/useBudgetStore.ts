import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { monthlyBudget2026 } from '../data/plData'
import type { EntityName } from '../data/plData'
import {
  fetchBudgetOverrides,
  upsertBudgetOverride,
  deleteBudgetOverridesForMonth,
} from '../lib/db'

export const BUDGET_MONTHS_2026 = [
  'Jan-26', 'Feb-26', 'Mar-26', 'Apr-26', 'May-26', 'Jun-26',
  'Jul-26', 'Aug-26', 'Sep-26', 'Oct-26', 'Nov-26', 'Dec-26',
]

/**
 * Budget data = source (from plData voor Jan/Feb/Mar) + editable overrides
 * voor toekomstige maanden.
 *
 * Persistentie: Supabase is de primaire opslag (tabel `budget_overrides`).
 * localStorage wordt ook gebruikt als fallback-cache zodat bewerkingen
 * behouden blijven als Supabase offline is; bij volgende load-cycle
 * overschrijven Supabase-waarden de cache.
 *
 * Structure: overrides[entity][month][plKey] = value (signed, like source data)
 */
type BudgetOverrides = Record<EntityName, Record<string, Record<string, number>>>

function emptyOverrides(): BudgetOverrides {
  return { Consultancy: {}, Projects: {}, Software: {}, Holdings: {} }
}

interface BudgetState {
  overrides: BudgetOverrides
  /** Latest Estimate overrides — user-edited cells in de LE-matrix (snapshot of actual+budget mix) */
  leOverrides: BudgetOverrides
  loaded: boolean
  loadFromDb: () => Promise<void>
  setValue: (entity: EntityName, month: string, key: string, val: number) => void
  setMonth: (entity: EntityName, month: string, data: Record<string, number>) => void
  clearMonth: (entity: EntityName, month: string) => void
  /** Effective budget for a BV/month: source + override merged */
  getMonth: (entity: EntityName, month: string) => Record<string, number>
  hasSource: (entity: EntityName, month: string) => boolean
  hasOverride: (entity: EntityName, month: string) => boolean

  // ── Latest Estimate ─────────────────────────────────────────────────────
  setLeValue: (entity: EntityName, month: string, key: string, val: number) => void
  setLeMonth: (entity: EntityName, month: string, data: Record<string, number>) => void
  clearLeMonth: (entity: EntityName, month: string) => void
  clearAllLe: (entity: EntityName) => void
  /** Raw override only (voor detectie) */
  getLeOverride: (entity: EntityName, month: string, key: string) => number | undefined
  hasLeOverride: (entity: EntityName, month: string) => boolean
}

export const useBudgetStore = create<BudgetState>()(
  persist(
    (set, get) => ({
      overrides: emptyOverrides(),
      leOverrides: emptyOverrides(),
      loaded: false,

      loadFromDb: async () => {
        // ABSOLUTE GARANTIE: deze functie wipet onder geen voorwaarde lokale
        // state. Bij elke fout / lege response blijft localStorage intact.
        //
        // Merge-load met reconcile:
        //  1. Haal Supabase-data op
        //  2. Merge met lokale state — Supabase wint bij conflict op
        //     (entity, maand, key). Local-only keys blijven staan.
        //  3. Push local-only keys terug naar Supabase zodat ze gedeeld
        //     worden (recovery na eerdere save-fouten).
        let rows: Awaited<ReturnType<typeof fetchBudgetOverrides>> = []
        try {
          rows = await fetchBudgetOverrides()
        } catch (e) {
          console.warn('[useBudgetStore] fetch failed — keeping local state:', e)
          set({ loaded: true })
          return
        }
        const dbOv = emptyOverrides()
        for (const r of rows) {
          const e = r.entity as EntityName
          if (!dbOv[e]) continue
          if (!dbOv[e][r.month]) dbOv[e][r.month] = {}
          dbOv[e][r.month][r.plKey] = r.value
        }

        const localOv = get().overrides
        // Bouw merged: start met local, db overschrijft per key
        const merged: BudgetOverrides = emptyOverrides()
        const allEntities: EntityName[] = ['Consultancy', 'Projects', 'Software', 'Holdings']
        for (const e of allEntities) {
          const months = new Set([
            ...Object.keys(localOv[e] ?? {}),
            ...Object.keys(dbOv[e] ?? {}),
          ])
          for (const m of months) {
            const keys = new Set([
              ...Object.keys(localOv[e]?.[m] ?? {}),
              ...Object.keys(dbOv[e]?.[m] ?? {}),
            ])
            const monthMerged: Record<string, number> = {}
            for (const k of keys) {
              const dbVal = dbOv[e]?.[m]?.[k]
              const localVal = localOv[e]?.[m]?.[k]
              monthMerged[k] = dbVal !== undefined ? dbVal : (localVal ?? 0)
            }
            if (Object.keys(monthMerged).length > 0) {
              if (!merged[e]) merged[e] = {}
              merged[e][m] = monthMerged
            }
          }
        }
        console.info(`[useBudgetStore] DB=${rows.length} rows, merged ${Object.values(merged).reduce((s,e)=>s+Object.values(e).reduce((ss,m)=>ss+Object.keys(m).length,0),0)} keys`)
        set({ overrides: merged, loaded: true })

        // Reconcile: push local-only keys naar Supabase
        const toPush: Array<{ entity: EntityName; month: string; plKey: string; value: number }> = []
        for (const e of allEntities) {
          for (const m of Object.keys(localOv[e] ?? {})) {
            for (const k of Object.keys(localOv[e][m] ?? {})) {
              const localVal = localOv[e][m][k]
              const dbVal = dbOv[e]?.[m]?.[k]
              if (dbVal === undefined && localVal !== undefined) {
                toPush.push({ entity: e, month: m, plKey: k, value: localVal })
              }
            }
          }
        }
        if (toPush.length > 0) {
          console.info(`[useBudgetStore] reconcile: pushing ${toPush.length} local-only keys naar Supabase`)
          for (const p of toPush) {
            upsertBudgetOverride(p)  // fire-and-forget; errors → toast via dbEvents
          }
        }
      },

      setValue: (entity, month, key, val) => {
        set(s => {
          const entityOv = { ...(s.overrides[entity] ?? {}) }
          const monthOv  = { ...(entityOv[month] ?? {}) }
          monthOv[key] = val
          entityOv[month] = monthOv
          return { overrides: { ...s.overrides, [entity]: entityOv } }
        })
        // Sync naar Supabase (fire-and-forget)
        upsertBudgetOverride({ entity, month, plKey: key, value: val })
      },

      setMonth: (entity, month, data) => {
        set(s => {
          const entityOv = { ...(s.overrides[entity] ?? {}) }
          entityOv[month] = { ...data }
          return { overrides: { ...s.overrides, [entity]: entityOv } }
        })
        // Sync elk key naar Supabase
        for (const [k, v] of Object.entries(data)) {
          upsertBudgetOverride({ entity, month, plKey: k, value: v })
        }
      },

      clearMonth: (entity, month) => {
        set(s => {
          const entityOv = { ...(s.overrides[entity] ?? {}) }
          delete entityOv[month]
          return { overrides: { ...s.overrides, [entity]: entityOv } }
        })
        // Verwijder alle rows voor deze entity+month uit Supabase
        deleteBudgetOverridesForMonth(entity, month)
      },

      getMonth: (entity, month) => {
        const src = monthlyBudget2026[entity]?.[month]
        const ov  = get().overrides[entity]?.[month]
        if (ov && Object.keys(ov).length > 0) {
          return { ...(src ?? {}), ...ov }
        }
        return src ?? {}
      },

      hasSource: (entity, month) =>
        !!monthlyBudget2026[entity]?.[month] && Object.keys(monthlyBudget2026[entity][month]).length > 0,

      hasOverride: (entity, month) => {
        const ov = get().overrides[entity]?.[month]
        return !!ov && Object.keys(ov).length > 0
      },

      // ── Latest Estimate overrides ─────────────────────────────────────────
      setLeValue: (entity, month, key, val) => {
        set(s => {
          const entityOv = { ...(s.leOverrides[entity] ?? {}) }
          const monthOv  = { ...(entityOv[month] ?? {}) }
          monthOv[key] = val
          entityOv[month] = monthOv
          return { leOverrides: { ...s.leOverrides, [entity]: entityOv } }
        })
      },

      setLeMonth: (entity, month, data) => {
        set(s => {
          const entityOv = { ...(s.leOverrides[entity] ?? {}) }
          entityOv[month] = { ...data }
          return { leOverrides: { ...s.leOverrides, [entity]: entityOv } }
        })
      },

      clearLeMonth: (entity, month) => {
        set(s => {
          const entityOv = { ...(s.leOverrides[entity] ?? {}) }
          delete entityOv[month]
          return { leOverrides: { ...s.leOverrides, [entity]: entityOv } }
        })
      },

      clearAllLe: (entity) => {
        set(s => ({ leOverrides: { ...s.leOverrides, [entity]: {} } }))
      },

      getLeOverride: (entity, month, key) => {
        return get().leOverrides[entity]?.[month]?.[key]
      },

      hasLeOverride: (entity, month) => {
        const ov = get().leOverrides[entity]?.[month]
        return !!ov && Object.keys(ov).length > 0
      },
    }),
    { name: 'tpg-budget-overrides' },
  ),
)
