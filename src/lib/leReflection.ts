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
}): ReflectionContext {
  const { bv, targetMonth, closedMonthsIncl, getMonthly, getBudget, fteEntries, hoursEntries, getCapacityBudgetPct, preCloseLeOverride } = args
  const priorClosed = closedMonthsIncl.filter(m => monthIdx(m) < monthIdx(targetMonth))
  const prevMonth = priorClosed.length > 0 ? priorClosed[priorClosed.length - 1] : null

  const getFte = (e: EntityName, m: string): number =>
    fteEntries.find(x => x.bv === e && x.month === m)?.fte ?? 0
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
  const fteBudgetRaw = fteEntries.find(x => x.bv === bv && x.month === targetMonth)?.fteBudget
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

/** Index-based variant-keuze — vermijdt hash-collisions bij modulo-kleine
 *  arrays. Door monthIdx en bvIdx als priem-vermenigvuldigers te combineren
 *  garanderen we dat opeenvolgende maanden (en opeenvolgende BV's) altijd
 *  een ander phrasing-template krijgen, zelfs voor dezelfde vraag-id. */
const BV_ORDER = ['Consultancy', 'Projects', 'Software', 'Holdings'] as const
function variantIdx(arrLen: number, month: string, bv: string, qId: string): number {
  const mi = BUDGET_MONTHS_2026.indexOf(month)              // 0..11
  const bi = (BV_ORDER as readonly string[]).indexOf(bv)    // 0..3
  // qSalt = som van charcodes — geeft elke vraag-id zijn eigen "startoffset".
  let qSalt = 0
  for (let i = 0; i < qId.length; i++) qSalt += qId.charCodeAt(i)
  // Priem-multiplikatoren maken (mi, bi)-paren goed gespreid.
  const raw = mi * 7 + bi * 13 + qSalt
  return ((raw % arrLen) + arrLen) % arrLen
}
function pick<T>(arr: T[], month: string, bv: string, qId: string): T {
  return arr[variantIdx(arr.length, month, bv, qId)]
}

/** Genereer max 3 controle-vragen op basis van de grootste afwijkingen.
 *  Compact gehouden: alleen de top-3 op weight overleeft de slice, en de
 *  fallback-vragen (EBITDA / seasonal) komen pas in beeld als er ruimte
 *  is na de hoofd-drijvers.
 *
 *  Voor iedere trigger zijn meerdere phrasings beschikbaar — we kiezen er
 *  één deterministisch op basis van (month, bv, id). Hierdoor krijgt elke
 *  combinatie een eigen formulering, voelen Jan/Feb/Mar niet als kopieën
 *  van elkaar, en blijft dezelfde combinatie stabiel bij refresh. */
export function generateAiQuestions(ctx: ReflectionContext): AiQuestion[] {
  const out: AiQuestion[] = []
  const { month, bv, variances, fteDelta, fteCurrent, ftePrev, fteBudget, fteVsBudget, declarability, declarabilityPrevAvg, capacityActual, capacityBudget, vakantie, ziekte, prevMonthRevenue, sameMonth2025Revenue } = ctx

  const rev = variances.find(v => v.key === 'netto_omzet')
  const margin = variances.find(v => v.key === 'brutomarge')
  const dirCost = variances.find(v => v.key === 'directe_kosten')
  const dirPers = variances.find(v => v.key === 'directe_personeelskosten')
  const opex = variances.find(v => v.key === 'operationele_kosten')
  const ebitda = variances.find(v => v.key === 'ebitda')

  // Helper voor het kiezen van een variant — passeert (month, bv) zodat
  // opeenvolgende maanden en BVs verschillende phrasings krijgen.
  const v = <T,>(arr: T[], qId: string): T => pick(arr, month, bv, qId)

  // ── Omzet vs LE ────────────────────────────────────────────────────────
  if (rev && Math.abs(rev.vsLePct) > 3 && Math.abs(rev.vsLe) > 5000) {
    const dir = rev.vsLe >= 0 ? 'hoger' : 'lager'
    const meevaller = rev.vsLe >= 0 ? 'meevaller' : 'tegenvaller'
    const phrasings = [
      `${bv} ${month}: netto omzet ${fmtEur(rev.actual)} kwam ${fmtEur(Math.abs(rev.vsLe))} (${rev.vsLePct >= 0 ? '+' : ''}${rev.vsLePct.toFixed(1)}%) ${dir} uit dan de Latest Estimate van ${fmtEur(rev.preCloseLe)}. Welke factor verklaart dit verschil?`,
      `${bv} ${month}: de LE rekende op ${fmtEur(rev.preCloseLe)}, maar de actuals tikten af op ${fmtEur(rev.actual)} (${rev.vsLePct >= 0 ? '+' : ''}${rev.vsLePct.toFixed(1)}%). Waar zit deze ${meevaller} concreet in?`,
      `Onze prognose voor ${bv} in ${month} zat ${rev.vsLePct >= 0 ? '+' : ''}${rev.vsLePct.toFixed(1)}% ernaast (LE ${fmtEur(rev.preCloseLe)} → actual ${fmtEur(rev.actual)}). Welk project, klant of contractmoment maakt het verschil?`,
      `${bv} ${month}: actual ${fmtEur(rev.actual)} ligt ${fmtEur(Math.abs(rev.vsLe))} ${dir} dan voorspeld. Wat heeft de pre-close LE niet kunnen voorzien?`,
    ]
    const hints = [
      'Project-mix shift, vertraagde/vooruitgefactureerde projecten, missing hours, prijsindexatie, uitloop, vroege oplevering, ...',
      'Eenmalige oplevering of milestone? Nieuwe klant gestart? Tarief-aanpassing?',
      'Verschuiving in conceptfacturen, NTF-uren, OHW-mutatie of D-lijst?',
    ]
    out.push({
      id: 'rev-vs-le',
      question: v(phrasings, 'rev-vs-le'),
      hint: v(hints, 'rev-vs-le-h'),
      category: 'revenue',
      weight: Math.abs(rev.vsLe),
    })
  }

  // ── Omzet vs budget (alleen als richting verschilt van LE) ─────────────
  if (rev && Math.abs(rev.vsBudgetPct) > 5 && Math.abs(rev.vsBudget) > 10000 &&
      (rev.vsBudget >= 0) !== (rev.vsLe >= 0)) {
    const phrasings = [
      `${bv} ${month}: omzet ${rev.vsBudgetPct >= 0 ? '+' : ''}${rev.vsBudgetPct.toFixed(1)}% vs budget (${fmtEur(rev.actual)} vs ${fmtEur(rev.budget)}). Waarop was het oorspronkelijke budget gebaseerd dat we nu moeten herzien?`,
      `Het ${bv}-budget voor ${month} (${fmtEur(rev.budget)}) wijkt nu duidelijk af van actual ${fmtEur(rev.actual)}. Welke aanname uit de budget-ronde klopt niet meer?`,
      `${bv} ${month}: ${rev.vsBudgetPct >= 0 ? '+' : ''}${rev.vsBudgetPct.toFixed(1)}% vs budget. Pipeline anders dan verwacht, of klant-mix verschoven sinds de budget-cycle?`,
    ]
    const hints = [
      'Budget-aannames die zijn achterhaald — pipeline, contracten, tarief, capaciteit',
      'Welke klant of project zat hier wel/niet in dat de budget-aannames omzet?',
      'Volume-effect (FTE/uren) of prijs-effect (tarief)?',
    ]
    out.push({
      id: 'rev-vs-budget',
      question: v(phrasings, 'rev-vs-budget'),
      hint: v(hints, 'rev-vs-budget-h'),
      category: 'revenue',
      weight: Math.abs(rev.vsBudget) * 0.6,
    })
  }

  // ── FTE-vraag (mutatie + vs-budget gecombineerd) ──────────────────────
  // Eén FTE-vraag per BV/maand om dubbeling te voorkomen. Trigger:
  //   - significante mutatie t.o.v. vorige maand (|delta| ≥ 1.0), OF
  //   - significante afwijking t.o.v. budget (|vs-budget| ≥ 0.5)
  // De vraag toont beide signalen wanneer ze bestaan, met budget-context
  // erin verwerkt zodat je niet twee keer hoeft te lezen.
  const hasMomDelta    = fteDelta != null && Math.abs(fteDelta) >= 1
  const hasBudgetDelta = fteBudget != null && fteVsBudget != null && Math.abs(fteVsBudget) >= 0.5
  if (hasMomDelta || hasBudgetDelta) {
    // Bouw een kop-zin die beide signalen meeneemt indien aanwezig.
    const parts: string[] = []
    if (hasMomDelta) {
      const sign = fteDelta! >= 0 ? '+' : ''
      const dir  = fteDelta! > 0 ? 'gestegen' : 'gedaald'
      parts.push(`MoM ${sign}${fteDelta!.toFixed(1)} (${ftePrev?.toFixed(1) ?? '?'} → ${fteCurrent.toFixed(1)}, ${dir})`)
    }
    if (hasBudgetDelta) {
      const sign = fteVsBudget! >= 0 ? '+' : ''
      parts.push(`vs budget ${sign}${fteVsBudget!.toFixed(1)} (actual ${fteCurrent.toFixed(1)} · budget ${fteBudget!.toFixed(1)})`)
    }
    const ctx = parts.join(' · ')

    // Phrasings: kies set op basis van wat het sterkste signaal is.
    const dominantBudget = hasBudgetDelta && (!hasMomDelta || Math.abs(fteVsBudget!) * 1.5 > Math.abs(fteDelta ?? 0))
    const phrasings = dominantBudget
      ? [
          `${bv} ${month}: FTE wijkt af van budget — ${ctx}. Wat verklaart de afwijking en moet het FTE-budget voor de komende maanden bijgesteld?`,
          `${bv} ${month}: bezetting ${fteVsBudget! > 0 ? 'hoger' : 'lager'} dan begroot (${ctx}). ${fteVsBudget! > 0 ? 'Vroege hire of extra inhuur?' : 'Hire-plan vertraagd, contract-uitloop?'}`,
          `${bv} ${month}: FTE-budget loopt uit de pas (${ctx}). Pijplijn-vertraging, vacature-status, of versnelde groei?`,
        ]
      : (fteDelta! > 0
        ? [
            `${bv} ${month}: FTE ${ctx}. Welke rollen zijn ingestapt, en hoeveel productiviteit verwacht je in de eerste 1-3 maanden?`,
            `${bv}: hire-update ${month} (${ctx}). Consultants, ondersteuning of leiderschap — en is de pijplijn er klaar voor?`,
            `${bv} ${month}: bezetting groeit (${ctx}). Houdt deze groei aan of stabiliseert het hier?`,
          ]
        : [
            `${bv} ${month}: FTE-krimp (${ctx}). Vertrek, contract-einde of intern-doorschuiven? Wordt er vervangen?`,
            `${bv}: bezetting daalt (${ctx}). Wat betekent dit voor declarable capaciteit volgende maand?`,
            `${bv} ${month}: ${ctx}. Plan om weer aan te vullen of structureel slankere bezetting?`,
          ])
    const hints = dominantBudget
      ? [
          'Hire-vertraging, contract-einde, freelance-buffer, vroege start nieuwe rol',
          'Aanpassen FTE-budget komende maanden of voorzie je dit in te halen?',
          'Heeft dit gevolgen voor de capaciteit-% verdeling (productief/verlof/improductief/ziek)?',
        ]
      : (fteDelta! > 0
        ? [
            'Nieuwe hires (rol, instap-datum?), contract-uitbreiding, terug van verlof',
            'Junior of medior? Verwachte ramp-up tot vol declarabel?',
            'Direct op een specifiek project of bench-tijd?',
          ]
        : [
            'Vertrek (eind contract, opzegging), uitstroom, uitval, end-of-project',
            'Project-impact — wordt overuren of freelance ingezet als overbrugging?',
            'Vacature open of bewuste afslanking?',
          ])
    // Eén vraag-id zodat dezelfde reden niet dubbel wordt opgeslagen.
    const id = dominantBudget ? 'fte-vs-budget' : 'fte-delta'
    out.push({
      id,
      question: v(phrasings, id),
      hint: v(hints, `${id}-h`),
      category: 'fte',
      // Combineer signaal-zwaartes; budget-afwijking weegt iets zwaarder
      // omdat die direct LE/forecast-aannames raakt.
      weight: Math.max(
        hasMomDelta    ? Math.abs(fteDelta!)    * 50000 : 0,
        hasBudgetDelta ? Math.abs(fteVsBudget!) * 75000 : 0,
      ),
    })
  }

  // ── Capaciteits-% vs budget (productief/verlof/improductief/ziek) ─────
  // Trigger: budget % ingegeven én absolute afwijking ≥ 3pp. Per categorie
  // één vraag (de belangrijkste — hoogste afwijking — wordt gepickt).
  if (capacityActual && capacityBudget) {
    type CapKey = 'productive' | 'leave' | 'nonproductive' | 'sick'
    const labels: Record<CapKey, string> = { productive: 'Productief', leave: 'Verlof', nonproductive: 'Improductief', sick: 'Ziek' }
    const cands: Array<{ k: CapKey; actual: number; budget: number; diff: number }> = []
    for (const k of ['productive', 'leave', 'nonproductive', 'sick'] as CapKey[]) {
      const b = capacityBudget[k]
      const a = capacityActual[k]
      if (b == null) continue
      const diff = a - b
      if (Math.abs(diff) >= 3) cands.push({ k, actual: a, budget: b, diff })
    }
    if (cands.length > 0) {
      // Pak de zwaarste afwijking voor de vraag (max 1 capaciteit-vraag per BV
      // om het panel compact te houden).
      cands.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      const top = cands[0]
      const dir = top.diff > 0 ? 'hoger' : 'lager'
      const sign = top.diff >= 0 ? '+' : ''
      const phrasings = [
        `${bv} ${month}: ${labels[top.k]} ${top.actual.toFixed(1)}% vs budget ${top.budget.toFixed(1)}% (${sign}${top.diff.toFixed(1)}pp). Welke factor verschuift het uren-mix t.o.v. plan?`,
        `${bv}: capaciteits-mix in ${month} wijkt af — ${labels[top.k]} ${dir} dan begroot (${sign}${top.diff.toFixed(1)}pp). Bench-tijd, project-pijplijn of vakantie-piek?`,
        `${bv} ${month}: ${labels[top.k]}-percentage ${sign}${top.diff.toFixed(1)}pp t.o.v. capaciteit-budget. Wordt dit structureel of betreft het deze maand?`,
      ]
      const hints = [
        'Project-pijplijn, onboarding nieuwe hires, opleidingsweken, sales-uren, vakantie-spreiding',
        'Past het in de seizoens-pattern of bouwt het iets nieuws op?',
        'Heeft deze afwijking impact op de declarabiliteits-forecast voor de rest van het jaar?',
      ]
      out.push({
        id: 'capacity-vs-budget',
        question: v(phrasings, 'capacity-vs-budget'),
        hint: v(hints, 'capacity-vs-budget-h'),
        category: top.k === 'leave' || top.k === 'sick' ? 'leave' : 'declarability',
        // Weight ~ pp afwijking × FTE-equivalent zodat het naast omzet/marge
        // afwijkingen op nuttige plek in de top-3 valt
        weight: Math.abs(top.diff) * 12000,
      })
    }
  }

  // ── Declarabiliteit-mutatie ────────────────────────────────────────────
  if (declarabilityPrevAvg > 0 && Math.abs(declarability - declarabilityPrevAvg) >= 3) {
    const dir = declarability > declarabilityPrevAvg ? 'hoger' : 'lager'
    const diffPp = Math.abs(declarability - declarabilityPrevAvg).toFixed(1)
    const phrasings = [
      `${bv}: declarabiliteit ${declarability.toFixed(0)}% in ${month} ligt ${diffPp}pp ${dir} dan het Q-gemiddelde van ${declarabilityPrevAvg.toFixed(0)}%. Welke oorzaak — en is dit een trend of een uitschieter?`,
      `${bv} ${month}: declarabel-ratio ${dir} dan gemiddeld (${declarability.toFixed(0)}% vs ${declarabilityPrevAvg.toFixed(0)}%). Bench-tijd, onboarding-druk of project-pijplijn?`,
      `${bv}: ${diffPp}pp ${dir === 'hoger' ? 'beter' : 'slechter'} declarabel deze maand. Wat is hier voor goed/slecht gegaan en herhaalt het zich?`,
      `${bv} ${month}: declarabiliteit ${declarability.toFixed(0)}%. Het kwartaal-gemiddelde was ${declarabilityPrevAvg.toFixed(0)}% — verklaart de project-mix dit volledig?`,
    ]
    const hints = [
      'Bench tijd, opleidingen/onboarding, project-pijplijn, vakanties, sales-uren, intern-projecten',
      'Eenmalig opleidings-blok, of bredere shift in interne uren?',
      'Wisseling van klant-portfolio? Meer kortlopend werk?',
    ]
    out.push({
      id: 'declarability',
      question: v(phrasings, 'declarability'),
      hint: v(hints, 'declarability-h'),
      category: 'declarability',
      weight: Math.abs(declarability - declarabilityPrevAvg) * 8000,
    })
  }

  // ── Vakantie/ziekte ────────────────────────────────────────────────────
  // Toont actual % naast budget % zodat duidelijk is of dit binnen plan is.
  // Trigger niet meer simpelweg op uren > 0, maar op afwijking: ofwel
  // afwezigheid is significant (>15% van capaciteit) ofwel er zit ≥3pp
  // afwijking t.o.v. capaciteit-budget. Hiermee verdwijnt deze vraag voor
  // weken waar verlof/ziekte volledig in lijn met budget liggen.
  if (vakantie + ziekte > 0 && prevMonthRevenue > 0) {
    const leaveActPct = capacityActual?.leave ?? null
    const sickActPct  = capacityActual?.sick  ?? null
    const leaveBudPct = capacityBudget?.leave ?? null
    const sickBudPct  = capacityBudget?.sick  ?? null
    const leavePp = leaveActPct != null && leaveBudPct != null ? leaveActPct - leaveBudPct : null
    const sickPp  = sickActPct  != null && sickBudPct  != null ? sickActPct  - sickBudPct  : null
    const totalSharePct = (leaveActPct ?? 0) + (sickActPct ?? 0)
    // Skip als budget bestaat en zowel verlof/ziekte ≤ 1pp afwijking
    // én niet onnatuurlijk hoog (<15% gecombineerd). Anders altijd vraag.
    const significantAbsence = totalSharePct >= 15
    const significantDelta =
      (leavePp != null && Math.abs(leavePp) >= 3) ||
      (sickPp  != null && Math.abs(sickPp)  >= 3)
    const noBudgetCtx = leaveBudPct == null && sickBudPct == null
    if (significantAbsence || significantDelta || noBudgetCtx) {
      const fmtPp = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}pp`
      const budCtx = (leaveBudPct != null || sickBudPct != null)
        ? ` (budget: ${leaveBudPct != null ? `verlof ${leaveBudPct.toFixed(1)}%` : 'verlof —'} · ${sickBudPct != null ? `ziekte ${sickBudPct.toFixed(1)}%` : 'ziekte —'})`
        : ''
      const actCtx = leaveActPct != null && sickActPct != null
        ? ` — actual: verlof ${leaveActPct.toFixed(1)}%, ziekte ${sickActPct.toFixed(1)}%${budCtx}`
        : budCtx
      const deltaParts: string[] = []
      if (leavePp != null) deltaParts.push(`verlof ${fmtPp(leavePp)}`)
      if (sickPp  != null) deltaParts.push(`ziekte ${fmtPp(sickPp)}`)
      const deltaCtx = deltaParts.length > 0 ? ` · Δ vs budget: ${deltaParts.join(', ')}` : ''

      const phrasings = [
        `${bv} ${month}: ${vakantie} u vakantie + ${ziekte} u ziekte${actCtx}${deltaCtx}. Is dit eenmalig of zet de afwijking richting komende maanden door?`,
        `${bv}: in ${month} ${vakantie + ziekte} u niet-werkbaar${actCtx}${deltaCtx}. Welke verklaring — sabbatical, langdurig verzuim, naderende collectieve vakantie?`,
        `${bv} ${month}: verlof + ziekte${actCtx}${deltaCtx}. Heeft dit gevolgen voor project-deadlines of declarable-capaciteit komende maanden?`,
      ]
      const hints = [
        'Vergelijk met capaciteit-budget (Budgetten-tab) — moet de LE voor komende maanden bijgesteld worden?',
        'Open-eind ziekte, re-integratie, naderende vakantieperiode — eenmalig of structureel?',
        'Vervanging via freelance overwegen of accepteren?',
      ]
      out.push({
        id: 'leave',
        question: v(phrasings, 'leave'),
        hint: v(hints, 'leave-h'),
        category: 'leave',
        weight: (vakantie + ziekte) * 80
              + (leavePp != null ? Math.abs(leavePp) * 5000 : 0)
              + (sickPp  != null ? Math.abs(sickPp)  * 5000 : 0),
      })
    }
  }

  // ── Directe personeelskosten ────────────────────────────────────────────
  if (dirPers && Math.abs(dirPers.vsLePct) > 4 && Math.abs(dirPers.vsLe) > 10000) {
    const dir = dirPers.vsLe < 0 ? 'lager' : 'hoger'
    const phrasings = [
      `${bv}: directe personeelskosten ${fmtEur(dirPers.actual)} in ${month}, ${fmtEur(Math.abs(dirPers.vsLe))} ${dir} dan voorspeld. Bonus, freelance-inhuur, secondering of iets anders dat we volgende maand opnieuw kunnen verwachten?`,
      `${bv} ${month}: ${dir === 'hoger' ? 'overschrijding' : 'besparing'} op personeelskosten van ${fmtEur(Math.abs(dirPers.vsLe))} t.o.v. LE. Loonindexatie, freelance-piek, of doorbelasting?`,
      `${bv}: pers. kosten ${fmtEur(dirPers.actual)} (${dir === 'hoger' ? '+' : '-'}${fmtEur(Math.abs(dirPers.vsLe))} vs LE). Welke posten zaten hier in en zijn die maandelijks of incidenteel?`,
      `${bv} ${month}: directe personeelskosten ${fmtEur(Math.abs(dirPers.vsLe))} ${dir}. Tijdelijke schaarste-inhuur, of structureel gewijzigd salarispatroon?`,
    ]
    const hints = [
      'Bonusperiode, freelance-piek, doorbelasting van/naar andere BV',
      'Vakantiegeld, eindejaarsbonus, 13e maand, indexatie?',
      'Verschuiving freelance ↔ vast — wat is de verwachting komende maanden?',
    ]
    out.push({
      id: 'direct-pers',
      question: v(phrasings, 'direct-pers'),
      hint: v(hints, 'direct-pers-h'),
      category: 'cost',
      weight: Math.abs(dirPers.vsLe),
    })
  }

  // ── Brutomarge shift ───────────────────────────────────────────────────
  if (margin && rev && rev.actual > 0 && margin.actual !== 0) {
    const marginPct = margin.actual / rev.actual * 100
    const lePct = rev.preCloseLe > 0 ? margin.preCloseLe / rev.preCloseLe * 100 : marginPct
    if (Math.abs(marginPct - lePct) > 2) {
      const dir = marginPct < lePct ? 'lager' : 'hoger'
      const diffPp = Math.abs(marginPct - lePct).toFixed(1)
      const phrasings = [
        `${bv}: brutomarge ${marginPct.toFixed(1)}% in ${month} ligt ${diffPp}pp ${dir} dan de LE-verwachting van ${lePct.toFixed(1)}%. Is dit project-mix, tariefdruk of kosten-shift — en zet de trend door?`,
        `${bv} ${month}: marge ${dir === 'hoger' ? 'verbetert' : 'erodeert'} met ${diffPp}pp t.o.v. LE (${marginPct.toFixed(1)}% vs ${lePct.toFixed(1)}%). Volume of mix?`,
        `${bv}: brutomarge ${marginPct.toFixed(1)}% (${diffPp}pp ${dir} dan voorspeld). Welke projecten of contracten drijven dit?`,
        `${bv} ${month}: marge ${dir === 'hoger' ? 'mee' : 'tegen'} (${marginPct.toFixed(1)}% vs LE ${lePct.toFixed(1)}%). Eenmalige meevaller of strategische pricing-verandering?`,
      ]
      const hints = [
        'Mix tussen Cons/Proj/Soft, freelance-tarieven, prijsindexatie, korting',
        'Hoog-marge contracten erbij of juist eraf? Onderhandelingsrondes geweest?',
        'Subcontracting-verschuiving of inhuur tegen marktprijs?',
      ]
      out.push({
        id: 'margin-shift',
        question: v(phrasings, 'margin-shift'),
        hint: v(hints, 'margin-shift-h'),
        category: 'margin',
        weight: Math.abs(marginPct - lePct) * 20000,
      })
    }
  }

  // ── Directe kosten (overige posten) ────────────────────────────────────
  if (dirCost && Math.abs(dirCost.vsLePct) > 5 && Math.abs(dirCost.vsLe) > 15000 &&
      !out.some(q => q.id === 'direct-pers')) {
    const dir = dirCost.vsLe < 0 ? 'lager' : 'hoger'
    const phrasings = [
      `${bv}: directe kosten ${fmtEur(dirCost.actual)} kwamen ${fmtEur(Math.abs(dirCost.vsLe))} ${dir} uit dan voorspeld in ${month}. Welke kostenpost was dit (inkoop, freelance, auto, overig) en gaat het structureel zo blijven?`,
      `${bv} ${month}: ${dir === 'hoger' ? 'extra' : 'minder'} directe kosten ${fmtEur(Math.abs(dirCost.vsLe))} t.o.v. LE. Inkoop, sub-contractors of mobiliteit?`,
      `${bv}: directe kostenlijn ${dir === 'hoger' ? 'overschreden' : 'onderbenut'} met ${fmtEur(Math.abs(dirCost.vsLe))} in ${month}. Welke specifieke post was de driver?`,
    ]
    const hints = [
      'Materiaal-inkoop, sub-contractors, auto-leasing, reiskosten',
      'Verbruiksmateriaal voor één project, of doorlopende stijging?',
      'Lease-contract verlengd? Brandstof-kosten? Nieuwe toolset?',
    ]
    out.push({
      id: 'direct-cost',
      question: v(phrasings, 'direct-cost'),
      hint: v(hints, 'direct-cost-h'),
      category: 'cost',
      weight: Math.abs(dirCost.vsLe),
    })
  }

  // ── Operationele kosten ────────────────────────────────────────────────
  if (opex && Math.abs(opex.vsLePct) > 6 && Math.abs(opex.vsLe) > 8000) {
    const dir = opex.vsLe < 0 ? 'lager' : 'hoger'
    const phrasings = [
      `${bv}: operationele kosten ${fmtEur(opex.actual)} in ${month}, ${fmtEur(Math.abs(opex.vsLe))} ${dir} dan voorspeld. Eénmalige post (audit, legal, software-jaarkosten) of iets dat terugkeert?`,
      `${bv} ${month}: opex ${dir === 'hoger' ? '+' : '-'}${fmtEur(Math.abs(opex.vsLe))} t.o.v. LE. Welke overhead-categorie pieken we — IT, huisvesting, marketing?`,
      `${bv}: operationele kostenlijn loopt ${dir} dan verwacht (${fmtEur(opex.actual)} vs ${fmtEur(opex.preCloseLe)} LE). Jaarcontract, reorganisatie of normale fluctuatie?`,
      `${bv} ${month}: ${dir === 'hoger' ? 'extra' : 'minder'} overhead ${fmtEur(Math.abs(opex.vsLe))}. Verandert dit het run-rate dat we hanteren in volgende prognoses?`,
    ]
    const hints = [
      'Jaarlijkse SaaS, audit, legal, marketing-piek, IT-investering',
      'Verzekering, accountantsdiensten, training-budget?',
      'Office-investering of huur-aanpassing?',
    ]
    out.push({
      id: 'opex',
      question: v(phrasings, 'opex'),
      hint: v(hints, 'opex-h'),
      category: 'cost',
      weight: Math.abs(opex.vsLe),
    })
  }

  // ── EBITDA-vangnet — alleen als er nog ruimte is binnen de top-3.
  if (ebitda && Math.abs(ebitda.vsLePct) > 10 && Math.abs(ebitda.vsLe) > 20000 && out.length < 2) {
    const dir = ebitda.vsLe >= 0 ? 'hoger' : 'lager'
    const next = nextMonthCode(month)
    const phrasings = [
      `${bv}: EBITDA ${fmtEur(ebitda.actual)} kwam ${fmtEur(Math.abs(ebitda.vsLe))} ${dir} uit dan voorspeld. Welke onverwachte factor (positief of negatief) zou je toevoegen aan de aannames voor ${next}?`,
      `${bv} ${month}: EBITDA-afwijking van ${fmtEur(Math.abs(ebitda.vsLe))}. Welke aanname moet de LE-engine voor ${next} aanpassen?`,
      `${bv}: EBITDA ${dir === 'hoger' ? '+' : '-'}${fmtEur(Math.abs(ebitda.vsLe))} t.o.v. LE in ${month}. Wat moeten we leren voor de volgende prognose?`,
    ]
    const hints = [
      'Welke meevaller of tegenvaller hoort structureel in volgende prognoses?',
      'One-shot effect of structurele wijziging in productiviteit?',
      'Welke parameter wil je in de LE-engine bijstellen?',
    ]
    out.push({
      id: 'ebitda',
      question: v(phrasings, 'ebitda'),
      hint: v(hints, 'ebitda-h'),
      category: 'general',
      weight: Math.abs(ebitda.vsLe) * 0.4,
    })
  }

  // ── Seasonal sanity (YoY) ──────────────────────────────────────────────
  if (rev && sameMonth2025Revenue > 0 && rev.actual > 0) {
    const yoyPct = (rev.actual / sameMonth2025Revenue - 1) * 100
    if (Math.abs(yoyPct) > 15 && out.length < 3) {
      const sign = yoyPct >= 0 ? '+' : ''
      const py = month.replace('-26', '-25')
      const phrasings = [
        `${bv} ${month}: ${sign}${yoyPct.toFixed(1)}% vs zelfde maand 2025 (${fmtEur(rev.actual)} vs ${fmtEur(sameMonth2025Revenue)}). Volg je dit als nieuwe seizoens-baseline of was het een eenmalig effect?`,
        `${bv}: ${month} laat ${sign}${yoyPct.toFixed(1)}% YoY zien (${py}: ${fmtEur(sameMonth2025Revenue)}). Trendbreuk of incidenteel?`,
        `${bv} ${month}: omzet ${sign}${yoyPct.toFixed(1)}% boven/onder ${py}. Welke nieuwe klanten of contractwijzigingen verklaren dit?`,
        `${bv}: ${month}-vs-${py} loopt ${Math.abs(yoyPct).toFixed(1)}pp uit elkaar. Past het in de groeicurve die je elders ziet?`,
      ]
      const hints = [
        'Klant-mix verandering, contract-uitbreiding, eenmalige projectoplevering',
        'Macro-effect op portfolio, of klant-specifieke groei/krimp?',
        'Past dit bij de markttrend in jouw segment?',
      ]
      out.push({
        id: 'seasonal',
        question: v(phrasings, 'seasonal'),
        hint: v(hints, 'seasonal-h'),
        category: 'general',
        weight: Math.abs(yoyPct) * 1500,
      })
    }
  }

  // Top-3 op weight — alleen de drijvers met de grootste afwijking overleven
  // zodat het overzicht compact blijft. Bij minder dan 3 triggers krijg je er
  // dus minder; meer dan 3 wordt afgekapt op de zwaarste.
  return out.sort((a, b) => b.weight - a.weight).slice(0, 3)
}

/** Helper: volgende maand-code. 'Mar-26' → 'Apr-26'. */
function nextMonthCode(m: string): string {
  const idx = BUDGET_MONTHS_2026.indexOf(m)
  if (idx >= 0 && idx + 1 < BUDGET_MONTHS_2026.length) return BUDGET_MONTHS_2026[idx + 1]
  return m
}
