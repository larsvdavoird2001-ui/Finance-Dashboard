// plData2025.ts — maandelijkse FY2025 P&L actuals + budget
//
// HISTORIE: Tot 2026-05-18 werden de actuals afgeleid uit ytdActuals2025 met
// een seasonal-weighted schatting. Vanaf 2026-05-19 worden de actuals
// rechtstreeks uit de maandafsluiting-Excel bestanden gelezen (zie
// MAANDAFSLUITING_PL — script: scripts/extract-maandafsluiting-full.mjs).
// Het budget blijft seasonal-weighted (we hebben geen per-maand budget bron).

import { ytdBudget2025 } from './plData'
import type { EntityName } from './plData'
import { MAANDAFSLUITING_PL, plToMonthlyActuals } from './maandafsluitingPL'

export const MONTHS_2025_LABELS = [
  'Jan-25','Feb-25','Mar-25','Apr-25','May-25','Jun-25',
  'Jul-25','Aug-25','Sep-25','Oct-25','Nov-25','Dec-25',
]

// ── Budget: seasonal-weighted derivation (geen per-maand bron beschikbaar) ──
const SEASONAL_WEIGHTS: Record<string, number> = {
  'Jan-25': 0.92, 'Feb-25': 0.90, 'Mar-25': 1.02, 'Apr-25': 1.00,
  'May-25': 1.05, 'Jun-25': 1.05, 'Jul-25': 0.72, 'Aug-25': 0.68,
  'Sep-25': 1.08, 'Oct-25': 1.06, 'Nov-25': 1.05, 'Dec-25': 0.87,
}
const weightSum = Object.values(SEASONAL_WEIGHTS).reduce((a, v) => a + v, 0)
const NORM_WEIGHTS: Record<string, number> = Object.fromEntries(
  Object.entries(SEASONAL_WEIGHTS).map(([k, v]) => [k, v * 12 / weightSum]),
)
const FLAT_KEYS = new Set([
  'directe_kosten', 'directe_inkoopkosten', 'directe_personeelskosten',
  'directe_overige_personeelskosten', 'directe_autokosten',
  'operationele_kosten', 'indirecte_personeelskosten', 'overige_personeelskosten',
  'huisvestingskosten', 'automatiseringskosten', 'indirecte_autokosten',
  'verkoopkosten', 'algemene_kosten', 'doorbelaste_kosten',
  'amortisatie_afschrijvingen', 'amortisatie_goodwill', 'amortisatie_software', 'afschrijvingen',
  'financieel_resultaat', 'vennootschapsbelasting',
])
const weightFor = (key: string, month: string): number =>
  FLAT_KEYS.has(key) ? 1 / 12 : NORM_WEIGHTS[month] / 12

function deriveBudgetMonthly(entity: EntityName): Record<string, Record<string, number>> {
  const annual = ytdBudget2025[entity]
  if (!annual) return {}
  const result: Record<string, Record<string, number>> = {}
  for (const month of MONTHS_2025_LABELS) {
    const monthData: Record<string, number> = {}
    for (const [key, val] of Object.entries(annual)) {
      monthData[key] = Math.round(val * weightFor(key, month))
    }
    result[month] = monthData
  }
  return result
}

// ── Actuals: rechtstreeks uit maandafsluiting-Excel ──────────────────────────
function buildActualsFromExcel(entity: EntityName): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {}
  for (const month of MONTHS_2025_LABELS) {
    const pl = MAANDAFSLUITING_PL.find(p => p.month === month && p.bv === entity)
    if (pl) {
      result[month] = plToMonthlyActuals(pl)
    } else {
      // Geen Excel data voor deze (BV, maand) → lege maand
      result[month] = {}
    }
  }
  return result
}

export const monthlyActuals2025: Record<EntityName, Record<string, Record<string, number>>> = {
  Consultancy: buildActualsFromExcel('Consultancy'),
  Projects:    buildActualsFromExcel('Projects'),
  Software:    buildActualsFromExcel('Software'),
  Holdings:    buildActualsFromExcel('Holdings'),
}

export const monthlyBudget2025: Record<EntityName, Record<string, Record<string, number>>> = {
  Consultancy: deriveBudgetMonthly('Consultancy'),
  Projects:    deriveBudgetMonthly('Projects'),
  Software:    deriveBudgetMonthly('Software'),
  Holdings:    deriveBudgetMonthly('Holdings'),
}
