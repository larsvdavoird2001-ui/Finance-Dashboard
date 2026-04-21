// parseImport.ts — intelligente SAP Excel/CSV parser voor TPG Finance imports
import * as XLSX from 'xlsx'

type BvId = 'Consultancy' | 'Projects' | 'Software'
const BVS: BvId[] = ['Consultancy', 'Projects', 'Software']

// Kolom-keywords per slot-type (lagere index = hogere prioriteit)
type SlotAmountConfig = {
  amountCols: string[]
  bvCols: string[]
  positiveOnly?: boolean
  absoluteValue?: boolean
  /** Als dit slot maar voor één BV is, wordt BV-detectie overgeslagen */
  targetBv?: BvId
  /** OHW-rij ID die dit slot vult (bijv. 'p1' voor uren_lijst) */
  targetRowId?: string
  /** Entity (BV) waar de OHW-rij in zit */
  targetEntity?: string
}

const SLOT_CONFIGS: Record<string, SlotAmountConfig> = {
  factuurvolume: {
    amountCols: [
      'netto bedrag excl. btw', 'netto bedrag excl btw', 'nettowaarde excl. btw', 'nettowaarde excl btw',
      'netto waarde excl. btw', 'netto waarde excl btw', 'bedrag excl. btw', 'bedrag excl btw',
      'netto excl. btw', 'netto excl btw', 'netto bedrag', 'nettowaarde', 'netto waarde',
      'factuurbedrag', 'gefactureerd bedrag', 'facturatie bedrag',
      'netto', 'bedrag', 'amount', 'totaal', 'waarde', 'omzet', 'gefactureerd',
    ],
    bvCols: [
      'verantwoordelijke eenheid', 'verantw. eenheid', 'verantw eenheid',
      'bedrijfstak', 'business unit', 'businessunit',
      'winstcentrum', 'winst centrum', 'profit center', 'profitcenter',
      'vennootschap', 'bv naam', 'entiteit', 'organisatorische eenheid',
      'divisie', 'afdeling', 'kostenplaats', 'eenheid',
      'bv', 'bedrijf', 'entity', 'company', 'organisatie',
    ],
    absoluteValue: true,
  },
  geschreven_uren: {
    amountCols: ['geschreven uren', 'totaal uren', 'uren', 'hours', 'werkuren', 'arbeid', 'written', 'totaal'],
    bvCols: ['winstcentrum', 'profit center', 'bv', 'vennootschap', 'afdeling', 'department', 'organisatie'],
    positiveOnly: true,
  },
  uren_lijst: {
    // Uren-lijst is nu een multi-BV slot: per rij de BV uit de BV-kolom, en de
    // NETTO WAARDE (in €) als bedrag. De totalen per BV landen in een OHW-rij
    // per BV (zie UPLOAD_SLOTS.targetRowByBv in MaandTab).
    amountCols: [
      'netto waarde', 'nettowaarde', 'netto bedrag', 'nettobedrag',
      'netto excl btw', 'netto excl. btw', 'netto',
      'waarde', 'bedrag', 'amount', 'totaal', 'totale waarde', 'factuurwaarde',
    ],
    bvCols: [
      'verantwoordelijke eenheid', 'verantw. eenheid', 'verantw eenheid',
      'winstcentrum', 'winst centrum', 'profit center', 'profitcenter',
      'vennootschap', 'bv naam', 'entiteit', 'organisatorische eenheid',
      'afdeling', 'department', 'bedrijfstak', 'business unit', 'businessunit',
      'bv', 'bedrijf', 'entity', 'company', 'organisatie', 'eenheid',
    ],
    absoluteValue: false,   // credits kunnen negatief zijn, respecteer teken
    positiveOnly: false,
    // Geen targetBv/targetRowId meer — multi-BV
  },
  d_lijst: {
    // D-lijst = declarabele uren Consultancy met tarief. We sommeren de
    // NETTO WAARDE (€), niet de uren zelf. BV-kolom is optioneel — als ingesteld
    // filtert de compute-logica naar alleen rijen waarvan de BV Consultancy is
    // (voor gemengde SAP-exports).
    amountCols: [
      'netto waarde', 'nettowaarde', 'netto bedrag', 'nettobedrag',
      'netto excl btw', 'netto excl. btw', 'netto',
      'declarabele waarde', 'declarabel bedrag', 'billable amount', 'billable value',
      'factuurwaarde', 'totale waarde',
      'bedrag', 'waarde', 'amount', 'totaal',
      // Legacy fallbacks voor files zonder € kolom — worden alleen als
      // laatste gekozen (wizard toont match-count zodat gebruiker ziet of
      // dit een uren-kolom is en handmatig kan bijsturen)
      'declarabel', 'billable', 'declarabele uren', 'billable hours', 'faktureerbaar',
    ],
    bvCols: [
      'verantwoordelijke eenheid', 'verantw. eenheid', 'verantw eenheid',
      'winstcentrum', 'winst centrum', 'profit center', 'profitcenter',
      'vennootschap', 'bv naam', 'entiteit', 'organisatorische eenheid',
      'afdeling', 'department', 'bedrijfstak', 'business unit', 'businessunit',
      'bv', 'bedrijf', 'entity', 'company', 'organisatie', 'eenheid',
    ],
    absoluteValue: false,
    positiveOnly: false,    // credit-regels (negatief) tellen mee voor correcte saldo
    targetBv: 'Consultancy',
    targetRowId: 'c1',
    targetEntity: 'Consultancy',
  },
  conceptfacturen: {
    amountCols: ['concept bedrag', 'netto', 'bedrag', 'amount', 'waarde', 'totaal'],
    bvCols: ['winstcentrum', 'bv', 'vennootschap', 'profit center'],
    absoluteValue: true,
  },
  missing_hours: {
    amountCols: ['ontbrekende uren', 'missing', 'uren', 'hours', 'missing hours', 'totaal uren'],
    bvCols: ['winstcentrum', 'bv', 'afdeling'],
    positiveOnly: false,
    targetBv: 'Consultancy',
    targetRowId: 'c4',
    targetEntity: 'Consultancy',
  },
  ohw: {
    amountCols: ['ohw', 'onderhanden', 'waarde', 'bedrag', 'amount', 'saldo', 'balance', 'totaal'],
    bvCols: ['winstcentrum', 'bv', 'vennootschap', 'profit center', 'project bv', 'entiteit'],
    absoluteValue: false,
    targetBv: 'Projects',
    targetRowId: 'p10',
    targetEntity: 'Projects',
  },
}

// ── Getal-parser ────────────────────────────────────────────────────────────
// Handelt Nederlandse én internationale notatie af, inclusief negatieve getallen
// en haakjes-notatie (creditnota's zoals SAP die soms exporteert).
export function parseDutchNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null

  // XLSX geeft numerieke cellen terug als JavaScript number — direct gebruiken
  if (typeof val === 'number') return isFinite(val) ? val : null

  let s = String(val)
    .trim()
    .replace(/[€$£\u00a0\u200b\u200c\u200d\ufeff]/g, '') // currency-symbolen & zero-width chars
    .replace(/\s+/g, '')                                   // alle whitespace eruit
    .replace(/[−–—]/g, '-')                               // verschillende min-tekens normaliseren

  if (s === '' || s === '-') return null

  // Haakjes-notatie voor negatieve bedragen: (1.234,56) of (1234,56)
  if (s.startsWith('(') && s.endsWith(')')) {
    const inner = parseDutchNumber(s.slice(1, -1))
    return inner !== null ? -Math.abs(inner) : null
  }

  const negative = s.startsWith('-')
  const abs = negative ? s.slice(1) : s

  // Nederlandse notatie: 1.234,56  of  1.234.567,89  of  1.234  (geen decimalen)
  if (/^\d{1,3}(\.\d{3})+(,\d*)?$/.test(abs)) {
    const n = parseFloat(abs.replace(/\./g, '').replace(',', '.'))
    return isFinite(n) ? (negative ? -n : n) : null
  }

  // Internationale notatie: 1,234.56  of  1,234,567.89
  if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(abs)) {
    const n = parseFloat(abs.replace(/,/g, ''))
    return isFinite(n) ? (negative ? -n : n) : null
  }

  // Eenvoudig getal met komma als decimaalteken: 1234,56
  if (/^\d+(,\d+)?$/.test(abs)) {
    const n = parseFloat(abs.replace(',', '.'))
    return isFinite(n) ? (negative ? -n : n) : null
  }

  // Eenvoudig getal met punt als decimaalteken: 1234.56  of  1234
  if (/^\d+(\.\d+)?$/.test(abs)) {
    const n = parseFloat(abs)
    return isFinite(n) ? (negative ? -n : n) : null
  }

  return null
}

// ── Totaal-/resultaatregel-detectie ─────────────────────────────────────
// SAP-exports bevatten vaak subtotaal-/totaal-/eindtotaal-rijen die niet bij
// de detail-data horen. Deze moeten uit de som gehouden worden, anders worden
// totalen dubbel geteld. We combineren twee signalen:
//  1. Strict regex matching op eind-van-string total-labels ("Totaal",
//     "Subtotaal", enz.)
//  2. Ruimere "starts-with" patterns voor labels zoals "Totaal Consultancy",
//     "Subtotaal Projects AK", gecombineerd met een structurele check
//     (rij heeft ≤ 4 niet-lege cellen — typisch voor subtotaal-regels).
// Dit voorkomt false positives op detail-rijen die toevallig met "Totaal"
// beginnen (zoals project-beschrijving "Totaal Glaspoort fase 1").

/** Strikte patterns: cel is EXACT een totaal-label (hele string). */
const TOTAL_LABEL_STRICT_PATTERNS = [
  /^(sub|eind|grand\s?)?totaal\s*[:.-]?\s*$/i,                  // "Totaal", "Subtotaal", "Eindtotaal", "Totaal:"
  /^(sub|eind|grand\s?)?total\s*[:.-]?\s*$/i,                   // "Total", "Grand total"
  /^(sub|eind)?totaal[\s\-]+generaal\s*[:.-]?\s*$/i,            // "Totaal generaal"
  /^(sub|eind)?totaal[\s\-]+per[\s\-]+\w+\s*[:.-]?\s*$/i,       // "Totaal per BV", "Totaal per maand"
  /^(sub|eind)?totaal[\s\-]+(alle|all)\b.*$/i,                  // "Totaal alle BVs"
  /^\s*\*+\s*(eind|sub)?totaal.*\*+\s*$/i,                      // "** Totaal **"
  /^som\s*[:.-]?\s*$/i,                                         // "Som", "Som:"
  /^generaal\s*[:.-]?\s*$/i,                                    // "Generaal"
  /^resultaat\s*[:.-]?\s*$/i,                                   // "Resultaat"
  /^eindresultaat\s*[:.-]?\s*$/i,                               // "Eindresultaat"
  /^(netto|bruto)\s+resultaat\s*[:.-]?\s*$/i,
  /^samenvatting\s*[:.-]?\s*$/i,
  /^grand\s+total\s*[:.-]?\s*$/i,
  /^eindstand\s*[:.-]?\s*$/i,                                   // "Eindstand"
  /^afsluitstand\s*[:.-]?\s*$/i,
  /^(tussen|deel)totaal\s*[:.-]?\s*$/i,                         // "Tussentotaal", "Deeltotaal"
]

