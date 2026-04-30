import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import type { ClosingEntry, ImportRecord, OhwYearData, FteEntry, ClosingBv } from '../data/types'
import type { RawDataEntry } from '../store/useRawDataStore'
import type { CostBreakdown } from '../store/useCostBreakdownStore'
import type { EvidenceEntry } from '../lib/db'
import { buildMonthPptxBlob, monthLabelFromCode } from './exportPptx'

export interface MonthBundleInput {
  month: string                  // "Mar-26"
  closingEntries: ClosingEntry[] // per BV voor deze maand
  importRecords: ImportRecord[]  // alle records voor deze maand
  rawData: RawDataEntry[]        // ruwe rijen per goedgekeurd import
  ohwData2025: OhwYearData
  ohwData2026: OhwYearData
  generatedAt: string
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_')
}

/** Bouw een Excel-bestand vanuit de ruwe rijen van een goedgekeurd import. */
function buildExcelFromRawRows(entry: RawDataEntry): ArrayBuffer {
  const rows = entry.rows ?? []
  const ws = rows.length > 0
    ? XLSX.utils.json_to_sheet(rows as Record<string, unknown>[])
    : XLSX.utils.aoa_to_sheet([['(geen rijen)']])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, entry.slotLabel.slice(0, 31))
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

/** Markdown samenvatting — menselijk leesbaar overzicht van de maandafsluiting */
function buildSummaryMarkdown(input: MonthBundleInput): string {
  const { month, closingEntries, importRecords } = input
  const approvedImports = importRecords.filter(r => r.status === 'approved')

  let md = `# TPG Maandafsluiting — ${month}\n\n`
  md += `Gegenereerd op ${input.generatedAt}\n\n`
  md += `## Samenvatting\n\n`

  const totalFv   = closingEntries.reduce((s, e) => s + (e.factuurvolume ?? 0), 0)
  const totalDeb  = closingEntries.reduce((s, e) => s + (e.debiteuren ?? 0), 0)
  const totalOhwMut = closingEntries.reduce((s, e) => s + (e.ohwMutatie ?? 0), 0)
  md += `- **Totaal factuurvolume**: € ${totalFv.toLocaleString('nl-NL')}\n`
  md += `- **Totaal debiteuren**: € ${totalDeb.toLocaleString('nl-NL')}\n`
  md += `- **Totaal OHW-mutatie**: € ${totalOhwMut.toLocaleString('nl-NL')}\n\n`

  md += `## Closing entries per BV\n\n`
  for (const e of closingEntries) {
    md += `### ${e.bv}\n\n`
    md += `- Factuurvolume: € ${e.factuurvolume.toLocaleString('nl-NL')}\n`
    md += `- Debiteuren: € ${e.debiteuren.toLocaleString('nl-NL')}\n`
    md += `- OHW mutatie: € ${e.ohwMutatie.toLocaleString('nl-NL')}\n`
    md += `- Accruals: € ${e.accruals.toLocaleString('nl-NL')}\n`
    md += `- Handmatige correctie: € ${e.handmatigeCorrectie.toLocaleString('nl-NL')}\n`
    if (e.remark) md += `- Opmerking: ${e.remark}\n`
    md += `\n`
  }

  md += `## Goedgekeurde bestanden (${approvedImports.length})\n\n`
  for (const r of approvedImports) {
    md += `### ${r.slotLabel} — ${r.fileName}\n\n`
    md += `- Geüpload: ${r.uploadedAt}\n`
    md += `- Totaal: € ${r.totalAmount.toLocaleString('nl-NL')}\n`
    md += `- Rijen: ${r.rowCount} (${r.parsedCount} verwerkt, ${r.skippedCount} overgeslagen)\n`
    md += `- Bedrag-kolom: \`${r.detectedAmountCol}\`\n`
    md += `- BV-kolom: \`${r.detectedBvCol}\`\n`
    md += `- Per BV: `
    const parts = Object.entries(r.perBv ?? {})
      .filter(([, v]) => (v ?? 0) > 0)
      .map(([bv, v]) => `${bv}: € ${(v as number).toLocaleString('nl-NL')}`)
    md += parts.join(', ') + '\n\n'
  }

  return md
}

