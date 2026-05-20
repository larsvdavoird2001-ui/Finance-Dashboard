/**
 * TPG maandrapportage PowerPoint generator — versie 4, light edition.
 *
 * Bouwt een 16:9 deck in The People Group huisstijl (licht, cyaan accenten).
 * Belangrijk: alle 2026-cijfers (actuals, budget, Latest Estimate, uren) komen
 * via `ReportDataset` rechtstreeks uit de app-stores — dus inclusief ingevulde
 * budget-overrides, closing-entry-aanpassingen en geüploade SAP-uren. Zo komt
 * het deck exact overeen met wat de gebruiker in de app ziet.
 *
 * Elke slide draagt zijn eigen inzicht/advies bij de cijfers; de per-BV slides
 * tonen de AI-duiding direct naast de P&L.
 */
import PptxGenJS from 'pptxgenjs'
import type { ClosingEntry, BvId, OhwYearData, ImportRecord, HoursRecord } from '../data/types'
import type { EntityName } from '../data/plData'
import { monthlyActuals2025 } from '../data/plData2025'
import { hoursData2025, hoursData2026, MONTHS_2025, MONTHS_2026 } from '../data/hoursData'

// ─── TPG light theme ────────────────────────────────────────────────────
const C = {
  page:      'FFFFFF',
  panel:     'F4F8FC',
  panelAlt:  'E9F1F8',
  tint:      'E7F6FC',
  cyan:      '00A9E0',
  cyanDark:  '0A7CA5',
  navy:      '0E2438',
  ink:       '1E2F42',
  inkSoft:   '5E6E80',
  inkFaint:  '93A3B4',
  green:     '0E9F6E',
  red:       'E0303C',
  amber:     'D9870B',
  purple:    '7C5CD6',
  line:      'D8E2EC',
  lineSoft:  'EAF0F6',
  white:     'FFFFFF',
} as const

const BV_COLOR: Record<EntityName, string> = {
  Consultancy: C.cyan,
  Projects:    C.green,
  Software:    C.purple,
  Holdings:    C.inkSoft,
}

const PAGE_W = 13.333
const PAGE_H = 7.5
const MARGIN = 0.6

const BVS: BvId[] = ['Consultancy', 'Projects', 'Software']
const MONTH_LABELS_SHORT = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']

// ─── Datacontract ───────────────────────────────────────────────────────

/** Volledige dataset voor het deck — gevuld vanuit de app-stores zodat het
 *  rapport de live, bewerkte cijfers gebruikt (budget-overrides, closing
 *  entries, geüploade uren). Indexering: [bv][maandcode][plKey]. */
export interface ReportDataset {
  /** Adjusted actuals 2026 (incl. closing entries & kosten-specificaties). */
  actuals: Record<string, Record<string, Record<string, number>>>
  /** Budget 2026 inclusief ingevulde overrides. */
  budget: Record<string, Record<string, Record<string, number>>>
  /** Latest Estimate 2026 (gesloten maand = actual, open maand = forecast). */
  le: Record<string, Record<string, Record<string, number>>>
  /** Geüploade SAP-uren per BV per maand (2025 + 2026 waar beschikbaar). */
  hours: Record<string, Record<string, HoursBreakdown>>
}

/** Uren-uitsplitsing per (bv, maand) uit de geüploade SAP-data. */
export interface HoursBreakdown {
  declarable: number
  internal: number
  vakantie: number
  ziekte: number
  overigVerlof: number
}

/** AI-duiding (CFO-commentary) per BV. */
export interface AiAnalysisEntry {
  bv: string
  commentary: string
  retrievedAt?: string
}

// ─── Formatters ─────────────────────────────────────────────────────────

