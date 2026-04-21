import { useEffect, useMemo, useState } from 'react'
import type * as XLSX from 'xlsx'
import {
  readSheetAsArrays,
  scoreHeaderRows,
  extractTableFromSheet,
  suggestMissingHoursColumns,
  computeMissingHours,
  getMissingHoursSlotConfig,
  perColumnTariffMatches,
  getUnmatchedSamplesForColumn,
  type TariffLookup,
  type MissingHoursComputeConfig,
} from '../../lib/parseImport'
import { fmt } from '../../lib/format'
import type { ParseResult, MissingHoursDetail } from '../../lib/parseImport'

/** Filter een detail-rij op vrije zoek-input (naam / ID / ruwe identifier) */
function matchesSearch(d: MissingHoursDetail, term: string): boolean {
  if (!term.trim()) return true
  const q = term.toLowerCase().trim()
  return (
    d.naam.toLowerCase().includes(q) ||
    d.id.toLowerCase().includes(q) ||
    d.rawId.toLowerCase().includes(q)
  )
}

/** Trek de lijst onbekende identifiers uit de warnings-array (het parser-
 *  resultaat bevat geen aparte veld-lijst — de namen staan in de warning-text
 *  na "niet in Consultancy tarieftabel:"). */
function getUnmatchedIdentifiers(warnings: string[]): string[] {
  for (const w of warnings) {
    const m = w.match(/niet in Consultancy tarieftabel:\s*(.+?)(?:\s*en\s+\d+\s+meer)?$/)
    if (m) return m[1].split(',').map(s => s.trim()).filter(Boolean)
  }
  return []
}

interface Props {
  workbook: XLSX.WorkBook
  fileName: string
  tariffs: TariffLookup
  onConfirm: (result: ParseResult, cfg: {
    sheetName: string
    headerRow: number
    werknemerCol: string
    urenCol: string
    bedrijfCol?: string
    bedrijfFilter?: string
  }) => void
  onCancel: () => void
  /** Wordt aangeroepen als de gebruiker een ontbrekend IC-tarief invult in
   *  stap 4. Moet de IC Tarieven tabel updaten zodat de live berekening
   *  opnieuw draait met het nieuwe tarief. */
  onSetTariff: (employeeId: string, tarief: number) => void
}

type Step = 1 | 2 | 3 | 4

