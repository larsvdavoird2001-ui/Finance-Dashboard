import { useAdjustedActuals } from './useAdjustedActuals'
import { useBudgetStore, BUDGET_MONTHS_2026 } from '../store/useBudgetStore'
import { monthlyBudget2026 } from '../data/plData'
import { monthlyActuals2025, MONTHS_2025_LABELS } from '../data/plData2025'
import type { EntityName } from '../data/plData'
import { derivePL, SUBS_OF } from '../lib/plDerive'
import type { BvId } from '../data/types'

const MONTH_CODES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Welke aggregaat-groep hoort bij een sub-key? Voor elke sub vinden we
// de aggregaat-key (bv. 'gefactureerde_omzet' → 'netto_omzet').
const GROUP_OF_SUB: Record<string, string> = (() => {
  const out: Record<string, string> = {}
  for (const [agg, subs] of Object.entries(SUBS_OF)) {
    for (const sub of subs) out[sub] = agg
  }
  return out
})()

/**
 * Latest Estimate per BV per maand voor de Executive Overview.
 *
 * Hiërarchie per (bv, maand, key):
 *   1. CLOSED kalender-maand → adjusted actual (LE-override genegeerd).
 *   2. Open maand met handmatige LE-override → die override.
 *   3. Open maand waar de gebruiker (in Budgetten-tab) een budget heeft
 *      ingevuld voor dezelfde aggregaat-groep → budget waarde van die key
 *      (0 als die specifieke sub-key zelf niet ingevuld is, want de gebruiker
 *      heeft die groep onder zijn beheer genomen).
 *   4. Open maand zonder budget-input voor die groep → seizoens-forecast:
 *        2025-zelfde-maand × YTD-2026/YTD-2025 perf, geblend 60/40 met
 *        run-rate van laatst-gesloten maand.
 *
 * Met deze opzet werkt elke budget-edit in Budgetten-tab direct door in de
 * Executive Overview, zonder dat de forecast voor andere keys mee blijft
 * tellen wanneer de gebruiker maar één sub-key heeft ingevuld.
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
    // getMonthly accepteert ClosingBv (incl. Holdings) en incorporeert de
    // Maandafsluiting (FinStore). Voor Holdings was dit eerder een aparte
    // branch die alleen plData las → ingevulde Maandafsluiting werkte niet
    // door in de LE. Nu uniform één pad voor alle BV's.
    return getMonthly(bv as BvId, month)[key] ?? 0
  }
  const rawActual2025 = (bv: EntityName, m25: string, key: string): number =>
    monthlyActuals2025[bv]?.[m25]?.[key] ?? 0

  /** Heeft de gebruiker voor (bv, maand) een budget-override gezet op
   *  een sub-key die in dezelfde aggregaat-groep zit als `key`? Dat is het
   *  signaal dat de gebruiker de groep onder zijn beheer neemt. */
  const groupHasUserBudget = (bv: EntityName, month: string, key: string): boolean => {
    const monthOv = overrides[bv]?.[month]
    if (!monthOv) return false
    // Sub-key zelf? dan is de eigen aanwezigheid voldoende.
    if (Object.prototype.hasOwnProperty.call(monthOv, key)) return true
    // Aggregaat-key? Check of een van zijn subs is gezet.
    if (SUBS_OF[key]) {
      return SUBS_OF[key].some(sub => Object.prototype.hasOwnProperty.call(monthOv, sub))
    }
    // Sub-key (niet zelf gezet): check siblings binnen dezelfde groep.
    const group = GROUP_OF_SUB[key]
    if (!group) return false
    return SUBS_OF[group].some(sub => Object.prototype.hasOwnProperty.call(monthOv, sub))
  }

  /** Heeft plData een budget-source voor (bv, maand)? Jan/Feb-26 is gevuld,
   *  Mar-Dec is leeg in monthlyBudget2026. */
  const hasPlDataBudget = (bv: EntityName, month: string): boolean => {
    const src = monthlyBudget2026[bv]?.[month]
    return !!src && Object.keys(src).length > 0
  }

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
    if (groupHasUserBudget(bv, month, key)) return 'budget'
    if (hasPlDataBudget(bv, month)) return 'budget'
    return 'forecast'
  }

  const rawLE = (bv: EntityName, month: string, key: string): number => {
    if (isClosed(month)) return rawActual2026(bv, month, key)
    const ov = getLeOverride(bv, month, key)
    if (ov != null) return ov
    // Gebruiker heeft de aggregaat-groep "geclaimd" door iets in te vullen?
    // → gebruik exact wat in het budget staat (0 voor unfilled subs).
    if (groupHasUserBudget(bv, month, key)) {
      return getBudgetMonth(bv, month)[key] ?? 0
    }
    // Geen user-input maar wel plData-source (Jan/Feb-26)?
    if (hasPlDataBudget(bv, month)) {
      return getBudgetMonth(bv, month)[key] ?? 0
    }
    // Fallback: seizoens-forecast
    return forecastUnclosed(bv, month, key)
  }

  const getLE = (bv: EntityName, month: string, key: string): number =>
    derivePL(k => rawLE(bv, month, k), key)

  const sumLE = (bv: EntityName, months: string[], key: string): number =>
    months.reduce((s, m) => s + getLE(bv, m, key), 0)

  const fyLE = (bv: EntityName, key: string): number =>
    sumLE(bv, BUDGET_MONTHS_2026, key)

  const hasLE = (_bv: EntityName, _month: string, _key: string): boolean => true

  return { getLE, sumLE, fyLE, isClosed, getLeSource, hasLE }
}
