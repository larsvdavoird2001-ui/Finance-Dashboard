import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  parseIcFacturatie,
  type IcReceiverBv,
  type IcFacturatieParseResult,
  type IcFacturatieAggregated,
} from '../../lib/parseImport'
import { fmt } from '../../lib/format'
import type { TariffEntry } from '../../data/types'

interface Props {
  workbook: XLSX.WorkBook
  fileName: string
  receiverBv: IcReceiverBv
  month: string
  tariffEntries: TariffEntry[]
  onConfirm: (result: IcFacturatieParseResult) => void
  onCancel: () => void
  /** Voeg een werknemer toe aan de IC Tarieven-tabel. Krijgt naam, bedrijf
   *  (provider-BV) en tarief. Maakt een entry met een gegenereerd id. */
  onAddEmployee: (naam: string, providerBv: IcReceiverBv, tarief: number) => void
  /** Set/update het tarief van een bestaande werknemer in IC Tarieven. */
  onSetTariff: (employeeId: string, tarief: number) => void
}

const BV_COLORS: Record<IcReceiverBv, string> = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
}

function BvTag({ bv }: { bv: IcReceiverBv }) {
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 10, fontWeight: 700,
      padding: '1px 6px',
      borderRadius: 3,
      background: `${BV_COLORS[bv]}22`,
      color: BV_COLORS[bv],
      border: `1px solid ${BV_COLORS[bv]}44`,
      whiteSpace: 'nowrap',
    }}>{bv}</span>
  )
}