function fmtEur(n: number): string {
  if (!isFinite(n)) return '—'
  if (n === 0) return '€ 0'
  const neg = n < 0
  return (neg ? '-€ ' : '€ ') + Math.abs(Math.round(n)).toLocaleString('nl-NL')
}
function fmtEurK(n: number): string {
  if (!isFinite(n) || Math.abs(n) < 1) return '€ 0k'
  const neg = n < 0
  return (neg ? '-' : '') + '€ ' + Math.round(Math.abs(n) / 1000).toLocaleString('nl-NL') + 'k'
}
function fmtSignedEurK(n: number): string {
  if (!isFinite(n) || Math.abs(n) < 1) return '€ 0k'
  return (n > 0 ? '+' : '') + fmtEurK(n)
}
function fmtPct(n: number): string {
  if (!isFinite(n)) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
}
function fmtPpt(n: number): string {
  if (!isFinite(n)) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(1)} ppt`
}
function deltaColor(n: number): string {
  if (Math.abs(n) < 0.0001) return C.inkSoft
  return n > 0 ? C.green : C.red
}

// ─── Image helper ───────────────────────────────────────────────────────

async function fetchImageAsBase64(url: string): Promise<string> {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
    const blob = await res.blob()
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch (err) {
    console.warn(`[PPTX] Logo niet geladen: ${err}`)
    return ''
  }
}

// ─── Layout helpers ─────────────────────────────────────────────────────

function addSectionHeader(slide: PptxGenJS.Slide, kicker: string, title: string, number: number | string) {
  slide.addShape('rect' as const, { x: MARGIN, y: 0.42, w: 0.16, h: 0.46, fill: { color: C.cyan } })
  slide.addText(kicker.toUpperCase(), {
    x: MARGIN + 0.3, y: 0.34, w: PAGE_W - 2, h: 0.24,
    fontFace: 'Inter', fontSize: 9, bold: true, color: C.cyan, charSpacing: 2,
  })
  slide.addText(title, {
    x: MARGIN + 0.3, y: 0.54, w: PAGE_W - 2, h: 0.5,
    fontFace: 'Inter', fontSize: 21, bold: true, color: C.navy,
  })
  slide.addShape('rect' as const, {
    x: MARGIN, y: 1.12, w: PAGE_W - 2 * MARGIN, h: 0.018, fill: { color: C.line }, line: { color: C.line },
  })
  slide.addText(String(number), {
    x: PAGE_W - 0.9, y: PAGE_H - 0.42, w: 0.65, h: 0.3,
    fontFace: 'Inter', fontSize: 10, bold: true, color: C.inkFaint, align: 'right',
  })
}

function addFooter(slide: PptxGenJS.Slide, monthLabel?: string) {
  slide.addText(
    `The People Group · TPG Business Control · Maandrapportage${monthLabel ? ' ' + monthLabel : ''}`,
    {
      x: MARGIN, y: PAGE_H - 0.42, w: 8, h: 0.3,
      fontFace: 'Inter', fontSize: 8.5, color: C.inkFaint,
    },
  )
}

function addKpiCard(
  slide: PptxGenJS.Slide,
  x: number, y: number, w: number, h: number,
  label: string, value: string, sub: string, color: string = C.cyan,
  subColor: string = C.inkSoft,
) {
  slide.addShape('roundRect' as const, {
    x, y, w, h, fill: { color: C.white },
    line: { color: C.line, width: 1 }, rectRadius: 0.06,
    shadow: { type: 'outer', color: 'B8C6D4', blur: 4, offset: 2, angle: 90, opacity: 0.28 },
  })
  slide.addShape('rect' as const, { x, y: y + 0.1, w: 0.07, h: h - 0.2, fill: { color } })
  slide.addText(label.toUpperCase(), {
    x: x + 0.22, y: y + 0.1, w: w - 0.4, h: 0.26,
    fontFace: 'Inter', fontSize: 8.5, bold: true, color: C.inkSoft, charSpacing: 1.2,
  })
  slide.addText(value, {
    x: x + 0.22, y: y + 0.32, w: w - 0.4, h: 0.55,
    fontFace: 'Inter', fontSize: 21, bold: true, color,
  })
  slide.addText(sub, {
    x: x + 0.22, y: y + h - 0.42, w: w - 0.4, h: 0.34,
    fontFace: 'Inter', fontSize: 8.8, color: subColor,
  })
}

function addPanel(
  slide: PptxGenJS.Slide,
  x: number, y: number, w: number, h: number,
  fill: string = C.panel, accent?: string,
) {
  slide.addShape('roundRect' as const, {
    x, y, w, h, fill: { color: fill },
    line: { color: C.line, width: 1 }, rectRadius: 0.06,
  })
  if (accent) slide.addShape('rect' as const, { x, y, w, h: 0.06, fill: { color: accent } })
}

type Tone = 'good' | 'warn' | 'risk' | 'plain' | 'advice'
function toneColor(t: Tone): string {
  return t === 'good' ? C.green : t === 'warn' ? C.amber : t === 'risk' ? C.red
    : t === 'advice' ? C.cyanDark : C.inkSoft
}
function toneMark(t: Tone): string {
  return t === 'good' ? '▲' : t === 'warn' ? '◆' : t === 'risk' ? '▼' : t === 'advice' ? '➜' : '▸'
}

interface Insight { text: string; tone: Tone }

/** Tinted inzicht/advies-paneel met bullets — staat op elke dataslide naast
 *  de cijfers. */
function addInsightBlock(
  slide: PptxGenJS.Slide,
  x: number, y: number, w: number, h: number,
  bullets: Insight[], title = 'Inzicht & advies', fontSize = 9.4,
) {
  addPanel(slide, x, y, w, h, C.tint, C.cyan)
  slide.addText(title.toUpperCase(), {
    x: x + 0.22, y: y + 0.11, w: w - 0.44, h: 0.24,
    fontFace: 'Inter', fontSize: 8.5, bold: true, color: C.cyanDark, charSpacing: 1.5,
  })
  slide.addText(
    bullets.flatMap(b => [
      { text: `${toneMark(b.tone)}  `, options: { color: toneColor(b.tone), bold: true, fontSize } },
      { text: b.text, options: { breakLine: true, color: C.ink, fontSize, paraSpaceAfter: 5, lineSpacingMultiple: 1.13 } },
    ]),
    { x: x + 0.22, y: y + 0.37, w: w - 0.44, h: h - 0.5, fontFace: 'Inter', valign: 'top' },
  )
}

const tableBase = {
  fontFace: 'Inter', fontSize: 10, color: C.ink,
  border: { type: 'solid' as const, color: C.line, pt: 0.5 },
}
function hCell(text: string, align: 'left' | 'right' | 'center' = 'left', color: string = C.navy) {
  return { text, options: { bold: true, color, fill: { color: C.panelAlt }, align, fontSize: 9.5 } }
}

const chartBase = {
  catAxisLabelColor: C.inkSoft, valAxisLabelColor: C.inkSoft,
  catAxisLineColor: C.line, valAxisLineColor: C.line,
  plotArea: { fill: { color: C.panel } },
  valGridLine: { color: C.lineSoft, style: 'solid' as const, size: 0.75 },
}

// ─── Data helpers ───────────────────────────────────────────────────────

function mv(ds: ReportDataset, bv: BvId, month: string, key: string, src: 'actual' | 'budget' | 'le'): number {
  if (src === 'budget') return ds.budget[bv]?.[month]?.[key] ?? 0
  if (src === 'le')     return ds.le[bv]?.[month]?.[key] ?? 0
  return ds.actuals[bv]?.[month]?.[key] ?? 0
}
function mv25(bv: BvId, month: string, key: string): number {
  return monthlyActuals2025[bv as EntityName]?.[month]?.[key] ?? 0
}
function ytd(ds: ReportDataset, bv: BvId, months: string[], key: string, src: 'actual' | 'budget' | 'le'): number {
  return months.reduce((s, m) => s + mv(ds, bv, m, key, src), 0)
}
function ytd25(bv: BvId, months: string[], key: string): number {
  return months.reduce((s, m) => s + mv25(bv, m, key), 0)
}
function fyBudget(ds: ReportDataset, bv: BvId, key: string): number {
  return MONTHS_2026.reduce((s, m) => s + mv(ds, bv, m, key, 'budget'), 0)
}
function fyLe(ds: ReportDataset, bv: BvId, key: string): number {
  return MONTHS_2026.reduce((s, m) => s + mv(ds, bv, m, key, 'le'), 0)
}
function fy2025(bv: BvId, key: string): number {
  return MONTHS_2025.reduce((s, m) => s + mv25(bv, m, key), 0)
}
function ytd2025Eq(ytdMonths: string[]): string[] {
  return ytdMonths.map(m => m.replace('-26', '-25'))
}

/** Uren-helpers — gebruiken de echte geüploade SAP-data; vallen terug op de
 *  seed-dataset als een (bv, maand) niet geüpload is. */
function staticHours(bv: BvId, monthCode: string): HoursRecord | undefined {
  const data = monthCode.endsWith('-25') ? hoursData2025 : hoursData2026
  return data.find(x => x.bv === bv && x.month === monthCode)
}
function declarableMonth(ds: ReportDataset, bv: BvId, monthCode: string): number {
  const h = ds.hours[bv]?.[monthCode]
  if (h) return h.declarable
  return staticHours(bv, monthCode)?.declarable ?? 0
}
function workedMonth(ds: ReportDataset, bv: BvId, monthCode: string): number {
  const h = ds.hours[bv]?.[monthCode]
  if (h) return h.declarable + h.internal
  return staticHours(bv, monthCode)?.written ?? 0
}
function declPctMonth(ds: ReportDataset, bv: BvId, monthCode: string): number | null {
  const w = workedMonth(ds, bv, monthCode)
  return w > 0 ? declarableMonth(ds, bv, monthCode) / w * 100 : null
}
function declPctYtd(ds: ReportDataset, bv: BvId, months: string[]): number {
  const w = months.reduce((s, m) => s + workedMonth(ds, bv, m), 0)
  const d = months.reduce((s, m) => s + declarableMonth(ds, bv, m), 0)
  return w > 0 ? d / w * 100 : 0
}

/** Capaciteitsverdeling in uren — productief / verlof / improductief / ziek —
 *  zelfde methodiek als de Uren-tab (noemer = totale capaciteit incl.
 *  afwezigheid en missing uren). Null als er geen geüploade uren zijn. */
interface CapacitySplit { productive: number; leave: number; nonproductive: number; sick: number; total: number }
function capacitySplit(ds: ReportDataset, bv: BvId, monthCode: string): CapacitySplit | null {
  const h = ds.hours[bv]?.[monthCode]
  if (!h) return null
  const work = h.declarable + h.internal
  const verlof = h.vakantie + h.overigVerlof
  const ziekte = h.ziekte
  const baseCap = staticHours(bv, monthCode)?.capacity ?? 0
  const cap = Math.max(baseCap, work + verlof + ziekte)
  const missing = bv === 'Consultancy' ? Math.max(0, cap - (work + verlof + ziekte)) : 0
  const total = work + verlof + ziekte + missing
  return { productive: h.declarable, leave: verlof, nonproductive: h.internal + missing, sick: ziekte, total }
}
/** Capaciteit-budget% (uit de Budgetten-tab) voor één categorie. 0/leeg = geen budget. */
const CAP_BUDGET_KEY: Record<string, string> = {
  productive: 'capacity_productive_pct', leave: 'capacity_leave_pct',
  nonproductive: 'capacity_nonproductive_pct', sick: 'capacity_sick_pct',
}
function capBudgetPct(ds: ReportDataset, bv: BvId, monthCode: string, cat: string): number | null {
  const v = ds.budget[bv]?.[monthCode]?.[CAP_BUDGET_KEY[cat]]
  return v == null || v === 0 ? null : v
}

// ─── BV-snapshot: alle kerncijfers per BV, één keer berekend ─────────────

interface BvSnapshot {
  bv: BvId
  omzetM: number; budgetM: number
  omzetY: number; budgetY: number; omzetLY: number
  margeY: number; ebitdaY: number
  margePct: number; budgetPct: number; yoyPct: number
  declYtd: number; decl25: number; declDelta: number
  workedY: number; declarableY: number
  leFyO: number; budFyO: number; leVsBudPct: number; leFyEbitda: number
  fy25O: number
}

function bvSnapshot(ds: ReportDataset, bv: BvId, month: string, ytdMonths: string[]): BvSnapshot {
  const y25 = ytd2025Eq(ytdMonths)
  const omzetM  = mv(ds, bv, month, 'netto_omzet', 'actual')
  const budgetM = mv(ds, bv, month, 'netto_omzet', 'budget')
  const omzetY  = ytd(ds, bv, ytdMonths, 'netto_omzet', 'actual')
  const budgetY = ytd(ds, bv, ytdMonths, 'netto_omzet', 'budget')
  const omzetLY = ytd25(bv, y25, 'netto_omzet')
  const margeY  = ytd(ds, bv, ytdMonths, 'brutomarge', 'actual')
  const ebitdaY = ytd(ds, bv, ytdMonths, 'ebitda', 'actual')
  const declYtd = declPctYtd(ds, bv, ytdMonths)
  const decl25  = declPctYtd(ds, bv, y25)
  const leFyO   = fyLe(ds, bv, 'netto_omzet')
  const budFyO  = fyBudget(ds, bv, 'netto_omzet')
  return {
    bv, omzetM, budgetM, omzetY, budgetY, omzetLY, margeY, ebitdaY,
    margePct:  omzetY > 0 ? margeY / omzetY * 100 : 0,
    budgetPct: budgetY > 0 ? (omzetY / budgetY - 1) * 100 : 0,
    yoyPct:    omzetLY > 0 ? (omzetY / omzetLY - 1) * 100 : 0,
    declYtd, decl25, declDelta: declYtd - decl25,
    workedY:     ytdMonths.reduce((s, m) => s + workedMonth(ds, bv, m), 0),
    declarableY: ytdMonths.reduce((s, m) => s + declarableMonth(ds, bv, m), 0),
    leFyO, budFyO,
    leVsBudPct:  budFyO > 0 ? (leFyO / budFyO - 1) * 100 : 0,
    leFyEbitda:  fyLe(ds, bv, 'ebitda'),
    fy25O:       fy2025(bv, 'netto_omzet'),
  }
}

function groupTotals(snaps: BvSnapshot[]) {
  const sum = (f: (s: BvSnapshot) => number) => snaps.reduce((a, s) => a + f(s), 0)
  const omzetY = sum(s => s.omzetY), budgetY = sum(s => s.budgetY), omzetLY = sum(s => s.omzetLY)
  const leFyO = sum(s => s.leFyO), budFyO = sum(s => s.budFyO)
  return {
    omzetY, budgetY, omzetLY,
    margeY: sum(s => s.margeY), ebitdaY: sum(s => s.ebitdaY),
    omzetM: sum(s => s.omzetM), budgetM: sum(s => s.budgetM),
    margePct: omzetY > 0 ? sum(s => s.margeY) / omzetY * 100 : 0,
    budgetPct: budgetY > 0 ? (omzetY / budgetY - 1) * 100 : 0,
    yoyPct: omzetLY > 0 ? (omzetY / omzetLY - 1) * 100 : 0,
    leFyO, budFyO, leVsBudPct: budFyO > 0 ? (leFyO / budFyO - 1) * 100 : 0,
    leFyEbitda: sum(s => s.leFyEbitda),
    workedY: sum(s => s.workedY), declarableY: sum(s => s.declarableY),
  }
}

// ─── Analyse: bevindingen, advies, narratief ─────────────────────────────

interface Finding { severity: 'good' | 'warn' | 'risk'; text: string; advice?: string }

function buildFindings(snaps: BvSnapshot[], month: string, closingEntries: ClosingEntry[], ohwData: OhwYearData) {
  const g = groupTotals(snaps)
  const findings: Finding[] = []
  const advice: string[] = []

  const sorted = [...snaps].sort((a, b) => a.budgetPct - b.budgetPct)
  const worst = sorted[0], best = sorted[sorted.length - 1]

  // Omzet vs budget — met oorzaak-attributie
  if (g.budgetPct <= -2) {
    findings.push({
      severity: 'risk',
      text: `Omzet YTD ${fmtEurK(g.omzetY)} blijft ${fmtPct(g.budgetPct)} achter op budget — een gat van ${fmtEurK(g.omzetY - g.budgetY)}, vooral gedreven door ${worst.bv} (${fmtPct(worst.budgetPct)}).`,
      advice: `Maak voor ${worst.bv} een herstelplan: pijplijn, tarief en bezetting tegen het licht, met een benoemde eigenaar.`,
    })
  } else if (g.budgetPct >= 2) {
    findings.push({ severity: 'good', text: `Omzet YTD ${fmtEurK(g.omzetY)} ligt ${fmtPct(g.budgetPct)} boven budget; ${best.bv} trekt met ${fmtPct(best.budgetPct)} het hardst.` })
  } else {
    findings.push({ severity: 'good', text: `Omzet YTD ${fmtEurK(g.omzetY)} loopt in lijn met budget (${fmtPct(g.budgetPct)}).` })
  }

  // YoY-groei
  if (g.omzetLY > 0) {
    findings.push({
      severity: g.yoyPct >= 0 ? 'good' : 'warn',
      text: `Omzet ${g.yoyPct >= 0 ? 'groeit' : 'daalt'} ${fmtPct(g.yoyPct)} jaar-op-jaar ten opzichte van ${fmtEurK(g.omzetLY)} in 2025.`,
    })
  }

  // EBITDA + marge-verband
  if (g.ebitdaY < 0) {
    findings.push({
      severity: 'risk',
      text: `EBITDA YTD is negatief (${fmtEurK(g.ebitdaY)}) bij een brutomarge van ${g.margePct.toFixed(1)}% — de operationele kostenbasis weegt zwaarder dan de marge draagt.`,
      advice: 'Toets de operationele kosten per BV op overhead en niet-declarabele inzet; stel een kostenplafond tot het jaareinde.',
    })
  } else {
    findings.push({ severity: 'good', text: `EBITDA YTD positief: ${fmtEurK(g.ebitdaY)} bij een brutomarge van ${g.margePct.toFixed(1)}%.` })
  }
  const negEbitda = snaps.filter(s => s.ebitdaY < 0)
  if (negEbitda.length > 0 && g.ebitdaY >= 0) {
    findings.push({
      severity: 'warn',
      text: `Verlieslatend op EBITDA-niveau: ${negEbitda.map(s => s.bv).join(', ')} — een gezonde groep mag dit niet maskeren.`,
      advice: `Stel voor ${negEbitda.map(s => s.bv).join(' en ')} een concreet pad naar break-even op met maandelijkse mijlpalen.`,
    })
  }

  // Declarabiliteit ↔ marge
  const declDrops = snaps.filter(s => s.declDelta <= -1.5)
  if (declDrops.length > 0) {
    const d = declDrops.sort((a, b) => a.declDelta - b.declDelta)[0]
    findings.push({
      severity: 'warn',
      text: `Declarabiliteit ${d.bv} zakt naar ${d.declYtd.toFixed(1)}% (${fmtPpt(d.declDelta)} t.o.v. 2025) — dit drukt de brutomarge van ${d.bv} (${d.margePct.toFixed(1)}%).`,
      advice: `Stuur bij ${d.bv} actief op declarabele inzet: bewaak niet-factureerbare uren en plan capaciteit strak op opdrachten.`,
    })
  }

  // Latest Estimate
  if (g.leVsBudPct <= -3) {
    findings.push({
      severity: 'risk',
      text: `De Latest Estimate komt FY 2026 uit op ${fmtEurK(g.leFyO)} omzet — ${fmtPct(g.leVsBudPct)} onder het jaarbudget (${fmtEurK(g.budFyO)}, gat ${fmtEurK(g.leFyO - g.budFyO)}).`,
      advice: 'Bespreek bijsturing met de directie: commerciële versnelling in H2 óf een herijking van het jaarbudget richting de prognose.',
    })
  } else if (g.leVsBudPct >= 3) {
    findings.push({ severity: 'good', text: `De Latest Estimate (FY ${fmtEurK(g.leFyO)}) ligt ${fmtPct(g.leVsBudPct)} boven jaarbudget — er is ruimte voor ambitie.` })
  } else {
    findings.push({ severity: 'good', text: `De Latest Estimate (FY ${fmtEurK(g.leFyO)}) sluit met ${fmtPct(g.leVsBudPct)} nauw aan op het jaarbudget.` })
  }

  // OHW / werkkapitaal
  const totOhw = ohwData.entities.reduce((s, e) => s + (e.totaalOnderhanden[month] ?? 0), 0)
  const totOhwMut = closingEntries.reduce((s, e) => s + (e.ohwMutatie ?? 0), 0)
  if (totOhw > 0) {
    const heavy = totOhwMut > totOhw * 0.15
    findings.push({
      severity: heavy ? 'warn' : 'good',
      text: `Onderhanden werk staat op ${fmtEurK(totOhw)} (mutatie maand ${fmtSignedEurK(totOhwMut)}) — ${heavy ? 'de werkvoorraad loopt sneller op dan gefactureerd wordt' : 'in een beheerst tempo'}.`,
      advice: heavy ? 'Versnel de facturatie van onderhanden werk; bewaak de doorlooptijd van concept naar definitieve factuur.' : undefined,
    })
  }

  for (const f of findings) if (f.advice && !advice.includes(f.advice)) advice.push(f.advice)
  if (advice.length === 0) advice.push('Prestaties liggen op koers — borg de bezetting en de commerciële pijplijn richting het jaareinde.')

  // Verdict
  let verdict = g.budgetPct >= 2
    ? `Sterke maand: omzet YTD ${fmtEurK(g.omzetY)}, ${fmtPct(g.budgetPct)} boven budget. `
    : g.budgetPct <= -2
      ? `Omzet YTD ${fmtEurK(g.omzetY)} blijft ${fmtPct(g.budgetPct)} achter op budget — bijsturing is nodig. `
      : `Omzet YTD ${fmtEurK(g.omzetY)} loopt in lijn met budget. `
  verdict += g.ebitdaY >= 0
    ? `De brutomarge van ${g.margePct.toFixed(1)}% levert ${fmtEurK(g.ebitdaY)} EBITDA. `
    : `De EBITDA is negatief (${fmtEurK(g.ebitdaY)}) — de kostenkant staat onder druk. `
  verdict += `De Latest Estimate projecteert FY 2026 op ${fmtEurK(g.leFyO)} omzet (${fmtPct(g.leVsBudPct)} vs budget) en ${fmtEurK(g.leFyEbitda)} EBITDA.`

  return { findings, advice: advice.slice(0, 5), verdict }
}

/** Vloeiende CFO-analyse per BV (3-5 zinnen) — legt verbanden tussen omzet,
 *  declarabiliteit, marge en de jaarprognose. Gegarandeerde fallback wanneer
 *  er geen live AI-duiding beschikbaar is. */
function buildBvNarrative(s: BvSnapshot): string {
  const out: string[] = []
  out.push(
    `${s.bv} realiseert YTD ${fmtEurK(s.omzetY)} omzet — ${fmtPct(s.budgetPct)} ${s.budgetPct >= 0 ? 'boven' : 'onder'} budget en ${fmtPct(s.yoyPct)} ${s.yoyPct >= 0 ? 'groei' : 'krimp'} ten opzichte van 2025.`,
  )
  if (s.declDelta <= -1.5) {
    out.push(`De declarabiliteit zakte naar ${s.declYtd.toFixed(1)}% (${fmtPpt(s.declDelta)}); die lagere benutting werkt direct door in een brutomarge van ${s.margePct.toFixed(1)}%.`)
  } else if (s.declDelta >= 1.5) {
    out.push(`Een sterkere declarabiliteit van ${s.declYtd.toFixed(1)}% (${fmtPpt(s.declDelta)}) ondersteunt de brutomarge van ${s.margePct.toFixed(1)}%.`)
  } else {
    out.push(`De declarabiliteit houdt stand op ${s.declYtd.toFixed(1)}%, wat een brutomarge van ${s.margePct.toFixed(1)}% oplevert.`)
  }
  out.push(
    s.ebitdaY >= 0
      ? `Dat vertaalt zich in een positieve EBITDA van ${fmtEurK(s.ebitdaY)}.`
      : `Daardoor blijft de EBITDA negatief (${fmtEurK(s.ebitdaY)}): de operationele kosten worden onvoldoende gedekt.`,
  )
  const richting = s.leVsBudPct <= -3
    ? 'commerciële versnelling is nodig om het jaarbudget te halen'
    : s.leVsBudPct >= 3
      ? 'er is ruimte boven het jaarbudget mits de bezetting op peil blijft'
      : 'de jaardoelstelling ligt binnen bereik bij een gelijkblijvende run-rate'
  out.push(`De Latest Estimate wijst op ${fmtEurK(s.leFyO)} omzet voor heel 2026 (${fmtPct(s.leVsBudPct)} vs budget) en ${fmtEurK(s.leFyEbitda)} EBITDA; ${richting}.`)
  return out.join(' ')
}

// ─── Slide builders ─────────────────────────────────────────────────────

function slideTitle(pptx: PptxGenJS, monthLabel: string, logoB64: string) {
  const slide = pptx.addSlide()
  slide.background = { color: C.page }
  slide.addShape('rect' as const, { x: PAGE_W - 4.6, y: 0, w: 4.6, h: PAGE_H, fill: { color: C.tint } })
  slide.addShape('rect' as const, { x: PAGE_W - 4.6, y: 0, w: 0.07, h: PAGE_H, fill: { color: C.cyan } })
  if (logoB64) {
    slide.addImage({ data: logoB64, x: PAGE_W - 4.0, y: 2.85, w: 3.4, h: 1.3, sizing: { type: 'contain', w: 3.4, h: 1.3 } })
  } else {
    slide.addText('the peoplegroup', {
      x: PAGE_W - 4.4, y: 3.1, w: 4.0, h: 0.8,
      fontFace: 'Inter', fontSize: 28, bold: true, color: C.cyan, align: 'center',
    })
  }
  slide.addShape('rect' as const, { x: 0, y: 0, w: 0.22, h: PAGE_H, fill: { color: C.cyan } })
  slide.addText('TPG BUSINESS CONTROL', {
    x: 0.85, y: 2.2, w: 7.5, h: 0.35,
    fontFace: 'Inter', fontSize: 13, bold: true, color: C.cyan, charSpacing: 3,
  })
  slide.addText('Maandrapportage', {
    x: 0.8, y: 2.6, w: 7.8, h: 0.8,
    fontFace: 'Inter', fontSize: 38, bold: true, color: C.navy,
  })
  slide.addText(monthLabel, {
    x: 0.8, y: 3.4, w: 7.8, h: 1.0,
    fontFace: 'Inter', fontSize: 52, bold: true, color: C.cyan,
  })
  slide.addShape('rect' as const, { x: 0.85, y: 4.55, w: 2.4, h: 0.04, fill: { color: C.cyan } })
  slide.addText(
    `Financiële maandrapportage · per ${new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    { x: 0.85, y: 4.7, w: 7.5, h: 0.4, fontFace: 'Inter', fontSize: 13, color: C.inkSoft },
  )
  slide.addText('Geautomatiseerd gegenereerd vanuit live financiële data · vertrouwelijk', {
    x: 0.85, y: PAGE_H - 0.7, w: 7.5, h: 0.3,
    fontFace: 'Inter', fontSize: 9.5, color: C.inkFaint,
  })
}

