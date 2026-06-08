// Voorspelling huidige maand — sub-tab van Maandafsluiting.
//
// User-flow:
//   1. Pak de doel-maand (default = huidige kalendermaand binnen 2026).
//   2. Upload bestanden zoals je dat halverwege de maand al beschikbaar hebt:
//      factuurvolume YTD, geschreven uren YTD, NTF, D-lijst, conceptfacturen,
//      missing hours, OHW Excel, interne uren YTD.
//   3. Vul optioneel per BV een verwachte OHW-eindstand in en korte notes.
//   4. Lees rechts de live prognose af: per BV de voorspelde netto-omzet,
//      brutomarge, EBITDA en OHW-eindstand — met confidence-indicators op
//      basis van verstreken werkdagen + aantal datasignalen.
//
// Architectuur:
//   - Inputs leven in `useForecastStore` (Supabase + realtime) zodat alle
//     ingelogde gebruikers dezelfde prognose zien.
//   - `parseImportFile` hergebruikt de bestaande SAP/Excel-parsers; we
//     bewaren alleen de geaggregeerde totalen (perBv, hours-entries) — géén
//     OHW-mutaties of import_records writes.
//   - `computeForecast` (lib/forecastEngine.ts) is een pure functie die de
//     LE-baseline blendt met de partial-month inputs. Hier in het component
//     bouwen we de inputs op en tonen de uitkomst.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type * as XLSX from 'xlsx'
import { useLatestEstimate } from '../../hooks/useLatestEstimate'
import { useBudgetStore, BUDGET_MONTHS_2026 } from '../../store/useBudgetStore'
import { useForecastStore, type ForecastSlotId, type ForecastInputRecord } from '../../store/useForecastStore'
import { useOhwStore } from '../../store/useOhwStore'
import { useTariffStore } from '../../store/useTariffStore'
import {
  parseImportFile,
  buildTariffLookup,
  readWorkbookFromFile,
  isSapTimesheetHeaders,
  detectSapTimesheetPeriodUnit,
  aggregateSapTimesheet,
  aggregateSapTimesheetWeekly,
  matchRowValue,
  parseHoursCell,
} from '../../lib/parseImport'
import type { ParseResult, ParsedHoursEntry } from '../../lib/parseImport'
import { parseInternalHoursFile, type InternalHoursParseResult } from '../../lib/parseInternalHours'
import { filterRowsToMonth } from '../../lib/forecastMonthFilter'
import { weekFromFilename, computeOhwExtrapolation } from '../../lib/weekUtils'
import { GenericImportWizard } from './GenericImportWizard'
import { MissingHoursWizard } from './MissingHoursWizard'
import {
  computeForecast,
  type ForecastBvSnapshot,
  type ForecastBv,
} from '../../lib/forecastEngine'
import { projectOhwForMonth, type OhwProjection } from '../../lib/ohwProjection'
import { fmt } from '../../lib/format'
import { useToast } from '../../hooks/useToast'
import { Toast } from '../common/Toast'
import { useCanApprove, useCanEdit } from '../../lib/permissions'
import type { BvId } from '../../data/types'

const BV_COLORS: Record<ForecastBv, string> = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
  Holdings:    '#8fa3c0',
}

const ALL_BVS: ForecastBv[] = ['Consultancy', 'Projects', 'Software', 'Holdings']
const PRODUCTION_BVS: ForecastBv[] = ['Consultancy', 'Projects', 'Software']

const MONTH_NAMES_NL: Record<string, string> = {
  Jan: 'januari',  Feb: 'februari', Mar: 'maart',  Apr: 'april',
  May: 'mei',      Jun: 'juni',     Jul: 'juli',   Aug: 'augustus',
  Sep: 'september',Oct: 'oktober',  Nov: 'november',Dec: 'december',
}

function formatMonthLabel(code: string): string {
  const [mmm, yy] = code.split('-')
  return `${MONTH_NAMES_NL[mmm] ?? mmm} 20${yy}`
}

/** Percentage van num/denom als "X.X%" — leeg streepje wanneer denom 0 of NaN. */
function pctOf(num: number, denom: number): string {
  if (!denom || !isFinite(denom)) return '—'
  return `${(num / denom * 100).toFixed(1)}%`
}

/** Robuuste BV-kolom-detectie voor missing-hours bestanden. Strategie:
 *  1. Expliciete user-keuze wint altijd.
 *  2. Content-based: scant alle kolommen op cellen die echte BV-namen of
 *     SAP-codes bevatten. De kolom met het hoogste aantal hits + hoogste
 *     ratio wint. Dit is robuust tegen kolomnamen die we niet kennen.
 *  3. Pas als dat niets oplevert, valt hij terug op header-keyword match
 *     ("bedrijf", "winstcentrum", "profit center", etc.). */
const BV_VALUE_PATTERNS = [
  /consultancy/i, /projects?/i, /software/i,
  /\bp15000\b/i, /\bp25000\b/i, /\bp35000\b/i,
  /holding/i, /ingenieurs/i, /specialist/i, /engineering/i,
]
function detectBvColumn(
  headers: string[],
  rows: Record<string, unknown>[],
  explicitChoice?: string,
): string {
  if (explicitChoice) return explicitChoice

  // ── 1) Content-based detectie (primair) ─────────────────────────────
  // Scan elke kolom op BV-name patronen in de eerste 100 rijen. Kolom met
  // de meeste hits én ≥ 30% hit-ratio wint.
  const SAMPLE_SIZE = Math.min(rows.length, 100)
  let bestByContent: { col: string; hits: number; ratio: number } | null = null
  for (const col of headers) {
    let hits = 0
    let nonEmpty = 0
    for (let i = 0; i < SAMPLE_SIZE; i++) {
      const v = rows[i][col]
      if (v == null || v === '') continue
      nonEmpty++
      const s = String(v)
      if (BV_VALUE_PATTERNS.some(re => re.test(s))) hits++
    }
    if (nonEmpty === 0 || hits === 0) continue
    const ratio = hits / nonEmpty
    if (ratio < 0.3) continue
    if (!bestByContent || hits > bestByContent.hits) {
      bestByContent = { col, hits, ratio }
    }
  }
  if (bestByContent) return bestByContent.col

  // ── 2) Exacte "BV"-kolom-naam ──────────────────────────────────────
  for (let i = 0; i < headers.length; i++) {
    const h = (headers[i] ?? '').toString().trim().toLowerCase()
    if (h === 'bv' || h === 'b.v.' || h === 'bv naam' || h === 'b.v. naam') {
      return headers[i]
    }
  }

  // ── 3) Header-keyword match (fallback) ─────────────────────────────
  const HEADER_KEYWORDS = [
    'bedrijf', 'onderneming', 'organisatie', 'organisation', 'organization',
    'vennootschap', 'company', 'business unit', 'businessunit', 'unit',
    'winstcentrum', 'winst centrum', 'profit center', 'profitcenter', 'profit',
    'centrum', 'afdeling', 'department', 'kostenplaats', 'eenheid',
    'organisatorisch', 'divisie', 'division', 'entiteit', 'entity',
  ]
  const lower = headers.map(h => (h ?? '').toString().toLowerCase().trim())
  for (const kw of HEADER_KEYWORDS) {
    const idx = lower.findIndex(h => h.includes(kw))
    if (idx >= 0) return headers[idx]
  }
  return ''
}

/** Default-mapping: probeer een BV-waarde uit het bestand naar één van onze
 *  drie buckets te mappen. PRODUCTIE-BV-DETECTIE EERST: als de naam ergens
 *  "consultancy"/"projects"/"software" bevat, mapt hij dáárop — ongeacht
 *  andere woorden zoals "holding" of "tpg" in dezelfde string. Zo wordt
 *  "TPG Holding Consultancy B.V." correct als Consultancy herkend.
 *  Pas in laatste instantie vallen overgebleven namen (Holdings, Engineering,
 *  Ingenieurs, Specialisten en alles anders) onder 'ignore'. */
function defaultMapBvValue(raw: string): BvId | 'ignore' {
  const v = raw.toLowerCase().trim()
  if (!v) return 'ignore'
  // 1) Onze 3 productie-BVs — substring-match wint altijd
  if (v.includes('consultancy')) return 'Consultancy'
  if (v.includes('software'))    return 'Software'
  if (v.includes('projects'))    return 'Projects'
  if (v.includes('project'))     return 'Projects'
  // 2) SAP profit-center codes
  if (v.includes('p15000') || v === '15000') return 'Consultancy'
  if (v.includes('p25000') || v === '25000') return 'Projects'
  if (v.includes('p35000') || v === '35000') return 'Software'
  // 3) Korte codes (whitespace-trimmed exact-match)
  if (v === 'co' || v === 'cons')   return 'Consultancy'
  if (v === 'pr' || v === 'proj')   return 'Projects'
  if (v === 'sw' || v === 'soft')   return 'Software'
  // 4) Alles wat geen van bovenstaande matcht → ignore
  //    (Holdings, Engineering, Ingenieurs, Specialisten, etc.)
  return 'ignore'
}

/** Per-bvValue aggregatie. Pure functie zodat we 'm ook kunnen aanroepen
 *  wanneer de gebruiker in de tegel een andere bedrijf-kolom kiest. */
interface BvValueAgg {
  value: string; uren: number; rowCount: number;
  consultancyTariefValue: number;
  unmatchedWerknemers: number; noTariefCount: number;
}
function aggregateMissingHoursByBvValue(args: {
  rawRows: Record<string, unknown>[]
  werknemerCol: string
  urenCol: string
  bvCol: string
  tariffLookup: ReturnType<typeof buildTariffLookup>
}): { bvValueAggs: BvValueAgg[]; totalRows: number; rowsWithUren: number; rowsWithoutBv: number } {
  const { rawRows, werknemerCol, urenCol, bvCol, tariffLookup } = args
  const aggsByValue = new Map<string, BvValueAgg>()
  let totalRows = 0, rowsWithUren = 0, rowsWithoutBv = 0
  for (const row of rawRows) {
    totalRows++
    // parseHoursCell ondersteunt SAP-formaten zoals "121,00 u" — die strippen
    // de trailing "u" en spaties zodat een rij als 'The People Group |
    // Projects;05.2026;Jan Koreman;73,00 u' netjes 73 uren oplevert.
    // parseDutchNumber faalt op "121,00 u" omdat de trailing letter de regex
    // breekt en je dan null terugkrijgt → rij wordt overgeslagen → geen
    // BV-waarden gevonden.
    const urenParsed = parseHoursCell(row[urenCol])
    if (urenParsed === null) continue
    const uren = Math.abs(urenParsed)
    if (uren === 0) continue
    rowsWithUren++
    const bvRaw = bvCol ? String(row[bvCol] ?? '').trim() : ''
    if (!bvRaw) { rowsWithoutBv++; continue }
    let agg = aggsByValue.get(bvRaw)
    if (!agg) {
      agg = { value: bvRaw, uren: 0, rowCount: 0, consultancyTariefValue: 0,
              unmatchedWerknemers: 0, noTariefCount: 0 }
      aggsByValue.set(bvRaw, agg)
    }
    agg.uren += uren
    agg.rowCount++
    const match = matchRowValue(row[werknemerCol], tariffLookup)
    if (!match) { agg.unmatchedWerknemers++ }
    else if (!match.tariff.tarief || match.tariff.tarief <= 0) { agg.noTariefCount++ }
    else { agg.consultancyTariefValue += uren * match.tariff.tarief * 0.9 }
  }
  return {
    bvValueAggs: Array.from(aggsByValue.values()).sort((a, b) => b.uren - a.uren),
    totalRows, rowsWithUren, rowsWithoutBv,
  }
}

/** Bepaal de default-maand: huidige kalendermaand als die in 2026 valt,
 *  anders de laatste BUDGET_MONTHS_2026. */
function defaultTargetMonth(today: Date): string {
  if (today.getFullYear() === 2026) {
    const code = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][today.getMonth()]
    const candidate = `${code}-26`
    if (BUDGET_MONTHS_2026.includes(candidate)) return candidate
  }
  return BUDGET_MONTHS_2026[BUDGET_MONTHS_2026.length - 1]
}

interface SlotDef {
  id: ForecastSlotId
  label: string
  icon: string
  description: string
  scope: 'all-bvs' | 'consultancy' | 'projects'
  /** Welke andere parser-slot-id we gebruiken bij parseImportFile. Voor de
   *  meeste slots is dat dezelfde id; voor enkele wijken we af. */
  parserSlot: string
  /** Vereist tariffLookup (missing_hours). */
  needsTariffLookup?: boolean
  /** Eenheid voor weergave in de tegel. Hours-slots tonen "u" i.p.v. "€" zodat
   *  de getallen niet als bedragen worden gelezen. */
  unit: 'eur' | 'hours'
  /** Snapshot-slots representeren een momenteel saldo (OHW-componenten). Geen
   *  maand-filter — het bestand wordt als geheel meegenomen. De UI toont de
   *  delta t.o.v. dezelfde rij in de OHW Overzicht van de vorige maand. */
  isSnapshot: boolean
  /** Voor snapshot-slots: welke OHW-rij we als vorige-maand-referentie pakken
   *  voor de delta-vergelijking. Niet-gezet → snapshot zonder delta-UI. */
  ohwRow?: { entity: string; rowId: string }
}

