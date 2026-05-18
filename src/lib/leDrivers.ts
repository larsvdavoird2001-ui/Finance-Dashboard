// LE-drivers — pure, side-effect-vrije helpers voor de driver-based rolling
// forecast. Eén plek voor werkdagen-telling, declarabiliteit-aflezing, tarief-
// implicatie en de hoofdformule per kosten-/omzetcategorie. De useLatestEstimate-
// hook en de variance bridge consumeren deze functies, zodat er nooit twee
// versies van dezelfde rekenregel ontstaan.
//
// Methodiek: FP&A-standaard driver-based forecast.
//   Omzet  = FTE × werkdagen × uren_per_dag × declarability × €/uur × (1 − verlofratio)
//   D-pers = €_per_FTE_run_rate × FTE_le
//   D-rest = run-rate × revenue-ratio (passthrough koppeling)
//   OpEx   = budget (bewust gebudgetteerd — geen run-rate-extrapolatie)
//   A&A / fin. resultaat / VPB = budget (vaste posten)
//
// Eén-offs worden vóór de baseline-aggregatie uitgesloten zodat een eenmalige
// meevaller/tegenvaller niet de hele ROY meetrekt. Structurele wijzigingen die
// de gebruiker bevestigt worden als multiplicatieve adjustment toegepast.

import type { BvId, FteEntry } from '../data/types'
import type { HoursEntry } from '../store/useHoursStore'
import { BUDGET_MONTHS_2026 } from '../store/useBudgetStore'
import { getFteLe } from './fteLe'

/** Conventie: 8 declarabele uren per werkdag per FTE. Past bij het 1.0 FTE =
 *  40-urige werkweek model dat ook in de SAP-export aan TPG zit. */
export const HOURS_PER_FTE_PER_DAY = 8

const MONTH_CODES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ── Werkdagen per maand ─────────────────────────────────────────────────────
/** Aantal werkdagen (ma–vr) in een maand-code zoals "Apr-26". NL-feestdagen
 *  worden NIET afgetrokken: die zitten in de praktijk al in de declarability-
 *  ratio en in de vakantie-uren-input. Deze helper levert dus de pure kalender-
 *  werkdagen. */
export function workdaysInMonth(monthCode: string): number {
  const m = monthCode.match(/^(\w+)-(\d{2})$/)
  if (!m) return 21 // veilige fallback
  const mi = MONTH_CODES.indexOf(m[1])
  const year = 2000 + Number(m[2])
  if (mi < 0) return 21
  let count = 0
  const last = new Date(year, mi + 1, 0).getDate()
  for (let d = 1; d <= last; d++) {
    const day = new Date(year, mi, d).getDay() // 0=zo, 6=za
    if (day !== 0 && day !== 6) count++
  }
  return count
}

/** Totale (theoretische) FTE-uren in een maand: werkdagen × 8 × FTE. */
export function capacityHoursForMonth(fte: number, monthCode: string): number {
  return workdaysInMonth(monthCode) * HOURS_PER_FTE_PER_DAY * fte
}

// ── Baseline-windows ────────────────────────────────────────────────────────
/** Pak de laatste N closed-maanden vóór `targetMonth` (exclusief targetMonth
 *  zelf). Voor de driver-engine telt N=3 als comfort-zone: lang genoeg om
 *  ruis te dempen, kort genoeg om recente structurele veranderingen te zien. */
export function recentClosedWindow(
  closedMonths: string[],
  targetMonth: string | null,
  windowSize: number,
): string[] {
  if (closedMonths.length === 0) return []
  if (!targetMonth) return closedMonths.slice(-windowSize)
  const tIdx = BUDGET_MONTHS_2026.indexOf(targetMonth)
  const prior = closedMonths.filter(cm => BUDGET_MONTHS_2026.indexOf(cm) < tIdx)
  return prior.slice(-windowSize)
}

// ── Declarability ───────────────────────────────────────────────────────────
/** Gewogen gemiddelde declarability over de recente window. Excludeert maanden
 *  die als one-off voor mix/declarability zijn gemarkeerd (zie isOneOff). */
export function recentDeclarability(args: {
  bv: BvId
  window: string[]
  hoursEntries: HoursEntry[]
  isOneOff: (month: string, component: 'mix') => boolean
}): number {
  const { bv, window, hoursEntries, isOneOff } = args
  let declarableSum = 0
  let workSum = 0
  for (const m of window) {
    if (isOneOff(m, 'mix')) continue
    const h = hoursEntries.find(e => e.bv === bv && e.month === m)
    if (!h) continue
    const work = h.declarable + h.internal
    if (work <= 0) continue
    declarableSum += h.declarable
    workSum += work
  }
  if (workSum <= 0) return 0.85 // veilige default (~ branchegemiddelde consultancy)
  return declarableSum / workSum
}

// ── Effectief tarief €/uur ──────────────────────────────────────────────────
/** Impliciet tarief = revenue / declarabele uren over de window. Excludeert
 *  maanden die als one-off voor price zijn gemarkeerd. Levert 0 als er geen
 *  geldige basis is — caller valt dan terug op budget. */
