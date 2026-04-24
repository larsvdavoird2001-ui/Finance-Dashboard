/**
 * TPG maandrapportage PowerPoint generator — versie 2, uitgebreid.
 * Bouwt een 16:9 deck in The People Group huisstijl met:
 *   - Titelpagina met logo
 *   - Inhoudsopgave
 *   - Samenvatting / Kern
 *   - Omzet trend 2025 vs 2026 (per BV)
 *   - Brutomarge & EBITDA ontwikkeling
 *   - Declarabiliteit ontwikkeling per BV (24 maanden)
 *   - Per BV deep-dive: KPIs, full P&L (Maand/Budget/Δ/YTD/LY), toelichting
 *   - OHW status & ontwikkeling per BV (trend + delta-tabel)
 *   - Facturatie pipeline: D-lijst, conceptfacturen, missing hours status
 *   - Balansposities: debiteuren + OHW saldo
 *   - Forecast & scenarios: conservatief / current run-rate / optimistisch
 *   - Bijlage met closing entries
 */
import PptxGenJS from 'pptxgenjs'
import type { ClosingEntry, BvId, OhwYearData, ImportRecord } from '../data/types'
import type { EntityName } from '../data/plData'
import {
  ytdBudget2026,
  monthlyBudget2026, monthlyActuals2026,
  PL_STRUCTURE,
} from '../data/plData'
import { monthlyActuals2025 } from '../data/plData2025'
import { hoursData2025, hoursData2026, MONTHS_2025, MONTHS_2026 } from '../data/hoursData'
import type { HoursRecord } from '../data/types'

const BRAND = {
  primary:   '00A9E0',   // TPG cyan
  primaryDark: '0086B3',
  dark:      '070A12',
  text:      'EDF1FC',
  muted:     '8FA3C0',
  subtle:    '52657E',
  bgDark:    '0C1120',
  bgCard:    '111828',
  bgCard2:   '171F32',
  green:     '26C997',
  red:       'EF5350',
  amber:     'F5A623',
  purple:    '8B5CF6',
} as const

const BV_COLOR: Record<EntityName, string> = {
  Consultancy: BRAND.primary,
  Projects:    BRAND.green,
  Software:    BRAND.purple,
  Holdings:    BRAND.muted,
}

const PAGE_W = 13.333  // 16:9 widescreen inches
const PAGE_H = 7.5

const BVS: BvId[] = ['Consultancy', 'Projects', 'Software']
const MONTH_LABELS_SHORT = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec']

// ─── Formatters ─────────────────────────────────────────────────────────

