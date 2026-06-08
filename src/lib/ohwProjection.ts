// OHW-projectie helper — voorspelt de OHW-eindstand per BV voor een toekomstige
// maand op basis van de historische ontwikkeling in OHW Overzicht.
//
// Methodiek (conservatief, weerbestendig tegen 1-month uitschieters):
//   1. Bouw een tijdreeks van `totaalOnderhanden` voor deze BV uit 2025-actuals
//      en 2026-closed-maanden t/m het laatste niet-lege punt vóór targetMonth.
//   2. Pak de laatste N (default 4) waarnemingen voor de MoM-trend.
//   3. Compute mediaan van MoM absolute deltas — mediaan is robuust tegen één
//      uitschieter (bv. een grote oplevering die de OHW kort omhoog jaagt).
//   4. Projecteer = laatste waarde + (#maanden_gap × mediaan_delta).
//   5. Soft seasonal-overlay: vermenigvuldig met (1 + (py_ratio − 1) × 0.4)
//      waarbij py_ratio = OHW_2025[zelfde-maand] / gemiddelde_OHW_2025. Hierdoor
//      pakt de projectie zomer-dips en jaareinde-pieken mee zonder dat een
//      jaar-oude maand het beeld overneemt.
//   6. Cap: projectie kan maximaal 50% afwijken van de laatste waarde, zodat
//      een nieuwe trend nooit explosief doorprojecteert.
//
// Geen side-effects; pure functie zodat de hook eromheen mooi kan memo'iseren.

import type { OhwYearData } from '../data/types'

const MONTH_CODES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const ALL_MONTHS_2026 = MONTH_CODES.map(c => `${c}-26`)
const ALL_MONTHS_2025 = MONTH_CODES.map(c => `${c}-25`)

const TREND_WINDOW = 4              // mediaan over laatste 4 closed deltas
const SEASONAL_WEIGHT = 0.4          // hoe zwaar 2025-shape doorwerkt
const MAX_DEVIATION_PCT = 0.50       // ±50% cap op de projectie t.o.v. last

export type ProjectionSource =
  | 'trend'        // op basis van MoM-mediaan over recente maanden
  | 'last'         // alleen 1 maand historie — projectie = laatste waarde
  | 'py-pattern'   // geen 2026-historie — terugval op 2025-zelfde-maand
  | 'none'         // geen data beschikbaar

export interface OhwProjection {
  value: number
  source: ProjectionSource
  /** Korte uitleg over hoe `value` tot stand kwam — direct te tonen in UI. */
  basis: string
  /** Welke maanden de mediaan-trend voedde (lege array als source ≠ trend). */
  monthsUsed: string[]
  /** Laatste gevonden actual-waarde (voor referentie naast de projectie). */
  lastValue: number
  /** Maand waar `lastValue` op slaat. */
  lastMonth: string
}

function isMonthBefore(a: string, b: string): boolean {
  const [aM, aY] = a.split('-'); const [bM, bY] = b.split('-')
  const aIdx = Number(aY) * 12 + MONTH_CODES.indexOf(aM)
  const bIdx = Number(bY) * 12 + MONTH_CODES.indexOf(bM)
  return aIdx < bIdx
}

