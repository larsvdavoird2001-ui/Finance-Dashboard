// plData2025.ts — maandelijkse verdeling van FY2025 P&L actuals
// Afgeleid van ytdActuals2025 (definitief jaarcijfer) met seizoensweging
// Gebruik: visualisatie en vergelijking met 2026. NIET voor formele rapportage.

import { ytdActuals2025, ytdBudget2025 } from './plData'
import type { EntityName } from './plData'

export const MONTHS_2025_LABELS = [
  'Jan-25','Feb-25','Mar-25','Apr-25','May-25','Jun-25',
  'Jul-25','Aug-25','Sep-25','Oct-25','Nov-25','Dec-25',
]

// Seizoensgewichten voor omzet/marge (som = 12)
const SEASONAL_WEIGHTS: Record<string, number> = {
  'Jan-25': 0.92, 'Feb-25': 0.90, 'Mar-25': 1.02, 'Apr-25': 1.00,
  'May-25': 1.05, 'Jun-25': 1.05, 'Jul-25': 0.72, 'Aug-25': 0.68,
  'Sep-25': 1.08, 'Oct-25': 1.06, 'Nov-25': 1.05, 'Dec-25': 0.87,
}

// Gewichten normaliseren zodat som exact = 12
const weightSum = Object.values(SEASONAL_WEIGHTS).reduce((a, v) => a + v, 0)
const NORM_WEIGHTS: Record<string, number> = Object.fromEntries(
  Object.entries(SEASONAL_WEIGHTS).map(([k, v]) => [k, v * 12 / weightSum])
)

// Afleiden van maandelijkse cijfers uit jaardata
function deriveMonthly(entity: EntityName): Record<string, Record<string, number>> {
  const annual = ytdActuals2025[entity]
  if (!annual) return {}
  const result: Record<string, Record<string, number>> = {}
  for (const month of MONTHS_2025_LABELS) {
    const w = NORM_WEIGHTS[month] / 12
    const monthData: Record<string, number> = {}
    for (const [key, val] of Object.entries(annual)) {
      monthData[key] = Math.round(val * w)
    }
    result[month] = monthData
  }
  return result
}

function deriveBudgetMonthly(entity: EntityName): Record<string, Record<string, number>> {
  const annual = ytdBudget2025[entity]
  if (!annual) return {}
  const result: Record<string, Record<string, number>> = {}
  for (const month of MONTHS_2025_LABELS) {
    const w = NORM_WEIGHTS[month] / 12
    const monthData: Record<string, number> = {}
    for (const [key, val] of Object.entries(annual)) {
      monthData[key] = Math.round(val * w)
    }
    result[month] = monthData
  }
  return result
}

export const monthlyActuals2025: Record<EntityName, Record<string, Record<string, number>>> = {
  Consultancy: deriveMonthly('Consultancy'),
  Projects:    deriveMonthly('Projects'),
  Software:    deriveMonthly('Software'),
  Holdings:    deriveMonthly('Holdings'),
}

export const monthlyBudget2025: Record<EntityName, Record<string, Record<string, number>>> = {
  Consultancy: deriveBudgetMonthly('Consultancy'),
  Projects:    deriveBudgetMonthly('Projects'),
  Software:    deriveBudgetMonthly('Software'),
  Holdings:    deriveBudgetMonthly('Holdings'),
}
