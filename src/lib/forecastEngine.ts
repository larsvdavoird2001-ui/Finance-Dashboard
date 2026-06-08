// Forecast engine — Voorspelling huidige maand.
//
// Combineert vier informatiebronnen tot een maandeind-prognose per BV:
//   1. Latest Estimate-forecast (uit useLatestEstimate) — driver-based baseline
//      gebaseerd op FTE × rev/FTE × seizoen × drift × growth.
//   2. Partial-month YTD-uploads (factuurvolume, geschreven uren, NTF, etc.) —
//      pas-deel-van-de-maand-binnen-data dat we lineair extrapoleren naar
//      maandeind op basis van verstreken werkdagen.
//   3. OHW-pipeline-uploads (NTF Uren / D Lijst / Conceptfacturen / Missing
//      hours / OHW Excel) — geven inzicht in de op-handen OHW-mutatie die in
//      omzet-allocatie doorrekent.
//   4. Handmatige OHW-eindstand-schatting + notes — finishing touches van de
//      controller die niet uit data te halen zijn.
//
// Output per BV: predicted_netto_omzet, predicted_brutomarge, predicted_ebitda,
// predicted_ebit + breakdown per P&L-key, plus confidence-signalen.
//
// Pure functie: geen side effects, geen store-reads — alle inputs worden via
// arguments doorgegeven zodat de component eenvoudig kan memo'iseren.

import type { ClosingBv } from '../data/types'
import { workdaysInMonth } from './leDrivers'
import { derivePL } from './plDerive'

export type ForecastBv = ClosingBv

export interface ForecastBvSnapshot {
  /** Pure LE-forecast voor deze maand (zoals useLatestEstimate hem zou geven
   *  als de maand nog open is). Wordt gebruikt als fallback en als baseline
   *  voor blending met de YTD-uploads. */
  le: Record<string, number>
  /** Werkelijk gefactureerd YTD-deel van deze maand uit de upload (€).
   *  undefined → geen factuurvolume-upload aanwezig. */
  invoicedYtd?: number
  /** Totaal geschreven uren YTD-deel (uit geschreven_uren upload):
   *  declarabel + intern + verlof. undefined → geen upload. */
  hoursYtd?: { declarable: number; internal: number; vakantie: number; ziekte: number; overigVerlof: number }
  /** Totaal NTF (Nog Te Factureren) waarde uit de uren_lijst-upload. */
  ntfTotal?: number
  /** Handmatige eindstand-schatting voor de OHW van deze BV. */
  ohwEstimate?: number
  /** Andere OHW-pipeline totalen voor brutomarge-correctie. */
  dLijstTotal?: number       // alleen Consultancy
  conceptfacturenTotal?: number // alleen Projects
  /** Totaal missing-hours-uren voor deze BV (count, niet bedrag). */
  missingHoursCount?: number
  /** Berekende missing-hours-waarde voor deze BV (€). */
  missingHoursValue?: number
  ohwExcelTotal?: number        // alleen Projects
  /** Voor OHW Excel: factor om de waarde door te projecteren naar maandeind
   *  op basis van het weeknummer in de bestandsnaam. Bv. file van week 21
   *  voor mei (5 weken totaal, 4 gedekt) → 1.25. */
  ohwExcelExtrapolationFactor?: number
  /** Voor OHW Excel: het weeknummer dat in de bestandsnaam stond (UI-display). */
  ohwExcelWeek?: number
}

export interface ForecastInputs {
  /** Doel-maand bv 'May-26'. */
  month: string
  /** Vandaag (voor workday-progressie). */
  today: Date
  /** LE + YTD per BV. */
  perBv: Record<ForecastBv, ForecastBvSnapshot>
  /** Laatste closed-OHW saldo per BV (voor OHW-mutatie-impact). undefined =
   *  geen baseline beschikbaar. */
  lastClosedOhw?: Partial<Record<ForecastBv, number>>
}

