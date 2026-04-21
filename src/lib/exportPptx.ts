/**
 * TPG maandrapportage PowerPoint generator.
 * Bouwt een 16:9 deck in The People Group huisstijl met:
 *  - Titelpagina met logo
 *  - Inhoudsopgave
 *  - Samenvatting / Kern
 *  - Finance: Resultaat (maand + YTD)
 *  - Finance: per BV (Consultancy, Projects, Software, Holdings)
 *  - OHW overzicht
 *  - Budget vs Actuals
 *  - Uren dashboard
 *  - Forecast / Vooruitblik
 *  - Bijlage
 */
import PptxGenJS from 'pptxgenjs'
import type { ClosingEntry, BvId, OhwYearData } from '../data/types'
import type { EntityName } from '../data/plData'
import { ytdActuals2025, ytdBudget2026, monthlyBudget2026, monthlyActuals2026 } from '../data/plData'

const BRAND = {
  primary:   '00A9E0',   // TPG cyan
  primaryDark: '0086B3',
  dark:      '070A12',
  text:      'EDF1FC',
  muted:     '8FA3C0',
  subtle:    '52657E',
  bgDark:    '0C1120',
  bgCard:    '111828',
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

function fmtEur(n: number): string {
  if (n === 0) return '€ 0'
  const neg = n < 0
  const abs = Math.abs(Math.round(n))
  return (neg ? '-€ ' : '€ ') + abs.toLocaleString('nl-NL')
}
function fmtEurK(n: number): string {
  return `€ ${Math.round(n / 1000).toLocaleString('nl-NL')}k`
}
function fmtPct(n: number): string {
  if (!isFinite(n)) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
}

/** Converteer PNG-bestand → base64 zodat pptxgenjs het kan embedden */
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

// ─── Helpers ─────────────────────────────────────────────────────────────

function addSectionHeader(slide: PptxGenJS.Slide, title: string, number: number | string) {
  // Left sidebar with brand color
  slide.addShape('rect' as 'rect', {
    x: 0, y: 0, w: 0.35, h: PAGE_H, fill: { color: BRAND.primary },
  })
  // Header bar with title
  slide.addText(title, {
    x: 0.6, y: 0.35, w: PAGE_W - 1.5, h: 0.6,
    fontFace: 'Inter', fontSize: 22, bold: true, color: BRAND.text,
  })
  // Slide number (bottom right)
  slide.addText(String(number), {
    x: PAGE_W - 0.8, y: PAGE_H - 0.5, w: 0.6, h: 0.35,
    fontFace: 'Inter', fontSize: 10, color: BRAND.subtle, align: 'right',
  })
  // Horizontal divider
  slide.addShape('rect' as 'rect', {
    x: 0.6, y: 1.0, w: PAGE_W - 1.2, h: 0.02,
    fill: { color: BRAND.primary }, line: { color: BRAND.primary },
  })
}

function addFooter(slide: PptxGenJS.Slide) {
  slide.addText('The People Group · Finance · Maandrapportage', {
    x: 0.6, y: PAGE_H - 0.4, w: 6, h: 0.3,
    fontFace: 'Inter', fontSize: 9, color: BRAND.subtle,
  })
}

function addKpiCard(
  slide: PptxGenJS.Slide,
  x: number, y: number, w: number, h: number,
  label: string, value: string, sub: string, color: string = BRAND.primary,
) {
  slide.addShape('roundRect' as 'roundRect', {
    x, y, w, h,
    fill: { color: BRAND.bgCard },
    line: { color: color, width: 0.5 },
    rectRadius: 0.08,
  })
  // left accent bar
  slide.addShape('rect' as 'rect', {
    x, y, w: 0.08, h,
    fill: { color },
  })
  slide.addText(label.toUpperCase(), {
    x: x + 0.2, y: y + 0.1, w: w - 0.4, h: 0.3,
    fontFace: 'Inter', fontSize: 9, bold: true, color: BRAND.subtle, charSpacing: 1.5,
  })
  slide.addText(value, {
    x: x + 0.2, y: y + 0.42, w: w - 0.4, h: 0.7,
    fontFace: 'Inter', fontSize: 22, bold: true, color,
  })
  slide.addText(sub, {
    x: x + 0.2, y: y + h - 0.45, w: w - 0.4, h: 0.3,
    fontFace: 'Inter', fontSize: 9, color: BRAND.muted,
  })
}

// ─── Data aggregation ────────────────────────────────────────────────────

interface MonthMetrics {
  bv: BvId
  netto_omzet: number
  brutomarge: number
  ebitda: number
  directe_kosten: number
  budget_omzet: number
  py_omzet: number
}

function getMonthMetrics(month: string, bv: BvId): MonthMetrics {
  const actual = monthlyActuals2026[bv as EntityName]?.[month] ?? {}
  const budget = monthlyBudget2026[bv as EntityName]?.[month] ?? {}
  return {
    bv,
    netto_omzet:    actual.netto_omzet ?? 0,
    brutomarge:     actual.brutomarge ?? 0,
    ebitda:         actual.ebitda ?? 0,
    directe_kosten: actual.directe_kosten ?? 0,
    budget_omzet:   budget.netto_omzet ?? 0,
    py_omzet:       (ytdActuals2025[bv as EntityName]?.netto_omzet ?? 0) / 12,
  }
}

function getYtdMetrics(months: string[], bv: BvId): MonthMetrics {
  const sum: MonthMetrics = {
    bv,
    netto_omzet: 0, brutomarge: 0, ebitda: 0, directe_kosten: 0,
    budget_omzet: 0, py_omzet: 0,
  }
  for (const m of months) {
    const met = getMonthMetrics(m, bv)
    sum.netto_omzet     += met.netto_omzet
    sum.brutomarge      += met.brutomarge
    sum.ebitda          += met.ebitda
    sum.directe_kosten  += met.directe_kosten
    sum.budget_omzet    += met.budget_omzet
    sum.py_omzet        += met.py_omzet
  }
  // PY = YTD actuals 2025 voor dezelfde maanden (deels pro-rata)
  return sum
}

// ─── Slide builders ──────────────────────────────────────────────────────

function slideTitle(pptx: PptxGenJS, _month: string, monthLabel: string, logoB64: string) {
  const slide = pptx.addSlide()
  slide.background = { color: BRAND.bgDark }
  // Big cyan block on left
  slide.addShape('rect' as 'rect', {
    x: 0, y: 0, w: 5.5, h: PAGE_H, fill: { color: BRAND.primary },
  })
  // Logo on right white panel
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
  // Title on cyan panel
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
  slide.addText('TPG Finance · Geautomatiseerd gegenereerd', {
    x: 0.5, y: PAGE_H - 0.6, w: 4.5, h: 0.3,
    fontFace: 'Inter', fontSize: 10, color: 'FFFFFF',
  })
}

function slideToc(pptx: PptxGenJS) {
  const slide = pptx.addSlide()
  slide.background = { color: BRAND.bgDark }
  addSectionHeader(slide, 'Inhoudsopgave', 2)
  const items = [
    ['Kern', ['Samenvatting', 'Finance — Maand resultaat', 'Finance — YTD overzicht']],
    ['Business units', ['Consultancy', 'Projects', 'Software', 'Holdings']],
    ['Details', ['OHW Overzicht', 'Budget vs Actuals', 'Uren & bezetting', 'Vooruitblik & forecast']],
    ['Bijlagen', ['Gegevens uit Maandafsluiting']],
  ]
  const startY = 1.4
  const colW = (PAGE_W - 1.2) / items.length
  items.forEach((col, i) => {
    slide.addText(col[0] as string, {
      x: 0.6 + i * colW, y: startY, w: colW - 0.2, h: 0.4,
      fontFace: 'Inter', fontSize: 14, bold: true, color: BRAND.primary, charSpacing: 1,
    })
    const sub = (col[1] as string[]).map((s, idx) => `${idx + 1}. ${s}`).join('\n')
    slide.addText(sub, {
      x: 0.6 + i * colW, y: startY + 0.5, w: colW - 0.2, h: 5,
      fontFace: 'Inter', fontSize: 12, color: BRAND.text, valign: 'top',
      paraSpaceAfter: 8,
    })
  })
  addFooter(slide)
}

function slideSummary(
  pptx: PptxGenJS,
  _month: string, monthLabel: string,
  closingEntries: ClosingEntry[],
  ytdMonths: string[],
) {
  const slide = pptx.addSlide()
  slide.background = { color: BRAND.bgDark }
  addSectionHeader(slide, `Samenvatting — ${monthLabel}`, 3)

  const bvs: BvId[] = ['Consultancy', 'Projects', 'Software']
  const ytdMetrics = bvs.map(bv => getYtdMetrics(ytdMonths, bv))
  const totalYtdOmzet     = ytdMetrics.reduce((s, m) => s + m.netto_omzet, 0)
  const totalYtdMarge     = ytdMetrics.reduce((s, m) => s + m.brutomarge, 0)
  const totalYtdEbitda    = ytdMetrics.reduce((s, m) => s + m.ebitda, 0)
  const totalYtdBudget    = ytdMetrics.reduce((s, m) => s + m.budget_omzet, 0)
  const margePct = totalYtdOmzet > 0 ? (totalYtdMarge / totalYtdOmzet * 100) : 0
  const budgetDelta = totalYtdBudget > 0 ? ((totalYtdOmzet / totalYtdBudget - 1) * 100) : 0

  // KPI cards
  const cy = 1.3, ch = 1.2, cw = (PAGE_W - 1.6) / 4, gap = 0.2
  addKpiCard(slide, 0.6 + 0 * (cw + gap), cy, cw, ch, 'Netto-omzet YTD', fmtEurK(totalYtdOmzet), `vs budget ${fmtPct(budgetDelta)}`, BRAND.primary)
  addKpiCard(slide, 0.6 + 1 * (cw + gap), cy, cw, ch, 'Brutomarge YTD', fmtEurK(totalYtdMarge), `${margePct.toFixed(1)}% van omzet`, totalYtdMarge >= 0 ? BRAND.green : BRAND.red)
  addKpiCard(slide, 0.6 + 2 * (cw + gap), cy, cw, ch, 'EBITDA YTD', fmtEurK(totalYtdEbitda), totalYtdEbitda >= 0 ? 'positief' : 'negatief', totalYtdEbitda >= 0 ? BRAND.green : BRAND.red)
  const facturenMaand = closingEntries.reduce((s, e) => s + (e.factuurvolume ?? 0), 0)
  addKpiCard(slide, 0.6 + 3 * (cw + gap), cy, cw, ch, `Factuurvolume ${monthLabel}`, fmtEurK(facturenMaand), 'gerapporteerd', BRAND.amber)

  // Highlights text
  const hl: string[] = []
  if (budgetDelta >= 0) hl.push(`✓ Omzet YTD ligt ${fmtPct(budgetDelta)} boven budget.`)
  else hl.push(`⚠ Omzet YTD ligt ${fmtPct(budgetDelta)} onder budget.`)
  if (margePct >= 30) hl.push(`✓ Brutomarge sterk op ${margePct.toFixed(1)}%.`)
  else if (margePct < 20) hl.push(`⚠ Brutomarge onder 20%: ${margePct.toFixed(1)}%.`)
  const leader = ytdMetrics.sort((a, b) => b.netto_omzet - a.netto_omzet)[0]
  hl.push(`→ Grootste BV YTD: ${leader.bv} (${fmtEurK(leader.netto_omzet)} omzet).`)
  const ebitdaBvs = ytdMetrics.filter(m => m.ebitda < 0)
  if (ebitdaBvs.length > 0) hl.push(`⚠ Negatieve EBITDA YTD bij: ${ebitdaBvs.map(m => m.bv).join(', ')}.`)

  slide.addText('Kernpunten', {
    x: 0.6, y: 2.8, w: PAGE_W - 1.2, h: 0.4,
    fontFace: 'Inter', fontSize: 14, bold: true, color: BRAND.primary,
  })
  slide.addText(hl.join('\n'), {
    x: 0.6, y: 3.3, w: PAGE_W - 1.2, h: 3.5,
    fontFace: 'Inter', fontSize: 13, color: BRAND.text, valign: 'top',
    paraSpaceAfter: 10, lineSpacingMultiple: 1.3,
  })
  addFooter(slide)
}

function slideBvSection(
  pptx: PptxGenJS,
  section: 'kern' | 'bv',
  title: string,
  subtitle: string,
  num: number,
) {
  const slide = pptx.addSlide()
  slide.background = { color: section === 'kern' ? BRAND.primary : BRAND.bgDark }
  if (section === 'kern') {
    slide.addText(title, {
      x: 0.5, y: 2.8, w: PAGE_W - 1, h: 1.2,
      fontFace: 'Inter', fontSize: 44, bold: true, color: 'FFFFFF', align: 'center',
    })
    slide.addText(subtitle, {
      x: 0.5, y: 4.2, w: PAGE_W - 1, h: 0.8,
      fontFace: 'Inter', fontSize: 16, color: 'FFFFFF', align: 'center',
    })
  } else {
    addSectionHeader(slide, title, num)
  }
}

function slideOmzetMaand(
  pptx: PptxGenJS, month: string, monthLabel: string, ytdMonths: string[], num: number,
) {
  const slide = pptx.addSlide()
  slide.background = { color: BRAND.bgDark }
  addSectionHeader(slide, `Finance — Resultaat ${monthLabel} + YTD`, num)

  const bvs: BvId[] = ['Consultancy', 'Projects', 'Software']
  const monthLabels = bvs
  const monthActuals = bvs.map(bv => (monthlyActuals2026[bv]?.[month]?.netto_omzet ?? 0) / 1000)
  const monthBudgets = bvs.map(bv => (monthlyBudget2026[bv]?.[month]?.netto_omzet ?? 0) / 1000)
  const ytdActuals = bvs.map(bv => getYtdMetrics(ytdMonths, bv).netto_omzet / 1000)
  const ytdBudgets = bvs.map(bv => (ytdBudget2026[bv]?.netto_omzet ?? 0) / 1000)

  // Bar chart - Month (left)
  slide.addText(`Omzet per BV — ${monthLabel}`, {
    x: 0.6, y: 1.2, w: 6, h: 0.4,
    fontFace: 'Inter', fontSize: 13, bold: true, color: BRAND.text,
  })
  slide.addChart(pptx.ChartType.bar, [
    { name: 'Actueel', labels: monthLabels, values: monthActuals },
    { name: 'Budget',  labels: monthLabels, values: monthBudgets },
  ], {
    x: 0.6, y: 1.65, w: 6, h: 5.2,
    barDir: 'col', barGrouping: 'clustered',
    showValue: true, dataLabelFontSize: 9, dataLabelColor: BRAND.text,
    dataLabelFormatCode: '#,##0" k"',
    chartColors: [BRAND.primary, BRAND.subtle],
    catAxisLabelColor: BRAND.muted, catAxisLabelFontSize: 10,
    valAxisLabelColor: BRAND.muted, valAxisLabelFontSize: 9,
    valAxisLabelFormatCode: '#,##0" k"',
    showLegend: true, legendPos: 'b', legendColor: BRAND.muted, legendFontSize: 10,
    plotArea: { fill: { color: BRAND.bgCard } },
  })

  // Bar chart - YTD (right)
  slide.addText('Omzet per BV — YTD', {
    x: 7, y: 1.2, w: 5.7, h: 0.4,
    fontFace: 'Inter', fontSize: 13, bold: true, color: BRAND.text,
  })
  slide.addChart(pptx.ChartType.bar, [
    { name: 'Actueel', labels: monthLabels, values: ytdActuals },
    { name: 'Budget',  labels: monthLabels, values: ytdBudgets },
  ], {
    x: 7, y: 1.65, w: 5.7, h: 5.2,
    barDir: 'col', barGrouping: 'clustered',
    showValue: true, dataLabelFontSize: 9, dataLabelColor: BRAND.text,
    dataLabelFormatCode: '#,##0" k"',
    chartColors: [BRAND.primary, BRAND.subtle],
    catAxisLabelColor: BRAND.muted, catAxisLabelFontSize: 10,
    valAxisLabelColor: BRAND.muted, valAxisLabelFontSize: 9,
    valAxisLabelFormatCode: '#,##0" k"',
    showLegend: true, legendPos: 'b', legendColor: BRAND.muted, legendFontSize: 10,
    plotArea: { fill: { color: BRAND.bgCard } },
  })
  addFooter(slide)
}

function slideBvDetail(pptx: PptxGenJS, bv: BvId, month: string, monthLabel: string, ytdMonths: string[], num: number) {
  const slide = pptx.addSlide()
  slide.background = { color: BRAND.bgDark }
  addSectionHeader(slide, `Finance: ${bv}`, num)

  const color = BV_COLOR[bv as EntityName]
  const month_m = getMonthMetrics(month, bv)
  const ytd_m   = getYtdMetrics(ytdMonths, bv)
  const budget_m = monthlyBudget2026[bv]?.[month] ?? {}
  const margePct = month_m.netto_omzet > 0 ? (month_m.brutomarge / month_m.netto_omzet * 100) : 0
  const ytdMargePct = ytd_m.netto_omzet > 0 ? (ytd_m.brutomarge / ytd_m.netto_omzet * 100) : 0
  const deltaBudget = month_m.netto_omzet - month_m.budget_omzet

  // KPI cards
  const cy = 1.3, ch = 1.2, cw = (PAGE_W - 1.6) / 4, gap = 0.2
  addKpiCard(slide, 0.6 + 0 * (cw + gap), cy, cw, ch, `Omzet ${monthLabel}`, fmtEurK(month_m.netto_omzet), `vs budget ${fmtEur(deltaBudget)}`, color)
  addKpiCard(slide, 0.6 + 1 * (cw + gap), cy, cw, ch, 'Brutomarge maand', fmtEurK(month_m.brutomarge), `${margePct.toFixed(1)}% marge`, month_m.brutomarge >= 0 ? BRAND.green : BRAND.red)
  addKpiCard(slide, 0.6 + 2 * (cw + gap), cy, cw, ch, 'EBITDA maand', fmtEurK(month_m.ebitda), 'operationeel resultaat', month_m.ebitda >= 0 ? BRAND.green : BRAND.red)
  addKpiCard(slide, 0.6 + 3 * (cw + gap), cy, cw, ch, 'Omzet YTD', fmtEurK(ytd_m.netto_omzet), `${ytdMargePct.toFixed(1)}% marge YTD`, color)

  // P&L tabel
  slide.addText('P&L hoofdlijnen', {
    x: 0.6, y: 2.8, w: 6, h: 0.4,
    fontFace: 'Inter', fontSize: 13, bold: true, color: BRAND.primary,
  })
  const rowCell = (txt: string, align: 'left' | 'right' = 'right'): PptxGenJS.TableCell => ({
    text: txt, options: { color: BRAND.text, align, fontSize: 11 },
  })
  const tableData: PptxGenJS.TableRow[] = [
    [
      { text: 'Regel', options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, fontSize: 10 } },
      { text: monthLabel, options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, fontSize: 10, align: 'right' } },
      { text: 'Budget', options: { bold: true, color: BRAND.subtle, fill: { color: BRAND.bgCard }, fontSize: 10, align: 'right' } },
      { text: 'Δ', options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, fontSize: 10, align: 'right' } },
      { text: 'YTD', options: { bold: true, color: BRAND.primary, fill: { color: BRAND.bgCard }, fontSize: 10, align: 'right' } },
    ],
    [rowCell('Netto-omzet', 'left'),    rowCell(fmtEur(month_m.netto_omzet)),    rowCell(fmtEur(month_m.budget_omzet)),         rowCell(fmtEur(deltaBudget)), rowCell(fmtEur(ytd_m.netto_omzet))],
    [rowCell('Directe kosten', 'left'), rowCell(fmtEur(month_m.directe_kosten)), rowCell(fmtEur(budget_m.directe_kosten ?? 0)), rowCell(''),                  rowCell(fmtEur(ytd_m.directe_kosten))],
    [rowCell('Brutomarge', 'left'),     rowCell(fmtEur(month_m.brutomarge)),     rowCell(fmtEur(budget_m.brutomarge ?? 0)),     rowCell(''),                  rowCell(fmtEur(ytd_m.brutomarge))],
    [rowCell('EBITDA', 'left'),         rowCell(fmtEur(month_m.ebitda)),         rowCell(fmtEur(budget_m.ebitda ?? 0)),         rowCell(''),                  rowCell(fmtEur(ytd_m.ebitda))],
  ]
  slide.addTable(tableData, {
    x: 0.6, y: 3.3, w: 6, colW: [1.8, 1.05, 1.05, 1.05, 1.05],
    fontFace: 'Inter', fontSize: 11, color: BRAND.text,
    border: { type: 'solid', color: '232E4A', pt: 0.5 },
    fill: { color: BRAND.bgCard },
  })

  // Toelichting bullets
  slide.addText('Toelichting', {
    x: 7, y: 2.8, w: 5.7, h: 0.4,
    fontFace: 'Inter', fontSize: 13, bold: true, color: BRAND.primary,
  })
  const notes: string[] = []
  if (deltaBudget < 0) notes.push(`• Omzet maand ligt ${fmtEur(deltaBudget)} onder budget.`)
  else if (deltaBudget > 0) notes.push(`• Omzet maand ligt ${fmtEur(deltaBudget)} boven budget.`)
  else notes.push(`• Omzet op budget.`)
  if (margePct < 20 && month_m.netto_omzet > 0) notes.push(`• Brutomarge ${margePct.toFixed(1)}% vraagt aandacht.`)
  else if (margePct >= 30) notes.push(`• Brutomarge ${margePct.toFixed(1)}% is sterk.`)
  if (month_m.ebitda < 0) notes.push('• Negatieve EBITDA maand — operationele kosten drukken op resultaat.')
  if (ytd_m.ebitda > 0 && month_m.ebitda < 0) notes.push('• Timing-effect: YTD nog positief ondanks zwakke maand.')
  notes.push(`• YTD omzet: ${fmtEurK(ytd_m.netto_omzet)} · marge YTD: ${ytdMargePct.toFixed(1)}%.`)

  slide.addText(notes.join('\n'), {
    x: 7, y: 3.3, w: 5.7, h: 3.5,
    fontFace: 'Inter', fontSize: 12, color: BRAND.text, valign: 'top',
    paraSpaceAfter: 10, lineSpacingMultiple: 1.35,
  })
  addFooter(slide)
}