function fmtEur(n: number): string {
  if (!isFinite(n) || n === 0) return n === 0 ? '€ 0' : '—'
  const neg = n < 0
  const abs = Math.abs(Math.round(n))
  return (neg ? '-€ ' : '€ ') + abs.toLocaleString('nl-NL')
}
function fmtEurK(n: number): string {
  if (!isFinite(n) || Math.abs(n) < 1) return '€ 0k'
  const neg = n < 0
  return (neg ? '-' : '') + '€ ' + Math.round(Math.abs(n) / 1000).toLocaleString('nl-NL') + 'k'
}
function fmtPct(n: number): string {
  if (!isFinite(n)) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
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

function addSectionHeader(slide: PptxGenJS.Slide, title: string, number: number | string) {
  slide.addShape('rect' as 'rect', {
    x: 0, y: 0, w: 0.35, h: PAGE_H, fill: { color: BRAND.primary },
  })
  slide.addText(title, {
    x: 0.6, y: 0.3, w: PAGE_W - 1.5, h: 0.6,
    fontFace: 'Inter', fontSize: 22, bold: true, color: BRAND.text,
  })
  slide.addText(String(number), {
    x: PAGE_W - 0.8, y: PAGE_H - 0.45, w: 0.6, h: 0.3,
    fontFace: 'Inter', fontSize: 10, color: BRAND.subtle, align: 'right',
  })
  slide.addShape('rect' as 'rect', {
    x: 0.6, y: 0.95, w: PAGE_W - 1.2, h: 0.02,
    fill: { color: BRAND.primary }, line: { color: BRAND.primary },
  })
}

function addFooter(slide: PptxGenJS.Slide, monthLabel?: string) {
  slide.addText(
    `The People Group · Finance · Maandrapportage${monthLabel ? ' ' + monthLabel : ''}`,
    {
      x: 0.6, y: PAGE_H - 0.4, w: 6, h: 0.3,
      fontFace: 'Inter', fontSize: 9, color: BRAND.subtle,
    },
  )
}

function addKpiCard(
  slide: PptxGenJS.Slide,
  x: number, y: number, w: number, h: number,
  label: string, value: string, sub: string, color: string = BRAND.primary,
) {
  slide.addShape('roundRect' as 'roundRect', {
    x, y, w, h, fill: { color: BRAND.bgCard },
    line: { color, width: 0.5 }, rectRadius: 0.08,
  })
  slide.addShape('rect' as 'rect', { x, y, w: 0.08, h, fill: { color } })
  slide.addText(label.toUpperCase(), {
    x: x + 0.2, y: y + 0.08, w: w - 0.4, h: 0.28,
    fontFace: 'Inter', fontSize: 9, bold: true, color: BRAND.subtle, charSpacing: 1.5,
  })
  slide.addText(value, {
    x: x + 0.2, y: y + 0.38, w: w - 0.4, h: 0.6,
    fontFace: 'Inter', fontSize: 20, bold: true, color,
  })
  slide.addText(sub, {
    x: x + 0.2, y: y + h - 0.4, w: w - 0.4, h: 0.3,
    fontFace: 'Inter', fontSize: 9, color: BRAND.muted,
  })
}

// ─── Data aggregation helpers ───────────────────────────────────────────

function monthValue(bv: BvId, month: string, key: string, source: 'actual' | 'budget' | 'actual2025'): number {
  if (source === 'actual2025') return monthlyActuals2025[bv as EntityName]?.[month]?.[key] ?? 0
  if (source === 'budget')     return monthlyBudget2026[bv as EntityName]?.[month]?.[key] ?? 0
  return monthlyActuals2026[bv as EntityName]?.[month]?.[key] ?? 0
}

function ytdValue(bv: BvId, months: string[], key: string, source: 'actual' | 'budget' | 'actual2025'): number {
  return months.reduce((s, m) => s + monthValue(bv, m, key, source), 0)
}

/** 2025-YTD equivalent van 2026-YTD periode: Jan-25..{laatste actuele 2026 maand -1}-25 */
function ytd2025EquivalentMonths(ytdMonths2026: string[]): string[] {
  return ytdMonths2026.map(m => m.replace('-26', '-25'))
}

function declarability(record: HoursRecord): number {
  return record.written > 0 ? (record.declarable / record.written) * 100 : 0
}

/** 24-maanden declarability stats per BV (jan-25 t/m dec-26).
 *  Forecast-waarden (type=forecast) tellen als "gepland", actuals/current zijn
 *  echte data. */
function buildDeclarabilityTrend(bv: BvId): { labels: string[]; values: number[]; types: Array<HoursRecord['type']> } {
  const labels: string[] = []
  const values: number[] = []
  const types: Array<HoursRecord['type']> = []
  for (const m of MONTHS_2025) {
    const r = hoursData2025.find(x => x.bv === bv && x.month === m)
    if (r) { labels.push(m); values.push(declarability(r)); types.push(r.type) }
  }
  for (const m of MONTHS_2026) {
    const r = hoursData2026.find(x => x.bv === bv && x.month === m)
    if (r) { labels.push(m); values.push(declarability(r)); types.push(r.type) }
  }
  return { labels, values, types }
}

/** Sum of hours (written/declarable) per year */
function sumHours(data: HoursRecord[], bv: BvId, months: string[], kind: 'written' | 'declarable'): number {
  return data.filter(r => r.bv === bv && months.includes(r.month))
    .reduce((s, r) => s + (r[kind] ?? 0), 0)
}

// ─── Slide builders ─────────────────────────────────────────────────────

function slideTitle(pptx: PptxGenJS, monthLabel: string, logoB64: string) {
  const slide = pptx.addSlide()
  slide.background = { color: BRAND.bgDark }
  slide.addShape('rect' as 'rect', { x: 0, y: 0, w: 5.5, h: PAGE_H, fill: { color: BRAND.primary } })
  if (logoB64) {
    slide.addImage({ data: logoB64, x: 6.2, y: 2.5, w: 6, h: 2, sizing: { type: 'contain', w: 6, h: 2 } })
  } else {
    slide.addText('the peoplegroup', {
      x: 6.2, y: 2.8, w: 6, h: 1.2,
      fontFace: 'Inter', fontSize: 42, bold: true, color: BRAND.primary,
    })
  }
  slide.addText('Driven by technology · Created by people', {
    x: 6.2, y: 4.6, w: 6, h: 0.4,
    fontFace: 'Inter', fontSize: 14, color: BRAND.primaryDark, italic: true,
  })
  slide.addText('Maandrapportage', {
    x: 0.5, y: 2.6, w: 4.5, h: 0.8,
    fontFace: 'Inter', fontSize: 30, bold: true, color: 'FFFFFF',
  })
  slide.addText(monthLabel, {
    x: 0.5, y: 3.4, w: 4.5, h: 0.9,
    fontFace: 'Inter', fontSize: 46, bold: true, color: 'FFFFFF',
  })
  slide.addText(`Datum: ${new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })}`, {
    x: 0.5, y: 4.5, w: 4.5, h: 0.4,
    fontFace: 'Inter', fontSize: 14, color: 'FFFFFF',
  })
  slide.addText('TPG Finance · Geautomatiseerd gegenereerd vanuit live data', {
    x: 0.5, y: PAGE_H - 0.6, w: 4.5, h: 0.3,
    fontFace: 'Inter', fontSize: 10, color: 'FFFFFF',
  })
}

function slideToc(pptx: PptxGenJS) {
  const slide = pptx.addSlide()
  slide.background = { color: BRAND.bgDark }
  addSectionHeader(slide, 'Inhoudsopgave', 2)
  const items: Array<[string, string[]]> = [
    ['Kern',           ['Samenvatting & KPIs', 'Omzet trend 2025 vs 2026', 'Marge & EBITDA ontwikkeling']],
    ['Operationeel',   ['Declarabiliteit trend', 'OHW status & mutaties', 'Facturatie pipeline']],
    ['Business units', ['Consultancy — volledig', 'Projects — volledig', 'Software — volledig']],
    ['Vooruitblik',    ['Balansposities', 'Forecast scenarios', 'Bijlage']],
  ]
  const startY = 1.3
  const colW = (PAGE_W - 1.2) / items.length
  items.forEach((col, i) => {
    slide.addText(col[0], {
      x: 0.6 + i * colW, y: startY, w: colW - 0.2, h: 0.4,
      fontFace: 'Inter', fontSize: 14, bold: true, color: BRAND.primary, charSpacing: 1,
    })
    const sub = col[1].map((s, idx) => `${idx + 1}. ${s}`).join('\n')
    slide.addText(sub, {
      x: 0.6 + i * colW, y: startY + 0.5, w: colW - 0.2, h: 5,
      fontFace: 'Inter', fontSize: 12, color: BRAND.text, valign: 'top',
      paraSpaceAfter: 8,
    })
  })
  addFooter(slide)
}

function slideSummary(
  pptx: PptxGenJS, monthLabel: string,
  closingEntries: ClosingEntry[], ytdMonths: string[],
) {
  const slide = pptx.addSlide()
  slide.background = { color: BRAND.bgDark }
  addSectionHeader(slide, `Samenvatting — ${monthLabel}`, 3)

  const ytd26 = BVS.reduce((acc, bv) => {
    acc.omzet   += ytdValue(bv, ytdMonths, 'netto_omzet', 'actual')
    acc.marge   += ytdValue(bv, ytdMonths, 'brutomarge',  'actual')
    acc.ebitda  += ytdValue(bv, ytdMonths, 'ebitda',      'actual')
    acc.budget  += ytdValue(bv, ytdMonths, 'netto_omzet', 'budget')
    return acc
  }, { omzet: 0, marge: 0, ebitda: 0, budget: 0 })

  const ytd25Months = ytd2025EquivalentMonths(ytdMonths)
  const ytd25Omzet = BVS.reduce((s, bv) => s + ytdValue(bv, ytd25Months, 'netto_omzet', 'actual2025'), 0)

  const margePct = ytd26.omzet > 0 ? (ytd26.marge / ytd26.omzet * 100) : 0
  const budgetDelta = ytd26.budget > 0 ? ((ytd26.omzet / ytd26.budget - 1) * 100) : 0
  const yoyGrowth   = ytd25Omzet > 0 ? ((ytd26.omzet / ytd25Omzet - 1) * 100) : 0
  const facturenMaand = closingEntries.reduce((s, e) => s + (e.factuurvolume ?? 0), 0)

  const cy = 1.15, ch = 1.15, cw = (PAGE_W - 1.6) / 4, gap = 0.2
  addKpiCard(slide, 0.6 + 0 * (cw + gap), cy, cw, ch, 'Omzet YTD',    fmtEurK(ytd26.omzet),  `vs budget ${fmtPct(budgetDelta)} · vs LY ${fmtPct(yoyGrowth)}`, BRAND.primary)
  addKpiCard(slide, 0.6 + 1 * (cw + gap), cy, cw, ch, 'Brutomarge YTD', fmtEurK(ytd26.marge),`${margePct.toFixed(1)}% marge`, ytd26.marge >= 0 ? BRAND.green : BRAND.red)
  addKpiCard(slide, 0.6 + 2 * (cw + gap), cy, cw, ch, 'EBITDA YTD',   fmtEurK(ytd26.ebitda), ytd26.ebitda >= 0 ? 'positief resultaat' : 'verlieslatend', ytd26.ebitda >= 0 ? BRAND.green : BRAND.red)
  addKpiCard(slide, 0.6 + 3 * (cw + gap), cy, cw, ch, `Factuurvolume ${monthLabel}`, fmtEurK(facturenMaand), 'gerapporteerd', BRAND.amber)

  // Declarability summary
  const totWritten26 = BVS.reduce((s, bv) => s + sumHours(hoursData2026, bv, ytdMonths, 'written'), 0)
  const totDecl26    = BVS.reduce((s, bv) => s + sumHours(hoursData2026, bv, ytdMonths, 'declarable'), 0)
  const totWritten25 = BVS.reduce((s, bv) => s + sumHours(hoursData2025, bv, ytd25Months, 'written'), 0)
  const totDecl25    = BVS.reduce((s, bv) => s + sumHours(hoursData2025, bv, ytd25Months, 'declarable'), 0)
  const declPct26 = totWritten26 > 0 ? (totDecl26 / totWritten26 * 100) : 0
  const declPct25 = totWritten25 > 0 ? (totDecl25 / totWritten25 * 100) : 0

  // Kernpunten in 2 kolommen
  slide.addText('Kernpunten', {
    x: 0.6, y: 2.55, w: PAGE_W - 1.2, h: 0.4,
    fontFace: 'Inter', fontSize: 14, bold: true, color: BRAND.primary,
  })
  const leftHl: string[] = []
  const rightHl: string[] = []
  if (yoyGrowth >= 0) leftHl.push(`● Omzet YTD ${fmtEurK(ytd26.omzet)} — ${fmtPct(yoyGrowth)} YoY groei t.o.v. ${fmtEurK(ytd25Omzet)} in 2025.`)
  else                leftHl.push(`⚠ Omzet YTD ${fmtEurK(ytd26.omzet)} daalt ${fmtPct(Math.abs(yoyGrowth) * -1)} YoY.`)
  if (budgetDelta >= 0) leftHl.push(`● Omzet ${fmtPct(budgetDelta)} boven budget.`)
  else                  leftHl.push(`⚠ Omzet ${fmtPct(budgetDelta)} onder budget.`)
  leftHl.push(`● Declarabiliteit: ${declPct26.toFixed(1)}% (2025 was ${declPct25.toFixed(1)}% — ${fmtPct(declPct26 - declPct25)} punt).`)

  const bvOmzet = BVS.map(bv => ({ bv, omzet: ytdValue(bv, ytdMonths, 'netto_omzet', 'actual') }))
    .sort((a, b) => b.omzet - a.omzet)
  rightHl.push(`● Grootste BV YTD: ${bvOmzet[0].bv} met ${fmtEurK(bvOmzet[0].omzet)}.`)
  const negativeEbitda = BVS.filter(bv => ytdValue(bv, ytdMonths, 'ebitda', 'actual') < 0)
  if (negativeEbitda.length > 0) rightHl.push(`⚠ Negatieve EBITDA YTD bij: ${negativeEbitda.join(', ')}.`)
  else rightHl.push(`● Alle BV's positief op EBITDA-niveau YTD.`)
  const totalOhwMut = closingEntries.reduce((s, e) => s + (e.ohwMutatie ?? 0), 0)
  rightHl.push(`● OHW mutatie maand: ${fmtEur(totalOhwMut)} (${totalOhwMut >= 0 ? 'opbouw' : 'afname'} werkvoorraad).`)

  slide.addText(leftHl.join('\n'), {
    x: 0.6, y: 3, w: (PAGE_W - 1.4) / 2, h: 3.5,
    fontFace: 'Inter', fontSize: 12, color: BRAND.text, valign: 'top',
    paraSpaceAfter: 8, lineSpacingMultiple: 1.35,
  })
  slide.addText(rightHl.join('\n'), {
    x: 0.8 + (PAGE_W - 1.4) / 2, y: 3, w: (PAGE_W - 1.4) / 2, h: 3.5,
    fontFace: 'Inter', fontSize: 12, color: BRAND.text, valign: 'top',
    paraSpaceAfter: 8, lineSpacingMultiple: 1.35,
  })
  addFooter(slide, monthLabel)
}

/** Omzet trendlijn: 2025 (full year actuals) vs 2026 (YTD actuals + forecast
 *  rest jaar op basis van 2025 seizoenspatroon geschaald naar YTD run-rate). */
function slideOmzetTrend(pptx: PptxGenJS, monthLabel: string, ytdMonths: string[], num: number) {
  const slide = pptx.addSlide()
  slide.background = { color: BRAND.bgDark }
  addSectionHeader(slide, 'Omzet ontwikkeling — 2025 vs 2026', num)

  const labels = MONTH_LABELS_SHORT  // Jan..Dec

  // Voor elke BV: 3 series
  //   - 2025 actuals (12 maanden)
  //   - 2026 actuals YTD
  //   - 2026 forecast (Jan..Dec) — actuals waar beschikbaar, rest via 2025 seizoenspatroon × YTD run-rate
  const ytd25M = MONTHS_2025
  const ytd26M = MONTHS_2026

  type Series = { name: string; labels: string[]; values: number[] }
  const datasets: Series[] = []
  for (const bv of BVS) {
    const act25: number[] = ytd25M.map(m => monthValue(bv, m, 'netto_omzet', 'actual2025') / 1000)
    const act26: (number | null)[] = ytd26M.map(m =>
      ytdMonths.includes(m) ? monthValue(bv, m, 'netto_omzet', 'actual') / 1000 : null,
    )
    // Forecast: voor maanden ná ytdMonths, gebruik 2025-seizoensweging × (YTD 2026 / YTD 2025 van ytdMonths)
    const ytd26Sum = ytdMonths.reduce((s, m) => s + monthValue(bv, m, 'netto_omzet', 'actual'), 0)
    const ytd25Sum = ytdMonths.map(m => m.replace('-26', '-25')).reduce((s, m) => s + monthValue(bv, m, 'netto_omzet', 'actual2025'), 0)
    const runRateFactor = ytd25Sum > 0 ? ytd26Sum / ytd25Sum : 1
    const forecast26: number[] = ytd26M.map(m => {
      if (ytdMonths.includes(m)) return monthValue(bv, m, 'netto_omzet', 'actual') / 1000
      const py = monthValue(bv, m.replace('-26', '-25'), 'netto_omzet', 'actual2025')
      return (py * runRateFactor) / 1000
    })

    datasets.push({ name: `${bv} 2025`, labels, values: act25 })
    datasets.push({ name: `${bv} 2026 actuals`, labels, values: act26.map(v => (v === null ? 0 : v)) })
    datasets.push({ name: `${bv} 2026 forecast`, labels, values: forecast26 })
  }

  // Chart kleuren per serie (3 per BV): lighter-2025 / solid-2026 actual / dashed-forecast
  const colors: string[] = []
  for (const bv of BVS) {
    colors.push(BV_COLOR[bv as EntityName] + 'AA')  // 2025 iets transparant
    colors.push(BV_COLOR[bv as EntityName])          // 2026 solid
    colors.push(BV_COLOR[bv as EntityName] + '77')  // forecast iets transparant
  }

  slide.addChart(pptx.ChartType.line, datasets, {
    x: 0.6, y: 1.15, w: PAGE_W - 1.2, h: 4.4,
    chartColors: colors,
    lineSize: 2, lineDataSymbolSize: 6,
    catAxisLabelColor: BRAND.muted, catAxisLabelFontSize: 10,
    valAxisLabelColor: BRAND.muted, valAxisLabelFontSize: 9,
    valAxisLabelFormatCode: '#,##0" k"',
    showLegend: true, legendPos: 'b', legendColor: BRAND.muted, legendFontSize: 9,
    plotArea: { fill: { color: BRAND.bgCard } },
    catAxisLineShow: false, valAxisLineShow: false,
    valGridLine: { color: '232E4A', style: 'dot', size: 0.5 },
  })

  // Insights onderaan
  const insights: string[] = []
  for (const bv of BVS) {
    const ytd26 = ytdValue(bv, ytdMonths, 'netto_omzet', 'actual')
    const ytd25 = ytdValue(bv, ytd2025EquivalentMonths(ytdMonths), 'netto_omzet', 'actual2025')
    const yoy = ytd25 > 0 ? ((ytd26 / ytd25 - 1) * 100) : 0
    const fy25 = MONTHS_2025.reduce((s, m) => s + monthValue(bv, m, 'netto_omzet', 'actual2025'), 0)
    const rate = (ytd26 / Math.max(1, ytdMonths.length)) * 12
    const fyDelta = fy25 > 0 ? ((rate / fy25 - 1) * 100) : 0
    insights.push(`● ${bv}: YTD ${fmtEurK(ytd26)} (${fmtPct(yoy)} YoY) · FY-projectie ${fmtEurK(rate)} (${fmtPct(fyDelta)} vs FY 2025).`)
  }
  slide.addText(insights.join('\n'), {
    x: 0.6, y: 5.7, w: PAGE_W - 1.2, h: 1.3,
    fontFace: 'Inter', fontSize: 11, color: BRAND.text, valign: 'top',
    paraSpaceAfter: 4, lineSpacingMultiple: 1.3,
  })
  addFooter(slide, monthLabel)
}

/** Brutomarge + EBITDA ontwikkeling — 2 line charts side by side */
function slideMargineTrend(pptx: PptxGenJS, monthLabel: string, ytdMonths: string[], num: number) {
  const slide = pptx.addSlide()
  slide.background = { color: BRAND.bgDark }
  addSectionHeader(slide, 'Marge & EBITDA ontwikkeling (YTD 2025 vs 2026)', num)

  // Combineer 25 + 26 labels: Jan-25..Dec-25 + Jan-26..(laatste YTD maand)
  const ytd25M = MONTHS_2025
  const combinedLabels = [...ytd25M.map(m => m.replace('-', ' ')), ...ytdMonths.map(m => m.replace('-', ' '))]

  // Brutomarge chart (links)
  slide.addText('Brutomarge per BV (€k)', {
    x: 0.6, y: 1.15, w: 6, h: 0.35, fontFace: 'Inter', fontSize: 12, bold: true, color: BRAND.text,
  })
  const margeData = BVS.map(bv => ({
    name: bv,
    labels: combinedLabels,
    values: [
      ...ytd25M.map(m => monthValue(bv, m, 'brutomarge', 'actual2025') / 1000),
      ...ytdMonths.map(m => monthValue(bv, m, 'brutomarge', 'actual') / 1000),
    ],
  }))
  slide.addChart(pptx.ChartType.line, margeData, {
    x: 0.6, y: 1.5, w: 6.1, h: 3.2,
    chartColors: BVS.map(bv => BV_COLOR[bv as EntityName]),
    lineSize: 2.5, lineDataSymbolSize: 5,
    catAxisLabelColor: BRAND.muted, catAxisLabelFontSize: 8, catAxisLabelRotate: -45,
    valAxisLabelColor: BRAND.muted, valAxisLabelFontSize: 9,
    valAxisLabelFormatCode: '#,##0" k"',
    showLegend: true, legendPos: 'b', legendColor: BRAND.muted, legendFontSize: 9,
    plotArea: { fill: { color: BRAND.bgCard } },
    valGridLine: { color: '232E4A', style: 'dot', size: 0.5 },
  })

  // EBITDA chart (rechts)
  slide.addText('EBITDA per BV (€k)', {
    x: 7, y: 1.15, w: 6, h: 0.35, fontFace: 'Inter', fontSize: 12, bold: true, color: BRAND.text,
  })
  const ebitdaData = BVS.map(bv => ({
    name: bv,
    labels: combinedLabels,
    values: [
      ...ytd25M.map(m => monthValue(bv, m, 'ebitda', 'actual2025') / 1000),
      ...ytdMonths.map(m => monthValue(bv, m, 'ebitda', 'actual') / 1000),
    ],
  }))
  slide.addChart(pptx.ChartType.line, ebitdaData, {
    x: 7, y: 1.5, w: 5.8, h: 3.2,
    chartColors: BVS.map(bv => BV_COLOR[bv as EntityName]),
    lineSize: 2.5, lineDataSymbolSize: 5,
    catAxisLabelColor: BRAND.muted, catAxisLabelFontSize: 8, catAxisLabelRotate: -45,
    valAxisLabelColor: BRAND.muted, valAxisLabelFontSize: 9,
    valAxisLabelFormatCode: '#,##0" k"',
    showLegend: true, legendPos: 'b', legendColor: BRAND.muted, legendFontSize: 9,
    plotArea: { fill: { color: BRAND.bgCard } },
    valGridLine: { color: '232E4A', style: 'dot', size: 0.5 },
  })

  // Per-BV vergelijkingstabel
  const ytd25MEq = ytd2025EquivalentMonths(ytdMonths)
  const header: PptxGenJS.TableRow = [
    { text: 'BV',          options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard } } },
    { text: 'Marge YTD 26', options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'Marge YTD 25', options: { bold: true, color: BRAND.subtle, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'Δ YoY',       options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'EBITDA YTD 26',options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'EBITDA YTD 25',options: { bold: true, color: BRAND.subtle, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'Δ YoY',       options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
  ]
  const rows: PptxGenJS.TableRow[] = [header]
  for (const bv of BVS) {
    const m26 = ytdValue(bv, ytdMonths, 'brutomarge', 'actual')
    const m25 = ytdValue(bv, ytd25MEq, 'brutomarge', 'actual2025')
    const e26 = ytdValue(bv, ytdMonths, 'ebitda', 'actual')
    const e25 = ytdValue(bv, ytd25MEq, 'ebitda', 'actual2025')
    const mY = m25 !== 0 ? ((m26 / m25 - 1) * 100) : 0
    const eY = e25 !== 0 ? ((e26 / e25 - 1) * 100) : 0
    rows.push([
      { text: bv, options: { bold: true, color: BV_COLOR[bv as EntityName] } },
      { text: fmtEur(m26), options: { color: BRAND.text, align: 'right' } },
      { text: fmtEur(m25), options: { color: BRAND.subtle, align: 'right' } },
      { text: fmtPct(mY),  options: { color: mY >= 0 ? BRAND.green : BRAND.red, align: 'right', bold: true } },
      { text: fmtEur(e26), options: { color: BRAND.text, align: 'right' } },
      { text: fmtEur(e25), options: { color: BRAND.subtle, align: 'right' } },
      { text: fmtPct(eY),  options: { color: eY >= 0 ? BRAND.green : BRAND.red, align: 'right', bold: true } },
    ])
  }
  slide.addTable(rows, {
    x: 0.6, y: 5, w: PAGE_W - 1.2,
    fontFace: 'Inter', fontSize: 10, color: BRAND.text,
    border: { type: 'solid', color: '232E4A', pt: 0.5 },
  })
  addFooter(slide, monthLabel)
}

/** Declarabiliteit ontwikkeling — 24 maanden per BV */
function slideDeclarabiliteit(pptx: PptxGenJS, monthLabel: string, ytdMonths: string[], num: number) {
  const slide = pptx.addSlide()
  slide.background = { color: BRAND.bgDark }
  addSectionHeader(slide, 'Declarabiliteit — uren ontwikkeling over 24 maanden', num)

  // Combined label list: Jan-25..Dec-26 where data exists
  const combinedLabels = [
    ...MONTHS_2025.map(m => m.replace('-', ' ')),
    ...MONTHS_2026.map(m => m.replace('-', ' ')),
  ]

  const series = BVS.map(bv => {
    const t = buildDeclarabilityTrend(bv)
    const vals = combinedLabels.map(l => {
      const idx = t.labels.findIndex(x => x.replace('-', ' ') === l)
      return idx >= 0 ? t.values[idx] : 0
    })
    return { name: bv, labels: combinedLabels, values: vals }
  })

  slide.addText('Declarability % per BV (uren gefactureerd / uren geschreven)', {
    x: 0.6, y: 1.15, w: PAGE_W - 1.2, h: 0.35,
    fontFace: 'Inter', fontSize: 12, color: BRAND.text,
  })
  slide.addChart(pptx.ChartType.line, series, {
    x: 0.6, y: 1.5, w: PAGE_W - 1.2, h: 3.4,
    chartColors: BVS.map(bv => BV_COLOR[bv as EntityName]),
    lineSize: 2.5, lineDataSymbolSize: 5,
    catAxisLabelColor: BRAND.muted, catAxisLabelFontSize: 7, catAxisLabelRotate: -45,
    valAxisLabelColor: BRAND.muted, valAxisLabelFontSize: 9,
    valAxisLabelFormatCode: '0"%"',
    valAxisMinVal: 60, valAxisMaxVal: 100,
    showLegend: true, legendPos: 'b', legendColor: BRAND.muted, legendFontSize: 10,
    plotArea: { fill: { color: BRAND.bgCard } },
    valGridLine: { color: '232E4A', style: 'dot', size: 0.5 },
  })

  // Per-BV samenvattingstabel
  const ytd25MEq = ytd2025EquivalentMonths(ytdMonths)
  const header: PptxGenJS.TableRow = [
    { text: 'BV', options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard } } },
    { text: 'Geschreven YTD 26', options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'Declarabel YTD 26', options: { bold: true, color: BRAND.green, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: '% YTD 26',           options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: '% YTD 25',           options: { bold: true, color: BRAND.subtle, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'Δ punten',           options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
  ]
  const rows: PptxGenJS.TableRow[] = [header]
  for (const bv of BVS) {
    const w26 = sumHours(hoursData2026, bv, ytdMonths, 'written')
    const d26 = sumHours(hoursData2026, bv, ytdMonths, 'declarable')
    const w25 = sumHours(hoursData2025, bv, ytd25MEq, 'written')
    const d25 = sumHours(hoursData2025, bv, ytd25MEq, 'declarable')
    const p26 = w26 > 0 ? d26 / w26 * 100 : 0
    const p25 = w25 > 0 ? d25 / w25 * 100 : 0
    const diff = p26 - p25
    rows.push([
      { text: bv, options: { bold: true, color: BV_COLOR[bv as EntityName] } },
      { text: w26.toLocaleString('nl-NL') + ' u', options: { color: BRAND.text, align: 'right' } },
      { text: d26.toLocaleString('nl-NL') + ' u', options: { color: BRAND.green, align: 'right' } },
      { text: p26.toFixed(1) + '%', options: { color: BRAND.text, align: 'right', bold: true } },
      { text: p25.toFixed(1) + '%', options: { color: BRAND.subtle, align: 'right' } },
      { text: `${diff > 0 ? '+' : ''}${diff.toFixed(1)} pp`, options: { color: diff >= 0 ? BRAND.green : BRAND.red, align: 'right', bold: true } },
    ])
  }
  slide.addTable(rows, {
    x: 0.6, y: 5.05, w: PAGE_W - 1.2,
    fontFace: 'Inter', fontSize: 10, color: BRAND.text,
    border: { type: 'solid', color: '232E4A', pt: 0.5 },
  })
  addFooter(slide, monthLabel)
}

/** OHW status per BV — ontwikkeling laatste 12 maanden + mutaties + alerts */
function slideOhwStatus(pptx: PptxGenJS, monthLabel: string, month: string, ohwData: OhwYearData, num: number) {
  const slide = pptx.addSlide()
  slide.background = { color: BRAND.bgDark }
  addSectionHeader(slide, 'Onderhanden Werk — status & mutaties', num)

  const entities = ohwData.entities
  const showMonths = ohwData.displayMonths.slice(-12)

  // Chart bovenin
  slide.addText('OHW totaal per BV (€, laatste 12 maanden)', {
    x: 0.6, y: 1.15, w: PAGE_W - 1.2, h: 0.35,
    fontFace: 'Inter', fontSize: 12, color: BRAND.text,
  })
  const chartData = entities.map(e => ({
    name: e.entity,
    labels: showMonths,
    values: showMonths.map(m => (e.totaalOnderhanden[m] ?? 0) / 1000),
  }))
  slide.addChart(pptx.ChartType.line, chartData, {
    x: 0.6, y: 1.5, w: PAGE_W - 1.2, h: 2.8,
    chartColors: entities.map(e => BV_COLOR[e.entity as EntityName] ?? BRAND.primary),
    lineSize: 3, lineDataSymbolSize: 6,
    catAxisLabelColor: BRAND.muted, catAxisLabelFontSize: 9, catAxisLabelRotate: -30,
    valAxisLabelColor: BRAND.muted, valAxisLabelFontSize: 9,
    valAxisLabelFormatCode: '#,##0" k"',
    showLegend: true, legendPos: 'b', legendColor: BRAND.muted, legendFontSize: 10,
    plotArea: { fill: { color: BRAND.bgCard } },
    valGridLine: { color: '232E4A', style: 'dot', size: 0.5 },
  })

  // Status tabel
  const header: PptxGenJS.TableRow = [
    { text: 'BV',            options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard } } },
    { text: `OHW ${month}`,  options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'Mutatie maand', options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: '3-maands trend',options: { bold: true, color: BRAND.subtle, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'Status',        options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard } } },
    { text: 'Debiteuren',    options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
  ]
  const rows: PptxGenJS.TableRow[] = [header]
  for (const e of entities) {
    const cur = e.totaalOnderhanden[month] ?? 0
    const prevIdx = showMonths.indexOf(month) - 1
    const prev = prevIdx >= 0 ? (e.totaalOnderhanden[showMonths[prevIdx]] ?? 0) : 0
    const delta = cur - prev
    // 3-maands trend: verschil tussen laatste en 3 maanden geleden
    const trend = prevIdx >= 2
      ? cur - (e.totaalOnderhanden[showMonths[prevIdx - 1]] ?? 0)
      : 0
    let status = '● Stabiel'
    let statusColor: string = BRAND.green
    if (Math.abs(delta) > cur * 0.2) {
      status = delta > 0 ? '▲ Sterke opbouw' : '▼ Sterke afname'
      statusColor = delta > 0 ? BRAND.amber : BRAND.primary
    } else if (cur > 1_000_000) {
      status = '⚠ Hoog saldo'
      statusColor = BRAND.amber
    }
    const deb = e.debiteuren[month] ?? 0
    rows.push([
      { text: e.entity, options: { bold: true, color: BV_COLOR[e.entity as EntityName] ?? BRAND.primary } },
      { text: fmtEur(cur), options: { color: BRAND.text, align: 'right' } },
      { text: (delta > 0 ? '+' : '') + fmtEur(delta), options: { color: delta >= 0 ? BRAND.amber : BRAND.primary, align: 'right', bold: true } },
      { text: (trend > 0 ? '▲ ' : trend < 0 ? '▼ ' : '—') + fmtEur(Math.abs(trend)), options: { color: BRAND.subtle, align: 'right' } },
      { text: status, options: { color: statusColor, bold: true } },
      { text: fmtEur(deb), options: { color: BRAND.text, align: 'right' } },
    ])
  }
  slide.addTable(rows, {
    x: 0.6, y: 4.5, w: PAGE_W - 1.2,
    fontFace: 'Inter', fontSize: 10, color: BRAND.text,
    border: { type: 'solid', color: '232E4A', pt: 0.5 },
  })

  // Inzicht
  const tot = entities.reduce((s, e) => s + (e.totaalOnderhanden[month] ?? 0), 0)
  slide.addText(`Totaal OHW over alle BVs: ${fmtEur(tot)}`, {
    x: 0.6, y: 6.6, w: PAGE_W - 1.2, h: 0.3,
    fontFace: 'Inter', fontSize: 11, bold: true, color: BRAND.primary,
  })
  addFooter(slide, monthLabel)
}

/** Facturatie pipeline — goedgekeurde uploads voor conceptfacturen, D-lijst,
 *  missing hours, uren lijst per maand (laatste 6 maanden) */
function slideFacturatiePipeline(
  pptx: PptxGenJS, monthLabel: string, month: string,
  importRecords: ImportRecord[], num: number,
) {
  const slide = pptx.addSlide()
  slide.background = { color: BRAND.bgDark }
  addSectionHeader(slide, 'Facturatie pipeline — open posten & mutaties', num)

  const pipelineSlots = [
    { id: 'conceptfacturen', label: 'Conceptfacturen',   desc: 'SAP conceptfacturen wachtend op afhandeling', color: BRAND.primary },
    { id: 'd_lijst',         label: 'D-lijst (Consult.)', desc: 'Declarabele uren Consultancy (open voor facturatie)', color: BRAND.primary },
    { id: 'uren_lijst',      label: 'Uren-lijst (Proj.)', desc: 'U-Projecten met tarief (wachtend op facturatie)', color: BRAND.green },
    { id: 'missing_hours',   label: 'Missing hours',      desc: 'Uren niet geboekt/goedgekeurd — potentiële facturatie', color: BRAND.amber },
  ]

  // Per slot: totaal laatste maand + trend (aantal recent benaderde records)
  const approvedBySlot = (slotId: string) => importRecords
    .filter(r => r.slotId === slotId && r.status === 'approved')
    .sort((a, b) => a.month.localeCompare(b.month))

  // 4 KPI cards — één per slot
  const cw = (PAGE_W - 1.6) / 4, cy = 1.15, ch = 1.4, gap = 0.2
  pipelineSlots.forEach((slot, i) => {
    const recs = approvedBySlot(slot.id)
    const thisMonthRec = recs.find(r => r.month === month)
    const prevMonthRec = recs.length >= 2 ? recs[recs.length - 2] : undefined
    const cur = thisMonthRec?.totalAmount ?? 0
    const prev = prevMonthRec?.totalAmount ?? 0
    const delta = cur - prev
    const sub = thisMonthRec
      ? prev > 0
        ? `vs vorige: ${delta >= 0 ? '+' : ''}${fmtEur(delta)}`
        : 'eerste maand'
      : 'Geen goedgekeurd bestand'
    addKpiCard(slide, 0.6 + i * (cw + gap), cy, cw, ch, slot.label, fmtEurK(cur), sub, slot.color)
  })

  // Tabel: laatste 6 maanden × 4 slots
  const allMonths = [...new Set(importRecords.map(r => r.month))].sort().slice(-6)
  const header: PptxGenJS.TableRow = [
    { text: 'Slot', options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard } } },
    ...allMonths.map(m => ({ text: m, options: { bold: true, color: BRAND.subtle, fill: { color: BRAND.bgCard }, align: 'right' as const } })),
    { text: 'Trend', options: { bold: true, color: BRAND.primary, fill: { color: BRAND.bgCard }, align: 'center' } },
  ]
  const rows: PptxGenJS.TableRow[] = [header]
  for (const slot of pipelineSlots) {
    const recs = approvedBySlot(slot.id)
    const byMonth = allMonths.map(m => recs.find(r => r.month === m)?.totalAmount ?? 0)
    const firstNonZero = byMonth.find(v => v > 0) ?? 0
    const lastNonZero = byMonth.slice().reverse().find(v => v > 0) ?? 0
    const trendSymbol = lastNonZero === 0
      ? '—'
      : lastNonZero > firstNonZero ? '▲' : lastNonZero < firstNonZero ? '▼' : '●'
    rows.push([
      { text: slot.label, options: { bold: true, color: slot.color } },
      ...byMonth.map(v => ({
        text: v === 0 ? '—' : fmtEur(v),
        options: { color: v === 0 ? BRAND.subtle : BRAND.text, align: 'right' as const },
      })),
      { text: trendSymbol, options: {
        color: trendSymbol === '▲' ? BRAND.green : trendSymbol === '▼' ? BRAND.red : BRAND.subtle,
        align: 'center' as const, bold: true, fontSize: 14,
      } },
    ])
  }
  slide.addTable(rows, {
    x: 0.6, y: 2.85, w: PAGE_W - 1.2,
    fontFace: 'Inter', fontSize: 10, color: BRAND.text,
    border: { type: 'solid', color: '232E4A', pt: 0.5 },
  })

  // Inzicht onder tabel
  const totalPipeline = pipelineSlots.reduce((s, slot) => {
    const r = approvedBySlot(slot.id).find(r => r.month === month)
    return s + (r?.totalAmount ?? 0)
  }, 0)
  slide.addText(`Open pipeline ${month}: ${fmtEur(totalPipeline)} — potentieel te factureren / te verwerken.`, {
    x: 0.6, y: 5.3, w: PAGE_W - 1.2, h: 0.4,
    fontFace: 'Inter', fontSize: 12, bold: true, color: BRAND.primary,
  })
  const extra: string[] = []
  const concept = approvedBySlot('conceptfacturen').find(r => r.month === month)
  if (concept && concept.totalAmount > 100_000) {
    extra.push(`● Conceptfacturen ${fmtEurK(concept.totalAmount)} open — actie vereist voor afhandeling.`)
  }
  const dl = approvedBySlot('d_lijst').find(r => r.month === month)
  if (dl) extra.push(`● Declarabele uren Consultancy (D-lijst): ${fmtEurK(dl.totalAmount)} klaar voor facturatie.`)
  const mh = approvedBySlot('missing_hours').find(r => r.month === month)
  if (mh) extra.push(`● Missing hours Consultancy: ${fmtEurK(mh.totalAmount)} nog niet geboekt/goedgekeurd.`)
  slide.addText(extra.join('\n'), {
    x: 0.6, y: 5.7, w: PAGE_W - 1.2, h: 1.3,
    fontFace: 'Inter', fontSize: 11, color: BRAND.text, valign: 'top',
    paraSpaceAfter: 4, lineSpacingMultiple: 1.3,
  })
  addFooter(slide, monthLabel)
}

