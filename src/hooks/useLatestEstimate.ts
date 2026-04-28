import { useAdjustedActuals } from './useAdjustedActuals'
import { useBudgetStore, BUDGET_MONTHS_2026 } from '../store/useBudgetStore'
import { monthlyActuals2026 } from '../data/plData'
import type { EntityName } from '../data/plData'
import { derivePL } from '../lib/plDerive'
import type { BvId } from '../data/types'

const MONTH_CODES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/**
 * Latest Estimate per BV per maand voor de Executive Overview.
 *
 * STRIKTE LE — geen verzonnen forecast. We gebruiken alleen wat al bekend is:
 *   - Closed kalender-maand   → ALTIJD adjusted actual (LE-override negeren).
 *   - Open maand met override → handmatig ingevulde LE wint.
 *   - Open maand met budget   → budget waarde (uit Budgetten-tab of plData
 *                                Jan/Feb defaults).
 *   - Geen van bovenstaande   → 0 + source='none' zodat de chart de stip
 *                                kan overslaan i.p.v. een 0-lijn te tekenen.
 *
 * Zodra de gebruiker in de Budgetten-tab een waarde invult voor een open maand
 * werkt die direct door in Executive Overview (dezelfde reactive store).
 */
export function useLatestEstimate(currentDate?: Date) {
  const { getMonthly } = useAdjustedActuals()
  const getLeOverride = useBudgetStore(s => s.getLeOverride)
  const getBudgetMonth = useBudgetStore(s => s.getMonth)
  const overrides = useBudgetStore(s => s.overrides)
  // Alleen om re-renders te triggeren zodra leOverrides verandert
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

  /** Raw actual lookup. */
  const rawActual2026 = (bv: EntityName, month: string, key: string): number => {
    if (bv === 'Holdings') return monthlyActuals2026['Holdings']?.[month]?.[key] ?? 0
    return getMonthly(bv as BvId, month)[key] ?? 0
  }

  /** Heeft Budgetten-store een (source of override) waarde voor (bv, maand, key)?
   *  Specifieker dan alleen "is er iets in de map" — we kijken naar de exacte
   *  P&L-key zodat een leeg veld niet als ingevuld telt. */
  const hasExplicitBudget = (bv: EntityName, month: string, key: string): boolean => {
    // Eerst: store-override op deze specifieke key?
    const ov = overrides[bv]?.[month]?.[key]
    if (ov !== undefined) return true
    // Anders: source-budget (plData Jan/Feb-26)?
    const monthData = getBudgetMonth(bv, month)
    return Object.prototype.hasOwnProperty.call(monthData, key)
  }

  /** Source-tag voor diagnose / chart-styling. */
  type LeSource = 'override' | 'actual' | 'budget' | 'none'
  const getLeSource = (bv: EntityName, month: string, key: string): LeSource => {
    if (isClosed(month)) return 'actual'  // closed: actual wint altijd
    if (getLeOverride(bv, month, key) != null) return 'override'
    if (hasExplicitBudget(bv, month, key)) return 'budget'
    return 'none'
  }

  /** Raw waarde voor een sub-key (geen aggregate/derived). */
  const rawLE = (bv: EntityName, month: string, key: string): number => {
    if (isClosed(month)) return rawActual2026(bv, month, key)
    const ov = getLeOverride(bv, month, key)
    if (ov != null) return ov
    if (hasExplicitBudget(bv, month, key)) {
      return getBudgetMonth(bv, month)[key] ?? 0
    }
    return 0
  }

  /** Waarde voor om het even welke key (aggregate of derived afgeleid). */
  const getLE = (bv: EntityName, month: string, key: string): number =>
    derivePL(k => rawLE(bv, month, k), key)

  /** True als er voor deze (bv, maand) ÉNIGE bron is van LE-info, voor om het
   *  even welke sub-key. Voor charts die gaten willen tonen wanneer er nog
   *  niets ingevuld is. */
  const hasAnyLeData = (bv: EntityName, month: string): boolean => {
    if (isClosed(month)) return true
    // Override op iets in deze maand?
    const leOv = useBudgetStore.getState().leOverrides[bv]?.[month]
    if (leOv && Object.keys(leOv).length > 0) return true
    // Budget source / override met data?
    const data = getBudgetMonth(bv, month)
    return Object.keys(data).length > 0
  }

  /** Specifieker: heeft deze (bv, maand) een waarde voor `key` (override,
   *  actual, of budget)? Gebruik dit voor chart-data zodat lege punten als
   *  null ipv 0 worden geplot. */
  const hasLE = (bv: EntityName, month: string, key: string): boolean =>
    getLeSource(bv, month, key) !== 'none'

  /** Totaal over reeks maanden (lege maanden tellen als 0). */
  const sumLE = (bv: EntityName, months: string[], key: string): number =>
    months.reduce((s, m) => s + getLE(bv, m, key), 0)

  /** FY 2026 totaal voor een BV. */
  const fyLE = (bv: EntityName, key: string): number =>
    sumLE(bv, BUDGET_MONTHS_2026, key)

  return { getLE, sumLE, fyLE, isClosed, getLeSource, hasLE, hasAnyLeData }
}