export interface ForecastBvResult {
  bv: ForecastBv
  /** FINAL blended prognose (per P&L-key) — gewogen mix van LE en YTD. */
  predicted: Record<string, number>
  /** Pure LE-forecast voor referentie (op basis van historie/drivers, géén
   *  YTD-uploads). Dit is "wat de engine voorspelt zonder partial-month data". */
  le: Record<string, number>
  /** Pure YTD-forecast: alle uploads volledig toegepast (gewicht = 1.0), met
   *  LE als fallback voor P&L-regels zonder upload-signaal. Dit is "wat de
   *  cijfers tot nu toe in de maand suggereren als eindmaand-stand". */
  ytd: Record<string, number>
  /** Belangrijkste KPI's uit de FINAL blended prognose, uitgepakt voor de UI. */
  nettoOmzet: number
  brutomarge: number
  ebitda: number
  ebit: number
  /** OHW eindstand voorspelling. */
  ohwForecast: number
  /** % verstreken werkdagen × 100 (0-100). */
  workdayCoverage: number
  /** Welk aandeel van de LE-omzet al gedekt is door geüploade factuurvolume
   *  YTD. Boven 1.0 betekent de maand loopt boven LE. */
  revenueCoverage: number | null
  /** Effectieve declarabiliteit YTD (0-1). */
  declarabilityYtd: number | null
  /** Aantal afzonderlijke YTD-databronnen (uploads + schattingen) die invloed
   *  hadden op deze BV. Gebruikt voor de confidence-bar. */
  signalCount: number
  /** Hoeveel zwaarder we de YTD-extrapolatie wegen vs pure LE (0..1).
   *  YTD-gewicht = blendWeight, LE-gewicht = 1 − blendWeight. */
  blendWeight: number
}

export interface ForecastResult {
  month: string
  workdayCoverage: number     // 0..100, gedeeld over alle BVs
  workdaysElapsed: number
  workdaysTotal: number
  perBv: Record<ForecastBv, ForecastBvResult>
  /** Sommatie over alle BVs. */
  total: Omit<ForecastBvResult, 'bv'>
}

/** Hoeveel werkdagen zijn er in `month` verstreken t/m `today`. */
export function workdaysElapsedInMonth(month: string, today: Date): number {
  const MONTH_CODES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const m = month.match(/^(\w+)-(\d{2})$/)
  if (!m) return 0
  const mi = MONTH_CODES.indexOf(m[1])
  const year = 2000 + Number(m[2])
  if (mi < 0) return 0
  const tYear = today.getFullYear()
  const tMonth = today.getMonth()
  // Doel-maand al voorbij?
  if (year < tYear || (year === tYear && mi < tMonth)) return workdaysInMonth(month)
  // Doel-maand nog niet begonnen?
  if (year > tYear || (year === tYear && mi > tMonth)) return 0
  // Doel-maand = huidige maand → tel werkdagen 1..vandaag (inclusief).
  let count = 0
  for (let d = 1; d <= today.getDate(); d++) {
    const day = new Date(year, mi, d).getDay()
    if (day !== 0 && day !== 6) count++
  }
  return count
}

/** Lineair extrapoleren van een YTD-bedrag naar een maandeind, met optionele
 *  cap zodat een vroege piek geen 10× projectie geeft. */
function extrapolateToMonthEnd(ytd: number, workdaysElapsed: number, workdaysTotal: number): number {
  if (workdaysElapsed <= 0) return 0
  if (workdaysElapsed >= workdaysTotal) return ytd
  return (ytd / workdaysElapsed) * workdaysTotal
}

/** Pak het effectieve aandeel van de werkmaand dat we als "betrouwbare basis"
 *  beschouwen voor extrapolatie. Onder 20% van de maand → bijna alles op LE
 *  vertrouwen. Boven 80% → bijna volledig op YTD-extrapolatie vertrouwen.
 *  De curve is conservatief (kwadratisch oplopen) zodat een paar dagen
 *  niet meteen het hele beeld kantelen. */
function ytdConfidenceWeight(workdaysElapsed: number, workdaysTotal: number): number {
  if (workdaysTotal <= 0) return 0
  const pct = Math.max(0, Math.min(1, workdaysElapsed / workdaysTotal))
  // S-curve: x² × (3 − 2x). Mild rond 0, vlug oplopend in het midden.
  return pct * pct * (3 - 2 * pct)
}

