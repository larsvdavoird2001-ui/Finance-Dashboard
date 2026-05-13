import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { OhwEntityData, OhwYearData, OhwRow } from '../data/types'
import { recomputeEntity } from '../lib/calc'
import { ohwYearData2025 } from '../data/ohwData2025'
import { ohwYearData2026 } from '../data/ohwData2026'
import { fetchOhwEntities, upsertOhwEntity, upsertAllOhwEntities } from '../lib/db'
import type { IcFacturatieAggregated, IcReceiverBv } from '../lib/parseImport'

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
  /** Opruimen: verwijder in één klap alle niet-locked onderhanden-rijen
   *  zonder waardes voor dat jaar (tombstones toegevoegd). Per entity te
   *  draaien OF over alle entities. Returnt aantal verwijderde rijen. */
  pruneEmptyRows: (year: '2025' | '2026', entityName?: string) => number
  /** Verwijder een hele rubriek (section) inclusief al zijn rijen. Weigert
   *  als de section rijen bevat met waardes (dan moet user eerst ruimen).
   *  Returnt true bij succes, false als de section niet leeg was. */
  removeSection: (year: '2025' | '2026', entityName: string, sectionId: string) => boolean
  /** IC-pair: voegt TWEE gekoppelde IC-rijen toe (één in fromBv, één in toBv)
   *  met gedeelde icPairId. Waardes blijven leeg; user vult ze later in.
   *  Retourneert de gegenereerde icPairId zodat caller direct kan focussen
   *  op de net toegevoegde rij in de UI. */
  addIcPair: (year: '2025' | '2026', fromBv: BvName, toBv: BvName, description: string, responsible?: string) => string
  /** IC-pair: verwijder BEIDE kanten van een gekoppelde IC-regel. */
  removeIcPair: (year: '2025' | '2026', icPairId: string) => void
  /** Update een IC-pair waarde. Zet de waarde bij de opgegeven entity en
   *  spiegelt automatisch naar de andere BV met omgekeerd teken. */
  updateIcPairValue: (year: '2025' | '2026', entityName: string, rowId: string, month: string, value: number) => void
  /** Update de beschrijving van een IC-pair (beide kanten synchroon). */
  updateIcPairDescription: (year: '2025' | '2026', icPairId: string, description: string) => void
  /** IC Facturatie upload: vervangt alle auto-rijen (sourceSlot='ic_facturatie')
   *  voor de gegeven (receiverBv, month) door rijen op basis van de upload.
   *  Voor elke (werknemer, klant, van→naar) komt er een paar-rij aan beide
   *  kanten met deterministische icPairId zodat re-uploads idempotent zijn:
   *  - bestaande pair gevonden → maand-waarde wordt geüpdatet
   *  - nieuwe combinatie       → nieuw pair aangemaakt (locked, beide BVs)
   *  - bestaande pair niet meer in upload → maand-waarde wordt op 0 gezet;
   *    als de hele rij dan leeg is wordt het pair verwijderd. */
  upsertIcFacturatie: (
    year: '2025' | '2026',
    receiverBv: IcReceiverBv,
    month: string,
    rows: IcFacturatieAggregated[],
  ) => { addedPairs: number; updatedPairs: number; removedPairs: number }
  /** Eénmalige migratie-flag: alle bestaande IC-rijen zonder locked-veld
   *  krijgen locked=true bij rehydration. Voorkomt re-locking telkens. */
  icLockedMigrated?: boolean
}