export function IcFacturatieWizard({
  workbook, fileName, receiverBv, month, tariffEntries,
  onConfirm, onCancel, onAddEmployee, onSetTariff,
}: Props) {
  // Parse op elke render (snel) — bij tariff-updates re-runt de parser
  // zodat de wizard live de bijgewerkte matches/missende-tarieven toont.
  const result = useMemo<IcFacturatieParseResult>(() => {
    try {
      if (!workbook?.SheetNames?.length) {
        return {
          rows: [], unmatchedWorkers: [], workersWithoutTariff: [],
          warnings: ['Workbook bevat geen sheets — bestand is leeg of corrupt.'],
          rawRowCount: 0, parsedRowCount: 0, totalAmount: 0, detectedReceiverBv: null,
        }
      }
      const ws = workbook.Sheets[workbook.SheetNames[0]]
      if (!ws) {
        return {
          rows: [], unmatchedWorkers: [], workersWithoutTariff: [],
          warnings: [`Sheet "${workbook.SheetNames[0]}" niet gevonden.`],
          rawRowCount: 0, parsedRowCount: 0, totalAmount: 0, detectedReceiverBv: null,
        }
      }
      const sheetRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, blankrows: false }) as unknown[][]
      return parseIcFacturatie(sheetRows, receiverBv, tariffEntries)
    } catch (err) {
      return {
        rows: [], unmatchedWorkers: [], workersWithoutTariff: [],
        warnings: [`Fout bij verwerken: ${err instanceof Error ? err.message : String(err)}`],
        rawRowCount: 0, parsedRowCount: 0, totalAmount: 0, detectedReceiverBv: null,
      }
    }
  }, [workbook, receiverBv, tariffEntries])

  // Inline tarief-invoer state — per unmatched-worker (key=raw|bv) of
  // missing-tariff worker (key=id|bv) een numerieke string.
  const [tariefInputs, setTariefInputs] = useState<Record<string, string>>({})

  const totalUnresolved = result.unmatchedWorkers.length + result.workersWithoutTariff.length
  const canConfirm = totalUnresolved === 0 && result.rows.length > 0

  const handleAddWorker = (workerRaw: string, providerBv: IcReceiverBv) => {
    const k = `unmatched|${workerRaw}|${providerBv}`
    const raw = tariefInputs[k] ?? ''
    const tarief = parseFloat(raw.replace(',', '.'))
    if (!isFinite(tarief) || tarief <= 0) return
    onAddEmployee(workerRaw, providerBv, tarief)
    setTariefInputs(s => { const c = { ...s }; delete c[k]; return c })
  }

  const handleSetTarief = (employeeId: string, providerBv: IcReceiverBv) => {
    const k = `missing|${employeeId}|${providerBv}`
    const raw = tariefInputs[k] ?? ''
    const tarief = parseFloat(raw.replace(',', '.'))
    if (!isFinite(tarief) || tarief <= 0) return
    onSetTariff(employeeId, tarief)
    setTariefInputs(s => { const c = { ...s }; delete c[k]; return c })
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, padding: 20,
    }}>
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--bd3)', borderRadius: 12,
        width: '100%', maxWidth: 980, maxHeight: '92vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BvTag bv={receiverBv} />
            <div style={{ fontWeight: 700, fontSize: 16 }}>IC Facturatie — {receiverBv} ({month})</div>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)' }}>{fileName}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>
            Werknemers van andere BV's die werk hebben gedaan voor projecten van <strong>{receiverBv}</strong>.
            Per (werknemer, klant, van→naar) wordt één IC-regel aangemaakt in OHW Overzicht: <strong>{receiverBv}</strong> krijgt een minteken (kosten), de leverancier-BV een plusteken.
          </div>
        </div>

        {/* Samenvatting */}
        <div style={{ padding: '12px 20px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--t3)' }}>Rijen in bestand</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{result.rawRowCount}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--t3)' }}>Bruikbare regels</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{result.parsedRowCount}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--t3)' }}>IC-regels (uniek)</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{result.rows.length}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--t3)' }}>Totaalbedrag</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(result.totalAmount)}</div>
          </div>
        </div>

        {/* Warnings */}
        {result.warnings.length > 0 && (
          <div style={{ padding: '4px 20px 8px', fontSize: 10, color: 'var(--t3)' }}>
            {result.warnings.map((w, i) => (
              <div key={i} style={{ marginTop: 2, color: w.startsWith('⚠') ? 'var(--amber)' : 'var(--t3)' }}>
                {w}
              </div>
            ))}
          </div>
        )}

        {/* Unmatched werknemers — niet in IC Tarieven-tabel */}
        {result.unmatchedWorkers.length > 0 && (
          <div style={{ margin: '8px 20px', border: '1px solid var(--red)', borderRadius: 8, background: 'rgba(239,83,80,0.06)', padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)', marginBottom: 6 }}>
              ⚠ {result.unmatchedWorkers.length} werknemer(s) niet in IC Tarieven-tabel
            </div>
            <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 8 }}>
              Voeg ze toe met hun uurtarief voordat je goedkeurt. De wizard herrekent automatisch zodra je tarieven invult.
            </div>
            <table style={{ width: '100%', fontSize: 11 }}>
              <thead>
                <tr style={{ color: 'var(--t3)' }}>
                  <th style={{ textAlign: 'left', padding: '3px 6px' }}>Werknemer</th>
                  <th style={{ textAlign: 'left', padding: '3px 6px' }}>Provider BV</th>
                  <th style={{ textAlign: 'right', padding: '3px 6px' }}>Uren</th>
                  <th style={{ textAlign: 'left', padding: '3px 6px' }}>Klanten</th>
                  <th style={{ textAlign: 'right', padding: '3px 6px' }}>Tarief (€/u)</th>
                  <th style={{ padding: '3px 6px' }}></th>
                </tr>
              </thead>
              <tbody>
                {result.unmatchedWorkers.map(u => {
                  const k = `unmatched|${u.werknemerRaw}|${u.providerBv}`
                  return (
                    <tr key={k}>
                      <td style={{ padding: '3px 6px', fontWeight: 600 }}>{u.werknemerRaw}</td>
                      <td style={{ padding: '3px 6px' }}><BvTag bv={u.providerBv} /></td>
                      <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{u.totalHours.toFixed(1)}</td>
                      <td style={{ padding: '3px 6px', color: 'var(--t3)', fontSize: 10 }} title={u.klanten.join(', ')}>
                        {u.klanten.slice(0, 2).join(', ')}{u.klanten.length > 2 ? ` +${u.klanten.length - 2}` : ''}
                      </td>
                      <td style={{ padding: '3px 6px', textAlign: 'right' }}>
                        <input
                          type="text"
                          value={tariefInputs[k] ?? ''}
                          onChange={e => setTariefInputs(s => ({ ...s, [k]: e.target.value }))}
                          placeholder="0"
                          style={{ width: 70, textAlign: 'right', padding: '3px 6px', fontSize: 11, background: 'var(--bg1)', border: '1px solid var(--bd2)', borderRadius: 4, color: 'var(--t1)' }}
                          onKeyDown={e => { if (e.key === 'Enter') handleAddWorker(u.werknemerRaw, u.providerBv) }}
                        />
                      </td>
                      <td style={{ padding: '3px 6px' }}>
                        <button
                          className="btn sm primary"
                          onClick={() => handleAddWorker(u.werknemerRaw, u.providerBv)}
                          style={{ fontSize: 10, padding: '3px 8px' }}
                          disabled={!tariefInputs[k] || parseFloat((tariefInputs[k] ?? '').replace(',', '.')) <= 0}
                        >+ Toevoegen</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Workers met ontbrekend tarief */}
        {result.workersWithoutTariff.length > 0 && (
          <div style={{ margin: '8px 20px', border: '1px solid var(--amber)', borderRadius: 8, background: 'rgba(245,166,35,0.06)', padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--amber)', marginBottom: 6 }}>
              ⚠ {result.workersWithoutTariff.length} werknemer(s) zonder IC-tarief
            </div>
            <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 8 }}>
              Deze werknemers staan al in IC Tarieven maar hun tarief is 0 of niet ingevuld. Vul het tarief in om mee te tellen.
            </div>
            <table style={{ width: '100%', fontSize: 11 }}>
              <thead>
                <tr style={{ color: 'var(--t3)' }}>
                  <th style={{ textAlign: 'left', padding: '3px 6px' }}>Werknemer</th>
                  <th style={{ textAlign: 'left', padding: '3px 6px' }}>Provider BV</th>
                  <th style={{ textAlign: 'right', padding: '3px 6px' }}>Uren</th>
                  <th style={{ textAlign: 'right', padding: '3px 6px' }}>Tarief (€/u)</th>
                  <th style={{ padding: '3px 6px' }}></th>
                </tr>
              </thead>
              <tbody>
                {result.workersWithoutTariff.map(w => {
                  const k = `missing|${w.id}|${w.providerBv}`
                  return (
                    <tr key={k}>
                      <td style={{ padding: '3px 6px', fontWeight: 600 }}>{w.naam}</td>
                      <td style={{ padding: '3px 6px' }}><BvTag bv={w.providerBv} /></td>
                      <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{w.totalHours.toFixed(1)}</td>
                      <td style={{ padding: '3px 6px', textAlign: 'right' }}>
                        <input
                          type="text"
                          value={tariefInputs[k] ?? ''}
                          onChange={e => setTariefInputs(s => ({ ...s, [k]: e.target.value }))}
                          placeholder="0"
                          style={{ width: 70, textAlign: 'right', padding: '3px 6px', fontSize: 11, background: 'var(--bg1)', border: '1px solid var(--bd2)', borderRadius: 4, color: 'var(--t1)' }}
                          onKeyDown={e => { if (e.key === 'Enter') handleSetTarief(w.id, w.providerBv) }}
                        />
                      </td>
                      <td style={{ padding: '3px 6px' }}>
                        <button
                          className="btn sm primary"
                          onClick={() => handleSetTarief(w.id, w.providerBv)}
                          style={{ fontSize: 10, padding: '3px 8px' }}
                          disabled={!tariefInputs[k] || parseFloat((tariefInputs[k] ?? '').replace(',', '.')) <= 0}
                        >✓ Tarief zetten</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Preview matched rows */}
        {result.rows.length > 0 && (
          <div style={{ padding: '4px 20px 8px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--t2)', marginBottom: 4 }}>
              IC-regels die worden aangemaakt ({result.rows.length})
            </div>
            <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--bd2)', borderRadius: 6 }}>
              <table style={{ width: '100%', fontSize: 11 }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--bg3)' }}>
                  <tr style={{ color: 'var(--t3)' }}>
                    <th style={{ textAlign: 'left', padding: '4px 8px' }}>Werknemer</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px' }}>Van → Naar</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px' }}>Klant</th>
                    <th style={{ textAlign: 'right', padding: '4px 8px' }}>Uren</th>
                    <th style={{ textAlign: 'right', padding: '4px 8px' }}>Tarief</th>
                    <th style={{ textAlign: 'right', padding: '4px 8px' }}>Bedrag</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 200).map((r, i) => renderRow(r, i))}
                  {result.rows.length > 200 && (
                    <tr><td colSpan={6} style={{ padding: '6px 8px', textAlign: 'center', fontSize: 10, color: 'var(--t3)' }}>
                      ... {result.rows.length - 200} meer (toon eerste 200)
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div style={{
          padding: '12px 20px', borderTop: '1px solid var(--bd2)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
        }}>
          <div style={{ fontSize: 11, color: 'var(--t3)' }}>
            {canConfirm
              ? `✓ Klaar om door te zetten — ${result.rows.length} regels worden aangemaakt/geüpdatet`
              : totalUnresolved > 0
                ? `⚠ Los eerst ${totalUnresolved} ontbrekend${totalUnresolved === 1 ? 'e tarief' : 'e tarieven'} op`
                : 'Geen IC-regels gevonden in het bestand'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" onClick={onCancel}>Annuleren</button>
            <button
              className="btn primary"
              disabled={!canConfirm}
              onClick={() => onConfirm(result)}
            >✓ Goedkeuren & invullen</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function renderRow(r: IcFacturatieAggregated, i: number) {
  return (
    <tr key={i} style={{ borderTop: '1px solid var(--bd2)' }}>
      <td style={{ padding: '3px 8px', fontWeight: 600 }}>{r.werknemer}</td>
      <td style={{ padding: '3px 8px' }}>
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <BvTag bv={r.toBv} /> <span style={{ color: 'var(--t3)' }}>→</span> <BvTag bv={r.fromBv} />
        </span>
      </td>
      <td style={{ padding: '3px 8px', color: 'var(--t3)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.klant}>
        {r.klant}
      </td>
      <td style={{ padding: '3px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.hours.toFixed(1)}</td>
      <td style={{ padding: '3px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.tarief > 0 ? `€${r.tarief}` : '—'}</td>
      <td style={{ padding: '3px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: r.matched ? 'var(--green)' : 'var(--amber)' }}>
        {r.matched ? fmt(r.amount) : '—'}
      </td>
    </tr>
  )
}