/** Startsmatch: cel BEGINT met een totaal-keyword + whitespace, gevolgd door
 *  BV-namen of korte labels. Wordt gecombineerd met een "rij is klein"-check
 *  om project-beschrijvingen uit te sluiten. */
const TOTAL_LABEL_STARTSWITH_PATTERNS = [
  /^(sub|eind|grand\s?)?totaal\s+(alle|all|per|generaal|bv|consultancy|projects?|software|holdings?)\b/i,
  /^(sub|eind|grand\s?)?total\s+(all|per|consultancy|projects?|software|holdings?)\b/i,
  /^subtotaal\s+/i,                                             // "Subtotaal <iets>"
  /^eindtotaal\s+/i,
  /^eindresultaat\s+/i,
  /^netto\s+resultaat\s+/i,
  /^bruto\s+resultaat\s+/i,
]

/** Is een cel-waarde een totaal-/resultaat-label (strict)? */
export function looksLikeTotalLabel(val: unknown): boolean {
  if (val === null || val === undefined) return false
  const s = String(val).trim()
  if (!s) return false
  return TOTAL_LABEL_STRICT_PATTERNS.some(p => p.test(s))
}

/** Is deze rij vermoedelijk een totaal-/subtotaal-/resultaatregel?
 *
 *  Combineert signalen:
 *   A. Een cel matcht EXACT een strict total-label pattern → direct total
 *   B. Een cel begint met "Totaal BV" / "Subtotaal X" etc EN de rij heeft
 *      ≤ 4 niet-lege cellen → total (kleine rij = samenvatting, niet detail)
 *   C. Alle niet-numerieke cellen zijn leeg behalve één die met "totaal"
 *      begint (klassieke SAP bold subtotaal-rij)
 */
export function isLikelyTotalRow(row: Record<string, unknown>): boolean {
  const values = Object.values(row)

  // Signaal A: strict match op een exact total-label
  for (const val of values) {
    if (looksLikeTotalLabel(val)) return true
  }

  // Tellen: aantal niet-lege cellen + cellen met totaal-keyword prefix
  let nonEmpty = 0
  let numericOnlyCount = 0
  let hasStartsWithTotal = false
  for (const val of values) {
    if (val === null || val === undefined) continue
    const s = String(val).trim()
    if (!s) continue
    nonEmpty++
    if (parseDutchNumber(s) !== null) numericOnlyCount++
    if (TOTAL_LABEL_STARTSWITH_PATTERNS.some(p => p.test(s))) {
      hasStartsWithTotal = true
    }
  }

  // Signaal B: startsWith-match + kleine rij (≤ 4 non-empty cellen)
  if (hasStartsWithTotal && nonEmpty <= 4) return true

  // Signaal C: "sparse" rij — <= 3 non-empty cellen, waarvan ≥ 1 numeriek en
  // een andere begint met totaal/subtotaal/...
  if (nonEmpty <= 3 && numericOnlyCount >= 1 && hasStartsWithTotal) return true

  return false
}

/** Parse een cel met bedrag/uren die SAP soms met units exporteert:
 *  "1.234 EUR", "1.234,56 EUR,-", "40 u", "8 uur", "12,5 hrs", "40%".
 *  Strip alle Latijnse letters (ook accenten), euro/dollar/pond symbolen,
 *  procent, en trailing "-" (Nederlands "1234,-" = €1234,00). */
export function parseAmountCell(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null
  if (typeof val === 'number') return isFinite(val) ? val : null
  let s = String(val)
    .replace(/[a-zA-ZÀ-ɏ%]/g, ' ')
    .replace(/[,.]-\s*$/, '')  // Nederlandse ",-" of ".-" trailing (betekent .00)
    .trim()
  if (!s) return null
  return parseDutchNumber(s)
}

/** Parse een cel-waarde met unit-suffix ("40 u", "8uur", "12,5 hrs", "8h")
 *  door alle letters te strippen en daarna parseDutchNumber toe te passen.
 *  Handelt ook percentages ("40%") en andere achtervoegsels af. */
export function parseHoursCell(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null
  if (typeof val === 'number') return isFinite(val) ? val : null
  // Strip Latin letters (incl. accented) + procentteken — alles wat geen
  // signaal geeft bij uren. Houd cijfers, komma, punt, minus, haakjes en spatie.
  const cleaned = String(val)
    .replace(/[a-zA-ZÀ-ɏ%]/g, '')  // a-z, accented, %
    .trim()
  if (!cleaned) return null
  return parseDutchNumber(cleaned)
}

// ── BV-detectie ─────────────────────────────────────────────────────────────
// Strip legale suffixen (B.V., AK, NV, etc.) en bedrijfsprefixen (TPG, etc.)
// zodat "Projects B.V.", "TPG Projects AK", "Projects BV 100" allemaal
// herkend worden als Projects.