const SLOTS: SlotDef[] = [
  { id: 'factuurvolume',   label: 'Factuurvolume YTD',     icon: '🧾', description: 'SAP-export van gefactureerde omzet voor de lopende maand zoals tot vandaag bekend.', scope: 'all-bvs',    parserSlot: 'factuurvolume',   unit: 'eur',   isSnapshot: false },
  { id: 'geschreven_uren', label: 'Werknemertijden YTD',   icon: '⏱',  description: 'SAP werknemertijden YTD — declarabel, intern en verlof per BV. Voedt de declarabiliteits-indicator.', scope: 'all-bvs', parserSlot: 'geschreven_uren', unit: 'hours', isSnapshot: false },
  { id: 'interne_uren',    label: 'Interne uren YTD',      icon: '🧩', description: 'SAP interne-uren-export — niet-declarabele uren per BV. Helpt te zien hoe leegloop / overleg / sales zich ontwikkelen t.o.v. plan.', scope: 'all-bvs', parserSlot: 'interne_uren',    unit: 'hours', isSnapshot: false },
  // ── Snapshots: momenteel saldo, geen filter, delta vs vorige maand ───────
  { id: 'uren_lijst',      label: 'NTF Uren (pipeline)',   icon: '📋', description: 'Nog Te Factureren netto-waarde per BV — momenteel pipeline-saldo (multi-BV).', scope: 'all-bvs', parserSlot: 'uren_lijst',      unit: 'eur',   isSnapshot: true },
  { id: 'd_lijst',         label: 'D Lijst (Consultancy)', icon: '📊', description: 'D-facturatie-stand voor Consultancy — momenteel saldo, vergelijking met OHW-stand vorige maand.', scope: 'consultancy', parserSlot: 'd_lijst',         unit: 'eur',   isSnapshot: true, ohwRow: { entity: 'Consultancy', rowId: 'c1' } },
  { id: 'conceptfacturen', label: 'Conceptfacturen (Projects)', icon: '📄', description: 'E-Projecten / conceptfacturen Projects — momenteel saldo, vergelijking met OHW-stand vorige maand.', scope: 'projects', parserSlot: 'conceptfacturen',  unit: 'eur',   isSnapshot: true, ohwRow: { entity: 'Projects', rowId: 'p4' } },
  { id: 'missing_hours',   label: 'Missing Hours (alle BVs)', icon: '⚠', description: 'Werknemer × tarief × 0.9 — alle BVs. Consultancy + Projects krijgen waarde, Software wordt niet meegerekend in omzet.', scope: 'all-bvs', parserSlot: 'missing_hours', needsTariffLookup: true, unit: 'eur',   isSnapshot: true, ohwRow: { entity: 'Consultancy', rowId: 'c4' } },
  { id: 'ohw',             label: 'OHW Excel (Projects)',  icon: '🏗', description: 'Onderhanden projecten in OHW Excel — momenteel saldo, vergelijking met OHW-stand vorige maand.', scope: 'projects', parserSlot: 'ohw',             unit: 'eur',   isSnapshot: true, ohwRow: { entity: 'Projects', rowId: 'p10' } },
]

const MONTH_CODES_ALL = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/** Vorige kalendermaand t.o.v. de doel-maand. Voor 'Jan-26' wordt dat
 *  'Dec-25'; gaat dus over de jaargrens heen. */
function previousMonth(monthCode: string): string {
  const m = monthCode.match(/^(\w+)-(\d{2})$/)
  if (!m) return monthCode
  const idx = MONTH_CODES_ALL.indexOf(m[1])
  const yy = Number(m[2])
  if (idx > 0) return `${MONTH_CODES_ALL[idx - 1]}-${String(yy).padStart(2, '0')}`
  return `Dec-${String(yy - 1).padStart(2, '0')}`
}

/** Format een getal volgens de slot-eenheid. EUR-slots → "€ 1.234", hours-slots
 *  → "1.234 u". Houdt rekening met negatieve waarden. */
function fmtUnit(v: number, unit: 'eur' | 'hours'): string {
  if (unit === 'hours') {
    if (!isFinite(v)) return '—'
    const rounded = Math.round(v)
    return `${rounded.toLocaleString('nl-NL')} u`
  }
  return fmt(v)
}

/** Trend-projectie van het OHW-totaal per BV voor `targetMonth`. Gebruikt
 *  2025 + 2026 historie uit OHW Overzicht en levert per BV de geprojecteerde
 *  waarde + uitlegregel. Auto-update bij elke OHW Overzicht-wijziging. */
function useProjectedOhw(targetMonth: string): Partial<Record<ForecastBv, OhwProjection>> {
  const data2025 = useOhwStore(s => s.data2025)
  const data2026 = useOhwStore(s => s.data2026)

  return useMemo(() => {
    const out: Partial<Record<ForecastBv, OhwProjection>> = {}
    for (const bv of PRODUCTION_BVS) {
      out[bv] = projectOhwForMonth(bv, targetMonth, data2025, data2026)
    }
    return out
  }, [targetMonth, data2025, data2026])
}

interface SlotCardProps {
  slot: SlotDef
  month: string
  uploadedBy: string | null
  readonly: boolean
}
type WizardState =
  | { type: 'generic'; workbook: XLSX.WorkBook; file: File }
  | { type: 'missing_hours'; workbook: XLSX.WorkBook; file: File }

