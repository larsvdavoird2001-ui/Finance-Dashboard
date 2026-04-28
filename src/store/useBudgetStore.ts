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
        // Destructieve laad: Supabase is de waarheid voor budget-data.
        // Eerst reset naar leeg, dan invullen vanuit DB. Dit voorkomt dat een
        // andere user op een ander apparaat stale localStorage-cache blijft
        // zien terwijl admin al lang verder is.
        const rows = await fetchBudgetOverrides()
        const overrides = emptyOverrides()
        for (const r of rows) {
          const entity = r.entity as EntityName
          if (!overrides[entity]) continue
          if (!overrides[entity][r.month]) overrides[entity][r.month] = {}
          overrides[entity][r.month][r.plKey] = r.value
        }
        console.info(`[useBudgetStore] loaded ${rows.length} budget_overrides rows from Supabase`)
        set({ overrides, loaded: true })
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