function slideOhwOverview(pptx: PptxGenJS, _month: string, monthLabel: string, ohwData: OhwYearData, num: number) {
  const slide = pptx.addSlide()
  slide.background = { color: BRAND.bgDark }
  addSectionHeader(slide, `Onderhanden Werk (OHW) — ${monthLabel}`, num)

  const entities = ohwData.entities
  const months = ohwData.displayMonths.slice(-6)  // laatste 6 maanden

  slide.addText('OHW-totalen per BV over de tijd', {
    x: 0.6, y: 1.2, w: PAGE_W - 1.2, h: 0.4,
    fontFace: 'Inter', fontSize: 13, bold: true, color: BRAND.text,
  })

  const chartData = entities.map(e => ({
    name: e.entity,
    labels: months,
    values: months.map(m => (e.totaalOnderhanden[m] ?? 0) / 1000),
  }))

  slide.addChart(pptx.ChartType.line, chartData, {
    x: 0.6, y: 1.7, w: PAGE_W - 1.2, h: 3,
    chartColors: entities.map(e => BV_COLOR[e.entity as EntityName] ?? BRAND.primary),
    catAxisLabelColor: BRAND.muted, catAxisLabelFontSize: 10,
    valAxisLabelColor: BRAND.muted, valAxisLabelFontSize: 9,
    valAxisLabelFormatCode: '#,##0" k"',
    showLegend: true, legendPos: 'b', legendColor: BRAND.muted, legendFontSize: 10,
    lineSize: 3, lineDataSymbolSize: 7,
    plotArea: { fill: { color: BRAND.bgCard } },
  })

  // Tabel laatste maand
  const tableRows: PptxGenJS.TableRow[] = [[
    { text: 'BV', options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard } } },
    ...months.map(m => ({ text: m, options: { bold: true, color: BRAND.subtle, fill: { color: BRAND.bgCard }, align: 'right' as const } })),
  ]]
  for (const e of entities) {
    tableRows.push([
      { text: e.entity, options: { bold: true, color: BV_COLOR[e.entity as EntityName] ?? BRAND.primary } },
      ...months.map(m => ({
        text: fmtEur(e.totaalOnderhanden[m] ?? 0),
        options: { color: BRAND.text, align: 'right' as const },
      })),
    ])
  }
  slide.addTable(tableRows, {
    x: 0.6, y: 4.9, w: PAGE_W - 1.2,
    fontFace: 'Inter', fontSize: 10, color: BRAND.text,
    border: { type: 'solid', color: '232E4A', pt: 0.5 },
  })
  addFooter(slide)
}

