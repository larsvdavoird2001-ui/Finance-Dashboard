import { useAdjustedActuals } from './useAdjustedActuals'
import { useBudgetStore, BUDGET_MONTHS_2026 } from '../store/useBudgetStore'
import { monthlyActuals2026 } from '../data/plData'
import { monthlyActuals2025, MONTHS_2025_LABELS } from '../data/plData2025'
import type { EntityName } from '../data/plData'
import { derivePL } from '../lib/plDerive'
import type { BvId } from '../data/types'

const MONTH_CODES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/**
 * Latest Estimate per BV per maand voor de Executive Overview.
 *
 * Hiërarchie per (bv, maand, key):
 *   1. CLOSED kalender-maand → adjusted actual.  ALTIJD. Een LE-override
 *      wordt voor closed maanden genegeerd — actual is feit.
 *   2. Open maand met handmatige LE-override (Budgetten-tab) → die override.
 *   3. Open maand met ingevuld budget (store-override of plData Jan/Feb
 *      defaults) → budget waarde.
 *   4. Open maand zonder budget → seizoens-projectie:
 *        2025-zelfde-maand × (YTD-2026 / YTD-2025 performance ratio)
 *        geblend 60/40 met run-rate van laatst-gesloten 2026-maand.
 *      Dit pakt info die we al hebben (vorig jaar + Q1 dit jaar) en geeft
 *      een redelijke LE zonder dat de gebruiker eerst overal budget hoeft
 *      in te vullen.
 *
 * Reactief: zodra een budget of LE-override in Budgetten-tab wordt aangepast
 * werkt het direct door in de Executive Overview (gedeelde zustand store).
 */
export function useLatestEstimate(currentDate?: Date) {
  const { getMonthly } = useAdjustedActuals()
  const getLeOverride = useBudgetStore(s => s.getLeOverride)
  const getBudgetMonth = useBudgetStore(s => s.getMonth)
  const overrides = useBudgetStore(s => s.overrides)
  // Trigger re-render bij leOverrides wijziging
  useBudgetStore(s => s.leOverrides)

  const now = currentDate ?? new Date()
  const nowMonthIdx = now.getMonth()
  const nowYear     = now.getFullYear()

  const isClosed = (month: string): boolean => {
    const [mmm, yy] = month.split('-')
    const y = 2000 + Number(yy)
    const mi = MONTH_CODES.indexOf(mmm)
    if (y < nowYear) return true
    if (y > nowYear) return false
    return mi < nowMonthIdx
  }

  const closedMonths2026 = BUDGET_MONTHS_2026.filter(isClosed)
  const lastClosed2026   = closedMonths2026[closedMonths2026.length - 1] ?? null

  const toPY = (m: string): string => {
    const idx = BUDGET_MONTHS_2026.indexOf(m)
    return idx >= 0 ? MONTHS_2025_LABELS[idx] : m.replace('-26', '-25')
  }

  const rawActual2026 = (bv: EntityName, month: string, key: string): number => {
    if (bv === 'Holdings') return monthlyActuals2026['Holdings']?.[month]?.[key] ?? 0
    return getMonthly(bv as BvId, month)[key] ?? 0
  }
  const rawActual2025 = (bv: EntityName, m25: string, key: string): number =>
    monthlyActuals2025[bv]?.[m25]?.[key] ?? 0

  /** Heeft Budgetten-store een waarde voor (bv, maand, key)? */
  const hasExplicitBudget = (bv: EntityName, month: string, key: string): boolean => {
    const ov = overrides[bv]?.[month]?.[key]
    if (ov !== undefined) return true
    const monthData = getBudgetMonth(bv, month)
    return Object.prototype.hasOwnProperty.call(monthData, key)
  }

  /** Forecast voor een open maand zonder ingevuld budget. */
  const forecastUnclosed = (bv: EntityName, month: string, key: string): number => {
    const sameMonth2025 = rawActual2025(bv, toPY(month), key)
    let ytd2026 = 0, ytd2025 = 0
    for (const cm of closedMonths2026) {
      ytd2026 += rawActual2026(bv, cm, key)
      ytd2025 += rawActual2025(bv, toPY(cm), key)
    }
    const perfMult = ytd2025 !== 0 ? ytd2026 / ytd2025 : 1
    const lastActual = lastClosed2026 ? rawActual2026(bv, lastClosed2026, key) : 0

    const seasonalForecast = sameMonth2025 * perfMult
    const runRateForecast  = lastActual

    if (seasonalForecast === 0 && runRateForecast === 0) return 0
    if (seasonalForecast === 0) return Math.round(runRateForecast)
    if (runRateForecast === 0)  return Math.round(seasonalForecast)
    return Math.round(0.6 * seasonalForecast + 0.4 * runRateForecast)
  }

  type LeSource = 'override' | 'actual' | 'budget' | 'forecast'
  const getLeSource = (bv: EntityName, month: string, key: string): LeSource => {
    if (isClosed(month)) return 'actual'
    if (getLeOverride(bv, month, key) != null) return 'override'
    if (hasExplicitBudget(bv, month, key)) return 'budget'
    return 'forecast'
  }

  const rawLE = (bv: EntityName, month: string, key: string): number => {
    if (isClosed(month)) return rawActual2026(bv, month, key)
    const ov = getLeOverride(bv, month, key)
    if (ov != null) return ov
    if (hasExplicitBudget(bv, month, key)) {
      return getBudgetMonth(bv, month)[key] ?? 0
    }
    return forecastUnclosed(bv, month, key)
  }

  const getLE = (bv: EntityName, month: string, key: string): number =>
    derivePL(k => rawLE(bv, month, k), key)

  const sumLE = (bv: EntityName, months: string[], key: string): number =>
    months.reduce((s, m) => s + getLE(bv, m, key), 0)

  const fyLE = (bv: EntityName, key: string): number =>
    sumLE(bv, BUDGET_MONTHS_2026, key)

  /** Voor charts: is er voor (bv, maand, key) ENIGE bron? Forecast-only telt
   *  óók als bron, want we willen de LE-lijn zien lopen. */
  const hasLE = (_bv: EntityName, _month: string, _key: string): boolean => true

  return { getLE, sumLE, fyLE, isClosed, getLeSource, hasLE }
}