function SlotCard({ slot, month, uploadedBy, readonly }: SlotCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  /** dragDepth telt enter/leave-events zodat de hover-state niet flikkert bij
   *  drag-over een child-element (browser stuurt dan leave + enter dicht achter
   *  elkaar). De card is "hover-actief" zolang dragDepth > 0. */
  const [dragDepth, setDragDepth] = useState(0)
  const [wizardState, setWizardState] = useState<WizardState | null>(null)
  /** Bewaart het gedetailleerde categorie-detail (leegloop / overleg / …) van
   *  de interne_uren-CSV zodat we het kunnen meeschrijven in de payload nadat
   *  de gebruiker de wizard heeft bevestigd. */
  const internalHoursDetailRef = useRef<InternalHoursParseResult | null>(null)
  const getRecord = useForecastStore(s => s.getRecord)
  const saveInput = useForecastStore(s => s.saveInput)
  const removeInput = useForecastStore(s => s.removeInput)
  // Subscribe to records-array zodat we live re-renderen bij realtime push +
  // cross-references kunnen maken (bv. missing_hours leest geschreven_uren
  // voor de U-share berekening van Projects).
  const allRecords = useForecastStore(s => s.records)
  const { toasts, showToast } = useToast()
  const record = getRecord(month, slot.id)
  const tariffEntries = useTariffStore(s => s.entries)
  const updateTariffEntry = useTariffStore(s => s.updateEntry)
  const addTariffEntry = useTariffStore(s => s.addEntry)
  const tariffLookup = useMemo(() => buildTariffLookup(tariffEntries), [tariffEntries])

  /** Schrijf het wizard-resultaat (of direct-parsed resultaat) naar de
   *  forecast-store. Geen approval-modal: in de Voorspelling-tab gaat alles
   *  meteen "live" zodra de gebruiker de kolommen/filters bevestigt. */
  const commitResult = (
    file: File,
    result: ParseResult,
    extra?: Record<string, unknown>,
  ) => {
    const payload: Record<string, unknown> = {
      perBv:          result.perBv,
      total:          result.totalAmount,
      parsedCount:    result.parsedCount,
      skippedCount:   result.skippedCount,
      detectedAmount: result.detectedAmountCol,
      detectedBv:     result.detectedBvCol,
      ...(extra ?? {}),
    }
    saveInput({
      month, slot: slot.id, bv: null,
      payload, fileName: file.name, uploadedBy,
    })
    showToast(`✅ ${slot.label} geüpload`, 'g')
  }

  /** Aggregeer de SAP-werknemertijden-rijen per BV per Projecttype voor de
   *  target-maand. Levert per BV de uren-verdeling over de projecttype-buckets
   *  zoals 'Uren' (= U-projecten), 'Eenheden' (= E-projecten), 'Intern TPG'.
   *  Wordt gebruikt om de U-share te berekenen voor de missing-hours-logic
   *  voor Projects (alleen uren op U-projecten hebben nog geen OHW-waarde). */
  const aggregateHoursPerBvPerProjectType = (result: ParseResult): Record<BvId, Record<string, number>> => {
    const out: Record<BvId, Record<string, number>> = {
      Consultancy: {}, Projects: {}, Software: {},
    }
    // Detecteer welke kolommen we nodig hebben uit de SAP-headers.
    const headers = result.headers ?? []
    const lower = headers.map(h => (h ?? '').toString().toLowerCase().trim())
    const bedrijfCol = headers[lower.findIndex(h => h.includes('bedrijf'))] ?? null
    const projecttypeCol = headers[lower.findIndex(h => h.includes('projecttype'))] ?? null
    // SAP per-week / per-maand format heeft kolommen met de werkelijke
    // uren-waardes (bv. 'Gewerkte tijd', 'Afwezigheidstijd', en/of maand-
    // /week-kolommen). We scannen ALLE numerieke kolommen die niet de
    // bedrijf/projecttype-kolommen zijn en kijken of de waarde door de
    // maand-filter heen komt (we filteren al niet hier — die check
    // gebeurt op het hele resultaat). Hier sommeren we alleen uren over
    // alle rijen × alle numerieke kolommen.
    if (!bedrijfCol || !projecttypeCol) return out

    // Heuristiek: alle kolommen die GEEN bedrijf/projecttype/werknemer/datum
    // /maand-label-achtige strings bevatten, zijn waarschijnlijk numeriek.
    // We pakken een conservatieve set: alle kolommen waarvan minstens 50%
    // van de eerste 50 niet-lege waarden numeriek is.
    const numericCols: string[] = []
    for (const h of headers) {
      if (h === bedrijfCol || h === projecttypeCol) continue
      let nonEmpty = 0, numeric = 0
      for (let i = 0; i < Math.min(result.rawRows.length, 50); i++) {
        const v = result.rawRows[i][h]
        if (v == null || v === '') continue
        nonEmpty++
        const s = String(v).replace(/[,\s]/g, '.').replace(/\.+/, '.')
        if (!isNaN(parseFloat(s))) numeric++
      }
      if (nonEmpty >= 3 && numeric / nonEmpty >= 0.5) numericCols.push(h)
    }

    for (const row of result.rawRows) {
      const bv = (() => {
        const v = String(row[bedrijfCol] ?? '').toLowerCase()
        if (v.includes('consultancy')) return 'Consultancy' as BvId
        if (v.includes('projects'))    return 'Projects'    as BvId
        if (v.includes('software'))    return 'Software'    as BvId
        return null
      })()
      if (!bv) continue
      const projecttype = String(row[projecttypeCol] ?? '').trim()
      if (!projecttype) continue
      let hours = 0
      for (const col of numericCols) {
        const v = row[col]
        if (typeof v === 'number') hours += v
        else if (typeof v === 'string' && v) {
          const n = parseFloat(v.replace(',', '.'))
          if (!isNaN(n)) hours += n
        }
      }
      if (hours === 0) continue
      out[bv][projecttype] = (out[bv][projecttype] ?? 0) + hours
    }
    return out
  }

  /** SAP-timesheet aggregate voor de geschreven_uren-slot — converteert de
   *  ruwe SAP-rijen naar (declarabel, intern, verlof) per BV, gefilterd op
   *  de Voorspelling-tab doel-maand. Wordt aangeroepen nadat de gebruiker in
   *  de GenericImportWizard zijn kolommen heeft bevestigd. */
  const sapAggregateForHoursSlot = (result: ParseResult): {
    perBv: Record<BvId, number>; totalAmount: number; extra: Record<string, unknown>
  } | null => {
    if (slot.id !== 'geschreven_uren') return null
    if (!isSapTimesheetHeaders(result.headers)) return null
    const unit = detectSapTimesheetPeriodUnit(result.headers)
    const allEntries: ParsedHoursEntry[] = unit === 'week'
      ? aggregateSapTimesheetWeekly(result.rawRows, result.headers).monthEntries
      : aggregateSapTimesheet(result.rawRows, result.headers).entries
    if (allEntries.length === 0) return null
    // Filter op doel-maand — SAP-export is bijna altijd YTD.
    const entries = allEntries.filter(e => e.month === month)
    if (entries.length === 0) return null
    const byBv: Record<BvId, number> = { Consultancy: 0, Projects: 0, Software: 0 }
    const totals: Partial<Record<BvId, {
      declarable: number; internal: number; vakantie: number; ziekte: number; overigVerlof: number
    }>> = {}
    for (const e of entries) {
      byBv[e.bv] += e.declarable + e.internal
      if (!totals[e.bv]) totals[e.bv] = { declarable: 0, internal: 0, vakantie: 0, ziekte: 0, overigVerlof: 0 }
      totals[e.bv]!.declarable   += e.declarable
      totals[e.bv]!.internal     += e.internal
      totals[e.bv]!.vakantie     += e.vakantie
      totals[e.bv]!.ziekte       += e.ziekte
      totals[e.bv]!.overigVerlof += e.overigVerlof
    }
    return {
      perBv: byBv,
      totalAmount: byBv.Consultancy + byBv.Projects + byBv.Software,
      extra: { hoursTotalsPerBv: totals },
    }
  }

  const processFile = async (file: File) => {
    setBusy(true)
    try {
      // Veiligheidscheck: alleen Excel/CSV doorlaten. Andere bestanden vroeg
      // afwijzen zodat we de SAP-parsers geen ongeldige input voeren.
      const okExt = /\.(xlsx|xls|csv)$/i.test(file.name)
      if (!okExt) {
        throw new Error(`Bestandstype niet ondersteund: ${file.name} (gebruik .xlsx, .xls of .csv)`)
      }

      // ── OHW Excel: vast tabblad "Onderhande Werk" + kolom AO. Geen kolom-
      // keuze nodig en geen wizard-config voor — direct parsen. We pakken
      // óók het weeknummer uit de bestandsnaam ("Onderhanden Werk week 21 NA")
      // zodat de engine de waarde correct kan extrapoleren naar maandeind. ──
      if (slot.id === 'ohw') {
        const result = await parseImportFile(file, 'ohw')
        const fileWeek = weekFromFilename(file.name)
        const extrapolation = fileWeek !== null
          ? computeOhwExtrapolation(month, fileWeek)
          : null
        if (fileWeek === null) {
          showToast(
            `⚠ Geen weeknummer gevonden in "${file.name}". Bestand wordt als end-of-month gebruikt (geen extrapolatie).`,
            'r',
          )
        } else if (extrapolation?.outOfRange) {
          showToast(
            `⚠ Weeknummer ${fileWeek} valt buiten ${formatMonthLabel(month)} — gebruikt zonder extrapolatie.`,
            'r',
          )
        } else if (extrapolation) {
          showToast(
            `✓ OHW Excel week ${fileWeek}: ${extrapolation.weeksCovered}/${extrapolation.weeksTotal} weken gedekt → ×${extrapolation.factor.toFixed(2)} naar ${formatMonthLabel(month)}`,
            'g',
          )
        }
        commitResult(file, result, {
          fileWeek,
          extrapolation: extrapolation && !extrapolation.outOfRange ? extrapolation : null,
        })
        return
      }

      // ── Interne uren: CSV met vast schema. We lezen 'm via de SAP-CSV-
      // parser zodat we de gedetailleerde categorisatie (leegloop / overleg /
      // sales / …) bewaren als extra payload-veld. Daarna openen we tóch de
      // GenericImportWizard zodat de gebruiker de kolom-keuze kan bevestigen
      // en eventueel een BV-filter toepassen — net als de andere slots. ─────
      if (slot.id === 'interne_uren') {
        try {
          const parsed = await parseInternalHoursFile(file)
          // Sla het categorie-detail vast op zodat de payload later eventueel
          // door de UI gebruikt kan worden. Voor de wizard is alleen het
          // wizard-resultaat leidend; we mergen het detail in commitResult.
          internalHoursDetailRef.current = parsed
        } catch (e) {
          // parseInternalHoursFile faalt soft → de wizard kan het alsnog parsen
          // op basis van de generieke kolom-detectie. Geen blocker.
          internalHoursDetailRef.current = null
          console.warn('[forecast] interne uren detail-parse skipped:', e)
        }
        const workbook = await readWorkbookFromFile(file)
        setWizardState({ type: 'generic', workbook, file })
        return
      }

      // ── Wizard-flows: open de juiste wizard met de workbook ──────────────
      // Zelfde kolom-keuze + filter-flow als in de echte Maandafsluiting, maar
      // bij confirm gaat het resultaat naar forecast_inputs i.p.v. OHW/imports.
      const workbook = await readWorkbookFromFile(file)
      if (slot.id === 'missing_hours') {
        setWizardState({ type: 'missing_hours', workbook, file })
      } else {
        // factuurvolume / geschreven_uren / uren_lijst / d_lijst / conceptfacturen
        setWizardState({ type: 'generic', workbook, file })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast(`Upload mislukt: ${msg}`, 'r')
    } finally {
      setBusy(false)
    }
  }

  /** Filter het wizard-resultaat tot rijen van de doel-maand. De geüploade
   *  SAP-exports bevatten doorgaans de hele YTD-periode (Jan t/m huidige
   *  maand) — voor de Voorspelling-tab hebben we alleen de huidige maand
   *  nodig anders krijgt de extrapolatie absurde totalen. Filter draait op
   *  ÉLK slot (ook NTF / D-lijst / conceptfacturen) zodra er een datum-
   *  kolom in het bestand is. Snapshot-bestanden zonder datum-kolom vallen
   *  terug op de ongefilterde wizard-totalen + zichtbare waarschuwing. */
  const applyMonthFilter = (result: ParseResult): {
    filteredResult: ParseResult
    filterMeta: { dateCol: string | null; kept: number; dropped: number; applied: boolean; snapshot?: boolean }
  } => {
    // Snapshot-slots representeren een momenteel saldo — geen maand-filter.
    // We willen de volledige waarde uit het bestand en vergelijken die met
    // de OHW-stand van vorige maand (zie tile-UI hieronder).
    if (slot.isSnapshot) {
      return {
        filteredResult: result,
        filterMeta: {
          dateCol: null, kept: result.parsedCount, dropped: result.skippedCount,
          applied: false, snapshot: true,
        },
      }
    }
    const fallback = {
      filteredResult: result,
      filterMeta: { dateCol: null, kept: result.parsedCount, dropped: result.skippedCount, applied: false },
    }
    if (!result.rawRows || result.rawRows.length === 0) return fallback
    if (!result.detectedAmountCol || !result.detectedBvCol) return fallback

    const filtered = filterRowsToMonth({
      rows:           result.rawRows,
      headers:        result.headers,
      amountCol:      result.detectedAmountCol,
      bvCol:          result.detectedBvCol,
      targetMonth:    month,
      absoluteValue:  slot.id === 'factuurvolume',
      positiveOnly:   slot.id === 'geschreven_uren' || slot.id === 'interne_uren',
    })

    if (!filtered.dateCol) {
      // Geen datum-kolom herkend (op header EN op inhoud). Bestand wordt als
      // geheel meegenomen — caller zal een waarschuwing tonen.
      return {
        ...fallback,
        filterMeta: { ...fallback.filterMeta, dateCol: null, applied: false },
      }
    }

    return {
      filteredResult: {
        ...result,
        perBv:       filtered.perBv,
        totalAmount: filtered.totalAmount,
        parsedCount: filtered.kept,
        skippedCount: filtered.dropped,
      },
      filterMeta: { dateCol: filtered.dateCol, kept: filtered.kept, dropped: filtered.dropped, applied: true },
    }
  }

  const onGenericWizardConfirm = (rawResult: ParseResult) => {
    if (!wizardState) return
    const file = wizardState.file
    setWizardState(null)

    // ── Filter op doel-maand (vóór alle aggregaties) ───────────────────────
    const { filteredResult: result, filterMeta } = applyMonthFilter(rawResult)
    const monthLabel = formatMonthLabel(month)
    if (filterMeta.snapshot) {
      showToast(`✓ ${slot.label} opgeslagen als momenteel saldo (geen maand-filter)`, 'g')
    } else if (filterMeta.applied) {
      showToast(
        `✓ Gefilterd op ${monthLabel} via "${filterMeta.dateCol}": ${filterMeta.kept} rijen behouden, ${filterMeta.dropped} weggefilterd`,
        'g',
      )
    } else {
      showToast(
        `⚠ Geen datum-kolom herkend — bestand wordt als geheel meegenomen. Controleer dat het alleen ${monthLabel} bevat!`,
        'r',
      )
    }

    // Voor geschreven_uren: overrulen met SAP-aggregate. De SAP-aggregate
    // werkt op de ongefilterde rawRows omdat hij zijn eigen maand-detectie
    // doet via de SAP-header-kolommen (en intern al filtert op doel-maand,
    // zie sapAggregateForHoursSlot).
    const sap = sapAggregateForHoursSlot(rawResult)
    if (sap) {
      // Extra: per-BV per-projecttype uren voor de U-share berekening
      // (wordt door missing_hours-logic gebruikt).
      const hoursPerBvPerProjectType = aggregateHoursPerBvPerProjectType(rawResult)
      commitResult(
        file,
        { ...result, perBv: sap.perBv, totalAmount: sap.totalAmount },
        {
          ...sap.extra,
          hoursPerBvPerProjectType,
          filterMeta: { ...filterMeta, dateCol: 'SAP maand-kolommen', applied: true },
        },
      )
      return
    }
    // Voor interne_uren: hang het eerder gelezen categorie-detail aan als
    // extra payload, gefilterd op de doel-maand.
    if (slot.id === 'interne_uren' && internalHoursDetailRef.current) {
      const detail = internalHoursDetailRef.current
      const categoriesPerBv: Record<string, Record<string, number>> = {}
      for (const e of detail.entries) {
        if (e.month !== month) continue   // filter detail óók op doel-maand
        if (!categoriesPerBv[e.bv]) categoriesPerBv[e.bv] = {}
        for (const [k, v] of Object.entries(e.categories)) {
          categoriesPerBv[e.bv][k] = (categoriesPerBv[e.bv][k] ?? 0) + v
        }
      }
      commitResult(file, result, { internalHoursCategories: categoriesPerBv, filterMeta })
      internalHoursDetailRef.current = null
      return
    }
    commitResult(file, result, { filterMeta })
  }

  const onMissingHoursWizardConfirm = (
    result: ParseResult,
    cfg: { werknemerCol: string; urenCol: string; bedrijfCol?: string; bedrijfFilter?: string[] },
  ) => {
    if (!wizardState) return
    const file = wizardState.file
    setWizardState(null)

    // Multi-BV aggregatie:
    //  - BV-toewijzing per rij: PRIMAIR via de BV-kolom in het bestand zelf
    //    (de gebruiker bevestigt dat die kolom aanwezig is). FALLBACK via de
    //    tarief-tabel als de wizard geen BV-kolom heeft gekozen of als de
    //    rij-waarde niet matcht.
    //  - Uren-waarde: parseDutchNumber op cfg.urenCol.
    //  - Consultancy value-berekening: per-werknemer × tarief × 0.9
    //    (vereist match in IC Tarieven).
    //  - Projects telt alleen counts; de engine vermenigvuldigt later met
    //    U-share × avg-Projects-tarief × 0.9.
    //  - Software: counts/value vastleggen voor diagnostiek, maar engine
    //    gebruikt ze niet in de omzet-berekening.
    const fullLookup = buildTariffLookup(tariffEntries)
    const idToBv: Record<string, BvId> = {}
    for (const t of tariffEntries) {
      if (t.bedrijf === 'Consultancy' || t.bedrijf === 'Projects' || t.bedrijf === 'Software') {
        idToBv[t.id] = t.bedrijf
      }
    }

    // ── BV-kolom-detectie (3-staps) ──────────────────────────────────────
    //   1) Wizard's keuze (cfg.bedrijfCol)
    //   2) Header-keyword match — veel keywords zodat we SAP/PowerBI/Excel-
    //      exports allemaal afdekken
    //   3) Content-based: scan elke kolom op cellen met onze BV-namen
    let bvCol = detectBvColumn(result.headers, result.rawRows, cfg.bedrijfCol)

    // Aggregeer per BV-waarde — gebruikt de gedeelde helper (idempotent zodat
    // we 'm ook later kunnen aanroepen als de gebruiker een andere bedrijf-
    // kolom kiest in de tegel-UI).
    const { bvValueAggs, totalRows, rowsWithUren, rowsWithoutBv } =
      aggregateMissingHoursByBvValue({
        rawRows:      result.rawRows,
        werknemerCol: cfg.werknemerCol,
        urenCol:      cfg.urenCol,
        bvCol,
        tariffLookup: fullLookup,
      })

    // Default-mapping per BV-waarde
    const bvMapping: Record<string, BvId | 'ignore'> = {}
    for (const a of bvValueAggs) {
      bvMapping[a.value] = defaultMapBvValue(a.value)
    }

    // Per-BV aggregaten op basis van de default-mapping (engine leest deze).
    // Wanneer de gebruiker de mapping later wijzigt, herrekent de snapshot
    // dit live op basis van bvValueAggs + bvMapping.
    const countsPerBv: Record<BvId, number> = { Consultancy: 0, Projects: 0, Software: 0 }
    const valuesPerBv: Record<BvId, number> = { Consultancy: 0, Projects: 0, Software: 0 }
    for (const a of bvValueAggs) {
      const target = bvMapping[a.value]
      if (target === 'ignore') continue
      countsPerBv[target] += a.uren
      if (target === 'Consultancy') valuesPerBv['Consultancy'] += a.consultancyTariefValue
    }

    // Gemiddeld IC-tarief van Projects-medewerkers (uit IC Tarieven).
    const projectsTariffs = tariffEntries
      .filter(t => t.bedrijf === 'Projects' && (t.tarief ?? 0) > 0)
      .map(t => t.tarief)
    const avgProjectsTariff = projectsTariffs.length > 0
      ? projectsTariffs.reduce((s, t) => s + t, 0) / projectsTariffs.length
      : 0

    // Bewaar rawRows + cfg-velden zodat de tegel-UI live kan re-aggregeren
    // wanneer de gebruiker een andere bedrijf-kolom selecteert. Voor missing-
    // hours-bestanden is het volume manageable (typisch ~1k-3k rijen).
    commitResult(
      file,
      result,
      {
        perBv:                  valuesPerBv,
        total:                   valuesPerBv.Consultancy + valuesPerBv.Projects,
        countsPerBv,
        avgProjectsTariff,
        bvCol:                   bvCol || null,
        bedrijfFilter:           cfg.bedrijfFilter ?? null,
        bvValueAggs,
        bvMapping,
        rawRows:                 result.rawRows,
        headers:                 result.headers,
        werknemerCol:            cfg.werknemerCol,
        urenCol:                 cfg.urenCol,
        diagnostics:             {
          totalRows,
          rowsWithUren,
          rowsWithoutBv,
          distinctBvValues:      bvValueAggs.length,
        },
      },
    )

    if (rowsWithUren > 0 && bvValueAggs.length === 0) {
      showToast(
        `⚠ Geen BV-kolom-waarden gevonden in ${rowsWithUren} rijen — BV-kolom: "${bvCol || 'niet gevonden'}". Heropen de wizard en kies in stap 3 de bedrijf-kolom.`,
        'r',
      )
    }
  }

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    await processFile(file)
  }

  const onDragEnter = (e: React.DragEvent) => {
    if (readonly || busy) return
    // Alleen reageren op file-drags, niet op tekst-selecties die binnen de
    // browser worden gesleept.
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    setDragDepth(d => d + 1)
  }
  const onDragOver = (e: React.DragEvent) => {
    if (readonly || busy) return
    if (!e.dataTransfer.types.includes('Files')) return
    // preventDefault is verplicht om de drop te accepteren.
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = (e: React.DragEvent) => {
    if (readonly || busy) return
    if (!e.dataTransfer.types.includes('Files')) return
    setDragDepth(d => Math.max(0, d - 1))
  }
  const onDrop = async (e: React.DragEvent) => {
    if (readonly || busy) return
    e.preventDefault()
    setDragDepth(0)
    const files = e.dataTransfer.files
    if (!files || files.length === 0) return
    if (files.length > 1) {
      showToast('Sleep één bestand tegelijk', 'r')
      return
    }
    await processFile(files[0])
  }

  const onDelete = () => {
    if (!confirm(`Verwijder de ${slot.label}-upload voor ${formatMonthLabel(month)}?`)) return
    removeInput(month, slot.id)
    showToast('Verwijderd', 'g')
  }

  const hasUpload = !!record
  const total = hasUpload ? Number(record!.payload['total'] ?? 0) : 0
  const perBv = hasUpload ? (record!.payload['perBv'] ?? {}) as Record<string, number> : {}
  const isDragHover = dragDepth > 0 && !readonly && !busy

  // Voor snapshot-slots: pak de OHW-stand van vorige maand zodat we de delta
  // kunnen tonen. NB: useOhwStore-data is via realtime live; veranderingen in
  // OHW Overzicht updaten deze delta automatisch.
  const ohwData2025 = useOhwStore(s => s.data2025)
  const ohwData2026 = useOhwStore(s => s.data2026)
  const prevMonthCode = previousMonth(month)
  const prevMonthValue: number | null = (() => {
    if (!slot.ohwRow) return null
    const yearData = prevMonthCode.endsWith('-25') ? ohwData2025 : ohwData2026
    const ent = yearData.entities.find(e => e.entity === slot.ohwRow!.entity)
    if (!ent) return null
    for (const section of ent.onderhanden) {
      const row = section.rows.find(r => r.id === slot.ohwRow!.rowId)
      if (row) return Number(row.values?.[prevMonthCode] ?? 0)
    }
    return null
  })()
  const snapshotDelta = (slot.isSnapshot && hasUpload && prevMonthValue !== null)
    ? total - prevMonthValue
    : null

  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        padding: 10,
        borderRadius: 8,
        background: isDragHover
          ? 'rgba(0,169,224,0.12)'
          : hasUpload ? 'rgba(38,201,151,0.06)' : 'var(--bg2)',
        border: `2px ${isDragHover ? 'dashed' : 'solid'} ${
          isDragHover ? 'var(--blue)' : hasUpload ? 'var(--green)' : 'var(--bd2)'
        }`,
        display: 'flex', flexDirection: 'column', gap: 8,
        position: 'relative',
        transition: 'background 0.12s, border-color 0.12s',
      }}
    >
      {isDragHover && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, color: 'var(--blue)',
          background: 'rgba(0,169,224,0.06)',
          borderRadius: 6,
          pointerEvents: 'none',
          zIndex: 2,
        }}>
          ⬇ Laat los om te uploaden
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>{slot.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)' }}>{slot.label}</div>
          <div style={{ fontSize: 10, color: 'var(--t3)', lineHeight: 1.4 }}>{slot.description}</div>
        </div>
        {hasUpload && <span style={{ fontSize: 12, color: 'var(--green)' }}>✓</span>}
      </div>
      {hasUpload && (
        <div style={{ fontSize: 10.5, color: 'var(--t2)' }}>
          <strong>{record!.fileName}</strong>
          <span style={{ marginLeft: 8, color: 'var(--t3)' }}>
            {new Date(record!.uploadedAt).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })}
            {record!.uploadedBy ? ` · ${record!.uploadedBy}` : ''}
          </span>
        </div>
      )}
      {/* ── Missing Hours: per-BV-waarde mapping + breakdown ──────────── */}
      {hasUpload && slot.id === 'missing_hours' && (() => {
        const avgProjTar  = Number(record!.payload['avgProjectsTariff'] ?? 0)
        const bvCol       = record!.payload['bvCol'] as string | null | undefined
        const bvValueAggs = (record!.payload['bvValueAggs'] ?? []) as Array<{
          value: string; uren: number; rowCount: number; consultancyTariefValue: number;
          unmatchedWerknemers: number; noTariefCount: number;
        }>
        const bvMapping   = (record!.payload['bvMapping'] ?? {}) as Record<string, BvId | 'ignore'>
        const diag        = record!.payload['diagnostics'] as {
          totalRows: number; rowsWithUren: number;
          rowsWithoutBv: number; distinctBvValues: number;
        } | undefined

        // U-share uit geschreven_uren upload van dezelfde maand
        const hoursRec = allRecords.find(rr => rr.month === month && rr.slot === 'geschreven_uren')
        const hppt = hoursRec?.payload['hoursPerBvPerProjectType'] as
          Record<string, Record<string, number>> | undefined
        const projPpt = hppt?.['Projects']
        let uShare: number | null = null
        let projTotalHrs = 0
        let projUrenHrs  = 0
        if (projPpt) {
          projTotalHrs = Object.values(projPpt).reduce((s, v) => s + v, 0)
          projUrenHrs  = projPpt['Uren'] ?? 0
          if (projTotalHrs > 0) uShare = projUrenHrs / projTotalHrs
        }

        // Live-aggregatie op basis van de actuele bvMapping. Zo zien we de
        // updated totalen direct als de gebruiker een mapping wijzigt.
        let consCount = 0, consValue = 0, projCount = 0, swCount = 0, ignoredCount = 0
        for (const a of bvValueAggs) {
          const target = bvMapping[a.value] ?? 'ignore'
          if (target === 'ignore') { ignoredCount += a.uren; continue }
          if (target === 'Consultancy') {
            consCount += a.uren
            consValue += a.consultancyTariefValue
          } else if (target === 'Projects') {
            projCount += a.uren
          } else if (target === 'Software') {
            swCount += a.uren
          }
        }
        const projValue = (projCount > 0 && avgProjTar > 0 && uShare !== null)
          ? projCount * uShare * avgProjTar * 0.9
          : null
        const totalValue = consValue + (projValue ?? 0)
        const totalCounted = consCount + projCount + swCount + ignoredCount

        // Mapping change handler — schrijft een bijgewerkte bvMapping terug
        // naar de store en triggert daarmee een snapshot+forecast-recompute.
        const updateMapping = (bvValue: string, target: BvId | 'ignore') => {
          const newMapping = { ...bvMapping, [bvValue]: target }
          saveInput({
            month, slot: 'missing_hours', bv: null,
            payload: { ...record!.payload, bvMapping: newMapping },
            fileName: record!.fileName, uploadedBy: record!.uploadedBy,
          })
        }

        // Helper: wijzig de actieve BV-kolom en re-aggregeer alles live.
        const headers = (record!.payload['headers'] ?? []) as string[]
        const rawRowsStored = (record!.payload['rawRows'] ?? []) as Record<string, unknown>[]
        const werknemerColStored = (record!.payload['werknemerCol'] ?? '') as string
        const urenColStored = (record!.payload['urenCol'] ?? '') as string

        const changeBvColumn = (newBvCol: string) => {
          if (rawRowsStored.length === 0) {
            showToast('Kan niet re-aggregeren: rawRows niet bewaard in deze upload. Upload opnieuw.', 'r')
            return
          }
          const fullLookup = buildTariffLookup(tariffEntries)
          const { bvValueAggs: newAggs } = aggregateMissingHoursByBvValue({
            rawRows:      rawRowsStored,
            werknemerCol: werknemerColStored,
            urenCol:      urenColStored,
            bvCol:        newBvCol,
            tariffLookup: fullLookup,
          })
          // Kolomwissel = volledig verse defaults. Een eerder gekozen mapping
          // op een waarde uit de OUDE kolom heeft geen betekenis voor de NIEUWE
          // kolom — die levert andere waarden op.
          const newMapping: Record<string, BvId | 'ignore'> = {}
          for (const a of newAggs) {
            newMapping[a.value] = defaultMapBvValue(a.value)
          }
          saveInput({
            month, slot: 'missing_hours', bv: null,
            payload: {
              ...record!.payload,
              bvCol:        newBvCol || null,
              bvValueAggs:  newAggs,
              bvMapping:    newMapping,
            },
            fileName: record!.fileName, uploadedBy: record!.uploadedBy,
          })
          showToast(`BV-kolom gewijzigd: "${newBvCol}" — ${newAggs.length} waarden`, 'g')
        }

        return (
          <div style={{
            fontSize: 10, padding: '8px 10px',
            background: 'var(--bg2)', border: '1px solid var(--bd2)',
            borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            {/* Header met BV-kolom-selector */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--t2)' }}>
                BV-mapping
              </span>
              <span style={{ fontSize: 9, color: 'var(--t3)' }}>
                {bvValueAggs.length} waarden in bestand
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 9, color: 'var(--t3)' }}>BV-kolom:</span>
                <select
                  value={bvCol ?? ''}
                  onChange={(e) => changeBvColumn(e.target.value)}
                  disabled={readonly || headers.length === 0}
                  style={{
                    background: 'var(--bg1)', color: 'var(--t1)',
                    border: '1px solid var(--bd2)', borderRadius: 4,
                    padding: '2px 6px', fontSize: 10, fontWeight: 600,
                    maxWidth: 180,
                  }}
                >
                  <option value="">— Kies kolom —</option>
                  {headers.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
            </div>

            {bvValueAggs.length === 0 && (
              <div style={{
                fontSize: 9.5, color: 'var(--red)',
                padding: '4px 6px', background: 'rgba(239,68,68,0.08)',
                border: '1px solid var(--red)', borderRadius: 4,
              }}>
                ⚠ Geen BV-waarden gevonden in kolom <strong>"{bvCol || 'niet gekozen'}"</strong>.
                {' '}Kies hierboven de juiste bedrijf-kolom uit het bestand.
                {headers.length === 0 && rawRowsStored.length === 0 && (
                  <> Of upload het bestand opnieuw — deze upload is nog vóór de nieuwe rawRows-opslag gemaakt.</>
                )}
              </div>
            )}

            {/* Mapping-tabel per BV-waarde in het bestand */}
            {bvValueAggs.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {bvValueAggs.map(a => {
                  const current = bvMapping[a.value] ?? 'ignore'
                  return (
                    <div key={a.value} style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto auto',
                      gap: 6, alignItems: 'center',
                      padding: '3px 0', fontSize: 10,
                    }}>
                      <span style={{ color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={a.value}>
                        {a.value}
                        <span style={{ color: 'var(--t3)', marginLeft: 4, fontSize: 9 }}>
                          ({a.rowCount}r · {a.uren.toFixed(0)} u)
                        </span>
                      </span>
                      <select
                        value={current}
                        onChange={(e) => updateMapping(a.value, e.target.value as BvId | 'ignore')}
                        disabled={readonly}
                        style={{
                          background: 'var(--bg1)',
                          color: current === 'ignore' ? 'var(--t3)' : BV_COLORS[current as BvId],
                          border: `1px solid ${current === 'ignore' ? 'var(--bd2)' : BV_COLORS[current as BvId]}`,
                          borderRadius: 4, padding: '2px 6px',
                          fontSize: 10, fontWeight: 600,
                        }}
                      >
                        <option value="ignore">Negeren</option>
                        <option value="Consultancy">→ Consultancy</option>
                        <option value="Projects">→ Projects</option>
                        <option value="Software">→ Software</option>
                      </select>
                    </div>
                  )
                })}
              </div>
            )}

            {bvValueAggs.length > 0 && (
              <div style={{
                paddingTop: 6, borderTop: '1px solid var(--bd2)',
                display: 'flex', flexDirection: 'column', gap: 4,
              }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--t2)', marginBottom: 2 }}>
                  Resultaat per BV
                </div>
                {/* Consultancy rij */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: BV_COLORS.Consultancy }} />
                  <span style={{ minWidth: 80, color: BV_COLORS.Consultancy, fontWeight: 600 }}>Consultancy</span>
                  <span style={{ color: 'var(--t2)', fontVariantNumeric: 'tabular-nums', minWidth: 60 }}>
                    {consCount.toFixed(0)} u
                  </span>
                  <span style={{ color: 'var(--t3)', flex: 1, fontSize: 9.5 }}>
                    × werknemer-tarief × 0,9
                  </span>
                  <strong style={{ color: 'var(--t1)' }}>{fmt(consValue)}</strong>
                </div>
                {/* Projects rij */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: BV_COLORS.Projects }} />
                  <span style={{ minWidth: 80, color: BV_COLORS.Projects, fontWeight: 600 }}>Projects</span>
                  <span style={{ color: 'var(--t2)', fontVariantNumeric: 'tabular-nums', minWidth: 60 }}>
                    {projCount.toFixed(0)} u
                  </span>
                  <span style={{ color: 'var(--t3)', flex: 1, fontSize: 9.5 }}>
                    {uShare !== null ? (
                      <>× U-share <strong style={{ color: 'var(--t2)' }}>{(uShare * 100).toFixed(0)}%</strong> × €{avgProjTar.toFixed(0)}/u × 0,9</>
                    ) : (
                      <span style={{ color: 'var(--amber)' }}>⚠ U-share onbekend</span>
                    )}
                  </span>
                  <strong style={{ color: projValue !== null ? 'var(--t1)' : 'var(--t3)' }}>
                    {projValue !== null ? fmt(projValue) : '—'}
                  </strong>
                </div>
                {/* Software rij */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: BV_COLORS.Software }} />
                  <span style={{ minWidth: 80, color: BV_COLORS.Software, fontWeight: 600 }}>Software</span>
                  <span style={{ color: 'var(--t2)', fontVariantNumeric: 'tabular-nums', minWidth: 60 }}>
                    {swCount.toFixed(0)} u
                  </span>
                  <span style={{ color: 'var(--t3)', flex: 1, fontSize: 9.5, fontStyle: 'italic' }}>
                    niet meegerekend in omzet
                  </span>
                  <strong style={{ color: 'var(--t3)' }}>—</strong>
                </div>
                {ignoredCount > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--t3)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--bd2)' }} />
                    <span style={{ minWidth: 80 }}>Genegeerd</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 60 }}>
                      {ignoredCount.toFixed(0)} u
                    </span>
                    <span style={{ flex: 1, fontSize: 9.5, fontStyle: 'italic' }}>
                      buiten de drie productie-BVs
                    </span>
                  </div>
                )}
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  paddingTop: 4, borderTop: '1px dashed var(--bd2)',
                }}>
                  <span style={{ color: 'var(--t3)' }}>Totaal in omzet</span>
                  <strong style={{ color: 'var(--t1)' }}>{fmt(totalValue)}</strong>
                </div>
              </div>
            )}

            {/* Diagnostiek / waarschuwingen */}
            {uShare === null && projCount > 0 && (
              <div style={{
                fontSize: 9.5, color: 'var(--amber)',
                padding: '4px 6px', background: 'rgba(245,158,11,0.08)',
                border: '1px solid var(--amber)', borderRadius: 4,
              }}>
                ⚠ Projects-waarde nog niet berekend. Upload eerst <strong>Werknemertijden YTD</strong> —
                de engine leest dan uit kolom <strong>Projecttype</strong> hoeveel % van de uren naar
                "Uren" (= U-projecten) gaat.
              </div>
            )}
            {uShare !== null && projCount > 0 && (
              <div style={{ fontSize: 9, color: 'var(--t3)' }}>
                U-share = {projUrenHrs.toFixed(0)} u op "Uren" / {projTotalHrs.toFixed(0)} u totaal Projects ·
                gem. Projects-tarief uit IC Tarieven: €{avgProjTar.toFixed(0)}/u
              </div>
            )}
            {diag && (
              <div style={{ fontSize: 9, color: 'var(--t3)' }}>
                {diag.totalRows} rijen totaal · {diag.rowsWithUren} met uren &gt; 0
                {diag.rowsWithoutBv > 0 && <> · {diag.rowsWithoutBv} zonder BV-waarde overgeslagen</>}
                {' · '}{totalCounted.toFixed(0)} u toegewezen
              </div>
            )}
          </div>
        )
      })()}

      {hasUpload && (() => {
        const meta = record!.payload['filterMeta'] as
          | { dateCol: string | null; kept: number; dropped: number; applied: boolean; snapshot?: boolean }
          | undefined
        // Snapshot-slot: geen filter-info, maar delta vs vorige maand (indien
        // ohwRow gemapt is). Voor multi-BV snapshots (NTF/uren_lijst) tonen we
        // alleen een neutraal label.
        if (slot.isSnapshot) {
          // ── OHW Excel: speciaal — toon week + extrapolatie-factor ─────
          const fileWeek = record!.payload['fileWeek'] as number | null | undefined
          const ex = record!.payload['extrapolation'] as
            | { factor: number; weeksCovered: number; weeksTotal: number; fileWeek: number }
            | null
            | undefined
          const projectedEom = (slot.id === 'ohw' && ex && total)
            ? total * ex.factor
            : null

          if (slot.ohwRow && prevMonthValue !== null && snapshotDelta !== null) {
            const deltaColor = snapshotDelta > 0 ? 'var(--green)' : snapshotDelta < 0 ? 'var(--red)' : 'var(--t3)'
            const deltaSign = snapshotDelta > 0 ? '+' : snapshotDelta < 0 ? '−' : ''
            return (
              <div style={{
                fontSize: 10, padding: '6px 8px',
                background: 'rgba(0,169,224,0.06)', border: '1px solid rgba(0,169,224,0.3)',
                borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 3,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ color: 'var(--t3)' }}>
                    {slot.id === 'ohw' && fileWeek ? `Saldo t/m wk ${fileWeek}` : 'Huidig saldo'}
                  </span>
                  <strong style={{ color: 'var(--t1)' }}>{fmtUnit(total, slot.unit)}</strong>
                </div>
                {projectedEom !== null && ex && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ color: 'var(--blue)' }}>
                      Geprojecteerd EoM (×{ex.factor.toFixed(2)} · {ex.weeksCovered}/{ex.weeksTotal} wk)
                    </span>
                    <strong style={{ color: 'var(--blue)' }}>{fmtUnit(projectedEom, slot.unit)}</strong>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ color: 'var(--t3)' }}>{prevMonthCode} (uit OHW Overzicht)</span>
                  <span style={{ color: 'var(--t2)' }}>{fmtUnit(prevMonthValue, slot.unit)}</span>
                </div>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', gap: 8,
                  paddingTop: 3, borderTop: '1px dashed var(--bd2)',
                }}>
                  <span style={{ color: 'var(--t3)' }}>Δ t.o.v. vorige maand</span>
                  <strong style={{ color: deltaColor }}>
                    {deltaSign}{fmtUnit(Math.abs(snapshotDelta), slot.unit)}
                  </strong>
                </div>
              </div>
            )
          }
          return (
            <div style={{ fontSize: 9.5, color: 'var(--t3)' }}>
              ℹ Momenteel saldo — geen maand-filter
              {slot.ohwRow && prevMonthValue === null && <> · geen historie in OHW Overzicht voor {prevMonthCode}</>}
              {slot.id === 'ohw' && fileWeek && <> · week {fileWeek} uit bestandsnaam</>}
            </div>
          )
        }
        // Tijd-gebaseerde slot: toon filter-status zoals voorheen.
        if (!meta) {
          return (
            <div style={{
              fontSize: 9.5, color: 'var(--amber)', padding: '3px 6px',
              background: 'rgba(245,158,11,0.08)', border: '1px solid var(--amber)',
              borderRadius: 4,
            }}>
              ⚠ Upload van vóór de maand-filter — verwijder en upload opnieuw om alleen {formatMonthLabel(month)} te pakken.
            </div>
          )
        }
        if (!meta.applied) {
          return (
            <div style={{
              fontSize: 9.5, color: 'var(--red)', padding: '3px 6px',
              background: 'rgba(239,68,68,0.08)', border: '1px solid var(--red)',
              borderRadius: 4,
            }}>
              ⚠ Geen datum-kolom herkend — bestand niet gefilterd. Cijfers kunnen YTD-totalen i.p.v. {formatMonthLabel(month)} bevatten.
            </div>
          )
        }
        return (
          <div style={{ fontSize: 9.5, color: 'var(--green)' }}>
            ✓ Filter: {formatMonthLabel(month)} via <strong>{meta.dateCol}</strong> · {meta.kept} rijen behouden, {meta.dropped} weggefilterd
          </div>
        )
      })()}
      {hasUpload && slot.scope === 'all-bvs' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 10 }}>
          {PRODUCTION_BVS.map(bv => (
            <span key={bv} style={{
              padding: '2px 7px', borderRadius: 999,
              background: `${BV_COLORS[bv]}1a`, color: BV_COLORS[bv], fontWeight: 600,
            }}>
              {bv}: {fmtUnit(Number(perBv[bv] ?? 0), slot.unit)}
            </span>
          ))}
        </div>
      )}
      {hasUpload && slot.scope !== 'all-bvs' && (
        <div style={{ fontSize: 11, color: 'var(--t2)' }}>
          Totaal: <strong>{fmtUnit(total, slot.unit)}</strong>
        </div>
      )}
      {!hasUpload && !busy && !readonly && (
        <div style={{ fontSize: 9.5, color: 'var(--t3)', fontStyle: 'italic' }}>
          Sleep een bestand hierheen of klik op Upload
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept=".xlsx,.xls,.csv"
          onChange={onFile}
          disabled={readonly}
        />
        <button
          className="btn sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || readonly}
        >
          {busy ? '… verwerken' : hasUpload ? '↻ Vervangen' : '📁 Upload'}
        </button>
        {hasUpload && (
          <button className="btn sm ghost" onClick={onDelete} disabled={readonly}>
            🗑 Wissen
          </button>
        )}
      </div>
      <Toast toasts={toasts} />

      {/* ── Wizard-overlays — identieke kolom-keuze + filter-flow als in
            de Maandafsluiting; bij confirm gaat het resultaat naar
            forecast_inputs i.p.v. OHW Overzicht / import_records. ─── */}
      {wizardState?.type === 'generic' && (
        <GenericImportWizard
          workbook={wizardState.workbook}
          fileName={wizardState.file.name}
          slotId={slot.parserSlot}
          onConfirm={onGenericWizardConfirm}
          onCancel={() => setWizardState(null)}
        />
      )}
      {wizardState?.type === 'missing_hours' && (
        <MissingHoursWizard
          workbook={wizardState.workbook}
          fileName={wizardState.file.name}
          tariffs={tariffLookup}
          onConfirm={onMissingHoursWizardConfirm}
          onCancel={() => setWizardState(null)}
          onSetTariff={(employeeId, tarief) => {
            updateTariffEntry(employeeId, { tarief })
            showToast(`IC tarief €${tarief} opgeslagen voor werknemer ${employeeId}`, 'g')
          }}
          onAddEmployee={(rawIdentifier, tarief) => {
            // Zelfde heuristiek als MaandTab — kies het juiste veld op basis van
            // de vorm van de ingevoerde identifier.
            const s = rawIdentifier.trim()
            const draft = {
              id: `new-${Date.now()}`,
              bedrijf: 'Consultancy' as const,
              naam: '', powerbiNaam: '', powerbiNaam2: '',
              stroming: '', tarief, fte: null,
              functie: '', leidingGevende: '', manager: '', team: '',
            }
            if (/^\d{3,}$/.test(s)) {
              draft.id = s
              draft.naam = '(onbekende medewerker — vul aan)'
            } else if (s.includes(',')) {
              draft.powerbiNaam = s
              const parts = s.split(',').map(p => p.trim()).filter(Boolean)
              if (parts.length === 2) draft.naam = `${parts[1]} ${parts[0]}`
            } else if (/^[A-Z0-9]{3,}$/.test(s) && !s.includes(' ')) {
              draft.powerbiNaam2 = s
              draft.naam = s
            } else {
              draft.naam = s
            }
            addTariffEntry(draft)
            showToast(
              `"${s.slice(0, 40)}" toegevoegd als Consultancy medewerker met IC-tarief €${tarief}/u`,
              'g',
            )
          }}
        />
      )}
    </div>
  )
}