export function impliedHourlyRate(args: {
  bv: BvId
  window: string[]
  hoursEntries: HoursEntry[]
  getRevenue: (bv: BvId, month: string) => number
  isOneOff: (month: string, component: 'price') => boolean
}): number {
  const { bv, window, hoursEntries, getRevenue, isOneOff } = args
  let revSum = 0
  let declSum = 0
  for (const m of window) {
    if (isOneOff(m, 'price')) continue
    const h = hoursEntries.find(e => e.bv === bv && e.month === m)
    if (!h || h.declarable <= 0) continue
    revSum += getRevenue(bv, m)
    declSum += h.declarable
  }
  if (declSum <= 0) return 0
  return revSum / declSum
}

// ── Verlofratio ─────────────────────────────────────────────────────────────
/** Verhouding van geplande vakantie+ziekte t.o.v. de theoretische capaciteit.
 *  Cap op 0.8 (80%) — een maand met meer dan 80% verlof is een datafout, geen
 *  zinvolle forecast-input. */
export function plannedLeaveRatio(args: {
  bv: BvId
  month: string
  fte: number
  hoursEntries: HoursEntry[]
}): number {
  const { bv, month, fte, hoursEntries } = args
  if (fte <= 0) return 0
  const h = hoursEntries.find(e => e.bv === bv && e.month === month)
  if (!h) return 0
  const planned = (h.vakantie ?? 0) + (h.ziekte ?? 0)
  if (planned <= 0) return 0
  const capacity = capacityHoursForMonth(fte, month)
  if (capacity <= 0) return 0
  return Math.min(planned / capacity, 0.8)
}

// ── Allocatie omzet over sub-keys ───────────────────────────────────────────
/** Historische verhouding gefactureerde_omzet / netto_omzet over de window.
 *  Voor 2026-actuals zit het zwaartepunt typisch ~95% bij gefactureerd en
 *  ~5% bij periode-allocatie. Fallback default 1.0/0.0 als geen historie. */
export function revenueSubSplit(args: {
  bv: BvId
  window: string[]
  getMonthly: (bv: BvId, month: string) => Record<string, number>
}): { gefactureerd: number; allocatie: number } {
  const { bv, window, getMonthly } = args
  let gef = 0, alloc = 0
  for (const m of window) {
    const d = getMonthly(bv, m)
    gef   += d['gefactureerde_omzet'] ?? 0
    alloc += d['omzet_periode_allocatie'] ?? 0
  }
  const total = gef + alloc
  if (total === 0) return { gefactureerd: 1, allocatie: 0 }
  return { gefactureerd: gef / total, allocatie: alloc / total }
}

// ── Run-rate per kostenpost ─────────────────────────────────────────────────
/** Gemiddelde per FTE per maand over de window. Excludeert one-off maanden.
 *  Voor kostenposten die met headcount schalen (directe personeelskosten). */
export function avgPerFte(args: {
  bv: BvId
  window: string[]
  getMonthly: (bv: BvId, month: string) => Record<string, number>
  fteOf: (bv: BvId, month: string) => number
  isOneOff: (month: string, key: string) => boolean
  key: string
}): number {
  const { bv, window, getMonthly, fteOf, isOneOff, key } = args
  let valSum = 0
  let fteSum = 0
  for (const m of window) {
    if (isOneOff(m, key)) continue
    const fte = fteOf(bv, m)
    if (fte <= 0) continue
    const v = getMonthly(bv, m)[key] ?? 0
    valSum += v
    fteSum += fte
  }
  if (fteSum <= 0) return 0
  return valSum / fteSum
}

/** Simpel gemiddelde over de window — voor kostenposten zonder FTE-koppeling
 *  (bv. inkoopkosten met variabele passthrough). Excludeert one-off maanden. */
export function avgPerMonth(args: {
  bv: BvId
  window: string[]
  getMonthly: (bv: BvId, month: string) => Record<string, number>
  isOneOff: (month: string, key: string) => boolean
  key: string
}): number {
  const { bv, window, getMonthly, isOneOff, key } = args
  let sum = 0, n = 0
  for (const m of window) {
    if (isOneOff(m, key)) continue
    sum += getMonthly(bv, m)[key] ?? 0
    n++
  }
  if (n === 0) return 0
  return sum / n
}

// ── Planned FTE-LE (delegatie naar bestaande fteLe-helper) ──────────────────
/** Wrapper rond getFteLe voor consumer-vriendelijke 0-default. Holdings heeft
 *  geen FTE-flow, geven we altijd 0 voor. */
export function plannedFte(args: {
  bv: BvId | 'Holdings'
  month: string
  fteEntries: FteEntry[]
  isFinalized: (m: string) => boolean
}): number {
  if (args.bv === 'Holdings') return 0
  const v = getFteLe({
    entries: args.fteEntries,
    bv: args.bv as BvId,
    month: args.month,
    isFinalized: args.isFinalized,
  })
  return v ?? 0
}
