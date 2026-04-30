import { useAdjustedActuals } from './useAdjustedActuals'
import { useBudgetStore, BUDGET_MONTHS_2026 } from '../store/useBudgetStore'
import { useFinStore } from '../store/useFinStore'
import { useFteStore } from '../store/useFteStore'
import { useHoursStore } from '../store/useHoursStore'
import { monthlyActuals2026 } from '../data/plData'
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
 * Hiërarchie per (bv, maand, key):
 *   1. Maand is ACTUAL → werkelijke aggregaat-waarde uit useAdjustedActuals
 *      .getMonthly. Een maand telt als 'actual' wanneer:
 *        - hij definitief is afgesloten via de MaandChecklist, OF
 *        - plData ingebouwde actuals heeft (Jan/Feb-26 — historisch al
 *          afgesloten in code).
 *      Half ingevulde Mar-26 blijft LE tot je hem expliciet afsluit.
 *   2. Open maand met handmatige LE-override → die override.
 *   3. Open maand met expliciet ingevulde key in Budgetten-tab → die waarde.
 *   4. Open maand zonder budget-input → forecast met seizoens-2025 +
 *      run-rate van actual-maanden, gecorrigeerd voor FTE-ramp en
 *      geplande verlof. Identieke logica als de Budgetten-tab gebruikt,
 *      zodat beide tabs dezelfde LE-cijfers tonen.
 *
 * Voor aggregaat-keys (netto_omzet, directe_kosten, …) en derived keys
 * (brutomarge, ebitda, ebit) volgen we Budgetten-tab letterlijk:
 *   - OPEN maand: aggregaat = som van sub-keys (forecast per sub).
 *   - DERIVED key: formule (brutomarge = netto_omzet + directe_kosten).
 *   - CLOSED maand met actual: rechtstreeks getMonthly[key] zodat IC-
 *     verrekening, accruals, handmatige correctie en mutatie vooruit-
 *     gefactureerd meetellen (die zitten niet in SUBS_OF).
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
  const getBudgetMonth = useBudgetStore(s => s.getMonth)
  const overrides = useBudgetStore(s => s.overrides)
  // Trigger re-render bij leOverrides wijziging
  useBudgetStore(s => s.leOverrides)
  const finalized   = useFinStore(s => s.finalized)
  const fteEntries  = useFteStore(s => s.entries)
  const hoursEntries = useHoursStore(s => s.entries)

  const now = currentDate ?? new Date()
  const nowMonthIdx = now.getMonth()
  const nowYear     = now.getFullYear()

  const isCalendarPast = (month: string): boolean => {
    const [mmm, yy] = month.split('-')
    const y = 2000 + Number(yy)
    const mi = MONTH_CODES.indexOf(mmm)
    if (y < nowYear) return true
    if (y > nowYear) return false
    return mi < nowMonthIdx
  }

  /** plData heeft actuals ingebouwd voor deze (bv, maand)? Jan/Feb-26 is
   *  historisch al afgesloten en wordt automatisch behandeld als 'actual'. */
  const hasPlDataActual = (bv: EntityName, month: string): boolean => {
    const src = monthlyActuals2026[bv]?.[month]
    if (!src) return false
    // Substantieve data = ten minste netto_omzet of directe_kosten ingevuld.
    return (src['netto_omzet'] ?? 0) !== 0 || (src['directe_kosten'] ?? 0) !== 0
  }

  /** Is deze maand definitief afgesloten via de MaandChecklist? */
  const isFinalized = (month: string): boolean =>
    finalized.some(f => f.month === month)

  /** "Actual" voor het CHART-DISPLAY (solid actual line vs dashed LE line):
   *  pas wanneer de maand definitief is afgesloten via de MaandChecklist,
   *  óf wanneer plData ingebouwde actuals heeft (Jan/Feb-26). Halfgevulde
   *  Mar-26 blijft op de gestreepte LE-lijn tot finalisatie. */
  const isActualMonth = (bv: EntityName, month: string): boolean => {
    if (isFinalized(month)) return true
    if (hasPlDataActual(bv, month)) return true
    return false
  }

  /** "Calendar-closed met data" — wordt gebruikt door de FORECAST en door
   *  de getLE-aggregaat-paden om Mar's al ingevulde cijfers te gebruiken
   *  als baseline (zodat de Executive Overview LE 1-op-1 matcht met de
   *  Budgetten-tab, die ook calendar-closed maanden meeneemt). LOSGEKOPPELD
   *  van isActualMonth zodat een halfgevulde Mar wél de juiste LE-waarde
   *  toont in trends, maar pas op het solid-actual-line komt na finalisatie. */
  const isClosedWithData = (bv: EntityName, month: string): boolean => {
    if (!isCalendarPast(month)) return false
    // plData-baked → ja
    if (hasPlDataActual(bv, month)) return true
    // FinStore / OHW data ingevuld → ja
    const m = getMonthly(bv as BvId, month)
    if (!m) return false
    return (m['netto_omzet'] ?? 0) !== 0 || (m['gefactureerde_omzet'] ?? 0) !== 0 ||
           (m['directe_kosten'] ?? 0) !== 0 || (m['operationele_kosten'] ?? 0) !== 0
  }

  /** Maanden in 2026 met data — gebruikt voor YTD-baseline van de forecast.
   *  Includeert Mar als die calendar-closed is en data heeft, ook al is hij
   *  nog niet definitief afgesloten. Match Budgetten-tab gedrag. */
  const closedDataMonthsFor = (bv: EntityName): string[] =>
    BUDGET_MONTHS_2026.filter(m => isClosedWithData(bv, m))

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

  /** Forecast voor één sub-key in een open maand — zelfde model als
   *  BudgetsTab.getForecastFor:
   *    seasonalForecast = 2025-zelfde-maand × perfMult × fteAdj × leaveAdj
   *    runRateForecast  = lastActual × fteAdj × leaveAdj
   *    final            = 0.6 × seasonal + 0.4 × runRate
   *  Met:
   *    perfMult  = YTD-2026 / YTD-2025 over actual-maanden
   *    fteAdj    = (fteLast + fteDelta × ramp) / fteLast — voor groei/krimp
   *    leaveAdj  = 1 − min(plannedVakantie / avgWork, 0.5) — alleen op
   *                 omzet-keys; dempt impact van zomerverlof. */
  const forecastSub = (bv: EntityName, month: string, key: string): number => {
    // Forecast-baseline = calendar-closed maanden mét data (zelfde als
    // Budgetten-tab gebruikt). Zo komt Apr-LE in beide tabs op hetzelfde
    // bedrag uit, ook als Mar nog niet definitief is afgesloten.
    const acts = closedDataMonthsFor(bv)
    const sameMonth2025 = rawActual2025(bv, toPY(month), key)
    let ytd2026 = 0, ytd2025 = 0
    for (const cm of acts) {
      ytd2026 += rawActual2026(bv, cm, key)
      ytd2025 += rawActual2025(bv, toPY(cm), key)
    }
    const perfMult = ytd2025 !== 0 ? ytd2026 / ytd2025 : 1
    const lastActual = acts.length > 0 ? rawActual2026(bv, acts[acts.length - 1], key) : 0
    const lastActualMonth = acts[acts.length - 1] ?? null

    // FTE-adjustment (alleen Cons/Proj/Soft — Holdings heeft geen FTE-flow).
    let fteAdj = 1
    if (bv !== 'Holdings' && lastActualMonth) {
      const planned = getPlannedFteInfo(bv, month, lastActualMonth)
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

    // Leave-dampening: alleen op omzet-keys, baseline = avg werkuren over
    // recente actual-maanden, cap op 50% reductie.
    let leaveAdj = 1
    const isRevenueKey = key === 'netto_omzet' || key === 'gefactureerde_omzet'
    if (bv !== 'Holdings' && acts.length > 0 && isRevenueKey) {
      const plannedVakantie = getPlannedVakantie(bv as BvId, month)
      if (plannedVakantie > 0) {
        let baselineWork = 0, baselineCount = 0
        for (const cm of acts) {
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

  /** Sub-key LE: override → calendar-closed-actual → user budget → forecast.
   *  Identiek aan BudgetsTab.rawLeVal — mar (calendar-closed met data) gebruikt
   *  de werkelijke ingevulde waarde, ook al is de maand nog niet finalized. */
  const rawLE = (bv: EntityName, month: string, key: string): number => {
    const ov = getLeOverride(bv, month, key)
    if (ov != null) return ov
    if (isClosedWithData(bv, month)) return rawActual2026(bv, month, key)
    // User-budget per specifieke key: override de forecast.
    const monthOv = overrides[bv]?.[month]
    if (monthOv && Object.prototype.hasOwnProperty.call(monthOv, key)) {
      return getBudgetMonth(bv, month)[key] ?? 0
    }
    return forecastSub(bv, month, key)
  }

  /** Centrale LE-getter — exact zelfde structuur als BudgetsTab.getLeVal:
   *    closed-with-data + aggregate/derived → rawActual2026 (incl. IC, accruals)
   *    open + aggregate                     → som van sub-key forecasts
   *    derived                              → formule recursief
   *    leaf                                 → rawLE pad */
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

  type LeSource = 'override' | 'actual' | 'budget' | 'forecast' | 'derived'
  const getLeSource = (bv: EntityName, month: string, key: string): LeSource => {
    if (READONLY_KEYS.has(key)) return 'derived'
    if (isActualMonth(bv, month)) return 'actual'
    if (getLeOverride(bv, month, key) != null) return 'override'
    const monthOv = overrides[bv]?.[month]
    if (monthOv && Object.prototype.hasOwnProperty.call(monthOv, key)) return 'budget'
    return 'forecast'
  }

  const sumLE = (bv: EntityName, months: string[], key: string): number =>
    months.reduce((s, m) => s + getLE(bv, m, key), 0)

  const fyLE = (bv: EntityName, key: string): number =>
    sumLE(bv, BUDGET_MONTHS_2026, key)

  // Voor charts: hasLE blijft true (LE is altijd beschikbaar via forecast).
  const hasLE = (_bv: EntityName, _month: string, _key: string): boolean => true

  // Backwards-compat: oudere callers gebruiken nog isClosed (calendar-only).
  // Die signature houden we; UI-componenten die "is dit een actual-maand"
  // willen weten gebruiken getLeSource() === 'actual' i.p.v. isClosed.
  const isClosed = isCalendarPast

  return { getLE, sumLE, fyLE, isClosed, getLeSource, hasLE, isActualMonth }
}