interface OhwEstimateInputProps {
  month: string
  bv: ForecastBv
  uploadedBy: string | null
  projection: OhwProjection | undefined
  readonly: boolean
}
function OhwEstimateInput({ month, bv, uploadedBy, projection, readonly }: OhwEstimateInputProps) {
  const getRecord = useForecastStore(s => s.getRecord)
  const saveInput = useForecastStore(s => s.saveInput)
  const removeInput = useForecastStore(s => s.removeInput)
  useForecastStore(s => s.records)

  const rec = getRecord(month, 'ohw_estimate', bv)
  const projectedValue = projection?.value ?? 0
  const value = rec ? Number(rec.payload['value'] ?? 0) : projectedValue
  const [raw, setRaw] = useState<string>('')
  const [editing, setEditing] = useState(false)
  const isAuto = !rec

  const displayValue = editing
    ? raw
    : value === 0
      ? ''
      : `${value < 0 ? '-' : ''}EUR ${Math.abs(value).toLocaleString('nl-NL', { maximumFractionDigits: 0 })}`

  const commit = () => {
    setEditing(false)
    const cleaned = raw.replace(/EUR/gi, '').replace(/€/g, '').replace(/[\s ]/g, '')
      .replace(/[−-]/g, '-').replace(/\./g, '').replace(/,/g, '.')
    const parsed = parseFloat(cleaned)
    const v = isNaN(parsed) ? 0 : parsed
    if (v === 0 && rec) {
      removeInput(month, 'ohw_estimate', bv)
    } else if (v !== 0 && v !== projectedValue) {
      saveInput({
        month, slot: 'ohw_estimate', bv, payload: { value: v },
        fileName: null, uploadedBy,
      })
    } else if (v === projectedValue && rec) {
      // User typte exact de auto-waarde → terug naar auto-modus.
      removeInput(month, 'ohw_estimate', bv)
    }
  }

  const sourceBadge =
    isAuto && projection
      ? projection.source === 'trend'      ? { label: 'auto · trend',     color: 'var(--green)' }
      : projection.source === 'last'       ? { label: 'auto · 1 datapunt', color: 'var(--amber)' }
      : projection.source === 'py-pattern' ? { label: 'auto · 2025',       color: 'var(--amber)' }
      : { label: 'geen historie', color: 'var(--t3)' }
      : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: BV_COLORS[bv] }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: BV_COLORS[bv] }}>{bv}</span>
        {sourceBadge && (
          <span title={projection?.basis}
                style={{ fontSize: 9, padding: '1px 6px', borderRadius: 999,
                         background: 'rgba(255,255,255,.04)', color: sourceBadge.color,
                         border: `1px solid ${sourceBadge.color}`, fontWeight: 600 }}>
            {sourceBadge.label}
          </span>
        )}
        {!isAuto && (
          <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 999,
                         background: 'rgba(0,169,224,.12)', color: 'var(--blue)',
                         border: '1px solid var(--blue)', fontWeight: 600 }}>
            handmatig
          </span>
        )}
      </div>
      <input
        className="ohw-inp"
        style={{ width: '100%', color: isAuto ? 'var(--t2)' : 'var(--t1)', fontStyle: isAuto ? 'italic' : 'normal' }}
        value={displayValue}
        placeholder={projectedValue !== 0 ? `auto: ${fmt(projectedValue)}` : 'EUR 0'}
        disabled={readonly}
        onFocus={(e) => { setEditing(true); setRaw(value === 0 ? '' : String(value)); setTimeout(() => e.target.select(), 0) }}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      />
      {projection && projection.basis && (
        <div style={{ fontSize: 9.5, color: 'var(--t3)', lineHeight: 1.35, paddingTop: 2 }}>
          {projection.basis}
        </div>
      )}
      {!isAuto && (
        <button className="btn sm ghost" style={{ fontSize: 9, alignSelf: 'flex-start' }}
                onClick={() => removeInput(month, 'ohw_estimate', bv)} disabled={readonly}>
          ← terug naar auto
        </button>
      )}
    </div>
  )
}