function slideForecast(pptx: PptxGenJS, _monthLabel: string, ytdMonths: string[], num: number) {
  const slide = pptx.addSlide()
  slide.background = { color: BRAND.bgDark }
  addSectionHeader(slide, 'Forecast & vooruitblik', num)

  const bvs: BvId[] = ['Consultancy', 'Projects', 'Software']
  const fyBudget = bvs.map(bv => ytdBudget2026[bv]?.netto_omzet ?? 0)
  const ytdActual = bvs.map(bv => getYtdMetrics(ytdMonths, bv).netto_omzet)
  // Run-rate extrapolation: annualize YTD
  const monthsSoFar = ytdMonths.length
  const fyExtrap = ytdActual.map(v => v * (12 / Math.max(1, monthsSoFar)))

  slide.addText('FY 2026 projectie o.b.v. YTD run-rate vs FY budget', {
    x: 0.6, y: 1.2, w: PAGE_W - 1.2, h: 0.4,
    fontFace: 'Inter', fontSize: 13, bold: true, color: BRAND.text,
  })

  slide.addChart(pptx.ChartType.bar, [
    { name: 'YTD actuals (geëxtrapoleerd naar FY)', labels: bvs, values: fyExtrap.map(v => v / 1000) },
    { name: 'FY 2026 budget (YTD-segment)',          labels: bvs, values: fyBudget.map(v => v / 1000) },
  ], {
    x: 0.6, y: 1.7, w: PAGE_W - 1.2, h: 3.2,
    barDir: 'col', barGrouping: 'clustered',
    showValue: true, dataLabelFontSize: 9, dataLabelColor: BRAND.text,
    dataLabelFormatCode: '#,##0" k"',
    chartColors: [BRAND.primary, BRAND.subtle],
    catAxisLabelColor: BRAND.muted, catAxisLabelFontSize: 11,
    valAxisLabelColor: BRAND.muted, valAxisLabelFontSize: 10,
    valAxisLabelFormatCode: '#,##0" k"',
    showLegend: true, legendPos: 'b', legendColor: BRAND.muted, legendFontSize: 10,
    plotArea: { fill: { color: BRAND.bgCard } },
  })

  // Forecast notes
  slide.addText('Verwachtingen & risico\'s', {
    x: 0.6, y: 5.1, w: PAGE_W - 1.2, h: 0.4,
    fontFace: 'Inter', fontSize: 13, bold: true, color: BRAND.primary,
  })
  const notes = bvs.map((bv, i) => {
    const delta = fyExtrap[i] - fyBudget[i]
    const deltaPct = fyBudget[i] > 0 ? (delta / fyBudget[i] * 100) : 0
    return `• ${bv}: FY projectie ${fmtEurK(fyExtrap[i])} vs budget ${fmtEurK(fyBudget[i])} (${fmtPct(deltaPct)})`
  }).join('\n')
  slide.addText(notes, {
    x: 0.6, y: 5.6, w: PAGE_W - 1.2, h: 1.3,
    fontFace: 'Inter', fontSize: 12, color: BRAND.text, valign: 'top',
    paraSpaceAfter: 6, lineSpacingMultiple: 1.3,
  })
  addFooter(slide)
}

