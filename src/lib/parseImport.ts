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
    amountCols: ['uren', 'hours', 'totaal uren', 'werkuren', 'arbeid', 'bedrag', 'amount', 'waarde', 'totaal'],
    bvCols: ['winstcentrum', 'bv', 'vennootschap', 'afdeling', 'department'],
    positiveOnly: true,
    targetBv: 'Projects',
    targetRowId: 'p1',
    targetEntity: 'Projects',
  },
  d_lijst: {
    amountCols: ['declarabel', 'billable', 'declarabele uren', 'billable hours', 'faktureerbaar', 'bedrag', 'amount', 'waarde', 'totaal'],
    bvCols: ['winstcentrum', 'bv', 'vennootschap', 'afdeling'],
    positiveOnly: true,
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

// ── Missing Hours speciaal: werknemer ID × tarief × 0.9 ─────────────────────
// Tarieven worden meegegeven zodat de parser niet afhankelijk is van de store.
export interface TariffLookup {
  [employeeId: string]: { tarief: number; naam: string }
}

function parseMissingHours(
  rows: Record<string, unknown>[],
  headers: string[],
  tariffs: TariffLookup,
  config: SlotAmountConfig,
): ParseResult {
  const warnings: string[] = []
  const DECLARABILITEIT = 0.9

  // Zoek de kolom met werknemer ID (numeriek veld, "id", "medewerker", "personeelsnummer", etc.)
  const idColCandidates = ['id', 'medewerker id', 'personeelsnummer', 'employee id', 'werknemer',
    'medew', 'pers.nr', 'persnr', 'personeelsnr', 'nummer', 'nr', 'employee']
  let idCol = ''
  for (const h of headers) {
    const hl = h.toLowerCase()
    if (idColCandidates.some(kw => hl.includes(kw))) { idCol = h; break }
  }
  // Fallback: zoek kolom met veel numerieke waarden die matchen met tariff IDs
  if (!idCol) {
    let bestMatch = 0
    for (const h of headers) {
      let matches = 0
      for (const row of rows.slice(0, 50)) {
        const v = String(row[h] ?? '').trim()
        if (v && tariffs[v]) matches++
      }
      if (matches > bestMatch) { bestMatch = matches; idCol = h }
    }
  }

  // Zoek de uren kolom
  const hoursKw = ['uren', 'hours', 'missing', 'ontbrekend', 'totaal uren', 'missing hours', 'aantal']
  let hoursCol = ''
  for (const h of headers) {
    const hl = h.toLowerCase()
    if (hoursKw.some(kw => hl.includes(kw))) { hoursCol = h; break }
  }
  // Fallback: zoek numerieke kolom die niet het ID is
  if (!hoursCol) {
    for (const h of headers) {
      if (h === idCol) continue
      const sample = rows.slice(0, 20)
      const numeric = sample.filter(r => parseDutchNumber(r[h]) !== null).length
      if (numeric > sample.length * 0.5) { hoursCol = h; break }
    }
  }

  if (!idCol) warnings.push('Geen werknemer-ID kolom gevonden. Controleer het bestand.')
  if (!hoursCol) warnings.push('Geen uren-kolom gevonden. Controleer het bestand.')

  let totalBerekend = 0
  let parsedCount = 0
  let skippedCount = 0
  let matchedCount = 0
  let unmatchedIds: string[] = []

  for (const row of rows) {
    const empId = String(row[idCol] ?? '').trim().replace(/\.0$/, '') // strip ".0" from numeric IDs
    const hours = parseDutchNumber(row[hoursCol])

    if (!empId || hours === null) { skippedCount++; continue }
    parsedCount++

    const tariff = tariffs[empId]
    if (!tariff) {
      unmatchedIds.push(empId)
      skippedCount++
      continue
    }

    const bedrag = Math.abs(hours) * tariff.tarief * DECLARABILITEIT
    totalBerekend += bedrag
    matchedCount++
  }

  // Afronden op hele euro
  totalBerekend = Math.round(totalBerekend)

  if (unmatchedIds.length > 0) {
    const unique = [...new Set(unmatchedIds)]
    warnings.push(
      `${unique.length} medewerker(s) niet gevonden in tarieftabel: ${unique.slice(0, 5).join(', ')}` +
      (unique.length > 5 ? ` en ${unique.length - 5} meer` : '') +
      `. Deze worden overgeslagen.`
    )
  }

  warnings.push(
    `Berekening: ${matchedCount} medewerkers × tarief × ${DECLARABILITEIT} declarabiliteit = € ${totalBerekend.toLocaleString('nl-NL')}`
  )

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

        // ── Missing Hours: speciaal geval — werknemer ID × tarief × 0.9 ──
        if (slotId === 'missing_hours' && tariffLookup) {
          resolve(parseMissingHours(rows, headers, tariffLookup, config))
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

        for (const row of rows) {
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
