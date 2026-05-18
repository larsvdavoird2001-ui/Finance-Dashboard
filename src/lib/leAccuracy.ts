// LE accuracy-tracker — meet hoe goed de pre-close LE-snapshots aansluiten
// op de werkelijke actuals over de afgesloten maanden. Op basis hiervan
// kalibreert de engine zichzelf (drift-factor in useLatestEstimate) en kan
// de gebruiker zien of het model systematisch over- of onderschat.

import type { FinalizedMonth, LeSnapshotByBv } from './db'
import type { EntityName } from '../data/plData'

export interface AccuracyPoint {
  month: string
  bv: EntityName
  key: keyof LeSnapshotByBv
  preCloseLE: number
  actual: number
  /** Procentuele afwijking: (actual - LE) / |LE| × 100. Positief = LE
   *  onderschatte; negatief = LE overschatte. */
  driftPct: number
  /** Absolute delta in € — voor materialiteitsweging. */
  delta: number
}

export interface AccuracySummary {
  bv: EntityName
  key: keyof LeSnapshotByBv
  /** Aantal closed maanden met een geldige snapshot. */
  n: number
  /** Mediaan drift over de geanalyseerde maanden — kerngetal voor
   *  systematische bias. Robuust voor één outlier-maand. */
  medianDriftPct: number
  /** Gemiddelde drift over de geanalyseerde maanden. */
  meanDriftPct: number
  /** Standaarddeviatie van drift — proxy voor stabiliteit. Hogere waarde =
   *  minder voorspelbaar. */
  stdDevPct: number
  /** Trend van de drift over tijd. positive = LE wordt steeds beter
   *  (laatste maanden dichter bij 0), negative = drift loopt op. */
  trendPct: number
  /** Confidence-label op basis van n en stdDev. */
  confidence: 'low' | 'medium' | 'high'
  /** Datapunten chronologisch op volgorde. */
  points: AccuracyPoint[]
}

export const ACCURACY_KEYS: Array<keyof LeSnapshotByBv> = ['netto_omzet', 'brutomarge', 'ebitda']

export const ACCURACY_KEY_LABELS: Record<keyof LeSnapshotByBv, string> = {
  netto_omzet: 'Netto omzet',
  brutomarge:  'Brutomarge',
  ebitda:      'EBITDA',
}

/** Verzamel accuracy-punten voor (bv, key) over alle finalized maanden met
 *  een snapshot. Maanden zonder snapshot of zonder actuals worden overgeslagen. */
export function collectAccuracyPoints(
  bv: EntityName,
  key: keyof LeSnapshotByBv,
  finalized: FinalizedMonth[],
  getActual: (bv: EntityName, month: string, key: string) => number,
): AccuracyPoint[] {
  const out: AccuracyPoint[] = []
  // Sorteer op maand-volgorde (Jan-26 → Dec-26). FinalizedMonth.month volgt
  // het MMM-YY formaat, dus we gebruiken een indexed mapping.
  const ORDER = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const sorted = [...finalized].sort((a, b) => {
    const [am, ay] = a.month.split('-')
    const [bm, by] = b.month.split('-')
    const ai = Number(ay) * 12 + ORDER.indexOf(am)
    const bi = Number(by) * 12 + ORDER.indexOf(bm)
    return ai - bi
  })
  for (const f of sorted) {
    const snap = f.leSnapshot?.[bv]?.[key]
    if (snap == null || snap === 0) continue
    const actual = getActual(bv, f.month, key)
    if (actual === 0) continue
    if (Math.sign(snap) !== Math.sign(actual)) continue  // tekens moeten kloppen
    const delta = actual - snap
    const driftPct = (delta / Math.abs(snap)) * 100
    out.push({ month: f.month, bv, key, preCloseLE: snap, actual, driftPct, delta })
  }
  return out
}

/** Aggregeer accuracy-statistieken voor (bv, key). */
export function summariseAccuracy(
  bv: EntityName,
  key: keyof LeSnapshotByBv,
  finalized: FinalizedMonth[],
  getActual: (bv: EntityName, month: string, key: string) => number,
): AccuracySummary {
  const points = collectAccuracyPoints(bv, key, finalized, getActual)
  const n = points.length
  if (n === 0) {
    return {
      bv, key, n: 0, medianDriftPct: 0, meanDriftPct: 0,
      stdDevPct: 0, trendPct: 0, confidence: 'low', points: [],
    }
  }
  const drifts = points.map(p => p.driftPct).sort((a, b) => a - b)
  const median = drifts[Math.floor(drifts.length / 2)]
  const mean = drifts.reduce((s, v) => s + v, 0) / drifts.length
  const variance = drifts.reduce((s, v) => s + (v - mean) ** 2, 0) / drifts.length
  const stdDev = Math.sqrt(variance)
  // Trend = vergelijking eerste helft vs tweede helft van de drift-serie.
  // |latere drift| < |eerdere drift| → LE wordt smarter (positive trend).
  let trend = 0
  if (points.length >= 2) {
    const half = Math.floor(points.length / 2)
    const firstHalf = points.slice(0, half)
    const secondHalf = points.slice(-half)
    const avgFirst = firstHalf.reduce((s, p) => s + Math.abs(p.driftPct), 0) / Math.max(1, firstHalf.length)
    const avgSecond = secondHalf.reduce((s, p) => s + Math.abs(p.driftPct), 0) / Math.max(1, secondHalf.length)
    trend = avgFirst - avgSecond  // positief = absolute drift daalt = LE wordt beter
  }
  // Confidence: combinatie van sample-size en spreiding
  let confidence: 'low' | 'medium' | 'high' = 'low'
  if (n >= 3 && stdDev < 10) confidence = 'high'
  else if (n >= 2 && stdDev < 20) confidence = 'medium'
  return {
    bv, key, n, medianDriftPct: median, meanDriftPct: mean,
    stdDevPct: stdDev, trendPct: trend, confidence, points,
  }
}
