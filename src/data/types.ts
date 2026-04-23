export interface OhwRow {
  id: string
  responsible?: string
  description: string
  values: Record<string, number | null>
  remark?: string
  /** Niet-verwijderbaar/niet-aanpasbaar — rij wordt gevuld vanuit import */
  locked?: boolean
  /** Welke import-slot vult deze rij (bijv. 'uren_lijst', 'd_lijst', 'ohw') */
  sourceSlot?: string
  /** Per-cel toelichtingen — voor zowel handmatige override-redenen op
   *  locked-rijen als vrije Excel-style comments op editable cellen.
   *  Key = maand (bv. 'Mar-26'), value = tekst ingevoerd door user. */
  remarks?: Record<string, string>
  /** Vrij in te vullen contactpersoon bij deze rij (wie weet meer / bij
   *  wie je terecht kunt voor context). Getoond als extra kolom in de
   *  OHW Overzicht naast de omschrijving. */
  contactPerson?: string
  /** IC-pair link: gedeeld tussen de twee gekoppelde rijen (één per BV).
   *  Wijzigingen aan de ene rij worden automatisch gespiegeld naar de
   *  rij met dezelfde icPairId in de andere BV (met omgekeerd teken). */
  icPairId?: string
  /** BV die betaalt (ziet de waarde met minteken). Alleen gezet op IC-pair rijen. */
  icFromBv?: 'Consultancy' | 'Projects' | 'Software'
  /** BV die ontvangt (ziet de waarde met plusteken). Alleen gezet op IC-pair rijen. */
  icToBv?: 'Consultancy' | 'Projects' | 'Software'
}

export interface OhwSection {
  id: string
  title: string
  rows: OhwRow[]
}

export interface OhwEntityData {
  entity: string
  label: string
  onderhanden: OhwSection[]
  totaalOnderhanden: Record<string, number | null>
  debiteuren: Record<string, number | null>
  factuurvolume: Record<string, number | null>
  mutatieOhw: Record<string, number | null>
  nettoOmzetVoorIC: Record<string, number | null>
  icVerrekening: OhwRow[]
  totaalIC: Record<string, number | null>
  nettoOmzet: Record<string, number | null>
  budget: Record<string, number | null>
  delta: Record<string, number | null>
  vooruitgefactureerd?: OhwRow[]
  totaalVooruitgefactureerd?: Record<string, number | null>
  mutatieVooruitgefactureerd?: Record<string, number | null>
}

export interface OhwYearData {
  allMonths: string[]
  displayMonths: string[]
  openingMonth: string
  entities: OhwEntityData[]
}

export type TabId = 'dashboard' | 'hours' | 'financials' | 'ohw' | 'budget' | 'budgets' | 'maand'

export type BvId = 'Consultancy' | 'Projects' | 'Software'

export interface HoursRecord {
  bv: BvId
  month: string
  written: number
  declarable: number
  nonDeclarable: number
  capacity: number
  type: 'actual' | 'current' | 'forecast'
}

export interface ImportRecord {
  id: string
  slotId: string
  slotLabel: string
  month: string
  fileName: string
  uploadedAt: string
  perBv: Record<string, number>
  totalAmount: number
  rowCount: number
  parsedCount: number
  skippedCount: number
  detectedAmountCol: string
  detectedBvCol: string
  headers: string[]
  preview: Record<string, unknown>[]
  status: 'pending' | 'approved' | 'rejected'
  rejectionReason?: string
  /** Diagnostiek vanuit de parser — getoond in de goedkeur-modal */
  warnings?: string[]
}

export interface ClosingEntry {
  id: string
  bv: BvId
  month: string
  factuurvolume: number
  debiteuren: number
  ohwMutatie: number
  kostencorrectie: number
  accruals: number
  handmatigeCorrectie: number
  operationeleKosten: number
  amortisatieAfschrijvingen: number
  /** Per-regel overrides voor directe/operationele kosten en amortisatie.
   *  Key = PL-sleutel (bijv. 'directe_inkoopkosten'), value = positief getal. */
  kostenOverrides: Record<string, number>
  remark: string
}

export interface TariffEntry {
  id: string         // werknemer ID (bijv. "10299")
  bedrijf: string    // BV naam (Projects, Consultancy, Software, Spanje)
  naam: string
  powerbiNaam: string
  stroming: string
  tarief: number     // uurtarief
  fte: number | null
  functie: string
  leidingGevende: string
  manager: string
  powerbiNaam2: string
  team: string
}

export interface GlobalFilter {
  year: '2025' | '2026' | 'all'
  bv: BvId | 'all'
}

export interface FteEntry {
  id: string
  bv: BvId
  month: string
  fte: number        // fulltime equivalent (decimaal, bijv. 12.4)
  headcount: number  // aantal personen (integer)
  fteBudget?: number       // begrote FTE voor deze BV/maand (voor variance)
  headcountBudget?: number // begroot aantal personen
}
