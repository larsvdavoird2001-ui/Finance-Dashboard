// Filtert de ruwe geüploade rijen op één specifieke kalendermaand en
// re-aggregeert het bedrag per BV. SAP-exports voor de Voorspelling-tab
// bevatten doorgaans de hele YTD-periode (Jan tot en met huidige maand);
// zonder dit filter zou de extrapolatie naar maandeind belachelijke
// totalen opleveren ("dubbel/triple") omdat een jaar-totaal door één maand
// gedeeld wordt.
//
// Aanpak:
//   1. Detecteer een datum-kolom op basis van header-keywords.
//   2. Parse elke rij-datum naar (year, month). Ondersteunt JS Date-objecten,
//      ISO YYYY-MM-DD, NL dd-mm-yyyy/dd/mm/yyyy/dd.mm.yyyy, period-codes
//      "P05.2026" / "2026-05" / "5/2026" en SAP-Excel serieel.
//   3. Houd alleen rijen waar de datum in de doel-maand valt.
//   4. Tel het bedrag per BV opnieuw bij elkaar op met de bedrag-/BV-kolom
//      die de GenericImportWizard heeft bevestigd.
//
// Resultaat: { perBv, totalAmount, dateCol, kept, dropped }. Caller (de
// Voorspelling-tab) kan dit gebruiken om de oorspronkelijke ParseResult-
// totalen te overschrijven met de op maand gefilterde versie.

import type { BvId } from '../data/types'
import { parseDutchNumber } from './parseImport'

const MONTH_CODES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/** Mogelijke kolomnamen voor de datum/periode-velden. Volgorde = prioriteit
 *  (eerste match wint). Vergelijking is case-insensitive en op substring. */
const DATE_COLUMN_KEYWORDS = [
  'factuurdatum', 'boekdatum', 'invoice date', 'doc.datum', 'doc datum',
  'documentdatum', 'document date', 'datum', 'date', 'periode', 'period',
  'fiscale periode', 'fiscal period', 'maand', 'month',
]

/** BV-aliassen uit ruwe waarden naar onze 3 productie-BVs. */
const BV_ALIASES: Array<[RegExp, BvId]> = [
  [/consultanc/i,    'Consultancy'],
  [/projects?/i,     'Projects'],
  [/software/i,      'Software'],
  [/p15000/i,        'Consultancy'],
  [/p25000/i,        'Projects'],
  [/p35000/i,        'Software'],
  [/^co$/i,          'Consultancy'],
  [/^pr$/i,          'Projects'],
  [/^sw$/i,          'Software'],
]

function detectDateColumnByHeader(headers: string[]): string | null {
  const lower = headers.map(h => (h ?? '').toString().toLowerCase().trim())
  for (const kw of DATE_COLUMN_KEYWORDS) {
    const idx = lower.findIndex(h => h.includes(kw))
    if (idx >= 0) return headers[idx]
  }
  return null
}

/** Content-based date detection als fallback. Bekijkt elke kolom en kijkt
 *  hoeveel van de eerste ~50 niet-lege waarden parseerbaar zijn als datum.
 *  Een kolom met ≥ 50% datum-parseable waarden én ≥ 5 hits in totaal wordt
 *  beschouwd als datum-kolom. Bij meerdere kandidaten wint de hoogste hit-rate. */
function detectDateColumnByContent(
  headers: string[],
  rows: Record<string, unknown>[],
): string | null {
  const SAMPLE_SIZE = 50
  const MIN_HITS = 5
  const MIN_HIT_RATE = 0.5
  let best: { col: string; hitRate: number; hits: number } | null = null

  for (const col of headers) {
    let hits = 0
    let nonEmpty = 0
    for (let i = 0; i < rows.length && nonEmpty < SAMPLE_SIZE; i++) {
      const v = rows[i][col]
      if (v == null || v === '') continue
      nonEmpty++
      if (parseRowDate(v) !== null) hits++
    }
    if (nonEmpty === 0 || hits < MIN_HITS) continue
    const hitRate = hits / nonEmpty
    if (hitRate < MIN_HIT_RATE) continue
    if (!best || hitRate > best.hitRate) {
      best = { col, hitRate, hits }
    }
  }
  return best?.col ?? null
}

function detectDateColumn(headers: string[], rows: Record<string, unknown>[]): string | null {
  return detectDateColumnByHeader(headers) ?? detectDateColumnByContent(headers, rows)
}

interface YearMonth { year: number; month: number } // month 0-11