const LEGAL_SUFFIXES = /\b(b\.?v\.?|n\.?v\.?|a\.?k\.?|gmbh|ltd|inc|llc|bvba|s\.?a\.?|ag|oy|as)\b/gi
const COMPANY_PREFIXES = /\b(tpg|the people group|the|people|group)\b/gi
const STRIP_NUMBERS = /\b\d+\b/g
const STRIP_PUNCT = /[._\-,;:\/\\|()[\]{}'"]/g

function normalizeBvString(val: string): string {
  return val
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(COMPANY_PREFIXES, ' ')
    .replace(STRIP_NUMBERS, ' ')
    .replace(STRIP_PUNCT, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function detectBvFromValue(val: unknown): BvId | null {
  if (val === null || val === undefined) return null
  const raw = String(val).trim()
  if (!raw) return null

  const norm = normalizeBvString(raw)

  // Meest specifiek eerst om false positives te voorkomen
  if (/\bconsult(ancy)?\b/.test(norm)) return 'Consultancy'
  if (/\bprojects?\b/.test(norm)) return 'Projects'
  if (/\bsoftware\b/.test(norm)) return 'Software'

  // Kortere aliassen als fallback
  const lc = raw.toLowerCase().trim()
  if (lc === 'cons' || lc === 'consultancy' || lc === 'con') return 'Consultancy'
  if (lc === 'proj' || lc === 'projects' || lc === 'project') return 'Projects'
  if (lc === 'sw' || lc === 'soft' || lc === 'software') return 'Software'

  // Numerieke BV-codes die SAP soms exporteert (bijv. "100" = Consultancy, "200" = Projects, "300" = Software)
  // en kostenplaats-patronen (bijv. "1000" of "TPG-C")
  if (/^tpg[\s\-_]*c\b/i.test(raw) || /\bconsultancy\s*(bv|b\.v\.|ak|a\.k\.)/i.test(raw)) return 'Consultancy'
  if (/^tpg[\s\-_]*p\b/i.test(raw) || /\bprojects?\s*(bv|b\.v\.|ak|a\.k\.)/i.test(raw)) return 'Projects'
  if (/^tpg[\s\-_]*s\b/i.test(raw) || /\bsoftware\s*(bv|b\.v\.|ak|a\.k\.)/i.test(raw)) return 'Software'

  return null
}

/** Haal de slot-configuratie op (publiek voor gebruik in MaandTab) */
export function getSlotConfig(slotId: string): SlotAmountConfig | undefined {
  return SLOT_CONFIGS[slotId]
}

// ── Kolom-detectie ───────────────────────────────────────────────────────────

function scoreAmountColumn(
  col: string,
  rows: Record<string, unknown>[],
  config: SlotAmountConfig,
  sampleSize = 100,
): { parseable: number; ratio: number; total: number } {
  const sample = rows.length > sampleSize ? rows.slice(0, sampleSize) : rows
  let parseable = 0
  let total = 0
  for (const row of sample) {
    const n = parseDutchNumber(row[col])
    if (n === null) continue
    const v = config.absoluteValue ? Math.abs(n) : n
    if (config.positiveOnly && v < 0) continue
    if (v !== 0) { parseable++; total += v }
  }
  return { parseable, ratio: parseable / sample.length, total }
}

function findBestAmountColumn(
  headers: string[],
  rows: Record<string, unknown>[],
  keywords: string[],
  config: SlotAmountConfig,
  override?: string,
): string {
  if (override) return override

  // Verzamel kandidaten op basis van keyword-match in kolomnaam
  const candidates: Array<{ col: string; kwScore: number }> = []
  for (const h of headers) {
    const hl = h.toLowerCase()
    let best = Infinity
    for (let i = 0; i < keywords.length; i++) {
      if (hl.includes(keywords[i])) { best = Math.min(best, i); break }
    }
    if (best < Infinity) candidates.push({ col: h, kwScore: best })
  }

  // Geen keyword-match: evalueer alle kolommen
  const pool = candidates.length > 0
    ? candidates
    : headers.map(col => ({ col, kwScore: 999 }))

  let bestCol = ''
  let bestFinalScore = -Infinity

  for (const { col, kwScore } of pool) {
    const { ratio } = scoreAmountColumn(col, rows, config)
    // Straf kolommen zwaar af als ze bijna geen parsebare waarden hebben
    const penalty = ratio < 0.05 ? -50 : 0
    const finalScore = ratio * 60 - (kwScore / keywords.length) * 40 + penalty
    if (finalScore > bestFinalScore) {
      bestFinalScore = finalScore
      bestCol = col
    }
  }

  return bestCol
}

// BV-kolom detectie: combineert keyword-score op kolomnaam ÉN data-score
// (hoeveel waarden in de kolom zijn herkenbaar als BV-naam?).
function findBestBvColumn(
  headers: string[],
  rows: Record<string, unknown>[],
  keywords: string[],
  override?: string,
): string {
  if (override) return override

  const sample = rows.length > 100 ? rows.slice(0, 100) : rows

  let bestCol = ''
  let bestScore = -Infinity

  for (const h of headers) {
    const hl = h.toLowerCase()

    // Keyword-score op kolomnaam (lager = beter keyword)
    let kwScore = 999
    for (let i = 0; i < keywords.length; i++) {
      if (hl.includes(keywords[i])) { kwScore = i; break }
    }

    // Data-score: tel hoeveel waarden in deze kolom herkend worden als BV
    let bvMatches = 0
    for (const row of sample) {
      if (detectBvFromValue(row[h])) bvMatches++
    }
    const valueRatio = bvMatches / sample.length

    // Combineer: data is het sterkste signaal (70%), keyword een bonus (30%)
    // Kolommen zonder keyword én zonder BV-waarden worden overgeslagen
    if (kwScore === 999 && valueRatio === 0) continue

    const kwBonus = kwScore < 999 ? (1 - Math.min(kwScore, keywords.length) / keywords.length) * 30 : 0
    const finalScore = valueRatio * 70 + kwBonus

    if (finalScore > bestScore) {
      bestScore = finalScore
      bestCol = h
    }
  }

  return bestCol
}

// ── Publieke interface ────────────────────────────────────────────────────────
export interface ParseResult {
  perBv: Record<BvId, number>
  totalAmount: number
  rowCount: number
  parsedCount: number
  skippedCount: number
  detectedAmountCol: string
  detectedBvCol: string
  headers: string[]
  preview: Record<string, unknown>[]  // eerste 5 rijen voor modal-preview
  rawRows: Record<string, unknown>[]  // ALLE rijen voor AI-chat queries
  warnings: string[]
  /** Als het slot voor één BV is, welke BV */
  targetBv?: BvId
  /** OHW-rij ID waar dit slot naartoe schrijft */
  targetRowId?: string
  /** Entity (BV) van de OHW-rij */
  targetEntity?: string
  /** Aantal rijen dat niet aan een BV gekoppeld kon worden */
  unmatchedCount: number
  /** Per-werknemer detail (alleen gevuld voor missing_hours flow) */
  missingHoursDetails?: MissingHoursDetail[]
  /** Per-rij detail voor generic imports (factuurvolume, uren_lijst, etc) */
  genericImportDetails?: GenericImportDetail[]
  /** Gedetailleerde bucket-tellingen zodat de UI volledige verantwoording
   *  kan tonen: hoe zijn rowCount rijen opgesplitst? Alleen gevuld voor
   *  missing_hours flow. */
  missingHoursCounts?: {
    total: number
    matched: number           // gematcht + tarief > 0 + niet uitgesloten → telt mee in totaal
    needsTariff: number       // gematcht maar geen tarief → in details, nog niet in totaal
    unmatched: number         // werknemer niet in tarieventabel
    emptyOrZero: number       // lege cellen of 0 uren
    negative: number          // negatieve uren (correcties)
    bedrijfFiltered: number   // weggefilterd door bedrijfskolom-filter
    manuallyExcluded: number  // handmatig uitgevinkt in Verfijnen-stap
    totalRowsSkipped: number  // "Totaal"/"Subtotaal"/"Eindtotaal" rijen overgeslagen
  }
}

/** Per-werknemer resultaat voor de Missing Hours wizard.
 *  Gebruikt om individuele werknemers te kunnen uitvinken in stap "Verfijnen". */
export interface MissingHoursDetail {
  /** Werknemer-ID uit tarieftabel (stabiele key voor exclusion) */
  id: string
  /** Naam zoals in tarieftabel */
  naam: string
  /** Hoeveel uren (positief) */
  uren: number
  /** IC tarief */
  tarief: number
  /** Berekend bedrag: uren × tarief × 0,9 */
  bedrag: number
  /** Ruwe waarde uit de werknemer-kolom (voor diagnostiek) */
  rawId: string
  /** Index van de bron-rij in dataRows (voor row-based exclusion) */
  rowIndex: number
}

/** Optionele handmatige kolomselectie via de "Aanpassen"-knop in de modal */
export interface ParseOverrides {
  amountCol?: string
  bvCol?: string
}

// ── OHW Excel speciaal: lees kolom AO van tabblad "Onderhande Werk" ──────────
// Rij 1 bevat een SUBTOTAL die filters respecteert — daarom tellen we zelf
// alle data-rijen op zodat eventuele actieve filters genegeerd worden.
function parseOhwExcel(wb: XLSX.WorkBook, config: SlotAmountConfig): ParseResult | null {
  // Zoek het juiste tabblad (fuzzy match op "onderhande werk")
  const sheetName = wb.SheetNames.find(name => {
    const norm = name.toLowerCase().replace(/[\s\-_]+/g, '')
    return norm.includes('onderhandewerk') ||
           norm.includes('onderhandenwerk') ||
           norm.includes('ohw')
  })

  if (!sheetName) return null // fallback naar generieke parsing

  const ws = wb.Sheets[sheetName]
  if (!ws) return null

  const warnings: string[] = []

  // Bepaal het bereik van het tabblad
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  // Kolom AO = kolom-index 40 (A=0 … Z=25, AA=26 … AO=40)
  const aoColIdx = 40

  // Loop alle rijen BEHALVE rij 1 (die de SUBTOTAL/filter-totaal bevat)
  // Rij 1 = range index 0 in XLSX (0-based); data begint bij rij 2 (index 1)
  let sum = 0
  let parsedCount = 0
  let skippedCount = 0

  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const cellAddr = XLSX.utils.encode_cell({ r, c: aoColIdx })
    const cell = ws[cellAddr]
    if (!cell) { skippedCount++; continue }

    const val = parseDutchNumber(cell.v ?? cell.w)
    if (val === null || val === 0) { skippedCount++; continue }

    sum += val
    parsedCount++
  }

  // Lees ook de gecachede waarde uit AO1 ter referentie (kan afwijken door filter)
  const ao1Cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c: aoColIdx })]
  const ao1Value = ao1Cell ? parseDutchNumber(ao1Cell.v ?? ao1Cell.w) : null

  if (parsedCount === 0) {
    warnings.push(
      `Geen bedragen gevonden in kolom AO op tabblad "${sheetName}". ` +
      `Controleer of de juiste kolom wordt gebruikt.`,
    )
  }

  // Waarschuwing als de eigen som afwijkt van de SUBTOTAL in AO1 (= filter was actief)
  if (ao1Value !== null && ao1Value !== 0 && Math.abs(sum - ao1Value) > 1) {
    warnings.push(
      `Let op: cel AO1 bevat € ${Math.round(ao1Value).toLocaleString('nl-NL')} (mogelijk gefilterd). ` +
      `Eigen optelling van alle rijen: € ${Math.round(sum).toLocaleString('nl-NL')}. ` +
      `Het ongefilterde totaal wordt gebruikt.`,
    )
  }

  // Lees alle rijen als JSON voor preview en onderbouwing
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: '',
    raw: false,
  })
  const headers = rows.length > 0 ? Object.keys(rows[0]) : []

  return {
    perBv: {
      Consultancy: 0,
      Projects: sum, // OHW Excel is altijd voor Projects
      Software: 0,
    },
    totalAmount: sum,
    rowCount: rows.length,
    parsedCount,
    skippedCount,
    detectedAmountCol: `Kolom AO (tabblad: ${sheetName})`,
    detectedBvCol: '',
    headers,
    preview: rows.slice(0, 5) as Record<string, unknown>[],
    rawRows: rows as Record<string, unknown>[],
    warnings,
    targetBv: config.targetBv,
    targetRowId: config.targetRowId,
    targetEntity: config.targetEntity,
    unmatchedCount: 0,
  }
}

// ── Missing Hours speciaal: werknemer × tarief × 0.9 ───────────────────────
// Alleen Consultancy medewerkers worden meegenomen. SAP Missing Hours exports
// gebruiken verschillende identifiers (werknemernr "10573", SAP alias
// "KJANZEN", naam "Janzen, Kevin" of "Kevin Janzen"), dus we bouwen een
// multi-key lookup en proberen meerdere varianten per rij.
export interface TariffValue {
  tarief: number
  naam: string
  id: string
}
/** Multi-fase lookup:
 *  - `byKey`: exacte canonical-variant matches (ID, alias, volledige naam,
 *    "Achternaam, Voornaam" en omgekeerd). Snelste pad.
 *  - `nameTokens`: token-set fallback per werknemer — matcht als de naam-
 *    tokens van de tarieftabel allemaal voorkomen in de cel. Dit vangt
 *    gevallen af zoals "Janzen, Kevin (C1)" of "Kevin P. Janzen" waar
 *    extra info de exacte match voorkomt. */
export interface TariffLookup {
  byKey: Record<string, TariffValue>
  nameTokens: Array<{ tokens: Set<string>; value: TariffValue }>
}

