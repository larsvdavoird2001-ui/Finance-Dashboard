// LE-reflectie engine: vergelijkt actuals met (1) budget en (2) pre-close LE,
// en genereert dynamische controle-vragen aan de hand van de grootste
// afwijkingen. De vragen zijn niet hard-coded — ze worden afgeleid uit de
// werkelijke cijfers, dus iedere maand kan andere vragen krijgen.
//
// Pre-close LE-simulatie: we re-runnen de forecast-formule (60% seizoen ×
// YTD-perfMult + 40% run-rate, gecorrigeerd voor FTE-ramp + vakantie) maar
// dan met alleen de maanden vóór de target als baseline. Zo krijgen we de
// LE-schatting die op het moment van de Maandafsluiting ontstaan zou zijn.
//
// Doel: vertel de gebruiker WAAR de prognose afweek, en stel concrete vragen
// zodat de antwoorden later kunnen worden meegewogen in de LE-engine.

import type { EntityName } from '../data/plData'
import { monthlyActuals2025, MONTHS_2025_LABELS } from '../data/plData2025'
import { BUDGET_MONTHS_2026 } from '../store/useBudgetStore'
import type { FteEntry, BvId } from '../data/types'
import type { HoursEntry } from '../store/useHoursStore'
import type { LeSnapshotByBv } from './db'
import { getFteLe } from './fteLe'

const MONTH_CODES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export interface VarianceMetric {
  /** Snel vergelijkbare label, bv. 'Netto omzet' */
  label: string
  /** Sleutel in P&L (voor herkenning) */
  key: string
  actual: number
  budget: number
  /** Voorspelde waarde via de pre-close LE — d.w.z. wat de forecast zou zijn
   *  geweest met alleen de maanden vóór deze maand als baseline. */
  preCloseLe: number
  /** delta = actual - budget */
  vsBudget: number
  vsBudgetPct: number
  /** delta = actual - pre-close LE */
  vsLe: number
  vsLePct: number
  /** Hogere actual is positief voor omzet/marge, voor kosten negatief. */
  costlike: boolean
}

export interface ReflectionContext {
  /** De maand waarop de reflectie betrekking heeft, bv. 'Mar-26'. */
  month: string
  /** De BV waarop de reflectie betrekking heeft. */
  bv: EntityName
  variances: VarianceMetric[]
  /** FTE-mutatie t.o.v. vorige maand. */
  fteDelta: number | null
  fteCurrent: number
  ftePrev: number | null
  /** FTE-budget voor deze maand (uit Budgetten-tab) en de variance. null
   *  betekent: geen budget ingegeven (bv. Software waar geen FTE-budget loopt). */
  fteBudget: number | null
  fteVsBudget: number | null
  /** Declarabiliteit deze maand vs gemiddelde van eerdere closed months. */
  declarability: number
  declarabilityPrevAvg: number
  /** Capaciteits-percentages — actual (afgeleid uit hours-uren) en budget
   *  (uit Budgetten-tab). Variance = actual - budget in procentpunten.
   *  null fields = niet beschikbaar (bv. geen budget). */
  capacityActual: { productive: number; leave: number; nonproductive: number; sick: number } | null
  capacityBudget: { productive: number | null; leave: number | null; nonproductive: number | null; sick: number | null } | null
  /** Vakantie/ziekte-uren in deze maand. */
  vakantie: number
  ziekte: number
  /** Run-rate deltas voor narrative. */
  prevMonth: string | null
  prevMonthRevenue: number
  /** Same-month 2025 voor seasonality-discussie. */
  sameMonth2025Revenue: number
}

export interface AiQuestion {
  id: string
  /** De getoonde vraag (NL). Bevat live cijfers. */
  question: string
  /** Korte hint die de gebruiker stuurt zonder te sturen. */
  hint?: string
  /** Concrete voorbeeld-antwoorden — getoond als clickbare chips onder de
   *  vraag zodat de gebruiker met één klik kan beginnen. */
  suggestions?: string[]
  /** Categorie, voor styling/icoon. */
  category: 'fte' | 'declarability' | 'revenue' | 'cost' | 'margin' | 'leave' | 'general'
  /** Hoe groot de afwijking was — gebruikt voor sortering. Hoger = belangrijker. */
  weight: number
}