function slideToc(pptx: PptxGenJS) {
  const slide = pptx.addSlide()
  slide.background = { color: C.page }
  addSectionHeader(slide, 'Overzicht', 'Inhoudsopgave', 2)
  const items: Array<[string, string[]]> = [
    ['Kern',         ['Managementsamenvatting', 'KPI-dashboard', 'Omzetontwikkeling', 'Marge & EBITDA']],
    ['Vooruitblik',  ['Latest Estimate FY 2026', 'Scenario-bandbreedte']],
    ['Operationeel', ['Declarabiliteit', 'Onderhanden werk', 'Facturatie-pipeline']],
    ['Verdieping',   ['Per business unit + AI-duiding', 'Balansposities', 'Totaaloverzicht & advies']],
  ]
  const colW = (PAGE_W - 2 * MARGIN) / items.length
  items.forEach((col, i) => {
    const cx = MARGIN + i * colW
    addPanel(slide, cx + 0.05, 1.45, colW - 0.25, 4.4, C.panel, C.cyan)
    slide.addText(col[0].toUpperCase(), {
      x: cx + 0.25, y: 1.7, w: colW - 0.5, h: 0.35,
      fontFace: 'Inter', fontSize: 12, bold: true, color: C.cyan, charSpacing: 1.5,
    })
    slide.addText(
      col[1].map((s, idx) => ({
        text: `${idx + 1}.  ${s}`,
        options: { breakLine: true, paraSpaceAfter: 10, color: C.ink, fontSize: 11.5 },
      })),
      { x: cx + 0.25, y: 2.15, w: colW - 0.5, h: 3.5, fontFace: 'Inter', valign: 'top' },
    )
  })
  addFooter(slide)
}

function slideManagementSummary(
  pptx: PptxGenJS, monthLabel: string, month: string, snaps: BvSnapshot[],
  closingEntries: ClosingEntry[], ohwData: OhwYearData,
) {
  const slide = pptx.addSlide()
  slide.background = { color: C.page }
  addSectionHeader(slide, 'Kern', `Managementsamenvatting — ${monthLabel}`, 3)

  const { findings, advice, verdict } = buildFindings(snaps, month, closingEntries, ohwData)

  addPanel(slide, MARGIN, 1.3, PAGE_W - 2 * MARGIN, 1.0, C.tint, C.cyan)
  slide.addText('OORDEEL', {
    x: MARGIN + 0.25, y: 1.4, w: 2, h: 0.25,
    fontFace: 'Inter', fontSize: 9, bold: true, color: C.cyanDark, charSpacing: 1.5,
  })
  slide.addText(verdict, {
    x: MARGIN + 0.25, y: 1.62, w: PAGE_W - 2 * MARGIN - 0.5, h: 0.62,
    fontFace: 'Inter', fontSize: 11.5, color: C.navy, valign: 'top', lineSpacingMultiple: 1.15,
  })

  const colW = (PAGE_W - 2 * MARGIN - 0.3) / 2
  slide.addText('Belangrijkste bevindingen & afwijkingen', {
    x: MARGIN, y: 2.55, w: colW, h: 0.32,
    fontFace: 'Inter', fontSize: 12.5, bold: true, color: C.navy,
  })
  slide.addText(
    findings.slice(0, 7).flatMap(f => [
      { text: `${f.severity === 'good' ? '▲' : f.severity === 'warn' ? '◆' : '▼'}  `,
        options: { color: f.severity === 'good' ? C.green : f.severity === 'warn' ? C.amber : C.red, bold: true, fontSize: 10.2 } },
      { text: f.text, options: { breakLine: true, color: C.ink, fontSize: 10.2, paraSpaceAfter: 7, lineSpacingMultiple: 1.1 } },
    ]),
    { x: MARGIN, y: 2.9, w: colW, h: 3.7, fontFace: 'Inter', valign: 'top' },
  )

  const ax = MARGIN + colW + 0.3
  addPanel(slide, ax, 2.55, colW, 4.05, C.panel, C.green)
  slide.addText('Aanbevelingen', {
    x: ax + 0.25, y: 2.7, w: colW - 0.5, h: 0.32,
    fontFace: 'Inter', fontSize: 12.5, bold: true, color: C.navy,
  })
  slide.addText(
    advice.flatMap((a, i) => [
      { text: `${i + 1}.  `, options: { color: C.cyanDark, bold: true, fontSize: 10.2 } },
      { text: a, options: { breakLine: true, color: C.ink, fontSize: 10.2, paraSpaceAfter: 9, lineSpacingMultiple: 1.12 } },
    ]),
    { x: ax + 0.25, y: 3.08, w: colW - 0.5, h: 3.4, fontFace: 'Inter', valign: 'top' },
  )
  addFooter(slide, monthLabel)
}