/** Zoom section divider (tussenblad in TPG brand) */
function slideSectionDivider(pptx: PptxGenJS, title: string, subtitle: string) {
  const slide = pptx.addSlide()
  slide.background = { color: BRAND.primary }
  slide.addText(title, {
    x: 0.5, y: 2.8, w: PAGE_W - 1, h: 1.2,
    fontFace: 'Inter', fontSize: 44, bold: true, color: 'FFFFFF', align: 'center',
  })
  slide.addText(subtitle, {
    x: 0.5, y: 4.2, w: PAGE_W - 1, h: 0.8,
    fontFace: 'Inter', fontSize: 16, color: 'FFFFFF', align: 'center',
  })
}

/** Per BV — full budget vs actuals tabel + KPIs + mini trend chart + toelichting */
function slideBvFull(pptx: PptxGenJS, bv: BvId, monthLabel: string, month: string, ytdMonths: string[], num: number) {
  const slide = pptx.addSlide()
  slide.background = { color: BRAND.bgDark }
  addSectionHeader(slide, `Finance: ${bv} — volledig overzicht`, num)

  const color = BV_COLOR[bv as EntityName]
  const ytd25MEq = ytd2025EquivalentMonths(ytdMonths)

  // KPIs
  const omzet_m   = monthValue(bv, month, 'netto_omzet', 'actual')
  const budget_m  = monthValue(bv, month, 'netto_omzet', 'budget')
  const omzet_y   = ytdValue(bv, ytdMonths, 'netto_omzet', 'actual')
  const budget_y  = ytdValue(bv, ytdMonths, 'netto_omzet', 'budget')
  const omzet_ly  = ytdValue(bv, ytd25MEq, 'netto_omzet', 'actual2025')
  const marge_y   = ytdValue(bv, ytdMonths, 'brutomarge', 'actual')
  const ebitda_y  = ytdValue(bv, ytdMonths, 'ebitda', 'actual')
  const margePct  = omzet_y > 0 ? marge_y / omzet_y * 100 : 0
  const yoy       = omzet_ly > 0 ? ((omzet_y / omzet_ly - 1) * 100) : 0
  const declW_y   = sumHours(hoursData2026, bv, ytdMonths, 'written')
  const declD_y   = sumHours(hoursData2026, bv, ytdMonths, 'declarable')
  const declPct   = declW_y > 0 ? declD_y / declW_y * 100 : 0

  const cw = (PAGE_W - 1.6) / 4, cy = 1.1, ch = 1.05, gap = 0.2
  addKpiCard(slide, 0.6 + 0 * (cw + gap), cy, cw, ch, `Omzet ${monthLabel}`, fmtEurK(omzet_m), `vs budget ${fmtEurK(omzet_m - budget_m)}`, color)
  addKpiCard(slide, 0.6 + 1 * (cw + gap), cy, cw, ch, 'Omzet YTD', fmtEurK(omzet_y), `${fmtPct(yoy)} YoY · ${fmtPct((omzet_y / Math.max(1, budget_y) - 1) * 100)} vs budget`, color)
  addKpiCard(slide, 0.6 + 2 * (cw + gap), cy, cw, ch, 'Marge YTD / EBITDA', `${margePct.toFixed(1)}%`, `EBITDA ${fmtEurK(ebitda_y)}`, ebitda_y >= 0 ? BRAND.green : BRAND.red)
  addKpiCard(slide, 0.6 + 3 * (cw + gap), cy, cw, ch, 'Declarabiliteit YTD', `${declPct.toFixed(1)}%`, `${declW_y.toLocaleString('nl-NL')} u geschreven`, BRAND.amber)

  // Full P&L tabel (links)
  const rowsPl: PptxGenJS.TableRow[] = [[
    { text: 'P&L regel',    options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, fontSize: 9 } },
    { text: monthLabel,     options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right', fontSize: 9 } },
    { text: 'Budget',       options: { bold: true, color: BRAND.subtle, fill: { color: BRAND.bgCard }, align: 'right', fontSize: 9 } },
    { text: 'Δ Bud',        options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right', fontSize: 9 } },
    { text: 'YTD 26',       options: { bold: true, color: BRAND.primary, fill: { color: BRAND.bgCard }, align: 'right', fontSize: 9 } },
    { text: 'Budget YTD',   options: { bold: true, color: BRAND.subtle, fill: { color: BRAND.bgCard }, align: 'right', fontSize: 9 } },
    { text: 'YTD 25',       options: { bold: true, color: BRAND.subtle, fill: { color: BRAND.bgCard }, align: 'right', fontSize: 9 } },
  ]]
  const mainKeys = [
    { key: 'netto_omzet',                label: 'Netto-omzet',                  bold: true },
    { key: 'directe_kosten',             label: '  Directe kosten',             bold: false },
    { key: 'brutomarge',                 label: 'Brutomarge',                   bold: true },
    { key: 'operationele_kosten',        label: '  Operationele kosten',        bold: false },
    { key: 'ebitda',                     label: 'EBITDA',                       bold: true },
    { key: 'amortisatie_afschrijvingen', label: '  Amortisatie & afschrijving', bold: false },
    { key: 'ebit',                       label: 'EBIT',                         bold: true },
  ]
  for (const k of mainKeys) {
    const m_a = monthValue(bv, month, k.key, 'actual')
    const m_b = monthValue(bv, month, k.key, 'budget')
    const y_a = ytdValue(bv, ytdMonths, k.key, 'actual')
    const y_b = ytdValue(bv, ytdMonths, k.key, 'budget')
    const y_ly = ytdValue(bv, ytd25MEq, k.key, 'actual2025')
    const deltaM = m_a - m_b
    // Costs staan als negatieve waarden in plData; delta > 0 betekent voor
    // zowel omzet als kosten dat de actuals gunstiger zijn dan budget.
    const deltaColor = deltaM === 0
      ? BRAND.subtle
      : (deltaM > 0 ? BRAND.green : BRAND.red)
    rowsPl.push([
      { text: k.label, options: { color: BRAND.text, bold: k.bold, fontSize: 10 } },
      { text: fmtEur(m_a), options: { color: BRAND.text, bold: k.bold, align: 'right', fontSize: 10 } },
      { text: fmtEur(m_b), options: { color: BRAND.subtle, align: 'right', fontSize: 10 } },
      { text: (deltaM > 0 ? '+' : '') + fmtEur(deltaM), options: { color: deltaColor, align: 'right', bold: true, fontSize: 10 } },
      { text: fmtEur(y_a), options: { color: BRAND.primary, bold: k.bold, align: 'right', fontSize: 10 } },
      { text: fmtEur(y_b), options: { color: BRAND.subtle, align: 'right', fontSize: 10 } },
      { text: fmtEur(y_ly), options: { color: BRAND.subtle, align: 'right', fontSize: 10 } },
    ])
  }
  slide.addTable(rowsPl, {
    x: 0.6, y: 2.3, w: 7.8,
    fontFace: 'Inter', fontSize: 10, color: BRAND.text,
    border: { type: 'solid', color: '232E4A', pt: 0.3 },
  })

  // Mini trendchart rechts
  slide.addText('Omzet + marge trend (€k)', {
    x: 8.6, y: 2.3, w: 4.2, h: 0.35,
    fontFace: 'Inter', fontSize: 11, bold: true, color: BRAND.text,
  })
  const trendLabels = [...MONTHS_2025.slice(-6).map(m => m.replace('-', ' ')), ...ytdMonths.map(m => m.replace('-', ' '))]
  const omzetSeries = [
    ...MONTHS_2025.slice(-6).map(m => monthValue(bv, m, 'netto_omzet', 'actual2025') / 1000),
    ...ytdMonths.map(m => monthValue(bv, m, 'netto_omzet', 'actual') / 1000),
  ]
  const margeSeries = [
    ...MONTHS_2025.slice(-6).map(m => monthValue(bv, m, 'brutomarge', 'actual2025') / 1000),
    ...ytdMonths.map(m => monthValue(bv, m, 'brutomarge', 'actual') / 1000),
  ]
  slide.addChart(pptx.ChartType.line, [
    { name: 'Omzet',      labels: trendLabels, values: omzetSeries },
    { name: 'Brutomarge', labels: trendLabels, values: margeSeries },
  ], {
    x: 8.6, y: 2.65, w: 4.2, h: 2.5,
    chartColors: [color, BRAND.amber],
    lineSize: 2.5, lineDataSymbolSize: 5,
    catAxisLabelColor: BRAND.muted, catAxisLabelFontSize: 7, catAxisLabelRotate: -45,
    valAxisLabelColor: BRAND.muted, valAxisLabelFontSize: 8,
    valAxisLabelFormatCode: '#,##0" k"',
    showLegend: true, legendPos: 'b', legendColor: BRAND.muted, legendFontSize: 9,
    plotArea: { fill: { color: BRAND.bgCard } },
    valGridLine: { color: '232E4A', style: 'dot', size: 0.5 },
  })

  // Toelichting (onderaan rechts)
  slide.addText('Toelichting', {
    x: 8.6, y: 5.3, w: 4.2, h: 0.3,
    fontFace: 'Inter', fontSize: 11, bold: true, color: BRAND.primary,
  })
  const notes: string[] = []
  const budgetDelta = omzet_y - budget_y
  if (budgetDelta >= 0) notes.push(`• Omzet YTD ligt ${fmtEurK(budgetDelta)} boven budget.`)
  else                  notes.push(`• Omzet YTD ligt ${fmtEurK(Math.abs(budgetDelta))} onder budget.`)
  notes.push(`• YoY: ${fmtPct(yoy)} vs 2025 ${fmtEurK(omzet_ly)}.`)
  if (margePct >= 30) notes.push(`• Marge ${margePct.toFixed(1)}% — sterk.`)
  else if (margePct < 20) notes.push(`• Marge ${margePct.toFixed(1)}% vraagt aandacht.`)
  if (ebitda_y < 0) notes.push('• EBITDA negatief — operationele kosten drukken.')
  else              notes.push(`• EBITDA positief: ${fmtEurK(ebitda_y)}.`)
  slide.addText(notes.join('\n'), {
    x: 8.6, y: 5.65, w: 4.2, h: 1.5,
    fontFace: 'Inter', fontSize: 10, color: BRAND.text, valign: 'top',
    paraSpaceAfter: 4, lineSpacingMultiple: 1.3,
  })
  addFooter(slide, monthLabel)
}

/** Balansposities — debiteuren + OHW saldo per BV, werkkapitaal indicator */
function slideBalans(pptx: PptxGenJS, monthLabel: string, month: string, ohwData: OhwYearData, num: number) {
  const slide = pptx.addSlide()
  slide.background = { color: BRAND.bgDark }
  addSectionHeader(slide, 'Balansposities — werkkapitaal', num)

  const entities = ohwData.entities
  const chartData: PptxGenJS.IChartMulti[] | any = entities.map(e => ({
    name: e.entity,
    labels: ['Debiteuren', 'OHW'],
    values: [(e.debiteuren[month] ?? 0) / 1000, (e.totaalOnderhanden[month] ?? 0) / 1000],
  }))
  slide.addText(`Werkkapitaal posities per BV — ${monthLabel} (€k)`, {
    x: 0.6, y: 1.15, w: PAGE_W - 1.2, h: 0.35,
    fontFace: 'Inter', fontSize: 12, color: BRAND.text,
  })
  slide.addChart(pptx.ChartType.bar, chartData, {
    x: 0.6, y: 1.5, w: 6.5, h: 3.8,
    barDir: 'col', barGrouping: 'clustered',
    chartColors: entities.map(e => BV_COLOR[e.entity as EntityName] ?? BRAND.primary),
    showValue: true, dataLabelFontSize: 9, dataLabelColor: BRAND.text,
    dataLabelFormatCode: '#,##0" k"',
    catAxisLabelColor: BRAND.muted, catAxisLabelFontSize: 11,
    valAxisLabelColor: BRAND.muted, valAxisLabelFontSize: 9,
    valAxisLabelFormatCode: '#,##0" k"',
    showLegend: true, legendPos: 'b', legendColor: BRAND.muted, legendFontSize: 10,
    plotArea: { fill: { color: BRAND.bgCard } },
    valGridLine: { color: '232E4A', style: 'dot', size: 0.5 },
  })

  // Samenvattingstabel
  const header: PptxGenJS.TableRow = [
    { text: 'BV', options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard } } },
    { text: 'Debiteuren', options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'OHW', options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'Factuurvol.', options: { bold: true, color: BRAND.subtle, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'Werkkapitaal indic.', options: { bold: true, color: BRAND.primary, fill: { color: BRAND.bgCard }, align: 'right' } },
  ]
  const rows: PptxGenJS.TableRow[] = [header]
  let tDeb = 0, tOhw = 0
  for (const e of entities) {
    const deb = e.debiteuren[month] ?? 0
    const ohw = e.totaalOnderhanden[month] ?? 0
    const fv = e.factuurvolume[month] ?? 0
    const wcDays = fv > 0 ? ((deb + ohw) / fv * 30).toFixed(1) + ' dg' : '—'
    tDeb += deb; tOhw += ohw
    rows.push([
      { text: e.entity, options: { bold: true, color: BV_COLOR[e.entity as EntityName] ?? BRAND.primary } },
      { text: fmtEur(deb), options: { color: BRAND.text, align: 'right' } },
      { text: fmtEur(ohw), options: { color: BRAND.text, align: 'right' } },
      { text: fmtEur(fv), options: { color: BRAND.subtle, align: 'right' } },
      { text: wcDays, options: { color: BRAND.primary, align: 'right', bold: true } },
    ])
  }
  rows.push([
    { text: 'Totaal', options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard2 } } },
    { text: fmtEur(tDeb), options: { bold: true, color: BRAND.text, align: 'right', fill: { color: BRAND.bgCard2 } } },
    { text: fmtEur(tOhw), options: { bold: true, color: BRAND.text, align: 'right', fill: { color: BRAND.bgCard2 } } },
    { text: '', options: { fill: { color: BRAND.bgCard2 } } },
    { text: fmtEur(tDeb + tOhw), options: { bold: true, color: BRAND.primary, align: 'right', fill: { color: BRAND.bgCard2 } } },
  ])
  slide.addTable(rows, {
    x: 7.3, y: 1.5, w: 5.5,
    fontFace: 'Inter', fontSize: 10, color: BRAND.text,
    border: { type: 'solid', color: '232E4A', pt: 0.5 },
  })
  addFooter(slide, monthLabel)
}