/* ─────────────────────────────────────────────────────────────────────── */

const fmtEur = (n: number): string => {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${sign}€${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 10_000)    return `${sign}€${(abs / 1000).toFixed(0)}k`
  if (abs >= 1000)      return `${sign}€${(abs / 1000).toFixed(1)}k`
  return `${sign}€${Math.round(abs)}`
}

const monthIdx = (m: string): number => {
  const [mmm] = m.split('-')
  return MONTH_CODES.indexOf(mmm)
}

const toPY = (m: string): string => {
  const idx = BUDGET_MONTHS_2026.indexOf(m)
  return idx >= 0 ? MONTHS_2025_LABELS[idx] : m.replace('-26', '-25')
}

/** Ramp-up factor voor nieuwe FTE — match BudgetsTab/useLatestEstimate. */
function rampFactor(monthsSinceFirstHire: number): number {
  if (monthsSinceFirstHire < 0) return 0
  if (monthsSinceFirstHire === 0) return 0.7
  if (monthsSinceFirstHire === 1) return 0.9
  return 1.0
}

/** Pre-close LE-forecast voor één sub-key. Mirror van forecastSub in
 *  useLatestEstimate, maar met een aangepaste `priorClosed`-set i.p.v. de
 *  globale closedMonths. Daarmee simuleren we de LE die WAS opgesteld vóór
 *  deze maand werd afgesloten. */
function forecastForKey(args: {
  bv: EntityName
  month: string
  key: string
  priorClosed: string[]
  getMonthly: (bv: EntityName, m: string) => Record<string, number>
  getFte: (bv: EntityName, m: string) => number
  getHours: (bv: EntityName, m: string) => HoursEntry | undefined
  fteEntries: FteEntry[]
  isFinalized: (m: string) => boolean
}): number {
  const { bv, month, key, priorClosed, getMonthly, getFte, getHours, fteEntries, isFinalized } = args

  const sameMonth2025 = monthlyActuals2025[bv]?.[toPY(month)]?.[key] ?? 0
  let ytd2026 = 0, ytd2025 = 0
  for (const cm of priorClosed) {
    ytd2026 += getMonthly(bv, cm)[key] ?? 0
    ytd2025 += monthlyActuals2025[bv]?.[toPY(cm)]?.[key] ?? 0
  }
  const perfMult = ytd2025 !== 0 ? ytd2026 / ytd2025 : 1
  const lastClosed = priorClosed.length > 0 ? priorClosed[priorClosed.length - 1] : null
  const lastActual = lastClosed ? (getMonthly(bv, lastClosed)[key] ?? 0) : 0

  // FTE-adj — gebruikt de gedeelde FTE-LE-logica zodat het FTE-tekort vs budget
  // ook in de pre-close LE-simulatie meeschuift naar omzet/kosten.
  let fteAdj = 1
  if (bv !== 'Holdings' && lastClosed) {
    const fteLast = getFte(bv, lastClosed)
    if (fteLast > 0) {
      const tIdx = BUDGET_MONTHS_2026.indexOf(month)
      const cIdx = BUDGET_MONTHS_2026.indexOf(lastClosed)
      let plannedFte = fteLast, firstChangeIdx = -1
      for (let i = cIdx + 1; i <= tIdx && i >= 0; i++) {
        const mm = BUDGET_MONTHS_2026[i]
        const f = getFteLe({ entries: fteEntries, bv: bv as BvId, month: mm, isFinalized })
        if (f != null && f > 0) {
          plannedFte = f
          if (firstChangeIdx < 0 && f !== fteLast) firstChangeIdx = i
        }
      }
      const fteDelta = plannedFte - fteLast
      if (fteDelta <= 0) {
        fteAdj = plannedFte / fteLast
      } else {
        const monthsSinceHire = firstChangeIdx >= 0 ? tIdx - firstChangeIdx : 0
        const ramp = rampFactor(monthsSinceHire)
        const effectiveFte = fteLast + fteDelta * ramp
        fteAdj = effectiveFte / fteLast
      }
    }
  }

  // Leave-adj op omzet-keys.
  let leaveAdj = 1
  const isRevenueKey = key === 'netto_omzet' || key === 'gefactureerde_omzet'
  if (bv !== 'Holdings' && priorClosed.length > 0 && isRevenueKey) {
    const plannedVakantie = getHours(bv, month)?.vakantie ?? 0
    if (plannedVakantie > 0) {
      let baselineWork = 0, baselineCount = 0
      for (const cm of priorClosed) {
        const he = getHours(bv, cm)
        if (he) { baselineWork += he.declarable + he.internal; baselineCount++ }
      }
      const avgWork = baselineCount > 0 ? baselineWork / baselineCount : 0
      if (avgWork > 0) {
        const leaveRatio = Math.min(plannedVakantie / avgWork, 0.5)
        leaveAdj = 1 - leaveRatio
      }
    }
  }

  const combinedAdj = fteAdj * leaveAdj
  const seasonal = sameMonth2025 * perfMult * combinedAdj
  const runRate  = lastActual * combinedAdj
  if (seasonal === 0 && runRate === 0) return 0
  if (seasonal === 0) return Math.round(runRate)
  if (runRate === 0)  return Math.round(seasonal)
  return Math.round(0.6 * seasonal + 0.4 * runRate)
}

