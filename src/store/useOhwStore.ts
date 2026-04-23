import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { OhwEntityData, OhwYearData, OhwRow } from '../data/types'
import { recomputeEntity } from '../lib/calc'
import { ohwYearData2025 } from '../data/ohwData2025'
import { ohwYearData2026 } from '../data/ohwData2026'
import { fetchOhwEntities, upsertOhwEntity, upsertAllOhwEntities } from '../lib/db'

function initYear(yearData: OhwYearData): OhwYearData {
  const entities = yearData.entities.map(e => recomputeEntity(e, yearData.allMonths))
  return { ...yearData, entities }
}

type BvName = 'Consultancy' | 'Projects' | 'Software'

interface OhwStore {
  data2025: OhwYearData
  data2026: OhwYearData
  loaded: boolean
  /** Tombstone-lijst van handmatig verwijderde rij-ids. Wordt gepersist
   *  in localStorage én gebruikt om bij een Supabase-reload de rij niet
   *  terug te laten komen (Supabase kan nog de oude staat bevatten). */
  deletedRowIds: string[]
  loadFromDb: () => Promise<void>
  updateEntity: (year: '2025' | '2026', updated: OhwEntityData) => void
  updateRowValue: (year: '2025' | '2026', entityName: string, rowId: string, month: string, value: number) => void
  /** Zet/wist een per-maand toelichting op een rij (voor handmatige override
   *  op locked-rijen EN als Excel-style cel-opmerking). Lege string wist. */
  updateRowRemark: (year: '2025' | '2026', entityName: string, rowId: string, month: string, remark: string) => void
  /** Zet de contactpersoon op een rij (één persoon per rij). Lege string wist. */
  updateRowContact: (year: '2025' | '2026', entityName: string, rowId: string, contact: string) => void
  /** Verwijder een rij permanent (met tombstone zodat hij niet terugkomt
   *  via Supabase-reload). Mag niet gebruikt worden voor locked rows of
   *  rijen met ingevulde waardes — caller checkt dat. */
  deleteRow: (year: '2025' | '2026', entityName: string, rowId: string) => void
  /** IC-pair: voegt TWEE gekoppelde IC-rijen toe (één in fromBv, één in toBv)
   *  met gedeelde icPairId. Waardes blijven leeg; user vult ze later in. */
  addIcPair: (year: '2025' | '2026', fromBv: BvName, toBv: BvName, description: string, responsible?: string) => void
  /** IC-pair: verwijder BEIDE kanten van een gekoppelde IC-regel. */
  removeIcPair: (year: '2025' | '2026', icPairId: string) => void
  /** Update een IC-pair waarde. Zet de waarde bij de opgegeven entity en
   *  spiegelt automatisch naar de andere BV met omgekeerd teken. */
  updateIcPairValue: (year: '2025' | '2026', entityName: string, rowId: string, month: string, value: number) => void
  /** Update de beschrijving van een IC-pair (beide kanten synchroon). */
  updateIcPairDescription: (year: '2025' | '2026', icPairId: string, description: string) => void
}