/** Forecast scenarios — conservatief (YTD run-rate), current (met seizoen),
 *  optimistisch (+5% volume) */
function slideForecastScenarios(pptx: PptxGenJS, monthLabel: string, ytdMonths: string[], num: number) {
  const slide = pptx.addSlide()
  slide.background = { color: BRAND.bgDark }
  addSectionHeader(slide, 'Forecast & scenarios FY 2026', num)

  const bvs = BVS
  // Totals
  const ytdSum = bvs.reduce((s, bv) => s + ytdValue(bv, ytdMonths, 'netto_omzet', 'actual'), 0)
  const monthsSoFar = ytdMonths.length
  const conservFY = ytdSum * (12 / Math.max(1, monthsSoFar))     // lineaire extrapolatie
  // Seasonal-adjusted: gebruik 2025 seizoensweging
  const ytd25M = ytd2025EquivalentMonths(ytdMonths)
  const ytd25Sum = bvs.reduce((s, bv) => s + ytdValue(bv, ytd25M, 'netto_omzet', 'actual2025'), 0)
  const fy25     = bvs.reduce((s, bv) => MONTHS_2025.reduce((ss, m) => ss + monthValue(bv, m, 'netto_omzet', 'actual2025'), s), 0)
  const seasonalFactor = ytd25Sum > 0 ? fy25 / ytd25Sum : 12 / Math.max(1, monthsSoFar)
  const currentFY = ytdSum * seasonalFactor
  const optimistFY = currentFY * 1.05
  const budgetFY = bvs.reduce((s, bv) => s + (ytdBudget2026[bv]?.netto_omzet ?? 0), 0)

  slide.addText('FY 2026 projecties (€k)', {
    x: 0.6, y: 1.15, w: PAGE_W - 1.2, h: 0.35,
    fontFace: 'Inter', fontSize: 12, color: BRAND.text,
  })
  slide.addChart(pptx.ChartType.bar, [
    { name: 'YTD actuals',      labels: ['FY 2026'], values: [ytdSum / 1000] },
    { name: 'Conservatief',     labels: ['FY 2026'], values: [conservFY / 1000] },
    { name: 'Seizoen-adjusted', labels: ['FY 2026'], values: [currentFY / 1000] },
    { name: 'Optimistisch +5%', labels: ['FY 2026'], values: [optimistFY / 1000] },
    { name: 'Budget FY',        labels: ['FY 2026'], values: [budgetFY / 1000] },
  ], {
    x: 0.6, y: 1.5, w: 6.5, h: 3.8,
    barDir: 'col', barGrouping: 'clustered',
    chartColors: [BRAND.subtle, BRAND.amber, BRAND.primary, BRAND.green, '8FA3C0'],
    showValue: true, dataLabelFontSize: 9, dataLabelColor: BRAND.text,
    dataLabelFormatCode: '#,##0" k"',
    catAxisLabelColor: BRAND.muted, catAxisLabelFontSize: 11,
    valAxisLabelColor: BRAND.muted, valAxisLabelFontSize: 9,
    valAxisLabelFormatCode: '#,##0" k"',
    showLegend: true, legendPos: 'b', legendColor: BRAND.muted, legendFontSize: 9,
    plotArea: { fill: { color: BRAND.bgCard } },
  })

  // Per-BV scenario tabel
  const header: PptxGenJS.TableRow = [
    { text: 'BV',           options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard } } },
    { text: 'YTD',          options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'Conservatief', options: { bold: true, color: BRAND.amber, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'Seizoen-adj.', options: { bold: true, color: BRAND.primary, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'Optimist +5%', options: { bold: true, color: BRAND.green, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'FY Budget',    options: { bold: true, color: BRAND.subtle, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'Δ vs budget',  options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
  ]
  const rows: PptxGenJS.TableRow[] = [header]
  for (const bv of bvs) {
    const ytd = ytdValue(bv, ytdMonths, 'netto_omzet', 'actual')
    const fy25bv = MONTHS_2025.reduce((s, m) => s + monthValue(bv, m, 'netto_omzet', 'actual2025'), 0)
    const ytd25bv = ytdValue(bv, ytd25M, 'netto_omzet', 'actual2025')
    const factor = ytd25bv > 0 ? fy25bv / ytd25bv : 12 / Math.max(1, monthsSoFar)
    const conserv = ytd * (12 / Math.max(1, monthsSoFar))
    const seasonal = ytd * factor
    const optim = seasonal * 1.05
    const budget = ytdBudget2026[bv]?.netto_omzet ?? 0
    const delta = seasonal - budget
    rows.push([
      { text: bv, options: { bold: true, color: BV_COLOR[bv as EntityName] } },
      { text: fmtEur(ytd), options: { color: BRAND.text, align: 'right' } },
      { text: fmtEur(conserv), options: { color: BRAND.amber, align: 'right' } },
      { text: fmtEur(seasonal), options: { color: BRAND.primary, align: 'right', bold: true } },
      { text: fmtEur(optim), options: { color: BRAND.green, align: 'right' } },
      { text: fmtEur(budget), options: { color: BRAND.subtle, align: 'right' } },
      { text: fmtPct(budget > 0 ? delta / budget * 100 : 0),
        options: { color: delta >= 0 ? BRAND.green : BRAND.red, align: 'right', bold: true } },
    ])
  }
  slide.addTable(rows, {
    x: 7.3, y: 1.5, w: 5.5,
    fontFace: 'Inter', fontSize: 10, color: BRAND.text,
    border: { type: 'solid', color: '232E4A', pt: 0.5 },
  })

  // Methodologie-noot
  const method = [
    '● Conservatief: lineaire extrapolatie (YTD × 12/n maanden)',
    '● Seizoen-adjusted: toegepast 2025-seizoenspatroon op YTD run-rate',
    '● Optimistisch: seizoen-adjusted × 1.05 (volume +5% H2)',
  ].join('\n')
  slide.addText(method, {
    x: 0.6, y: 5.5, w: PAGE_W - 1.2, h: 1.2,
    fontFace: 'Inter', fontSize: 10, color: BRAND.muted, valign: 'top',
    paraSpaceAfter: 3, lineSpacingMultiple: 1.3,
  })
  addFooter(slide, monthLabel)
}

/** Bijlage — closing entries tabel */
function slideBijlage(pptx: PptxGenJS, monthLabel: string, closingEntries: ClosingEntry[], num: number) {
  const slide = pptx.addSlide()
  slide.background = { color: BRAND.bgDark }
  addSectionHeader(slide, 'Bijlage — Maandafsluiting details', num)

  slide.addText('Closing entries vastgelegd in de app', {
    x: 0.6, y: 1.15, w: PAGE_W - 1.2, h: 0.3,
    fontFace: 'Inter', fontSize: 12, color: BRAND.muted,
  })

  const header: PptxGenJS.TableRow = [
    { text: 'BV',        options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard } } },
    { text: 'Factuurvolume', options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'Debiteuren',    options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'OHW mutatie',   options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'Accruals',      options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'Correctie',     options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'Opmerking',     options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard } } },
  ]
  const rows: PptxGenJS.TableRow[] = [header]
  for (const e of closingEntries) {
    rows.push([
      { text: e.bv, options: { bold: true, color: BV_COLOR[e.bv as EntityName] ?? BRAND.primary } },
      { text: fmtEur(e.factuurvolume), options: { color: BRAND.text, align: 'right' } },
      { text: fmtEur(e.debiteuren), options: { color: BRAND.text, align: 'right' } },
      { text: fmtEur(e.ohwMutatie), options: { color: BRAND.text, align: 'right' } },
      { text: fmtEur(e.accruals), options: { color: BRAND.text, align: 'right' } },
      { text: fmtEur(e.handmatigeCorrectie), options: { color: BRAND.text, align: 'right' } },
      { text: e.remark ?? '', options: { color: BRAND.muted, fontSize: 9 } },
    ])
  }
  slide.addTable(rows, {
    x: 0.6, y: 1.6, w: PAGE_W - 1.2,
    fontFace: 'Inter', fontSize: 10, color: BRAND.text,
    border: { type: 'solid', color: '232E4A', pt: 0.5 },
  })

  // Referentie naar PL_STRUCTURE en aantal regels
  slide.addText(
    `P&L bevat ${PL_STRUCTURE.filter(p => !p.isSeparator && !p.isPercentage).length} regels · ` +
    `Volledige data beschikbaar in de ZIP-bundle exports per BV, per maand.`,
    {
      x: 0.6, y: PAGE_H - 0.8, w: PAGE_W - 1.2, h: 0.3,
      fontFace: 'Inter', fontSize: 10, color: BRAND.subtle,
    },
  )
  slide.addText(`Gegenereerd op ${new Date().toLocaleString('nl-NL')} · Maand: ${monthLabel}`, {
    x: 0.6, y: PAGE_H - 0.45, w: PAGE_W - 1.2, h: 0.3,
    fontFace: 'Inter', fontSize: 9, color: BRAND.subtle, align: 'right',
  })
  addFooter(slide, monthLabel)
}

