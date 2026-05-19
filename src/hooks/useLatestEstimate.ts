import { useAdjustedActuals } from './useAdjustedActuals'
import { useBudgetStore, BUDGET_MONTHS_2026 } from '../store/useBudgetStore'
import { useFteStore } from '../store/useFteStore'
import { useHoursStore } from '../store/useHoursStore'
import { useFinStore } from '../store/useFinStore'
import { useReflectionStore } from '../store/useReflectionStore'
import { monthlyActuals2025, MONTHS_2025_LABELS } from '../data/plData2025'
import type { EntityName } from '../data/plData'
import {
  AGGREGATE_KEYS, DERIVED_KEYS, READONLY_KEYS,
  SUBS_OF, DERIVED_FORMULA,
} from '../lib/plDerive'
import type { BvId } from '../data/types'
import {
  workdaysInMonth, HOURS_PER_FTE_PER_DAY,
  recentClosedWindow, revenueSubSplit, plannedFte,
} from '../lib/leDrivers'

/**
 * Latest Estimate — driver-based rolling forecast met variance bridge support.
 *
 * Methodiek (FP&A-standaard, vervangt de vorige seasonal/run-rate blend):
 *
 *   LE_year = YTD_actuals + Σ ROY_month
 *
 *   ROY_month per P&L-sub-key:
 *     - Omzet:        FTE_le × werkdagen × 8u × declarability × €/uur × (1−verlofratio)
 *     - Directe pers: avg(€/FTE laatste 3 closed) × FTE_le
 *     - Directe rest: avg-per-maand laatste 3 closed × revenue-ratio adjustment
 *     - OpEx (8):     ingegeven budget (bewust gebudgetteerd; geen run-rate)
 *     - A&A / fin:    ingegeven budget (vaste posten)
 *
 *   Aggregaten (netto_omzet, directe_kosten, …) = som van subs.
 *   Derived (brutomarge, ebitda, ebit, netto_resultaat) = via DERIVED_FORMULA.
 *
 * Reflectie-loop integratie:
 *   - "one-off"-gemarkeerde (bv, maand, key) → de actual voor die cel wordt
 *     uitgesloten uit de baseline-window. Bij wildcard ('one-off-month') geldt
 *     dat voor ALLE keys van die maand.
 *   - "structural"-gemarkeerde maand → géén speciale multiplicator nodig,
 *     omdat een driver-engine sowieso op de recente actuals anchored. De
 *     baseline-window pakt de structurele shift natuurlijk op.
 *
 * Hiërarchie per (bv, maand, key):
 *   1. Handmatige LE-override (useBudgetStore.leOverrides) → wint.
 *   2. Maand is finalized → werkelijke actual via useAdjustedActuals.
 *   3. Anders → driver-forecast (zie boven).
 */

// ── Reflectie-vraag → P&L-keys mapping ───────────────────────────────────────
// 5 driver-vragen (zie LeReflectionPanel) plus legacy IDs voor compatibility
// met reeds opgeslagen reflectie-records uit het oude vragenmodel.
const REVENUE_SUBS = ['gefactureerde_omzet', 'omzet_periode_allocatie']
const DIRECT_PERS_SUBS = ['directe_personeelskosten']
const DIRECT_OTHER_SUBS = ['directe_inkoopkosten', 'directe_overige_personeelskosten', 'directe_autokosten']
const OPEX_SUBS = ['indirecte_personeelskosten', 'overige_personeelskosten', 'huisvestingskosten', 'automatiseringskosten', 'indirecte_autokosten', 'verkoopkosten', 'algemene_kosten', 'doorbelaste_kosten']
const ALL_COST_SUBS = [...DIRECT_PERS_SUBS, ...DIRECT_OTHER_SUBS, ...OPEX_SUBS]

const QUESTION_KEY_MAP: Record<string, readonly string[] | '*'> = {
  // ── Nieuwe driver-vragen ──
  'volume-shift':       [...REVENUE_SUBS, ...DIRECT_PERS_SUBS],
  'rate-shift':         REVENUE_SUBS,
  'utilization-shift':  REVENUE_SUBS,
  'one-off-month':      '*',
  'cost-step-change':   ALL_COST_SUBS,
  // ── Legacy IDs (oude antwoorden blijven werken) ──
  'rev-vs-le':          REVENUE_SUBS,
  'rev-vs-budget':      REVENUE_SUBS,
  'seasonal':           REVENUE_SUBS,
  'declarability':      REVENUE_SUBS,
  'capacity-vs-budget': REVENUE_SUBS,
  'margin-shift':       REVENUE_SUBS,
  'direct-pers':        DIRECT_PERS_SUBS,
  'direct-cost':        [...DIRECT_PERS_SUBS, ...DIRECT_OTHER_SUBS],
  'opex':               OPEX_SUBS,
}