function slideKpiDashboard(
  pptx: PptxGenJS, monthLabel: string, month: string,
  snaps: BvSnapshot[], closingEntries: ClosingEntry[],
) {
  const slide = pptx.addSlide()
  slide.background = { color: C.page }
  addSectionHeader(slide, 'Kern', `KPI-dashboard — ${monthLabel}`, 4)

  const g = groupTotals(snaps)
  const declPct = g.workedY > 0 ? g.declarableY / g.workedY * 100 : 0
  const facturenM = closingEntries.reduce((s, e) => s + (e.factuurvolume ?? 0), 0)
  const budgetGap = g.omzetY - g.budgetY

  const cw = (PAGE_W - 2 * MARGIN - 3 * 0.22) / 4
  const ch = 1.2
  const r1 = 1.3
  addKpiCard(slide, MARGIN + 0 * (cw + 0.22), r1, cw, ch, `Omzet ${monthLabel}`, fmtEurK(g.omzetM),
    `vs budget ${fmtSignedEurK(g.omzetM - g.budgetM)}`, C.cyan, deltaColor(g.omzetM - g.budgetM))
  addKpiCard(slide, MARGIN + 1 * (cw + 0.22), r1, cw, ch, 'Omzet YTD', fmtEurK(g.omzetY),
    `${fmtPct(g.budgetPct)} vs budget · ${fmtPct(g.yoyPct)} YoY`, C.cyan, deltaColor(g.budgetPct))
  addKpiCard(slide, MARGIN + 2 * (cw + 0.22), r1, cw, ch, 'Brutomarge YTD', fmtEurK(g.margeY),
    `${g.margePct.toFixed(1)}% marge op omzet`, g.margeY >= 0 ? C.green : C.red)
  addKpiCard(slide, MARGIN + 3 * (cw + 0.22), r1, cw, ch, 'EBITDA YTD', fmtEurK(g.ebitdaY),
    g.ebitdaY >= 0 ? 'positief resultaat' : 'verlieslatend', g.ebitdaY >= 0 ? C.green : C.red)

  const r2 = r1 + ch + 0.2
  addKpiCard(slide, MARGIN + 0 * (cw + 0.22), r2, cw, ch, 'Declarabiliteit YTD', `${declPct.toFixed(1)}%`,
    `${Math.round(g.declarableY).toLocaleString('nl-NL')} declarabele uren`, C.amber)
  addKpiCard(slide, MARGIN + 1 * (cw + 0.22), r2, cw, ch, 'Latest Estimate FY', fmtEurK(g.leFyO),
    `${fmtPct(g.leVsBudPct)} vs jaarbudget`, C.purple, deltaColor(g.leVsBudPct))
  addKpiCard(slide, MARGIN + 2 * (cw + 0.22), r2, cw, ch, `Factuurvolume ${monthLabel}`, fmtEurK(facturenM),
    'gerapporteerd in afsluiting', C.cyanDark)
  addKpiCard(slide, MARGIN + 3 * (cw + 0.22), r2, cw, ch, 'Δ vs budget YTD', fmtSignedEurK(budgetGap),
    budgetGap >= 0 ? 'voor op plan' : 'achter op plan', deltaColor(budgetGap))

  // Per-BV tabel (links) + inzicht (rechts)
  const r3 = r2 + ch + 0.25
  const tblW = 7.55
  slide.addText('Per business unit — YTD', {
    x: MARGIN, y: r3, w: tblW, h: 0.3, fontFace: 'Inter', fontSize: 11.5, bold: true, color: C.navy,
  })
  const rows: PptxGenJS.TableRow[] = [[
    hCell('Business unit'), hCell('Omzet YTD', 'right'), hCell('Δ budget', 'right'),
    hCell('YoY', 'right'), hCell('Marge %', 'right'), hCell('EBITDA', 'right'),
  ]]
  for (const s of snaps) {
    rows.push([
      { text: s.bv, options: { bold: true, color: BV_COLOR[s.bv as EntityName] } },
      { text: fmtEur(s.omzetY), options: { align: 'right', color: C.ink } },
      { text: fmtSignedEurK(s.omzetY - s.budgetY), options: { align: 'right', bold: true, color: deltaColor(s.omzetY - s.budgetY) } },
      { text: fmtPct(s.yoyPct), options: { align: 'right', color: deltaColor(s.yoyPct) } },
      { text: `${s.margePct.toFixed(1)}%`, options: { align: 'right', color: C.ink } },
      { text: fmtEur(s.ebitdaY), options: { align: 'right', bold: true, color: s.ebitdaY >= 0 ? C.green : C.red } },
    ])
  }
  slide.addTable(rows, { x: MARGIN, y: r3 + 0.35, w: tblW, rowH: 0.4, ...tableBase })

  // Inzicht
  const sorted = [...snaps].sort((a, b) => b.omzetY - a.omzetY)
  const leader = sorted[0]
  const share = g.omzetY > 0 ? leader.omzetY / g.omzetY * 100 : 0
  const fastest = [...snaps].sort((a, b) => b.yoyPct - a.yoyPct)[0]
  const ins: Insight[] = [
    { tone: 'plain', text: `${leader.bv} is de grootste BV met ${share.toFixed(0)}% van de YTD-omzet; ${fastest.bv} groeit het hardst (${fmtPct(fastest.yoyPct)} YoY).` },
    { tone: budgetGap >= 0 ? 'good' : 'risk', text: `De groep staat ${fmtSignedEurK(budgetGap)} ${budgetGap >= 0 ? 'voor' : 'achter'} op budget bij een marge van ${g.margePct.toFixed(1)}%.` },
    { tone: g.leVsBudPct < -2 ? 'risk' : 'advice',
      text: g.leVsBudPct < -2
        ? `Bij gelijke run-rate komt de prognose ${fmtEurK(g.leFyO - g.budFyO)} onder budget — stuur nu bij.`
        : `De prognose (${fmtEurK(g.leFyO)}) bevestigt het jaarbudget; borg de bezetting in H2.` },
  ]
  addInsightBlock(slide, MARGIN + tblW + 0.25, r3, PAGE_W - 2 * MARGIN - tblW - 0.25, 2.0, ins)
  addFooter(slide, monthLabel)
}

function slideOmzetTrend(
  pptx: PptxGenJS, monthLabel: string, ds: ReportDataset, snaps: BvSnapshot[], ytdMonths: string[], num: number,
) {
  const slide = pptx.addSlide()
  slide.background = { color: C.page }
  addSectionHeader(slide, 'Kern', 'Omzetontwikkeling — 2025 · 2026 · Latest Estimate', num)

  const labels = MONTH_LABELS_SHORT
  const lastIdx = ytdMonths.length > 0 ? MONTHS_2026.indexOf(ytdMonths[ytdMonths.length - 1]) : -1
  const tot2025 = MONTHS_2026.map((_, i) => BVS.reduce((s, bv) => s + mv25(bv, MONTHS_2025[i], 'netto_omzet'), 0) / 1000)
  const totBudget = MONTHS_2026.map(m => BVS.reduce((s, bv) => s + mv(ds, bv, m, 'netto_omzet', 'budget'), 0) / 1000)
  const totLe = MONTHS_2026.map(m => BVS.reduce((s, bv) => s + mv(ds, bv, m, 'netto_omzet', 'le'), 0) / 1000)
  const cutoff = lastIdx >= 0 ? MONTH_LABELS_SHORT[lastIdx] : ''

  slide.addChart(pptx.ChartType.line, [
    { name: 'Actuals 2025', labels, values: tot2025 },
    { name: 'Budget 2026', labels, values: totBudget },
    { name: `Actuals 2026 (t/m ${cutoff}) + Latest Estimate`, labels, values: totLe },
  ], {
    x: MARGIN, y: 1.32, w: PAGE_W - 2 * MARGIN, h: 3.35,
    chartColors: [C.inkFaint, C.amber, C.cyan],
    lineSize: 2.5, lineDataSymbolSize: 6,
    catAxisLabelFontSize: 10, valAxisLabelFontSize: 9, valAxisLabelFormatCode: '#,##0" k"',
    showLegend: true, legendPos: 'b', legendColor: C.inkSoft, legendFontSize: 9,
    ...chartBase,
  })

  // Tabel (links) + inzicht (rechts)
  const tblW = 7.55
  const rows: PptxGenJS.TableRow[] = [[
    hCell('BV'), hCell('YTD 2026', 'right'), hCell('YoY', 'right'),
    hCell('LE FY', 'right'), hCell('Budget FY', 'right'), hCell('Δ LE-budget', 'right'),
  ]]
  for (const s of snaps) {
    rows.push([
      { text: s.bv, options: { bold: true, color: BV_COLOR[s.bv as EntityName] } },
      { text: fmtEur(s.omzetY), options: { align: 'right', color: C.ink } },
      { text: fmtPct(s.yoyPct), options: { align: 'right', color: deltaColor(s.yoyPct) } },
      { text: fmtEur(s.leFyO), options: { align: 'right', bold: true, color: C.cyan } },
      { text: fmtEur(s.budFyO), options: { align: 'right', color: C.inkSoft } },
      { text: fmtSignedEurK(s.leFyO - s.budFyO), options: { align: 'right', bold: true, color: deltaColor(s.leFyO - s.budFyO) } },
    ])
  }
  slide.addText('Prognose per BV', {
    x: MARGIN, y: 4.85, w: tblW, h: 0.3, fontFace: 'Inter', fontSize: 11, bold: true, color: C.navy,
  })
  slide.addTable(rows, { x: MARGIN, y: 5.2, w: tblW, rowH: 0.36, ...tableBase })

  const h1 = totLe.slice(0, 6).reduce((a, b) => a + b, 0)
  const h2 = totLe.slice(6).reduce((a, b) => a + b, 0)
  const fastest = [...snaps].sort((a, b) => b.yoyPct - a.yoyPct)[0]
  const laggard = [...snaps].sort((a, b) => a.leVsBudPct - b.leVsBudPct)[0]
  const ins: Insight[] = [
    { tone: 'plain', text: `De omzetlijn volgt 2026 t/m ${cutoff} als gerealiseerd; daarna toont de cyaan lijn de Latest Estimate per maand.` },
    { tone: h2 >= h1 ? 'good' : 'warn', text: `H2 ${h2 >= h1 ? 'versnelt' : 'vertraagt'} t.o.v. H1 (${fmtEurK(h2 * 1000)} vs ${fmtEurK(h1 * 1000)}) — ${h2 >= h1 ? 'het seizoenspatroon werkt mee' : 'let op de zomerdip'}.` },
    { tone: 'advice', text: `${fastest.bv} trekt de groei (${fmtPct(fastest.yoyPct)} YoY); ${laggard.bv} blijft met ${fmtPct(laggard.leVsBudPct)} het verst onder budget — daar ligt de grootste hefboom.` },
  ]
  addInsightBlock(slide, MARGIN + tblW + 0.25, 4.85, PAGE_W - 2 * MARGIN - tblW - 0.25, 1.85, ins)
  addFooter(slide, monthLabel)
}