function monthsBetween(from: string, to: string): number {
  const [fM, fY] = from.split('-'); const [tM, tY] = to.split('-')
  return (Number(tY) * 12 + MONTH_CODES.indexOf(tM)) - (Number(fY) * 12 + MONTH_CODES.indexOf(fM))
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((x, y) => x - y)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

interface SeriesPoint { month: string; value: number }

/** Bouw een tijdreeks van het OHW-totaal voor deze BV door 2025 en 2026 heen,
 *  alleen punten met een echte waarde (≠ 0 EN ≠ null). Resultaat is chronologisch
 *  gesorteerd en stopt VÓÓR `targetMonth`. */
function buildSeries(
  bv: string,
  targetMonth: string,
  data2025: OhwYearData,
  data2026: OhwYearData,
): SeriesPoint[] {
  const series: SeriesPoint[] = []
  const ent25 = data2025.entities.find(e => e.entity === bv)
  const ent26 = data2026.entities.find(e => e.entity === bv)

  for (const m of ALL_MONTHS_2025) {
    if (!isMonthBefore(m, targetMonth)) break
    const v = ent25?.totaalOnderhanden?.[m]
    if (typeof v === 'number' && v !== 0) series.push({ month: m, value: v })
  }
  for (const m of ALL_MONTHS_2026) {
    if (!isMonthBefore(m, targetMonth)) break
    const v = ent26?.totaalOnderhanden?.[m]
    if (typeof v === 'number' && v !== 0) series.push({ month: m, value: v })
  }
  return series
}

/** Seasonal-overlay factor voor `targetMonth` o.b.v. 2025-OHW pattern. */
function seasonalFactor(bv: string, targetMonth: string, data2025: OhwYearData): number {
  const ent = data2025.entities.find(e => e.entity === bv)
  if (!ent) return 1
  const targetCode = targetMonth.split('-')[0]
  const py = ent.totaalOnderhanden?.[`${targetCode}-25`]
  if (typeof py !== 'number' || py === 0) return 1
  // Gemiddelde 2025-OHW
  let sum = 0, n = 0
  for (const m of ALL_MONTHS_2025) {
    const v = ent.totaalOnderhanden?.[m]
    if (typeof v === 'number' && v !== 0) { sum += v; n++ }
  }
  if (n === 0) return 1
  const avg = sum / n
  if (avg === 0) return 1
  const raw = py / avg
  return 1 + (raw - 1) * SEASONAL_WEIGHT
}

function fmtEur(v: number): string {
  const abs = Math.abs(v)
  const k = abs >= 1000 ? `${Math.round(abs / 1000).toLocaleString('nl-NL')}k` : `${Math.round(abs).toLocaleString('nl-NL')}`
  return `${v < 0 ? '−' : ''}€ ${k}`
}

/** Projecteer het OHW-totaal voor (bv, targetMonth). Pure functie. */
export function projectOhwForMonth(
  bv: string,
  targetMonth: string,
  data2025: OhwYearData,
  data2026: OhwYearData,
): OhwProjection {
  const series = buildSeries(bv, targetMonth, data2025, data2026)

  if (series.length === 0) {
    // Geen 2026-historie → val terug op 2025-zelfde-maand
    const ent25 = data2025.entities.find(e => e.entity === bv)
    const targetCode = targetMonth.split('-')[0]
    const py = ent25?.totaalOnderhanden?.[`${targetCode}-25`]
    if (typeof py === 'number' && py !== 0) {
      return {
        value:     Math.round(py),
        source:    'py-pattern',
        basis:     `Geen 2026-historie — 2025-${targetCode} stond op ${fmtEur(py)}.`,
        monthsUsed: [],
        lastValue: py,
        lastMonth: `${targetCode}-25`,
      }
    }
    return {
      value: 0, source: 'none', basis: 'Geen OHW-historie beschikbaar.',
      monthsUsed: [], lastValue: 0, lastMonth: '',
    }
  }

  const last = series[series.length - 1]

  // Slechts 1 datapunt → projectie = die ene waarde (× seasonal-overlay).
  if (series.length === 1) {
    const seasonal = seasonalFactor(bv, targetMonth, data2025)
    const value = Math.round(last.value * seasonal)
    return {
      value,
      source: 'last',
      basis:  `1 historisch datapunt (${last.month} = ${fmtEur(last.value)}). Seasonal-overlay ${(seasonal * 100 - 100).toFixed(0)}%.`,
      monthsUsed: [last.month],
      lastValue: last.value,
      lastMonth: last.month,
    }
  }

  // ≥2 datapunten → mediaan MoM delta over de laatste TREND_WINDOW deltas.
  const window = series.slice(-Math.min(series.length, TREND_WINDOW + 1))
  const deltas: number[] = []
  for (let i = 1; i < window.length; i++) {
    deltas.push(window[i].value - window[i - 1].value)
  }
  const medianDelta = median(deltas)
  const gap = Math.max(1, monthsBetween(last.month, targetMonth))
  const trendValue = last.value + gap * medianDelta

  // Seasonal overlay (soft).
  const seasonal = seasonalFactor(bv, targetMonth, data2025)
  const projected = trendValue * seasonal

  // Cap: max ±50% afwijking t.o.v. laatste waarde.
  const minBound = last.value * (1 - MAX_DEVIATION_PCT)
  const maxBound = last.value * (1 + MAX_DEVIATION_PCT)
  const capped = Math.max(Math.min(projected, Math.max(minBound, maxBound)), Math.min(minBound, maxBound))

  const monthsUsed = window.slice(1).map(p => p.month) // alle maanden behalve de eerste (anchor)
  const seasonalPct = (seasonal * 100 - 100)
  const wasCapped = Math.abs(capped - projected) > 1

  const basis =
    `Trend uit ${monthsUsed.join(', ')}: mediaan ${fmtEur(medianDelta)}/mnd, ` +
    `${gap} mnd vooruit vanaf ${last.month} (${fmtEur(last.value)})` +
    (Math.abs(seasonalPct) > 0.5 ? ` · seizoen ${seasonalPct >= 0 ? '+' : ''}${seasonalPct.toFixed(0)}%` : '') +
    (wasCapped ? ' · begrensd op ±50%' : '')

  return {
    value: Math.round(capped),
    source: 'trend',
    basis,
    monthsUsed,
    lastValue: last.value,
    lastMonth: last.month,
  }
}
