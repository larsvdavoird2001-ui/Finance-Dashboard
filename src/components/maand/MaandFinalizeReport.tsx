import { useMemo } from 'react'
import type { ClosingBv } from '../../data/types'
import type { LeSnapshotByBv } from '../../lib/db'
import { fmt } from '../../lib/format'

const BVS: ClosingBv[] = ['Consultancy', 'Projects', 'Software', 'Holdings']
const KPI_LABELS: Record<keyof LeSnapshotByBv, string> = {
  netto_omzet: 'Netto omzet',
  brutomarge:  'Brutomarge',
  ebitda:      'EBITDA',
}
const KPI_KEYS: (keyof LeSnapshotByBv)[] = ['netto_omzet', 'brutomarge', 'ebitda']

interface Props {
  /** De maand waar het rapport over gaat (bv. 'Mar-26'). */
  month: string
  /** LE-forecast per BV op finalize-moment. Undefined → snapshot ontbreekt
   *  (maand afgesloten met oudere app-versie); rapport toont waarschuwing. */
  leSnapshot: Record<string, LeSnapshotByBv> | undefined
  /** Werkelijke actuals per BV — zelfde keys als leSnapshot. */
  actuals: Record<string, LeSnapshotByBv>
  /** Toon succes-banner ("✓ Maandafsluiting succesvol"). False bij re-open
   *  van een eerder afgesloten maand vanuit de history-lijst. */
  showSuccessBanner: boolean
  /** Optionele wie+wanneer-info voor de header. */
  finalizedAt?: string
  finalizedBy?: string
  onClose: () => void
}

interface Row {
  bv: ClosingBv
  kpi: keyof LeSnapshotByBv
  le: number | null     // null = snapshot ontbreekt voor deze (bv, kpi)
  actual: number
  delta: number
  pctOff: number | null
}