function slideMargeTrend(
  pptx: PptxGenJS, monthLabel: string, ds: ReportDataset, snaps: BvSnapshot[], ytdMonths: string[], num: number,
) {
  const slide = pptx.addSlide()
  slide.background = { color: C.page }
  addSectionHeader(slide, 'Kern', 'Marge & EBITDA-ontwikkeling — 2025 vs 2026', num)

  const labels = [
    ...MONTHS_2025.map((_, i) => MONTH_LABELS_SHORT[i] + ' 25'),
    ...ytdMonths.map(m => MONTH_LABELS_SHORT[MONTHS_2026.indexOf(m)] + ' 26'),
  ]
  const seriesFor = (key: string) => BVS.map(bv => ({
    name: bv, labels,
    values: [
      ...MONTHS_2025.map(m => mv25(bv, m, key) / 1000),
      ...ytdMonths.map(m => mv(ds, bv, m, key, 'actual') / 1000),
    ],
  }))

  slide.addText('Brutomarge per BV (€k)', {
    x: MARGIN, y: 1.28, w: 6, h: 0.3, fontFace: 'Inter', fontSize: 11, bold: true, color: C.navy,
  })
  slide.addChart(pptx.ChartType.line, seriesFor('brutomarge'), {
    x: MARGIN, y: 1.58, w: 6.15, h: 2.75,
    chartColors: BVS.map(bv => BV_COLOR[bv as EntityName]),
    lineSize: 2.5, lineDataSymbolSize: 5,
    catAxisLabelFontSize: 7, catAxisLabelRotate: -45, valAxisLabelFontSize: 9, valAxisLabelFormatCode: '#,##0" k"',
    showLegend: true, legendPos: 'b', legendColor: C.inkSoft, legendFontSize: 9,
    ...chartBase,
  })
  slide.addText('EBITDA per BV (€k)', {
    x: 7.0, y: 1.28, w: 6, h: 0.3, fontFace: 'Inter', fontSize: 11, bold: true, color: C.navy,
  })
  slide.addChart(pptx.ChartType.line, seriesFor('ebitda'), {
    x: 7.0, y: 1.58, w: 5.75, h: 2.75,
    chartColors: BVS.map(bv => BV_COLOR[bv as EntityName]),
    lineSize: 2.5, lineDataSymbolSize: 5,
    catAxisLabelFontSize: 7, catAxisLabelRotate: -45, valAxisLabelFontSize: 9, valAxisLabelFormatCode: '#,##0" k"',
    showLegend: true, legendPos: 'b', legendColor: C.inkSoft, legendFontSize: 9,
    ...chartBase,
  })

  // Tabel (links) + inzicht (rechts)
  const y25 = ytd2025Eq(ytdMonths)
  const tblW = 7.55
  const rows: PptxGenJS.TableRow[] = [[
    hCell('BV'), hCell('Marge 26', 'right'), hCell('Marge %', 'right'),
    hCell('EBITDA 26', 'right'), hCell('EBITDA 25', 'right'), hCell('Δ EBITDA', 'right'),
  ]]
  for (const s of snaps) {
    const e25 = ytd25(s.bv, y25, 'ebitda')
    rows.push([
      { text: s.bv, options: { bold: true, color: BV_COLOR[s.bv as EntityName] } },
      { text: fmtEur(s.margeY), options: { align: 'right', color: C.ink } },
      { text: `${s.margePct.toFixed(1)}%`, options: { align: 'right', bold: true, color: C.ink } },
      { text: fmtEur(s.ebitdaY), options: { align: 'right', bold: true, color: s.ebitdaY >= 0 ? C.green : C.red } },
      { text: fmtEur(e25), options: { align: 'right', color: C.inkSoft } },
      { text: fmtSignedEurK(s.ebitdaY - e25), options: { align: 'right', bold: true, color: deltaColor(s.ebitdaY - e25) } },
    ])
  }
  slide.addText('Marge & EBITDA per BV — YTD', {
    x: MARGIN, y: 4.5, w: tblW, h: 0.3, fontFace: 'Inter', fontSize: 11, bold: true, color: C.navy,
  })
  slide.addTable(rows, { x: MARGIN, y: 4.85, w: tblW, rowH: 0.36, ...tableBase })

  const g = groupTotals(snaps)
  const weakest = [...snaps].sort((a, b) => a.margePct - b.margePct)[0]
  const declLink = snaps.filter(s => s.declDelta <= -1.5)
  const ins: Insight[] = [
    { tone: g.margePct >= 25 ? 'good' : 'warn', text: `De groepsmarge staat op ${g.margePct.toFixed(1)}%; ${weakest.bv} is met ${weakest.margePct.toFixed(1)}% de zwakste schakel.` },
    declLink.length > 0
      ? { tone: 'risk', text: `De margedruk bij ${declLink.map(s => s.bv).join(', ')} loopt parallel met een dalende declarabiliteit — kosten staan vast, omzet per uur niet.` }
      : { tone: 'good', text: `De marge wordt gedragen door een stabiele declarabiliteit; geen structurele erosie zichtbaar.` },
    { tone: 'advice', text: `Bewaak de directe kosten als % van de omzet: een margeherstel van 1 ppt is op groepsniveau ${fmtEurK(g.omzetY * 0.01)} EBITDA.` },
  ]
  addInsightBlock(slide, MARGIN + tblW + 0.25, 4.5, PAGE_W - 2 * MARGIN - tblW - 0.25, 2.05, ins)
  addFooter(slide, monthLabel)
}

function slideLatestEstimate(
  pptx: PptxGenJS, monthLabel: string, ds: ReportDataset, snaps: BvSnapshot[], ytdMonths: string[], num: number,
) {
  const slide = pptx.addSlide()
  slide.background = { color: C.page }
  addSectionHeader(slide, 'Vooruitblik', 'Latest Estimate — prognose FY 2026', num)

  const leVals = snaps.map(s => s.leFyO / 1000)
  const budVals = snaps.map(s => s.budFyO / 1000)
  const lyVals = snaps.map(s => s.fy25O / 1000)

  slide.addText('Omzet FY 2026 per BV — Latest Estimate vs budget vs 2025 (€k)', {
    x: MARGIN, y: 1.28, w: 7, h: 0.3, fontFace: 'Inter', fontSize: 11, bold: true, color: C.navy,
  })
  slide.addChart(pptx.ChartType.bar, [
    { name: 'Actuals 2025', labels: BVS, values: lyVals },
    { name: 'Budget 2026', labels: BVS, values: budVals },
    { name: 'Latest Estimate 2026', labels: BVS, values: leVals },
  ], {
    x: MARGIN, y: 1.58, w: 7.3, h: 3.0,
    barDir: 'col', barGrouping: 'clustered',
    chartColors: [C.inkFaint, C.amber, C.cyan],
    showValue: true, dataLabelFontSize: 8, dataLabelColor: C.ink, dataLabelFormatCode: '#,##0" k"',
    catAxisLabelFontSize: 10, valAxisLabelFontSize: 9, valAxisLabelFormatCode: '#,##0" k"',
    showLegend: true, legendPos: 'b', legendColor: C.inkSoft, legendFontSize: 9,
    ...chartBase,
  })

  const rows: PptxGenJS.TableRow[] = [[
    hCell('BV'), hCell('LE omzet', 'right'), hCell('Budget', 'right'),
    hCell('Δ', 'right'), hCell('LE EBITDA', 'right'),
  ]]
  let leTot = 0, budTot = 0, leEbTot = 0
  for (const s of snaps) {
    leTot += s.leFyO; budTot += s.budFyO; leEbTot += s.leFyEbitda
    const d = s.leFyO - s.budFyO
    rows.push([
      { text: s.bv, options: { bold: true, color: BV_COLOR[s.bv as EntityName] } },
      { text: fmtEurK(s.leFyO), options: { align: 'right', bold: true, color: C.cyan } },
      { text: fmtEurK(s.budFyO), options: { align: 'right', color: C.inkSoft } },
      { text: fmtPct(s.budFyO > 0 ? d / s.budFyO * 100 : 0), options: { align: 'right', bold: true, color: deltaColor(d) } },
      { text: fmtEurK(s.leFyEbitda), options: { align: 'right', bold: true, color: s.leFyEbitda >= 0 ? C.green : C.red } },
    ])
  }
  rows.push([
    { text: 'Totaal', options: { bold: true, color: C.navy, fill: { color: C.panelAlt } } },
    { text: fmtEurK(leTot), options: { align: 'right', bold: true, color: C.navy, fill: { color: C.panelAlt } } },
    { text: fmtEurK(budTot), options: { align: 'right', bold: true, color: C.navy, fill: { color: C.panelAlt } } },
    { text: fmtPct(budTot > 0 ? (leTot - budTot) / budTot * 100 : 0), options: { align: 'right', bold: true, color: deltaColor(leTot - budTot), fill: { color: C.panelAlt } } },
    { text: fmtEurK(leEbTot), options: { align: 'right', bold: true, color: leEbTot >= 0 ? C.green : C.red, fill: { color: C.panelAlt } } },
  ])
  slide.addTable(rows, {
    x: 8.15, y: 1.58, w: 4.6, rowH: 0.42, ...tableBase, fontSize: 9.5,
    colW: [1.1, 0.95, 0.95, 0.7, 0.9],
  })

  const n = Math.max(1, ytdMonths.length)
  const ytdTot = snaps.reduce((s, x) => s + x.omzetY, 0)
  const conservatief = ytdTot * (12 / n)
  const optimistisch = leTot * 1.05
  slide.addText('Scenario-bandbreedte FY 2026 (totale omzet)', {
    x: 8.15, y: 3.8, w: 4.6, h: 0.3, fontFace: 'Inter', fontSize: 10.5, bold: true, color: C.navy,
  })
  const scen: PptxGenJS.TableRow[] = [
    [{ text: 'Conservatief (lineaire run-rate)', options: { color: C.ink, fontSize: 9 } },
     { text: fmtEurK(conservatief), options: { align: 'right', bold: true, color: C.amber, fontSize: 9 } }],
    [{ text: 'Latest Estimate (driver-based)', options: { color: C.ink, fontSize: 9 } },
     { text: fmtEurK(leTot), options: { align: 'right', bold: true, color: C.cyan, fontSize: 9 } }],
    [{ text: 'Optimistisch (LE + 5% volume)', options: { color: C.ink, fontSize: 9 } },
     { text: fmtEurK(optimistisch), options: { align: 'right', bold: true, color: C.green, fontSize: 9 } }],
  ]
  slide.addTable(scen, { x: 8.15, y: 4.1, w: 4.6, rowH: 0.3, ...tableBase })

  const leVsBud = budTot > 0 ? (leTot - budTot) / budTot * 100 : 0
  const worst = [...snaps].sort((a, b) => a.leVsBudPct - b.leVsBudPct)[0]
  const ins: Insight[] = [
    { tone: 'plain', text: 'De Latest Estimate komt uit de driver-engine: gerealiseerde maanden + forecast op bezetting, declarabiliteit, tarief en seizoen — identiek aan de Budgetten-tab.' },
    leVsBud <= -3
      ? { tone: 'risk', text: `De prognose ligt ${fmtEurK(leTot - budTot)} (${fmtPct(leVsBud)}) onder budget; ${worst.bv} draagt het grootste deel van het gat.` }
      : leVsBud >= 3
        ? { tone: 'good', text: `De prognose ligt ${fmtEurK(leTot - budTot)} boven budget — ruimte mits de bezetting wordt vastgehouden.` }
        : { tone: 'good', text: `De prognose sluit met ${fmtPct(leVsBud)} nauw aan op het jaarbudget; de doelstelling is haalbaar.` },
    { tone: 'advice', text: `De bandbreedte conservatief–optimistisch is ${fmtEurK(conservatief)} – ${fmtEurK(optimistisch)}; stuur maandelijks bij op het verschil tussen LE en realisatie.` },
  ]
  addInsightBlock(slide, MARGIN, 4.95, PAGE_W - 2 * MARGIN, 1.7, ins)
  addFooter(slide, monthLabel)
}

