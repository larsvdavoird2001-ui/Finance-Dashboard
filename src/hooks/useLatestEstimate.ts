import { useAdjustedActuals } from './useAdjustedActuals'
import { useBudgetStore, BUDGET_MONTHS_2026 } from '../store/useBudgetStore'
import { useFteStore } from '../store/useFteStore'
import { useHoursStore } from '../store/useHoursStore'
import { monthlyActuals2025, MONTHS_2025_LABELS } from '../data/plData2025'
import type { EntityName } from '../data/plData'
import {
  AGGREGATE_KEYS, DERIVED_KEYS, READONLY_KEYS,
  SUBS_OF, DERIVED_FORMULA,
} from '../lib/plDerive'
import type { BvId } from '../data/types'

const MONTH_CODES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/**
 * Latest Estimate per BV per maand voor de Executive Overview.
 *
 * MIRRORS BudgetsTab één-op-één — zo komen Apr-26 (en alle andere forecast-
 * maanden) op identieke cijfers uit in beide tabs. Hiërarchie per (bv, maand,
 * key):
 *   1. Handmatige LE-override (uit useBudgetStore.leOverrides) → die waarde.
 *   2. Calendar-past maand → werkelijke actual via useAdjustedActuals.getMonthly
 *      (incl. IC-verrekening, accruals, handmatige correctie, mutatie
 *      vooruitgefactureerd, kosten-overrides, breakdowns).
 *   3. Toekomstige maand → forecast = blend(seizoens-2025 × YTD-perfMult,
 *      run-rate van laatste closed-month) × FTE-adj × leave-adj.
 *
 * Voor aggregaat-keys (netto_omzet, directe_kosten, …):
 *   - calendar-past: rechtstreeks getMonthly[key] (zo tellen non-SUBS-velden
 *     zoals IC-verrekening en accruals mee in de actual-aggregaat).
 *   - toekomstig: som van sub-key forecasts (zelfde als BudgetsTab).
 * Voor derived keys (brutomarge, ebitda, ebit): formule recursief.
 *
 * De MaandChecklist-finalize is een puur UI-signaal (audit-trail "deze maand
 * is gereviewd") — het beïnvloedt deze LE-berekening NIET. Een calendar-past
 * maand is altijd 'actual', met of zonder finalize.
 */

/** Ramp-up factor voor nieuwe FTE — match BudgetsTab.rampFactor één-op-één. */
function rampFactor(monthsSinceFirstHire: number): number {
  if (monthsSinceFirstHire < 0) return 0
  if (monthsSinceFirstHire === 0) return 0.7
  if (monthsSinceFirstHire === 1) return 0.9
  return 1.0
}

