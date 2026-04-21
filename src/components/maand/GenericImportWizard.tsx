import { useEffect, useMemo, useState } from 'react'
import type * as XLSX from 'xlsx'
import {
  readSheetAsArrays,
  scoreHeaderRows,
  extractTableFromSheet,
  suggestGenericImportColumns,
  computeGenericImport,
  perColumnAmountMatches,
  perColumnBvMatches,
  getSlotConfig,
} from '../../lib/parseImport'
import type {
  ParseResult,
  GenericImportConfig,
  GenericImportDetail,
} from '../../lib/parseImport'
import { fmt } from '../../lib/format'
import type { BvId } from '../../data/types'

const BV_COLORS: Record<BvId, string> = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
}

interface SlotMeta {
  id: string
  label: string
  icon: string
  /** Toont "EUR" (bedragen) of "u" (uren) in de weergave */
  unit: 'eur' | 'hours'
}

const SLOT_META: Record<string, SlotMeta> = {
  factuurvolume:   { id: 'factuurvolume',   label: 'Factuurvolume',    icon: '🧾', unit: 'eur' },
  geschreven_uren: { id: 'geschreven_uren', label: 'Geschreven uren',  icon: '⏱',  unit: 'hours' },
  // uren-lijst: de waarde die we willen sommeren is de NETTO WAARDE (€) per BV,
  // niet de uren zelf. Output gaat naar een OHW-rij per BV.
  uren_lijst:      { id: 'uren_lijst',      label: 'Uren lijst',       icon: '📋', unit: 'eur' },
  d_lijst:         { id: 'd_lijst',         label: 'D Lijst',          icon: '📊', unit: 'eur' },
  conceptfacturen: { id: 'conceptfacturen', label: 'Conceptfacturen',  icon: '📄', unit: 'eur' },
}

interface Props {
  workbook: XLSX.WorkBook
  fileName: string
  slotId: string
  onConfirm: (result: ParseResult, cfg: {
    sheetName: string
    headerRow: number
    amountCol: string
    bvCol?: string
    bvFilter?: BvId
  }) => void
  onCancel: () => void
}

type Step = 1 | 2 | 3 | 4