/** Compute de prognose. Geen state-mutaties, idempotent voor dezelfde inputs. */
export function computeForecast(inputs: ForecastInputs): ForecastResult {
  const { month, today, perBv, lastClosedOhw } = inputs

  const workdaysTotal = workdaysInMonth(month)
  const workdaysElapsed = workdaysElapsedInMonth(month, today)
  const coveragePct = workdaysTotal > 0 ? (workdaysElapsed / workdaysTotal) * 100 : 0
  const baseBlendWeight = ytdConfidenceWeight(workdaysElapsed, workdaysTotal)

  const bvs: ForecastBv[] = ['Consultancy', 'Projects', 'Software', 'Holdings']
  const perBvResult = {} as Record<ForecastBv, ForecastBvResult>

  for (const bv of bvs) {
    const snap = perBv[bv]
    if (!snap) {
      perBvResult[bv] = emptyResult(bv, coveragePct, baseBlendWeight)
      continue
    }
    perBvResult[bv] = computeBvForecast({
      bv, snap, month, workdaysElapsed, workdaysTotal,
      baseBlendWeight, lastClosedOhw,
    })
  }

  // Totalen-aggregatie over alle BVs.
  const totalPredicted: Record<string, number> = {}
  const totalLe: Record<string, number> = {}
  const totalYtd: Record<string, number> = {}
  let totalOhw = 0
  let signalCount = 0
  let blendWeightWeighted = 0
  let blendWeightSum = 0
  for (const bv of bvs) {
    const r = perBvResult[bv]
    for (const [k, v] of Object.entries(r.predicted)) {
      totalPredicted[k] = (totalPredicted[k] ?? 0) + v
    }
    for (const [k, v] of Object.entries(r.le)) {
      totalLe[k] = (totalLe[k] ?? 0) + v
    }
    for (const [k, v] of Object.entries(r.ytd)) {
      totalYtd[k] = (totalYtd[k] ?? 0) + v
    }
    totalOhw += r.ohwForecast
    signalCount += r.signalCount
    blendWeightWeighted += r.blendWeight
    blendWeightSum += 1
  }

  return {
    month,
    workdayCoverage: coveragePct,
    workdaysElapsed,
    workdaysTotal,
    perBv: perBvResult,
    total: {
      predicted:        totalPredicted,
      le:               totalLe,
      ytd:              totalYtd,
      nettoOmzet:       totalPredicted['netto_omzet'] ?? 0,
      brutomarge:       totalPredicted['brutomarge'] ?? 0,
      ebitda:           totalPredicted['ebitda'] ?? 0,
      ebit:             totalPredicted['ebit'] ?? 0,
      ohwForecast:      totalOhw,
      workdayCoverage:  coveragePct,
      revenueCoverage:  null,
      declarabilityYtd: null,
      signalCount,
      blendWeight:      blendWeightSum > 0 ? blendWeightWeighted / blendWeightSum : 0,
    },
  }
}

interface BvComputeArgs {
  bv: ForecastBv
  snap: ForecastBvSnapshot
  month: string
  workdaysElapsed: number
  workdaysTotal: number
  baseBlendWeight: number
  lastClosedOhw?: Partial<Record<ForecastBv, number>>
}

/** Bouw één prognose-scenario voor één BV met een gegeven YTD-gewicht.
 *
 *  De engine kent maar één weeg-mechanisme:
 *
 *      final = w · YTD_geprojecteerd  +  (1 − w) · LE
 *
 *  Door deze helper twee keer aan te roepen — eenmaal met w = baseBlendWeight
 *  (s-curve over werkdag-progressie) en eenmaal met w = 1.0 — krijgen we
 *  naast de FINAL blended prognose óók een "pure YTD"-scenario voor de UI.
 *  Het "pure LE"-scenario is simpelweg `snap.le` (geen uploads toegepast). */
