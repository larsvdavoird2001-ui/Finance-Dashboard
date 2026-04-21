import { useState } from 'react'
import type { ImportRecord, BvId } from '../../data/types'
import { fmt } from '../../lib/format'

const BV_COLORS: Record<string, string> = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
}

const BVS: BvId[] = ['Consultancy', 'Projects', 'Software']

// Labels voor de bestemmingen per slot
const SLOT_DESTINATION: Record<string, string> = {
  uren_lijst: 'OHW Overzicht → Projects → "U-Projecten (SAP-overzicht) met tarief"',
  d_lijst: 'OHW Overzicht → Consultancy → "D facturatie"',
  ohw: 'OHW Overzicht → Projects → "Onderhanden projecten (OHW Excel)"',
  missing_hours: 'OHW Overzicht → Consultancy → "Missing hours (nog niet geboekte of goed gekeurde uren)"',
  factuurvolume: 'Maandafsluiting → Factuurvolume per BV',
  conceptfacturen: 'Maandafsluiting → Factuurvolume per BV',
}

// Slots die maar voor één BV zijn
const SINGLE_BV_SLOTS: Record<string, BvId> = {
  uren_lijst: 'Projects',
  d_lijst: 'Consultancy',
  ohw: 'Projects',
  missing_hours: 'Consultancy',
}

// Labels voor kolomselectie — missing_hours gebruikt de kolommen anders dan
// de algemene parse (bedragcol = uren, bvcol = werknemer-ID).
function colLabels(slotId: string) {
  if (slotId === 'missing_hours') {
    return {
      amount: { label: 'Uren-kolom (Missing hours)', color: 'var(--green)' },
      bv:     { label: 'Werknemer-kolom (ID/naam/alias)', color: 'var(--blue)' },
    }
  }
  return {
    amount: { label: 'Bedrag-kolom (netto excl. BTW)', color: 'var(--green)' },
    bv:     { label: 'BV-kolom (business unit)',      color: 'var(--blue)' },
  }
}

interface Props {
  record: ImportRecord
  onApprove: () => void
  onReject: (reason: string) => void
  onClose: () => void
  /** Herbereken het bestand met handmatig gekozen kolommen */
  onReparse?: (amountCol: string, bvCol: string) => Promise<void>
}