function slideBijlage(pptx: PptxGenJS, monthLabel: string, closingEntries: ClosingEntry[], num: number) {
  const slide = pptx.addSlide()
  slide.background = { color: BRAND.bgDark }
  addSectionHeader(slide, 'Bijlage — Maandafsluiting details', num)

  slide.addText('Closing entries zoals vastgelegd in de app', {
    x: 0.6, y: 1.2, w: PAGE_W - 1.2, h: 0.4,
    fontFace: 'Inter', fontSize: 12, color: BRAND.muted,
  })

  const header: PptxGenJS.TableRow = [
    { text: 'BV', options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard } } },
    { text: 'Factuurvolume', options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'Debiteuren', options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'OHW mutatie', options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'Accruals', options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'Correctie', options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard }, align: 'right' } },
    { text: 'Opmerking', options: { bold: true, color: BRAND.text, fill: { color: BRAND.bgCard } } },
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
    x: 0.6, y: 1.8, w: PAGE_W - 1.2,
    fontFace: 'Inter', fontSize: 10, color: BRAND.text,
    border: { type: 'solid', color: '232E4A', pt: 0.5 },
  })
  slide.addText(`Gegenereerd op ${new Date().toLocaleString('nl-NL')} · Maand: ${monthLabel}`, {
    x: 0.6, y: PAGE_H - 0.6, w: PAGE_W - 1.2, h: 0.3,
    fontFace: 'Inter', fontSize: 9, color: BRAND.subtle, align: 'right',
  })
  addFooter(slide)
}