function slideDeclarabiliteit(
  pptx: PptxGenJS, monthLabel: string, ds: ReportDataset, snaps: BvSnapshot[], ytdMonths: string[], num: number,
) {
  const slide = pptx.addSlide()
  slide.background = { color: C.page }
  addSectionHeader(slide, 'Operationeel', 'Declarabiliteit & capaciteitsbenutting', num)

  const reportMonth = ytdMonths[ytdMonths.length - 1] ?? MONTHS_2026[0]
  const rmShort = MONTH_LABELS_SHORT[MONTHS_2026.indexOf(reportMonth)] ?? reportMonth

  // ── Lijngrafiek: declarabiliteit % per BV, alleen 2026 t/m de afgesloten maand
  const labels = ytdMonths.map(m => MONTH_LABELS_SHORT[MONTHS_2026.indexOf(m)] ?? m)
  const series = BVS.map(bv => ({
    name: bv,
    labels,
    values: ytdMonths.map(m => declPctMonth(ds, bv, m) ?? 0),
  }))
  slide.addText(`Declarabiliteit % per BV — gefactureerde / gewerkte uren · 2026 t/m ${monthLabel}`, {
    x: MARGIN, y: 1.26, w: PAGE_W - 2 * MARGIN, h: 0.3, fontFace: 'Inter', fontSize: 11, bold: true, color: C.navy,
  })
  slide.addChart(pptx.ChartType.line, series, {
    x: MARGIN, y: 1.56, w: PAGE_W - 2 * MARGIN, h: 2.2,
    chartColors: BVS.map(bv => BV_COLOR[bv as EntityName]),
    lineSize: 2.75, lineDataSymbolSize: 6,
    catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, valAxisLabelFormatCode: '0"%"',
    valAxisMinVal: 50, valAxisMaxVal: 100,
    showLegend: true, legendPos: 'b', legendColor: C.inkSoft, legendFontSize: 10,
    showValue: true, dataLabelFontSize: 8, dataLabelColor: C.inkSoft, dataLabelFormatCode: '0"%"',
    ...chartBase,
  })

  // ── Capaciteitsverdeling — actual vs budget, maand + YTD ──
  const cats = [
    { key: 'productive',    label: 'Productief (declarabel)', higherIsBetter: true },
    { key: 'nonproductive', label: 'Improductief / intern',   higherIsBetter: false },
    { key: 'leave',         label: 'Verlof',                  higherIsBetter: false },
    { key: 'sick',          label: 'Ziekte',                  higherIsBetter: false },
  ] as const
  const periodCapacity = (months: string[]) => {
    const agg: Record<string, number> = { productive: 0, leave: 0, nonproductive: 0, sick: 0, total: 0 }
    const bw: Record<string, { sum: number; w: number }> = {
      productive: { sum: 0, w: 0 }, leave: { sum: 0, w: 0 }, nonproductive: { sum: 0, w: 0 }, sick: { sum: 0, w: 0 },
    }
    for (const bv of BVS) for (const m of months) {
      const cs = capacitySplit(ds, bv, m)
      if (!cs || cs.total <= 0) continue
      agg.productive += cs.productive; agg.leave += cs.leave
      agg.nonproductive += cs.nonproductive; agg.sick += cs.sick; agg.total += cs.total
      for (const c of ['productive', 'leave', 'nonproductive', 'sick']) {
        const b = capBudgetPct(ds, bv, m, c)
        if (b != null) { bw[c].sum += b * cs.total; bw[c].w += cs.total }
      }
    }
    return { agg, bw }
  }
  const mCap = periodCapacity([reportMonth])
  const yCap = periodCapacity(ytdMonths)
  const actPct = (cap: ReturnType<typeof periodCapacity>, c: string) =>
    cap.agg.total > 0 ? cap.agg[c] / cap.agg.total * 100 : null
  const budPct = (cap: ReturnType<typeof periodCapacity>, c: string) =>
    cap.bw[c].w > 0 ? cap.bw[c].sum / cap.bw[c].w : null
  const fmtP = (v: number | null) => v == null ? '—' : v.toFixed(1) + '%'
  const dCol = (higher: boolean, d: number | null) =>
    d == null ? C.inkSoft : deltaColor(higher ? d : -d)

  const tblW = 7.65
  const rows: PptxGenJS.TableRow[] = [[
    hCell('Capaciteit'), hCell(rmShort, 'right'), hCell('Budget', 'right'), hCell('Δ', 'right'),
    hCell('YTD', 'right'), hCell('Budget', 'right'), hCell('Δ', 'right'),
  ]]
  for (const cat of cats) {
    const ma = actPct(mCap, cat.key), mb = budPct(mCap, cat.key)
    const ya = actPct(yCap, cat.key), yb = budPct(yCap, cat.key)
    const md = ma != null && mb != null ? ma - mb : null
    const yd = ya != null && yb != null ? ya - yb : null
    rows.push([
      { text: cat.label, options: { bold: true, color: C.navy } },
      { text: fmtP(ma), options: { align: 'right', bold: true, color: C.ink } },
      { text: fmtP(mb), options: { align: 'right', color: C.inkSoft } },
      { text: md == null ? '—' : fmtPpt(md), options: { align: 'right', bold: true, color: dCol(cat.higherIsBetter, md) } },
      { text: fmtP(ya), options: { align: 'right', bold: true, color: C.ink } },
      { text: fmtP(yb), options: { align: 'right', color: C.inkSoft } },
      { text: yd == null ? '—' : fmtPpt(yd), options: { align: 'right', bold: true, color: dCol(cat.higherIsBetter, yd) } },
    ])
  }
  slide.addText('Capaciteitsverdeling — actual vs budget (% van totale capaciteit)', {
    x: MARGIN, y: 3.95, w: tblW, h: 0.3, fontFace: 'Inter', fontSize: 11, bold: true, color: C.navy,
  })
  slide.addTable(rows, { x: MARGIN, y: 4.27, w: tblW, rowH: 0.44, ...tableBase, fontSize: 9.5 })

  // ── Inzicht ──
  const declList = BVS.map(bv => {
    const s = snaps.find(x => x.bv === bv)!
    return `${bv} ${s.declYtd.toFixed(0)}%`
  }).join(' · ')
  const sickY = actPct(yCap, 'sick'), sickBud = budPct(yCap, 'sick')
  const prodY = actPct(yCap, 'productive'), prodBud = budPct(yCap, 'productive')
  const ins: Insight[] = [
    { tone: 'plain', text: `Declarabiliteit YTD per BV: ${declList}. De spreiding verklaart een groot deel van het margeverschil tussen de BV's.` },
  ]
  if (sickY != null) {
    ins.push(sickBud != null && sickY > sickBud + 0.5
      ? { tone: 'warn', text: `Ziekteverzuim YTD ${sickY.toFixed(1)}% ligt boven het budget van ${sickBud.toFixed(1)}% — dit kost direct declarabele capaciteit.` }
      : { tone: 'good', text: `Ziekteverzuim YTD ${sickY.toFixed(1)}%${sickBud != null ? ` (budget ${sickBud.toFixed(1)}%)` : ''} blijft beheersbaar.` })
  }
  if (prodY != null && prodBud != null) {
    ins.push(prodY < prodBud - 0.5
      ? { tone: 'risk', text: `De productieve inzet (${prodY.toFixed(1)}%) blijft ${fmtPpt(prodY - prodBud)} achter op budget — elke ppt is omzet die in de marge zou vallen.` }
      : { tone: 'good', text: `De productieve inzet (${prodY.toFixed(1)}%) ligt op of boven budget — de capaciteit wordt goed benut.` })
  }
  ins.push({ tone: 'advice', text: 'Stuur op verlof- en ziektepatronen én op tijdige bemensing van opdrachten; dat tilt de declarabele benutting het snelst.' })
  addInsightBlock(slide, MARGIN + tblW + 0.25, 3.95, PAGE_W - 2 * MARGIN - tblW - 0.25, 2.4, ins.slice(0, 4))
  addFooter(slide, monthLabel)
}

function slideOhwStatus(pptx: PptxGenJS, monthLabel: string, month: string, ohwData: OhwYearData, num: number) {
  const slide = pptx.addSlide()
  slide.background = { color: C.page }
  addSectionHeader(slide, 'Operationeel', 'Onderhanden werk — status & mutaties', num)

  const entities = ohwData.entities
  // Venster van ~12 maanden dat eindigt op de gerapporteerde maand (geen
  // toekomstige maanden meenemen) — bv. apr-25 t/m apr-26.
  const allMonths = ohwData.displayMonths
  const monthIdx = allMonths.indexOf(month)
  const showMonths = monthIdx >= 0
    ? allMonths.slice(Math.max(0, monthIdx - 12), monthIdx + 1)
    : allMonths.slice(-13)
  const rangeLabel = showMonths.length > 0
    ? `${showMonths[0]} t/m ${showMonths[showMonths.length - 1]}`
    : ''

  slide.addText(`OHW-saldo per BV — ${rangeLabel} (€k)`, {
    x: MARGIN, y: 1.28, w: PAGE_W - 2 * MARGIN, h: 0.3, fontFace: 'Inter', fontSize: 11, bold: true, color: C.navy,
  })
  slide.addChart(pptx.ChartType.line, entities.map(e => ({
    name: e.entity,
    labels: showMonths,
    values: showMonths.map(m => (e.totaalOnderhanden[m] ?? 0) / 1000),
  })), {
    x: MARGIN, y: 1.58, w: PAGE_W - 2 * MARGIN, h: 2.5,
    chartColors: entities.map(e => BV_COLOR[e.entity as EntityName] ?? C.cyan),
    lineSize: 3, lineDataSymbolSize: 6,
    catAxisLabelFontSize: 9, catAxisLabelRotate: -30, valAxisLabelFontSize: 9, valAxisLabelFormatCode: '#,##0" k"',
    showLegend: true, legendPos: 'b', legendColor: C.inkSoft, legendFontSize: 10,
    ...chartBase,
  })

  const tblW = 7.55
  const rows: PptxGenJS.TableRow[] = [[
    hCell('BV'), hCell(`OHW ${month}`, 'right'), hCell('Mutatie maand', 'right'),
    hCell('Status'), hCell('Debiteuren', 'right'),
  ]]
  let tot = 0, totDeb = 0
  for (const e of entities) {
    const cur = e.totaalOnderhanden[month] ?? 0
    const deb = e.debiteuren[month] ?? 0
    tot += cur; totDeb += deb
    const idx = showMonths.indexOf(month)
    const prev = idx > 0 ? (e.totaalOnderhanden[showMonths[idx - 1]] ?? 0) : 0
    const delta = cur - prev
    let status = '● Stabiel'
    let sColor: string = C.green
    if (cur !== 0 && Math.abs(delta) > Math.abs(cur) * 0.2) {
      status = delta > 0 ? '▲ Sterke opbouw' : '▼ Sterke afname'
      sColor = delta > 0 ? C.amber : C.cyan
    } else if (cur > 1_000_000) {
      status = '◆ Hoog saldo'
      sColor = C.amber
    }
    rows.push([
      { text: e.entity, options: { bold: true, color: BV_COLOR[e.entity as EntityName] ?? C.cyan } },
      { text: fmtEur(cur), options: { align: 'right', color: C.ink } },
      { text: fmtSignedEurK(delta), options: { align: 'right', bold: true, color: delta > 0 ? C.amber : C.cyan } },
      { text: status, options: { bold: true, color: sColor } },
      { text: fmtEur(deb), options: { align: 'right', color: C.ink } },
    ])
  }
  slide.addText('OHW & debiteuren per BV', {
    x: MARGIN, y: 4.28, w: tblW, h: 0.3, fontFace: 'Inter', fontSize: 11, bold: true, color: C.navy,
  })
  slide.addTable(rows, { x: MARGIN, y: 4.6, w: tblW, rowH: 0.4, ...tableBase })

  const ins: Insight[] = [
    { tone: 'plain', text: `Het totale onderhanden werk staat op ${fmtEur(tot)}; samen met ${fmtEur(totDeb)} debiteuren is dat het werkkapitaal dat in de business vastzit.` },
    { tone: tot > 1_500_000 ? 'warn' : 'good', text: tot > 1_500_000
      ? 'Een hoog OHW-saldo bindt kas en verhoogt het risico op afboekingen — bewaak de ouderdom van de posten.'
      : 'Het OHW-saldo beweegt in een beheerst tempo mee met de omzet.' },
    { tone: 'advice', text: 'Factureer onderhanden werk zo snel mogelijk na oplevering; een kortere doorlooptijd verbetert direct de kasstroom.' },
  ]
  addInsightBlock(slide, MARGIN + tblW + 0.25, 4.28, PAGE_W - 2 * MARGIN - tblW - 0.25, 2.0, ins)
  addFooter(slide, monthLabel)
}