/** Strip diacritics: é→e, ë→e, ñ→n, ï→i */
function stripDiacritics(s: string): string {
  // Splits a char into base + combining mark, then strip all combining marks
  // (Unicode block U+0300..U+036F).
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Tokenize een naam-string: uppercase, accentloos, punctuatie eruit, splits
 *  op whitespace, filter korte tokens weg. Tokens ≤ 2 tekens zijn te generiek
 *  (letters als initialen, JR, SR) en veroorzaken false positives. */
function nameTokens(s: string): Set<string> {
  const cleaned = stripDiacritics(String(s))
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return new Set()
  return new Set(cleaned.split(' ').filter(t => t.length >= 3))
}

/** Genereer alle canonical match-varianten voor een waarde (zowel voor
 *  lookup-keys als voor matching van cel-waarden).
 *  Voorbeelden:
 *    "10573"           → ["10573"]
 *    "10573.0"         → ["10573"]
 *    "00010573"        → ["00010573", "10573"]
 *    "Janzen, Kevin"   → ["JANZEN KEVIN", "KEVIN JANZEN", "JANZENKEVIN", ...]
 *    "KJANZEN"         → ["KJANZEN"]
 *    "Henriëtte Loo"   → ["HENRIETTE LOO", "LOO HENRIETTE", ...]
 */
function candidateKeys(raw: unknown): string[] {
  if (raw === null || raw === undefined || raw === '') return []
  const s0 = String(raw).trim()
  if (!s0) return []
  const out = new Set<string>()

  // Base: diacritics weg, uppercase, whitespace genormaliseerd
  const base = stripDiacritics(s0).toUpperCase().replace(/\s+/g, ' ').trim()
  if (base) out.add(base)

  // Strip alle whitespace
  const noWs = base.replace(/\s/g, '')
  if (noWs && noWs !== base) out.add(noWs)

  // Pure cijfers: strip .0/,0 en leading zeros
  const numStripped = noWs.replace(/[.,]0+$/, '')
  if (/^\d+$/.test(numStripped)) {
    out.add(numStripped)
    const noLeadingZero = numStripped.replace(/^0+/, '')
    if (noLeadingZero && noLeadingZero !== numStripped) out.add(noLeadingZero)
  }

  // Namen met komma: "JANZEN, KEVIN" → "KEVIN JANZEN" én "JANZEN KEVIN"
  const commaParts = base.split(',').map(p => p.trim()).filter(Boolean)
  if (commaParts.length === 2) {
    out.add(`${commaParts[1]} ${commaParts[0]}`)
    out.add(`${commaParts[0]} ${commaParts[1]}`)
  }

  // Strip punctuation (behalve spatie) voor ruwe name-matching
  const noPunct = base.replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  if (noPunct && noPunct !== base) out.add(noPunct)

  return [...out].filter(k => k.length >= 2)
}

/** Bouw een lookup met alle matchvariants per medewerker. Gebruik deze in
 *  plaats van `{ [id]: { tarief, naam } }`: namen en aliases worden nu ook
 *  geïndexeerd zodat SAP-bestanden die op naam/alias identificeren kloppen. */
export function buildTariffLookup(
  entries: Array<{ id: string; tarief: number; naam?: string; powerbiNaam?: string; powerbiNaam2?: string; bedrijf?: string }>,
  bvFilter?: string,
): TariffLookup {
  const byKey: Record<string, TariffValue> = {}
  const tokenList: Array<{ tokens: Set<string>; value: TariffValue }> = []

  for (const t of entries) {
    if (bvFilter && t.bedrijf !== bvFilter) continue
    const value: TariffValue = { tarief: t.tarief, naam: t.naam || t.powerbiNaam || t.id, id: t.id }

    // Exacte varianten: alle vier seeds worden als keys geregistreerd
    const seeds = [t.id, t.powerbiNaam2, t.powerbiNaam, t.naam].filter(Boolean) as string[]
    for (const seed of seeds) {
      for (const k of candidateKeys(seed)) {
        // id wint van naam als er botsingen zijn (niet overschrijven)
        if (!byKey[k]) byKey[k] = value
      }
    }

    // Token-set: combineer ALLE naam-bronnen (naam + powerbiNaam). Alleen
    // tokens ≥ 3 tekens — dat sluit initialen/korte woorden uit die anders
    // false positives geven.
    const combinedTokens = new Set<string>()
    if (t.naam)        nameTokens(t.naam).forEach(x => combinedTokens.add(x))
    if (t.powerbiNaam) nameTokens(t.powerbiNaam).forEach(x => combinedTokens.add(x))
    // Voeg ID toe als aparte token zodat een cel met "10573 Janzen" ook matcht
    if (t.id && /^\d{3,}$/.test(t.id)) combinedTokens.add(t.id)
    if (combinedTokens.size > 0) {
      tokenList.push({ tokens: combinedTokens, value })
    }
  }

  return { byKey, nameTokens: tokenList }
}

/** Zoek een cell-waarde op in de lookup — probeer eerst exacte canonical
 *  varianten, dan token-subset (tariff-tokens allemaal aanwezig in cel).
 *
 *  Token-subset vangt SAP-bestanden waar de cel extra info bevat, zoals:
 *    "Janzen, Kevin (C1)"           → match op {JANZEN, KEVIN}
 *    "10573 - Janzen, Kevin"        → match via ID-token + naam-tokens
 *    "Kevin P. Janzen"              → match op {JANZEN, KEVIN}
 *    "Loo Henriette CONS Telecom"   → match op {LOO, HENRIETTE}
 *
 *  Veiligheid: cellen met maar één token (bv. alleen achternaam "Smit")
 *  worden niet via tokens gematcht tenzij de tariff ook maar één token heeft
 *  EN dat token minstens 5 tekens is (zodat generieke namen niet gokken). */
function matchRowValue(
  raw: unknown,
  lookup: TariffLookup,
): { tariff: TariffValue; key: string } | null {
  // Fase 1: exacte canonical-variant match
  for (const k of candidateKeys(raw)) {
    if (lookup.byKey[k]) return { tariff: lookup.byKey[k], key: k }
  }

  // Fase 2: token-subset fallback
  const cellTokens = nameTokens(String(raw ?? ''))
  // Voeg numerieke tokens toe (bv. "10573" als aparte token)
  for (const match of String(raw ?? '').matchAll(/\b(\d{3,})\b/g)) {
    cellTokens.add(match[1])
  }
  if (cellTokens.size === 0) return null

  // Zoek tariff waarvan ALLE tokens voorkomen in de cel (subset), bij meerdere
  // kandidaten wint degene met de meeste overlappende tokens.
  let bestMatch: TariffValue | null = null
  let bestTokenCount = 0
  for (const entry of lookup.nameTokens) {
    if (entry.tokens.size === 0) continue
    // Alle tariff-tokens moeten in cell zitten
    let allPresent = true
    for (const tok of entry.tokens) {
      if (!cellTokens.has(tok)) { allPresent = false; break }
    }
    if (!allPresent) continue
    // Veiligheidscheck voor enkele-token tariffs: token moet specifiek genoeg zijn
    if (entry.tokens.size === 1) {
      const [only] = entry.tokens
      if (only.length < 5) continue
      // Tevens: cel moet dan ook slechts weinig andere tokens hebben, anders
      // risico op per ongeluk matchen van "Smit" bij "Smit van der Berg"
      if (cellTokens.size > 2) continue
    }
    if (entry.tokens.size > bestTokenCount) {
      bestTokenCount = entry.tokens.size
      bestMatch = entry.value
    }
  }

  if (bestMatch) {
    return { tariff: bestMatch, key: `token-match (${bestTokenCount} tokens)` }
  }
  return null
}

function parseMissingHours(
  rows: Record<string, unknown>[],
  headers: string[],
  tariffs: TariffLookup,
  config: SlotAmountConfig,
  overrides?: ParseOverrides,
): ParseResult {
  const warnings: string[] = []
  const DECLARABILITEIT = 0.9

  warnings.push(
    `Bestandsanalyse: ${rows.length} rijen, ${headers.length} kolommen — ` +
    `lookup bevat ${Object.keys(tariffs.byKey).length} exacte match-keys + ` +
    `${tariffs.nameTokens.length} naam-tokensets voor Consultancy medewerkers`
  )

  // ── STAP 1: Zoek de identificatie-kolom ──
  // bvCol override = handmatige keuze voor werknemer-kolom (uit modal)
  if (overrides?.bvCol) {
    warnings.push(`Handmatige werknemer-kolom: "${overrides.bvCol}"`)
  }
  // Score elke kolom op het aantal rijen waarvan een kandidaat-variant matcht
  // met de (multi-key) tarieflookup. Dit dekt: werknemernr (10573), SAP alias
  // (KJANZEN), "Janzen, Kevin", "Kevin Janzen", etc.
  let idCol = overrides?.bvCol ?? ''
  let bestIdMatches = 0
  const sample = rows.length > 150 ? rows.slice(0, 150) : rows

  const perColumnMatches: Record<string, number> = {}
  for (const h of headers) {
    let matches = 0
    for (const row of sample) {
      if (matchRowValue(row[h], tariffs)) matches++
    }
    perColumnMatches[h] = matches
    if (!overrides?.bvCol && matches > bestIdMatches) {
      bestIdMatches = matches
      idCol = h
    }
  }
  if (overrides?.bvCol) bestIdMatches = perColumnMatches[overrides.bvCol] ?? 0

  // Ook keyword-match als extra check — gebruik als fallback OF als de beste
  // datamatch heel zwak is (<10% van sample) en er wel een header-keyword is.
  const idKw = [
    'id', 'medewerker', 'personeelsnummer', 'personeel', 'employee',
    'werknemer', 'pers.nr', 'persnr', 'personeelsnr', 'nummer', 'medew',
    'powerbi', 'sap id', 'user', 'alias', 'naam',
  ]
  if (!overrides?.bvCol) {
    if (bestIdMatches === 0) {
      for (const h of headers) {
        const hl = h.toLowerCase()
        if (idKw.some(kw => hl.includes(kw))) { idCol = h; break }
      }
    } else if (bestIdMatches < sample.length * 0.1) {
      // Zwakke datamatch: als een header duidelijk een ID-kolom is, geef die voorrang
      for (const h of headers) {
        const hl = h.toLowerCase()
        if (idKw.some(kw => hl.includes(kw)) && perColumnMatches[h] >= bestIdMatches) {
          idCol = h; bestIdMatches = perColumnMatches[h]; break
        }
      }
    }
  }

  // Top-3 beste kolommen rapporteren zodat de gebruiker inzicht krijgt
  const ranking = Object.entries(perColumnMatches)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([k, v]) => `"${k}": ${v}`)
  if (ranking.length > 0) {
    warnings.push(`Top match-kolommen: ${ranking.join(' · ')} (hoger = betere kandidaat)`)
  }

  // ── STAP 2: Zoek de uren-kolom ──
  // Eerst op keyword (meest specifiek eerst: "missing hours" > "missing" > "ontbrekende" > "uren"),
  // dan op data-analyse (numerieke kolom met redelijke waarden).
  // We matchen op ALLE headers en kiezen de beste keyword-score zodat "Missing hours"
  // wint van een algemene "Uren geschreven" kolom.
  const hoursKwPriority = [
    'missing hours', 'missing', 'ontbrekende uren', 'ontbrekend', 'verschil uren',
    'totaal uren', 'uren', 'hours', 'aantal uren', 'hrs',
  ]
  // amountCol override = handmatige keuze voor uren-kolom
  let hoursCol = overrides?.amountCol ?? ''
  let bestKwRank = Infinity
  if (!hoursCol) {
    for (const h of headers) {
      if (h === idCol) continue
      const hl = h.toLowerCase()
      for (let i = 0; i < hoursKwPriority.length; i++) {
        if (hl.includes(hoursKwPriority[i])) {
          if (i < bestKwRank) { bestKwRank = i; hoursCol = h }
          break
        }
      }
    }
  }
  // Fallback: zoek numerieke kolom die niet het ID is en redelijke urenwaarden heeft (0-500)
  // Gebruikt parseHoursCell zodat cellen als "40 u" / "8uur" / "12 hrs" ook meetellen.
  if (!hoursCol) {
    let bestScore = 0
    for (const h of headers) {
      if (h === idCol) continue
      const sample = rows.slice(0, 30)
      let numericCount = 0
      let reasonable = 0
      for (const row of sample) {
        const v = parseHoursCell(row[h])
        if (v !== null) {
          numericCount++
          if (Math.abs(v) <= 500) reasonable++
        }
      }
      const score = numericCount > 0 ? (reasonable / numericCount) * (numericCount / sample.length) : 0
      if (score > bestScore && numericCount > sample.length * 0.3) {
        bestScore = score
        hoursCol = h
      }
    }
  }

  // Rapporteer gevonden kolommen
  if (idCol) {
    warnings.push(
      `Werknemer-kolom: "${idCol}" (${bestIdMatches} van ${sample.length} sample-rijen gematcht met Consultancy tarieven)`
    )
  } else {
    warnings.push('⚠ Geen werknemer-kolom gevonden — pas de kolomselectie aan via "Aanpassen".')
  }
  if (hoursCol) {
    warnings.push(`Uren-kolom: "${hoursCol}"`)
  } else {
    warnings.push('⚠ Geen uren-kolom gevonden — pas de kolomselectie aan via "Aanpassen".')
  }

  // ── STAP 3: Bereken per medewerker ──
  let totalBerekend = 0
  let parsedCount = 0
  let skippedCount = 0
  let matchedCount = 0
  let negativeSkipped = 0
  let totalRowsSkipped = 0
  const unmatchedIds: string[] = []
  const details: Array<{ id: string; naam: string; uren: number; tarief: number; bedrag: number }> = []

  for (const row of rows) {
    // Totaal-/resultaatregels overslaan (niet dubbel tellen met detail-rijen)
    if (isLikelyTotalRow(row)) { totalRowsSkipped++; continue }

    const rawVal = row[idCol]
    const hours = parseHoursCell(row[hoursCol])
    const hasId = rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== ''

    if (!hasId || hours === null || hours === 0) { skippedCount++; continue }
    // Negatieve uren niet meenemen — zie correctieregel hieronder
    if (hours < 0) { negativeSkipped++; continue }
    parsedCount++

    const match = matchRowValue(rawVal, tariffs)
    if (!match) {
      unmatchedIds.push(String(rawVal).trim())
      continue
    }

    const bedrag = hours * match.tariff.tarief * DECLARABILITEIT
    totalBerekend += bedrag
    matchedCount++
    details.push({
      id: match.tariff.id,
      naam: match.tariff.naam,
      uren: hours,
      tarief: match.tariff.tarief,
      bedrag,
    })
  }

  if (negativeSkipped > 0) {
    warnings.push(`${negativeSkipped} rij(en) met negatieve uren overgeslagen`)
  }
  if (totalRowsSkipped > 0) {
    warnings.push(`${totalRowsSkipped} totaal-/subtotaalrij(en) overgeslagen (niet dubbel geteld)`)
  }

  // Afronden op hele euro
  totalBerekend = Math.round(totalBerekend)

  if (unmatchedIds.length > 0) {
    const unique = [...new Set(unmatchedIds)]
    warnings.push(
      `${unique.length} werknemer(s) niet in Consultancy tarieftabel: ` +
      unique.slice(0, 5).join(', ') +
      (unique.length > 5 ? ` en ${unique.length - 5} meer` : '') +
      ` (overgeslagen — mogelijk andere BV)`
    )
  }

  warnings.push(
    `Resultaat: ${matchedCount} Consultancy medewerkers × tarief × ${DECLARABILITEIT} = € ${totalBerekend.toLocaleString('nl-NL')}`
  )

  // Top 5 grootste bijdragen tonen
  details.sort((a, b) => b.bedrag - a.bedrag)
  if (details.length > 0) {
    const top = details.slice(0, 5).map(d =>
      `${d.naam}: ${d.uren.toFixed(1)}u × €${d.tarief} × 0,9 = €${Math.round(d.bedrag).toLocaleString('nl-NL')}`
    ).join(' | ')
    warnings.push(`Top bijdragen: ${top}`)
  }

  return {
    perBv: {
      Consultancy: totalBerekend,
      Projects: 0,
      Software: 0,
    },
    totalAmount: totalBerekend,
    rowCount: rows.length,
    parsedCount,
    skippedCount,
    detectedAmountCol: hoursCol || '(uren)',
    detectedBvCol: idCol || '(werknemer ID)',
    headers,
    preview: rows.slice(0, 5) as Record<string, unknown>[],
    rawRows: rows as Record<string, unknown>[],
    warnings,
    targetBv: config.targetBv,
    targetRowId: config.targetRowId,
    targetEntity: config.targetEntity,
    unmatchedCount: unmatchedIds.length,
  }
}