export function MaandFinalizeReport({
  month, leSnapshot, actuals, showSuccessBanner, finalizedAt, finalizedBy, onClose,
}: Props) {
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const bv of BVS) {
      const le = leSnapshot?.[bv]
      const ac = actuals[bv] ?? {}
      for (const kpi of KPI_KEYS) {
        const leVal = le?.[kpi] ?? null
        const acVal = ac[kpi] ?? 0
        const delta = leVal != null ? acVal - leVal : 0
        const pctOff = leVal != null && acVal !== 0
          ? Math.abs(delta) / Math.abs(acVal) * 100
          : null
        out.push({ bv, kpi, le: leVal, actual: acVal, delta, pctOff })
      }
    }
    return out
  }, [leSnapshot, actuals])

  const omzetRows = rows.filter(r => r.kpi === 'netto_omzet' && (r.le != null || r.actual !== 0))
  const totalLeOmzet  = omzetRows.reduce((s, r) => s + (r.le ?? 0), 0)
  const totalActOmzet = omzetRows.reduce((s, r) => s + r.actual, 0)
  const totalDeltaOmzet = totalActOmzet - totalLeOmzet
  const totalPctOmzet = totalActOmzet !== 0
    ? Math.abs(totalDeltaOmzet) / Math.abs(totalActOmzet) * 100
    : 0

  /** Per-BV samenvatting op netto omzet — voor de kaartgrid bovenaan zodat de
   *  gebruiker direct per business unit ziet hoe dichtbij de prognose zat. */
  const perBvSummary = BVS.map(bv => {
    const r = rows.find(x => x.bv === bv && x.kpi === 'netto_omzet')
    const le = r?.le ?? null
    const actual = r?.actual ?? 0
    const delta = le != null ? actual - le : 0
    const pctOff = le != null && actual !== 0
      ? Math.abs(delta) / Math.abs(actual) * 100
      : null
    return { bv, le, actual, delta, pctOff, isEmpty: le == null && actual === 0 }
  })

  const accuracyLabel = (pct: number | null): { text: string; color: string } => {
    if (pct == null) return { text: '—',         color: 'var(--t3)' }
    if (pct < 2)     return { text: 'Spot-on',   color: 'var(--green)' }
    if (pct < 5)     return { text: 'Goed',      color: 'var(--green)' }
    if (pct < 10)    return { text: 'Redelijk',  color: 'var(--amber)' }
    return                  { text: 'Afwijking', color: 'var(--red)' }
  }

  const hasSnapshot = !!leSnapshot && Object.keys(leSnapshot).length > 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg1)',
          border: '1px solid var(--bd)',
          borderRadius: 10,
          maxWidth: 820, width: '100%',
          maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--bd)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>📊</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)' }}>
              Maandafsluiting {month} — LE-accuraatheid
            </div>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
              {finalizedAt && (
                <>Afgesloten {new Date(finalizedAt).toLocaleString('nl-NL')}
                  {finalizedBy && ` door ${finalizedBy}`} · </>
              )}
              Vergelijking: voorspelde Latest Estimate vs. werkelijke actuals
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn sm ghost"
            aria-label="Sluiten"
            style={{ fontSize: 14 }}
          >
            ✕
          </button>
        </div>

        {/* Succes-banner direct na finaliseren */}
        {showSuccessBanner && (
          <div style={{
            padding: '10px 18px',
            background: 'rgba(38,201,151,0.10)',
            borderBottom: '1px solid var(--bd2)',
            color: 'var(--green)',
            fontSize: 12, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 14 }}>✓</span>
            <span>
              Maandafsluiting {month} is succesvol definitief gemaakt — Executive
              Overview gebruikt vanaf nu actuals i.p.v. LE.
            </span>
          </div>
        )}

        {/* Snapshot ontbreekt → uitleg waarom geen vergelijking mogelijk is */}
        {!hasSnapshot && (
          <div style={{
            padding: '12px 18px',
            background: 'rgba(245,166,35,0.10)',
            borderBottom: '1px solid var(--bd2)',
            color: 'var(--amber)',
            fontSize: 11, lineHeight: 1.5,
          }}>
            ⓘ Geen LE-snapshot vastgelegd voor {month} — deze maand is mogelijk
            afgesloten met een oudere versie van de app. Voor toekomstige
            maandafsluitingen wordt de Latest Estimate per BV automatisch
            opgeslagen, zodat je deze vergelijking achteraf altijd kunt zien.
          </div>
        )}

        {/* Per-BV samenvatting bovenaan: in één oogopslag zien hoe dichtbij
            de Latest Estimate per business unit zat. Gevolgd door een
            'Totaal'-regel met de samenvoeging over alle BVs. */}
        {hasSnapshot && (
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--bd2)' }}>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8 }}>
              Netto omzet per BV — Latest Estimate vs. werkelijke actuals:
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
              gap: 8,
            }}>
              {perBvSummary.map(({ bv, le, actual, delta, pctOff, isEmpty }) => {
                const acc = accuracyLabel(pctOff)
                return (
                  <div
                    key={bv}
                    style={{
                      padding: '8px 10px',
                      border: `1px solid ${isEmpty ? 'var(--bd2)' : acc.color}33`,
                      borderRadius: 6,
                      background: isEmpty ? 'var(--bg2)' : `${acc.color}0d`,
                      opacity: isEmpty ? 0.55 : 1,
                    }}
                  >
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: 'var(--t1)',
                      marginBottom: 4,
                    }}>
                      {bv}
                    </div>
                    {isEmpty ? (
                      <div style={{ fontSize: 10, color: 'var(--t3)' }}>geen data</div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                          <span style={{ fontSize: 9, color: 'var(--t3)', minWidth: 30 }}>LE</span>
                          <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--blue)', fontWeight: 600 }}>
                            {le != null ? fmt(le) : '—'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                          <span style={{ fontSize: 9, color: 'var(--t3)', minWidth: 30 }}>Act</span>
                          <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--t1)', fontWeight: 600 }}>
                            {fmt(actual)}
                          </span>
                        </div>
                        <div style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--bd2)',
                        }}>
                          <span style={{
                            fontSize: 10, fontFamily: 'var(--mono)',
                            color: le == null ? 'var(--t3)' : (delta >= 0 ? 'var(--green)' : 'var(--red)'),
                            fontWeight: 600,
                          }}>
                            {le == null
                              ? '—'
                              : `${delta >= 0 ? '+' : ''}${fmt(delta)}${pctOff != null ? ` · ${pctOff.toFixed(1)}%` : ''}`}
                          </span>
                          <span style={{
                            fontSize: 9, fontWeight: 700,
                            padding: '1px 5px', borderRadius: 3,
                            background: `${acc.color}22`, color: acc.color,
                          }}>
                            {acc.text}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Totaal-regel: alle BVs samengevoegd. */}
            <div style={{
              marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--bd2)',
              display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'baseline',
            }}>
              <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700 }}>
                Totaal alle BVs
              </div>
              <div>
                <span style={{ fontSize: 10, color: 'var(--t3)', marginRight: 4 }}>LE</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--blue)', fontFamily: 'var(--mono)' }}>
                  {fmt(totalLeOmzet)}
                </span>
              </div>
              <span style={{ fontSize: 14, color: 'var(--t3)' }}>→</span>
              <div>
                <span style={{ fontSize: 10, color: 'var(--t3)', marginRight: 4 }}>Act</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)', fontFamily: 'var(--mono)' }}>
                  {fmt(totalActOmzet)}
                </span>
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div style={{
                  fontSize: 12, fontWeight: 700,
                  color: accuracyLabel(totalPctOmzet).color,
                  fontFamily: 'var(--mono)',
                }}>
                  {totalDeltaOmzet >= 0 ? '+' : ''}{fmt(totalDeltaOmzet)} ({totalPctOmzet.toFixed(1)}%)
                </div>
                <div style={{ fontSize: 9, fontWeight: 700, color: accuracyLabel(totalPctOmzet).color }}>
                  {accuracyLabel(totalPctOmzet).text}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Detail-tabel: BV × KPI */}
        <div style={{ padding: '6px 12px 14px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bd2)' }}>
                <th style={{ textAlign: 'left',  padding: '8px 6px', color: 'var(--t3)', fontWeight: 600 }}>BV</th>
                <th style={{ textAlign: 'left',  padding: '8px 6px', color: 'var(--t3)', fontWeight: 600 }}>KPI</th>
                <th style={{ textAlign: 'right', padding: '8px 6px', color: 'var(--t3)', fontWeight: 600 }}>LE (forecast)</th>
                <th style={{ textAlign: 'right', padding: '8px 6px', color: 'var(--t3)', fontWeight: 600 }}>Actuals</th>
                <th style={{ textAlign: 'right', padding: '8px 6px', color: 'var(--t3)', fontWeight: 600 }}>Δ</th>
                <th style={{ textAlign: 'right', padding: '8px 6px', color: 'var(--t3)', fontWeight: 600 }}>% afw.</th>
                <th style={{ textAlign: 'left',  padding: '8px 6px', color: 'var(--t3)', fontWeight: 600 }}>Beoordeling</th>
              </tr>
            </thead>
            <tbody>
              {BVS.map(bv => {
                const bvRows = rows.filter(r => r.bv === bv)
                const allEmpty = bvRows.every(r => r.le == null && r.actual === 0)
                if (allEmpty) return null
                return bvRows.map((r, i) => {
                  const acc = accuracyLabel(r.pctOff)
                  const isFirstRow = i === 0
                  return (
                    <tr
                      key={`${bv}-${r.kpi}`}
                      style={{
                        borderBottom: i === bvRows.length - 1 ? '1px solid var(--bd2)' : 'none',
                      }}
                    >
                      <td style={{
                        padding: '6px 6px', color: 'var(--t1)', fontWeight: 600,
                        verticalAlign: 'top',
                      }}>
                        {isFirstRow ? bv : ''}
                      </td>
                      <td style={{ padding: '6px 6px', color: 'var(--t2)' }}>
                        {KPI_LABELS[r.kpi]}
                      </td>
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--blue)' }}>
                        {r.le != null ? fmt(r.le) : '—'}
                      </td>
                      <td style={{ padding: '6px 6px', textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--t1)' }}>
                        {fmt(r.actual)}
                      </td>
                      <td style={{
                        padding: '6px 6px', textAlign: 'right', fontFamily: 'var(--mono)',
                        color: r.le == null ? 'var(--t3)' : (r.delta >= 0 ? 'var(--green)' : 'var(--red)'),
                      }}>
                        {r.le == null ? '—' : `${r.delta >= 0 ? '+' : ''}${fmt(r.delta)}`}
                      </td>
                      <td style={{
                        padding: '6px 6px', textAlign: 'right', fontFamily: 'var(--mono)',
                        color: acc.color,
                      }}>
                        {r.pctOff != null ? `${r.pctOff.toFixed(1)}%` : '—'}
                      </td>
                      <td style={{ padding: '6px 6px' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 600,
                          padding: '1px 6px', borderRadius: 4,
                          background: r.pctOff == null ? 'var(--bg3)' : `${acc.color}22`,
                          color: acc.color,
                        }}>
                          {acc.text}
                        </span>
                      </td>
                    </tr>
                  )
                })
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 18px', borderTop: '1px solid var(--bd)',
          display: 'flex', justifyContent: 'flex-end',
        }}>
          <button onClick={onClose} className="btn primary">
            Sluiten
          </button>
        </div>
      </div>
    </div>
  )
}
