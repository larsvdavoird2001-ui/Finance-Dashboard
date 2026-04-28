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
 * Eenvoudige, executive-niveau definitie:
 *   - Kalender-afgesloten maanden  → adjusted actuals (uit OHW + closing)
 *   - Toekomstige maanden          → LE-override uit Budgetten-tab als die er
 *                                    is, anders het budget voor die maand.
 *
 * Voor de gedetailleerdere forecast (FTE-ramp / verlof-correctie / season-blend)
 * zie BudgetsTab. Deze hook houdt het simpel zodat de Executive Overview altijd
 * snel kan tonen "waar staan we vs. plan" zonder afhankelijk te zijn van uren-
 * en FTE-stores die niet altijd ingevuld zijn.
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

  /** Raw waarde voor een sub-key (geen aggregate/derived). */
  const rawLE = (bv: EntityName, month: string, key: string): number => {
    const ov = getLeOverride(bv, month, key)
    if (ov != null) return ov
    if (isClosed(month)) {
      if (bv === 'Holdings') return monthlyActuals2026['Holdings']?.[month]?.[key] ?? 0
      return getMonthly(bv as BvId, month)[key] ?? 0
    }
    return getBudgetMonth(bv, month)[key] ?? 0
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

  return { getLE, sumLE, fyLE, isClosed }
}