const RECENCY_WINDOW = 3  // laatste 3 closed-maanden voor alle baseline-aggregaties
const MONTH_CODES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/** Hoeveel zwaar 2025-seizoenspatroon meeschuift in de driver-forecast.
 *  0 = puur driver-based (vlakke uitkomst per maand), 1 = volledig 2025-shape.
 *  0.8 betekent: een maand die in 2025 60% van de avg deed (zoals zomer-
 *  bouwvak of december-zakking) wordt voor 2026 met factor
 *  1 + (0.6−1)×0.8 = 0.68 gecorrigeerd — bijna volledig respecteren we de
 *  bouw-seizoen-trend. Hogere weight voor TPG omdat de bouwvak en winter-
 *  pauzes structureel doorwerken in de declarabele uren. */
const SEASONAL_OVERLAY_WEIGHT = 0.8

/** Drift-correction weight: hoe sterk de engine zich aanpast aan systematische
 *  LE-vs-Actual bias uit eerdere closed-maanden. Conservatief gehouden (0.35)
 *  zodat goede maanden niet leiden tot enthousiaste over-extrapolatie. Een
 *  drift-ratio van 1.30 (engine schatte 30% te laag) geeft nu correctie =
 *  1 + (1.30−1)×0.35 = 1.105 in plaats van 1.18. */
const DRIFT_CORRECTION_WEIGHT = 0.35
/** Max correctie per richting — beschermt tegen explosieve compounding op
 *  basis van 1-2 maanden historie. */
const DRIFT_CORRECTION_CAP = 0.15

/** MoM growth-trend weight: hoeveel van de recente maand-op-maand groei
 *  wordt geëxtrapoleerd naar toekomstige maanden. Soft (0.15) — net genoeg
 *  om een echte trend door te laten werken, te weinig om een sterke recente
 *  maand exponentieel naar Q4 te projecteren. */
const GROWTH_TREND_WEIGHT = 0.15
/** Cap per maand op de groei-component, om unrealistische compounding te
 *  voorkomen wanneer recente maanden uitschieters bevatten. */
const GROWTH_TREND_CAP_PER_MONTH = 0.05

/** Budget-anchor weight: hoe sterk een handmatig aangepast budget doorwerkt
 *  in de LE-forecast voor open maanden. 0 = pure driver (budget heeft geen
 *  invloed), 1 = LE = budget (driver vervalt). 0.5 = halverwege — een budget-
 *  bijstelling van +€100k tilt de LE met +€50k. Reden: de driver-engine geeft
 *  een data-driven forecast op basis van actuals, maar als de CFO bewust het
 *  budget bijwerkt is dat een plan-signaal dat in evenredige mate de LE moet
 *  bewegen. Closed maanden gebruiken de actual en zijn niet onderhevig aan
 *  deze blend. */
const BUDGET_ANCHOR_WEIGHT = 0.5

/** 2025-zelfde-maand → 2025-jaargemiddelde ratio. Wordt cached per (bv, key)
 *  in een Map binnen de hook zodat we niet bij elke forecast-call opnieuw
 *  itereren over alle 12 maanden. */
function seasonalFactor(bv: EntityName, monthCode26: string, key: string): number {
  const monthIdx = BUDGET_MONTHS_2026.indexOf(monthCode26)
  if (monthIdx < 0) return 1
  const month25 = MONTHS_2025_LABELS[monthIdx]
  const valueThisMonth = monthlyActuals2025[bv]?.[month25]?.[key] ?? 0
  if (valueThisMonth === 0) return 1
  // Jaargemiddelde over 2025 voor dezelfde key.
  let sum = 0, n = 0
  for (const m of MONTHS_2025_LABELS) {
    const v = monthlyActuals2025[bv]?.[m]?.[key] ?? 0
    if (v !== 0) { sum += v; n++ }
  }
  const avg = n > 0 ? sum / n : 0
  if (avg === 0) return 1
  const raw = valueThisMonth / avg
  // Soft-overlay: 1 + (raw−1) × weight. Kleinere afwijking dan ruw 2025-shape.
  return 1 + (raw - 1) * SEASONAL_OVERLAY_WEIGHT
}

