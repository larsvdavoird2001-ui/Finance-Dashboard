import { useAdjustedActuals } from './useAdjustedActuals'
import { useBudgetStore, BUDGET_MONTHS_2026 } from '../store/useBudgetStore'
import { useFteStore } from '../store/useFteStore'
import { useHoursStore } from '../store/useHoursStore'
import { useFinStore } from '../store/useFinStore'
import { monthlyActuals2025, MONTHS_2025_LABELS } from '../data/plData2025'
import type { EntityName } from '../data/plData'
import {
  AGGREGATE_KEYS, DERIVED_KEYS, READONLY_KEYS,
  SUBS_OF, DERIVED_FORMULA,
} from '../lib/plDerive'
import type { BvId } from '../data/types'
import { getFteLe } from '../lib/fteLe'

const MONTH_CODES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const ALL_BVS: EntityName[] = ['Consultancy', 'Projects', 'Software', 'Holdings']

/**
 * Latest Estimate per BV per maand voor de Executive Overview.
 *
 * MIRRORS BudgetsTab één-op-één — zo komen Apr-26 (en alle andere forecast-
 * maanden) op identieke cijfers uit in beide tabs. Hiërarchie per (bv, maand,
 * key):
 *   1. Handmatige LE-override (uit useBudgetStore.leOverrides) → die waarde.
 *   2. Closed-with-data maand → werkelijke actual via useAdjustedActuals.getMonthly
 *      (incl. IC-verrekening, accruals, handmatige correctie, mutatie
 *      vooruitgefactureerd, kosten-overrides, breakdowns).
 *   3. Anders → forecast = blend(seizoens-2025 × YTD-perfMult,
 *      run-rate van laatste closed-month) × FTE-adj × leave-adj.
 *
 * "Closed" wordt sinds deze versie STRIKT bepaald door {finalized in
 * Maandafsluiting}, niet meer door kalender of door has-data. Reden: ook als
 * er voor April al imports zijn binnengekomen, blijft de maand op LE-forecast
 * totdat de gebruiker in de Maandafsluiting-tab op "Definitief afsluiten"
 * heeft geklikt. Pas dan worden de werkelijke actuals — incl. de imports —
 * gepubliceerd in de Executive Overview, charts en AI-prognose. Voor maanden
 * met initial-load actuals (Jan-26, Feb-26) auto-seedt useFinStore eenmalig
 * een finalized-record, zodat de Q1-historie niet plotseling als forecast
 * wordt gerenderd.
 *
 * Voor aggregaat-keys (netto_omzet, directe_kosten, …):
 *   - closed: rechtstreeks getMonthly[key] (zo tellen non-SUBS-velden zoals
 *     IC-verrekening en accruals mee in de actual-aggregaat).
 *   - toekomstig: som van sub-key forecasts (zelfde als BudgetsTab).
 * Voor derived keys (brutomarge, ebitda, ebit): formule recursief.
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
  const finalizedMonths = useFinStore(s => s.finalized)

  const now = currentDate ?? new Date()
  const nowMonthIdx = now.getMonth()
  const nowYear     = now.getFullYear()

  /** Pure kalender-check; behouden voor de zeldzame UI-callers die echt op de
   *  kalender willen filteren (bv. "deze maand is in het verleden") los van
   *  de actual/finalize-status. Het centrale closed-begrip in deze hook is
   *  echter isAnyActual hieronder. */
  const isCalendarPast = (month: string): boolean => {
    const [mmm, yy] = month.split('-')
    const y = 2000 + Number(yy)
    const mi = MONTH_CODES.indexOf(mmm)
    if (y < nowYear) return true
    if (y > nowYear) return false
    return mi < nowMonthIdx
  }

  const finalizedSet = new Set(finalizedMonths.map(f => f.month))
  const isFinalized = (month: string): boolean => finalizedSet.has(month)

  /** Globaal closed: STRIKT alleen finalized maanden. Imports voor April
   *  veranderen April nog niet in 'actual' — pas wanneer de Maandafsluiting
   *  voor die maand is afgerond. Dit garandeert dat LE-trends en AI-prognose
   *  zichtbaar blijven tot de gebruiker bewust afsluit. */
  const isAnyActual = (month: string): boolean => isFinalized(month)
  const closedMonths = BUDGET_MONTHS_2026.filter(isAnyActual)
  const lastClosedMonth: string | null = closedMonths.length > 0
    ? closedMonths[closedMonths.length - 1]
    : null

  /** Per-BV closed: ook hier strikt finalized — zelfde rede als isAnyActual.
   *  De imports voor April staan wel in getMonthly maar worden pas zichtbaar
   *  in de chart-actual-lijn nadat April definitief is afgesloten. */
  const isClosedWithData = (_bv: EntityName, month: string): boolean =>
    isFinalized(month)
  void ALL_BVS  // bewust aangehouden voor toekomstige per-BV-detectie

  const toPY = (m: string): string => {
    const idx = BUDGET_MONTHS_2026.indexOf(m)
    return idx >= 0 ? MONTHS_2025_LABELS[idx] : m.replace('-26', '-25')
  }

  /** Werkelijke 2026-waarde voor (bv, maand, key) — incl. Maandafsluiting. */
  const rawActual2026 = (bv: EntityName, month: string, key: string): number =>
    getMonthly(bv as BvId, month)[key] ?? 0
  const rawActual2025 = (bv: EntityName, m25: string, key: string): number =>
    monthlyActuals2025[bv]?.[m25]?.[key] ?? 0

  /** FTE-getter zonder forward-fill. Alleen BV-totaal (geen vertical sub-buckets). */
  const getFteFor = (bv: BvId, month: string): number =>
    fteEntries.find(e => e.bv === bv && e.month === month && !e.vertical)?.fte ?? 0

  /** Geplande FTE voor toekomstige maand. Gebruikt de gedeelde FTE-LE-logica
   *  (`getFteLe`): manuele .fte > (fteBudget + last-known shift) > forward-fill.
   *  Hierdoor schuift het FTE-tekort vs budget door naar de omzet-/kosten-LE,
   *  niet alleen naar de FTE-rij in HoursTab.
   *
   *  firstChangeIdx wordt gezet op de eerste maand waarin de FTE-LE afwijkt
   *  van fteLast — dat is het ankerpunt voor de hire-ramp (70/90/100%). */
  const getPlannedFteInfo = (bv: EntityName, target: string, lastActual: string | null) => {
    const tIdx = BUDGET_MONTHS_2026.indexOf(target)
    const cIdx = lastActual ? BUDGET_MONTHS_2026.indexOf(lastActual) : -1
    const fteLast = lastActual && bv !== 'Holdings' ? getFteFor(bv as BvId, lastActual) : 0
    let firstChangeIdx = -1
    let plannedFte = fteLast
    if (bv !== 'Holdings') {
      for (let i = cIdx + 1; i <= tIdx && i >= 0; i++) {
        const mm = BUDGET_MONTHS_2026[i]
        const f = getFteLe({ entries: fteEntries, bv: bv as BvId, month: mm, isFinalized })
        if (f != null && f > 0) {
          plannedFte = f
          if (firstChangeIdx < 0 && f !== fteLast) firstChangeIdx = i
        }
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

  /** Forecast-only variant van forecastSub: gebruikt UITSLUITEND de maanden
   *  STRIKT VÓÓR `targetMonth` als YTD-basis. Bedoeld voor de "pre-close LE
   *  snapshot" die we vastleggen bij het definitief maken van een maand —
   *  zodat we achteraf kunnen zien hoe goed de app de maand voorspeld had,
   *  vóórdat de eigen actuals erin zaten. Houdt FTE-ramp en vakantie-
   *  correctie identiek aan forecastSub. */
  const forecastSubExcluding = (bv: EntityName, month: string, key: string): number => {
    const tIdx = BUDGET_MONTHS_2026.indexOf(month)
    const priorClosed = closedMonths.filter(cm => BUDGET_MONTHS_2026.indexOf(cm) < tIdx)
    const lastPrior = priorClosed.length > 0 ? priorClosed[priorClosed.length - 1] : null

    const sameMonth2025 = rawActual2025(bv, toPY(month), key)
    let ytd2026 = 0, ytd2025 = 0
    for (const cm of priorClosed) {
      ytd2026 += rawActual2026(bv, cm, key)
      ytd2025 += rawActual2025(bv, toPY(cm), key)
    }
    const perfMult = ytd2025 !== 0 ? ytd2026 / ytd2025 : 1
    const lastActual = lastPrior ? rawActual2026(bv, lastPrior, key) : 0

    let fteAdj = 1
    if (bv !== 'Holdings' && lastPrior) {
      const planned = getPlannedFteInfo(bv, month, lastPrior)
      if (planned.fteLast > 0) {
        const fteDelta = planned.fte - planned.fteLast
        if (fteDelta <= 0) {
          fteAdj = planned.fte / planned.fteLast
        } else {
          const monthsSinceHire = planned.firstIdx >= 0 ? tIdx - planned.firstIdx : 0
          const ramp = rampFactor(monthsSinceHire)
          const effectiveFte = planned.fteLast + fteDelta * ramp
          fteAdj = effectiveFte / planned.fteLast
        }
      }
    }

    let leaveAdj = 1
    const isRevenueKey = key === 'netto_omzet' || key === 'gefactureerde_omzet'
    if (bv !== 'Holdings' && priorClosed.length > 0 && isRevenueKey) {
      const plannedVakantie = getPlannedVakantie(bv as BvId, month)
      if (plannedVakantie > 0) {
        let baselineWork = 0, baselineCount = 0
        for (const cm of priorClosed) {
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
   *    leOverride → closed-with-data actual → forecast.
   *  Een closed-maand zónder data valt terug op de forecast — zo toont een
   *  nog niet ingevulde maand geen 0 op de chart maar een zinnige LE. */
  const rawLE = (bv: EntityName, month: string, key: string): number => {
    const ov = getLeOverride(bv, month, key)
    if (ov != null) return ov
    if (isClosedWithData(bv, month)) return rawActual2026(bv, month, key)
    return forecastSub(bv, month, key)
  }

  /** Pre-close LE-waarde voor (bv, maand, key) — wat de app voor deze maand
   *  zou voorspellen op basis van uitsluitend ervoor afgesloten maanden,
   *  ZONDER dat de eigen actuals al meetellen. Manuele LE-overrides krijgen
   *  voorrang (override is een bewuste bijstelling). Aggregaten en derived
   *  keys lossen recursief op via SUBS_OF / DERIVED_FORMULA. */
  const rawPreCloseLE = (bv: EntityName, month: string, key: string): number => {
    const ov = getLeOverride(bv, month, key)
    if (ov != null) return ov
    return forecastSubExcluding(bv, month, key)
  }
  const getPreCloseLE = (bv: EntityName, month: string, key: string): number => {
    if (AGGREGATE_KEYS.has(key)) {
      return SUBS_OF[key].reduce((s, sk) => s + rawPreCloseLE(bv, month, sk), 0)
    }
    if (DERIVED_KEYS.has(key)) {
      return DERIVED_FORMULA[key](sk => getPreCloseLE(bv, month, sk))
    }
    return rawPreCloseLE(bv, month, key)
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

  // isClosed: globaal closed-of-niet (finalized OR data) — gebruikt door de
  // dashboard chart-color-logic om te bepalen tot waar de actuals-lijn loopt.
  // Niet-finalized maanden zonder data tellen niet als closed; daar pakt de
  // LE-forecast over.
  const isClosed = (month: string): boolean => isAnyActual(month)
  // isActualMonth: per-BV closed met data of finalized — zelfde als
  // getLeSource→'actual'.
  const isActualMonth: (bv: EntityName, month: string) => boolean = (bv, month) =>
    isClosedWithData(bv, month)

  return {
    getLE, sumLE, fyLE,
    isClosed, isCalendarPast,
    getLeSource, hasLE, isActualMonth,
    getPreCloseLE,
  }
}