// ─── Main entry ─────────────────────────────────────────────────────────

export interface GeneratePptxInput {
  month: string                  // "Mar-26"
  monthLabel: string             // "maart 2026"
  ytdMonths: string[]            // e.g. ['Jan-26','Feb-26','Mar-26']
  closingEntries: ClosingEntry[]
  ohwData2026: OhwYearData
  importRecords: ImportRecord[]  // voor facturatie-pipeline slide
}

export async function generateMonthPptx(input: GeneratePptxInput): Promise<void> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'TPG Finance'
  pptx.company = 'The People Group'
  pptx.title = `Maandrapportage ${input.monthLabel}`
  pptx.subject = `Maandrapportage ${input.month}`

  const logoB64 = await fetchImageAsBase64('/tpg-logo.png')

  // 1. Title + TOC
  slideTitle(pptx, input.monthLabel, logoB64)
  slideToc(pptx)

  // 2. Kern
  slideSummary(pptx, input.monthLabel, input.closingEntries, input.ytdMonths)
  slideOmzetTrend(pptx, input.monthLabel, input.ytdMonths, 4)
  slideMargineTrend(pptx, input.monthLabel, input.ytdMonths, 5)

  // 3. Operationeel
  slideDeclarabiliteit(pptx, input.monthLabel, input.ytdMonths, 6)
  slideOhwStatus(pptx, input.monthLabel, input.month, input.ohwData2026, 7)
  slideFacturatiePipeline(pptx, input.monthLabel, input.month, input.importRecords, 8)

  // 4. Per BV — divider + deep-dives
  slideSectionDivider(pptx, 'Zoom per business unit', `${input.monthLabel} · YTD + Vorig jaar`)
  let num = 10
  for (const bv of BVS) {
    slideBvFull(pptx, bv, input.monthLabel, input.month, input.ytdMonths, num++)
  }

  // 5. Vooruitblik
  slideBalans(pptx, input.monthLabel, input.month, input.ohwData2026, num++)
  slideForecastScenarios(pptx, input.monthLabel, input.ytdMonths, num++)

  // 6. Bijlage
  slideBijlage(pptx, input.monthLabel, input.closingEntries, num++)

  const filename = `TPG_Maandrapportage_${input.month.replace(/\s+/g, '_')}.pptx`
  await pptx.writeFile({ fileName: filename })
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
