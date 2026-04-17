import { create } from 'zustand'
import type { OhwEntityData, OhwYearData } from '../data/types'
import { recomputeEntity } from '../lib/calc'
import { ohwYearData2025 } from '../data/ohwData2025'
import { ohwYearData2026 } from '../data/ohwData2026'

function initYear(yearData: OhwYearData): OhwYearData {
  const entities = yearData.entities.map(e => recomputeEntity(e, yearData.allMonths))
  return { ...yearData, entities }
}

interface OhwStore {
  data2025: OhwYearData
  data2026: OhwYearData
  updateEntity: (year: '2025' | '2026', updated: OhwEntityData) => void
  /** Update een specifieke rij-waarde (bijv. vanuit import goedkeuring) */
  updateRowValue: (year: '2025' | '2026', entityName: string, rowId: string, month: string, value: number) => void
}

export const useOhwStore = create<OhwStore>((set) => ({
  data2025: initYear(ohwYearData2025),
  data2026: initYear(ohwYearData2026),
  updateEntity: (year, updated) =>
    set(state => {
      const key = year === '2025' ? 'data2025' : 'data2026'
      const prev = state[key]
      const recomputed = recomputeEntity(updated, prev.allMonths)
      return {
        [key]: {
          ...prev,
          entities: prev.entities.map(e => e.entity === updated.entity ? recomputed : e),
        },
      }
    }),
  updateRowValue: (year, entityName, rowId, month, value) =>
    set(state => {
      const key = year === '2025' ? 'data2025' : 'data2026'
      const prev = state[key]
      const entities = prev.entities.map(entity => {
        if (entity.entity !== entityName) return entity
        const onderhanden = entity.onderhanden.map(sec => ({
          ...sec,
          rows: sec.rows.map(row =>
            row.id === rowId ? { ...row, values: { ...row.values, [month]: value } } : row
          ),
        }))
        return recomputeEntity({ ...entity, onderhanden }, prev.allMonths)
      })
      return { [key]: { ...prev, entities } }
    }),
}))
