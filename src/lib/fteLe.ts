import type { FteEntry, BvId } from '../data/types'
import { BUDGET_MONTHS_2026 } from '../store/useBudgetStore'

/**
 * FTE Latest-Estimate per (bv, month) — gedeeld tussen HoursTab (FTE-rij) en
 * de financiële LE-pipeline (BudgetsTab forecast, useLatestEstimate hook,
 * leReflection pre-close simulatie). Hierdoor schuift het FTE-tekort vs
 * budget door naar de omzet- en kostenprognose, niet alleen de FTE-rij.
 *
 *   - finalized maand met actual → actual
 *   - manueel ingevulde .fte voor toekomst → die waarde (bewuste override)
 *   - fteBudget aanwezig → max(0, fteBudget + lastKnownDelta)
 *     waarbij lastKnownDelta = actual − fteBudget op de laatste maand
 *     waar beide bekend zijn (overschrijven → laatste delta wint).
 *   - anders → meest recente eerdere actual (forward-fill), of undefined.
 *
 * Met deze logica geldt: als jouw FTE consistent onder budget zit, schuift
 * dat tekort door naar de toekomst-LE — ook als de FTE-budgetlijn omhoog
 * loopt, wordt die groei verminderd met dezelfde tekort-delta. Daardoor
 * komt de omzet-LE onder het budget uit wanneer je onderbezet bent (en
 * boven wanneer je overbezet bent).
 */

/** Laatste bekende actual-vs-budget delta voor (bv) — overschrijven per
 *  maand zodat de meest recente delta wint. 0 als er nooit beide bekend zijn. */
export function getFteLeShift(entries: FteEntry[], bv: BvId): number {
  let lastDelta = 0
  for (const m of BUDGET_MONTHS_2026) {
    // Alleen BV-totaal-entries (geen vertical sub-buckets) — anders zou
    // dezelfde maand meerdere kandidaten opleveren en zou de delta-berekening
    // afhangen van array-volgorde.
    const e = entries.find(x => x.bv === bv && x.month === m && !x.vertical)
    const a = e?.fte
    const b = e?.fteBudget
    if (a != null && a > 0 && b != null && b > 0) {
      lastDelta = a - b
    }
  }
  return lastDelta
}

/** FTE-LE voor (bv, month). Zie module-doc voor de hierarchie. */
export function getFteLe(args: {
  entries: FteEntry[]
  bv: BvId
  month: string
  isFinalized: (month: string) => boolean
}): number | undefined {
  const { entries, bv, month, isFinalized } = args
  // Alleen BV-totaal-entries (geen vertical sub-buckets) gebruiken in LE.
  const cur = entries.find(x => x.bv === bv && x.month === month && !x.vertical)
  if (isFinalized(month) && cur?.fte != null) return cur.fte
  // Manueel ingevoerde .fte voor toekomst wint (bewuste plan-override).
  if (cur?.fte != null) return cur.fte
  const b = cur?.fteBudget
  // fteBudget moet > 0 zijn om als budget te tellen — een expliciete 0 (of
  // null) betekent "niet gebudgetteerd"; in dat geval valt de forecast terug
  // op de forward-fill van de laatste bekende actual. Voorheen retourneerde
  // de engine 0 wanneer fteBudget op 0 stond, waardoor omzet- en kosten-LE
  // vanaf die maand naar nul zakte — meestal niet wat de gebruiker bedoelt.
  if (b != null && b > 0) {
    return Math.max(0, b + getFteLeShift(entries, bv))
  }
  // Fallback: meest recente eerdere actual (forward-fill).
  const idx = BUDGET_MONTHS_2026.indexOf(month)
  for (let i = idx - 1; i >= 0; i--) {
    const prev = entries.find(x => x.bv === bv && x.month === BUDGET_MONTHS_2026[i] && !x.vertical)
    if (prev?.fte != null) return prev.fte
  }
  return undefined
}