function applyForecastBlend(args: {
  snap: ForecastBvSnapshot
  /** BV waar deze forecast voor is — bepaalt welke uploads worden meegenomen
   *  (bv. Software krijgt geen missing-hours-bijdrage). */
  bv: ForecastBv
  /** YTD-gewicht in 0..1. weight=0 → puur LE; weight=1 → puur YTD. */
  weight: number
  workdaysElapsed: number
  workdaysTotal: number
  /** Adjustment op omzet_periode_allocatie als gevolg van handmatige OHW-
   *  eindstand-schatting. Berekend in computeBvForecast als
   *  `ohwEstimate - trendProjectedOhw`. */
  ohwAllocAdjustment: number
}): {
  predicted: Record<string, number>
  revenueCoverage: number | null
  declarabilityYtd: number | null
} {
  const { snap, bv, weight, workdaysElapsed, workdaysTotal, ohwAllocAdjustment } = args
  const le = snap.le
  const predicted: Record<string, number> = { ...le }

  let revenueCoverage: number | null = null
  let declarabilityYtd: number | null = null

  // 1) Gefactureerde omzet: extrapoleer YTD lineair, blend met LE.
  //    Géén optelsom — een upload van €500k YTD bij LE €1M wordt halverwege
  //    de maand niet €1,5M, maar een gewogen mix tussen €1,2M (extrapolatie)
  //    en €1M (LE).
  if (snap.invoicedYtd !== undefined && snap.invoicedYtd >= 0 && workdaysElapsed > 0) {
    const leGef = le['gefactureerde_omzet'] ?? 0
    const projected = extrapolateToMonthEnd(snap.invoicedYtd, workdaysElapsed, workdaysTotal)
    if (leGef > 0) revenueCoverage = snap.invoicedYtd / leGef
    predicted['gefactureerde_omzet'] = weight * projected + (1 - weight) * leGef
  }

  // 2) Declarabiliteit YTD: soft adjustment op de gefactureerde-omzet,
  //    ook gewogen met `weight` zodat early-month ruis niet doorslaat.
  if (snap.hoursYtd) {
    const work = snap.hoursYtd.declarable + snap.hoursYtd.internal
    if (work > 0) declarabilityYtd = snap.hoursYtd.declarable / work
    if (declarabilityYtd !== null && declarabilityYtd > 0) {
      const leDecl = 0.85 // typische TPG-baseline
      const rawAdj = Math.max(0.85, Math.min(1.05, declarabilityYtd / leDecl))
      const adj = 1 + (rawAdj - 1) * weight
      predicted['gefactureerde_omzet'] = (predicted['gefactureerde_omzet'] ?? 0) * adj
    }
  }

  // 3) Omzet-periode-allocatie heeft twee mogelijke bijdragen:
  //
  //    a) Missing-hours-bijdrage (Consultancy + Projects) — gewogen met
  //       de werkdag-progressie (`weight`). Early-month: weinig impact,
  //       end-of-month: volledig meegerekend. Software is uitgesloten.
  //
  //    b) OHW-eindstand-adjustment: het verschil tussen de handmatige
  //       eindstand-schatting en de trend-projectie. Hogere OHW-eindstand
  //       dan trend = extra accrual-omzet (werk uitgevoerd maar nog niet
  //       gefactureerd komt deze maand op de balans). Omdat dit een
  //       deliberate user-input voor het hele maandeind is, géén
  //       workday-weging — het volledige verschil telt mee.
  let allocAdjustment = 0
  if ((bv === 'Consultancy' || bv === 'Projects') &&
      snap.missingHoursValue !== undefined && snap.missingHoursValue !== 0) {
    allocAdjustment += weight * snap.missingHoursValue
  }
  if (ohwAllocAdjustment !== 0) {
    allocAdjustment += ohwAllocAdjustment
  }
  if (allocAdjustment !== 0) {
    const leAlloc = le['omzet_periode_allocatie'] ?? 0
    predicted['omzet_periode_allocatie'] = leAlloc + allocAdjustment
  }

  // 4) Netto-omzet = som van revenue-subs.
  predicted['netto_omzet'] =
    (predicted['gefactureerde_omzet'] ?? 0) + (predicted['omzet_periode_allocatie'] ?? 0)

  // 5) Directe kosten schalen evenredig met revenue (cost-to-revenue ratio
  //    constant). Brutomarge% blijft daarmee in lijn met LE.
  const leRev = (le['gefactureerde_omzet'] ?? 0) + (le['omzet_periode_allocatie'] ?? 0)
  const newRev = predicted['netto_omzet']
  if (leRev > 0 && Math.abs(newRev - leRev) > 1) {
    const revRatio = newRev / leRev
    const lePers = le['directe_personeelskosten'] ?? 0
    const leDirect = le['directe_kosten'] ?? 0
    predicted['directe_personeelskosten'] = lePers * revRatio
    const persDelta = predicted['directe_personeelskosten'] - lePers
    predicted['directe_kosten'] = leDirect + persDelta
  }

  // 6) Derived keys herberekenen op basis van bijgewerkte subs/aggregates.
  const get = (k: string): number => predicted[k] ?? 0
  predicted['brutomarge'] = derivePL(get, 'brutomarge')
  predicted['ebitda']     = derivePL(get, 'ebitda')
  predicted['ebit']       = derivePL(get, 'ebit')
  predicted['netto_resultaat'] = derivePL(get, 'netto_resultaat')

  return { predicted, revenueCoverage, declarabilityYtd }
}