export function ImportApprovalModal({ record, onApprove, onReject, onClose, onReparse }: Props) {
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const [selectedAmountCol, setSelectedAmountCol] = useState(record.detectedAmountCol)
  const [selectedBvCol, setSelectedBvCol] = useState(record.detectedBvCol)
  const [reparsing, setReparsing] = useState(false)

  const singleBv = SINGLE_BV_SLOTS[record.slotId] ?? null
  const bvDetected = BVS.some(bv => (record.perBv[bv] ?? 0) > 0)
  const bvTotal = BVS.reduce((s, bv) => s + (record.perBv[bv] ?? 0), 0)
  const labels = colLabels(record.slotId)

  const handleReparse = async () => {
    if (!onReparse) return
    setReparsing(true)
    try {
      await onReparse(selectedAmountCol, selectedBvCol)
      setAdjusting(false)
    } finally {
      setReparsing(false)
    }
  }

  const selectStyle: React.CSSProperties = {
    background: 'var(--bg1)',
    border: '1px solid var(--bd3)',
    borderRadius: 5,
    color: 'var(--t1)',
    fontSize: 11,
    padding: '5px 8px',
    width: '100%',
    outline: 'none',
    cursor: 'pointer',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, padding: 20,
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--bd3)',
        borderRadius: 12, width: '100%', maxWidth: 540,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--bd)',
          display: 'flex', alignItems: 'center', gap: 10,
          position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 1,
        }}>
          <span style={{ fontSize: 20 }}>
            {record.slotId === 'factuurvolume' ? '🧾' :
             record.slotId === 'geschreven_uren' || record.slotId === 'uren_lijst' ? '⏱' :
             record.slotId === 'd_lijst' ? '📊' :
             record.slotId === 'ohw' ? '🏗' : '📄'}
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{record.slotLabel} — Bevestiging vereist</div>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
              {record.fileName} · {record.month} · {record.rowCount} rijen
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--t3)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
          >✕</button>
        </div>

        <div style={{ padding: '16px 20px' }}>

          {/* Bestemming info */}
          {SLOT_DESTINATION[record.slotId] && (
            <div style={{
              background: 'var(--bd-blue)', borderRadius: 8, padding: '10px 14px',
              marginBottom: 12, fontSize: 11, color: 'var(--blue)',
              border: '1px solid var(--blue)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 14 }}>→</span>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>Bestemming na goedkeuring:</div>
                <div style={{ color: 'var(--t2)' }}>{SLOT_DESTINATION[record.slotId]}</div>
              </div>
            </div>
          )}

          {/* Single-BV indicator */}
          {singleBv && (
            <div style={{
              background: `${BV_COLORS[singleBv]}15`, borderRadius: 8, padding: '8px 12px',
              marginBottom: 12, fontSize: 11, border: `1px solid ${BV_COLORS[singleBv]}44`,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: BV_COLORS[singleBv], display: 'inline-block' }} />
              <span style={{ color: BV_COLORS[singleBv], fontWeight: 600 }}>
                Dit bestand is uitsluitend voor {singleBv}
              </span>
              <span style={{ color: 'var(--t3)' }}>— het totaal wordt volledig aan deze BV toegewezen.</span>
            </div>
          )}

          {/* Analyse-samenvatting */}
          <div style={{
            background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px',
            marginBottom: 14, fontSize: 12, lineHeight: 1.6, color: 'var(--t2)',
            borderLeft: '3px solid var(--blue)',
          }}>
            <div style={{ fontWeight: 600, color: 'var(--t1)', marginBottom: 6 }}>
              Analyse resultaat
            </div>
            {(record.slotId === 'missing_hours' || !singleBv) && (
              <div>
                {record.slotId === 'missing_hours' ? 'Werknemer-kolom' : 'BV-kolom'}: <span style={{ fontFamily: 'var(--mono)', color: record.detectedBvCol ? 'var(--blue)' : 'var(--amber)', fontSize: 11 }}>
                  {record.detectedBvCol || '⚠ niet herkend'}
                </span>
              </div>
            )}
            <div>
              {record.slotId === 'missing_hours' ? 'Uren-kolom' : 'Bedrag-kolom'}: <span style={{ fontFamily: 'var(--mono)', color: record.detectedAmountCol ? 'var(--green)' : 'var(--amber)', fontSize: 11 }}>
                {record.detectedAmountCol || '⚠ niet herkend'}
              </span>
            </div>
            <div style={{ marginTop: 6, display: 'flex', gap: 16, fontSize: 11 }}>
              <span>
                <span style={{ color: 'var(--t3)' }}>Verwerkt: </span>
                <span style={{ color: record.parsedCount > 0 ? 'var(--green)' : 'var(--amber)', fontWeight: 600 }}>
                  {record.parsedCount} / {record.rowCount} rijen
                </span>
              </span>
              {record.skippedCount > 0 && (
                <span>
                  <span style={{ color: 'var(--t3)' }}>Overgeslagen: </span>
                  <span style={{ color: record.skippedCount > record.parsedCount ? 'var(--amber)' : 'var(--t3)', fontWeight: record.skippedCount > record.parsedCount ? 600 : 400 }}>
                    {record.skippedCount}{record.skippedCount > record.parsedCount ? ' ⚠' : ''}
                  </span>
                </span>
              )}
            </div>
            <div style={{ marginTop: 4, color: 'var(--t3)', fontSize: 11 }}>
              Klopt deze interpretatie? Bevestig hieronder of pas de kolomselectie aan.
            </div>
          </div>

          {/* BV breakdown */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>
              {singleBv ? `Totaal voor ${singleBv}` : 'Verdeling per BV — controleer of dit klopt'}
            </div>

            {singleBv ? (
              /* Single-BV: één groot totaal blok */
              <div style={{
                background: 'var(--bg3)', borderRadius: 8, padding: '14px 16px',
                border: `2px solid ${BV_COLORS[singleBv]}44`, marginBottom: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: BV_COLORS[singleBv], display: 'inline-block' }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: BV_COLORS[singleBv] }}>{singleBv}</span>
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color: 'var(--t1)' }}>
                  {fmt(record.totalAmount)}
                </span>
              </div>
            ) : (
              /* Multi-BV: grid met alle 3 */
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
                  {BVS.map(bv => {
                    const amount = record.perBv[bv] ?? 0
                    const pct = bvTotal > 0 ? (amount / bvTotal * 100).toFixed(1) : '0'
                    return (
                      <div key={bv} style={{
                        background: 'var(--bg3)', borderRadius: 8, padding: '10px 12px',
                        border: `1px solid ${amount > 0 ? BV_COLORS[bv] + '44' : 'var(--bd)'}`,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: amount > 0 ? BV_COLORS[bv] : 'var(--t3)', display: 'inline-block' }} />
                          <span style={{ fontSize: 10, fontWeight: 600, color: amount > 0 ? BV_COLORS[bv] : 'var(--t3)' }}>{bv}</span>
                          {amount > 0 && (
                            <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--t3)' }}>{pct}%</span>
                          )}
                        </div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700, color: amount > 0 ? 'var(--t1)' : 'var(--t3)' }}>
                          {amount > 0 ? fmt(amount) : '—'}
                        </div>
                        {amount === 0 && bvTotal > 0 && (
                          <div style={{ fontSize: 9, color: 'var(--amber)', marginTop: 3 }}>⚠ Geen data herkend</div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Waarschuwing bij ongelijke verdeling */}
                {bvTotal > 0 && Math.abs(record.totalAmount - bvTotal) > 1 && (
                  <div style={{
                    background: 'var(--bd-amber)', borderRadius: 6, padding: '8px 10px',
                    marginBottom: 8, fontSize: 11, color: 'var(--amber)',
                    border: '1px solid var(--amber)',
                  }}>
                    ⚠ <strong>Niet alle rijen herkend:</strong> BV-som ({fmt(bvTotal)}) ≠ totaal ({fmt(record.totalAmount)}).
                    Verschil: {fmt(record.totalAmount - bvTotal)} — controleer of de BV-kolom juist is of pas deze aan.
                  </div>
                )}
              </>
            )}

            {/* Totaal */}
            <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Totaal gedetecteerd</span>
                <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--t3)' }}>
                  {record.parsedCount} van {record.rowCount} rijen verwerkt
                </span>
              </div>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700 }}>{fmt(record.totalAmount)}</span>
            </div>
          </div>

          {/* Aanpassen sectie */}
          {onReparse && (
            <div style={{ marginBottom: 14 }}>
              <button
                className="btn ghost"
                style={{ fontSize: 11, padding: '6px 10px', width: '100%', justifyContent: 'center', color: 'var(--t2)' }}
                onClick={() => { setAdjusting(v => !v); setSelectedAmountCol(record.detectedAmountCol); setSelectedBvCol(record.detectedBvCol) }}
              >
                {adjusting ? '▲ Verberg kolomselectie' : '⚙ Aanpassen / opnieuw kiezen'}
              </button>

              {adjusting && (
                <div style={{ background: 'var(--bg3)', borderRadius: 8, padding: '12px 14px', marginTop: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t2)', marginBottom: 10 }}>
                    Selecteer handmatig de juiste kolommen:
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ color: labels.amount.color }}>●</span> {labels.amount.label}
                      </div>
                      <select
                        style={selectStyle}
                        value={selectedAmountCol}
                        onChange={e => setSelectedAmountCol(e.target.value)}
                      >
                        <option value="">— niet ingesteld —</option>
                        {record.headers.map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ color: labels.bv.color }}>●</span> {labels.bv.label}
                      </div>
                      <select
                        style={selectStyle}
                        value={selectedBvCol}
                        onChange={e => setSelectedBvCol(e.target.value)}
                      >
                        <option value="">— niet ingesteld —</option>
                        {record.headers.map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <button
                    className="btn primary"
                    style={{ fontSize: 11, padding: '7px 14px', width: '100%', justifyContent: 'center', opacity: reparsing ? 0.6 : 1 }}
                    onClick={handleReparse}
                    disabled={reparsing}
                  >
                    {reparsing ? 'Herberekenen...' : '↺ Herbereken met deze kolommen'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Preview tabel */}
          {record.preview.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
                Preview eerste rijen
              </div>
              <div style={{ overflowX: 'auto', fontSize: 10, background: 'var(--bg3)', borderRadius: 5, padding: '6px 8px', maxHeight: 120, overflowY: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead>
                    <tr>
                      {record.headers.slice(0, 6).map(h => (
                        <th key={h} style={{ padding: '3px 8px', color: 'var(--t3)', textAlign: 'left', whiteSpace: 'nowrap', fontWeight: 600, borderBottom: '1px solid var(--bd)' }}>
                          {h === record.detectedBvCol && <span style={{ color: 'var(--blue)', marginRight: 3 }} title="BV kolom">●</span>}
                          {h === record.detectedAmountCol && <span style={{ color: 'var(--green)', marginRight: 3 }} title="Bedrag kolom">●</span>}
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {record.preview.slice(0, 3).map((row, i) => (
                      <tr key={i}>
                        {record.headers.slice(0, 6).map(h => (
                          <td key={h} style={{ padding: '3px 8px', color: 'var(--t2)', whiteSpace: 'nowrap' }}>
                            {String(row[h] ?? '').slice(0, 22)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 4 }}>
                <span style={{ color: 'var(--blue)' }}>●</span> BV kolom&nbsp;&nbsp;
                <span style={{ color: 'var(--green)' }}>●</span> Bedrag kolom
              </div>
            </div>
          )}

          {/* Waarschuwingen */}
          {!bvDetected && record.slotId !== 'missing_hours' && (
            <div style={{ background: 'var(--bd-amber)', border: '1px solid var(--amber)', borderRadius: 7, padding: '8px 12px', marginBottom: 12, fontSize: 11, color: 'var(--amber)' }}>
              ⚠ Geen BV-verdeling gevonden. Gebruik "Aanpassen" om handmatig de juiste kolom te kiezen.
            </div>
          )}

          {/* Parser-diagnostiek (altijd getoond als warnings aanwezig zijn) */}
          {record.warnings && record.warnings.length > 0 && (
            <div style={{
              background: 'var(--bg3)', border: '1px solid var(--bd2)',
              borderRadius: 7, padding: '10px 12px', marginBottom: 12,
              fontSize: 11, color: 'var(--t2)',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
                Parser-diagnostiek
              </div>
              {record.warnings.map((w, i) => {
                const isErr = w.startsWith('⚠')
                return (
                  <div key={i} style={{
                    fontSize: 11, lineHeight: 1.5,
                    color: isErr ? 'var(--amber)' : 'var(--t2)',
                    marginBottom: 3,
                  }}>
                    {isErr ? '' : '• '}{w}
                  </div>
                )
              })}
            </div>
          )}

          {/* Afkeur-invoer */}
          {showReject && (
            <div style={{ marginBottom: 12 }}>
              <textarea
                style={{
                  width: '100%', minHeight: 60, background: 'var(--bg3)',
                  border: '1px solid var(--red)', borderRadius: 6,
                  color: 'var(--t1)', fontSize: 11, padding: '7px 9px',
                  fontFamily: 'var(--font)', resize: 'vertical', outline: 'none',
                }}
                placeholder="Reden voor afkeuring (optioneel)..."
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
              />
            </div>
          )}

          {/* Actieknoppen */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn success"
              style={{ flex: 1, justifyContent: 'center', fontSize: 12, padding: '8px 12px' }}
              onClick={onApprove}
            >
              ✓ Bevestigen & Toepassen
            </button>
            {!showReject ? (
              <button
                className="btn ghost"
                style={{ color: 'var(--red)', border: '1px solid var(--red)', padding: '8px 12px', fontSize: 12 }}
                onClick={() => setShowReject(true)}
              >
                ✕ Afkeuren
              </button>
            ) : (
              <button
                className="btn ghost"
                style={{ color: 'var(--red)', border: '1px solid var(--red)', padding: '8px 12px', fontSize: 12 }}
                onClick={() => onReject(rejectReason)}
              >
                Bevestig afkeuring
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