export function useLatestEstimate(currentDate?: Date) {
  const { getMonthly } = useAdjustedActuals()
  const getLeOverride = useBudgetStore(s => s.getLeOverride)
  // Trigger re-render bij overrides / leOverrides wijziging — deze worden
  // niet direct gelezen maar bepalen wel de uitkomst van getLeOverride en
  // BudgetsTab-equivalente paden.
  useBudgetStore(s => s.overrides)
  useBudgetStore(s => s.leOverrides)
  const fteEntries  = useFteStore(s => s.entries)
  const hoursEntries = useHoursStore(s => s.entries)

  const now = currentDate ?? new Date()
  const nowMonthIdx = now.getMonth()
  const nowYear     = now.getFullYear()

  // Calendar-based closedMonths — exact zelfde formule als BudgetsTab. Geen
  // "with-data" of "finalized" check: een maand telt als afgesloten zodra hij
  // kalender-historisch is. Half-gevulde maanden tellen óók als actual; de
  // user is dan zelf verantwoordelijk voor het invullen via de Maandafsluiting.
  const closedMonthsCount =
    nowYear > 2026 ? 12 :
    nowYear < 2026 ? 0  :
    nowMonthIdx
  const closedMonths = BUDGET_MONTHS_2026.slice(0, closedMonthsCount)
  const isCalendarPast = (month: string): boolean => {
    const [mmm, yy] = month.split('-')
    const y = 2000 + Number(yy)
    const mi = MONTH_CODES.indexOf(mmm)
    if (y < nowYear) return true
    if (y > nowYear) return false
    return mi < nowMonthIdx
  }
  const lastClosedMonth: string | null = closedMonths.length > 0
    ? closedMonths[closedMonths.length - 1]
    : null

  /** "Calendar-past mét zinvolle data". Gebruikt voor de chart-actuals-lijn
   *  (anders zou een nog-niet-ingevulde Mar 0 op de actuals-lijn tekenen)
   *  en voor het terugschakelen naar forecast in zo'n lege maand. Een
   *  maand zonder data telt voor het chart-doel als "nog niet actual" — de
   *  LE-forecast pakt 'm dan op. */
  const isClosedWithData = (bv: EntityName, month: string): boolean => {
    if (!isCalendarPast(month)) return false
    const m = getMonthly(bv as BvId, month)
    if (!m) return false
    return (m['netto_omzet'] ?? 0) !== 0 || (m['gefactureerde_omzet'] ?? 0) !== 0 ||
           (m['directe_kosten'] ?? 0) !== 0 || (m['operationele_kosten'] ?? 0) !== 0
  }

  const toPY = (m: string): string => {
    const idx = BUDGET_MONTHS_2026.indexOf(m)
    return idx >= 0 ? MONTHS_2025_LABELS[idx] : m.replace('-26', '-25')
  }

  /** Werkelijke 2026-waarde voor (bv, maand, key) — incl. Maandafsluiting. */
  const rawActual2026 = (bv: EntityName, month: string, key: string): number =>
    getMonthly(bv as BvId, month)[key] ?? 0
  const rawActual2025 = (bv: EntityName, m25: string, key: string): number =>
    monthlyActuals2025[bv]?.[m25]?.[key] ?? 0

  /** FTE-getter zonder forward-fill. */
  const getFteFor = (bv: BvId, month: string): number =>
    fteEntries.find(e => e.bv === bv && e.month === month)?.fte ?? 0

  /** Geplande FTE voor toekomstige maand: meest recente ingevulde FTE binnen
   *  het venster (laatst-actueel, target]. Zelfde model als BudgetsTab. */
  const getPlannedFteInfo = (bv: EntityName, target: string, lastActual: string | null) => {
    const tIdx = BUDGET_MONTHS_2026.indexOf(target)
    const cIdx = lastActual ? BUDGET_MONTHS_2026.indexOf(lastActual) : -1
    const fteLast = lastActual && bv !== 'Holdings' ? getFteFor(bv as BvId, lastActual) : 0
    let firstChangeIdx = -1
    let plannedFte = fteLast
    for (let i = cIdx + 1; i <= tIdx && i >= 0; i++) {
      const f = bv !== 'Holdings' ? getFteFor(bv as BvId, BUDGET_MONTHS_2026[i]) : 0
      if (f > 0) {
        plannedFte = f
        if (firstChangeIdx < 0 && f !== fteLast) firstChangeIdx = i
      }
    }
    return { fte: plannedFte, firstIdx: firstChangeIdx, fteLast }
  }

  /** Geplande verlof (vakantie) uit useHoursStore voor (bv, maand). */
  const getPlannedVakantie = (bv: BvId, month: string): number =>
    hoursEntries.find(e => e.bv === bv && e.month === month)?.vakantie ?? 0

  /** Forecast voor één sub-key in een open maand — exact dezelfde formule
   *  als BudgetsTab.getForecastFor:
   *    seasonalForecast = 2025-zelfde-maand × perfMult × fteAdj × leaveAdj
   *    runRateForecast  = lastActual × fteAdj × leaveAdj
   *    final            = 0.6 × seasonal + 0.4 × runRate
   *  Met:
   *    perfMult  = YTD-2026 / YTD-2025 over closedMonths (calendar-based)
   *    fteAdj    = (fteLast + fteDelta × ramp) / fteLast — voor groei/krimp
   *    leaveAdj  = 1 − min(plannedVakantie / avgWork, 0.5) — alleen op
   *                 omzet-keys; dempt impact van zomerverlof.
   *  closedMonths/lastClosedMonth zijn calendar-based en GELIJK voor alle
   *  BVs — zo komt Apr-LE in beide tabs op exact hetzelfde bedrag uit. */
  const forecastSub = (bv: EntityName, month: string, key: string): number => {
    const sameMonth2025 = rawActual2025(bv, toPY(month), key)
    let ytd2026 = 0, ytd2025 = 0
    for (const cm of closedMonths) {
      ytd2026 += rawActual2026(bv, cm, key)
      ytd2025 += rawActual2025(bv, toPY(cm), key)
    }
    const perfMult = ytd2025 !== 0 ? ytd2026 / ytd2025 : 1
    const lastActual = lastClosedMonth ? rawActual2026(bv, lastClosedMonth, key) : 0

    let fteAdj = 1
    if (bv !== 'Holdings' && lastClosedMonth) {
      const planned = getPlannedFteInfo(bv, month, lastClosedMonth)
      if (planned.fteLast > 0) {
        const fteDelta = planned.fte - planned.fteLast
        if (fteDelta <= 0) {
          fteAdj = planned.fte / planned.fteLast
        } else {
          const tIdx = BUDGET_MONTHS_2026.indexOf(month)
          const monthsSinceHire = planned.firstIdx >= 0 ? tIdx - planned.firstIdx : 0
          const ramp = rampFactor(monthsSinceHire)
          const effectiveFte = planned.fteLast + fteDelta * ramp
          fteAdj = effectiveFte / planned.fteLast
        }
      }
    }

    let leaveAdj = 1
    const isRevenueKey = key === 'netto_omzet' || key === 'gefactureerde_omzet'
    if (bv !== 'Holdings' && closedMonths.length > 0 && isRevenueKey) {
      const plannedVakantie = getPlannedVakantie(bv as BvId, month)
      if (plannedVakantie > 0) {
        let baselineWork = 0, baselineCount = 0
        for (const cm of closedMonths) {
          const he = hoursEntries.find(e => e.bv === bv && e.month === cm)
          if (he) {
            baselineWork += he.declarable + he.internal
            baselineCount++
          }
        }
        const avgWork = baselineCount > 0 ? baselineWork / baselineCount : 0
        if (avgWork > 0) {
          const leaveRatio = Math.min(plannedVakantie / avgWork, 0.5)
          leaveAdj = 1 - leaveRatio
        }
      }
    }

    const combinedAdj = fteAdj * leaveAdj
    const seasonalForecast = sameMonth2025 * perfMult * combinedAdj
    const runRateForecast  = lastActual * combinedAdj

    if (seasonalForecast === 0 && runRateForecast === 0) return 0
    if (seasonalForecast === 0) return Math.round(runRateForecast)
    if (runRateForecast === 0)  return Math.round(seasonalForecast)
    return Math.round(0.6 * seasonalForecast + 0.4 * runRateForecast)
  }

  /** Sub-key LE — exact zelfde paden als BudgetsTab.rawLeVal:
   *    leOverride → calendar-past actual (mét data) → forecast.
   *  Half-gevulde calendar-past maand zónder data valt terug op de
   *  forecast — zodat een nog niet ingevulde Mar geen 0 op de chart
   *  toont maar een zinnige LE. */
  const rawLE = (bv: EntityName, month: string, key: string): number => {
    const ov = getLeOverride(bv, month, key)
    if (ov != null) return ov
    if (isClosedWithData(bv, month)) return rawActual2026(bv, month, key)
    return forecastSub(bv, month, key)
  }

  /** Centrale LE-getter — gebruikt isClosedWithData voor de "actual"-tak
   *  zodat half-gevulde maanden niet onterecht als 0 worden gerapporteerd.
   *  Voor volledig ingevulde maanden gelijk aan BudgetsTab.getLeVal. */
  const getLE = (bv: EntityName, month: string, key: string): number => {
    if (isClosedWithData(bv, month) && (AGGREGATE_KEYS.has(key) || DERIVED_KEYS.has(key))) {
      const ov = getLeOverride(bv, month, key)
      if (ov != null) return ov
      return rawActual2026(bv, month, key)
    }
    if (AGGREGATE_KEYS.has(key)) {
      return SUBS_OF[key].reduce((s, sk) => s + rawLE(bv, month, sk), 0)
    }
    if (DERIVED_KEYS.has(key)) {
      return DERIVED_FORMULA[key](sk => getLE(bv, month, sk))
    }
    return rawLE(bv, month, key)
  }

  type LeSource = 'override' | 'actual' | 'forecast' | 'derived'
  const getLeSource = (bv: EntityName, month: string, key: string): LeSource => {
    if (READONLY_KEYS.has(key)) return 'derived'
    if (getLeOverride(bv, month, key) != null) return 'override'
    // Calendar-past + data aanwezig → actual op de chart-lijn. Een lege
    // calendar-past maand telt als forecast (LE-lijn pakt 'm op).
    if (isClosedWithData(bv, month)) return 'actual'
    return 'forecast'
  }

  const sumLE = (bv: EntityName, months: string[], key: string): number =>
    months.reduce((s, m) => s + getLE(bv, m, key), 0)

  const fyLE = (bv: EntityName, key: string): number =>
    sumLE(bv, BUDGET_MONTHS_2026, key)

  // Voor charts: hasLE blijft true (LE is altijd beschikbaar via forecast).
  const hasLE: (bv: EntityName, month: string, key: string) => boolean = () => true

  // Backwards-compat: oudere callers gebruiken nog isClosed (calendar-only).
  const isClosed = isCalendarPast
  // isActualMonth: calendar-past mét data — zelfde als getLeSource→'actual'.
  const isActualMonth: (bv: EntityName, month: string) => boolean = (bv, month) =>
    isClosedWithData(bv, month)

  return { getLE, sumLE, fyLE, isClosed, getLeSource, hasLE, isActualMonth }
}