export function GenericImportWizard({ workbook, fileName, slotId, onConfirm, onCancel }: Props) {
  const slotConfig = getSlotConfig(slotId)
  const meta = SLOT_META[slotId] ?? { id: slotId, label: slotId, icon: '📄', unit: 'eur' as const }
  const isSingleBv = !!slotConfig?.targetBv
  const isHoursSlot = meta.unit === 'hours'

  const [step, setStep] = useState<Step>(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [excludedRows, setExcludedRows] = useState<Set<number>>(new Set())

  // Step 1 — sheet
  const sheetNames = workbook.SheetNames
  const defaultSheet = sheetNames.find(n => new RegExp(slotId.replace(/_/g, '.?'), 'i').test(n)) ?? sheetNames[0]
  const [sheetName, setSheetName] = useState<string>(defaultSheet)

  // Step 2 — header-row
  const sheetRows = useMemo(() => readSheetAsArrays(workbook, sheetName), [workbook, sheetName])
  const headerCandidates = useMemo(() => scoreHeaderRows(sheetRows), [sheetRows])
  const [headerRow, setHeaderRow] = useState<number>(0)

  useEffect(() => {
    if (headerCandidates.length > 0 && headerCandidates[0].score > 0) {
      setHeaderRow(headerCandidates[0].rowIdx)
    } else {
      setHeaderRow(0)
    }
  }, [sheetName, headerCandidates])

  // Step 3 — columns
  const { headers, dataRows } = useMemo(
    () => extractTableFromSheet(sheetRows, headerRow),
    [sheetRows, headerRow],
  )
  const suggested = useMemo(
    () => suggestGenericImportColumns(headers, dataRows, slotId),
    [headers, dataRows, slotId],
  )
  const amountStats = useMemo(
    () => perColumnAmountMatches(headers, dataRows),
    [headers, dataRows],
  )
  const bvStats = useMemo(
    () => perColumnBvMatches(headers, dataRows),
    [headers, dataRows],
  )

  const [amountCol, setAmountCol] = useState<string>('')
  const [bvCol, setBvCol] = useState<string>('')
  const [bvFilter, setBvFilter] = useState<BvId | ''>('')

  useEffect(() => {
    setAmountCol(suggested.amountCol)
    setBvCol(isSingleBv ? '' : suggested.bvCol)
    setBvFilter(suggested.bvFilterSuggestion)
  }, [suggested.amountCol, suggested.bvCol, suggested.bvFilterSuggestion, isSingleBv])

  // Reset exclusions when config changes
  useEffect(() => {
    setExcludedRows(new Set())
  }, [amountCol, bvCol, bvFilter])

  // Live preview
  const livePreview: ParseResult | null = useMemo(() => {
    if (step < 3) return null
    if (!amountCol) return null
    if (!isSingleBv && !bvCol) return null
    try {
      const cfg: GenericImportConfig = {
        amountCol,
        bvCol: isSingleBv ? undefined : bvCol,
        bvFilter: bvFilter || undefined,
        excludedRowIndices: step === 4 ? excludedRows : undefined,
      }
      return computeGenericImport(headers, dataRows, slotId, cfg)
    } catch {
      return null
    }
  }, [step, amountCol, bvCol, bvFilter, excludedRows, headers, dataRows, slotId, isSingleBv])

  // Alle details voor stap 4 (zonder handmatige exclusions)
  const detailsInline: GenericImportDetail[] = useMemo(() => {
    if (!amountCol) return []
    if (!isSingleBv && !bvCol) return []
    try {
      const cfg: GenericImportConfig = {
        amountCol,
        bvCol: isSingleBv ? undefined : bvCol,
        bvFilter: bvFilter || undefined,
      }
      const r = computeGenericImport(headers, dataRows, slotId, cfg)
      return r.genericImportDetails ?? []
    } catch { return [] }
  }, [amountCol, bvCol, bvFilter, headers, dataRows, slotId, isSingleBv])

  const canAdvance = () => {
    if (step === 1) return !!sheetName
    if (step === 2) return headerRow >= 0 && headers.length > 0
    if (step === 3) return !!amountCol && (isSingleBv || !!bvCol) && !!livePreview
    if (step === 4) return !!livePreview
    return false
  }

  const handleConfirm = () => {
    if (!livePreview) return
    onConfirm(livePreview, {
      sheetName,
      headerRow,
      amountCol,
      bvCol: bvCol || undefined,
      bvFilter: (bvFilter || undefined) as BvId | undefined,
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
          <span style={{ fontSize: 20 }}>{meta.icon}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{meta.label} — bestandsanalyse</div>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
              {fileName} · {sheetNames.length} tabblad{sheetNames.length === 1 ? '' : 'en'}
              {isSingleBv && (
                <span style={{ color: BV_COLORS[slotConfig!.targetBv!], marginLeft: 8 }}>
                  · alleen {slotConfig!.targetBv}
                </span>
              )}
            </div>
          </div>
          <button onClick={onCancel} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--t3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', padding: '12px 20px', gap: 4, borderBottom: '1px solid var(--bd)' }}>
          {([1, 2, 3, 4] as Step[]).map(s => {
            const title = s === 1 ? '1 · Tabblad' : s === 2 ? '2 · Header-rij' : s === 3 ? '3 · Kolommen' : '4 · Verfijnen'
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
          {/* STAP 1 — Sheet */}
          {step === 1 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                Welk tabblad bevat de {meta.label} data?
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

          {/* STAP 2 — Header-rij */}
          {step === 2 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                Welke rij bevat de kolomkoppen?
              </div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 12 }}>
                Voorstel: <strong style={{ color: 'var(--blue)' }}>rij {(headerCandidates[0]?.rowIdx ?? 0) + 1}</strong>
                {' '}— klik op een andere rij als dat niet klopt.
              </div>
              <div style={{ background: 'var(--bg3)', borderRadius: 7, border: '1px solid var(--bd2)', maxHeight: 340, overflow: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
                  <tbody>
                    {sheetRows.slice(0, 25).map((row, idx) => {
                      const isSelected = idx === headerRow
                      const isSuggested = idx === headerCandidates[0]?.rowIdx && headerCandidates[0]?.score > 0
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
                            color: isSelected ? 'var(--blue)' : 'var(--t3)', fontWeight: isSelected ? 700 : 500,
                            borderRight: '1px solid var(--bd2)', minWidth: 28, textAlign: 'center',
                            position: 'sticky', left: 0, background: isSelected ? 'var(--bd-blue)' : 'var(--bg3)',
                          }}>
                            {isSelected ? '▶' : idx + 1}
                          </td>
                          {row.slice(0, 10).map((cell, c) => (
                            <td key={c} style={{
                              padding: '5px 8px', whiteSpace: 'nowrap',
                              maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis',
                              color: isSelected ? 'var(--t1)' : 'var(--t2)', fontWeight: isSelected ? 600 : 400,
                            }}>
                              {String(cell ?? '').slice(0, 40)}
                            </td>
                          ))}
                          {row.length > 10 && <td style={{ padding: '5px 8px', color: 'var(--t3)', fontSize: 10 }}>+{row.length - 10}</td>}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* STAP 3 — Kolommen */}
          {step === 3 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                Bevestig de kolom-mapping
              </div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 12 }}>
                {dataRows.length} data-rijen · {headers.length} kolommen
                {isSingleBv && (
                  <span style={{ color: BV_COLORS[slotConfig!.targetBv!], marginLeft: 8 }}>
                    Single-BV slot: totaal gaat volledig naar <strong>{slotConfig!.targetBv}</strong>
                  </span>
                )}
              </div>

              <div style={{ display: 'grid', gap: 10 }}>
                <AmountColumnPicker
                  label={isHoursSlot ? 'Kolom: Uren' : 'Kolom: Bedrag (netto excl. BTW)'}
                  helpText={isHoursSlot
                    ? 'Kolom met uurgetallen. Waarden als "40 u" worden automatisch als 40 herkend.'
                    : 'Kolom met bedragen. Waarden als "1.234 EUR" of "1234,-" worden automatisch herkend.'}
                  color="var(--green)"
                  value={amountCol}
                  onChange={setAmountCol}
                  headers={headers}
                  suggestion={suggested.amountCol}
                  previewValues={dataRows.slice(0, 3).map(r => String(r[amountCol] ?? ''))}
                  matchStats={amountStats}
                />

                {!isSingleBv && (
                  <BvColumnPicker
                    label="Kolom: BV (business unit)"
                    helpText='Kolom die de BV per rij aangeeft (bv. "Projects AK", "P25000", "TPG-C"). De waarden worden herkend als Consultancy / Projects / Software.'
                    color="var(--blue)"
                    value={bvCol}
                    onChange={setBvCol}
                    headers={headers}
                    suggestion={suggested.bvCol}
                    previewValues={dataRows.slice(0, 3).map(r => String(r[bvCol] ?? ''))}
                    bvStats={bvStats}
                  />
                )}

                {!isSingleBv && bvCol && (
                  <div style={{ paddingLeft: 12, borderLeft: '2px solid var(--amber)', fontSize: 11 }}>
                    <div style={{ color: 'var(--t3)', marginBottom: 4 }}>
                      Optioneel: beperk tot één BV
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {(['', 'Consultancy', 'Projects', 'Software'] as Array<BvId | ''>).map(f => (
                        <button
                          key={f || 'none'}
                          onClick={() => setBvFilter(f)}
                          className={`btn sm${bvFilter === f ? ' primary' : ' ghost'}`}
                          style={{ fontSize: 10 }}
                        >
                          {f || 'Alle BVs'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Live preview */}
              {livePreview && (
                <div style={{
                  marginTop: 14, padding: '12px 14px', borderRadius: 7,
                  background: livePreview.totalAmount !== 0 ? 'var(--bd-green)' : 'var(--bd-amber)',
                  border: `1px solid ${livePreview.totalAmount !== 0 ? 'var(--green)' : 'var(--amber)'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                        Live berekening
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--t1)', marginTop: 4 }}>
                        {livePreview.parsedCount} gematcht van {livePreview.rowCount} rijen
                      </div>
                    </div>
                    <div style={{
                      fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700,
                      color: livePreview.totalAmount !== 0 ? 'var(--green)' : 'var(--amber)',
                    }}>
                      {isHoursSlot ? `${livePreview.totalAmount.toLocaleString('nl-NL')} u` : fmt(livePreview.totalAmount)}
                    </div>
                  </div>

                  {/* Per-BV breakdown voor multi-BV slots */}
                  {!isSingleBv && (
                    <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                      {(['Consultancy', 'Projects', 'Software'] as BvId[]).map(b => (
                        <div key={b} style={{
                          padding: '6px 8px', background: 'var(--bg2)', borderRadius: 5,
                          border: `1px solid ${BV_COLORS[b]}33`, fontSize: 11,
                        }}>
                          <div style={{ color: BV_COLORS[b], fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                            {b}
                          </div>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, marginTop: 2 }}>
                            {isHoursSlot ? `${(livePreview.perBv[b] ?? 0).toLocaleString('nl-NL')} u` : fmt(livePreview.perBv[b] ?? 0)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Bucket counts */}
                  {livePreview.missingHoursCounts && (
                    <div style={{
                      marginTop: 8, padding: '6px 10px', background: 'var(--bg2)',
                      borderRadius: 5, fontSize: 10, color: 'var(--t2)',
                      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 4,
                    }}>
                      <BucketTag label="In totaal" value={livePreview.missingHoursCounts.matched} color="var(--green)" />
                      <BucketTag label="Geen BV" value={livePreview.missingHoursCounts.unmatched} color="var(--amber)" />
                      <BucketTag label="Leeg / 0" value={livePreview.missingHoursCounts.emptyOrZero} color="var(--t3)" />
                      <BucketTag label="Totaalregels" value={livePreview.missingHoursCounts.totalRowsSkipped} color="var(--t3)" />
                      {bvFilter && <BucketTag label={`Filter "${bvFilter}"`} value={livePreview.missingHoursCounts.bedrijfFiltered} color="var(--amber)" />}
                    </div>
                  )}

                  {livePreview.totalAmount === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 6 }}>
                      ⚠ Totaal = 0 — controleer de kolomselectie.
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* STAP 4 — Verfijnen */}
          {step === 4 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                Controleer & verfijn de rijen
              </div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 12 }}>
                Vink rijen uit die je niet wilt meenemen. Totaal werkt live bij.
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Zoek op BV, bedrag of ruwe waarde..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="ohw-inp"
                  style={{ flex: 1, textAlign: 'left', width: 'auto' }}
                />
                <button
                  className="btn sm ghost"
                  onClick={() => setExcludedRows(new Set())}
                  disabled={excludedRows.size === 0}
                  style={{ fontSize: 10 }}
                >
                  ↻ Reset ({excludedRows.size})
                </button>
              </div>

              <div style={{
                background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--bd2)',
                maxHeight: 320, overflow: 'auto',
              }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--bg4)', zIndex: 1 }}>
                    <tr>
                      <th style={{ padding: '7px 10px', width: 32 }}></th>
                      <th style={{ padding: '7px 10px', textAlign: 'left', color: 'var(--t2)', fontWeight: 600 }}>Rij</th>
                      {!isSingleBv && <th style={{ padding: '7px 10px', textAlign: 'left', color: 'var(--t2)', fontWeight: 600 }}>BV</th>}
                      <th style={{ padding: '7px 10px', textAlign: 'left', color: 'var(--t3)', fontWeight: 500, fontSize: 10 }}>Ruwe waarde</th>
                      <th className="r" style={{ padding: '7px 10px', color: 'var(--t2)', fontWeight: 600 }}>{isHoursSlot ? 'Uren' : 'Bedrag'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailsInline
                      .filter(d => !searchTerm || [String(d.amount), d.rawAmount, d.rawBv, d.bv ?? ''].join(' ').toLowerCase().includes(searchTerm.toLowerCase()))
                      .map(d => {
                        const included = !excludedRows.has(d.rowIndex)
                        return (
                          <tr
                            key={d.rowIndex}
                            onClick={() => {
                              setExcludedRows(prev => {
                                const next = new Set(prev)
                                if (included) next.add(d.rowIndex); else next.delete(d.rowIndex)
                                return next
                              })
                            }}
                            style={{
                              cursor: 'pointer',
                              opacity: included ? 1 : 0.45,
                              textDecoration: included ? 'none' : 'line-through',
                              borderBottom: '1px solid var(--bd)',
                            }}
                          >
                            <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={included}
                                onChange={() => {}}
                                onClick={e => e.stopPropagation()}
                                style={{ cursor: 'pointer', accentColor: 'var(--blue)' }}
                              />
                            </td>
                            <td style={{ padding: '6px 10px', color: 'var(--t3)', fontFamily: 'var(--mono)', fontSize: 10 }}>
                              #{d.rowIndex + 1}
                            </td>
                            {!isSingleBv && (
                              <td style={{ padding: '6px 10px' }}>
                                {d.bv ? (
                                  <span style={{
                                    fontSize: 10, padding: '1px 6px', borderRadius: 3, fontWeight: 700,
                                    background: BV_COLORS[d.bv] + '22', color: BV_COLORS[d.bv],
                                  }}>
                                    {d.bv}
                                  </span>
                                ) : <span style={{ color: 'var(--t3)' }}>—</span>}
                                {d.rawBv && d.rawBv !== d.bv && (
                                  <span style={{ color: 'var(--t3)', fontSize: 10, marginLeft: 6, fontFamily: 'var(--mono)' }}>
                                    ({d.rawBv.slice(0, 24)})
                                  </span>
                                )}
                              </td>
                            )}
                            <td style={{ padding: '6px 10px', fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--mono)' }}>
                              "{d.rawAmount.slice(0, 30)}"
                            </td>
                            <td className="r mono" style={{ padding: '6px 10px', fontWeight: 600 }}>
                              {isHoursSlot ? `${d.amount.toFixed(1)} u` : fmt(Math.round(d.amount))}
                            </td>
                          </tr>
                        )
                      })}
                    {detailsInline.length === 0 && (
                      <tr>
                        <td colSpan={isSingleBv ? 4 : 5} style={{ padding: 20, textAlign: 'center', color: 'var(--t3)', fontSize: 11 }}>
                          Geen rijen gematcht met de huidige kolomselectie.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Live totaal */}
              {livePreview && (
                <div style={{
                  marginTop: 14, padding: '12px 14px', borderRadius: 7,
                  background: livePreview.totalAmount !== 0 ? 'var(--bd-green)' : 'var(--bd-amber)',
                  border: `1px solid ${livePreview.totalAmount !== 0 ? 'var(--green)' : 'var(--amber)'}`,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                      Eindtotaal na verfijning
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--t1)', marginTop: 4 }}>
                      {detailsInline.length - excludedRows.size} van {detailsInline.length} rijen meegerekend
                      {excludedRows.size > 0 && (
                        <span style={{ color: 'var(--amber)', marginLeft: 6 }}>· {excludedRows.size} uitgesloten</span>
                      )}
                    </div>
                  </div>
                  <div style={{
                    fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700,
                    color: livePreview.totalAmount !== 0 ? 'var(--green)' : 'var(--amber)',
                  }}>
                    {isHoursSlot ? `${livePreview.totalAmount.toLocaleString('nl-NL')} u` : fmt(livePreview.totalAmount)}
                  </div>
                </div>
              )}

              {/* Per-BV breakdown */}
              {livePreview && !isSingleBv && (
                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                  {(['Consultancy', 'Projects', 'Software'] as BvId[]).map(b => (
                    <div key={b} style={{
                      padding: '6px 8px', background: 'var(--bg3)', borderRadius: 5,
                      border: `1px solid ${BV_COLORS[b]}33`, fontSize: 11,
                    }}>
                      <div style={{ color: BV_COLORS[b], fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                        {b}
                      </div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, marginTop: 2 }}>
                        {isHoursSlot ? `${(livePreview.perBv[b] ?? 0).toLocaleString('nl-NL')} u` : fmt(livePreview.perBv[b] ?? 0)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 20px', borderTop: '1px solid var(--bd)',
          display: 'flex', gap: 8, position: 'sticky', bottom: 0, background: 'var(--bg2)',
        }}>
          {step > 1 && <button className="btn ghost" onClick={() => setStep((step - 1) as Step)}>← Vorige</button>}
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
            <button className="btn success" disabled={!canAdvance()} onClick={handleConfirm}>
              ✓ Bevestigen & doorzetten
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── AmountColumnPicker: dropdown met match-stats ──
interface AmountPickerProps {
  label: string
  helpText: string
  color: string
  value: string
  onChange: (v: string) => void
  headers: string[]
  suggestion: string
  previewValues: string[]
  matchStats: Record<string, { matches: number; total: number }>
}
function AmountColumnPicker({ label, helpText, color, value, onChange, headers, suggestion, previewValues, matchStats }: AmountPickerProps) {
  const stat = value ? matchStats[value] : null
  return (
    <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--bd2)', borderLeftWidth: 3, borderLeftColor: color }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t1)' }}>{label}</div>
        {suggestion === value && (
          <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'var(--bd-green)', color: 'var(--green)', fontWeight: 700 }}>AUTO</span>
        )}
        {stat && (
          <span style={{
            fontSize: 9, padding: '1px 6px', borderRadius: 3, fontWeight: 700, marginLeft: 'auto',
            background: stat.matches === 0 ? 'var(--bd-red)' : stat.matches / stat.total >= 0.5 ? 'var(--bd-green)' : 'var(--bd-amber)',
            color: stat.matches === 0 ? 'var(--red)' : stat.matches / stat.total >= 0.5 ? 'var(--green)' : 'var(--amber)',
          }}>
            {stat.matches}/{stat.total} numeriek
          </span>
        )}
      </div>
      <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 6 }}>{helpText}</div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ background: 'var(--bg1)', border: '1px solid var(--bd3)', borderRadius: 5, color: 'var(--t1)', fontSize: 11, padding: '5px 8px', width: '100%', outline: 'none', cursor: 'pointer' }}
      >
        {!value && <option value="">— kies een kolom —</option>}
        {headers.map(h => {
          const s = matchStats[h]
          const suffix = suggestion === h ? '   (voorstel)' : s && s.matches > 0 ? `   [${s.matches} numeriek]` : ''
          return <option key={h} value={h}>{h}{suffix}</option>
        })}
      </select>
      {value && (
        <div style={{ marginTop: 5, fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--mono)' }}>
          Voorbeeldwaarden: {previewValues.filter(Boolean).slice(0, 3).map(v => `"${v.slice(0, 22)}"`).join(' · ') || '—'}
        </div>
      )}
    </div>
  )
}

// ── BvColumnPicker: dropdown met BV-herkenningsstats ──
interface BvPickerProps {
  label: string
  helpText: string
  color: string
  value: string
  onChange: (v: string) => void
  headers: string[]
  suggestion: string
  previewValues: string[]
  bvStats: Record<string, { matches: number; total: number; bvs: Record<string, number> }>
}
function BvColumnPicker({ label, helpText, color, value, onChange, headers, suggestion, previewValues, bvStats }: BvPickerProps) {
  const stat = value ? bvStats[value] : null
  return (
    <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--bd2)', borderLeftWidth: 3, borderLeftColor: color }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t1)' }}>{label}</div>
        {suggestion === value && (
          <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'var(--bd-green)', color: 'var(--green)', fontWeight: 700 }}>AUTO</span>
        )}
        {stat && (
          <span style={{
            fontSize: 9, padding: '1px 6px', borderRadius: 3, fontWeight: 700, marginLeft: 'auto',
            background: stat.matches === 0 ? 'var(--bd-red)' : stat.matches / stat.total >= 0.5 ? 'var(--bd-green)' : 'var(--bd-amber)',
            color: stat.matches === 0 ? 'var(--red)' : stat.matches / stat.total >= 0.5 ? 'var(--green)' : 'var(--amber)',
          }}>
            {stat.matches}/{stat.total} BV-match
          </span>
        )}
      </div>
      <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 6 }}>{helpText}</div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ background: 'var(--bg1)', border: '1px solid var(--bd3)', borderRadius: 5, color: 'var(--t1)', fontSize: 11, padding: '5px 8px', width: '100%', outline: 'none', cursor: 'pointer' }}
      >
        {!value && <option value="">— kies een kolom —</option>}
        {headers.map(h => {
          const s = bvStats[h]
          const suffix = suggestion === h ? '   (voorstel)' : s && s.matches > 0 ? `   [${s.matches} BV-match]` : ''
          return <option key={h} value={h}>{h}{suffix}</option>
        })}
      </select>
      {value && stat && stat.matches > 0 && (
        <div style={{ marginTop: 5, fontSize: 10, color: 'var(--t3)' }}>
          Verdeling in sample: {Object.entries(stat.bvs).map(([b, c]) => (
            <span key={b} style={{ marginRight: 8 }}>
              <span style={{ color: BV_COLORS[b as BvId] }}>{b}</span> {c}
            </span>
          ))}
        </div>
      )}
      {value && (
        <div style={{ marginTop: 5, fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--mono)' }}>
          Voorbeeldwaarden: {previewValues.filter(Boolean).slice(0, 3).map(v => `"${v.slice(0, 22)}"`).join(' · ') || '—'}
        </div>
      )}
    </div>
  )
}

function BucketTag({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 4px' }}>
      <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: value > 0 ? color : 'var(--t3)' }}>{value}</span>
      <span style={{ color: 'var(--t3)', fontSize: 9 }}>{label}</span>
    </div>
  )
}