export async function parseImportFile(
  file: File,
  slotId: string,
  overrides?: ParseOverrides,
  tariffLookup?: TariffLookup,
): Promise<ParseResult> {
  const config = SLOT_CONFIGS[slotId] ?? SLOT_CONFIGS.factuurvolume

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Bestand kon niet worden gelezen'))
    reader.onload = (e) => {
      try {
        const data = e.target?.result
        const wb = XLSX.read(data, { type: 'array', cellDates: true })

        // ── OHW Excel: speciaal geval — lees totaal uit tabblad "Onderhande Werk", kolom AO ──
        if (slotId === 'ohw') {
          const ohwResult = parseOhwExcel(wb, config)
          if (ohwResult) { resolve(ohwResult); return }
        }

        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
          defval: '',
          raw: false,
        })

        if (rows.length === 0) {
          reject(new Error('Bestand heeft geen data rijen'))
          return
        }

        const headers = Object.keys(rows[0])

        // ── Missing Hours: speciaal geval — werknemer × tarief × 0.9 ──
        if (slotId === 'missing_hours' && tariffLookup) {
          resolve(parseMissingHours(rows, headers, tariffLookup, config, overrides))
          return
        }
        const warnings: string[] = []

        // Kolom-detectie (of handmatige override)
        const detectedAmountCol = findBestAmountColumn(
          headers, rows, config.amountCols, config, overrides?.amountCol,
        )
        const detectedBvCol = findBestBvColumn(
          headers, rows, config.bvCols, overrides?.bvCol,
        )

        if (!detectedAmountCol) {
          warnings.push('Geen bedrag-kolom gevonden — gebruik "Aanpassen" om handmatig de juiste kolom te kiezen.')
        }
        if (!detectedBvCol) {
          warnings.push('Geen BV-kolom gevonden — verdeling per BV is niet beschikbaar.')
        }

        // ── Verwerk alle rijen ─────────────────────────────────────────────
        const perBv: Record<BvId, number> = { Consultancy: 0, Projects: 0, Software: 0 }
        let totalAmount = 0
        let parsedCount = 0
        let skippedCount = 0
        let unmatchedCount = 0
        let totalRowsSkipped = 0

        for (const row of rows) {
          // Totaal-/subtotaalrijen overslaan (nooit dubbel tellen)
          if (isLikelyTotalRow(row)) { totalRowsSkipped++; continue }

          // ── Bedrag bepalen ─────────────────────────────────────────────
          let amount: number | null = null

          if (detectedAmountCol) {
            const parsed = parseDutchNumber(row[detectedAmountCol])
            if (parsed !== null) {
              amount = config.absoluteValue ? Math.abs(parsed) : parsed
              if (config.positiveOnly && amount < 0) amount = null
            }
          }

          if (amount === null || amount === 0) {
            skippedCount++
            continue
          }

          parsedCount++
          totalAmount += amount

          // ── BV bepalen ────────────────────────────────────────────────
          // Als het slot voor één BV is, alles naar die BV
          if (config.targetBv) {
            perBv[config.targetBv] += amount
          } else {
            let bv: BvId | null = null

            if (detectedBvCol) {
              bv = detectBvFromValue(row[detectedBvCol])
            }

            // Vond geen BV via de gedetecteerde kolom → scan alle kolomwaarden
            if (!bv) {
              for (const v of Object.values(row)) {
                bv = detectBvFromValue(v)
                if (bv) break
              }
            }

            if (bv) {
              perBv[bv] += amount
            } else {
              unmatchedCount++
            }
          }
        }

        // ── Validatie-waarschuwingen ───────────────────────────────────
        const bvTotal = BVS.reduce((a, bv) => a + perBv[bv], 0)

        if (parsedCount === 0 && rows.length > 0) {
          warnings.push(
            `Geen bedragen gevonden in kolom "${detectedAmountCol}". ` +
            `Gebruik "Aanpassen" om een andere kolom te kiezen.`,
          )
        } else if (skippedCount > parsedCount * 3) {
          warnings.push(
            `${skippedCount} van ${rows.length} rijen overgeslagen (leeg/onparseerbaar). ` +
            `Controleer of de juiste bedrag-kolom is geselecteerd.`,
          )
        }
        if (totalRowsSkipped > 0) {
          warnings.push(
            `${totalRowsSkipped} totaal-/subtotaalrij(en) overgeslagen (niet dubbel geteld).`,
          )
        }

        if (!config.targetBv) {
          // Multi-BV bestand: controleer of alle rijen aan een BV zijn gekoppeld
          if (bvTotal === 0 && totalAmount > 0) {
            warnings.push(
              `Totaal ${Math.round(totalAmount).toLocaleString('nl-NL')} gevonden maar niet verdeeld over BVs. ` +
              `Controleer de BV-kolom.`,
            )
          }

          const bvDiff = Math.abs(totalAmount - bvTotal)
          if (bvDiff > 1 && bvTotal > 0) {
            warnings.push(
              `${unmatchedCount} rij(en) konden niet aan een BV worden gekoppeld. ` +
              `Verschil: € ${Math.round(bvDiff).toLocaleString('nl-NL')}.`,
            )
          }

          // Waarschuwing als een BV 0 is terwijl de andere waarden hebben
          const activeBvs = BVS.filter(bv => perBv[bv] > 0)
          const zeroBvs = BVS.filter(bv => perBv[bv] === 0)
          if (activeBvs.length > 0 && zeroBvs.length > 0 && zeroBvs.length < 3) {
            warnings.push(
              `Let op: ${zeroBvs.join(', ')} heeft/hebben geen bedragen. ` +
              `Controleer of dit klopt of dat de BV niet goed herkend wordt.`,
            )
          }
        }

        resolve({
          perBv,
          totalAmount,
          rowCount: rows.length,
          parsedCount,
          skippedCount,
          detectedAmountCol,
          detectedBvCol,
          headers,
          preview: rows.slice(0, 5) as Record<string, unknown>[],
          rawRows: rows as Record<string, unknown>[],
          warnings,
          targetBv: config.targetBv,
          targetRowId: config.targetRowId,
          targetEntity: config.targetEntity,
          unmatchedCount,
        })
      } catch (err) {
        reject(new Error(`Parse fout: ${err instanceof Error ? err.message : String(err)}`))
      }
    }
    reader.readAsArrayBuffer(file)
  })
}

// ════════════════════════════════════════════════════════════════════════════
// MISSING HOURS WIZARD — step-by-step file analysis
// ════════════════════════════════════════════════════════════════════════════
// SAP exports zetten soms een titelrij, lege rijen of meta-info bovenaan
// voordat de eigenlijke kolomkoppen verschijnen. De wizard scant het HELE
// bestand, detecteert de waarschijnlijke header-rij per sheet, en laat de
// gebruiker bevestigen of handmatig kiezen welke rij de koppen bevat en welke
// kolommen werknemer / uren / bedrijf zijn.