/** Bouw de reflectie-context voor (bv, targetMonth). priorClosed zijn de
 *  maanden VÓÓR targetMonth — die werden gebruikt om de pre-close LE te
 *  bepalen. */
export function buildReflectionContext(args: {
  bv: EntityName
  targetMonth: string
  /** Alle calendar-past maanden t/m targetMonth (inclusief). */
  closedMonthsIncl: string[]
  getMonthly: (bv: EntityName, m: string) => Record<string, number>
  getBudget: (bv: EntityName, m: string, key: string) => number
  fteEntries: FteEntry[]
  hoursEntries: HoursEntry[]
  /** Capaciteit-budget % uit Budgetten-tab (useBudgetStore.overrides) per
   *  categorie. key ∈ { 'capacity_productive_pct', 'capacity_leave_pct',
   *  'capacity_nonproductive_pct', 'capacity_sick_pct' }. */
  getCapacityBudgetPct?: (bv: EntityName, m: string, key: string) => number | undefined
  /** Optionele LE-snapshot uit de Maandafsluiting van targetMonth — als
   *  aanwezig wordt deze waarde gebruikt voor preCloseLe i.p.v. de live
   *  forecast-simulatie. Zo komen de getallen in dit panel exact overeen
   *  met de popup die de gebruiker bij het finaliseren zag. Per BV; alleen
   *  netto_omzet / brutomarge / ebitda zitten in de snapshot — andere keys
   *  vallen terug op de live simulatie. */
  preCloseLeOverride?: LeSnapshotByBv
  /** Optionele injectie van de driver-based pre-close LE-functie (uit
   *  useLatestEstimate). Wanneer geleverd wordt deze als primaire bron
   *  gebruikt — anders valt de context terug op de oude forecastForKey-
   *  simulatie (legacy compat). */
  getPreCloseLE?: (bv: EntityName, m: string, key: string) => number
}): ReflectionContext {
  const { bv, targetMonth, closedMonthsIncl, getMonthly, getBudget, fteEntries, hoursEntries, getCapacityBudgetPct, preCloseLeOverride, getPreCloseLE } = args
  const priorClosed = closedMonthsIncl.filter(m => monthIdx(m) < monthIdx(targetMonth))
  const prevMonth = priorClosed.length > 0 ? priorClosed[priorClosed.length - 1] : null

  const getFte = (e: EntityName, m: string): number =>
    fteEntries.find(x => x.bv === e && x.month === m && !x.vertical)?.fte ?? 0
  const getHours = (e: EntityName, m: string): HoursEntry | undefined =>
    hoursEntries.find(x => x.bv === e && x.month === m)

  // Sleutels die we vergelijken — relevante P&L-regels.
  const KEYS: Array<{ key: string; label: string; costlike: boolean }> = [
    { key: 'netto_omzet',                 label: 'Netto omzet',                 costlike: false },
    { key: 'directe_kosten',              label: 'Directe kosten',              costlike: true  },
    { key: 'directe_personeelskosten',    label: 'Directe personeelskosten',    costlike: true  },
    { key: 'directe_inkoopkosten',        label: 'Directe inkoopkosten',        costlike: true  },
    { key: 'brutomarge',                  label: 'Brutomarge',                  costlike: false },
    { key: 'operationele_kosten',         label: 'Operationele kosten',         costlike: true  },
    { key: 'ebitda',                      label: 'EBITDA',                      costlike: false },
  ]

  /** Lookup van de pre-close LE voor (key) — eerst de opgeslagen snapshot uit
   *  de Maandafsluiting (matcht 1-op-1 met wat in de popup stond), anders een
   *  live re-simulatie. Snapshot dekt alleen netto_omzet / brutomarge / ebitda;
   *  andere keys vallen altijd door naar simulatie. */
  const priorClosedSet = new Set(priorClosed)
  const isFinalizedAtSnapshot = (m: string): boolean => priorClosedSet.has(m)
  const preCloseLookup = (key: string): number => {
    if (preCloseLeOverride) {
      if (key === 'netto_omzet' && preCloseLeOverride.netto_omzet != null) return preCloseLeOverride.netto_omzet
      if (key === 'brutomarge'  && preCloseLeOverride.brutomarge  != null) return preCloseLeOverride.brutomarge
      if (key === 'ebitda'      && preCloseLeOverride.ebitda      != null) return preCloseLeOverride.ebitda
    }
    // Driver-engine wint wanneer beschikbaar — anders fallback op de oude
    // seasonal/run-rate simulatie. forecastForKey blijft staan voor unit-
    // tests en als safety-net, maar in de live UI levert useLatestEstimate
    // de pre-close LE.
    if (getPreCloseLE) return getPreCloseLE(bv, targetMonth, key)
    return forecastForKey({
      bv, month: targetMonth, key,
      priorClosed, getMonthly, getFte, getHours,
      fteEntries, isFinalized: isFinalizedAtSnapshot,
    })
  }

  const variances: VarianceMetric[] = KEYS.map(k => {
    const actual = getMonthly(bv, targetMonth)[k.key] ?? 0
    const budget = getBudget(bv, targetMonth, k.key)
    const preCloseLe = preCloseLookup(k.key)
    const vsBudget = actual - budget
    const vsLe = actual - preCloseLe
    const denomB = budget !== 0 ? Math.abs(budget) : 0
    const denomL = preCloseLe !== 0 ? Math.abs(preCloseLe) : 0
    return {
      label: k.label,
      key: k.key,
      actual,
      budget,
      preCloseLe,
      vsBudget,
      vsBudgetPct: denomB > 0 ? (vsBudget / denomB * 100) : 0,
      vsLe,
      vsLePct: denomL > 0 ? (vsLe / denomL * 100) : 0,
      costlike: k.costlike,
    }
  })

  // FTE-mutatie t.o.v. vorige maand.
  const fteCurrent = getFte(bv, targetMonth)
  const ftePrev = prevMonth ? getFte(bv, prevMonth) : null
  const fteDelta = fteCurrent > 0 && ftePrev != null && ftePrev > 0 ? fteCurrent - ftePrev : null

  // FTE-budget voor deze maand (Budgetten-tab) — variance vs actual.
  const fteBudgetRaw = fteEntries.find(x => x.bv === bv && x.month === targetMonth && !x.vertical)?.fteBudget
  const fteBudget = fteBudgetRaw != null && fteBudgetRaw > 0 ? fteBudgetRaw : null
  const fteVsBudget = (fteBudget != null && fteCurrent > 0) ? fteCurrent - fteBudget : null

  // Declarabiliteit: deze maand vs gem. eerdere maanden.
  const heCur = getHours(bv, targetMonth)
  const declarability = heCur && (heCur.declarable + heCur.internal) > 0
    ? (heCur.declarable / (heCur.declarable + heCur.internal) * 100)
    : 0
  let prevDeclSum = 0, prevDeclCount = 0
  for (const m of priorClosed) {
    const he = getHours(bv, m)
    if (he && (he.declarable + he.internal) > 0) {
      prevDeclSum += (he.declarable / (he.declarable + he.internal) * 100)
      prevDeclCount++
    }
  }
  const declarabilityPrevAvg = prevDeclCount > 0 ? prevDeclSum / prevDeclCount : 0

  // ── Capaciteit-actual % vs budget % ───────────────────────────────────
  // Actual = afgeleid uit de hours-store (zelfde formule als HoursTab/Budgetten):
  //   productive    = declarable
  //   leave         = vakantie + overigVerlof
  //   nonproductive = internal  (missing-uren niet apart in maand-store)
  //   sick          = ziekte
  // Noemer = som van alle vier (= totaal aantal uren waarop we %-en bouwen).
  let capacityActual: ReflectionContext['capacityActual'] = null
  if (heCur) {
    const productive    = heCur.declarable
    const leave         = heCur.vakantie + heCur.overigVerlof
    const nonproductive = heCur.internal
    const sick          = heCur.ziekte
    const totaal = productive + leave + nonproductive + sick
    if (totaal > 0) {
      capacityActual = {
        productive:    (productive / totaal) * 100,
        leave:         (leave / totaal) * 100,
        nonproductive: (nonproductive / totaal) * 100,
        sick:          (sick / totaal) * 100,
      }
    }
  }

  let capacityBudget: ReflectionContext['capacityBudget'] = null
  if (getCapacityBudgetPct) {
    const p = getCapacityBudgetPct(bv, targetMonth, 'capacity_productive_pct')
    const l = getCapacityBudgetPct(bv, targetMonth, 'capacity_leave_pct')
    const n = getCapacityBudgetPct(bv, targetMonth, 'capacity_nonproductive_pct')
    const s = getCapacityBudgetPct(bv, targetMonth, 'capacity_sick_pct')
    // Alleen wegschrijven als minstens één categorie ingegeven is
    if ((p ?? 0) > 0 || (l ?? 0) > 0 || (n ?? 0) > 0 || (s ?? 0) > 0) {
      capacityBudget = {
        productive:    (p ?? 0) > 0 ? p! : null,
        leave:         (l ?? 0) > 0 ? l! : null,
        nonproductive: (n ?? 0) > 0 ? n! : null,
        sick:          (s ?? 0) > 0 ? s! : null,
      }
    }
  }

  return {
    month: targetMonth,
    bv,
    variances,
    fteDelta,
    fteCurrent,
    ftePrev,
    fteBudget,
    fteVsBudget,
    declarability,
    declarabilityPrevAvg,
    capacityActual,
    capacityBudget,
    vakantie: heCur?.vakantie ?? 0,
    ziekte: heCur?.ziekte ?? 0,
    prevMonth,
    prevMonthRevenue: prevMonth ? (getMonthly(bv, prevMonth)['netto_omzet'] ?? 0) : 0,
    sameMonth2025Revenue: monthlyActuals2025[bv]?.[toPY(targetMonth)]?.['netto_omzet'] ?? 0,
  }
}