function slideFacturatiePipeline(
  pptx: PptxGenJS, monthLabel: string, month: string, importRecords: ImportRecord[], num: number,
) {
  const slide = pptx.addSlide()
  slide.background = { color: C.page }
  addSectionHeader(slide, 'Operationeel', 'Facturatie-pipeline — open posten', num)

  const slots = [
    { id: 'conceptfacturen', label: 'Conceptfacturen', color: C.cyan },
    { id: 'd_lijst',         label: 'D-lijst (Consult.)', color: C.cyanDark },
    { id: 'uren_lijst',      label: 'NTF uren', color: C.green },
    { id: 'missing_hours',   label: 'Missing hours', color: C.amber },
  ]
  // Maanden chronologisch ordenen — localeCompare sorteert alfabetisch
  // (Apr < Aug < Dec < Feb …), wat de vorige-maand- en trendberekening sloopt.
  const MONTH_ORDER = [...MONTHS_2025, ...MONTHS_2026]
  const monthIdx = (m: string) => {
    const i = MONTH_ORDER.indexOf(m)
    return i < 0 ? 9999 : i
  }
  const approvedBySlot = (id: string) => importRecords
    .filter(r => r.slotId === id && r.status === 'approved')
    .sort((a, b) => monthIdx(a.month) - monthIdx(b.month))
  const prevMonth: string | null = MONTH_ORDER[monthIdx(month) - 1] ?? null

  const cw = (PAGE_W - 2 * MARGIN - 3 * 0.22) / 4
  slots.forEach((slot, i) => {
    const recs = approvedBySlot(slot.id)
    const curRec = recs.find(r => r.month === month)
    const prevRec = prevMonth ? recs.find(r => r.month === prevMonth) : undefined
    const cur = curRec?.totalAmount ?? 0
    const sub = !curRec
      ? 'geen goedgekeurd bestand'
      : prevRec
        ? `vs ${prevMonth}: ${fmtSignedEurK(cur - (prevRec.totalAmount ?? 0))}`
        : 'geen data vorige maand'
    addKpiCard(slide, MARGIN + i * (cw + 0.22), 1.3, cw, 1.3, slot.label, fmtEurK(cur), sub, slot.color)
  })

  const allMonths = [...new Set(importRecords.map(r => r.month))]
    .sort((a, b) => monthIdx(a) - monthIdx(b))
    .slice(-6)
  const rows: PptxGenJS.TableRow[] = [[
    hCell('Slot'),
    ...allMonths.map(m => hCell(m, 'right')),
    hCell('Δ over periode', 'right'),
  ]]
  for (const slot of slots) {
    const recs = approvedBySlot(slot.id)
    const byMonth = allMonths.map(m => recs.find(r => r.month === m)?.totalAmount ?? 0)
    const nonZero = byMonth.filter(v => v > 0)
    const first = nonZero[0] ?? 0
    const last = nonZero[nonZero.length - 1] ?? 0
    const trendDelta = last - first
    const hasTrend = nonZero.length >= 2
    rows.push([
      { text: slot.label, options: { bold: true, color: slot.color } },
      ...byMonth.map(v => ({
        text: v === 0 ? '—' : fmtEur(v),
        options: { align: 'right' as const, color: v === 0 ? C.inkFaint : C.ink },
      })),
      { text: hasTrend ? fmtSignedEurK(trendDelta) : '—', options: {
        align: 'right' as const, bold: true,
        color: !hasTrend ? C.inkSoft : trendDelta > 0 ? C.green : trendDelta < 0 ? C.red : C.inkSoft,
      } },
    ])
  }
  slide.addTable(rows, { x: MARGIN, y: 2.95, w: PAGE_W - 2 * MARGIN, rowH: 0.42, ...tableBase })

  const totalPipeline = slots.reduce((s, slot) =>
    s + (approvedBySlot(slot.id).find(r => r.month === month)?.totalAmount ?? 0), 0)
  const concept = approvedBySlot('conceptfacturen').find(r => r.month === month)
  const mh = approvedBySlot('missing_hours').find(r => r.month === month)
  const ins: Insight[] = [
    { tone: 'plain', text: `De open pipeline voor ${month} bedraagt ${fmtEur(totalPipeline)} — potentieel te factureren of te verwerken omzet.` },
  ]
  if (concept && concept.totalAmount > 100_000) {
    ins.push({ tone: 'warn', text: `Er staat ${fmtEurK(concept.totalAmount)} aan conceptfacturen open; tijdige afhandeling versnelt de facturatie en kasstroom.` })
  }
  if (mh && mh.totalAmount > 0) {
    ins.push({ tone: 'risk', text: `${fmtEurK(mh.totalAmount)} aan missing hours is nog niet geboekt of goedgekeurd — dit is verloren factureerbare omzet als het blijft liggen.` })
  }
  ins.push({ tone: 'advice', text: 'Beleg een wekelijkse facturatie-review: concept → definitief binnen de maand, en sluit missing hours vóór de afsluiting.' })
  addInsightBlock(slide, MARGIN, 5.3, PAGE_W - 2 * MARGIN, 1.35, ins.slice(0, 4), 'Inzicht & advies', 9.3)
  addFooter(slide, monthLabel)
}

function slideSectionDivider(pptx: PptxGenJS, title: string, subtitle: string) {
  const slide = pptx.addSlide()
  slide.background = { color: C.tint }
  slide.addShape('rect' as const, { x: 0, y: 0, w: 0.22, h: PAGE_H, fill: { color: C.cyan } })
  slide.addShape('rect' as const, { x: 5.0, y: 3.05, w: 3.3, h: 0.05, fill: { color: C.cyan } })
  slide.addText(title, {
    x: 1, y: 3.2, w: PAGE_W - 2, h: 1.0,
    fontFace: 'Inter', fontSize: 40, bold: true, color: C.navy, align: 'center',
  })
  slide.addText(subtitle, {
    x: 1, y: 4.25, w: PAGE_W - 2, h: 0.5,
    fontFace: 'Inter', fontSize: 15, color: C.inkSoft, align: 'center',
  })
}

function slideBvFull(
  pptx: PptxGenJS, monthLabel: string, month: string, ds: ReportDataset,
  snap: BvSnapshot, ytdMonths: string[], aiCommentary: string | null, num: number,
) {
  const bv = snap.bv
  const slide = pptx.addSlide()
  slide.background = { color: C.page }
  addSectionHeader(slide, 'Per business unit', `${bv} — volledig overzicht`, num)

  const color = BV_COLOR[bv as EntityName]
  const y25 = ytd2025Eq(ytdMonths)

  // KPI-rij
  const cw = (PAGE_W - 2 * MARGIN - 3 * 0.2) / 4
  const ch = 1.0
  addKpiCard(slide, MARGIN + 0 * (cw + 0.2), 1.28, cw, ch, `Omzet ${monthLabel}`, fmtEurK(snap.omzetM),
    `vs budget ${fmtSignedEurK(snap.omzetM - snap.budgetM)}`, color, deltaColor(snap.omzetM - snap.budgetM))
  addKpiCard(slide, MARGIN + 1 * (cw + 0.2), 1.28, cw, ch, 'Omzet YTD', fmtEurK(snap.omzetY),
    `${fmtPct(snap.budgetPct)} budget · ${fmtPct(snap.yoyPct)} YoY`, color, deltaColor(snap.budgetPct))
  addKpiCard(slide, MARGIN + 2 * (cw + 0.2), 1.28, cw, ch, 'Marge / EBITDA YTD', `${snap.margePct.toFixed(1)}%`,
    `EBITDA ${fmtEurK(snap.ebitdaY)}`, snap.ebitdaY >= 0 ? C.green : C.red)
  addKpiCard(slide, MARGIN + 3 * (cw + 0.2), 1.28, cw, ch, 'Latest Estimate FY', fmtEurK(snap.leFyO),
    `${fmtPct(snap.leVsBudPct)} vs jaarbudget`, C.purple, deltaColor(snap.leVsBudPct))

  // P&L-tabel (links)
  const rowsPl: PptxGenJS.TableRow[] = [[
    hCell('P&L-regel'), hCell(monthLabel, 'right'), hCell('Budget', 'right'),
    hCell('Δ', 'right'), hCell('YTD 2026', 'right'), hCell('Budget YTD', 'right'), hCell('YTD 2025', 'right'),
  ]]
  const keys = [
    { key: 'netto_omzet', label: 'Netto-omzet', bold: true },
    { key: 'directe_kosten', label: '   Directe kosten', bold: false },
    { key: 'brutomarge', label: 'Brutomarge', bold: true },
    { key: 'operationele_kosten', label: '   Operationele kosten', bold: false },
    { key: 'ebitda', label: 'EBITDA', bold: true },
    { key: 'amortisatie_afschrijvingen', label: '   Amortisatie & afschrijving', bold: false },
    { key: 'ebit', label: 'EBIT', bold: true },
  ]
  for (const k of keys) {
    const mA = mv(ds, bv, month, k.key, 'actual')
    const mB = mv(ds, bv, month, k.key, 'budget')
    const yA = ytd(ds, bv, ytdMonths, k.key, 'actual')
    const yB = ytd(ds, bv, ytdMonths, k.key, 'budget')
    const yLy = ytd25(bv, y25, k.key)
    const dM = mA - mB
    rowsPl.push([
      { text: k.label, options: { color: k.bold ? C.navy : C.ink, bold: k.bold, fontSize: 9.5,
        fill: k.bold ? { color: C.lineSoft } : undefined } },
      { text: fmtEur(mA), options: { align: 'right', bold: k.bold, color: C.ink, fontSize: 9.5 } },
      { text: fmtEur(mB), options: { align: 'right', color: C.inkSoft, fontSize: 9.5 } },
      { text: fmtSignedEurK(dM), options: { align: 'right', bold: true, color: deltaColor(dM), fontSize: 9.5 } },
      { text: fmtEur(yA), options: { align: 'right', bold: k.bold, color: C.cyanDark, fontSize: 9.5 } },
      { text: fmtEur(yB), options: { align: 'right', color: C.inkSoft, fontSize: 9.5 } },
      { text: fmtEur(yLy), options: { align: 'right', color: C.inkSoft, fontSize: 9.5 } },
    ])
  }
  slide.addTable(rowsPl, { x: MARGIN, y: 2.42, w: 7.65, rowH: 0.33, ...tableBase, fontSize: 9.5 })

  // Trend (rechts): omzet actual→LE vs budget
  slide.addText('Omzet 2026 — actual → Latest Estimate vs budget (€k)', {
    x: 8.45, y: 2.42, w: 4.35, h: 0.4, fontFace: 'Inter', fontSize: 9.5, bold: true, color: C.navy,
  })
  slide.addChart(pptx.ChartType.line, [
    { name: 'Actual → LE', labels: MONTH_LABELS_SHORT, values: MONTHS_2026.map(m => mv(ds, bv, m, 'netto_omzet', 'le') / 1000) },
    { name: 'Budget', labels: MONTH_LABELS_SHORT, values: MONTHS_2026.map(m => mv(ds, bv, m, 'netto_omzet', 'budget') / 1000) },
  ], {
    x: 8.45, y: 2.8, w: 4.35, h: 2.25,
    chartColors: [color, C.amber],
    lineSize: 2.5, lineDataSymbolSize: 4,
    catAxisLabelFontSize: 7, valAxisLabelFontSize: 8, valAxisLabelFormatCode: '#,##0" k"',
    showLegend: true, legendPos: 'b', legendColor: C.inkSoft, legendFontSize: 8,
    ...chartBase,
  })

  // AI-duiding (volledige breedte onderaan)
  const isLive = !!aiCommentary && aiCommentary.trim().length > 0
  const text = isLive ? aiCommentary!.trim() : buildBvNarrative(snap)
  addPanel(slide, MARGIN, 5.2, PAGE_W - 2 * MARGIN, 1.4, C.tint, color)
  slide.addText('AI-DUIDING & ANALYSE', {
    x: MARGIN + 0.22, y: 5.31, w: 4, h: 0.24,
    fontFace: 'Inter', fontSize: 8.5, bold: true, color: C.cyanDark, charSpacing: 1.5,
  })
  slide.addText(isLive ? 'live AI' : 'automatische analyse', {
    x: PAGE_W - MARGIN - 2.0, y: 5.31, w: 1.8, h: 0.24,
    fontFace: 'Inter', fontSize: 7.5, bold: true, color: C.inkFaint, align: 'right', charSpacing: 0.5,
  })
  slide.addText(text, {
    x: MARGIN + 0.22, y: 5.57, w: PAGE_W - 2 * MARGIN - 0.44, h: 0.98,
    fontFace: 'Inter', fontSize: 9.6, color: C.ink, valign: 'top', lineSpacingMultiple: 1.17,
  })
  addFooter(slide, monthLabel)
}