/** Pak (year, month) uit een rij-waarde. Geeft null wanneer onparseable. */
function parseRowDate(val: unknown): YearMonth | null {
  if (val == null || val === '') return null

  // Native Date / xlsx cellDates: true geeft Date-objecten.
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null
    return { year: val.getFullYear(), month: val.getMonth() }
  }

  // Excel-serial (een getal als datum). Heuristiek: > 20000 (= 1954) en
  // < 100000 (= ~2173). Vermijdt botsing met "20240501"-achtige cijferdumps.
  if (typeof val === 'number' && val > 20000 && val < 100000) {
    // Excel epoch is 1899-12-30 (om bugfix met 1900-leap), in dagen.
    const ms = (val - 25569) * 86400 * 1000
    const d = new Date(ms)
    if (!isNaN(d.getTime())) return { year: d.getFullYear(), month: d.getMonth() }
  }

  const s = String(val).trim()
  if (!s) return null

  let m: RegExpMatchArray | null

  // ISO YYYY-MM-DD of YYYY-MM-DDTHH...
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return { year: +m[1], month: +m[2] - 1 }

  // YYYY-MM (zonder dag)
  m = s.match(/^(\d{4})-(\d{1,2})$/)
  if (m) return { year: +m[1], month: +m[2] - 1 }

  // NL: DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/)
  if (m) return { year: +m[3], month: +m[2] - 1 }

  // NL: DD-MM-YY
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/)
  if (m) return { year: 2000 + +m[3], month: +m[2] - 1 }

  // SAP fiscale periode: "P05.2026", "05.2026", "5/2026", "2026/05"
  m = s.match(/^p?(\d{1,2})[./](\d{4})$/i)
  if (m) return { year: +m[2], month: +m[1] - 1 }
  m = s.match(/^(\d{4})[./](\d{1,2})$/)
  if (m) return { year: +m[1], month: +m[2] - 1 }

  // App-maandcode "May-26" of "May 2026"
  m = s.match(/^(\w{3,})[\s-](\d{2}|\d{4})$/)
  if (m) {
    // Engelse drie-letter afkortingen
    const eng = MONTH_CODES.findIndex(c => c.toLowerCase() === m![1].slice(0, 3).toLowerCase())
    // Nederlandse drie-letter afkortingen
    const nlAbbr: Record<string, number> = {
      jan: 0, feb: 1, mrt: 2, maa: 2, apr: 3, mei: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, okt: 9, nov: 10, dec: 11,
    }
    const nlLong: Record<string, number> = {
      januari: 0, februari: 1, maart: 2, april: 3, mei: 4, juni: 5, juli: 6,
      augustus: 7, september: 8, oktober: 9, november: 10, december: 11,
    }
    const key = m[1].toLowerCase()
    const idx = eng >= 0 ? eng : (nlAbbr[key.slice(0, 3)] ?? nlLong[key] ?? -1)
    if (idx >= 0) {
      const yy = m[2].length === 2 ? 2000 + +m[2] : +m[2]
      return { year: yy, month: idx }
    }
  }

  return null
}

/** 'May-26' → { year: 2026, month: 4 }. */
function monthCodeToYearMonth(monthCode: string): YearMonth | null {
  const m = monthCode.match(/^(\w+)-(\d{2})$/)
  if (!m) return null
  const idx = MONTH_CODES.indexOf(m[1])
  if (idx < 0) return null
  return { year: 2000 + +m[2], month: idx }
}

function bvFromRowValue(val: unknown): BvId | null {
  if (val == null) return null
  const s = String(val)
  for (const [pat, bv] of BV_ALIASES) {
    if (pat.test(s)) return bv
  }
  return null
}

export interface FilterToMonthResult {
  /** True als er een datum-kolom is gevonden én er rijen overgebleven zijn
   *  voor de doel-maand. Bij `false` valt de caller terug op de ongefilterde
   *  ParseResult-totalen. */
  applied: boolean
  /** Welke kolom we als datum hebben herkend (voor in de UI). */
  dateCol: string | null
  /** Aantal rijen behouden (in de doel-maand). */
  kept: number
  /** Aantal rijen weggefilterd (datum buiten doel-maand of onparseable). */
  dropped: number
  /** Gefilterd per BV (alleen rijen van doel-maand). */
  perBv: Record<BvId, number>
  /** Totaal van alle behouden rijen. */
  totalAmount: number
}

export function filterRowsToMonth(args: {
  rows: Record<string, unknown>[]
  headers: string[]
  amountCol: string
  bvCol: string
  /** App-maandcode bv. 'May-26'. */
  targetMonth: string
  /** Optioneel: absolute waarde nemen (zoals factuurvolume-config doet voor
   *  creditnota's die anders het totaal drukken). */
  absoluteValue?: boolean
  /** Optioneel: alleen positieve bedragen meetellen. */
  positiveOnly?: boolean
}): FilterToMonthResult {
  const { rows, headers, amountCol, bvCol, targetMonth, absoluteValue, positiveOnly } = args
  const target = monthCodeToYearMonth(targetMonth)
  const dateCol = detectDateColumn(headers, rows)
  const emptyPerBv: Record<BvId, number> = { Consultancy: 0, Projects: 0, Software: 0 }

  if (!target || !dateCol) {
    return { applied: false, dateCol, kept: 0, dropped: 0, perBv: emptyPerBv, totalAmount: 0 }
  }

  let kept = 0
  let dropped = 0
  let totalAmount = 0
  const perBv: Record<BvId, number> = { Consultancy: 0, Projects: 0, Software: 0 }

  for (const row of rows) {
    const parsed = parseRowDate(row[dateCol])
    if (!parsed || parsed.year !== target.year || parsed.month !== target.month) {
      dropped++
      continue
    }
    let amount = parseDutchNumber(row[amountCol])
    if (amount === null) { dropped++; continue }
    if (absoluteValue) amount = Math.abs(amount)
    if (positiveOnly && amount < 0) { dropped++; continue }
    const bv = bvFromRowValue(row[bvCol])
    if (!bv) { dropped++; continue }
    perBv[bv] += amount
    totalAmount += amount
    kept++
  }

  return { applied: kept > 0 || dropped > 0, dateCol, kept, dropped, perBv, totalAmount }
}