function computeBvForecast(args: BvComputeArgs): ForecastBvResult {
  const { bv, snap, workdaysElapsed, workdaysTotal, baseBlendWeight, lastClosedOhw } = args

  // OHW-adjustment: verschil tussen handmatige eindstand-schatting en de
  // trend-projectie (uit OHW Overzicht historie). Een hogere ohwEstimate
  // dan trend → extra accrual-omzet via omzet_periode_allocatie. Daarmee
  // werkt elke OHW-eindstand-wijziging direct door in de prognose i.p.v.
  // alleen het OHW-prognose-getal te veranderen.
  const trendProjectedOhw = lastClosedOhw?.[bv] ?? 0
  const ohwAllocAdjustment = (snap.ohwEstimate !== undefined && snap.ohwEstimate !== 0)
    ? snap.ohwEstimate - trendProjectedOhw
    : 0

  // FINAL blended prognose: gewogen mix LE/YTD via s-curve op werkdag-progressie.
  const final = applyForecastBlend({
    snap, bv, weight: baseBlendWeight, workdaysElapsed, workdaysTotal,
    ohwAllocAdjustment,
  })
  // PURE YTD-scenario: alle uploads volledig toegepast (weight = 1.0). Voor
  // regels zonder upload-signaal valt deze terug op LE — de helper doet dan
  // op die regel 1·LE = LE, dus het scenario is altijd compleet ingevuld.
  const ytdOnly = applyForecastBlend({
    snap, bv, weight: 1.0, workdaysElapsed, workdaysTotal,
    ohwAllocAdjustment,
  })

  // Tel signalen voor de confidence-bar.
  let signalCount = 0
  if (snap.invoicedYtd !== undefined)            signalCount++
  if (snap.hoursYtd)                              signalCount++
  if (snap.dLijstTotal !== undefined)             signalCount++
  if (snap.conceptfacturenTotal !== undefined)    signalCount++
  if (snap.missingHoursValue !== undefined)       signalCount++
  if (snap.ohwExcelTotal !== undefined)           signalCount++
  if (snap.ntfTotal !== undefined)                signalCount++

  // ── OHW Excel extrapolatie naar maandeind ────────────────────────────
  // OHW Excel bevat een omzet-saldo "t/m week N" — gebruik de factor uit de
  // bestandsnaam om door te projecteren naar het einde van de maand. Voor
  // Projects (de enige BV met OHW Excel) is dit de meest accurate OHW-
  // schatting wanneer geen handmatige eindstand is gegeven.
  let ohwExcelProjected: number | null = null
  if (snap.ohwExcelTotal !== undefined && snap.ohwExcelTotal !== 0) {
    const factor = snap.ohwExcelExtrapolationFactor ?? 1
    ohwExcelProjected = snap.ohwExcelTotal * factor
  }

  // ── OHW eindstand: handmatig > OHW-Excel-geprojecteerd > trend ─────────
  // Hiërarchie:
  //   a. Handmatige schatting (gebruiker tikt in)
  //   b. OHW Excel geprojecteerd naar maandeind (alleen Projects relevant)
  //   c. Trend-projectie uit OHW Overzicht
  // De andere pipeline-uploads (NTF, D-lijst, Conceptfacturen, Missing hours)
  // tellen NIET op bij de OHW-eindstand — dat zou dubbel zijn omdat de trend
  // of OHW Excel die componenten al verantwoordt.
  let ohwForecast: number
  if (snap.ohwEstimate !== undefined && snap.ohwEstimate !== 0) {
    ohwForecast = snap.ohwEstimate
    signalCount++
  } else if (ohwExcelProjected !== null && bv === 'Projects') {
    ohwForecast = ohwExcelProjected
  } else {
    // `lastClosedOhw[bv]` is de output van projectOhwForMonth() — naam is
    // historisch, semantiek is "trend-projectie van OHW-eindstand".
    ohwForecast = lastClosedOhw?.[bv] ?? 0
  }

  return {
    bv,
    predicted:        final.predicted,
    le:               snap.le,
    ytd:              ytdOnly.predicted,
    nettoOmzet:       final.predicted['netto_omzet']     ?? 0,
    brutomarge:       final.predicted['brutomarge']      ?? 0,
    ebitda:           final.predicted['ebitda']          ?? 0,
    ebit:             final.predicted['ebit']            ?? 0,
    ohwForecast,
    workdayCoverage:  workdaysTotal > 0 ? (workdaysElapsed / workdaysTotal) * 100 : 0,
    revenueCoverage:  final.revenueCoverage,
    declarabilityYtd: final.declarabilityYtd,
    signalCount,
    blendWeight:      baseBlendWeight,
  }
}

function emptyResult(bv: ForecastBv, coveragePct: number, blendWeight: number): ForecastBvResult {
  return {
    bv,
    predicted: {},
    le: {},
    ytd: {},
    nettoOmzet: 0,
    brutomarge: 0,
    ebitda: 0,
    ebit: 0,
    ohwForecast: 0,
    workdayCoverage: coveragePct,
    revenueCoverage: null,
    declarabilityYtd: null,
    signalCount: 0,
    blendWeight,
  }
}
