// AUTO-GENERATED door scripts/extract-maandafsluiting-full.mjs
// Source: P12.2025 - Onderhanden werk 2025 (3).xlsx (tab "OHW mbM", rijen 2-4)
// Totaal Onderhanden per BV per maand voor 2025. Gebruikt om de OHW-balken
// in het dashboard te vullen voor 2025 (zonder per-debiteur breakdown).

export const OHW_TOTAAL_2025: Record<string, Record<string, number>> = {
  "Consultancy": {
    "Dec-24": 477712,
    "Jan-25": 478675,
    "Feb-25": 477712,
    "Mar-25": 489970,
    "Apr-25": 596214,
    "May-25": 443654,
    "Jun-25": 415039,
    "Jul-25": 456283,
    "Aug-25": 463342,
    "Sep-25": 491323,
    "Oct-25": 365793,
    "Nov-25": 472821,
    "Dec-25": 272868
  },
  "Projects": {
    "Dec-24": 1120910,
    "Jan-25": 1232404,
    "Feb-25": 1120910,
    "Mar-25": 951237,
    "Apr-25": 1110360,
    "May-25": 1188067,
    "Jun-25": 1041797,
    "Jul-25": 1075506,
    "Aug-25": 1131279,
    "Sep-25": 1183345,
    "Oct-25": 1104797,
    "Nov-25": 1082946,
    "Dec-25": 952410
  },
  "Software": {
    "Dec-24": 446602,
    "Jan-25": 413440,
    "Feb-25": 429102,
    "Mar-25": 478361,
    "Apr-25": 463120,
    "May-25": 514694,
    "Jun-25": 475921,
    "Jul-25": 465000,
    "Aug-25": 511930,
    "Sep-25": 553650,
    "Oct-25": 650345,
    "Nov-25": 808198,
    "Dec-25": 768100
  }
}

/** Helper: totaal over alle 3 productie-BVs voor een gegeven maand. */
export function totaalOhw2025(month: string): number {
  let sum = 0
  for (const bv of ['Consultancy', 'Projects', 'Software']) {
    sum += OHW_TOTAAL_2025[bv]?.[month] ?? 0
  }
  return sum
}