export const useOhwStore = create<OhwStore>()(
  persist(
    (set, get) => ({
      data2025: initYear(ohwYearData2025),
      data2026: initYear(ohwYearData2026),
      loaded: false,
      deletedRowIds: [],

      loadFromDb: async () => {
        // Non-destructieve load: Supabase data wint ALS er iets opgehaald wordt,
        // anders blijft de localStorage-gehydreerde staat behouden.
        try {
          const [entities2025, entities2026] = await Promise.all([
            fetchOhwEntities('2025'),
            fetchOhwEntities('2026'),
          ])

          const state = get()
          let d2025 = state.data2025
          let d2026 = state.data2026
          const tombstones = new Set(state.deletedRowIds)

          // Filter-helper: verwijder rijen uit onderhanden-secties én uit
          // icVerrekening én uit vooruitgefactureerd wanneer hun id in de
          // tombstone-lijst zit. Zo kunnen Supabase-rijen die lokaal al
          // verwijderd waren, niet terugkeren.
          const stripTombstones = (e: OhwEntityData): OhwEntityData => ({
            ...e,
            onderhanden: e.onderhanden.map(s => ({
              ...s,
              rows: s.rows.filter(r => !tombstones.has(r.id)),
            })),
            icVerrekening: e.icVerrekening.filter(r => !tombstones.has(r.id)),
            vooruitgefactureerd: e.vooruitgefactureerd?.filter(r => !tombstones.has(r.id)),
          })

          if (entities2025.length > 0) {
            const filtered = entities2025.map(stripTombstones)
            const recomputed = filtered.map(e => recomputeEntity(e, d2025.allMonths))
            d2025 = { ...d2025, entities: recomputed }
          } else {
            // Supabase leeg: alleen seeden als lokaal óók nog de defaults zijn
            // (heuristiek: geen remarks aanwezig — anders zou de user al edits
            // hebben gemaakt die we niet willen overschrijven)
            const hasLocalEdits = d2025.entities.some(e =>
              e.onderhanden.some(s => s.rows.some(r => r.remarks && Object.keys(r.remarks).length > 0)),
            )
            if (!hasLocalEdits) await upsertAllOhwEntities('2025', d2025.entities)
          }

          if (entities2026.length > 0) {
            const filtered = entities2026.map(stripTombstones)
            const recomputed = filtered.map(e => recomputeEntity(e, d2026.allMonths))
            d2026 = { ...d2026, entities: recomputed }
          } else {
            const hasLocalEdits = d2026.entities.some(e =>
              e.onderhanden.some(s => s.rows.some(r => r.remarks && Object.keys(r.remarks).length > 0)),
            )
            if (!hasLocalEdits) await upsertAllOhwEntities('2026', d2026.entities)
          }

          set({ data2025: d2025, data2026: d2026, loaded: true })
        } catch (err) {
          console.warn('[useOhwStore] Supabase load failed, keeping local state:', err)
          set({ loaded: true })
        }
      },

  updateEntity: (year, updated) => {
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
    })
    // Async sync naar Supabase
    const state = get()
    const yearData = year === '2025' ? state.data2025 : state.data2026
    const entity = yearData.entities.find(e => e.entity === updated.entity)
    if (entity) upsertOhwEntity(year, entity)
  },

  updateRowValue: (year, entityName, rowId, month, value) => {
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
        // Ook in vooruitgefactureerd en icVerrekening updaten — zelfde rowId
        // kan daar staan (Software heeft bv. vf1/vf2 rows die bewerkbaar zijn).
        const icVerrekening = entity.icVerrekening.map(row =>
          row.id === rowId ? { ...row, values: { ...row.values, [month]: value } } : row
        )
        const vooruitgefactureerd = entity.vooruitgefactureerd?.map(row =>
          row.id === rowId ? { ...row, values: { ...row.values, [month]: value } } : row
        )
        return recomputeEntity({ ...entity, onderhanden, icVerrekening, vooruitgefactureerd }, prev.allMonths)
      })
      return { [key]: { ...prev, entities } }
    })
    // Async sync naar Supabase
    const state = get()
    const yearData = year === '2025' ? state.data2025 : state.data2026
    const entity = yearData.entities.find(e => e.entity === entityName)
    if (entity) upsertOhwEntity(year, entity)
  },

  updateRowContact: (year, entityName, rowId, contact) => {
    let touched: OhwEntityData | undefined
    set(state => {
      const key = year === '2025' ? 'data2025' : 'data2026'
      const prev = state[key]
      const entities = prev.entities.map(entity => {
        if (entity.entity !== entityName) return entity
        // Probeer in onderhanden én icVerrekening én vooruitgefactureerd
        let hit = false
        const onderhanden = entity.onderhanden.map(sec => ({
          ...sec,
          rows: sec.rows.map(r => {
            if (r.id !== rowId) return r
            hit = true
            return contact.trim() ? { ...r, contactPerson: contact.trim() } : (() => { const c = { ...r }; delete c.contactPerson; return c })()
          }),
        }))
        const icVerrekening = entity.icVerrekening.map(r => {
          if (r.id !== rowId) return r
          hit = true
          return contact.trim() ? { ...r, contactPerson: contact.trim() } : (() => { const c = { ...r }; delete c.contactPerson; return c })()
        })
        const vooruitgefactureerd = entity.vooruitgefactureerd?.map(r => {
          if (r.id !== rowId) return r
          hit = true
          return contact.trim() ? { ...r, contactPerson: contact.trim() } : (() => { const c = { ...r }; delete c.contactPerson; return c })()
        })
        if (!hit) return entity
        const updated = { ...entity, onderhanden, icVerrekening, vooruitgefactureerd }
        touched = updated
        return updated
      })
      return { [key]: { ...prev, entities } }
    })
    if (touched) upsertOhwEntity(year, touched)
  },

  deleteRow: (year, entityName, rowId) => {
    let touched: OhwEntityData | undefined
    set(state => {
      const key = year === '2025' ? 'data2025' : 'data2026'
      const prev = state[key]
      const entities = prev.entities.map(entity => {
        if (entity.entity !== entityName) return entity
        const onderhanden = entity.onderhanden.map(sec => ({
          ...sec,
          rows: sec.rows.filter(r => r.id !== rowId),
        }))
        const icVerrekening = entity.icVerrekening.filter(r => r.id !== rowId)
        const vooruitgefactureerd = entity.vooruitgefactureerd?.filter(r => r.id !== rowId)
        const updated = recomputeEntity({ ...entity, onderhanden, icVerrekening, vooruitgefactureerd }, prev.allMonths)
        touched = updated
        return updated
      })
      // Tombstone — voorkom dat de rij via Supabase-reload terugkomt
      const deletedRowIds = state.deletedRowIds.includes(rowId)
        ? state.deletedRowIds
        : [...state.deletedRowIds, rowId]
      return { [key]: { ...prev, entities }, deletedRowIds }
    })
    if (touched) upsertOhwEntity(year, touched)
  },

  updateRowRemark: (year, entityName, rowId, month, remark) => {
    const patchRow = (row: OhwRow): OhwRow => {
      if (row.id !== rowId) return row
      const remarks = { ...(row.remarks ?? {}) }
      if (!remark || !remark.trim()) delete remarks[month]
      else remarks[month] = remark.trim()
      return { ...row, remarks }
    }
    set(state => {
      const key = year === '2025' ? 'data2025' : 'data2026'
      const prev = state[key]
      const entities = prev.entities.map(entity => {
        if (entity.entity !== entityName) return entity
        return {
          ...entity,
          onderhanden: entity.onderhanden.map(sec => ({ ...sec, rows: sec.rows.map(patchRow) })),
          icVerrekening: entity.icVerrekening.map(patchRow),
          vooruitgefactureerd: entity.vooruitgefactureerd?.map(patchRow),
        }
      })
      return { [key]: { ...prev, entities } }
    })
    const state = get()
    const yearData = year === '2025' ? state.data2025 : state.data2026
    const entity = yearData.entities.find(e => e.entity === entityName)
    if (entity) upsertOhwEntity(year, entity)
  },

  // ── IC-pair acties: gekoppelde verrekening tussen twee BV's ─────────────
  addIcPair: (year, fromBv, toBv, description, responsible) => {
    if (fromBv === toBv) return
    const icPairId = `icp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const touched: OhwEntityData[] = []
    set(state => {
      const key = year === '2025' ? 'data2025' : 'data2026'
      const prev = state[key]
      const entities = prev.entities.map(entity => {
        if (entity.entity !== fromBv && entity.entity !== toBv) return entity
        const newRow = {
          id: `ic-${icPairId}-${entity.entity}`,
          description,
          responsible,
          values: {} as Record<string, number | null>,
          icPairId,
          icFromBv: fromBv,
          icToBv: toBv,
        }
        const updated = { ...entity, icVerrekening: [...entity.icVerrekening, newRow] }
        const recomputed = recomputeEntity(updated, prev.allMonths)
        touched.push(recomputed)
        return recomputed
      })
      return { [key]: { ...prev, entities } }
    })
    for (const e of touched) upsertOhwEntity(year, e)
  },

  removeIcPair: (year, icPairId) => {
    const touched: OhwEntityData[] = []
    set(state => {
      const key = year === '2025' ? 'data2025' : 'data2026'
      const prev = state[key]
      const entities = prev.entities.map(entity => {
        const before = entity.icVerrekening.length
        const icVerrekening = entity.icVerrekening.filter(r => r.icPairId !== icPairId)
        if (icVerrekening.length === before) return entity
        const updated = { ...entity, icVerrekening }
        const recomputed = recomputeEntity(updated, prev.allMonths)
        touched.push(recomputed)
        return recomputed
      })
      return { [key]: { ...prev, entities } }
    })
    for (const e of touched) upsertOhwEntity(year, e)
  },

  updateIcPairValue: (year, entityName, rowId, month, value) => {
    // Zoek de pair-info uit de bron-rij zodat we de andere kant ook kunnen
    // bijwerken. Lees eerst state (synchroon) om de row + pair op te zoeken.
    const preState = get()
    const key = year === '2025' ? 'data2025' : 'data2026'
    const srcEntity = preState[key].entities.find(e => e.entity === entityName)
    const srcRow = srcEntity?.icVerrekening.find(r => r.id === rowId)
    if (!srcRow || !srcRow.icPairId || !srcRow.icFromBv || !srcRow.icToBv) {
      // Geen pair → fallback naar normale update op alleen deze rij
      set(state => {
        const prev = state[key]
        const entities = prev.entities.map(entity => {
          if (entity.entity !== entityName) return entity
          const icVerrekening = entity.icVerrekening.map(r =>
            r.id === rowId ? { ...r, values: { ...r.values, [month]: value } } : r,
          )
          return recomputeEntity({ ...entity, icVerrekening }, prev.allMonths)
        })
        return { [key]: { ...prev, entities } }
      })
      const after = get()[key].entities.find(e => e.entity === entityName)
      if (after) upsertOhwEntity(year, after)
      return
    }

    // Pair: bereken mirror-waarde. De ingevoerde waarde is zoals de user het
    // invult bij entityName (incl. teken). Mirror = -value aan de andere BV.
    const { icPairId, icFromBv, icToBv } = srcRow
    const otherBv = entityName === icFromBv ? icToBv : icFromBv
    const mirrorValue = -value

    const touched: OhwEntityData[] = []
    set(state => {
      const prev = state[key]
      const entities = prev.entities.map(entity => {
        if (entity.entity === entityName) {
          const icVerrekening = entity.icVerrekening.map(r =>
            r.id === rowId ? { ...r, values: { ...r.values, [month]: value } } : r,
          )
          const updated = recomputeEntity({ ...entity, icVerrekening }, prev.allMonths)
          touched.push(updated)
          return updated
        }
        if (entity.entity === otherBv) {
          const icVerrekening = entity.icVerrekening.map(r =>
            r.icPairId === icPairId ? { ...r, values: { ...r.values, [month]: mirrorValue } } : r,
          )
          const updated = recomputeEntity({ ...entity, icVerrekening }, prev.allMonths)
          touched.push(updated)
          return updated
        }
        return entity
      })
      return { [key]: { ...prev, entities } }
    })
    for (const e of touched) upsertOhwEntity(year, e)
  },

  updateIcPairDescription: (year, icPairId, description) => {
    const touched: OhwEntityData[] = []
    set(state => {
      const key = year === '2025' ? 'data2025' : 'data2026'
      const prev = state[key]
      const entities = prev.entities.map(entity => {
        const has = entity.icVerrekening.some(r => r.icPairId === icPairId)
        if (!has) return entity
        const icVerrekening = entity.icVerrekening.map(r =>
          r.icPairId === icPairId ? { ...r, description } : r,
        )
        const updated = { ...entity, icVerrekening }
        touched.push(updated)
        return updated
      })
      return { [key]: { ...prev, entities } }
    })
    for (const e of touched) upsertOhwEntity(year, e)
  },
    }),
    {
      name: 'tpg-ohw-data',
      // GEEN version bump — dat veroorzaakte data-verlies bij gebruikers
      // zonder migrate-functie (Zustand persist reset de store naar default
      // state als version mismatcht en er geen migrate is). In plaats daarvan
      // gebruiken we onRehydrateStorage om afgeleide velden te hertellen —
      // RUWE DATA BLIJFT ALTIJD BEHOUDEN.
      partialize: (state) => ({
        data2025: state.data2025,
        data2026: state.data2026,
        deletedRowIds: state.deletedRowIds,
      }) as unknown as OhwStore,
      // Accepteer elke oude versie uit localStorage zonder data te verliezen
      // (fail-safe voor wanneer persist-versies ooit wel opzettelijk bumpen).
      migrate: (persistedState) => persistedState as OhwStore,
      onRehydrateStorage: () => (state) => {
        if (!state) return
        // Recompute afgeleide velden (mutatieOhw, mutatieVooruitgefactureerd,
        // nettoOmzet, etc) uit de ruwe rijen. Doet GEEN data-vernietiging —
        // alleen re-berekening van derived values met huidige calc-regels.
        if (state.data2025?.entities) {
          state.data2025 = {
            ...state.data2025,
            entities: state.data2025.entities.map(e => recomputeEntity(e, state.data2025.allMonths)),
          }
        }
        if (state.data2026?.entities) {
          state.data2026 = {
            ...state.data2026,
            entities: state.data2026.entities.map(e => recomputeEntity(e, state.data2026.allMonths)),
          }
        }
      },
    },
  ),
)