export function MissingHoursWizard({ workbook, fileName, tariffs, onConfirm, onCancel, onSetTariff }: Props) {
  const [step, setStep] = useState<Step>(1)

  // Stap 4: handmatig uitgesloten werknemers (keys = tariff-ID)
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set())
  const [excludedRows, setExcludedRows] = useState<Set<number>>(new Set())
  const [searchTerm, setSearchTerm] = useState<string>('')

  // Stap 1: sheet kiezen (default: eerste sheet, of sheet met "missing" in naam)
  const sheetNames = workbook.SheetNames
  const defaultSheet = sheetNames.find(n => /missing|uren|hours/i.test(n)) ?? sheetNames[0]
  const [sheetName, setSheetName] = useState<string>(defaultSheet)

  // Stap 2: header-rij kiezen
  const sheetRows = useMemo(() => readSheetAsArrays(workbook, sheetName), [workbook, sheetName])
  const headerCandidates = useMemo(() => scoreHeaderRows(sheetRows), [sheetRows])
  const [headerRow, setHeaderRow] = useState<number>(0)

  // Wanneer sheet wijzigt, pak de beste kandidaat als default header-rij
  useEffect(() => {
    if (headerCandidates.length > 0 && headerCandidates[0].score > 0) {
      setHeaderRow(headerCandidates[0].rowIdx)
    } else {
      setHeaderRow(0)
    }
  }, [sheetName, headerCandidates])

  // Stap 3: kolommen + filter kiezen
  const { headers, dataRows } = useMemo(
    () => extractTableFromSheet(sheetRows, headerRow),
    [sheetRows, headerRow],
  )
  const suggested = useMemo(
    () => suggestMissingHoursColumns(headers, dataRows, tariffs),
    [headers, dataRows, tariffs],
  )

  // Per-kolom: hoeveel sample-rijen matchen met de tarieftabel — zodat de
  // gebruiker in stap 3 direct ziet welke kolom de juiste werknemer-keuze is
  const columnMatchStats = useMemo(
    () => perColumnTariffMatches(headers, dataRows, tariffs),
    [headers, dataRows, tariffs],
  )

  const [werknemerCol, setWerknemerCol] = useState<string>('')
  const [urenCol, setUrenCol] = useState<string>('')
  const [bedrijfCol, setBedrijfCol] = useState<string>('')
  // Default: GEEN bedrijfsfilter. De tarieventabel filtert Consultancy al.
  // Gebruiker zet filter handmatig aan als ze echt op bedrijfkolom willen
  // filteren (zoals bij een multi-BV export).
  const [bedrijfFilter, setBedrijfFilter] = useState<string>('')

  // Voor de geselecteerde werknemerCol: lijst onbekende waarden
  const unmatchedSamples = useMemo(() => {
    if (!werknemerCol) return []
    return getUnmatchedSamplesForColumn(werknemerCol, dataRows, tariffs, 10)
  }, [werknemerCol, dataRows, tariffs])

  // Wanneer headers/suggested wijzigt, reset naar suggesties
  useEffect(() => {
    setWerknemerCol(suggested.werknemerCol)
    setUrenCol(suggested.urenCol)
    setBedrijfCol(suggested.bedrijfCol)
    // Zet filter alleen default aan als suggested.bedrijfCol is gevonden
    // (d.w.z. de kolom bevat daadwerkelijk Consultancy-waarden). Anders
    // blijft filter leeg zodat niets per ongeluk wordt uitgefilterd.
    setBedrijfFilter(suggested.bedrijfCol ? 'Consultancy' : '')
  }, [suggested.werknemerCol, suggested.urenCol, suggested.bedrijfCol])

  // Wanneer kolommen of filter wijzigen, reset exclusions (details van vorige
  // computation zijn niet meer relevant)
  useEffect(() => {
    setExcludedIds(new Set())
    setExcludedRows(new Set())
  }, [werknemerCol, urenCol, bedrijfCol, bedrijfFilter])

  // Live preview — in stap 3 zonder exclusions, in stap 4 met exclusions
  const livePreview: ParseResult | null = useMemo(() => {
    if (step < 3) return null
    if (!werknemerCol || !urenCol) return null
    try {
      const cfg: MissingHoursComputeConfig = {
        werknemerCol,
        urenCol,
        bedrijfCol: bedrijfCol || undefined,
        bedrijfFilter: bedrijfCol && bedrijfFilter ? bedrijfFilter : undefined,
        excludedEmployeeIds: step === 4 ? excludedIds : undefined,
        excludedRowIndices: step === 4 ? excludedRows : undefined,
      }
      return computeMissingHours(headers, dataRows, tariffs, cfg, getMissingHoursSlotConfig())
    } catch {
      return null
    }
  }, [step, werknemerCol, urenCol, bedrijfCol, bedrijfFilter, headers, dataRows, tariffs, excludedIds, excludedRows])

  // Voor de "Verfijnen" stap — alle details vóór handmatige exclusions, zodat
  // uitgevinkte werknemers toch zichtbaar blijven in de lijst.
  const allDetails = useMemo(() => {
    if (!werknemerCol || !urenCol) return []
    try {
      const cfg: MissingHoursComputeConfig = {
        werknemerCol,
        urenCol,
        bedrijfCol: bedrijfCol || undefined,
        bedrijfFilter: bedrijfCol && bedrijfFilter ? bedrijfFilter : undefined,
      }
      const r = computeMissingHours(headers, dataRows, tariffs, cfg, getMissingHoursSlotConfig())
      return r.missingHoursDetails ?? []
    } catch {
      return []
    }
  }, [werknemerCol, urenCol, bedrijfCol, bedrijfFilter, headers, dataRows, tariffs])

  const canAdvance = () => {
    if (step === 1) return !!sheetName
    if (step === 2) return headerRow >= 0 && headerRow < sheetRows.length && headers.length > 0
    if (step === 3) return !!werknemerCol && !!urenCol && !!livePreview
    if (step === 4) return !!livePreview
    return false
  }

  const handleConfirm = () => {
    if (!livePreview) return
    onConfirm(livePreview, {
      sheetName,
      headerRow,
      werknemerCol,
      urenCol,
      bedrijfCol: bedrijfCol || undefined,
      bedrijfFilter: bedrijfCol ? bedrijfFilter : undefined,
    })
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, padding: 20,
      }}
    >
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--bd3)', borderRadius: 12,
        width: '100%', maxWidth: 760, maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--bd)',
          display: 'flex', alignItems: 'center', gap: 10,
          position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 1,
        }}>
          <span style={{ fontSize: 20 }}>⚠</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Missing Hours — bestandsanalyse</div>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
              {fileName} · {sheetNames.length} tabblad{sheetNames.length === 1 ? '' : 'en'}
            </div>
          </div>
          <button
            onClick={onCancel}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--t3)', fontSize: 18, cursor: 'pointer' }}
          >✕</button>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', padding: '12px 20px', gap: 4, borderBottom: '1px solid var(--bd)' }}>
          {([1, 2, 3, 4] as Step[]).map(s => {
            const title =
              s === 1 ? '1 · Tabblad' :
              s === 2 ? '2 · Header-rij' :
              s === 3 ? '3 · Kolommen' :
                        '4 · Verfijnen'
            const active = step === s, done = step > s
            return (
              <div
                key={s}
                onClick={() => { if (done) setStep(s) }}
                style={{
                  flex: 1, padding: '6px 10px', borderRadius: 6, fontSize: 11,
                  fontWeight: active ? 700 : 500,
                  background: active ? 'var(--bd-blue)' : done ? 'var(--bg3)' : 'transparent',
                  color: active ? 'var(--blue)' : done ? 'var(--green)' : 'var(--t3)',
                  border: `1px solid ${active ? 'var(--blue)' : 'var(--bd2)'}`,
                  cursor: done ? 'pointer' : 'default',
                  textAlign: 'center',
                }}
              >
                {done && '✓ '}{title}
              </div>
            )
          })}
        </div>

        <div style={{ padding: '16px 20px' }}>

          {/* ── STAP 1: Tabblad ────────────────────────────────────── */}
          {step === 1 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                Welk tabblad bevat de Missing Hours data?
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {sheetNames.map(n => {
                  const rowCount = workbook.Sheets[n]?.['!ref']
                    ? (workbook.Sheets[n]['!ref']!.split(':')[1]?.match(/\d+$/)?.[0] ?? '?')
                    : '?'
                  const isActive = sheetName === n
                  return (
                    <button
                      key={n}
                      onClick={() => setSheetName(n)}
                      style={{
                        padding: '9px 12px', borderRadius: 7,
                        border: `1px solid ${isActive ? 'var(--blue)' : 'var(--bd2)'}`,
                        background: isActive ? 'var(--bd-blue)' : 'var(--bg3)',
                        color: isActive ? 'var(--blue)' : 'var(--t1)',
                        cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font)',
                        fontWeight: isActive ? 600 : 500, fontSize: 12,
                        display: 'flex', alignItems: 'center', gap: 8,
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{isActive ? '◉' : '○'}</span>
                      <span style={{ flex: 1 }}>{n}</span>
                      <span style={{ fontSize: 10, color: 'var(--t3)' }}>{rowCount} rijen</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {/* ── STAP 2: Header-rij ─────────────────────────────────── */}
          {step === 2 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                Welke rij bevat de kolomkoppen?
              </div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 12 }}>
                Ons voorstel: <strong style={{ color: 'var(--blue)' }}>rij {(headerCandidates[0]?.rowIdx ?? 0) + 1}</strong>
                {' '}— klik op een andere rij als dat niet klopt.
              </div>

              <div style={{
                background: 'var(--bg3)', borderRadius: 7, border: '1px solid var(--bd2)',
                maxHeight: 340, overflow: 'auto',
              }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
                  <tbody>
                    {sheetRows.slice(0, 25).map((row, idx) => {
                      const isSelected = idx === headerRow
                      const isSuggested = idx === headerCandidates[0]?.rowIdx && headerCandidates[0]?.score > 0
                      const cand = headerCandidates.find(c => c.rowIdx === idx)
                      return (
                        <tr
                          key={idx}
                          onClick={() => setHeaderRow(idx)}
                          style={{
                            cursor: 'pointer',
                            background: isSelected ? 'var(--bd-blue)' : isSuggested ? 'rgba(38,201,151,.10)' : undefined,
                            borderBottom: '1px solid var(--bd)',
                          }}
                        >
                          <td style={{
                            padding: '5px 8px', fontFamily: 'var(--mono)', fontSize: 10,
                            color: isSelected ? 'var(--blue)' : 'var(--t3)',
                            fontWeight: isSelected ? 700 : 500,
                            borderRight: '1px solid var(--bd2)',
                            minWidth: 28, textAlign: 'center',
                            position: 'sticky', left: 0, background: isSelected ? 'var(--bd-blue)' : 'var(--bg3)',
                          }}>
                            {isSelected ? '▶' : idx + 1}
                          </td>
                          {row.slice(0, 10).map((cell, c) => (
                            <td key={c} style={{
                              padding: '5px 8px', whiteSpace: 'nowrap', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis',
                              color: isSelected ? 'var(--t1)' : 'var(--t2)',
                              fontWeight: isSelected ? 600 : 400,
                            }}>
                              {String(cell ?? '').slice(0, 40)}
                            </td>
                          ))}
                          {row.length > 10 && (
                            <td style={{ padding: '5px 8px', color: 'var(--t3)', fontSize: 10 }}>+{row.length - 10} kolommen</td>
                          )}
                          {cand && cand.score > 0 && isSuggested && !isSelected && (
                            <td style={{ padding: '5px 8px', color: 'var(--green)', fontSize: 10, fontWeight: 600 }}>
                              ★ voorstel
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {sheetRows.length > 25 && (
                <div style={{ marginTop: 6, fontSize: 10, color: 'var(--t3)' }}>
                  Eerste 25 rijen getoond ({sheetRows.length} totaal). Handmatige keuze: rij {headerRow + 1}.
                </div>
              )}
            </>
          )}

          {/* ── STAP 3: Kolommen & filter ─────────────────────────── */}
          {step === 3 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                Bevestig de kolom-mapping
              </div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 12 }}>
                {dataRows.length} data-rijen gedetecteerd · {headers.length} kolommen
              </div>

              <div style={{ display: 'grid', gap: 10 }}>
                <ColumnPicker
                  label="Kolom: Werknemer (ID / naam / SAP alias)"
                  helpText="Deze kolom wordt gematcht tegen de IC-tarieventabel"
                  color="var(--blue)"
                  value={werknemerCol}
                  onChange={setWerknemerCol}
                  headers={headers}
                  suggestion={suggested.werknemerCol}
                  previewValues={dataRows.slice(0, 3).map(r => String(r[werknemerCol] ?? ''))}
                  matchStats={columnMatchStats}
                />

                {/* Waarschuwing + niet-gematchte voorbeelden voor werknemer-kolom */}
                {werknemerCol && columnMatchStats[werknemerCol] && (() => {
                  const stat = columnMatchStats[werknemerCol]
                  const ratio = stat.total > 0 ? stat.matches / stat.total : 0
                  if (ratio >= 0.5) return null

                  // Zoek betere alternatieve kolom
                  const better = Object.entries(columnMatchStats)
                    .filter(([h, s]) => h !== werknemerCol && s.matches > stat.matches)
                    .sort((a, b) => b[1].matches - a[1].matches)[0]

                  return (
                    <div style={{
                      marginLeft: 12, padding: '10px 12px', background: 'var(--bd-amber)',
                      border: '1px solid var(--amber)', borderRadius: 7, fontSize: 11,
                    }}>
                      <div style={{ color: 'var(--amber)', fontWeight: 700, marginBottom: 4 }}>
                        ⚠ Kolom "{werknemerCol}" matcht maar {stat.matches} van {stat.total} sample-rijen
                      </div>
                      {better && better[1].matches > 0 && (
                        <div style={{ color: 'var(--t2)', marginBottom: 6 }}>
                          Kolom <strong
                            style={{ color: 'var(--blue)', cursor: 'pointer', textDecoration: 'underline' }}
                            onClick={() => setWerknemerCol(better[0])}
                          >"{better[0]}"</strong> heeft {better[1].matches} matches — klik om te wisselen.
                        </div>
                      )}
                      {unmatchedSamples.length > 0 && (
                        <details>
                          <summary style={{ color: 'var(--t2)', cursor: 'pointer', fontSize: 10 }}>
                            Voorbeelden van niet-gematchte waarden ({unmatchedSamples.length})
                          </summary>
                          <div style={{ fontFamily: 'var(--mono)', marginTop: 4, fontSize: 10, color: 'var(--t3)' }}>
                            {unmatchedSamples.map((v, i) => (
                              <div key={i}>"{v.slice(0, 60)}"</div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  )
                })()}
                <ColumnPicker
                  label="Kolom: Missing Hours (uren)"
                  helpText="Aantal ontbrekende/nog niet geboekte uren per werknemer"
                  color="var(--green)"
                  value={urenCol}
                  onChange={setUrenCol}
                  headers={headers}
                  suggestion={suggested.urenCol}
                  previewValues={dataRows.slice(0, 3).map(r => String(r[urenCol] ?? ''))}
                />
                <ColumnPicker
                  label="Kolom: Bedrijf / BV (optioneel filter)"
                  helpText="Alleen werknemers die bij dit bedrijf horen worden meegenomen"
                  color="var(--amber)"
                  value={bedrijfCol}
                  onChange={setBedrijfCol}
                  headers={headers}
                  suggestion={suggested.bedrijfCol}
                  previewValues={dataRows.slice(0, 3).map(r => String(r[bedrijfCol] ?? ''))}
                  allowNone
                />
                {bedrijfCol && (
                  <div style={{ paddingLeft: 12, borderLeft: '2px solid var(--amber)', fontSize: 11 }}>
                    <div style={{ color: 'var(--t3)', marginBottom: 4 }}>Alleen rijen waarvan de bedrijfskolom matcht met:</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {['Consultancy', 'P15000', ''].map(f => (
                        <button
                          key={f || 'none'}
                          onClick={() => setBedrijfFilter(f)}
                          className={`btn sm${bedrijfFilter === f ? ' primary' : ' ghost'}`}
                          style={{ fontSize: 10 }}
                        >
                          {f || '(geen filter)'}
                        </button>
                      ))}
                      <input
                        type="text"
                        placeholder="of typ een waarde..."
                        value={bedrijfFilter}
                        onChange={e => setBedrijfFilter(e.target.value)}
                        className="ohw-inp"
                        style={{ width: 140, marginLeft: 6, fontSize: 10 }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Live preview */}
              {livePreview && (
                <div style={{
                  marginTop: 14, padding: '12px 14px', borderRadius: 7,
                  background: livePreview.totalAmount > 0 ? 'var(--bd-green)' : 'var(--bd-amber)',
                  border: `1px solid ${livePreview.totalAmount > 0 ? 'var(--green)' : 'var(--amber)'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                        Live berekening
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--t1)', marginTop: 4 }}>
                        {livePreview.missingHoursCounts?.matched ?? 0} gematcht van {livePreview.rowCount} rijen
                      </div>
                    </div>
                    <div style={{
                      fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700,
                      color: livePreview.totalAmount > 0 ? 'var(--green)' : 'var(--amber)',
                    }}>
                      {fmt(livePreview.totalAmount)}
                    </div>
                  </div>

                  {/* Rij-verantwoording — transparant overzicht waar alle rijen naartoe gaan */}
                  {livePreview.missingHoursCounts && (
                    <div style={{
                      marginTop: 8, padding: '8px 10px', background: 'var(--bg2)',
                      borderRadius: 5, fontSize: 10, color: 'var(--t2)',
                      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 4,
                    }}>
                      <RowAccountingTag label="In totaal" value={livePreview.missingHoursCounts.matched} color="var(--green)" />
                      <RowAccountingTag label="Geen tarief" value={livePreview.missingHoursCounts.needsTariff} color="var(--red)" />
                      <RowAccountingTag label="Onbekend" value={livePreview.missingHoursCounts.unmatched} color="var(--amber)" />
                      <RowAccountingTag label="Leeg / 0 uren" value={livePreview.missingHoursCounts.emptyOrZero} color="var(--t3)" />
                      <RowAccountingTag label="Negatief" value={livePreview.missingHoursCounts.negative} color="var(--t3)" />
                      {bedrijfCol && bedrijfFilter && (
                        <RowAccountingTag
                          label={`Bedrijfsfilter "${bedrijfFilter}"`}
                          value={livePreview.missingHoursCounts.bedrijfFiltered}
                          color="var(--amber)"
                          warn={livePreview.missingHoursCounts.bedrijfFiltered > livePreview.rowCount * 0.5}
                        />
                      )}
                    </div>
                  )}

                  {livePreview.totalAmount === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 6 }}>
                      ⚠ € 0 — controleer de kolomselectie. Mogelijk wijst de werknemer-kolom naar een kolom zonder IDs/namen, of is de bedrijfsfilter te streng.
                    </div>
                  )}
                  {livePreview.missingHoursCounts && livePreview.missingHoursCounts.bedrijfFiltered > livePreview.rowCount * 0.5 && (
                    <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 6 }}>
                      ⚠ De bedrijfsfilter filtert meer dan de helft van de rijen weg. Zet "Bedrijf / BV kolom" uit als je de filter niet nodig hebt.
                    </div>
                  )}
                  {livePreview.warnings.length > 0 && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ fontSize: 10, color: 'var(--t2)', cursor: 'pointer' }}>
                        Details ({livePreview.warnings.length})
                      </summary>
                      <div style={{ marginTop: 6, fontSize: 10, color: 'var(--t2)', lineHeight: 1.5 }}>
                        {livePreview.warnings.map((w, i) => (
                          <div key={i} style={{ marginBottom: 2 }}>• {w}</div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}

              {/* Preview eerste 5 rijen */}
              {dataRows.length > 0 && (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ fontSize: 10, color: 'var(--t3)', cursor: 'pointer' }}>
                    Preview eerste data-rijen
                  </summary>
                  <div style={{ marginTop: 6, background: 'var(--bg3)', borderRadius: 6, padding: 8, maxHeight: 180, overflow: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: 10, width: '100%' }}>
                      <thead>
                        <tr>
                          {headers.slice(0, 8).map(h => (
                            <th key={h} style={{
                              textAlign: 'left', padding: '3px 6px', whiteSpace: 'nowrap',
                              borderBottom: '1px solid var(--bd2)',
                              color:
                                h === werknemerCol ? 'var(--blue)' :
                                h === urenCol     ? 'var(--green)' :
                                h === bedrijfCol  ? 'var(--amber)' : 'var(--t3)',
                              fontWeight: (h === werknemerCol || h === urenCol || h === bedrijfCol) ? 700 : 500,
                            }}>
                              {h.slice(0, 24)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dataRows.slice(0, 5).map((r, i) => (
                          <tr key={i}>
                            {headers.slice(0, 8).map(h => (
                              <td key={h} style={{ padding: '3px 6px', color: 'var(--t2)', whiteSpace: 'nowrap' }}>
                                {String(r[h] ?? '').slice(0, 30)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </>
          )}

          {/* ── STAP 4: Verfijnen — werknemers handmatig uitvinken ─── */}
          {step === 4 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                Controleer & verfijn de werknemerslijst
              </div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 12 }}>
                Vink werknemers uit die je niet wilt meenemen in het eindtotaal.
                Het totaal werkt live bij.
              </div>

              {/* Search + bulk-actions */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Zoek op naam, ID of ruwe identifier..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="ohw-inp"
                  style={{ flex: 1, textAlign: 'left', width: 'auto' }}
                />
                <button
                  className="btn sm ghost"
                  onClick={() => { setExcludedIds(new Set()); setExcludedRows(new Set()) }}
                  disabled={excludedIds.size === 0 && excludedRows.size === 0}
                  style={{ fontSize: 10 }}
                >
                  ↻ Reset uitsluitingen ({excludedIds.size + excludedRows.size})
                </button>
                <button
                  className="btn sm ghost"
                  onClick={() => {
                    // Vink alles uit (alleen de gefilterde rijen)
                    const visible = allDetails.filter(d => matchesSearch(d, searchTerm))
                    setExcludedRows(new Set(visible.map(d => d.rowIndex)))
                  }}
                  disabled={allDetails.length === 0}
                  style={{ fontSize: 10 }}
                >
                  ✕ Alle uit
                </button>
                <button
                  className="btn sm ghost"
                  onClick={() => { setExcludedIds(new Set()); setExcludedRows(new Set()) }}
                  disabled={allDetails.length === 0}
                  style={{ fontSize: 10 }}
                >
                  ✓ Alle aan
                </button>
              </div>

              {/* Lijst van werknemers — met checkbox per rij */}
              <div style={{
                background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--bd2)',
                maxHeight: 320, overflow: 'auto',
              }}>
                {allDetails.length === 0 && (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--t3)', fontSize: 11 }}>
                    Geen werknemers gematcht in stap 3 — pas de kolomselectie aan.
                  </div>
                )}
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--bg4)', zIndex: 1 }}>
                    <tr>
                      <th style={{ padding: '7px 10px', width: 32 }}></th>
                      <th style={{ padding: '7px 10px', textAlign: 'left', color: 'var(--t2)', fontWeight: 600 }}>Werknemer</th>
                      <th style={{ padding: '7px 10px', textAlign: 'left', color: 'var(--t3)', fontWeight: 500, fontSize: 10 }}>Bron</th>
                      <th className="r" style={{ padding: '7px 10px', color: 'var(--t2)', fontWeight: 600 }}>Uren</th>
                      <th className="r" style={{ padding: '7px 10px', color: 'var(--t2)', fontWeight: 600 }}>Tarief</th>
                      <th className="r" style={{ padding: '7px 10px', color: 'var(--t2)', fontWeight: 600 }}>Bedrag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allDetails
                      .filter(d => matchesSearch(d, searchTerm))
                      .map(d => {
                        const excludedById  = excludedIds.has(d.id)
                        const excludedByRow = excludedRows.has(d.rowIndex)
                        const included = !excludedById && !excludedByRow
                        const needsTariff = !d.tarief || d.tarief <= 0
                        return (
                          <tr
                            key={`${d.id}-${d.rowIndex}`}
                            onClick={() => {
                              // Toggle op row-index (stabiel, ook als zelfde ID meerdere keren voorkomt)
                              setExcludedRows(prev => {
                                const next = new Set(prev)
                                if (included) next.add(d.rowIndex)
                                else next.delete(d.rowIndex)
                                return next
                              })
                              // Reset id-based exclusion als die actief is (zodat toggle voorspelbaar blijft)
                              if (excludedById) {
                                setExcludedIds(prev => {
                                  const next = new Set(prev)
                                  next.delete(d.id)
                                  return next
                                })
                              }
                            }}
                            style={{
                              cursor: 'pointer',
                              opacity: included ? 1 : 0.45,
                              textDecoration: included ? 'none' : 'line-through',
                              borderBottom: '1px solid var(--bd)',
                              background: needsTariff ? 'rgba(239,83,80,0.06)' : undefined,
                            }}
                          >
                            <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={included}
                                onChange={() => { /* handled by tr onClick */ }}
                                onClick={e => e.stopPropagation()}
                                style={{ cursor: 'pointer', accentColor: 'var(--blue)' }}
                              />
                            </td>
                            <td style={{ padding: '6px 10px' }}>
                              <div style={{ fontWeight: 600, color: included ? 'var(--t1)' : 'var(--t3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                {d.naam || d.id}
                                {needsTariff && (
                                  <span style={{
                                    fontSize: 9, padding: '1px 6px', borderRadius: 3,
                                    background: 'var(--bd-red)', color: 'var(--red)', fontWeight: 700,
                                    border: '1px solid var(--red)',
                                  }}>
                                    GEEN IC TARIEF
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--t3)' }}>ID {d.id}</div>
                            </td>
                            <td style={{ padding: '6px 10px', fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--mono)' }}>
                              "{d.rawId.slice(0, 30)}"
                            </td>
                            <td className="r mono" style={{ padding: '6px 10px' }}>{d.uren.toFixed(1)}</td>
                            <td
                              className="r"
                              style={{ padding: '6px 10px', fontFamily: 'var(--mono)' }}
                              onClick={e => e.stopPropagation()}
                            >
                              {needsTariff ? (
                                <TariffInput
                                  employeeId={d.id}
                                  onSave={onSetTariff}
                                />
                              ) : (
                                <span style={{ color: 'var(--t3)' }}>€{d.tarief}</span>
                              )}
                            </td>
                            <td className="r mono" style={{ padding: '6px 10px', fontWeight: 600 }}>
                              {needsTariff ? (
                                <span style={{ color: 'var(--red)', fontSize: 10 }}>—</span>
                              ) : (
                                fmt(Math.round(d.bedrag))
                              )}
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>

              {/* Summary / Live totaal */}
              {livePreview && (
                <div style={{
                  marginTop: 14, padding: '12px 14px', borderRadius: 7,
                  background: livePreview.totalAmount > 0 ? 'var(--bd-green)' : 'var(--bd-amber)',
                  border: `1px solid ${livePreview.totalAmount > 0 ? 'var(--green)' : 'var(--amber)'}`,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                      Eindtotaal na verfijning
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--t1)', marginTop: 4 }}>
                      {allDetails.length - excludedIds.size - excludedRows.size} van {allDetails.length} werknemers meegerekend
                      {(excludedIds.size + excludedRows.size) > 0 && (
                        <span style={{ color: 'var(--amber)', marginLeft: 6 }}>
                          · {excludedIds.size + excludedRows.size} uitgesloten
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{
                    fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700,
                    color: livePreview.totalAmount > 0 ? 'var(--green)' : 'var(--amber)',
                  }}>
                    {fmt(livePreview.totalAmount)}
                  </div>
                </div>
              )}

              {/* Onbekende identifiers — transparantie over niet-gematchte rijen */}
              {livePreview?.missingHoursCounts && livePreview.missingHoursCounts.unmatched > 0 && (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ fontSize: 11, color: 'var(--amber)', cursor: 'pointer', fontWeight: 600 }}>
                    ⚠ {livePreview.missingHoursCounts.unmatched} rij(en) niet gematcht aan Consultancy tarieventabel
                    {' — '}bekijk welke
                  </summary>
                  <div style={{
                    marginTop: 6, padding: '8px 10px', background: 'var(--bd-amber)',
                    borderRadius: 5, fontSize: 10, color: 'var(--t2)',
                    maxHeight: 160, overflow: 'auto',
                  }}>
                    <div style={{ color: 'var(--amber)', marginBottom: 4 }}>
                      Deze werknemers staan niet in de Consultancy tarieventabel. Check of ze
                      een andere BV hebben, of voeg ze toe via "IC Tarieven" tab.
                    </div>
                    {getUnmatchedIdentifiers(livePreview.warnings).map((id, i) => (
                      <div key={i} style={{ fontFamily: 'var(--mono)', padding: '1px 0' }}>• {id}</div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}

        </div>

        {/* Footer: navigation buttons */}
        <div style={{
          padding: '14px 20px', borderTop: '1px solid var(--bd)',
          display: 'flex', gap: 8, position: 'sticky', bottom: 0, background: 'var(--bg2)',
        }}>
          {step > 1 && (
            <button className="btn ghost" onClick={() => setStep((step - 1) as Step)}>
              ← Vorige
            </button>
          )}
          <button className="btn ghost" onClick={onCancel} style={{ marginLeft: step === 1 ? 0 : 'auto' }}>
            Annuleren
          </button>
          {step < 4 ? (
            <button
              className="btn primary"
              disabled={!canAdvance()}
              onClick={() => setStep((step + 1) as Step)}
              style={{ marginLeft: step === 1 ? 'auto' : 0 }}
            >
              Volgende →
            </button>
          ) : (
            <button
              className="btn success"
              disabled={!canAdvance() || !livePreview}
              onClick={handleConfirm}
            >
              ✓ Bevestigen & doorzetten
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── ColumnPicker: dropdown + preview van 3 waarden ──
interface ColumnPickerProps {
  label: string
  helpText?: string
  color: string
  value: string
  onChange: (v: string) => void
  headers: string[]
  suggestion: string
  previewValues: string[]
  allowNone?: boolean
  /** Optioneel: per-kolom match-statistieken om in de dropdown te tonen */
  matchStats?: Record<string, { matches: number; total: number }>
}

function ColumnPicker({ label, helpText, color, value, onChange, headers, suggestion, previewValues, allowNone, matchStats }: ColumnPickerProps) {
  const selectedStat = matchStats && value ? matchStats[value] : null
  return (
    <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '10px 12px', border: `1px solid var(--bd2)`, borderLeftWidth: 3, borderLeftColor: color }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t1)' }}>{label}</div>
        {suggestion && suggestion === value && (
          <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'var(--bd-green)', color: 'var(--green)', fontWeight: 700 }}>
            AUTO
          </span>
        )}
        {selectedStat && (
          <span style={{
            fontSize: 9, padding: '1px 6px', borderRadius: 3, fontWeight: 700, marginLeft: 'auto',
            background: selectedStat.matches === 0
              ? 'var(--bd-red)'
              : selectedStat.matches / selectedStat.total >= 0.5
                ? 'var(--bd-green)'
                : 'var(--bd-amber)',
            color: selectedStat.matches === 0
              ? 'var(--red)'
              : selectedStat.matches / selectedStat.total >= 0.5
                ? 'var(--green)'
                : 'var(--amber)',
          }}>
            {selectedStat.matches}/{selectedStat.total} matches
          </span>
        )}
      </div>
      {helpText && (
        <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 6 }}>{helpText}</div>
      )}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          background: 'var(--bg1)', border: '1px solid var(--bd3)', borderRadius: 5,
          color: 'var(--t1)', fontSize: 11, padding: '5px 8px', width: '100%',
          outline: 'none', cursor: 'pointer',
        }}
      >
        {allowNone && <option value="">— geen filter (alle rijen) —</option>}
        {!allowNone && !value && <option value="">— kies een kolom —</option>}
        {headers.map(h => {
          const stat = matchStats?.[h]
          const suffix =
            suggestion === h ? '   (voorstel)' :
            stat && stat.matches > 0 ? `   [${stat.matches} matches]` : ''
          return (
            <option key={h} value={h}>
              {h}{suffix}
            </option>
          )
        })}
      </select>
      {value && previewValues.length > 0 && (
        <div style={{ marginTop: 5, fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--mono)' }}>
          Voorbeeldwaarden: {previewValues.filter(Boolean).slice(0, 3).map(v => `"${v.slice(0, 20)}"`).join(' · ') || '—'}
        </div>
      )}
    </div>
  )
}

// ── RowAccountingTag: toont een bucket-teller met kleur/warn-indicator ──
function RowAccountingTag({ label, value, color, warn }: { label: string; value: number; color: string; warn?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '2px 4px',
      ...(warn ? { background: 'rgba(245,166,35,0.15)', borderRadius: 3 } : {}),
    }}>
      <span style={{
        fontFamily: 'var(--mono)', fontWeight: 700, color: value > 0 ? color : 'var(--t3)',
      }}>{value}</span>
      <span style={{ color: 'var(--t3)', fontSize: 9 }}>{label}</span>
    </div>
  )
}

// ── TariffInput: inline invoer voor ontbrekend IC tarief ──
interface TariffInputProps {
  employeeId: string
  onSave: (employeeId: string, tarief: number) => void
}

function TariffInput({ employeeId, onSave }: TariffInputProps) {
  const [raw, setRaw] = useState<string>('')
  const commit = () => {
    if (!raw.trim()) return
    const normalized = raw.replace(',', '.').trim()
    const n = parseFloat(normalized)
    if (!isFinite(n) || n <= 0) return
    onSave(employeeId, n)
    setRaw('')  // leeg maken — nieuwe tarief komt via store-refresh in d.tarief terug
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      placeholder="€/uur"
      value={raw}
      onChange={e => setRaw(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur() }
        else if (e.key === 'Escape') setRaw('')
      }}
      onBlur={commit}
      style={{
        width: 70,
        background: 'var(--bg1)',
        border: '1px solid var(--red)',
        borderRadius: 5,
        color: 'var(--t1)',
        fontSize: 11,
        padding: '3px 6px',
        fontFamily: 'var(--mono)',
        textAlign: 'right',
        outline: 'none',
      }}
      onClick={e => e.stopPropagation()}
    />
  )
}
