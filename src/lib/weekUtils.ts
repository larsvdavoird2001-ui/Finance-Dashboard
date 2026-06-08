// ISO-week helpers voor de Voorspelling-tab. De OHW Excel bevat omzet "t/m
// week N" — dat moeten we naar maandeind extrapoleren met als regel: tel
// het aantal kalenderweken die ten minste één dag van de maand bevatten
// (partial week aan het eind van de maand telt volledig mee), en bepaal
// welke daarvan al door het bestand gedekt zijn.

const MONTH_CODES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/** ISO-weeknummer (1-53) voor een datum. Maandag-start, donderdag-regel. */
export function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  // Donderdag van de huidige week → bepaalt het jaar
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
}

export interface MonthWeekRange {
  /** Eerste ISO-weeknummer dat een dag van de maand bevat. */
  firstWeek: number
  /** Laatste ISO-weeknummer dat een dag van de maand bevat. */
  lastWeek: number
  /** Totaal aantal weken dat ten minste één dag van de maand bevat
   *  (partial weken aan begin/einde tellen volledig). */
  total: number
  /** Voor de zeldzame jaargrens-overgang (Dec → week 01 next year). */
  crossesYearBoundary: boolean
}

/** Bereken de week-range voor de target-maand. */
export function getMonthWeekRange(year: number, monthIdx: number): MonthWeekRange {
  const firstDay = new Date(Date.UTC(year, monthIdx, 1))
  const lastDay  = new Date(Date.UTC(year, monthIdx + 1, 0))
  const firstWeek = isoWeekNumber(firstDay)
  const lastWeek  = isoWeekNumber(lastDay)

  if (lastWeek >= firstWeek) {
    return { firstWeek, lastWeek, total: lastWeek - firstWeek + 1, crossesYearBoundary: false }
  }
  // Jaargrens: bv. Dec-26 begint in week 49 en eindigt in week 53 of week 01.
  // Tel via daadwerkelijke iteratie zodat de telling robuust blijft.
  const lastWeekOfPrevYear = isoWeekNumber(new Date(Date.UTC(year, 11, 28))) // 28 dec is altijd in laatste week
  const total = (lastWeekOfPrevYear - firstWeek + 1) + lastWeek
  return { firstWeek, lastWeek, total, crossesYearBoundary: true }
}

/** Maandcode 'May-26' → { year, monthIdx }. */
export function parseMonthCode(monthCode: string): { year: number; monthIdx: number } | null {
  const m = monthCode.match(/^(\w+)-(\d{2})$/)
  if (!m) return null
  const idx = MONTH_CODES.indexOf(m[1])
  if (idx < 0) return null
  return { year: 2000 + Number(m[2]), monthIdx: idx }
}

/** Extract weeknummer uit een OHW-bestandsnaam zoals
 *  "Onderhanden Werk week 21 NA.xlsx" of "OHW week 18.xlsx".
 *  Pakt het eerste integer-getal direct na "week" (case-insensitive). */
export function weekFromFilename(fileName: string): number | null {
  const m = fileName.match(/week\s*[_-]?\s*(\d{1,2})/i)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= 53 ? n : null
}

export interface OhwExtrapolation {
  fileWeek: number
  /** Aantal weken van de target-maand al gedekt door het bestand. */
  weeksCovered: number
  /** Totaal aantal weken van de target-maand (partial telt vol). */
  weeksTotal: number
  /** Vermenigvuldigingsfactor: weeksTotal / weeksCovered.
   *  Een file van week 21 voor mei (weken 18-22) → 5/4 = 1,25. */
  factor: number
  /** True wanneer de file-week buiten de maand valt (te oud of te nieuw). */
  outOfRange: boolean
}

/** Bereken de extrapolatie-factor voor de OHW Excel.
 *  - target month: bv. 'May-26'
 *  - file week: bv. 21
 *
 *  weeksTotal = aantal weken die ten minste één dag van de maand bevatten
 *  weeksCovered = (fileWeek − firstWeek + 1), geclamped tussen 1 en weeksTotal
 *  factor = weeksTotal / weeksCovered
 *
 *  Voorbeeld May-26 (weken 18-22) met fileWeek=21:
 *    weeksTotal=5, weeksCovered=4 → factor=1.25
 *
 *  Wanneer fileWeek buiten [firstWeek, lastWeek] valt zetten we outOfRange=true
 *  en factor=1 — bestand is dan niet bruikbaar voor extrapolatie. */
export function computeOhwExtrapolation(monthCode: string, fileWeek: number): OhwExtrapolation | null {
  const m = parseMonthCode(monthCode)
  if (!m) return null
  const range = getMonthWeekRange(m.year, m.monthIdx)
  const outOfRange = fileWeek < range.firstWeek || fileWeek > range.lastWeek
  if (outOfRange) {
    return {
      fileWeek, weeksCovered: range.total, weeksTotal: range.total, factor: 1, outOfRange: true,
    }
  }
  const weeksCovered = Math.max(1, Math.min(range.total, fileWeek - range.firstWeek + 1))
  return {
    fileWeek,
    weeksCovered,
    weeksTotal: range.total,
    factor: range.total / weeksCovered,
    outOfRange: false,
  }
}