// ─── Main entry ──────────────────────────────────────────────────────────

export interface GeneratePptxInput {
  month: string                  // "Mar-26"
  monthLabel: string             // "maart 2026"
  ytdMonths: string[]            // e.g. ['Jan-26','Feb-26','Mar-26']
  closingEntries: ClosingEntry[]
  ohwData2026: OhwYearData
}

export async function generateMonthPptx(input: GeneratePptxInput): Promise<void> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'TPG Finance'
  pptx.company = 'The People Group'
  pptx.title = `Maandrapportage ${input.monthLabel}`
  pptx.subject = `Maandrapportage ${input.month}`

  const logoB64 = await fetchImageAsBase64('/tpg-logo.png')

  slideTitle(pptx, input.month, input.monthLabel, logoB64)
  slideToc(pptx)
  slideSummary(pptx, input.month, input.monthLabel, input.closingEntries, input.ytdMonths)
  slideOmzetMaand(pptx, input.month, input.monthLabel, input.ytdMonths, 4)

  // Section divider (kern blok)
  slideBvSection(pptx, 'kern', 'Zoom per business unit', `${input.monthLabel} · YTD 2026`, 5)

  // Per-BV detail
  const bvs: BvId[] = ['Consultancy', 'Projects', 'Software']
  let slideNum = 6
  for (const bv of bvs) {
    slideBvDetail(pptx, bv, input.month, input.monthLabel, input.ytdMonths, slideNum++)
  }

  // OHW
  slideOhwOverview(pptx, input.month, input.monthLabel, input.ohwData2026, slideNum++)

  // Forecast
  slideForecast(pptx, input.monthLabel, input.ytdMonths, slideNum++)

  // Bijlage
  slideBijlage(pptx, input.monthLabel, input.closingEntries, slideNum++)

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
