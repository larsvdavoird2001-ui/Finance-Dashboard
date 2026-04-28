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
 * Hiërarchie per maand/sleutel:
 *   1. LE-override uit Budgetten-tab (handmatig gezet door user) — wint altijd.
 *   2. Closed kalender-maand → adjusted actuals (Holdings: uit plData; rest:
 *      uit useAdjustedActuals).
 *   3. Open maand met budget in store/plData → budget waarde.
 *   4. Open maand zonder budget → forecast op basis van seizoenspatroon 2025
 *      × YTD-2026-vs-YTD-2025 performance multiplier, geblend met run-rate van
 *      laatst gesloten maand. Hierdoor staat er nooit 0 voor toekomst-maanden
 *      terwijl we ook geen handmatig budget vereisen.
 *
 * Voor de gedetailleerdere forecast (FTE-ramp / verlof-correctie) zie
 * BudgetsTab — die heeft toegang tot uren-/FTE-stores. Deze hook geeft een
 * solide CFO-niveau projectie zonder die complexiteit.
 */
export function useLatestEstimate(currentDate?: Date) {
  const { getMonthly } = useAdjustedActuals()
  const getLeOverride = useBudgetStore(s => s.getLeOverride)
  const getBudgetMonth = useBudgetStore(s => s.getMonth)

  const now = currentDate ?? new Date()
  const nowMonthIdx = now.getMonth()
  const nowYear     = now.getFullYear()

  /** Is deze maand kalender-afgesloten? */
  const isClosed = (month: string): boolean => {
    const [mmm, yy] = month.split('-')
    const y = 2000 + Number(yy)
    const mi = MONTH_CODES.indexOf(mmm)
    if (y < nowYear) return true
    if (y > nowYear) return false
    return mi < nowMonthIdx
  }

  /** Lijst gesloten maanden in 2026 (Jan-26 t/m laatst-gesloten). */
  const closedMonths2026 = BUDGET_MONTHS_2026.filter(isClosed)
  const lastClosed2026 = closedMonths2026[closedMonths2026.length - 1] ?? null

  /** Map een 2026-maand naar dezelfde maand in 2025 (Apr-26 → Apr-25). */
  const toPY = (m: string): string => {
    const idx = BUDGET_MONTHS_2026.indexOf(m)
    return idx >= 0 ? MONTHS_2025_LABELS[idx] : m.replace('-26', '-25')
  }

  /** Raw actual lookup zonder budget-fallback (voor closed/forecast paden). */
  const rawActual2026 = (bv: EntityName, month: string, key: string): number => {
    if (bv === 'Holdings') return monthlyActuals2026['Holdings']?.[month]?.[key] ?? 0
    return getMonthly(bv as BvId, month)[key] ?? 0
  }
  const rawActual2025 = (bv: EntityName, month25: string, key: string): number =>
    monthlyActuals2025[bv]?.[month25]?.[key] ?? 0

  /** Heeft de Budgetten-store een waarde voor deze (bv, maand)? */
  const hasBudgetSource = (bv: EntityName, month: string): boolean => {
    const data = getBudgetMonth(bv, month)
    return Object.keys(data).length > 0
  }

  /** Forecast voor een open maand zonder gevuld budget. Blend van:
   *   - Seizoens-projectie: 2025-zelfde-maand × (YTD-2026 / YTD-2025)
   *   - Run-rate: laatst gesloten 2026-maand
   *  60/40 blend → vangt zowel groei-trend als momentum. Kosten-keys (negatief
   *  in plData-conventie) blijven hierdoor ook negatief. */
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

  /** Raw waarde voor een sub-key (geen aggregate/derived). */
  const rawLE = (bv: EntityName, month: string, key: string): number => {
    // 1. handmatige LE-override
    const ov = getLeOverride(bv, month, key)
    if (ov != null) return ov
    // 2. closed maand → actual
    if (isClosed(month)) return rawActual2026(bv, month, key)
    // 3. open maand met budget → budget
    if (hasBudgetSource(bv, month)) {
      return getBudgetMonth(bv, month)[key] ?? 0
    }
    // 4. open maand zonder budget → forecast
    return forecastUnclosed(bv, month, key)
  }

  /** Waarde voor om het even welke key (aggregate of derived afgeleid). */
  const getLE = (bv: EntityName, month: string, key: string): number =>
    derivePL(k => rawLE(bv, month, k), key)

  /** Totaal over reeks maanden voor een specifieke key. */
  const sumLE = (bv: EntityName, months: string[], key: string): number =>
    months.reduce((s, m) => s + getLE(bv, m, key), 0)

  /** FY 2026 totaal voor een BV. */
  const fyLE = (bv: EntityName, key: string): number =>
    sumLE(bv, BUDGET_MONTHS_2026, key)

  /** Diagnose: welke bron gebruikt de LE voor (bv, maand, key)? */
  const getLeSource = (bv: EntityName, month: string, key: string): 'override' | 'actual' | 'budget' | 'forecast' => {
    if (getLeOverride(bv, month, key) != null) return 'override'
    if (isClosed(month)) return 'actual'
    if (hasBudgetSource(bv, month)) return 'budget'
    return 'forecast'
  }

  return { getLE, sumLE, fyLE, isClosed, getLeSource }
}