/** Lees een File in als XLSX WorkBook. */
export function readWorkbookFromFile(file: File): Promise<XLSX.WorkBook> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Bestand kon niet worden gelezen'))
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array', cellDates: true })
        resolve(wb)
      } catch (err) {
        reject(new Error(`Kon workbook niet parsen: ${err instanceof Error ? err.message : String(err)}`))
      }
    }
    reader.readAsArrayBuffer(file)
  })
}

/** Lees een sheet als 2D-array (rij → kolom-waarden) zonder header-aanname. */
export function readSheetAsArrays(wb: XLSX.WorkBook, sheetName: string): unknown[][] {
  const ws = wb.Sheets[sheetName]
  if (!ws) return []
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false, blankrows: true })
}

export interface HeaderRowCandidate {
  rowIdx: number       // 0-based
  score: number        // kwaliteit (hoger = beter)
  nonEmptyCells: number
  hasHeaderKeywords: boolean
}

/** Score elke rij als mogelijke header: gezocht wordt naar een rij met
 *  meerdere niet-lege, niet-numerieke cellen, gevolgd door rijen met
 *  (deels) numerieke data. */
export function scoreHeaderRows(rows2d: unknown[][]): HeaderRowCandidate[] {
  const HEADER_KWS = [
    'werknemer', 'medewerker', 'personeel', 'personeelsnr', 'personeelsnummer',
    'id', 'employee', 'naam', 'missing', 'uren', 'hours', 'ontbrekend',
    'bedrijf', 'winstcentrum', 'profit center', 'vennootschap', 'organisatie',
    'afdeling', 'tarief', 'alias', 'powerbi', 'sap', 'maand', 'month', 'datum',
  ]
  const scan = Math.min(rows2d.length, 50)  // alleen eerste 50 rijen scannen
  const candidates: HeaderRowCandidate[] = []

  for (let r = 0; r < scan; r++) {
    const row = rows2d[r] ?? []
    let nonEmpty = 0
    let textCells = 0
    let numericCells = 0
    let keywordMatches = 0
    const seenStrings = new Set<string>()
    let hasDup = false

    for (const cell of row) {
      if (cell === null || cell === undefined) continue
      const s = String(cell).trim()
      if (!s) continue
      nonEmpty++
      const asNum = parseDutchNumber(s)
      if (asNum !== null && /^-?[\d.,\s€]+$/.test(s)) numericCells++
      else textCells++

      const lower = s.toLowerCase()
      for (const kw of HEADER_KWS) {
        if (lower.includes(kw)) { keywordMatches++; break }
      }
      // Dubbele strings in dezelfde rij: geen typische header
      if (seenStrings.has(lower)) hasDup = true
      seenStrings.add(lower)
    }

    // Score: textCells belangrijk, weinig numeriek (headers zijn tekst),
    // keyword-hits zeer positief, duplicaten negatief
    // Minimaal 2 niet-lege cellen zodat een losse titel niet wint
    const score = nonEmpty >= 2
      ? textCells * 3 + keywordMatches * 10 - numericCells * 4 - (hasDup ? 5 : 0)
      : -10

    // Bonus: rij DAARNA heeft data (≥1 numerieke cel in een kolom die hier tekst is)
    const next = rows2d[r + 1] ?? []
    let nextHasNumeric = 0
    for (const c of next) {
      const n = parseDutchNumber(c)
      if (n !== null) nextHasNumeric++
    }
    const finalScore = score + Math.min(nextHasNumeric, 6)

    candidates.push({
      rowIdx: r,
      score: finalScore,
      nonEmptyCells: nonEmpty,
      hasHeaderKeywords: keywordMatches > 0,
    })
  }

  return candidates.sort((a, b) => b.score - a.score)
}

/** Transformeer 2D-rijen naar (headers, dataRows) met een gekozen header-rij.
 *  Lege of duplicaat header-cellen worden vervangen door "Kolom A/B/…" zodat
 *  elke kolom een unieke key krijgt. */
export function extractTableFromSheet(
  rows2d: unknown[][],
  headerRowIdx: number,
): { headers: string[]; dataRows: Record<string, unknown>[] } {
  if (headerRowIdx < 0 || headerRowIdx >= rows2d.length) {
    return { headers: [], dataRows: [] }
  }
  const headerRow = rows2d[headerRowIdx] ?? []
  const colCount = Math.max(headerRow.length, ...rows2d.map(r => (r ?? []).length))

  const headers: string[] = []
  const used = new Set<string>()
  for (let c = 0; c < colCount; c++) {
    let h = String(headerRow[c] ?? '').trim()
    if (!h) h = `Kolom ${XLSX.utils.encode_col(c)}`
    // Uniek maken bij duplicaten
    let unique = h
    let n = 2
    while (used.has(unique)) { unique = `${h} (${n++})` }
    used.add(unique)
    headers.push(unique)
  }

  const dataRows: Record<string, unknown>[] = []
  for (let r = headerRowIdx + 1; r < rows2d.length; r++) {
    const row = rows2d[r] ?? []
    // Sla volledig lege rijen over (stoppen als we 10 lege op rij zien zodat
    // trailing ruis genegeerd wordt)
    let empty = true
    const obj: Record<string, unknown> = {}
    for (let c = 0; c < headers.length; c++) {
      const v = row[c]
      obj[headers[c]] = v ?? ''
      if (v !== null && v !== undefined && String(v).trim() !== '') empty = false
    }
    if (!empty) dataRows.push(obj)
  }

  return { headers, dataRows }
}

/** Raad voor elke relevante rol (werknemer / uren / bedrijf) de beste kolom
 *  vanuit een set headers + dataRows. */
export function suggestMissingHoursColumns(
  headers: string[],
  dataRows: Record<string, unknown>[],
  tariffs: TariffLookup,
): { werknemerCol: string; urenCol: string; bedrijfCol: string } {
  const sample = dataRows.length > 150 ? dataRows.slice(0, 150) : dataRows

  // — Werknemer: kolom met meeste matches in tariff lookup —
  let werknemerCol = ''
  let bestMatches = 0
  for (const h of headers) {
    let matches = 0
    for (const row of sample) if (matchRowValue(row[h], tariffs)) matches++
    if (matches > bestMatches) { bestMatches = matches; werknemerCol = h }
  }
  // Fallback keyword-detectie
  if (!werknemerCol) {
    const kws = ['medewerker', 'werknemer', 'personeelsnr', 'personeelsnummer', 'personeel', 'employee', 'id', 'naam', 'alias', 'powerbi']
    for (const h of headers) {
      const hl = h.toLowerCase()
      if (kws.some(kw => hl.includes(kw))) { werknemerCol = h; break }
    }
  }

  // — Uren: kolom met naam "missing hours" / "missing" / "ontbrekend" > "uren" —
  const hoursKwPriority = [
    'missing hours', 'missing', 'ontbrekende uren', 'ontbrekend',
    'verschil uren', 'verschil', 'totaal uren', 'uren', 'hours', 'hrs',
  ]
  let urenCol = ''
  let bestRank = Infinity
  for (const h of headers) {
    if (h === werknemerCol) continue
    const hl = h.toLowerCase()
    for (let i = 0; i < hoursKwPriority.length; i++) {
      if (hl.includes(hoursKwPriority[i])) {
        if (i < bestRank) { bestRank = i; urenCol = h }
        break
      }
    }
  }
  // Fallback: numerieke kolom met redelijke waarden (accepteert "40 u" / "8h" / "12 uur")
  if (!urenCol) {
    let bestScore = 0
    for (const h of headers) {
      if (h === werknemerCol) continue
      let numericCount = 0, reasonable = 0
      for (const row of sample) {
        const v = parseHoursCell(row[h])
        if (v !== null) { numericCount++; if (Math.abs(v) <= 500) reasonable++ }
      }
      const score = numericCount > 0 ? (reasonable / numericCount) * (numericCount / sample.length) : 0
      if (score > bestScore && numericCount > sample.length * 0.3) { bestScore = score; urenCol = h }
    }
  }

  // — Bedrijf: zoek kolom met waarden als "Consultancy", "P15000", "TPG-C" —
  // IMPORTANT: we suggereren bedrijfCol alleen als de cel-waarden daadwerkelijk
  // Consultancy-signalen bevatten. Anders filteren we per ongeluk alle rijen
  // uit. Een header als "Afdeling" met waarden als "Telecom" / "Public" zou
  // anders met bedrijfFilter="Consultancy" alle rijen weggooien.
  let bedrijfCol = ''
  let bedrijfBestHits = 0
  for (const h of headers) {
    if (h === werknemerCol || h === urenCol) continue
    let hits = 0
    for (const row of sample) {
      if (matchesBedrijf(row[h], 'Consultancy')) hits++
    }
    if (hits > bedrijfBestHits) { bedrijfBestHits = hits; bedrijfCol = h }
  }
  // Alleen suggereren als minstens 30% van de sample-rijen matcht — anders
  // is de kolom geen betrouwbare bedrijfsidentificatie en laten we 'm leeg
  // zodat geen filter actief wordt.
  if (bedrijfBestHits < sample.length * 0.3) bedrijfCol = ''

  return { werknemerCol, urenCol, bedrijfCol }
}

/** Filter-functie voor de bedrijfskolom: checkt of een cel-waarde bij het
 *  gevraagde bedrijf hoort (case-insensitief, accepteert SAP-codes zoals
 *  P15000 of bare "15000", en varianten als "Consultancy AK", "TPG-C"). */
export function matchesBedrijf(val: unknown, filter: string): boolean {
  if (!filter) return true
  const s = String(val ?? '').toLowerCase().replace(/[-_\s]+/g, ' ').trim()
  if (!s) return false
  const f = filter.toLowerCase().replace(/[-_\s]+/g, ' ').trim()
  if (s.includes(f)) return true
  // SAP code-mapping — accepteert met OF zonder P-prefix
  const CODE_MAP: Record<string, RegExp[]> = {
    consultancy: [/\b0*15000\b/, /\bp0*15000\b/, /\bcons/, /\btpg\s*c\b/],
    projects:    [/\b0*25000\b/, /\bp0*25000\b/, /\bproj/, /\btpg\s*p\b/],
    software:    [/\b0*35000\b/, /\bp0*35000\b/, /\bsoft/, /\btpg\s*s\b/],
  }
  const patterns = CODE_MAP[f]
  if (patterns && patterns.some(p => p.test(s))) return true
  return false
}