interface NotesInputProps {
  month: string
  uploadedBy: string | null
  readonly: boolean
}
function NotesInput({ month, uploadedBy, readonly }: NotesInputProps) {
  const getRecord = useForecastStore(s => s.getRecord)
  const saveInput = useForecastStore(s => s.saveInput)
  useForecastStore(s => s.records)
  const rec = getRecord(month, 'notes')
  const [text, setText] = useState((rec?.payload['text'] as string) ?? '')
  useEffect(() => {
    setText((rec?.payload['text'] as string) ?? '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec?.uploadedAt])

  const commit = () => {
    const trimmed = text.trim()
    if (trimmed === ((rec?.payload['text'] as string) ?? '').trim()) return
    saveInput({
      month, slot: 'notes', bv: null,
      payload: { text: trimmed },
      fileName: null, uploadedBy,
    })
  }

  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      disabled={readonly}
      rows={3}
      placeholder="Korte context — bv. 'grote levering uitgesteld naar volgende maand', 'ziekte 3 FTE deze week', 'extra accruals nodig'…"
      style={{
        width: '100%', fontFamily: 'var(--font)', fontSize: 11,
        padding: '6px 8px', borderRadius: 4,
        border: '1px solid var(--bd2)', background: 'var(--bg1)', color: 'var(--t1)',
        resize: 'vertical', minHeight: 60,
      }}
    />
  )
}

// ──────────────────────────────────────────────────────────────────────────
// DataCompletenessPanel — top-level overzicht van welke uploads klaar staan
// voor de doel-maand. Confidence-niveau (laag/midden/hoog) op basis van het
// aantal kritische uploads + de werkdag-progressie. Helpt de gebruiker direct
// zien WAAR hij data moet aanvullen voor een nauwkeuriger forecast.
// ──────────────────────────────────────────────────────────────────────────
interface DataCompletenessPanelProps {
  month: string
  records: ForecastInputRecord[]
  forecast: ReturnType<typeof computeForecast>
}
function DataCompletenessPanel({ month, records, forecast }: DataCompletenessPanelProps) {
  const has = (slot: string) =>
    records.some(r => r.month === month && r.slot === slot)

  const checks: Array<{ slot: string; label: string; critical: boolean; uploaded: boolean }> = [
    { slot: 'factuurvolume',   label: 'Factuurvolume YTD',    critical: true,  uploaded: has('factuurvolume') },
    { slot: 'geschreven_uren', label: 'Werknemertijden YTD',  critical: true,  uploaded: has('geschreven_uren') },
    { slot: 'uren_lijst',      label: 'NTF Uren',             critical: false, uploaded: has('uren_lijst') },
    { slot: 'd_lijst',         label: 'D Lijst (Cons)',       critical: false, uploaded: has('d_lijst') },
    { slot: 'conceptfacturen', label: 'Conceptfacturen (Proj)', critical: false, uploaded: has('conceptfacturen') },
    { slot: 'missing_hours',   label: 'Missing Hours',        critical: true,  uploaded: has('missing_hours') },
    { slot: 'ohw',             label: 'OHW Excel (Proj)',     critical: false, uploaded: has('ohw') },
    { slot: 'interne_uren',    label: 'Interne uren',         critical: false, uploaded: has('interne_uren') },
  ]
  const criticalDone = checks.filter(c => c.critical && c.uploaded).length
  const criticalTotal = checks.filter(c => c.critical).length
  const allDone = checks.filter(c => c.uploaded).length
  const allTotal = checks.length

  // Confidence: combineert werkdag-progressie + aantal kritische uploads.
  let confLabel = 'Lage betrouwbaarheid'
  let confColor = 'var(--red)'
  if (criticalDone === criticalTotal && forecast.workdayCoverage >= 50) {
    confLabel = 'Hoge betrouwbaarheid'
    confColor = 'var(--green)'
  } else if (criticalDone >= 2 || forecast.workdayCoverage >= 33) {
    confLabel = 'Middelmatige betrouwbaarheid'
    confColor = 'var(--amber)'
  }

  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--t2)' }}>
          📊 Data-status voor {formatMonthLabel(month)}
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 10.5, padding: '3px 9px', borderRadius: 999,
          background: 'rgba(255,255,255,0.04)', color: confColor,
          border: `1px solid ${confColor}`, fontWeight: 700,
        }}>
          {confLabel}
        </span>
        <span style={{ fontSize: 10, color: 'var(--t3)' }}>
          {allDone}/{allTotal} bestanden · {criticalDone}/{criticalTotal} kritiek · {forecast.workdayCoverage.toFixed(0)}% werkdagen
        </span>
      </div>
      <div style={{
        marginTop: 10,
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 6,
      }}>
        {checks.map(c => (
          <div key={c.slot} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 10.5, padding: '4px 7px',
            background: c.uploaded ? 'rgba(38,201,151,0.06)' : 'var(--bg2)',
            border: `1px solid ${c.uploaded ? 'var(--green)' : c.critical ? 'var(--amber)' : 'var(--bd2)'}`,
            borderRadius: 4,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: c.uploaded ? 'var(--green)' : c.critical ? 'var(--amber)' : 'var(--t3)',
            }} />
            <span style={{
              color: c.uploaded ? 'var(--t1)' : 'var(--t3)',
              fontWeight: c.uploaded ? 600 : 400,
              flex: 1,
            }}>
              {c.label}
            </span>
            {c.uploaded && <span style={{ color: 'var(--green)' }}>✓</span>}
            {!c.uploaded && c.critical && <span style={{ color: 'var(--amber)', fontSize: 9 }}>kritiek</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// ForecastBvCard — schone, professionele per-BV samenvatting met expandable
// berekening-detail. Eén tegel per BV (incl. Holdings) met:
//   • Hoofdgetal: voorspelde netto-omzet
//   • Vergelijking: Δ vs LE en Δ vs Budget
//   • Marges: brutomarge% en EBITDA% (de twee belangrijkste KPI's)
//   • OHW eindstand voorspelling
//   • Toggle "▸ Toon berekening" → alle inputs + tussenstappen
// ──────────────────────────────────────────────────────────────────────────
interface ForecastBvCardProps {
  bv: ForecastBv
  forecast: ReturnType<typeof computeForecast>
  snapshot: ForecastBvSnapshot
  month: string
  budget: { netto_omzet: number; ebitda: number }
  ohwProjection: OhwProjection | undefined
}
function ForecastBvCard({ bv, forecast, snapshot, month, budget, ohwProjection }: ForecastBvCardProps) {
  const [showDetail, setShowDetail] = useState(false)
  const r = forecast.perBv[bv]

  const leRev    = r.le['netto_omzet'] ?? 0
  const leGef    = r.le['gefactureerde_omzet'] ?? 0
  const leAlloc  = r.le['omzet_periode_allocatie'] ?? 0
  const leBruto  = r.le['brutomarge'] ?? 0
  const leEbitda = r.le['ebitda'] ?? 0
  const ytdRev   = r.ytd['netto_omzet'] ?? 0
  const ytdGef   = r.ytd['gefactureerde_omzet'] ?? 0
  const ytdEbitda = r.ytd['ebitda'] ?? 0
  const hasYtd   = r.signalCount > 0
  const ytdWeight = r.blendWeight
  const leWeight  = 1 - r.blendWeight

  const deltaLe  = r.nettoOmzet - leRev
  const deltaBud = r.nettoOmzet - budget.netto_omzet
  const deltaSign = (v: number) => v > 0 ? '+' : v < 0 ? '−' : ''

  // YTD-extrapolatie van factuurvolume (alleen voor de berekening-toelichting)
  const invoicedRaw = snapshot?.invoicedYtd ?? null
  const invoicedExtrapolated = (invoicedRaw !== null && forecast.workdaysElapsed > 0)
    ? (invoicedRaw / forecast.workdaysElapsed) * forecast.workdaysTotal
    : null

  return (
    <div className="card" style={{
      borderLeft: `4px solid ${BV_COLORS[bv]}`,
      padding: 14,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: BV_COLORS[bv] }} />
        <span style={{
          fontSize: 12, fontWeight: 700, color: BV_COLORS[bv],
          textTransform: 'uppercase', letterSpacing: '.05em',
        }}>{bv}</span>
        <span style={{
          marginLeft: 'auto', fontSize: 10, color: 'var(--t3)',
          padding: '2px 7px', borderRadius: 999, background: 'var(--bg2)',
          border: '1px solid var(--bd2)',
        }}>
          {r.signalCount} {r.signalCount === 1 ? 'signaal' : 'signalen'}
        </span>
      </div>

      {/* Primair: Voorspelde netto-omzet */}
      <div>
        <div style={{ fontSize: 10.5, color: 'var(--t3)', marginBottom: 4 }}>
          Voorspelde netto-omzet
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--t1)', lineHeight: 1.1 }}>
          {fmt(r.nettoOmzet)}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 5, fontSize: 10.5 }}>
          <span style={{ color: 'var(--t3)' }}>
            vs LE{' '}
            <strong style={{ color: deltaLe >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {deltaSign(deltaLe)}{fmt(Math.abs(deltaLe)).replace('−', '')}
            </strong>
          </span>
          <span style={{ color: 'var(--t3)' }}>
            vs Budget{' '}
            <strong style={{ color: deltaBud >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {deltaSign(deltaBud)}{fmt(Math.abs(deltaBud)).replace('−', '')}
            </strong>
          </span>
        </div>
      </div>

      {/* Marges */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
        paddingTop: 8, borderTop: '1px solid var(--bd2)',
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 2 }}>Brutomarge</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)' }}>{fmt(r.brutomarge)}</div>
          <div style={{ fontSize: 10.5, color: 'var(--t2)', fontWeight: 600 }}>
            {pctOf(r.brutomarge, r.nettoOmzet)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 2 }}>EBITDA</div>
          <div style={{
            fontSize: 14, fontWeight: 700,
            color: r.ebitda >= 0 ? 'var(--green)' : 'var(--red)',
          }}>{fmt(r.ebitda)}</div>
          <div style={{
            fontSize: 10.5, fontWeight: 600,
            color: r.ebitda >= 0 ? 'var(--green)' : 'var(--red)',
          }}>
            {pctOf(r.ebitda, r.nettoOmzet)}
          </div>
        </div>
      </div>

      {/* OHW (alleen voor productie-BVs) */}
      {bv !== 'Holdings' && (
        <div style={{ paddingTop: 8, borderTop: '1px solid var(--bd2)' }}>
          <div style={{ fontSize: 10, color: 'var(--t3)' }}>OHW eindstand-prognose</div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{fmt(r.ohwForecast)}</div>
        </div>
      )}

      {/* Blend-info met progress-bar */}
      {hasYtd && (
        <div style={{ paddingTop: 6 }}>
          <div style={{ fontSize: 9.5, color: 'var(--t3)', marginBottom: 3, display: 'flex', justifyContent: 'space-between' }}>
            <span>LE-historie {(leWeight * 100).toFixed(0)}%</span>
            <span>YTD-uploads {(ytdWeight * 100).toFixed(0)}%</span>
          </div>
          <div style={{
            height: 4, borderRadius: 2, background: 'var(--bg2)',
            overflow: 'hidden', display: 'flex',
          }}>
            <div style={{ width: `${leWeight * 100}%`, background: 'var(--t3)' }} />
            <div style={{ width: `${ytdWeight * 100}%`, background: BV_COLORS[bv] }} />
          </div>
        </div>
      )}

      {/* Toggle voor berekening-detail */}
      <button
        onClick={() => setShowDetail(s => !s)}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: '4px 0', textAlign: 'left',
          fontSize: 10.5, color: 'var(--t3)', fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        <span style={{ transition: 'transform .15s', transform: showDetail ? 'rotate(90deg)' : 'rotate(0)' }}>▸</span>
        {showDetail ? 'Verberg berekening' : 'Toon berekening'}
      </button>

      {showDetail && (
        <BvCalculationBreakdown
          bv={bv}
          forecast={forecast}
          snapshot={snapshot}
          month={month}
          budget={budget}
          ohwProjection={ohwProjection}
          inputs={{
            leRev, leGef, leAlloc, leBruto, leEbitda,
            ytdRev, ytdGef, ytdEbitda,
            ytdWeight, leWeight,
            invoicedRaw, invoicedExtrapolated,
            hasYtd,
          }}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// BvCalculationBreakdown — uitklap-paneel onder de per-BV card met ALLE
// tussenstappen die naar de prognose hebben geleid. Volgt de engine-volgorde:
//   1. Revenue: LE × leWeight + YTD-extrapolatie × ytdWeight
//   2. Declarabiliteits-adjustment (indien geschreven_uren geüpload)
//   3. Missing hours bijdrage (Consultancy/Projects, met U-share)
//   4. Directe kosten schaling (cost-to-revenue ratio constant)
//   5. EBITDA-marge cap (indien actief)
//   6. OHW prognose: handmatig > OHW Excel × extrapolatie > trend
// ──────────────────────────────────────────────────────────────────────────
interface BreakdownInputs {
  leRev: number; leGef: number; leAlloc: number; leBruto: number; leEbitda: number
  ytdRev: number; ytdGef: number; ytdEbitda: number
  ytdWeight: number; leWeight: number
  invoicedRaw: number | null; invoicedExtrapolated: number | null
  hasYtd: boolean
}
interface BvCalculationBreakdownProps {
  bv: ForecastBv
  forecast: ReturnType<typeof computeForecast>
  snapshot: ForecastBvSnapshot
  month: string
  budget: { netto_omzet: number; ebitda: number }
  ohwProjection: OhwProjection | undefined
  inputs: BreakdownInputs
}
function BvCalculationBreakdown({
  bv, forecast, snapshot, ohwProjection, inputs,
}: BvCalculationBreakdownProps) {
  const r = forecast.perBv[bv]
  const { leRev, leGef, leAlloc, ytdGef, ytdWeight, leWeight, invoicedRaw, invoicedExtrapolated } = inputs

  // Bepaal welke OHW-bron is gebruikt voor de prognose.
  const ohwSourceLabel: string = (() => {
    if (snapshot.ohwEstimate !== undefined && snapshot.ohwEstimate !== 0) return 'handmatige schatting'
    if (bv === 'Projects' && snapshot.ohwExcelTotal !== undefined && snapshot.ohwExcelTotal !== 0) {
      const w = snapshot.ohwExcelWeek
      const f = snapshot.ohwExcelExtrapolationFactor ?? 1
      return `OHW Excel week ${w} × ${f.toFixed(2)} naar maandeind`
    }
    return 'trend-projectie uit OHW Overzicht'
  })()

  const fmtFull = (n: number) => `€ ${Math.round(n).toLocaleString('nl-NL')}`

  // Datapunten ontbrekend / onzeker?
  const gaps: string[] = []
  if (bv !== 'Holdings' && invoicedRaw === null)
    gaps.push('Factuurvolume YTD niet geüpload — revenue volgt puur LE.')
  if (bv === 'Projects' && snapshot.missingHoursCount && !snapshot.missingHoursValue)
    gaps.push('Werknemertijden YTD ontbreekt — U-share onbekend, dus Projects krijgt geen missing-hours-bijdrage.')
  if (bv === 'Projects' && snapshot.ohwExcelTotal === undefined)
    gaps.push('OHW Excel niet geüpload — OHW-prognose valt terug op trend.')
  if (bv === 'Software') {
    gaps.push('Software: omzet-model leunt op trend + factuurvolume YTD. Vooruit-gefactureerd-input wordt nog niet gewogen — flag voor vervolg.')
  }

  return (
    <div style={{
      fontSize: 10.5, lineHeight: 1.5,
      background: 'var(--bg2)', padding: '8px 10px', borderRadius: 6,
      border: '1px solid var(--bd2)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {/* Werkdag-progressie */}
      <div>
        <div style={{ fontWeight: 700, color: 'var(--t2)', marginBottom: 3 }}>
          1. Werkdag-progressie
        </div>
        <div style={{ color: 'var(--t3)' }}>
          {forecast.workdaysElapsed} / {forecast.workdaysTotal} werkdagen = {forecast.workdayCoverage.toFixed(1)}%
          {' '}→ blend-gewicht YTD = {(ytdWeight * 100).toFixed(1)}% (s-curve)
        </div>
      </div>

      {/* Revenue blend */}
      <div>
        <div style={{ fontWeight: 700, color: 'var(--t2)', marginBottom: 3 }}>
          2. Gefactureerde omzet
        </div>
        <div style={{ color: 'var(--t3)', display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span>LE driver-forecast: <strong style={{ color: 'var(--t1)' }}>{fmtFull(leGef)}</strong></span>
          {invoicedRaw !== null && (
            <>
              <span>
                Factuurvolume YTD ({forecast.workdaysElapsed}/{forecast.workdaysTotal} werkdagen):{' '}
                <strong style={{ color: 'var(--t1)' }}>{fmtFull(invoicedRaw)}</strong>
              </span>
              <span>
                → Geprojecteerd EoM: {fmtFull(invoicedRaw)} × {forecast.workdaysTotal} / {forecast.workdaysElapsed} ={' '}
                <strong style={{ color: 'var(--t1)' }}>{fmtFull(invoicedExtrapolated ?? 0)}</strong>
              </span>
              <span>
                Blend: {(leWeight * 100).toFixed(0)}% × {fmtFull(leGef)} + {(ytdWeight * 100).toFixed(0)}% × {fmtFull(invoicedExtrapolated ?? 0)} ={' '}
                <strong style={{ color: 'var(--t1)' }}>{fmtFull(ytdGef * ytdWeight + leGef * leWeight)}</strong>
              </span>
            </>
          )}
          {invoicedRaw === null && (
            <span style={{ color: 'var(--amber)' }}>
              Geen factuurvolume YTD-upload → predicted gefactureerd = LE = {fmtFull(leGef)}
            </span>
          )}
        </div>
      </div>

      {/* Periode-allocatie incl. missing hours + OHW-mutatie */}
      {(() => {
        const trendOhw = ohwProjection?.value ?? 0
        const ohwAdj = (snapshot.ohwEstimate !== undefined && snapshot.ohwEstimate !== 0)
          ? snapshot.ohwEstimate - trendOhw : 0
        return (
          <div>
            <div style={{ fontWeight: 700, color: 'var(--t2)', marginBottom: 3 }}>
              3. Omzet periode-allocatie
            </div>
            <div style={{ color: 'var(--t3)', display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span>LE allocatie: <strong style={{ color: 'var(--t1)' }}>{fmtFull(leAlloc)}</strong></span>
              {(bv === 'Consultancy' || bv === 'Projects') && snapshot.missingHoursValue && (
                <span>
                  + Missing hours bijdrage ({(ytdWeight * 100).toFixed(0)}% gewicht):{' '}
                  <strong style={{ color: 'var(--t1)' }}>+ {fmtFull(snapshot.missingHoursValue * ytdWeight)}</strong>
                  {snapshot.missingHoursCount && (
                    <span style={{ color: 'var(--t3)', marginLeft: 4 }}>
                      ({snapshot.missingHoursCount.toFixed(0)} u × tarief × 0,9 = {fmtFull(snapshot.missingHoursValue)})
                    </span>
                  )}
                </span>
              )}
              {ohwAdj !== 0 && (
                <span>
                  {ohwAdj >= 0 ? '+' : '−'} OHW-eindstand-adjustment:{' '}
                  <strong style={{ color: ohwAdj >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {ohwAdj >= 0 ? '+ ' : '− '}{fmtFull(Math.abs(ohwAdj))}
                  </strong>
                  <span style={{ color: 'var(--t3)', marginLeft: 4 }}>
                    (handmatig {fmtFull(snapshot.ohwEstimate ?? 0)} − trend {fmtFull(trendOhw)})
                  </span>
                </span>
              )}
              {bv === 'Software' && !snapshot.ohwEstimate && (
                <span style={{ color: 'var(--t3)', fontStyle: 'italic' }}>
                  Software: missing hours niet meegerekend; handmatige OHW-eindstand
                  invullen zwaarste hefboom op de prognose.
                </span>
              )}
            </div>
          </div>
        )
      })()}

      {/* Netto omzet totaal */}
      <div>
        <div style={{ fontWeight: 700, color: 'var(--t2)', marginBottom: 3 }}>
          4. Netto-omzet totaal
        </div>
        <div style={{ color: 'var(--t3)' }}>
          Voorspeld: <strong style={{ color: 'var(--t1)' }}>{fmtFull(r.nettoOmzet)}</strong>
          {' · '}LE: {fmtFull(leRev)}
          {' · '}Δ {r.nettoOmzet - leRev >= 0 ? '+' : '−'}{fmtFull(Math.abs(r.nettoOmzet - leRev))}
          {' '}({((r.nettoOmzet / Math.max(1, leRev) - 1) * 100).toFixed(1)}%)
        </div>
      </div>

      {/* Cost scaling */}
      <div>
        <div style={{ fontWeight: 700, color: 'var(--t2)', marginBottom: 3 }}>
          5. Kosten (revenue-gekoppeld)
        </div>
        <div style={{ color: 'var(--t3)' }}>
          Directe kosten schalen evenredig met revenue (cost-to-revenue ratio constant).
          OpEx en A&A blijven uit LE (vast gebudgetteerd). EBITDA-cap actief op historisch +30% / +5pp.
        </div>
      </div>

      {/* OHW */}
      {bv !== 'Holdings' && (
        <div>
          <div style={{ fontWeight: 700, color: 'var(--t2)', marginBottom: 3 }}>
            6. OHW eindstand-prognose
          </div>
          <div style={{ color: 'var(--t3)', display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span>Gebruikte bron: <strong style={{ color: 'var(--t1)' }}>{ohwSourceLabel}</strong></span>
            <span>Voorspelde eindstand: <strong style={{ color: 'var(--t1)' }}>{fmtFull(r.ohwForecast)}</strong></span>
            {ohwProjection && (
              <span>
                Trend-baseline: {ohwProjection.basis}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Onzekerheden / gaten */}
      {gaps.length > 0 && (
        <div style={{
          marginTop: 4, padding: '6px 8px',
          background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: 4,
        }}>
          <div style={{ fontWeight: 700, color: 'var(--amber)', marginBottom: 3 }}>
            ⚠ Onzekerheid / ontbrekende data
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--t2)' }}>
            {gaps.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

interface Props {
  /** Email van huidige user — voor uploadedBy. */
  currentUserEmail?: string | null
}

export function ForecastTab({ currentUserEmail }: Props) {
  const canEdit = useCanEdit()
  const canApprove = useCanApprove()
  const readonly = !canEdit && !canApprove

  const [today] = useState(() => new Date())
  const defaultMonth = useMemo(() => defaultTargetMonth(today), [today])
  const [month, setMonth] = useState<string>(defaultMonth)

  const le = useLatestEstimate(today)
  const getBudgetMonth = useBudgetStore(s => s.getMonth)
  // Trigger re-render bij budget-edits.
  useBudgetStore(s => s.overrides)

  const ohwProjection = useProjectedOhw(month)
  const projectedOhwValues = useMemo(() => {
    const out: Partial<Record<ForecastBv, number>> = {}
    for (const bv of PRODUCTION_BVS) {
      out[bv] = ohwProjection[bv]?.value ?? 0
    }
    return out
  }, [ohwProjection])
  const records = useForecastStore(s => s.records)

  /** Bouw ForecastBvSnapshot per BV uit (LE + uploads). Memo op records+month. */
  const snapshot = useMemo(() => {
    const out = {} as Record<ForecastBv, ForecastBvSnapshot>
    for (const bv of ALL_BVS) {
      // Pure LE per BV per relevante P&L-key.
      const KEYS = [
        'gefactureerde_omzet', 'omzet_periode_allocatie', 'netto_omzet',
        'directe_inkoopkosten', 'directe_personeelskosten', 'directe_overige_personeelskosten', 'directe_autokosten',
        'directe_kosten',
        'indirecte_personeelskosten', 'overige_personeelskosten', 'huisvestingskosten',
        'automatiseringskosten', 'indirecte_autokosten', 'verkoopkosten', 'algemene_kosten', 'doorbelaste_kosten',
        'operationele_kosten',
        'amortisatie_goodwill', 'amortisatie_software', 'afschrijvingen', 'amortisatie_afschrijvingen',
        'brutomarge', 'ebitda', 'ebit',
        'financieel_resultaat', 'vpb', 'netto_resultaat',
      ]
      const leMap: Record<string, number> = {}
      for (const k of KEYS) leMap[k] = le.getLE(bv, month, k)
      // Vul budget aan voor evt. niet-engine keys.
      const bud = getBudgetMonth(bv, month)
      for (const k of Object.keys(bud)) {
        if (!(k in leMap)) leMap[k] = bud[k] ?? 0
      }
      out[bv] = { le: leMap }
    }

    // Vul partial-month inputs uit records in.
    const recsForMonth = records.filter(r => r.month === month)
    for (const r of recsForMonth) {
      const perBv = (r.payload['perBv'] ?? {}) as Record<string, number>
      const total = Number(r.payload['total'] ?? 0)
      switch (r.slot) {
        case 'factuurvolume':
          for (const bv of PRODUCTION_BVS) {
            out[bv].invoicedYtd = Number(perBv[bv] ?? 0)
          }
          break
        case 'geschreven_uren': {
          const ht = (r.payload['hoursTotalsPerBv'] ?? {}) as Record<string, {
            declarable: number; internal: number; vakantie: number; ziekte: number; overigVerlof: number
          }>
          for (const bv of PRODUCTION_BVS) {
            if (ht[bv]) out[bv].hoursYtd = ht[bv]
          }
          break
        }
        case 'uren_lijst':
          for (const bv of PRODUCTION_BVS) {
            out[bv].ntfTotal = Number(perBv[bv] ?? 0)
          }
          break
        case 'd_lijst':
          out['Consultancy'].dLijstTotal = total
          break
        case 'conceptfacturen':
          out['Projects'].conceptfacturenTotal = total
          break
        case 'missing_hours': {
          // Live re-aggregatie op basis van bvMapping (gebruiker kan in de
          // tegel mapping per BV-waarde wijzigen). De pre-computed countsPerBv
          // wordt alleen gebruikt als bvValueAggs/bvMapping ontbreken (legacy
          // uploads van vóór deze refactor).
          const bvValueAggs = r.payload['bvValueAggs'] as Array<{
            value: string; uren: number; consultancyTariefValue: number
          }> | undefined
          const bvMapping = r.payload['bvMapping'] as Record<string, BvId | 'ignore'> | undefined
          const avgProjTar = Number(r.payload['avgProjectsTariff'] ?? 0)

          let consCount = 0, consValue = 0, projCount = 0, swCount = 0
          if (bvValueAggs && bvMapping) {
            for (const a of bvValueAggs) {
              const target = bvMapping[a.value] ?? 'ignore'
              if (target === 'ignore') continue
              if (target === 'Consultancy') {
                consCount += a.uren
                consValue += a.consultancyTariefValue
              } else if (target === 'Projects') {
                projCount += a.uren
              } else if (target === 'Software') {
                swCount += a.uren
              }
            }
          } else {
            // Legacy fallback: oude uploads zonder bvValueAggs
            const oldCounts = r.payload['countsPerBv'] as Record<string, number> | undefined
            const oldValues = r.payload['perBv']       as Record<string, number> | undefined
            consCount = oldCounts?.['Consultancy'] ?? 0
            projCount = oldCounts?.['Projects']    ?? 0
            swCount   = oldCounts?.['Software']    ?? 0
            consValue = oldValues?.['Consultancy'] ?? 0
          }

          // Consultancy: directe value
          if (consValue > 0) {
            out['Consultancy'].missingHoursValue = consValue
            out['Consultancy'].missingHoursCount = consCount
          }

          // Projects: count × U-share × avg-Projects-tarief × 0.9
          if (projCount > 0 && avgProjTar > 0) {
            const hoursRec = records.find(rr =>
              rr.month === month && rr.slot === 'geschreven_uren')
            const hppt = hoursRec?.payload['hoursPerBvPerProjectType'] as
              Record<string, Record<string, number>> | undefined
            const projPpt = hppt?.['Projects']
            if (projPpt) {
              const totalProjHrs = Object.values(projPpt).reduce((s, v) => s + v, 0)
              const urenHrs = projPpt['Uren'] ?? 0
              if (totalProjHrs > 0) {
                const uShare = urenHrs / totalProjHrs
                out['Projects'].missingHoursCount = projCount
                out['Projects'].missingHoursValue = projCount * uShare * avgProjTar * 0.9
              }
            }
          }

          // Software: count voor diagnostiek, engine gebruikt het niet.
          void swCount
          break
        }
        case 'ohw': {
          out['Projects'].ohwExcelTotal = total
          const fileWeek = r.payload['fileWeek'] as number | null
          const ex = r.payload['extrapolation'] as { factor: number; weeksCovered: number; weeksTotal: number; fileWeek: number } | null
          if (typeof fileWeek === 'number') out['Projects'].ohwExcelWeek = fileWeek
          if (ex && typeof ex.factor === 'number') out['Projects'].ohwExcelExtrapolationFactor = ex.factor
          break
        }
        case 'ohw_estimate':
          if (r.bv && out[r.bv]) {
            out[r.bv].ohwEstimate = Number(r.payload['value'] ?? 0)
          }
          break
        default:
          break
      }
    }
    return out
  }, [records, month, le, getBudgetMonth])

  const forecast = useMemo(() => {
    return computeForecast({
      month, today,
      perBv: snapshot,
      lastClosedOhw: projectedOhwValues,
    })
  }, [snapshot, month, today, projectedOhwValues])

  // Subscribe op realtime updates.
  useEffect(() => {
    // Niets te doen — useForecastStore is al ge-subscribed via App-niveau
    // useRealtimeSync; records-prop wijzigingen triggeren re-render hier.
  }, [])

  const monthBudget = (bv: ForecastBv, key: string): number => {
    const m = getBudgetMonth(bv, month)
    return m[key] ?? 0
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── Header met maand-selector + werkdag-progressie ──────────────── */}
      <div className="card">
        <div className="card-hdr" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="card-title">🔮 Voorspelling huidige maand</span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 11, color: 'var(--t3)' }}>Doel-maand:</label>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              style={{
                background: 'var(--bg1)', color: 'var(--t1)',
                border: '1px solid var(--bd2)', borderRadius: 4,
                padding: '4px 8px', fontSize: 12, fontWeight: 600,
              }}
            >
              {BUDGET_MONTHS_2026.map(m => (
                <option key={m} value={m}>{formatMonthLabel(m)}</option>
              ))}
            </select>
          </span>
        </div>
        <div style={{ padding: 12, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ fontSize: 10.5, color: 'var(--t3)', marginBottom: 4 }}>
              Verstreken werkdagen — sterkere YTD-extrapolatie hoe verder de maand is.
            </div>
            <div style={{
              height: 14, borderRadius: 7,
              background: 'var(--bg2)', overflow: 'hidden',
              border: '1px solid var(--bd2)', position: 'relative',
            }}>
              <div style={{
                width: `${forecast.workdayCoverage}%`, height: '100%',
                background: 'linear-gradient(90deg, #00a9e0 0%, #26c997 100%)',
              }} />
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, color: '#fff', textShadow: '0 0 4px rgba(0,0,0,.6)',
              }}>
                {forecast.workdayCoverage.toFixed(0)}% · {forecast.workdaysElapsed} / {forecast.workdaysTotal} dagen
              </div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--t2)', maxWidth: 380 }}>
            De prognose blendt de driver-Latest-Estimate met de uploads en
            handmatige OHW-schatting hieronder. Hoe meer signalen ingevuld en
            hoe verder de maand, hoe accurater. Iedereen ziet dezelfde inputs en
            uitkomst — sync verloopt via Supabase Realtime.
          </div>
        </div>
      </div>

      {/* ── Data-completeness paneel ──────────────────────────────────── */}
      <DataCompletenessPanel month={month} records={records} forecast={forecast} />

      {/* ── Per-BV samenvatting cards — clean redesign ───────────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12,
      }}>
        {ALL_BVS.map(bv => (
          <ForecastBvCard
            key={bv}
            bv={bv}
            forecast={forecast}
            snapshot={snapshot[bv]}
            month={month}
            budget={{
              netto_omzet: monthBudget(bv, 'netto_omzet'),
              ebitda:      monthBudget(bv, 'ebitda'),
            }}
            ohwProjection={ohwProjection[bv]}
          />
        ))}
      </div>

      {/* ── Inputs sectie: uploads + OHW-schatting + notes ───────────────── */}
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">📥 Inputs — bestanden + handmatige schatting</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>
            Uploads worden NIET in OHW Overzicht of Maandafsluiting verwerkt — pure prognose-data.
          </span>
        </div>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Bestanden importeren (YTD-stand)
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8,
            }}>
              {SLOTS.map(slot => (
                <SlotCard
                  key={slot.id} slot={slot} month={month}
                  uploadedBy={currentUserEmail ?? null} readonly={readonly}
                />
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              OHW eindstand-schatting per BV
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--t3)', marginBottom: 8 }}>
              Auto-ingevuld via trend uit OHW Overzicht (mediaan MoM over recente
              maanden + seizoens-overlay uit 2025). Overschrijf alleen als je een
              betere inschatting hebt — bv. een grote project-mijlpaal die je deze
              maand verwacht te factureren.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              {PRODUCTION_BVS.map(bv => (
                <OhwEstimateInput
                  key={bv} bv={bv} month={month}
                  projection={ohwProjection[bv]}
                  uploadedBy={currentUserEmail ?? null}
                  readonly={readonly}
                />
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Notes — context voor deze maand
            </div>
            <NotesInput month={month} uploadedBy={currentUserEmail ?? null} readonly={readonly} />
          </div>
        </div>
      </div>

      {/* ── Detailtabel: voorspelling vs LE vs Budget per P&L-key ────────── */}
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">📊 Detail — voorspelling vs LE vs budget</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <ForecastDetailTable
            forecast={forecast}
            getBudgetMonth={(bv, m) => getBudgetMonth(bv, m)}
            month={month}
          />
        </div>
      </div>
    </div>
  )
}

interface DetailRow {
  key: string
  label: string
  isAggr?: boolean
  isDerived?: boolean
  /** Percentage-rij: toont (value / netto_omzet) i.p.v. een euro-bedrag. */
  isPct?: boolean
  /** Voor isPct: welke key de teller is. */
  pctOfKey?: string
}

const DETAIL_ROWS: DetailRow[] = [
  { key: 'gefactureerde_omzet',          label: 'Gefactureerde omzet' },
  { key: 'omzet_periode_allocatie',      label: 'Omzet periode-allocatie' },
  { key: 'netto_omzet',                  label: 'Netto-omzet', isAggr: true },
  { key: 'directe_personeelskosten',     label: 'Directe personeelskosten' },
  { key: 'directe_inkoopkosten',         label: 'Directe inkoopkosten' },
  { key: 'directe_overige_personeelskosten', label: 'Overige directe personeel' },
  { key: 'directe_autokosten',           label: 'Directe autokosten' },
  { key: 'directe_kosten',               label: 'Totaal directe kosten', isAggr: true },
  { key: 'brutomarge',                   label: 'Brutomarge', isDerived: true },
  { key: 'brutomarge_pct',               label: 'Brutomarge %', isPct: true, pctOfKey: 'brutomarge' },
  { key: 'operationele_kosten',          label: 'Operationele kosten', isAggr: true },
  { key: 'ebitda',                       label: 'EBITDA', isDerived: true },
  { key: 'ebitda_pct',                   label: 'EBITDA %', isPct: true, pctOfKey: 'ebitda' },
  { key: 'amortisatie_afschrijvingen',   label: 'Amortisatie & afschrijvingen', isAggr: true },
  { key: 'ebit',                         label: 'EBIT', isDerived: true },
  { key: 'ebit_pct',                     label: 'EBIT %', isPct: true, pctOfKey: 'ebit' },
]

interface DetailTableProps {
  forecast: ReturnType<typeof computeForecast>
  getBudgetMonth: (bv: ForecastBv, m: string) => Record<string, number>
  month: string
}
function ForecastDetailTable({ forecast, getBudgetMonth, month }: DetailTableProps) {
  return (
    <table className="tbl" style={{ width: '100%', fontSize: 11 }}>
      <thead>
        <tr style={{ background: 'var(--bg3)' }}>
          <th style={{ textAlign: 'left', padding: '6px 10px', minWidth: 200, position: 'sticky', left: 0, background: 'var(--bg3)' }}>P&amp;L-regel</th>
          {ALL_BVS.map(bv => (
            <th key={bv} style={{ textAlign: 'right', padding: '6px 10px', color: BV_COLORS[bv], minWidth: 140 }} colSpan={3}>
              {bv}
            </th>
          ))}
          <th style={{ textAlign: 'right', padding: '6px 10px', minWidth: 140 }} colSpan={3}>Totaal</th>
        </tr>
        <tr style={{ background: 'var(--bg2)' }}>
          <th style={{ position: 'sticky', left: 0, background: 'var(--bg2)' }}></th>
          {[...ALL_BVS, 'Totaal'].map(bv => (
            <Fragment key={bv}>
              <th style={{ textAlign: 'right', padding: '4px 8px', fontSize: 9.5, color: 'var(--t3)' }}>Pred</th>
              <th style={{ textAlign: 'right', padding: '4px 8px', fontSize: 9.5, color: 'var(--t3)' }}>LE</th>
              <th style={{ textAlign: 'right', padding: '4px 8px', fontSize: 9.5, color: 'var(--t3)' }}>Bud</th>
            </Fragment>
          ))}
        </tr>
      </thead>
      <tbody>
        {DETAIL_ROWS.map(row => {
          const isHighlight = row.isAggr || row.isDerived
          let totalPredNum = 0, totalLeNum = 0, totalBudNum = 0
          let totalPredRev = 0, totalLeRev = 0, totalBudRev = 0
          return (
            <tr key={row.key} style={{
              background: isHighlight ? 'var(--bg3)' : undefined,
              fontWeight: isHighlight ? 600 : 400,
              fontStyle: row.isPct ? 'italic' : undefined,
            }}>
              <td style={{
                padding: '5px 10px', position: 'sticky', left: 0,
                background: isHighlight ? 'var(--bg3)' : 'var(--bg1)',
                borderTop: row.isDerived ? '1px solid var(--bd2)' : undefined,
                color: row.isPct ? 'var(--t2)' : undefined,
              }}>
                {row.label}
              </td>
              {ALL_BVS.map(bv => {
                const r = forecast.perBv[bv]
                if (row.isPct && row.pctOfKey) {
                  const predNum = r.predicted[row.pctOfKey] ?? 0
                  const leNum   = r.le[row.pctOfKey] ?? 0
                  const budNum  = getBudgetMonth(bv, month)[row.pctOfKey] ?? 0
                  const predRev = r.predicted['netto_omzet'] ?? 0
                  const leRev   = r.le['netto_omzet'] ?? 0
                  const budRev  = getBudgetMonth(bv, month)['netto_omzet'] ?? 0
                  totalPredNum += predNum; totalLeNum += leNum; totalBudNum += budNum
                  totalPredRev += predRev; totalLeRev += leRev; totalBudRev += budRev
                  const isEbitdaLike = row.pctOfKey === 'ebitda' || row.pctOfKey === 'ebit'
                  const color = isEbitdaLike
                    ? (predNum >= 0 ? 'var(--green)' : 'var(--red)')
                    : 'var(--t1)'
                  return (
                    <Fragment key={bv}>
                      <td style={{ textAlign: 'right', padding: '5px 8px', fontWeight: 700, color }}>{pctOf(predNum, predRev)}</td>
                      <td style={{ textAlign: 'right', padding: '5px 8px', color: 'var(--t2)' }}>{pctOf(leNum, leRev)}</td>
                      <td style={{ textAlign: 'right', padding: '5px 8px', color: 'var(--t3)' }}>{pctOf(budNum, budRev)}</td>
                    </Fragment>
                  )
                }
                const pred = r.predicted[row.key] ?? 0
                const le = r.le[row.key] ?? 0
                const bud = getBudgetMonth(bv, month)[row.key] ?? 0
                totalPredNum += pred; totalLeNum += le; totalBudNum += bud
                return (
                  <Fragment key={bv}>
                    <td style={{ textAlign: 'right', padding: '5px 8px', fontWeight: 700, color: 'var(--t1)' }}>{fmt(pred)}</td>
                    <td style={{ textAlign: 'right', padding: '5px 8px', color: 'var(--t2)' }}>{fmt(le)}</td>
                    <td style={{ textAlign: 'right', padding: '5px 8px', color: 'var(--t3)' }}>{fmt(bud)}</td>
                  </Fragment>
                )
              })}
              {row.isPct ? (
                <>
                  <td style={{ textAlign: 'right', padding: '5px 8px', fontWeight: 700, color: (row.pctOfKey === 'ebitda' || row.pctOfKey === 'ebit') ? (totalPredNum >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--t1)' }}>{pctOf(totalPredNum, totalPredRev)}</td>
                  <td style={{ textAlign: 'right', padding: '5px 8px', color: 'var(--t2)' }}>{pctOf(totalLeNum, totalLeRev)}</td>
                  <td style={{ textAlign: 'right', padding: '5px 8px', color: 'var(--t3)' }}>{pctOf(totalBudNum, totalBudRev)}</td>
                </>
              ) : (
                <>
                  <td style={{ textAlign: 'right', padding: '5px 8px', fontWeight: 700, color: 'var(--t1)' }}>{fmt(totalPredNum)}</td>
                  <td style={{ textAlign: 'right', padding: '5px 8px', color: 'var(--t2)' }}>{fmt(totalLeNum)}</td>
                  <td style={{ textAlign: 'right', padding: '5px 8px', color: 'var(--t3)' }}>{fmt(totalBudNum)}</td>
                </>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