// ── 5 driver-vragen voor de LE-leerlus ──────────────────────────────────────
// Mapping op de variance-componenten van de driver-engine:
//   volume-shift       → Δ FTE / Δ capaciteit
//   rate-shift         → Δ effectief €/uur (price)
//   utilization-shift  → Δ declarability % (mix)
//   one-off-month      → eenmalige posten in deze maand (timing)
//   cost-step-change   → structurele wijziging in een kostenpost
//
// Triggers zijn deterministisch o.b.v. variances vs pre-close LE. Bij meer
// dan vijf signalen sorteren we op weight en pakken de top 5; in de praktijk
// zullen er per maand zelden meer dan 2-3 vragen tegelijk verschijnen.
export function generateAiQuestions(ctx: ReflectionContext): AiQuestion[] {
  const { month, bv, variances, fteDelta, fteCurrent, ftePrev, fteBudget, fteVsBudget, declarability, declarabilityPrevAvg } = ctx

  const rev    = variances.find(v => v.key === 'netto_omzet')
  const dirCst = variances.find(v => v.key === 'directe_kosten')
  const opex   = variances.find(v => v.key === 'operationele_kosten')
  const ebitda = variances.find(v => v.key === 'ebitda')

  const out: AiQuestion[] = []

  // ── 1. VOLUME-SHIFT: FTE-verandering ──
  // Trigger: |Δ FTE MoM| ≥ 1.0 OF |Δ FTE vs budget| ≥ 0.5
  const hasMomDelta    = fteDelta != null && Math.abs(fteDelta) >= 1
  const hasBudgetDelta = fteBudget != null && fteVsBudget != null && Math.abs(fteVsBudget) >= 0.5
  if (hasMomDelta || hasBudgetDelta) {
    const parts: string[] = []
    if (hasMomDelta) {
      parts.push(`${fteDelta! >= 0 ? '+' : ''}${fteDelta!.toFixed(1)} MoM`)
    }
    if (hasBudgetDelta) {
      parts.push(`${fteVsBudget! >= 0 ? '+' : ''}${fteVsBudget!.toFixed(1)} vs budget`)
    }
    out.push({
      id: 'volume-shift',
      question: `FTE-bezetting ${fteCurrent.toFixed(1)} (${parts.join(' · ')}). Is dit een structurele bezetting voor de rest van het jaar, of een tijdelijke afwijking?`,
      hint: 'Structureel → engine schaalt omzet en directe personeelskosten mee voor ROY · Eenmalig → alleen deze maand getroffen.',
      suggestions: ['nieuwe hire', 'vertrek', 'vacature open', 'ouderschapsverlof', 'freelance-buffer'],
      category: 'fte',
      weight: Math.max(
        hasMomDelta    ? Math.abs(fteDelta!)    * 50000 : 0,
        hasBudgetDelta ? Math.abs(fteVsBudget!) * 75000 : 0,
      ),
    })
  }

  // ── 2. RATE-SHIFT: omzet-afwijking die NIET (geheel) door FTE komt ──
  // Trigger: |vs LE| ≥ 3% & €5k; rate-component is "wat overblijft na volume".
  if (rev && Math.abs(rev.vsLePct) > 3 && Math.abs(rev.vsLe) > 5000) {
    out.push({
      id: 'rate-shift',
      question: `Omzet ${fmtEur(rev.actual)} = ${rev.vsLe >= 0 ? '+' : ''}${fmtEur(rev.vsLe)} (${rev.vsLePct >= 0 ? '+' : ''}${rev.vsLePct.toFixed(1)}%) vs LE. Komt dit door een verandering in tarief of klant-mix?`,
      hint: 'Structureel → engine gebruikt het nieuwe tariefniveau voor ROY-omzet · Eenmalig → blijft buiten de baseline.',
      suggestions: ['tariefverhoging', 'andere klant-mix', 'contract-onderhandeling', 'extra projectomzet', 'minder schaalbaar werk'],
      category: 'revenue',
      weight: Math.abs(rev.vsLe),
    })
  }

  // ── 3. UTILIZATION-SHIFT: declarability% verschuift ──
  // Trigger: |Δ declarability vs gemiddelde eerdere maanden| ≥ 3 pp.
  if (declarability > 0 && declarabilityPrevAvg > 0 && Math.abs(declarability - declarabilityPrevAvg) >= 3) {
    const diff = declarability - declarabilityPrevAvg
    out.push({
      id: 'utilization-shift',
      question: `Declarability ${declarability.toFixed(1)}% (${diff >= 0 ? '+' : ''}${diff.toFixed(1)} pp vs gem. ${declarabilityPrevAvg.toFixed(1)}%). Verandert dit utilization-niveau structureel of is dit eenmalig?`,
      hint: 'Structureel → engine ankert het nieuwe niveau voor ROY · Eenmalig → maand wordt uit baseline gehaald.',
      suggestions: ['groot project gestart', 'project afgelopen', 'pipeline-shift', 'seizoenseffect', 'bench-tijd'],
      category: 'declarability',
      weight: Math.abs(diff) * 8000,
    })
  }

  // ── 4. ONE-OFF-MONTH: EBITDA wijkt fors af van LE ──
  // Trigger: |vs LE| ≥ 10% & €20k. Bedoeld voor restitutties, settlements,
  // boekings-correcties en andere posten die NIET door mogen werken.
  if (ebitda && Math.abs(ebitda.vsLePct) > 10 && Math.abs(ebitda.vsLe) > 20000) {
    out.push({
      id: 'one-off-month',
      question: `EBITDA ${fmtEur(ebitda.actual)} = ${ebitda.vsLe >= 0 ? '+' : ''}${fmtEur(ebitda.vsLe)} (${ebitda.vsLePct >= 0 ? '+' : ''}${ebitda.vsLePct.toFixed(1)}%) vs LE. Zit hier een eenmalige post in die NIET door moet werken naar de rest van het jaar?`,
      hint: 'Eenmalig → engine excludeert deze maand uit de baseline · Structureel → het nieuwe niveau wordt ankerpunt voor ROY.',
      suggestions: ['settlement', 'restitutie', 'accrual-correctie', 'project-afsluiting', 'eenmalige bonus'],
      category: 'general',
      weight: Math.abs(ebitda.vsLe) * 0.4,
    })
  }

  // ── 5. COST-STEP-CHANGE: structurele kosten-shift ──
  // Trigger: directe kosten |vs LE| ≥ 6% & €15k, of OpEx ≥ 8% & €10k.
  const costCands: Array<{ label: string; v: VarianceMetric }> = []
  if (dirCst && Math.abs(dirCst.vsLePct) > 6 && Math.abs(dirCst.vsLe) > 15000) {
    costCands.push({ label: 'Directe kosten', v: dirCst })
  }
  if (opex && Math.abs(opex.vsLePct) > 8 && Math.abs(opex.vsLe) > 10000) {
    costCands.push({ label: 'Operationele kosten', v: opex })
  }
  if (costCands.length > 0) {
    const c = costCands.sort((a, b) => Math.abs(b.v.vsLe) - Math.abs(a.v.vsLe))[0]
    out.push({
      id: 'cost-step-change',
      question: `${c.label} ${fmtEur(c.v.actual)} = ${c.v.vsLe >= 0 ? '+' : ''}${fmtEur(c.v.vsLe)} (${c.v.vsLePct >= 0 ? '+' : ''}${c.v.vsLePct.toFixed(1)}%) vs LE. Is dit een structurele kosten-shift of een eenmalige boeking?`,
      hint: 'Structureel → engine ankert het nieuwe kostenniveau voor ROY · Eenmalig → maand valt buiten de baseline.',
      suggestions: ['huur-indexatie', 'nieuwe leverancier', 'contract-aanpassing', 'payroll-verhoging', 'eenmalige boeking'],
      category: 'cost',
      weight: Math.abs(c.v.vsLe),
    })
  }

  // Sorteer op weight en cap op 4 — alleen de meest materiële afwijkingen.
  return out.sort((a, b) => b.weight - a.weight).slice(0, 4)
}