export interface MissingHoursComputeConfig {
  werknemerCol: string
  urenCol: string
  bedrijfCol?: string
  bedrijfFilter?: string  // bijv. "Consultancy"; leeg = geen filter
  /** Werknemers die handmatig zijn uitgevinkt in stap "Verfijnen".
   *  Keys = werknemer-ID uit tarieftabel (stabiel). */
  excludedEmployeeIds?: Set<string>
  /** Specifieke rijen (op rowIndex in dataRows) die handmatig zijn uitgesloten. */
  excludedRowIndices?: Set<number>
}

/** Bereken missing hours totaal met een expliciete, gevalideerde configuratie.
 *  Retourneert dezelfde shape als `parseMissingHours` zodat de ImportRecord-
 *  flow ongewijzigd blijft. */
export function computeMissingHours(
  headers: string[],
  dataRows: Record<string, unknown>[],
  tariffs: TariffLookup,
  cfg: MissingHoursComputeConfig,
  slotConfig: SlotAmountConfig,
): ParseResult {
  const DECLARABILITEIT = 0.9
  const warnings: string[] = []

  warnings.push(
    `Configuratie: werknemer="${cfg.werknemerCol}", uren="${cfg.urenCol}"` +
    (cfg.bedrijfCol ? `, bedrijfskolom="${cfg.bedrijfCol}" (filter: "${cfg.bedrijfFilter ?? 'geen'}")` : '')
  )
  warnings.push(
    `Data: ${dataRows.length} rijen, lookup ${Object.keys(tariffs.byKey).length} keys + ${tariffs.nameTokens.length} tokensets`
  )

  let totalBerekend = 0
  let parsedCount = 0
  let skippedCount = 0
  let matchedCount = 0
  let bedrijfFilteredOut = 0
  let manualExclusions = 0
  let negativeSkipped = 0
  let zeroTariefCount = 0
  let totalRowsSkipped = 0
  const unmatchedIds: string[] = []
  const details: MissingHoursDetail[] = []

  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
    const row = dataRows[rowIdx]

    // Totaal-/resultaatregels overslaan
    if (isLikelyTotalRow(row)) { totalRowsSkipped++; continue }

    const rawIdVal = row[cfg.werknemerCol]
    const rawIdStr = String(rawIdVal ?? '').trim()
    const hours = parseHoursCell(row[cfg.urenCol])
    const hasId = rawIdVal !== null && rawIdVal !== undefined && rawIdStr !== ''

    if (!hasId || hours === null || hours === 0) { skippedCount++; continue }

    // Negatieve uren niet meenemen in totaal (correctie-regels tellen niet mee)
    if (hours < 0) { negativeSkipped++; continue }

    // Handmatige rij-exclusion (uit wizard "Verfijnen" stap)
    if (cfg.excludedRowIndices?.has(rowIdx)) { manualExclusions++; continue }

    // Bedrijfs-filter (indien opgegeven)
    if (cfg.bedrijfCol && cfg.bedrijfFilter) {
      if (!matchesBedrijf(row[cfg.bedrijfCol], cfg.bedrijfFilter)) {
        bedrijfFilteredOut++
        continue
      }
    }

    parsedCount++
    const match = matchRowValue(rawIdVal, tariffs)
    if (!match) {
      unmatchedIds.push(rawIdStr)
      continue
    }

    // Handmatige werknemer-exclusion (id-based)
    if (cfg.excludedEmployeeIds?.has(match.tariff.id)) { manualExclusions++; continue }

    const tarief = match.tariff.tarief
    // Werknemer staat wél in tarieventabel maar heeft geen tarief ingevuld.
    // We includen de rij in `details` (met bedrag = 0) zodat de wizard de
    // ontbrekende tarieven kan tonen en de gebruiker inline kan aanvullen.
    if (!tarief || tarief <= 0) {
      zeroTariefCount++
      matchedCount++
      details.push({
        id: match.tariff.id,
        naam: match.tariff.naam,
        uren: hours,
        tarief: 0,
        bedrag: 0,
        rawId: rawIdStr,
        rowIndex: rowIdx,
      })
      continue
    }

    const bedrag = hours * tarief * DECLARABILITEIT
    totalBerekend += bedrag
    matchedCount++
    details.push({
      id: match.tariff.id,
      naam: match.tariff.naam,
      uren: hours,
      tarief,
      bedrag,
      rawId: rawIdStr,
      rowIndex: rowIdx,
    })
  }

  totalBerekend = Math.round(totalBerekend)

  if (negativeSkipped > 0) {
    warnings.push(`${negativeSkipped} rij(en) met negatieve uren overgeslagen (correcties tellen niet mee)`)
  }
  if (totalRowsSkipped > 0) {
    warnings.push(`${totalRowsSkipped} totaal-/subtotaalrij(en) overgeslagen (niet dubbel geteld)`)
  }
  if (zeroTariefCount > 0) {
    warnings.push(
      `⚠ ${zeroTariefCount} werknemer(s) wel in tarieventabel maar zonder IC tarief — ` +
      `vul het tarief aan in stap "Verfijnen" of in de IC Tarieven tab`
    )
  }
  if (bedrijfFilteredOut > 0) {
    warnings.push(`${bedrijfFilteredOut} rijen overgeslagen op basis van bedrijfskolom-filter`)
  }
  if (manualExclusions > 0) {
    warnings.push(`${manualExclusions} handmatig uitgesloten in "Verfijnen" stap`)
  }
  if (unmatchedIds.length > 0) {
    const unique = [...new Set(unmatchedIds)]
    warnings.push(
      `${unique.length} werknemer(s) niet in Consultancy tarieftabel: ` +
      unique.slice(0, 5).join(', ') +
      (unique.length > 5 ? ` en ${unique.length - 5} meer` : '')
    )
  }
  warnings.push(
    `Resultaat: ${matchedCount} medewerkers × tarief × ${DECLARABILITEIT} = € ${totalBerekend.toLocaleString('nl-NL')}`
  )

  details.sort((a, b) => b.bedrag - a.bedrag)
  if (details.length > 0) {
    const top = details.slice(0, 5).map(d =>
      `${d.naam}: ${d.uren.toFixed(1)}u × €${d.tarief} × 0,9 = €${Math.round(d.bedrag).toLocaleString('nl-NL')}`
    ).join(' | ')
    warnings.push(`Top bijdragen: ${top}`)
  }

  return {
    perBv: { Consultancy: totalBerekend, Projects: 0, Software: 0 },
    totalAmount: totalBerekend,
    rowCount: dataRows.length,
    parsedCount,
    skippedCount,
    detectedAmountCol: cfg.urenCol,
    detectedBvCol: cfg.werknemerCol,
    headers,
    preview: dataRows.slice(0, 5),
    rawRows: dataRows,
    warnings,
    targetBv: slotConfig.targetBv,
    targetRowId: slotConfig.targetRowId,
    targetEntity: slotConfig.targetEntity,
    unmatchedCount: unmatchedIds.length,
    missingHoursDetails: details,
    missingHoursCounts: {
      total: dataRows.length,
      matched: matchedCount - zeroTariefCount,
      needsTariff: zeroTariefCount,
      unmatched: unmatchedIds.length,
      emptyOrZero: skippedCount,
      negative: negativeSkipped,
      bedrijfFiltered: bedrijfFilteredOut,
      manuallyExcluded: manualExclusions,
      totalRowsSkipped,
    },
  }
}

/** Publieke slot-config getter voor wizard (MissingHours) */
export function getMissingHoursSlotConfig(): SlotAmountConfig {
  return SLOT_CONFIGS.missing_hours
}

/** Voor elke kolom: tel hoeveel sample-rijen een match geven met de tariff
 *  lookup. Gebruikt door de wizard om in stap 3 per kolom te tonen hoe goed
 *  deze kolom zou werken als werknemer-identifier — zodat de gebruiker
 *  direct ziet welke kolom de juiste keuze is. */
export function perColumnTariffMatches(
  headers: string[],
  dataRows: Record<string, unknown>[],
  tariffs: TariffLookup,
): Record<string, { matches: number; total: number }> {
  const sample = dataRows.length > 150 ? dataRows.slice(0, 150) : dataRows
  const result: Record<string, { matches: number; total: number }> = {}
  for (const h of headers) {
    let matches = 0
    for (const row of sample) {
      if (matchRowValue(row[h], tariffs)) matches++
    }
    result[h] = { matches, total: sample.length }
  }
  return result
}

// ════════════════════════════════════════════════════════════════════════════
// GENERIC IMPORT WIZARD — factuurvolume, geschreven_uren, uren_lijst, d_lijst,
// conceptfacturen. Zelfde workflow als MissingHours: sheet → header-rij →
// kolomkeuze → verfijnen. Geen tarief-berekening, alleen sommeren.
// ════════════════════════════════════════════════════════════════════════════

export interface GenericImportConfig {
  amountCol: string
  /** BV-kolom. Voor multi-BV slots verplicht (bepaalt distributie). Voor
   *  single-BV slots optioneel — als ingesteld wordt de kolom gebruikt om
   *  niet-matching rijen uit te filteren (i.p.v. ze blind toe te wijzen). */
  bvCol?: string
  /** Alleen relevant voor multi-BV slots: beperk output tot één BV */
  bvFilter?: BvId
  excludedRowIndices?: Set<number>
}

export interface GenericImportDetail {
  rowIndex: number
  bv: BvId | null           // null = single-BV slot met targetBv
  amount: number
  rawAmount: string
  rawBv: string
}

/** Suggereer werknemer-/bedrag- en BV-kolom voor een generic slot op basis
 *  van de slot-configuratie keywords + data-parseability. Voor single-BV
 *  slots (uren_lijst/d_lijst met targetBv gezet) wordt bvCol leeg gelaten. */
export function suggestGenericImportColumns(
  headers: string[],
  dataRows: Record<string, unknown>[],
  slotId: string,
): { amountCol: string; bvCol: string; bvFilterSuggestion: BvId | '' } {
  const slotConfig = SLOT_CONFIGS[slotId] ?? SLOT_CONFIGS.factuurvolume
  const sample = dataRows.length > 150 ? dataRows.slice(0, 150) : dataRows

  // Amount column via bestaande scoring
  const amountCol = findBestAmountColumn(headers, sample, slotConfig.amountCols, slotConfig)

  // BV column: voor multi-BV slots nodig voor distributie; voor single-BV
  // slots optioneel als filter (gemengde SAP exports). We suggereren 'm
  // altijd zodat de user 'm kan gebruiken of leeg laten.
  const bvCol = findBestBvColumn(headers, sample, slotConfig.bvCols)

  let bvFilterSuggestion: BvId | '' = ''
  if (slotConfig.targetBv) {
    bvFilterSuggestion = slotConfig.targetBv
  }

  return { amountCol, bvCol, bvFilterSuggestion }
}