function slideBalans(pptx: PptxGenJS, monthLabel: string, month: string, ohwData: OhwYearData, num: number) {
  const slide = pptx.addSlide()
  slide.background = { color: C.page }
  addSectionHeader(slide, 'Verdieping', 'Balansposities — werkkapitaal', num)

  const entities = ohwData.entities
  slide.addText(`Werkkapitaal per BV — ${monthLabel} (€k)`, {
    x: MARGIN, y: 1.28, w: 7, h: 0.3, fontFace: 'Inter', fontSize: 11, bold: true, color: C.navy,
  })
  slide.addChart(pptx.ChartType.bar, entities.map(e => ({
    name: e.entity,
    labels: ['Debiteuren', 'OHW'],
    values: [(e.debiteuren[month] ?? 0) / 1000, (e.totaalOnderhanden[month] ?? 0) / 1000],
  })), {
    x: MARGIN, y: 1.58, w: 6.6, h: 3.0,
    barDir: 'col', barGrouping: 'clustered',
    chartColors: entities.map(e => BV_COLOR[e.entity as EntityName] ?? C.cyan),
    showValue: true, dataLabelFontSize: 8, dataLabelColor: C.ink, dataLabelFormatCode: '#,##0" k"',
    catAxisLabelFontSize: 10, valAxisLabelFontSize: 9, valAxisLabelFormatCode: '#,##0" k"',
    showLegend: true, legendPos: 'b', legendColor: C.inkSoft, legendFontSize: 10,
    ...chartBase,
  })

  const rows: PptxGenJS.TableRow[] = [[
    hCell('BV'), hCell('Debiteuren', 'right'), hCell('OHW', 'right'),
    hCell('Factuurvol.', 'right'), hCell('Werkkap.-dgn', 'right'),
  ]]
  let tDeb = 0, tOhw = 0
  for (const e of entities) {
    const deb = e.debiteuren[month] ?? 0
    const ohw = e.totaalOnderhanden[month] ?? 0
    const fv = e.factuurvolume[month] ?? 0
    tDeb += deb; tOhw += ohw
    rows.push([
      { text: e.entity, options: { bold: true, color: BV_COLOR[e.entity as EntityName] ?? C.cyan } },
      { text: fmtEur(deb), options: { align: 'right', color: C.ink } },
      { text: fmtEur(ohw), options: { align: 'right', color: C.ink } },
      { text: fmtEur(fv), options: { align: 'right', color: C.inkSoft } },
      { text: fv > 0 ? ((deb + ohw) / fv * 30).toFixed(0) + ' dg' : '—', options: { align: 'right', bold: true, color: C.cyanDark } },
    ])
  }
  rows.push([
    { text: 'Totaal', options: { bold: true, color: C.navy, fill: { color: C.panelAlt } } },
    { text: fmtEur(tDeb), options: { align: 'right', bold: true, color: C.navy, fill: { color: C.panelAlt } } },
    { text: fmtEur(tOhw), options: { align: 'right', bold: true, color: C.navy, fill: { color: C.panelAlt } } },
    { text: '', options: { fill: { color: C.panelAlt } } },
    { text: fmtEur(tDeb + tOhw), options: { align: 'right', bold: true, color: C.cyanDark, fill: { color: C.panelAlt } } },
  ])
  slide.addTable(rows, { x: 7.45, y: 1.58, w: 5.3, rowH: 0.42, ...tableBase })

  const ins: Insight[] = [
    { tone: 'plain', text: `Er zit ${fmtEur(tDeb + tOhw)} werkkapitaal vast: ${fmtEur(tDeb)} debiteuren + ${fmtEur(tOhw)} onderhanden werk.` },
    { tone: 'plain', text: 'Werkkapitaal-dagen = (debiteuren + OHW) / maand-factuurvolume × 30 — een hoger getal betekent dat meer kas in de business vastzit.' },
    { tone: 'advice', text: 'Verkort de incasso-cyclus en factureer OHW sneller; dat maakt kas vrij zonder dat er omzet bij hoeft.' },
  ]
  addInsightBlock(slide, MARGIN, 4.8, PAGE_W - 2 * MARGIN, 1.85, ins)
  addFooter(slide, monthLabel)
}

/** Slotpagina — totaaloverzicht: kerncijfers, belangrijkste zaken en de
 *  belangrijkste aanbevelingen op één slide. */
function slideConclusie(
  pptx: PptxGenJS, monthLabel: string, month: string, snaps: BvSnapshot[],
  closingEntries: ClosingEntry[], ohwData: OhwYearData, num: number,
) {
  const slide = pptx.addSlide()
  slide.background = { color: C.page }
  addSectionHeader(slide, 'Afsluiting', `Totaaloverzicht & aanbevelingen — ${monthLabel}`, num)

  const { findings, advice, verdict } = buildFindings(snaps, month, closingEntries, ohwData)
  const g = groupTotals(snaps)
  const declPct = g.workedY > 0 ? g.declarableY / g.workedY * 100 : 0

  // Kernboodschap
  addPanel(slide, MARGIN, 1.3, PAGE_W - 2 * MARGIN, 0.92, C.tint, C.cyan)
  slide.addText('KERNBOODSCHAP', {
    x: MARGIN + 0.25, y: 1.39, w: 3, h: 0.24,
    fontFace: 'Inter', fontSize: 9, bold: true, color: C.cyanDark, charSpacing: 1.5,
  })
  slide.addText(verdict, {
    x: MARGIN + 0.25, y: 1.6, w: PAGE_W - 2 * MARGIN - 0.5, h: 0.56,
    fontFace: 'Inter', fontSize: 11, color: C.navy, valign: 'top', lineSpacingMultiple: 1.13,
  })

  // KPI-strip
  const cw = (PAGE_W - 2 * MARGIN - 3 * 0.22) / 4
  const ky = 2.4, ch = 1.02
  addKpiCard(slide, MARGIN + 0 * (cw + 0.22), ky, cw, ch, 'Omzet YTD', fmtEurK(g.omzetY),
    `${fmtPct(g.budgetPct)} vs budget · ${fmtPct(g.yoyPct)} YoY`, C.cyan, deltaColor(g.budgetPct))
  addKpiCard(slide, MARGIN + 1 * (cw + 0.22), ky, cw, ch, 'EBITDA YTD', fmtEurK(g.ebitdaY),
    `brutomarge ${g.margePct.toFixed(1)}%`, g.ebitdaY >= 0 ? C.green : C.red)
  addKpiCard(slide, MARGIN + 2 * (cw + 0.22), ky, cw, ch, 'Declarabiliteit YTD', `${declPct.toFixed(1)}%`,
    'capaciteitsbenutting', C.amber)
  addKpiCard(slide, MARGIN + 3 * (cw + 0.22), ky, cw, ch, 'Latest Estimate FY', fmtEurK(g.leFyO),
    `${fmtPct(g.leVsBudPct)} vs jaarbudget`, C.purple, deltaColor(g.leVsBudPct))

  // Twee kolommen — belangrijkste zaken + aanbevelingen
  const colW = (PAGE_W - 2 * MARGIN - 0.3) / 2
  slide.addText('Belangrijkste zaken', {
    x: MARGIN, y: 3.62, w: colW, h: 0.32,
    fontFace: 'Inter', fontSize: 12.5, bold: true, color: C.navy,
  })
  slide.addText(
    findings.slice(0, 6).flatMap(f => [
      { text: `${f.severity === 'good' ? '▲' : f.severity === 'warn' ? '◆' : '▼'}  `,
        options: { color: f.severity === 'good' ? C.green : f.severity === 'warn' ? C.amber : C.red, bold: true, fontSize: 10.2 } },
      { text: f.text, options: { breakLine: true, color: C.ink, fontSize: 10.2, paraSpaceAfter: 7, lineSpacingMultiple: 1.1 } },
    ]),
    { x: MARGIN, y: 3.97, w: colW, h: 2.6, fontFace: 'Inter', valign: 'top' },
  )

  const ax = MARGIN + colW + 0.3
  addPanel(slide, ax, 3.62, colW, 2.98, C.tint, C.green)
  slide.addText('Belangrijkste aanbevelingen', {
    x: ax + 0.25, y: 3.75, w: colW - 0.5, h: 0.32,
    fontFace: 'Inter', fontSize: 12.5, bold: true, color: C.navy,
  })
  slide.addText(
    advice.flatMap((a, i) => [
      { text: `${i + 1}.  `, options: { color: C.cyanDark, bold: true, fontSize: 10.2 } },
      { text: a, options: { breakLine: true, color: C.ink, fontSize: 10.2, paraSpaceAfter: 8, lineSpacingMultiple: 1.12 } },
    ]),
    { x: ax + 0.25, y: 4.12, w: colW - 0.5, h: 2.4, fontFace: 'Inter', valign: 'top' },
  )

  slide.addText(`TPG Business Control · maandrapportage gegenereerd op ${new Date().toLocaleString('nl-NL')}`, {
    x: MARGIN, y: PAGE_H - 0.4, w: PAGE_W - 2 * MARGIN, h: 0.3,
    fontFace: 'Inter', fontSize: 8.5, color: C.inkFaint,
  })
}

// ─── Main entry ─────────────────────────────────────────────────────────

export interface GeneratePptxInput {
  month: string
  monthLabel: string
  ytdMonths: string[]
  closingEntries: ClosingEntry[]
  ohwData2026: OhwYearData
  importRecords: ImportRecord[]
  /** Live dataset uit de app-stores. */
  data: ReportDataset
  /** AI-duiding per BV (LE-leerlus cache of live rapportage-AI). */
  aiAnalyses?: AiAnalysisEntry[]
}

async function buildMonthPptxDeck(input: GeneratePptxInput): Promise<PptxGenJS> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'TPG Business Control'
  pptx.company = 'The People Group'
  pptx.title = `Maandrapportage ${input.monthLabel}`
  pptx.subject = `Maandrapportage ${input.month}`

  const logoB64 = await fetchImageAsBase64('/tpg-logo.png')
  const ds = input.data
  const ai = input.aiAnalyses ?? []
  const snaps = BVS.map(bv => bvSnapshot(ds, bv, input.month, input.ytdMonths))

  slideTitle(pptx, input.monthLabel, logoB64)
  slideToc(pptx)

  slideManagementSummary(pptx, input.monthLabel, input.month, snaps, input.closingEntries, input.ohwData2026)
  slideKpiDashboard(pptx, input.monthLabel, input.month, snaps, input.closingEntries)
  slideOmzetTrend(pptx, input.monthLabel, ds, snaps, input.ytdMonths, 5)
  slideMargeTrend(pptx, input.monthLabel, ds, snaps, input.ytdMonths, 6)
  slideLatestEstimate(pptx, input.monthLabel, ds, snaps, input.ytdMonths, 7)
  slideDeclarabiliteit(pptx, input.monthLabel, ds, snaps, input.ytdMonths, 8)
  slideOhwStatus(pptx, input.monthLabel, input.month, input.ohwData2026, 9)
  slideFacturatiePipeline(pptx, input.monthLabel, input.month, input.importRecords, 10)

  slideSectionDivider(pptx, 'Per business unit', `${input.monthLabel} · P&L · prognose · AI-duiding`)
  let num = 12
  for (const snap of snaps) {
    const commentary = ai.find(a => a.bv === snap.bv)?.commentary ?? null
    slideBvFull(pptx, input.monthLabel, input.month, ds, snap, input.ytdMonths, commentary, num++)
  }

  slideBalans(pptx, input.monthLabel, input.month, input.ohwData2026, num++)
  slideConclusie(pptx, input.monthLabel, input.month, snaps, input.closingEntries, input.ohwData2026, num++)

  return pptx
}

export async function generateMonthPptx(input: GeneratePptxInput): Promise<void> {
  const pptx = await buildMonthPptxDeck(input)
  const filename = `TPG_Maandrapportage_${input.month.replace(/\s+/g, '_')}.pptx`
  await pptx.writeFile({ fileName: filename })
}

/** Genereer dezelfde PowerPoint maar als Blob (voor bundling in een ZIP). */
export async function buildMonthPptxBlob(input: GeneratePptxInput): Promise<Blob> {
  const pptx = await buildMonthPptxDeck(input)
  const out = await pptx.write({ outputType: 'blob' })
  if (out instanceof Blob) return out
  return new Blob([out as unknown as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  })
}

/** Converteer "Mar-26" → "maart 2026" */
export function monthLabelFromCode(code: string): string {
  const MAP: Record<string, string> = {
    'Jan': 'januari', 'Feb': 'februari', 'Mar': 'maart', 'Apr': 'april',
    'May': 'mei', 'Jun': 'juni', 'Jul': 'juli', 'Aug': 'augustus',
    'Sep': 'september', 'Oct': 'oktober', 'Nov': 'november', 'Dec': 'december',
  }
  const m = code.match(/^(\w+)-(\d{2})$/)
  if (!m) return code
  const [, mon, yr] = m
  return `${MAP[mon] ?? mon.toLowerCase()} 20${yr}`
}
