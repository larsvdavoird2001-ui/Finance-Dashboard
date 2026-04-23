// Store voor gedetailleerde kosten-specificaties per (maand, categorie).
// Gebruikt door de Maandafsluiting om onder een kosten-sub-regel (bv.
// "Directe inkoopkosten") één niveau dieper specifieke posten in te vullen.
// Als er breakdowns bestaan voor een (maand, categorie), dan is de som
// van die breakdowns per BV het effectieve bedrag voor die categorie.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BvId } from '../data/types'

export interface CostBreakdown {
  id: string
  month: string
  category: string                        // sub.key, bv. 'directe_inkoopkosten'
  label: string
  values: Record<BvId, number>            // altijd positief opgeslagen
}

interface CostBreakdownStore {
  entries: CostBreakdown[]
  /** Voeg een nieuwe breakdown toe voor (month, category) — lege waardes. */
  add: (month: string, category: string, label?: string) => string
  /** Update de label van een breakdown. */
  updateLabel: (id: string, label: string) => void
  /** Update één BV-waarde van een breakdown. */
  updateValue: (id: string, bv: BvId, value: number) => void
  /** Verwijder een breakdown. */
  remove: (id: string) => void
  /** Alle breakdowns voor (month, category), gesorteerd op creatievolgorde. */
  getForCategory: (month: string, category: string) => CostBreakdown[]
  /** Som van alle breakdowns per BV voor (month, category). Als er geen
   *  breakdowns zijn, wordt `null` teruggegeven zodat de caller kan
   *  terugvallen op overrides of actuals. */
  sumForCategoryBv: (month: string, category: string, bv: BvId) => number | null
  /** Zijn er breakdowns voor (month, category)? Triggert fallback-gedrag. */
  hasBreakdowns: (month: string, category: string) => boolean
}

function emptyValues(): Record<BvId, number> {
  return { Consultancy: 0, Projects: 0, Software: 0 }
}

export const useCostBreakdownStore = create<CostBreakdownStore>()(
  persist(
    (set, get) => ({
      entries: [],

      add: (month, category, label = '') => {
        const id = `cb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        set(s => ({
          entries: [...s.entries, { id, month, category, label, values: emptyValues() }],
        }))
        return id
      },

      updateLabel: (id, label) => {
        set(s => ({ entries: s.entries.map(e => e.id === id ? { ...e, label } : e) }))
      },

      updateValue: (id, bv, value) => {
        set(s => ({
          entries: s.entries.map(e => e.id === id ? { ...e, values: { ...e.values, [bv]: value } } : e),
        }))
      },

      remove: (id) => {
        set(s => ({ entries: s.entries.filter(e => e.id !== id) }))
      },

      getForCategory: (month, category) =>
        get().entries.filter(e => e.month === month && e.category === category),

      sumForCategoryBv: (month, category, bv) => {
        const list = get().entries.filter(e => e.month === month && e.category === category)
        if (list.length === 0) return null
        return list.reduce((s, e) => s + (e.values[bv] ?? 0), 0)
      },

      hasBreakdowns: (month, category) =>
        get().entries.some(e => e.month === month && e.category === category),
    }),
    {
      name: 'tpg-cost-breakdowns',
      partialize: (state) => ({ entries: state.entries }) as unknown as CostBreakdownStore,
    },
  ),
)