/** Voor elke kolom: aantal rijen waarvoor parseAmountCell een numerieke
 *  waarde oplevert — zodat de gebruiker ziet welke kolom het meest geschikt
 *  is als bedrag/uren. */
export function perColumnAmountMatches(
  headers: string[],
  dataRows: Record<string, unknown>[],
): Record<string, { matches: number; total: number }> {
  const sample = dataRows.length > 150 ? dataRows.slice(0, 150) : dataRows
  const result: Record<string, { matches: number; total: number }> = {}
  for (const h of headers) {
    let matches = 0
    for (const row of sample) {
      const v = parseAmountCell(row[h])
      if (v !== null && v !== 0) matches++
    }
    result[h] = { matches, total: sample.length }
  }
  return result
}

/** Voor elke kolom: aantal rijen waarvoor detectBvFromValue een BV oplevert —
 *  zodat de gebruiker ziet welke kolom de BV-informatie bevat. */
export function perColumnBvMatches(
  headers: string[],
  dataRows: Record<string, unknown>[],
): Record<string, { matches: number; total: number; bvs: Record<string, number> }> {
  const sample = dataRows.length > 150 ? dataRows.slice(0, 150) : dataRows
  const result: Record<string, { matches: number; total: number; bvs: Record<string, number> }> = {}
  for (const h of headers) {
    let matches = 0
    const bvs: Record<string, number> = {}
    for (const row of sample) {
      const bv = detectBvFromValue(row[h])
      if (bv) { matches++; bvs[bv] = (bvs[bv] ?? 0) + 1 }
    }
    result[h] = { matches, total: sample.length, bvs }
  }
  return result
}

/** Bereken een generic import met expliciete configuratie. Geen tarief-
 *  berekening — alleen sommeren per BV, met respect voor de slot-specifieke
 *  regels (absoluteValue, positiveOnly, targetBv). */
export function computeGenericImport(
  headers: string[],
  dataRows: Record<string, unknown>[],
  slotId: string,
  cfg: GenericImportConfig,
): ParseResult {
  const slotConfig = SLOT_CONFIGS[slotId] ?? SLOT_CONFIGS.factuurvolume
  const warnings: string[] = []
  const perBv: Record<BvId, number> = { Consultancy: 0, Projects: 0, Software: 0 }
  const details: GenericImportDetail[] = []

  let total = 0
  let matchedCount = 0
  let skippedCount = 0        // lege cel, 0 waarde, of niet-parseerbaar
  let manualExclusions = 0
  let bvUndetected = 0        // kan niet aan BV toewijzen (multi-BV slot)
  let bvFilteredOut = 0       // bvFilter niet match
  let totalRowsSkipped = 0    // "Totaal"/"Subtotaal"/"Eindtotaal" rijen
  const totalRowLabels: string[] = []  // eerste paar gedetecteerde total labels (voor diagnostiek)

  warnings.push(
    `Configuratie slot "${slotId}": bedrag="${cfg.amountCol}"` +
    (cfg.bvCol ? `, bv="${cfg.bvCol}"` : '') +
    (slotConfig.targetBv ? `, target-BV=${slotConfig.targetBv}` : '') +
    (cfg.bvFilter ? `, filter=${cfg.bvFilter}` : '')
  )
  warnings.push(`Data: ${dataRows.length} rijen, ${headers.length} kolommen`)

  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
    const row = dataRows[rowIdx]

    // Totaal-/resultaatregels overslaan — voorkomt dubbel tellen van SAP-
    // subtotalen die vaak onderaan of tussen BV-groepen staan
    if (isLikelyTotalRow(row)) {
      totalRowsSkipped++
      // Verzamel eerste paar gedetecteerde labels voor diagnostiek
      if (totalRowLabels.length < 5) {
        for (const v of Object.values(row)) {
          const s = String(v ?? '').trim()
          if (s && /totaal|total|resultaat|som|generaal|eindstand|samenvatting/i.test(s)) {
            totalRowLabels.push(s.slice(0, 40))
            break
          }
        }
      }
      continue
    }

    const rawAmountVal = row[cfg.amountCol]
    const amount = parseAmountCell(rawAmountVal)

    if (amount === null) { skippedCount++; continue }
    if (amount === 0) { skippedCount++; continue }

    // Handmatige rij-exclusion
    if (cfg.excludedRowIndices?.has(rowIdx)) { manualExclusions++; continue }

    // BV-bepaling
    let bv: BvId | null = null
    let rawBv = ''
    if (slotConfig.targetBv) {
      // Single-BV slot (bv. D-lijst → Consultancy). Als de gebruiker ook een
      // BV-kolom heeft gekozen, gebruiken we die als FILTER: rijen waar de
      // cel-waarde een ANDERE BV aangeeft worden uitgefilterd (niet blind
      // toegewezen aan de target). Dat voorkomt dat gemengde SAP-exports
      // Projects-/Software-rijen ten onrechte meetellen.
      if (cfg.bvCol) {
        rawBv = String(row[cfg.bvCol] ?? '').trim()
        const detected = detectBvFromValue(rawBv)
        if (detected && detected !== slotConfig.targetBv) {
          bvFilteredOut++
          continue
        }
        // Als detected === null: cel is ambiguous, dan valt-ie onder de target-BV
      }
      bv = slotConfig.targetBv
    } else if (cfg.bvCol) {
      rawBv = String(row[cfg.bvCol] ?? '').trim()
      const detected = detectBvFromValue(rawBv)
      if (!detected) { bvUndetected++; continue }
      bv = detected
    } else {
      // Geen BV-mogelijkheid — skip (kan niet in totaal per BV opnemen)
      bvUndetected++
      continue
    }

    // Optionele BV-filter
    if (cfg.bvFilter && bv !== cfg.bvFilter) {
      bvFilteredOut++
      continue
    }

    // Apply slot-regels: absoluteValue, positiveOnly
    let finalAmount = slotConfig.absoluteValue ? Math.abs(amount) : amount
    if (slotConfig.positiveOnly && finalAmount < 0) {
      skippedCount++
      continue
    }

    total += finalAmount
    perBv[bv] += finalAmount
    matchedCount++
    details.push({
      rowIndex: rowIdx,
      bv: slotConfig.targetBv ? null : bv,  // voor single-BV wordt geen bv getoond
      amount: finalAmount,
      rawAmount: String(rawAmountVal ?? ''),
      rawBv,
    })
  }

  // Afronden op hele euro voor bedragen; uren blijven decimaal
  const isHoursSlot = /uren|hours/i.test(slotConfig.amountCols.join(' '))
  for (const k of Object.keys(perBv) as BvId[]) {
    perBv[k] = isHoursSlot ? Math.round(perBv[k] * 10) / 10 : Math.round(perBv[k])
  }
  total = isHoursSlot ? Math.round(total * 10) / 10 : Math.round(total)

  if (skippedCount > 0) warnings.push(`${skippedCount} rij(en) overgeslagen (leeg / 0 / niet-parseerbaar)`)
  if (totalRowsSkipped > 0) {
    const sample = totalRowLabels.length > 0 ? ` · gedetecteerd: ${totalRowLabels.map(l => `"${l}"`).join(', ')}` : ''
    warnings.push(`${totalRowsSkipped} totaal-/subtotaalrij(en) overgeslagen (niet dubbel geteld)${sample}`)
  }
  if (bvUndetected > 0) warnings.push(`${bvUndetected} rij(en) zonder herkende BV-waarde in "${cfg.bvCol}"`)
  if (bvFilteredOut > 0) {
    const bvLabel = cfg.bvFilter ?? (slotConfig.targetBv ? `alleen ${slotConfig.targetBv}` : 'BV-filter')
    warnings.push(`${bvFilteredOut} rij(en) weggefilterd door BV-filter (${bvLabel})`)
  }
  if (manualExclusions > 0) warnings.push(`${manualExclusions} handmatig uitgesloten`)

  warnings.push(
    `Resultaat: ${matchedCount} rij(en) verwerkt · totaal ${isHoursSlot ? total.toFixed(1) + ' u' : '€ ' + total.toLocaleString('nl-NL')}`
  )

  // Top 5 grootste bijdragen tonen (of eerste 5 per BV)
  if (details.length > 0) {
    const topDetails = [...details].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 5)
    const top = topDetails.map(d => {
      const bvLabel = d.bv ? `[${d.bv}]` : ''
      const fmt = isHoursSlot ? d.amount.toFixed(1) + 'u' : '€' + Math.round(d.amount).toLocaleString('nl-NL')
      return `${bvLabel} ${fmt}`
    }).join(' | ')
    warnings.push(`Top bijdragen: ${top}`)
  }

  return {
    perBv,
    totalAmount: total,
    rowCount: dataRows.length,
    parsedCount: matchedCount,
    skippedCount,
    detectedAmountCol: cfg.amountCol,
    detectedBvCol: cfg.bvCol ?? (slotConfig.targetBv ? `(${slotConfig.targetBv})` : ''),
    headers,
    preview: dataRows.slice(0, 5),
    rawRows: dataRows,
    warnings,
    targetBv: slotConfig.targetBv,
    targetRowId: slotConfig.targetRowId,
    targetEntity: slotConfig.targetEntity,
    unmatchedCount: bvUndetected,
    genericImportDetails: details,
    // Hergebruik van missingHoursCounts-shape als we het willen tonen — voor
    // generic slot zijn `needsTariff` en `negative` = 0.
    missingHoursCounts: {
      total: dataRows.length,
      matched: matchedCount,
      needsTariff: 0,
      unmatched: bvUndetected,
      emptyOrZero: skippedCount,
      negative: 0,
      bedrijfFiltered: bvFilteredOut,
      manuallyExcluded: manualExclusions,
      totalRowsSkipped,
    },
  }
}

/** Voor een specifieke kolom: lijst van cel-waarden die NIET matchen met
 *  de tarieftabel. Helpt de gebruiker inzien waarom bepaalde rijen worden
 *  overgeslagen. */
export function getUnmatchedSamplesForColumn(
  column: string,
  dataRows: Record<string, unknown>[],
  tariffs: TariffLookup,
  limit: number = 10,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of dataRows) {
    const raw = row[column]
    if (raw === null || raw === undefined) continue
    const s = String(raw).trim()
    if (!s) continue
    if (matchRowValue(raw, tariffs)) continue
    if (!seen.has(s)) {
      seen.add(s)
      out.push(s)
      if (out.length >= limit) break
    }
  }
  return out
}