export function useLatestEstimate(currentDate?: Date) {
  const { getMonthly } = useAdjustedActuals()
  const getLeOverride = useBudgetStore(s => s.getLeOverride)
  const getBudgetMonth = useBudgetStore(s => s.getMonth)
  // Trigger re-render bij overrides / leOverrides wijziging.
  useBudgetStore(s => s.overrides)
  useBudgetStore(s => s.leOverrides)
  const fteEntries  = useFteStore(s => s.entries)
  const hoursEntries = useHoursStore(s => s.entries)
  const finalizedMonths = useFinStore(s => s.finalized)
  const reflectionRecords = useReflectionStore(s => s.records)

  const now = currentDate ?? new Date()
  const nowMonthIdx = now.getMonth()
  const nowYear     = now.getFullYear()

  // ── Closed-detectie ─────────────────────────────────────────────────────
  const finalizedSet = new Set(finalizedMonths.map(f => f.month))
  const isFinalized = (month: string): boolean => finalizedSet.has(month)
  const isAnyActual = (month: string): boolean => isFinalized(month)
  const closedMonths = BUDGET_MONTHS_2026.filter(isAnyActual)
  const isClosedWithData = (_bv: EntityName, month: string): boolean =>
    isFinalized(month)

  const isCalendarPast = (month: string): boolean => {
    const [mmm, yy] = month.split('-')
    const y = 2000 + Number(yy)
    const mi = MONTH_CODES.indexOf(mmm)
    if (y < nowYear) return true
    if (y > nowYear) return false
    return mi < nowMonthIdx
  }

  // ── Reflectie-helpers ───────────────────────────────────────────────────
  /** Heeft de gebruiker voor (bv, maand) een vraag beantwoord met deze scope
   *  die effect heeft op `key`? Wildcard 'one-off-month' raakt ALLE keys. */
  const hasReflectionFlag = (
    bv: EntityName, month: string, key: string,
    scope: 'one-off' | 'structural',
  ): boolean => {
    const rec = reflectionRecords.find(r => r.month === month && r.bv === bv)
    if (!rec) return false
    for (const ans of rec.answers) {
      if (ans.scope !== scope) continue
      const target = QUESTION_KEY_MAP[ans.questionId]
      if (!target) continue
      if (target === '*') return true
      if (target.includes(key)) return true
    }
    return false
  }
  // ── Raw lookups ─────────────────────────────────────────────────────────
  const rawActual = (bv: EntityName, month: string, key: string): number =>
    getMonthly(bv as BvId, month)[key] ?? 0

  const rawBudget = (bv: EntityName, month: string, key: string): number => {
    const m = getBudgetMonth(bv, month)
    return m[key] ?? 0
  }

  /** Revenue voor een gesloten maand zoals netto_omzet (sum van subs). */
  const rawActualRevenue = (bv: BvId, month: string): number => {
    const d = getMonthly(bv, month)
    return (d['gefactureerde_omzet'] ?? 0) + (d['omzet_periode_allocatie'] ?? 0)
  }

  // FTE-helper voor avg-per-fte berekeningen — gebruikt actuals voor closed
  // maanden (echte bezetting), via getFteLe wordt forward-fill/plan toegepast.
  const fteOfBv = (bv: BvId, month: string): number =>
    plannedFte({ bv, month, fteEntries, isFinalized })

  // ── Categorisatie van P&L-keys ──────────────────────────────────────────
  const isRevenueSub = (key: string): boolean => REVENUE_SUBS.includes(key)
  // Cost-sub classificatie wordt nu via aggregateKeyForSub gedaan; geen
  // aparte helpers meer nodig.

  // ── Engine self-correction: drift-factor uit historische LE-vs-Actual ──
  // Voor elke afgesloten maand met een leSnapshot vergelijken we de pre-close
  // LE met de werkelijke actual. Het mediaan van die ratios is de
  // systematische bias van de engine. Bij positieve bias (LE > Actual) → de
  // engine schat structureel te hoog en moeten we toekomstige forecasts naar
  // beneden bijstellen. Soft toegepast met DRIFT_CORRECTION_WEIGHT + cap.
  //
  // leSnapshot heeft alleen netto_omzet / brutomarge / ebitda — voor andere
  // keys geldt drift = 1 (geen correctie).
  const driftCorrection = (bv: EntityName, key: string): number => {
    if (key !== 'netto_omzet' && key !== 'brutomarge' && key !== 'ebitda' &&
        key !== 'gefactureerde_omzet' && key !== 'omzet_periode_allocatie') {
      return 1
    }
    // Voor revenue-subs: koppel aan netto_omzet drift (ze schalen samen).
    const snapKey: 'netto_omzet' | 'brutomarge' | 'ebitda' =
      (key === 'brutomarge' || key === 'ebitda') ? key : 'netto_omzet'
    const ratios: number[] = []
    for (const f of finalizedMonths) {
      const snap = f.leSnapshot?.[bv]?.[snapKey]
      if (snap == null || snap === 0) continue
      const actual = rawActual(bv, f.month, snapKey)
      if (actual === 0) continue
      // Zelfde-teken vereist — anders is de ratio betekenisloos
      if (Math.sign(snap) !== Math.sign(actual)) continue
      ratios.push(actual / snap)
    }
    if (ratios.length === 0) return 1
    // Mediaan beschermt tegen één outlier maand
    ratios.sort((a, b) => a - b)
    const median = ratios[Math.floor(ratios.length / 2)]
    const corrected = 1 + (median - 1) * DRIFT_CORRECTION_WEIGHT
    // Cap om explosieve compounding te voorkomen
    return Math.max(1 - DRIFT_CORRECTION_CAP, Math.min(1 + DRIFT_CORRECTION_CAP, corrected))
  }

  // ── Engine self-correction: MoM growth-trend extrapolatie ──
  // Berekent de gemiddelde maand-op-maand groei van revenue over de closed
  // maanden, en past die met soft-weight toe op de afstand-tussen-target-en-
  // laatste-closed. Cap per maand voorkomt dat uitschieters exponentieel
  // doorwerken naar Q4. Toegepast op revenue-keys; cost-keys schalen al via
  // FTE-trend.
  const growthTrendFactor = (bv: EntityName, month: string): number => {
    if (bv === 'Holdings') return 1  // Geen omzet → geen trend
    if (closedMonths.length < 2) return 1
    const bvId = bv as BvId
    let growthSum = 0, n = 0
    for (let i = 1; i < closedMonths.length; i++) {
      const prev = rawActualRevenue(bvId, closedMonths[i - 1])
      const cur = rawActualRevenue(bvId, closedMonths[i])
      if (prev > 0 && cur > 0) {
        growthSum += cur / prev
        n++
      }
    }
    if (n === 0) return 1
    const avgGrowth = growthSum / n
    // Cap per-maand groei zodat een sterke recente sprong niet onbedoeld
    // exponentieel doorgaat
    const capped = Math.max(1 - GROWTH_TREND_CAP_PER_MONTH, Math.min(1 + GROWTH_TREND_CAP_PER_MONTH, avgGrowth))
    const lastClosed = closedMonths[closedMonths.length - 1]
    const lastIdx = BUDGET_MONTHS_2026.indexOf(lastClosed)
    const targetIdx = BUDGET_MONTHS_2026.indexOf(month)
    const distance = targetIdx - lastIdx
    if (distance <= 0) return 1
    // Compound growth met soft weight
    return Math.pow(capped, distance * GROWTH_TREND_WEIGHT)
  }

  // ── Budget-anchor blend ────────────────────────────────────────────────
  /** Blendt een driver-forecast met de ingegeven budget-waarde. Behoudt
   *  bestaande edge-cases:
   *    - budget = 0 → pure driver (gebruiker heeft niets ingegeven)
   *    - driver = 0 → val volledig terug op budget (geen driver-signaal,
   *      consistent met de eerdere "no-history → budget"-fallback)
   *    - beide ≠ 0 → gewogen gemiddelde via BUDGET_ANCHOR_WEIGHT
   *  Zo werkt een budget-aanpassing evenredig door in LE en grafieken,
   *  zonder dat de driver-methodiek (FTE × rev/FTE, kost-ratio's, seizoens-
   *  overlay, drift, growth) zijn vorm verliest. */
  const blendWithBudget = (driver: number, budget: number): number => {
    if (budget === 0) return Math.round(driver)
    if (driver === 0) return Math.round(budget)
    return Math.round((1 - BUDGET_ANCHOR_WEIGHT) * driver + BUDGET_ANCHOR_WEIGHT * budget)
  }

  /** Som van sub-budgets voor een aggregate-key (voor cost-aggregate blend). */
  const aggregateBudget = (bv: EntityName, month: string, aggrKey: string): number => {
    const subs = SUBS_OF[aggrKey] ?? []
    return subs.reduce((s, sk) => s + rawBudget(bv, month, sk), 0)
  }

  // ── Driver-forecasts ────────────────────────────────────────────────────

  /** Totale revenue-LE voor een toekomstige maand op basis van drivers.
   *
   *  Primair model: revenue per FTE per maand uit de recente window. Dit is
   *  het CFO-mentale model ("60 FTE × €9.5k/maand → €570k") en robuust voor
   *  zowel time-and-material als project-/fixed-fee-business. Het oude model
   *  (FTE × werkdagen × declarability × €/uur) liep mis voor BV's waar omzet
   *  niet volledig aan declarabele uren te koppelen is (vaste projecten,
   *  milestones, prepayments) — dan overschat €/uur omdat álle omzet door
   *  declarabele uren wordt gedeeld.
   *
   *  Adjustments:
   *    - 2025-seizoen-overlay (zomer-dip, december-zakking) als soft factor
   *    - Excess-leave-adjustment: alleen de geplande vakantie die boven het
   *      baseline-niveau uitsteekt drukt de forecast verder. Reden: het
   *      baseline rev/FTE bevat al een normaal vakantiepatroon.
   */
  const forecastRevenueTotal = (bv: EntityName, month: string): number => {
    if (bv === 'Holdings') return 0  // Holdings = overhead, geen omzet
    const bvId = bv as BvId
    const window = recentClosedWindow(closedMonths, month, RECENCY_WINDOW)

    // Verzamel rev/FTE/maand baseline over de window.
    let revSum = 0
    let revMonths = 0  // hoeveel maanden hadden meaningful revenue
    let fteSum = 0
    let leaveSum = 0
    for (const m of window) {
      if (hasReflectionFlag(bv, m, 'gefactureerde_omzet', 'one-off')) continue
      const rev = rawActualRevenue(bvId, m)
      if (rev > 0) { revSum += rev; revMonths++ }
      const f = fteOfBv(bvId, m)
      if (f > 0 && rev > 0) {
        fteSum += f
        const h = hoursEntries.find(e => e.bv === bvId && e.month === m)
        leaveSum += h ? (h.vakantie ?? 0) + (h.ziekte ?? 0) : 0
      }
    }

    // Geen historische revenue → 2025-zelfde-maand pattern of budget als
    // laatste vangnet. Voorkomt dat het LE-lijntje vanaf May naar 0 zakt
    // wanneer de FTE-historie nog niet volledig in de stores zit.
    if (revSum <= 0) {
      const py = monthlyActuals2025[bv]?.[MONTHS_2025_LABELS[BUDGET_MONTHS_2026.indexOf(month)] ?? '']
      const pyRev = (py?.['gefactureerde_omzet'] ?? 0) + (py?.['omzet_periode_allocatie'] ?? 0)
      if (pyRev > 0) return Math.round(pyRev)
      return rawBudget(bv, month, 'gefactureerde_omzet') + rawBudget(bv, month, 'omzet_periode_allocatie')
    }

    // FTE voor de forecast-maand (forward-fill via getFteLe).
    const fteForecast = fteOfBv(bvId, month)
    const seasonal = seasonalFactor(bv, month, 'gefactureerde_omzet')
    // Engine self-correction: drift uit historie + growth-trend extrapolatie.
    // Beide multiplicatief, met soft weights en caps in de helpers zelf.
    const drift = driftCorrection(bv, 'netto_omzet')
    const growth = growthTrendFactor(bv, month)
    const correction = drift * growth

    // Pad 1 — FTE-aware: rev/FTE/maand × FTE_le × seasonal × leaveAdj × correction.
    if (fteSum > 0 && fteForecast > 0) {
      const revPerFteMonth = revSum / fteSum
      const baselineLeavePerFte = leaveSum / fteSum
      let leaveAdj = 1
      const h = hoursEntries.find(e => e.bv === bvId && e.month === month)
      const plannedLeave = h ? (h.vakantie ?? 0) + (h.ziekte ?? 0) : 0
      if (plannedLeave > 0) {
        const plannedLeavePerFte = plannedLeave / fteForecast
        const excessLeavePerFte = Math.max(0, plannedLeavePerFte - baselineLeavePerFte)
        const capacityPerFte = workdaysInMonth(month) * HOURS_PER_FTE_PER_DAY
        if (capacityPerFte > 0) {
          leaveAdj = 1 - Math.min(excessLeavePerFte / capacityPerFte, 0.5)
        }
      }
      return Math.round(fteForecast * revPerFteMonth * seasonal * leaveAdj * correction)
    }

    // Pad 2 — geen FTE-koppeling beschikbaar: avg revenue per maand × seasonal.
    const avgPerMonthRev = revSum / Math.max(1, revMonths)
    return Math.round(avgPerMonthRev * seasonal * correction)
  }

  /** Forecast voor een revenue-sub (gefactureerd vs allocatie) — totaal × split,
   *  geblendt met het ingegeven budget zodat budget-aanpassingen doorwerken. */
  const forecastRevenueSub = (bv: EntityName, month: string, key: string): number => {
    if (bv === 'Holdings') return 0
    const total = forecastRevenueTotal(bv, month)
    const window = recentClosedWindow(closedMonths, month, RECENCY_WINDOW)
    const split = revenueSubSplit({ bv: bv as BvId, window, getMonthly })
    const budgetVal = rawBudget(bv, month, key)
    if (key === 'gefactureerde_omzet') return blendWithBudget(total * split.gefactureerd, budgetVal)
    if (key === 'omzet_periode_allocatie') return blendWithBudget(total * split.allocatie, budgetVal)
    return 0
  }

  /** Sub → aggregate-parent lookup. Voor cost-subs hangen ze onder
   *  directe_kosten of operationele_kosten; voor A&A onder amortisatie_
   *  afschrijvingen. Voor "los staande" keys (financieel_resultaat, VPB)
   *  returnt deze null en valt de forecast terug op budget. */
  const aggregateKeyForSub = (subKey: string): string | null => {
    for (const [aggKey, subs] of Object.entries(SUBS_OF)) {
      if (subs.includes(subKey)) return aggKey
    }
    return null
  }

  /** Default-verdeling per aggregaat voor het geval een sub historisch geen
   *  bijdrage heeft (bv. de gebruiker vult alleen op aggregaat-niveau in).
   *  Bedragen sommen tot 1 per aggregaat. Cijfers gebaseerd op TPG-typische
   *  consultancy-mix: personeel domineert, inkoop is passthrough, etc. */
  const DEFAULT_SHARES: Record<string, Record<string, number>> = {
    directe_kosten: {
      directe_personeelskosten: 0.70,
      directe_inkoopkosten: 0.15,
      directe_overige_personeelskosten: 0.10,
      directe_autokosten: 0.05,
    },
    operationele_kosten: {
      indirecte_personeelskosten: 0.30,
      overige_personeelskosten: 0.10,
      huisvestingskosten: 0.18,
      automatiseringskosten: 0.15,
      indirecte_autokosten: 0.05,
      verkoopkosten: 0.07,
      algemene_kosten: 0.10,
      doorbelaste_kosten: 0.05,
    },
    amortisatie_afschrijvingen: {
      amortisatie_goodwill: 0.40,
      amortisatie_software: 0.30,
      afschrijvingen: 0.30,
    },
  }

  /** Historische share van een sub in zijn aggregaat over het window. Als
   *  aggrSum 0 is (geen historie), gebruikt de default-verdeling. Als de sub
   *  zelf 0 had in historie maar de aggregaat-totalen ≠ 0, retourneert 0 —
   *  m.a.w. die sub krijgt geen toewijzing tenzij default-mode triggert. */
  const historicalSubShare = (
    bv: EntityName, subKey: string, aggrKey: string, window: string[],
  ): number => {
    let subSum = 0, aggrSum = 0
    for (const m of window) {
      subSum += rawActual(bv, m, subKey)
      aggrSum += rawActual(bv, m, aggrKey)
    }
    if (aggrSum === 0) {
      return DEFAULT_SHARES[aggrKey]?.[subKey] ?? 0
    }
    return subSum / aggrSum
  }

  /** Forecast op aggregaat-niveau. Methodiek hangt af van de aggregaat-key:
   *
   *  - directe_kosten: cost-to-revenue ratio × revenue-forecast.
   *    Directe kosten (personeel/inkoop/overige/auto) zijn voor TPG sterk
   *    revenue-gekoppeld — méér declarabele uren = meer kostprijs. Een
   *    historische ratio (kost / omzet over het window) × de nieuwe revenue-
   *    forecast houdt brutomarge%-stabiel door de seizoenscyclus heen. Voor
   *    Holdings (geen omzet) valt deze terug op de FTE-aware pad.
   *
   *  - operationele_kosten: FTE-based × seasonal × EBITDA-drift.
   *    OpEx (huur, IT, verkoop, doorbelaste) is grotendeels overhead — schaalt
   *    met headcount, niet met directe revenue-pieken.
   *
   *  - amortisatie_afschrijvingen: avg per maand × seasonal.
   *    Vaste afschrijvingsbedragen; geen FTE- of revenue-koppeling.
   */
  const forecastAggregateCost = (
    bv: EntityName, month: string, aggrKey: string, window: string[],
  ): number => {
    const budgetForAggr = aggregateBudget(bv, month, aggrKey)
    if (window.length === 0) {
      // Geen historie — som van budgets per sub
      return budgetForAggr
    }

    // ── Directe kosten: cost-to-revenue ratio (margin-anchored) ──
    // Deze aanpak elimineert de brutomarge-spike die ontstaat wanneer revenue
    // sterk seizoens-geschaald is en costs vlak blijven: door costs als een
    // ratio van revenue te modelleren scaleren ze automatisch mee met de
    // forecast.
    if (aggrKey === 'directe_kosten' && bv !== 'Holdings') {
      const bvId = bv as BvId
      let revSum = 0, costSum = 0
      for (const m of window) {
        const r = rawActualRevenue(bvId, m)
        const c = rawActual(bv, m, 'directe_kosten')
        if (r > 0 && c !== 0) {
          revSum += r
          costSum += c
        }
      }
      if (revSum > 0) {
        // Cost-to-revenue ratio is typisch negatief (costs zijn negatief).
        const ratio = costSum / revSum
        const revForecast = forecastRevenueTotal(bv, month)
        return blendWithBudget(revForecast * ratio, budgetForAggr)
      }
      // Geen revenue-historie — val door naar FTE-pad
    }

    // ── OpEx en A&A: FTE-based of avg-per-maand × seasonal × drift ──
    let aggrSum = 0, fteSum = 0, n = 0
    for (const m of window) {
      const v = rawActual(bv, m, aggrKey)
      if (v === 0) continue
      const f = fteOfBv(bv as BvId, m)
      if (f > 0) { fteSum += f; aggrSum += v; n++ }
      else { aggrSum += v; n++ }
    }
    if (n === 0) {
      return budgetForAggr
    }
    const seasonal = seasonalFactor(bv, month, aggrKey)
    // EBITDA-drift alleen op operationele_kosten — directe_kosten heeft al
    // de margin-stabilisering via de revenue-ratio.
    let costDrift = 1
    if (aggrKey === 'operationele_kosten') {
      const ebitdaDrift = driftCorrection(bv, 'ebitda')
      costDrift = 1 + (1 - ebitdaDrift) * 0.5
      costDrift = Math.max(1 - DRIFT_CORRECTION_CAP, Math.min(1 + DRIFT_CORRECTION_CAP, costDrift))
    }

    if (fteSum > 0 && bv !== 'Holdings') {
      const aggrPerFte = aggrSum / fteSum
      const fteForecast = fteOfBv(bv as BvId, month)
      if (fteForecast > 0) {
        return blendWithBudget(aggrPerFte * fteForecast * seasonal * costDrift, budgetForAggr)
      }
    }
    return blendWithBudget((aggrSum / n) * seasonal * costDrift, budgetForAggr)
  }

  /** Forecast voor één cost-sub: aggregaat-forecast × historical share.
   *  Hierdoor:
   *    - Subs schalen samen met de aggregaat (geen brutomarge-spike meer)
   *    - Lege subs (user vult op aggregaat-niveau in) krijgen via defaults
   *      alsnog een waarde — geen "—" in de Budgetten-tab meer.
   *    - Sums van subs = aggregate, dus margin-% klopt over actual→LE-grens. */
  const forecastSubFromAggregate = (
    bv: EntityName, month: string, key: string, window: string[],
  ): number => {
    const aggrKey = aggregateKeyForSub(key)
    if (!aggrKey) return rawBudget(bv, month, key)
    const aggrForecast = forecastAggregateCost(bv, month, aggrKey, window)
    const share = historicalSubShare(bv, key, aggrKey, window)
    // forecastAggregateCost is al budget-geblendt op aggregate-niveau. Daarna
    // alsnog blenden op sub-niveau zorgt dat een sub-specifieke budget-edit
    // (bv. enkel verkoopkosten omhoog) zichtbaar wordt in die ene sub-cell.
    return blendWithBudget(aggrForecast * share, rawBudget(bv, month, key))
  }

  /** Centrale forecast-functie per sub-key. */
  const forecastSub = (bv: EntityName, month: string, key: string): number => {
    if (isRevenueSub(key)) return forecastRevenueSub(bv, month, key)
    const window = recentClosedWindow(closedMonths, month, RECENCY_WINDOW)
    // Cost-subs (directe + OpEx + A&A): aggregate-niveau forecast × share.
    const aggrKey = aggregateKeyForSub(key)
    if (aggrKey) return forecastSubFromAggregate(bv, month, key, window)
    // Echte losstaande keys (financieel_resultaat, VPB) volgen het budget.
    return rawBudget(bv, month, key)
  }

  /** Pre-close LE voor (bv, maand, key): wat de engine had voorspeld op basis
   *  van maanden strikt vóór `month`. Gebruikt voor de variance bridge en de
   *  accuracy-tracker. */
  const forecastSubExcluding = (bv: EntityName, month: string, key: string): number => {
    const tIdx = BUDGET_MONTHS_2026.indexOf(month)
    const priorClosed = closedMonths.filter(cm => BUDGET_MONTHS_2026.indexOf(cm) < tIdx)
    // Tijdelijke override: in de forecast-helpers gebruiken we via closure
    // closedMonths. Voor pre-close LE moeten we hetzelfde mechanisme draaien
    // met een ingekorte window. We doen dit door een mini-versie van de engine
    // hier opnieuw uit te voeren.
    if (priorClosed.length === 0) {
      return rawBudget(bv, month, key)
    }
    if (isRevenueSub(key)) {
      if (bv === 'Holdings') return 0
      const bvId = bv as BvId
      const window = priorClosed.slice(-RECENCY_WINDOW)
      // Zelfde gelaagde fallback als forecastRevenueTotal, maar met priorClosed
      // als window (strikt vóór de target-maand) voor de pre-close LE.
      let revSum = 0, revMonths = 0, fteSum = 0, leaveSum = 0
      for (const m of window) {
        if (hasReflectionFlag(bv, m, 'gefactureerde_omzet', 'one-off')) continue
        const rev = rawActualRevenue(bvId, m)
        if (rev > 0) { revSum += rev; revMonths++ }
        const f = fteOfBv(bvId, m)
        if (f > 0 && rev > 0) {
          fteSum += f
          const h = hoursEntries.find(e => e.bv === bvId && e.month === m)
          leaveSum += h ? (h.vakantie ?? 0) + (h.ziekte ?? 0) : 0
        }
      }
      const seasonal = seasonalFactor(bv, month, 'gefactureerde_omzet')

      // Geen historische revenue → 2025-pattern of budget.
      if (revSum <= 0) {
        const py = monthlyActuals2025[bv]?.[MONTHS_2025_LABELS[BUDGET_MONTHS_2026.indexOf(month)] ?? '']
        const pyRev = (py?.['gefactureerde_omzet'] ?? 0) + (py?.['omzet_periode_allocatie'] ?? 0)
        const total = pyRev > 0 ? Math.round(pyRev) : rawBudget(bv, month, 'gefactureerde_omzet') + rawBudget(bv, month, 'omzet_periode_allocatie')
        const split = revenueSubSplit({ bv: bvId, window, getMonthly })
        if (key === 'gefactureerde_omzet') return Math.round(total * split.gefactureerd)
        return Math.round(total * split.allocatie)
      }

      const fteForecast = fteOfBv(bvId, month)
      let total: number
      if (fteSum > 0 && fteForecast > 0) {
        const revPerFteMonth = revSum / fteSum
        const baselineLeavePerFte = leaveSum / fteSum
        let leaveAdj = 1
        const h = hoursEntries.find(e => e.bv === bvId && e.month === month)
        const plannedLeave = h ? (h.vakantie ?? 0) + (h.ziekte ?? 0) : 0
        if (plannedLeave > 0) {
          const plannedLeavePerFte = plannedLeave / fteForecast
          const excessLeavePerFte = Math.max(0, plannedLeavePerFte - baselineLeavePerFte)
          const capacityPerFte = workdaysInMonth(month) * HOURS_PER_FTE_PER_DAY
          if (capacityPerFte > 0) {
            leaveAdj = 1 - Math.min(excessLeavePerFte / capacityPerFte, 0.5)
          }
        }
        total = Math.round(fteForecast * revPerFteMonth * seasonal * leaveAdj)
      } else {
        const avgPerMonthRev = revSum / Math.max(1, revMonths)
        total = Math.round(avgPerMonthRev * seasonal)
      }
      const split = revenueSubSplit({ bv: bvId, window, getMonthly })
      if (key === 'gefactureerde_omzet') return Math.round(total * split.gefactureerd)
      return Math.round(total * split.allocatie)
    }
    // Cost-subs: aggregate-niveau forecast × historical share, zelfde aanpak
    // als forecastSub maar met priorClosed als window (strikt vóór target).
    const aggrKey = aggregateKeyForSub(key)
    if (aggrKey) {
      const window = priorClosed.slice(-RECENCY_WINDOW)
      const aggrForecast = forecastAggregateCost(bv, month, aggrKey, window)
      const share = historicalSubShare(bv, key, aggrKey, window)
      return Math.round(aggrForecast * share)
    }
    return rawBudget(bv, month, key)
  }

  // ── LE-getters ──────────────────────────────────────────────────────────
  // De aggregate-extras calibration is niet meer nodig sinds cost-subs via
  // forecastSubFromAggregate worden bepaald: de aggregaat-forecast komt direct
  // uit getMonthly[aggregate]-history, en subs verdelen die volgens hun
  // historical share. Sum van subs = aggregaat, dus er is geen "missing"-delta
  // die we apart hoeven op te tellen.
  const rawLE = (bv: EntityName, month: string, key: string): number => {
    const ov = getLeOverride(bv, month, key)
    if (ov != null) return ov
    if (isClosedWithData(bv, month)) return rawActual(bv, month, key)
    return forecastSub(bv, month, key)
  }

  const rawPreCloseLE = (bv: EntityName, month: string, key: string): number => {
    const ov = getLeOverride(bv, month, key)
    if (ov != null) return ov
    return forecastSubExcluding(bv, month, key)
  }

  const getPreCloseLE = (bv: EntityName, month: string, key: string): number => {
    if (AGGREGATE_KEYS.has(key)) {
      // Cost-aggregaten: directe aggregate-forecast (geen sum-of-subs nodig).
      if (key === 'directe_kosten' || key === 'operationele_kosten' || key === 'amortisatie_afschrijvingen') {
        const tIdx = BUDGET_MONTHS_2026.indexOf(month)
        const priorClosed = closedMonths.filter(cm => BUDGET_MONTHS_2026.indexOf(cm) < tIdx)
        const window = priorClosed.slice(-RECENCY_WINDOW)
        return forecastAggregateCost(bv, month, key, window)
      }
      // Revenue-aggregaten: sum van sub-forecasts (al gebaseerd op driver-totaal).
      return SUBS_OF[key].reduce((s, sk) => s + rawPreCloseLE(bv, month, sk), 0)
    }
    if (DERIVED_KEYS.has(key)) {
      return DERIVED_FORMULA[key](sk => getPreCloseLE(bv, month, sk))
    }
    return rawPreCloseLE(bv, month, key)
  }

  const getLE = (bv: EntityName, month: string, key: string): number => {
    // Voor closed maanden gebruiken we de werkelijke aggregaat-waarde (incl.
    // IC-verrekening, accruals, etc.) i.p.v. som-of-subs — dat is wat
    // useAdjustedActuals levert. LE-override wint altijd.
    if (isClosedWithData(bv, month) && (AGGREGATE_KEYS.has(key) || DERIVED_KEYS.has(key))) {
      const ov = getLeOverride(bv, month, key)
      if (ov != null) return ov
      return rawActual(bv, month, key)
    }
    if (AGGREGATE_KEYS.has(key)) {
      // Cost-aggregaten: directe aggregate-niveau forecast op basis van
      // historische aggregaat-data (vangt IC-verrekening/accruals/manual
      // corrections op die niet in de sub-keys zitten).
      if (key === 'directe_kosten' || key === 'operationele_kosten' || key === 'amortisatie_afschrijvingen') {
        const window = recentClosedWindow(closedMonths, month, RECENCY_WINDOW)
        return forecastAggregateCost(bv, month, key, window)
      }
      // Revenue-aggregaat: sum van sub-forecasts (allocatie via revenueSubSplit).
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
    if (isClosedWithData(bv, month)) return 'actual'
    return 'forecast'
  }

  const sumLE = (bv: EntityName, months: string[], key: string): number =>
    months.reduce((s, m) => s + getLE(bv, m, key), 0)

  const fyLE = (bv: EntityName, key: string): number =>
    sumLE(bv, BUDGET_MONTHS_2026, key)

  const hasLE: (bv: EntityName, month: string, key: string) => boolean = () => true

  const isClosed = (month: string): boolean => isAnyActual(month)
  const isActualMonth: (bv: EntityName, month: string) => boolean = (bv, month) =>
    isClosedWithData(bv, month)

  return {
    getLE, sumLE, fyLE,
    isClosed, isCalendarPast,
    getLeSource, hasLE, isActualMonth,
    getPreCloseLE,
  }
}