export const useOhwStore = create<OhwStore>()(
  persist(
    (set, get) => ({
      data2025: initYear(ohwYearData2025),
      data2026: initYear(ohwYearData2026),
      loaded: false,
      deletedRowIds: [],

      loadFromDb: async () => {
        // Merge-load + reconcile voor OHW:
        //  - per BV: als Supabase een versie heeft, gebruik die (gedeelde
        //    waarheid). Maar lokale rijen met VALUES die niet in Supabase
        //    staan worden behouden + gepusht naar Supabase.
        //  - als Supabase leeg is voor een BV, behouden we lokale state.
        try {
          const [entities2025, entities2026] = await Promise.all([
            fetchOhwEntities('2025'),
            fetchOhwEntities('2026'),
          ])
          console.info(`[useOhwStore] loaded ohw_entities: 2025=${entities2025.length}, 2026=${entities2026.length}`)

          const state = get()
          // Start vanuit huidige (= localStorage-gehydrateerde) state zodat
          // we geen edits kwijtraken.
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

          // Bevat een entity zinnige data (rijen met values, IC, remarks)?
          const hasEntityData = (e: OhwEntityData): boolean => {
            const anyValue = (vals: Record<string, number | null>) =>
              Object.values(vals ?? {}).some(v => v != null && v !== 0)
            return (
              e.onderhanden.some(s => s.rows.some(r =>
                anyValue(r.values) ||
                (r.remarks && Object.keys(r.remarks).length > 0) ||
                !!r.contactPerson
              )) ||
              (e.icVerrekening ?? []).some(r => anyValue(r.values)) ||
              (e.vooruitgefactureerd ?? []).some(r => anyValue(r.values))
            )
          }

          // Per entity: DB-versie wint, anders lokale versie behouden,
          // anders default. Push lokaal-only entities naar Supabase.
          const mergeYear = async (
            year: '2025' | '2026',
            dbEntities: OhwEntityData[],
            localData: OhwYearData,
          ): Promise<OhwYearData> => {
            const dbByName = new Map(dbEntities.map(e => [e.entity, e]))
            const merged: OhwEntityData[] = []
            const toPush: OhwEntityData[] = []
            for (const localEnt of localData.entities) {
              const dbEnt = dbByName.get(localEnt.entity)
              if (dbEnt) {
                const stripped = stripTombstones(dbEnt)
                merged.push(recomputeEntity(stripped, localData.allMonths))
              } else if (hasEntityData(localEnt)) {
                merged.push(localEnt)
                toPush.push(localEnt)
              } else {
                merged.push(localEnt) // default seed
              }
            }
            if (toPush.length > 0) {
              console.info(`[useOhwStore] reconcile ${year}: pushing ${toPush.length} local-only entities`)
              await upsertAllOhwEntities(year, toPush)
            }
            // Eerste keer (DB volledig leeg en geen lokale data) → seed
            if (dbEntities.length === 0 && toPush.length === 0) {
              await upsertAllOhwEntities(year, localData.entities)
            }
            return { ...localData, entities: merged }
          }

          d2025 = await mergeYear('2025', entities2025, d2025)
          d2026 = await mergeYear('2026', entities2026, d2026)

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

  removeSection: (year, entityName, sectionId) => {
    // rowHasAnyValue — locked sectie-rijen worden ook als 'gebruikt' gezien
    const isEmpty = (r: OhwRow) => !Object.values(r.values ?? {}).some(
      v => v !== null && v !== undefined && v !== 0,
    )
    let ok = false
    let touched: OhwEntityData | undefined
    const removedIds: string[] = []
    set(state => {
      const key = year === '2025' ? 'data2025' : 'data2026'
      const prev = state[key]
      const entities = prev.entities.map(entity => {
        if (entity.entity !== entityName) return entity
        const section = entity.onderhanden.find(s => s.id === sectionId)
        if (!section) return entity
        // Guard: als er een rij met waarde in staat, weiger
        const hasFilledRow = section.rows.some(r => !isEmpty(r))
        if (hasFilledRow) return entity
        // Alle rij-ids als tombstone zodat ze niet via Supabase-reload terugkomen
        for (const r of section.rows) removedIds.push(r.id)
        const onderhanden = entity.onderhanden.filter(s => s.id !== sectionId)
        const updated = recomputeEntity({ ...entity, onderhanden }, prev.allMonths)
        touched = updated
        ok = true
        return updated
      })
      const nextDeletedIds = [
        ...state.deletedRowIds,
        ...removedIds.filter(id => !state.deletedRowIds.includes(id)),
      ]
      return { [key]: { ...prev, entities }, deletedRowIds: nextDeletedIds }
    })
    if (touched) upsertOhwEntity(year, touched)
    return ok
  },

  pruneEmptyRows: (year, entityName) => {
    // Een rij is leeg als geen enkele cel een niet-null/niet-0 waarde heeft.
    // Manuele context (contactpersoon of cel-remarks) telt als "user wil
    // bewaren" en redt de rij ook al staan er geen getallen in.
    const isEmpty = (r: OhwRow) => {
      const hasValue = Object.values(r.values ?? {}).some(
        v => v !== null && v !== undefined && v !== 0,
      )
      if (hasValue) return false
      if (r.contactPerson && r.contactPerson.trim()) return false
      if (r.remarks && Object.values(r.remarks).some(rk => rk && rk.trim())) return false
      return true
    }
    const removedIds: string[] = []
    const touched: OhwEntityData[] = []

    // Voor IC-pairs: een rij is alleen écht leeg als BEIDE kanten van het
    // pair leeg zijn — anders zou een Projects-rij verdwijnen terwijl de
    // gespiegelde Consultancy-rij wél data heeft. Bouw eerst een set van
    // pair-IDs met data ergens in welk-BV-dan-ook in dit jaar.
    const buildPairsWithData = (yearKey: 'data2025' | 'data2026'): Set<string> => {
      const result = new Set<string>()
      const yearData = get()[yearKey]
      for (const ent of yearData.entities) {
        for (const row of ent.icVerrekening) {
          if (row.icPairId && !isEmpty(row)) result.add(row.icPairId)
        }
      }
      return result
    }
    const pairsWithData = buildPairsWithData(year === '2025' ? 'data2025' : 'data2026')

    set(state => {
      const key = year === '2025' ? 'data2025' : 'data2026'
      const prev = state[key]
      const entities = prev.entities.map(entity => {
        if (entityName && entity.entity !== entityName) return entity
        let changed = false

        // 1) Onderhanden: filter binnen elke section
        const onderhanden = entity.onderhanden.map(sec => {
          const kept = sec.rows.filter(row => {
            if (row.locked) return true             // locked (import-targets) blijft
            if (!isEmpty(row)) return true
            removedIds.push(row.id)
            changed = true
            return false
          })
          return kept.length === sec.rows.length ? sec : { ...sec, rows: kept }
        })

        // 2) icVerrekening: lege rijen weg (paired alleen als beide kanten leeg)
        const icVerrekening = entity.icVerrekening.filter(row => {
          if (!isEmpty(row)) return true
          if (row.icPairId && pairsWithData.has(row.icPairId)) return true
          removedIds.push(row.id)
          changed = true
          return false
        })

        // 3) vooruitgefactureerd: lege rijen weg
        const vooruitgefactureerd = entity.vooruitgefactureerd?.filter(row => {
          if (!isEmpty(row)) return true
          removedIds.push(row.id)
          changed = true
          return false
        })

        if (!changed) return entity
        const updated = recomputeEntity({
          ...entity, onderhanden, icVerrekening, vooruitgefactureerd,
        }, prev.allMonths)
        touched.push(updated)
        return updated
      })
      const nextDeletedIds = [
        ...state.deletedRowIds,
        ...removedIds.filter(id => !state.deletedRowIds.includes(id)),
      ]
      return { [key]: { ...prev, entities }, deletedRowIds: nextDeletedIds }
    })
    for (const e of touched) upsertOhwEntity(year, e)
    return removedIds.length
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
    if (fromBv === toBv) return ''
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
          // Handmatig toegevoegd via UI → editable (alle andere IC-rijen
          // zijn standaard locked).
          manualIc: true,
        }
        const updated = { ...entity, icVerrekening: [...entity.icVerrekening, newRow] }
        const recomputed = recomputeEntity(updated, prev.allMonths)
        touched.push(recomputed)
        return recomputed
      })
      return { [key]: { ...prev, entities } }
    })
    for (const e of touched) upsertOhwEntity(year, e)
    return icPairId
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

  upsertIcFacturatie: (year, receiverBv, month, uploadRows) => {
    // Deterministische pair-id zodat re-uploads bestaande paren updaten ipv
    // duplicaten te maken. Worker-id (uit tarief-tabel) is stabiel; bij
    // unmatched workers vallen we terug op de raw naam.
    const norm = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'x'
    const pairIdFor = (r: IcFacturatieAggregated) =>
      `ic-auto-${norm(r.werknemerId ?? r.werknemerRaw)}-${norm(r.klant)}-${norm(r.fromBv)}-${norm(r.toBv)}`

    // Stats voor caller-rapport
    let addedPairs = 0
    let updatedPairs = 0
    let removedPairs = 0
    const touchedEntities: OhwEntityData[] = []

    set(state => {
      const key = year === '2025' ? 'data2025' : 'data2026'
      const prev = state[key]

      // Stap 1: verzamel alle bestaande auto-pairs in de hele year (we updaten
      // ze indien nog steeds in de upload; anders clearen we maand-waarde).
      const uploadPairIds = new Set<string>()
      for (const r of uploadRows) {
        if (r.fromBv !== receiverBv) continue  // alleen rijen voor déze receiver
        uploadPairIds.add(pairIdFor(r))
      }
      // Vind bestaande pair-ids die GEINITIEERD zijn door een eerdere upload
      // VAN DEZELFDE RECEIVER. Dat doen we door alleen pairs te pakken waar
      // receiverBv de FROM-kant is (icFromBv === receiverBv). Anders zouden
      // mirror-rijen van andere BV's hun uploads (waar receiverBv de TO-kant
      // is) hier verschijnen — en CASE B zou ze ten onrechte clearen omdat
      // ze niet in DEZE upload zitten. Verspringt anders bij een 3e upload.
      const existingPairIds = new Set<string>()
      const receiverEntity = prev.entities.find(e => e.entity === receiverBv)
      if (receiverEntity) {
        for (const row of receiverEntity.icVerrekening) {
          if (row.sourceSlot !== 'ic_facturatie') continue
          if (!row.icPairId) continue
          // Alleen rijen waar deze BV de betaler is — d.w.z. uit een eerdere
          // upload met DEZE BV als receiver. Mirror-rijen uit andere uploads
          // overslaan zodat we ze niet stilletjes verwijderen.
          if (row.icFromBv !== receiverBv) continue
          existingPairIds.add(row.icPairId)
        }
      }

      // Stap 2: bouw lookup van upload-rows per pair-id voor snelle access
      const uploadByPairId: Record<string, IcFacturatieAggregated> = {}
      for (const r of uploadRows) {
        if (r.fromBv !== receiverBv) continue
        uploadByPairId[pairIdFor(r)] = r
      }

      // Stap 3: voor elke pair-id in (upload ∪ existing) → bereken target
      // state per entity-rij. We werken één pair tegelijk af zodat beide
      // kanten consistent blijven.
      type PairAction = {
        pairId: string
        upload?: IcFacturatieAggregated   // undefined = niet meer in upload
      }
      const allPairIds = new Set([...uploadPairIds, ...existingPairIds])
      const actions: PairAction[] = [...allPairIds].map(pairId => ({
        pairId, upload: uploadByPairId[pairId],
      }))

      // Stap 4: muteer de entities
      const entitiesById: Record<string, OhwEntityData> = {}
      for (const e of prev.entities) entitiesById[e.entity] = e

      /** Zorg dat er een rij met deze pairId+side bestaat in entityBv;
       *  retourneert {row, created}. Muteert entitiesById in-place. */
      const ensureRow = (
        entityBv: string,
        pairId: string,
        side: 'from' | 'to',
        upload: IcFacturatieAggregated,
      ): { row: OhwRow; created: boolean } => {
        const ent = entitiesById[entityBv]
        const existing = ent.icVerrekening.find(r => r.icPairId === pairId && r.id.endsWith(`-${side}`))
        if (existing) return { row: existing, created: false }
        const newRow: OhwRow = {
          id: `${pairId}-${side}`,
          // "Werknemer — Klant" — van→naar wordt visueel getoond via icFromBv/icToBv badges
          description: `${upload.werknemer} — ${upload.klant}`,
          values: {},
          locked: true,
          sourceSlot: 'ic_facturatie',
          icPairId: pairId,
          icFromBv: upload.fromBv,
          icToBv: upload.toBv,
        }
        entitiesById[entityBv] = { ...ent, icVerrekening: [...ent.icVerrekening, newRow] }
        return { row: newRow, created: true }
      }

      /** Zet de maand-waarde op een bestaande rij (in entitiesById). */
      const setRowMonth = (entityBv: string, rowId: string, value: number) => {
        const ent = entitiesById[entityBv]
        entitiesById[entityBv] = {
          ...ent,
          icVerrekening: ent.icVerrekening.map(r =>
            r.id === rowId ? { ...r, values: { ...r.values, [month]: value } } : r,
          ),
        }
      }

      for (const action of actions) {
        const upload = action.upload

        if (upload) {
          // CASE A: pair zit in upload → ensure + zet maand-waarde.
          //
          // Sign-conventie (per user-feedback): het bestand toont WAT DEZE BV
          // moet betalen aan de andere BV. Dat is een KOST voor de BV-van-het-
          // bestand (receiver in onze upload, fromBv genaamd) → NEGATIEF in
          // hun IC verrekening. De andere kant (de provider-BV) ziet hetzelfde
          // bedrag als OPBRENGST → POSITIEF.
          //
          // NB: eerdere implementatie had dit andersom (fromBv +amount, toBv
          // -amount) wat de user als "het staat positief, maar moet negatief"
          // ervaarde. Zie commit-historie voor context.
          if (!entitiesById[upload.fromBv] || !entitiesById[upload.toBv]) continue

          const fromR = ensureRow(upload.fromBv, action.pairId, 'from', upload)
          const toR   = ensureRow(upload.toBv,   action.pairId, 'to',   upload)
          // fromBv (= upload-BV) krijgt het MINTEKEN (kost: zij betalen)
          setRowMonth(upload.fromBv, fromR.row.id, -Math.abs(upload.amount))
          // toBv (= provider-BV) krijgt het PLUSTEKEN (opbrengst: zij ontvangen)
          setRowMonth(upload.toBv,   toR.row.id,   +Math.abs(upload.amount))

          if (fromR.created || toR.created) addedPairs++
          else updatedPairs++
        } else {
          // CASE B: pair was er, niet meer in upload → maand-waarde op 0
          // Als rij na clearen helemaal leeg is → verwijder pair (beide kanten)
          for (const ent of Object.values(entitiesById)) {
            const matchRow = ent.icVerrekening.find(r => r.icPairId === action.pairId)
            if (!matchRow) continue
            const newValues = { ...matchRow.values, [month]: 0 }
            // Heeft de rij nog niet-nul waardes voor andere maanden?
            const hasOther = Object.entries(newValues).some(([, v]) => v !== null && v !== 0)
            if (hasOther) {
              const updatedRow = { ...matchRow, values: newValues }
              entitiesById[ent.entity] = {
                ...ent,
                icVerrekening: ent.icVerrekening.map(r => r.id === matchRow.id ? updatedRow : r),
              }
            } else {
              // Rij is leeg → verwijder
              entitiesById[ent.entity] = {
                ...ent,
                icVerrekening: ent.icVerrekening.filter(r => r.id !== matchRow.id),
              }
            }
          }
          removedPairs++
        }
      }

      // Stap 5: recompute alle aangeraakte entities (totaalIC etc.)
      const nextEntities = prev.entities.map(e => {
        const updated = entitiesById[e.entity] ?? e
        if (updated === e) return e
        const recomputed = recomputeEntity(updated, prev.allMonths)
        touchedEntities.push(recomputed)
        return recomputed
      })

      return { [key]: { ...prev, entities: nextEntities } }
    })

    // Stap 6: push aangeraakte entities naar Supabase
    for (const e of touchedEntities) upsertOhwEntity(year, e)

    return { addedPairs, updatedPairs, removedPairs }
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
        icLockedMigrated: state.icLockedMigrated,
      }) as unknown as OhwStore,
      // Accepteer elke oude versie uit localStorage zonder data te verliezen
      // (fail-safe voor wanneer persist-versies ooit wel opzettelijk bumpen).
      migrate: (persistedState) => persistedState as OhwStore,
      onRehydrateStorage: () => (state) => {
        if (!state) return
        // Eénmalige migratie: alle bestaande IC-verrekeningsrijen krijgen
        // locked=true, behalve rijen die de gebruiker NA deze migratie
        // handmatig toevoegt (die starten zonder locked-flag). Sentinel
        // voorkomt herhaalde migratie bij elke rehydration.
        if (!state.icLockedMigrated) {
          const lockExistingIc = (entity: OhwEntityData): OhwEntityData => ({
            ...entity,
            icVerrekening: entity.icVerrekening.map(r =>
              r.locked ? r : { ...r, locked: true },
            ),
          })
          if (state.data2025?.entities) {
            state.data2025 = {
              ...state.data2025,
              entities: state.data2025.entities.map(lockExistingIc),
            }
          }
          if (state.data2026?.entities) {
            state.data2026 = {
              ...state.data2026,
              entities: state.data2026.entities.map(lockExistingIc),
            }
          }
          state.icLockedMigrated = true
        }

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
