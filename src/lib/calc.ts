import type { OhwEntityData } from '../data/types'
import { gv } from './format'

export interface ComputedEntity {
  totaalOnderhanden: Record<string, number>
  mutatieOhw: Record<string, number>
  nettoOmzetVoorIC: Record<string, number>
  totaalIC: Record<string, number>
  nettoOmzet: Record<string, number>
  delta: Record<string, number | null>
  totaalVooruitgefactureerd?: Record<string, number>
  mutatieVooruitgefactureerd?: Record<string, number>
}

export function recomputeEntity(entity: OhwEntityData, allMonths: string[]): OhwEntityData {
  const displayMonths = allMonths.slice(1)
  const openingMonth = allMonths[0]

  // 1. totaalOnderhanden
  const totaalOnderhanden: Record<string, number | null> = {}
  for (const m of allMonths) {
    let sum = 0
    for (const sec of entity.onderhanden) {
      for (const row of sec.rows) {
        sum += gv(row.values, m)
      }
    }
    totaalOnderhanden[m] = sum
  }

  // 2. mutatieOhw
  const mutatieOhw: Record<string, number | null> = {}
  for (let i = 0; i < displayMonths.length; i++) {
    const m = displayMonths[i]
    const prev = i === 0 ? gv(totaalOnderhanden, openingMonth) : gv(totaalOnderhanden, displayMonths[i - 1])
    mutatieOhw[m] = gv(totaalOnderhanden, m) - prev
  }

  // 3. nettoOmzetVoorIC = mutatieOhw (factuurvolume wordt ingevoerd in Maandafsluiting)
  const nettoOmzetVoorIC: Record<string, number | null> = {}
  for (const m of displayMonths) {
    nettoOmzetVoorIC[m] = gv(mutatieOhw, m)
  }

  // 4. totaalIC
  const totaalIC: Record<string, number | null> = {}
  for (const m of displayMonths) {
    let sum = 0
    for (const row of entity.icVerrekening) {
      sum += gv(row.values, m)
    }
    totaalIC[m] = sum
  }

  // 5. nettoOmzet
  const nettoOmzet: Record<string, number | null> = {}
  for (const m of displayMonths) {
    nettoOmzet[m] = gv(nettoOmzetVoorIC, m) + gv(totaalIC, m)
  }

  // 6. delta
  const delta: Record<string, number | null> = {}
  for (const m of displayMonths) {
    const bud = entity.budget[m]
    delta[m] = bud != null ? gv(nettoOmzet, m) - bud : null
  }

  // 7. totaalVooruitgefactureerd + mutatie (Software only)
  let totaalVooruitgefactureerd: Record<string, number | null> | undefined
  let mutatieVooruitgefactureerd: Record<string, number | null> | undefined
  if (entity.vooruitgefactureerd) {
    totaalVooruitgefactureerd = {}
    for (const m of allMonths) {
      let sum = 0
      for (const row of entity.vooruitgefactureerd) sum += gv(row.values, m)
      totaalVooruitgefactureerd[m] = sum
    }
    mutatieVooruitgefactureerd = {}
    for (let i = 0; i < displayMonths.length; i++) {
      const m = displayMonths[i]
      const prev = i === 0 ? gv(totaalVooruitgefactureerd, openingMonth) : gv(totaalVooruitgefactureerd, displayMonths[i - 1])
      mutatieVooruitgefactureerd[m] = gv(totaalVooruitgefactureerd, m) - prev
    }
  }

  return {
    ...entity,
    totaalOnderhanden,
    mutatieOhw,
    nettoOmzetVoorIC,
    totaalIC,
    nettoOmzet,
    delta,
    totaalVooruitgefactureerd,
    mutatieVooruitgefactureerd,
  }
}