/** Genereer een ZIP met alle bestanden en data van een maandafsluiting.
 *  Structuur:
 *    /{month}/
 *      SAMENVATTING.md
 *      snapshot.json
 *      imports/
 *        {slotId}_{filename}.xlsx
 *      closing_entries.json
 *      ohw_snapshot.json
 */
export async function buildMonthBundleZip(input: MonthBundleInput): Promise<Blob> {
  const zip = new JSZip()
  const folder = zip.folder(safeName(input.month))
  if (!folder) throw new Error('Kon ZIP-folder niet aanmaken')

  // Markdown samenvatting
  folder.file('SAMENVATTING.md', buildSummaryMarkdown(input))

  // Closing entries
  folder.file('closing_entries.json', JSON.stringify(input.closingEntries, null, 2))

  // Volledige snapshot
  folder.file('snapshot.json', JSON.stringify({
    month: input.month,
    generatedAt: input.generatedAt,
    closingEntries: input.closingEntries,
    importRecords: input.importRecords,
    rawDataCount: input.rawData.length,
  }, null, 2))

  // OHW snapshots
  const ohw = {
    '2025': input.ohwData2025,
    '2026': input.ohwData2026,
  }
  folder.file('ohw_snapshot.json', JSON.stringify(ohw, null, 2))

  // Alle goedgekeurde imports als Excel bestanden
  const importsFolder = folder.folder('imports')
  if (importsFolder) {
    for (const raw of input.rawData) {
      if (raw.status !== 'approved') continue
      const origName = raw.fileName.replace(/\.(xlsx|xls|csv)$/i, '')
      const fname = `${safeName(raw.slotId)}_${safeName(origName)}.xlsx`
      try {
        const buf = buildExcelFromRawRows(raw)
        importsFolder.file(fname, buf)
      } catch (err) {
        console.warn(`Kon ${fname} niet exporteren:`, err)
      }
    }
  }

  // Log van alle imports (ook pending/rejected)
  const logRows = input.importRecords.map(r => ({
    slotId: r.slotId,
    slotLabel: r.slotLabel,
    fileName: r.fileName,
    status: r.status,
    uploadedAt: r.uploadedAt,
    totalAmount: r.totalAmount,
    Consultancy: r.perBv['Consultancy'] ?? 0,
    Projects:    r.perBv['Projects'] ?? 0,
    Software:    r.perBv['Software'] ?? 0,
    rowCount: r.rowCount,
    parsedCount: r.parsedCount,
    skippedCount: r.skippedCount,
    amountCol: r.detectedAmountCol,
    bvCol: r.detectedBvCol,
  }))
  const logWs = XLSX.utils.json_to_sheet(logRows)
  const logWb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(logWb, logWs, 'Import log')
  const logBuf = XLSX.write(logWb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  folder.file('import_log.xlsx', logBuf)

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

/** Download de gegenereerde ZIP als bestand */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ─── Volledig maandrapport (alles in één ZIP) ───────────────────────────────

/** Welke onderdelen er in de "Volledig rapport" ZIP terecht komen. Default
 *  voor alle vlaggen = true. Bij een unset vlag wordt het onderdeel weggelaten
 *  zodat de ZIP klein blijft als de gebruiker maar een deel nodig heeft. */
export interface FullReportSections {
  /** PowerPoint maandrapportage (zelfde deck als de PPTX-knop). */
  pptx: boolean
  /** Maandafsluiting Excel (closing-entries per BV, met totalen). */
  closingExcel: boolean
  /** Volledig OHW-overzicht 2025 + 2026, per BV één werkblad. */
  ohwOverview: boolean
  /** FTE & headcount (alle BVs, alle maanden 2025+2026). */
  fteOverview: boolean
  /** Geüploade bron-bestanden (geschreven uren, factuurvolume, D-lijst, …)
   *  als losse Excel-bestanden + import_log.xlsx met metadata. */
  importedFiles: boolean
  /** Bijlagen (evidence) bij OHW-rijen — origineel binair bestand wordt
   *  bewaard inclusief filenaam en omschrijving. */
  bijlagen: boolean
  /** Kosten-specificaties (CostBreakdown-store) als Excel + JSON. */
  costBreakdowns: boolean
  /** Markdown-samenvatting + JSON snapshot (klein, altijd handig). */
  summary: boolean
}

export const DEFAULT_FULL_REPORT_SECTIONS: FullReportSections = {
  pptx: true,
  closingExcel: true,
  ohwOverview: true,
  fteOverview: true,
  importedFiles: true,
  bijlagen: true,
  costBreakdowns: true,
  summary: true,
}

export interface FullMonthReportInput {
  month: string
  closingEntries: ClosingEntry[]
  importRecords: ImportRecord[]
  rawData: RawDataEntry[]
  ohwData2025: OhwYearData
  ohwData2026: OhwYearData
  fteEntries: FteEntry[]
  costBreakdowns: CostBreakdown[]
  evidence: EvidenceEntry[]
  ytdMonths: string[]
  generatedAt: string
  /** Welke onderdelen meenemen. Niet meegegeven = alles aan. */
  sections?: Partial<FullReportSections>
  /** Optioneel: beperk de export tot één BV (voor BV-locked gebruikers).
   *  null/undefined = alle BVs. */
  bvFilter?: ClosingBv | null
}

/** Sla de closing-entries op in een leesbaar Excel-formaat.
 *  Eén werkblad met alle BVs onder elkaar + één totaalregel. */
function buildClosingExcel(entries: ClosingEntry[]): ArrayBuffer {
  const rows: Record<string, unknown>[] = entries.map(e => ({
    BV:                       e.bv as string,
    Maand:                    e.month,
    Factuurvolume:            e.factuurvolume,
    Debiteuren:               e.debiteuren,
    'OHW-mutatie':            e.ohwMutatie,
    Kostencorrectie:          e.kostencorrectie,
    Accruals:                 e.accruals,
    'Handmatige correctie':   e.handmatigeCorrectie,
    'Operationele kosten':    e.operationeleKosten,
    'Amortisatie/afschrijv.': e.amortisatieAfschrijvingen,
    'Financieel resultaat':   e.financieelResultaat ?? 0,
    'Vennootschapsbelasting': e.vennootschapsbelasting ?? 0,
    Opmerking:                e.remark,
  }))
  if (rows.length > 0) {
    const sum = (k: string) => rows.reduce((s, r) => s + (typeof r[k] === 'number' ? (r[k] as number) : 0), 0)
    rows.push({
      BV: 'TOTAAL',
      Maand: entries[0]?.month ?? '',
      Factuurvolume:            sum('Factuurvolume'),
      Debiteuren:               sum('Debiteuren'),
      'OHW-mutatie':            sum('OHW-mutatie'),
      Kostencorrectie:          sum('Kostencorrectie'),
      Accruals:                 sum('Accruals'),
      'Handmatige correctie':   sum('Handmatige correctie'),
      'Operationele kosten':    sum('Operationele kosten'),
      'Amortisatie/afschrijv.': sum('Amortisatie/afschrijv.'),
      'Financieel resultaat':   sum('Financieel resultaat'),
      'Vennootschapsbelasting': sum('Vennootschapsbelasting'),
      Opmerking:                '',
    })
  }
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Maandafsluiting')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

/** Bouw een Excel met alle OHW-data 2025 + 2026 — één werkblad per (jaar, BV).
 *  Per werkblad worden alle secties uit `onderhanden` plus `icVerrekening`,
 *  `vooruitgefactureerd` en alle aggregaat-regels (totaalOnderhanden,
 *  debiteuren, factuurvolume, …) onder elkaar gezet, met alle maanden uit
 *  displayMonths als kolommen. */
function buildOhwOverviewExcel(
  data2025: OhwYearData,
  data2026: OhwYearData,
  bvFilter?: ClosingBv | null,
): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  const yearSets: Array<['2025' | '2026', OhwYearData]> = [['2025', data2025], ['2026', data2026]]

  const monthRow = (label: string, values: Record<string, number | null> | undefined, months: string[]): Record<string, unknown> => {
    const obj: Record<string, unknown> = { Sectie: '', Rij: label }
    for (const m of months) obj[m] = values?.[m] ?? null
    return obj
  }

  for (const [year, yd] of yearSets) {
    const months = yd.displayMonths ?? []
    const filteredEntities = bvFilter
      ? yd.entities.filter(e => e.entity === bvFilter)
      : yd.entities
    for (const ent of filteredEntities) {
      const rows: Record<string, unknown>[] = []
      // Onderhanden secties
      for (const sec of (ent.onderhanden ?? [])) {
        for (const r of sec.rows) {
          const obj: Record<string, unknown> = {
            Sectie: sec.title,
            Rij:    r.description || r.id,
          }
          for (const m of months) obj[m] = r.values?.[m] ?? null
          if (r.remark) obj['Opmerking'] = r.remark
          rows.push(obj)
        }
      }
      rows.push(monthRow('TOTAAL onderhanden', ent.totaalOnderhanden, months))
      rows.push(monthRow('Debiteuren', ent.debiteuren, months))
      rows.push(monthRow('Factuurvolume', ent.factuurvolume, months))
      rows.push(monthRow('Mutatie OHW', ent.mutatieOhw, months))
      rows.push(monthRow('Netto-omzet vóór IC', ent.nettoOmzetVoorIC, months))
      // IC-verrekening rijen
      for (const r of (ent.icVerrekening ?? [])) {
        const obj: Record<string, unknown> = { Sectie: 'IC-verrekening', Rij: r.description || r.id }
        for (const m of months) obj[m] = r.values?.[m] ?? null
        rows.push(obj)
      }
      rows.push(monthRow('Totaal IC', ent.totaalIC, months))
      rows.push(monthRow('Netto-omzet (na IC)', ent.nettoOmzet, months))
      rows.push(monthRow('Budget', ent.budget, months))
      rows.push(monthRow('Δ vs budget', ent.delta, months))
      // Vooruitgefactureerd (optioneel)
      if (ent.vooruitgefactureerd && ent.vooruitgefactureerd.length > 0) {
        for (const r of ent.vooruitgefactureerd) {
          const obj: Record<string, unknown> = { Sectie: 'Vooruitgefactureerd', Rij: r.description || r.id }
          for (const m of months) obj[m] = r.values?.[m] ?? null
          rows.push(obj)
        }
        rows.push(monthRow('Totaal vooruitgefactureerd', ent.totaalVooruitgefactureerd, months))
        rows.push(monthRow('Mutatie vooruitgefactureerd', ent.mutatieVooruitgefactureerd, months))
      }

      const ws = rows.length > 0
        ? XLSX.utils.json_to_sheet(rows)
        : XLSX.utils.aoa_to_sheet([['(geen rijen)']])
      const sheet = `${year}_${ent.entity}`.slice(0, 31)
      XLSX.utils.book_append_sheet(wb, ws, sheet)
    }
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

/** FTE & headcount overzicht — één werkblad, alle BVs onder elkaar. */
function buildFteExcel(entries: FteEntry[], bvFilter?: ClosingBv | null): ArrayBuffer {
  const filtered = bvFilter
    ? entries.filter(e => (e.bv as string) === bvFilter)
    : entries
  const sorted = [...filtered].sort((a, b) => {
    if (a.bv !== b.bv) return a.bv.localeCompare(b.bv)
    return a.month.localeCompare(b.month)
  })
  const rows = sorted.map(e => ({
    BV:                e.bv,
    Maand:             e.month,
    FTE:               e.fte ?? null,
    Headcount:         e.headcount ?? null,
    'FTE budget':      e.fteBudget ?? null,
    'Headcount budget': e.headcountBudget ?? null,
    'Δ FTE':           (typeof e.fte === 'number' && typeof e.fteBudget === 'number') ? +(e.fte - e.fteBudget).toFixed(2) : null,
    'Δ Headcount':     (typeof e.headcount === 'number' && typeof e.headcountBudget === 'number') ? (e.headcount - e.headcountBudget) : null,
  }))
  const ws = rows.length > 0
    ? XLSX.utils.json_to_sheet(rows)
    : XLSX.utils.aoa_to_sheet([['(geen FTE-data)']])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'FTE & headcount')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

/** Kosten-specificaties als Excel — één rij per breakdown met BV-kolommen. */
function buildCostBreakdownExcel(breakdowns: CostBreakdown[]): ArrayBuffer {
  const rows = breakdowns.map(b => ({
    Maand:       b.month,
    Categorie:   b.category,
    Omschrijving: b.label,
    Consultancy: b.values.Consultancy ?? 0,
    Projects:    b.values.Projects ?? 0,
    Software:    b.values.Software ?? 0,
    Holdings:    b.values.Holdings ?? 0,
    Totaal:      (b.values.Consultancy ?? 0) + (b.values.Projects ?? 0) + (b.values.Software ?? 0) + (b.values.Holdings ?? 0),
  }))
  const ws = rows.length > 0
    ? XLSX.utils.json_to_sheet(rows)
    : XLSX.utils.aoa_to_sheet([['(geen kosten-specificaties)']])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Kosten-specificaties')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

/** base64 → Uint8Array (voor evidence binaries die in DB gecodeerd staan). */
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.startsWith('data:') ? (b64.split(',')[1] ?? '') : b64
  const bin = atob(clean)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Genereer een ZIP met ALLES wat een gebruiker zou kunnen willen voor één
 *  maand: PowerPoint, OHW-overzicht jaar, FTE & headcount, geüploade bron-
 *  bestanden, bijlagen, kostenspecificaties, closing-entries, samenvatting.
 *
 *  De gebruiker kan via `sections` aanvinken wat er bij moet — niets wordt
 *  origineel gewijzigd of verwijderd. Alle bron-data wordt uitsluitend
 *  gelezen uit de stores.
 *
 *  Voor BV-locked gebruikers (bvFilter != null): alleen die BV wordt
 *  meegenomen in de OHW-, FTE- en bijlagen-secties; geüploade bestanden zijn
 *  meestal multi-BV en worden ongewijzigd meegenomen (rauwe data is per slot
 *  opgeslagen, niet per BV).
 */
export async function buildFullMonthReportZip(input: FullMonthReportInput): Promise<Blob> {
  const sections: FullReportSections = { ...DEFAULT_FULL_REPORT_SECTIONS, ...(input.sections ?? {}) }
  const zip = new JSZip()
  const root = zip.folder(safeName(input.month))
  if (!root) throw new Error('Kon ZIP-folder niet aanmaken')

  // README — uitleg van wat er in de ZIP zit
  const readmeLines: string[] = [
    `# TPG Volledig Maandrapport — ${input.month}`,
    ``,
    `Gegenereerd op ${input.generatedAt}.`,
    input.bvFilter ? `Beperkt tot BV: **${input.bvFilter}**.` : `Alle BVs.`,
    ``,
    `## Inhoud`,
  ]

  // 1. Markdown samenvatting + snapshot.json
  if (sections.summary) {
    root.file('SAMENVATTING.md', buildSummaryMarkdown({
      month: input.month,
      closingEntries: input.closingEntries,
      importRecords: input.importRecords,
      rawData: input.rawData,
      ohwData2025: input.ohwData2025,
      ohwData2026: input.ohwData2026,
      generatedAt: input.generatedAt,
    }))
    root.file('snapshot.json', JSON.stringify({
      month: input.month,
      generatedAt: input.generatedAt,
      bvFilter: input.bvFilter ?? null,
      closingEntries: input.closingEntries,
      importRecordsCount: input.importRecords.length,
      rawDataCount: input.rawData.length,
      fteEntriesCount: input.fteEntries.length,
      evidenceCount: input.evidence.length,
    }, null, 2))
    readmeLines.push('- `SAMENVATTING.md` — leesbare samenvatting van de maand')
    readmeLines.push('- `snapshot.json` — JSON-snapshot voor archivering')
  }

  // 2. Closing-entries Excel
  if (sections.closingExcel) {
    const filteredEntries = input.bvFilter
      ? input.closingEntries.filter(e => e.bv === input.bvFilter)
      : input.closingEntries
    root.file('Maandafsluiting.xlsx', buildClosingExcel(filteredEntries))
    root.file('closing_entries.json', JSON.stringify(filteredEntries, null, 2))
    readmeLines.push('- `Maandafsluiting.xlsx` — closing-entries per BV met totalen')
  }

  // 3. OHW-overzicht jaar (2025 + 2026, alle BVs of gefilterd)
  if (sections.ohwOverview) {
    root.file('OHW_Overzicht.xlsx', buildOhwOverviewExcel(
      input.ohwData2025, input.ohwData2026, input.bvFilter,
    ))
    root.file('ohw_snapshot.json', JSON.stringify({
      '2025': input.bvFilter
        ? { ...input.ohwData2025, entities: input.ohwData2025.entities.filter(e => e.entity === input.bvFilter) }
        : input.ohwData2025,
      '2026': input.bvFilter
        ? { ...input.ohwData2026, entities: input.ohwData2026.entities.filter(e => e.entity === input.bvFilter) }
        : input.ohwData2026,
    }, null, 2))
    readmeLines.push('- `OHW_Overzicht.xlsx` — alle OHW-data 2025+2026, één tab per (jaar, BV)')
  }

  // 4. FTE & headcount
  if (sections.fteOverview) {
    root.file('FTE_Headcount.xlsx', buildFteExcel(input.fteEntries, input.bvFilter))
    readmeLines.push('- `FTE_Headcount.xlsx` — FTE en headcount per BV per maand')
  }

  // 5. Kosten-specificaties
  if (sections.costBreakdowns) {
    const monthBreakdowns = input.costBreakdowns.filter(b => b.month === input.month)
    if (monthBreakdowns.length > 0) {
      root.file('Kosten_specificaties.xlsx', buildCostBreakdownExcel(monthBreakdowns))
      readmeLines.push('- `Kosten_specificaties.xlsx` — alle handmatige kosten-uitsplitsingen')
    }
  }

  // 6. Geüploade bron-bestanden + import-log
  if (sections.importedFiles) {
    const importsFolder = root.folder('imports')
    if (importsFolder) {
      let exported = 0
      for (const raw of input.rawData) {
        if (raw.status !== 'approved') continue
        const origName = raw.fileName.replace(/\.(xlsx|xls|csv)$/i, '')
        const fname = `${safeName(raw.slotId)}_${safeName(origName)}.xlsx`
        try {
          importsFolder.file(fname, buildExcelFromRawRows(raw))
          exported++
        } catch (err) {
          console.warn(`Kon ${fname} niet exporteren:`, err)
        }
      }
      // Import log met metadata van ALLE records (ook pending/rejected)
      const logRows = input.importRecords.map(r => ({
        slotId: r.slotId,
        slotLabel: r.slotLabel,
        fileName: r.fileName,
        status: r.status,
        uploadedAt: r.uploadedAt,
        totalAmount: r.totalAmount,
        Consultancy: r.perBv['Consultancy'] ?? 0,
        Projects:    r.perBv['Projects'] ?? 0,
        Software:    r.perBv['Software'] ?? 0,
        rowCount: r.rowCount,
        parsedCount: r.parsedCount,
        skippedCount: r.skippedCount,
        amountCol: r.detectedAmountCol,
        bvCol: r.detectedBvCol,
      }))
      const logWs = XLSX.utils.json_to_sheet(logRows)
      const logWb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(logWb, logWs, 'Import log')
      const logBuf = XLSX.write(logWb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
      importsFolder.file('import_log.xlsx', logBuf)
      readmeLines.push(`- \`imports/\` — ${exported} goedgekeurde bron-bestanden + \`import_log.xlsx\``)
    }
  }

  // 7. Bijlagen (evidence) — origineel binair bestand
  if (sections.bijlagen) {
    const bijlagenFolder = root.folder('bijlagen')
    if (bijlagenFolder) {
      // Per-maand subfolder zodat bijlagen van andere maanden ook netjes
      // bewaard blijven (admins willen vaak het hele evidence-archief).
      const evList = input.bvFilter
        ? input.evidence.filter(e => e.entity === input.bvFilter)
        : input.evidence
      const indexRows: Record<string, unknown>[] = []
      for (const ev of evList) {
        // De voorkeur ligt bij origineel binair bestand. Als parsing faalt
        // (corrupt base64 e.d.) skippen we het bestand maar loggen we wel
        // naar de index zodat het zichtbaar is voor de admin.
        let stored = false
        try {
          const bytes = base64ToBytes(ev.fileData)
          const sub = bijlagenFolder.folder(safeName(ev.month)) ?? bijlagenFolder
          const safeFile = `${safeName(ev.entity)}_${safeName(ev.ohwRowId)}_${safeName(ev.fileName)}`
          sub.file(safeFile, bytes)
          stored = true
        } catch (err) {
          console.warn(`Kon bijlage ${ev.fileName} niet bundelen:`, err)
        }
        indexRows.push({
          ID:           ev.id,
          Maand:        ev.month,
          BV:           ev.entity,
          'OHW rij-ID': ev.ohwRowId,
          Bestand:      ev.fileName,
          Type:         ev.mimeType,
          'Grootte (B)': ev.fileSize,
          Omschrijving: ev.description,
          Geüpload:     ev.uploadedAt,
          Bewaard:      stored ? 'ja' : 'nee (decode-fout)',
        })
      }
      if (indexRows.length > 0) {
        const idxWs = XLSX.utils.json_to_sheet(indexRows)
        const idxWb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(idxWb, idxWs, 'Bijlagen-index')
        const idxBuf = XLSX.write(idxWb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
        bijlagenFolder.file('Bijlagen_index.xlsx', idxBuf)
      }
      readmeLines.push(`- \`bijlagen/\` — ${evList.length} bijlagen incl. \`Bijlagen_index.xlsx\``)
    }
  }

  // 8. PowerPoint maandrapportage
  if (sections.pptx) {
    try {
      const pptxBlob = await buildMonthPptxBlob({
        month:           input.month,
        monthLabel:      monthLabelFromCode(input.month),
        ytdMonths:       input.ytdMonths,
        closingEntries:  input.closingEntries,
        ohwData2026:     input.ohwData2026,
        importRecords:   input.importRecords,
      })
      const pptxBuf = await pptxBlob.arrayBuffer()
      root.file(`Maandrapportage_${safeName(input.month)}.pptx`, pptxBuf)
      readmeLines.push(`- \`Maandrapportage_${safeName(input.month)}.pptx\` — volledige slide-deck`)
    } catch (err) {
      console.warn('PPTX-bundling mislukt — ZIP wordt zonder PowerPoint geleverd:', err)
      readmeLines.push(`- _PowerPoint mislukt: ${err instanceof Error ? err.message : String(err)}_`)
    }
  }

  // README — pas helemaal aan het einde toevoegen zodat de inhoud klopt
  root.file('README.md', readmeLines.join('\n') + '\n')

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}
