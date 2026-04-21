import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { monthlyBudget2026 } from '../data/plData'
import type { EntityName } from '../data/plData'

export const BUDGET_MONTHS_2026 = [
  'Jan-26', 'Feb-26', 'Mar-26', 'Apr-26', 'May-26', 'Jun-26',
  'Jul-26', 'Aug-26', 'Sep-26', 'Oct-26', 'Nov-26', 'Dec-26',
]

/**
 * Budget data = source (from plData for Jan/Feb/Mar) + editable overrides for
 * future months. Overrides persisted in localStorage.
 *
 * Structure: overrides[entity][month][plKey] = value (signed, like source data)
 */
type BudgetOverrides = Record<EntityName, Record<string, Record<string, number>>>

function emptyOverrides(): BudgetOverrides {
  return { Consultancy: {}, Projects: {}, Software: {}, Holdings: {} }
}

interface BudgetState {
  overrides: BudgetOverrides
  setValue: (entity: EntityName, month: string, key: string, val: number) => void
  setMonth: (entity: EntityName, month: string, data: Record<string, number>) => void
  clearMonth: (entity: EntityName, month: string) => void
  /** Effective budget for a BV/month: source ?? override ?? 0  */
  getMonth: (entity: EntityName, month: string) => Record<string, number>
  /** Raw source data (for display of "source" badge in UI) */
  hasSource: (entity: EntityName, month: string) => boolean
  hasOverride: (entity: EntityName, month: string) => boolean
}

export const useBudgetStore = create<BudgetState>()(
  persist(
    (set, get) => ({
      overrides: emptyOverrides(),

      setValue: (entity, month, key, val) => {
        set(s => {
          const entityOv = { ...(s.overrides[entity] ?? {}) }
          const monthOv  = { ...(entityOv[month] ?? {}) }
          monthOv[key] = val
          entityOv[month] = monthOv
          return { overrides: { ...s.overrides, [entity]: entityOv } }
        })
      },

      setMonth: (entity, month, data) => {
        set(s => {
          const entityOv = { ...(s.overrides[entity] ?? {}) }
          entityOv[month] = { ...data }
          return { overrides: { ...s.overrides, [entity]: entityOv } }
        })
      },

      clearMonth: (entity, month) => {
        set(s => {
          const entityOv = { ...(s.overrides[entity] ?? {}) }
          delete entityOv[month]
          return { overrides: { ...s.overrides, [entity]: entityOv } }
        })
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
    }),
    { name: 'tpg-budget-overrides' },
  ),
)
