import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import type { ClosingEntry, ImportRecord, OhwYearData } from '../data/types'
import type { RawDataEntry } from '../store/useRawDataStore'

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
