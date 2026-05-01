import { useMemo, useState } from 'react'
import { useFinStore } from '../../store/useFinStore'
import { useAdjustedActuals } from '../../hooks/useAdjustedActuals'
import { fmt } from '../../lib/format'
import { MaandFinalizeReport } from './MaandFinalizeReport'
import type { ClosingBv } from '../../data/types'
import type { LeSnapshotByBv } from '../../lib/db'

const BVS: ClosingBv[] = ['Consultancy', 'Projects', 'Software', 'Holdings']

const MONTH_ORDER = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthSortKey = (m: string): number => {
  const [mmm, yy] = m.split('-')
  return Number(yy) * 12 + MONTH_ORDER.indexOf(mmm)
}

/** Compact overzicht van eerder definitief afgesloten maanden met de
 *  LE-vs-Actuals accuraatheid op netto omzet (alle BVs samen). Klikken op een
 *  rij opent het volledige rapport met details per BV en KPI.
 *  Verbergt zichzelf wanneer er nog géén maand is afgesloten. */
export function MaandLeHistory() {
  const finalized = useFinStore(s => s.finalized)
  const { getMonthly } = useAdjustedActuals()
  const [openMonth, setOpenMonth] = useState<string | null>(null)

  const sorted = useMemo(() => {
    return [...finalized].sort((a, b) => monthSortKey(b.month) - monthSortKey(a.month))
  }, [finalized])

  /** Per maand: totale LE-omzet en totale Actuals-omzet (alle BVs samen). */
  const summaries = useMemo(() => {
    return sorted.map(rec => {
      let totalLe = 0, totalAct = 0
      const hasSnapshot = !!rec.leSnapshot
      for (const bv of BVS) {
        const le = rec.leSnapshot?.[bv]?.netto_omzet
        const ac = getMonthly(bv, rec.month)['netto_omzet'] ?? 0
        if (le != null) totalLe += le
        totalAct += ac
      }
      const delta = totalAct - totalLe
      const pctOff = totalAct !== 0 ? Math.abs(delta) / Math.abs(totalAct) * 100 : null
      return { rec, totalLe, totalAct, delta, pctOff, hasSnapshot }
    })
  }, [sorted, getMonthly])

  // Hooks moeten vóór een eventuele early return staan, anders Rules of Hooks.
  const openRec = openMonth ? finalized.find(f => f.month === openMonth) : null
  const openActuals = useMemo<Record<string, LeSnapshotByBv>>(() => {
    if (!openMonth) return {}
    const out: Record<string, LeSnapshotByBv> = {}
    for (const bv of BVS) {
      const m = getMonthly(bv, openMonth)
      out[bv] = {
        netto_omzet: m['netto_omzet'] ?? 0,
        brutomarge:  m['brutomarge'] ?? 0,
        ebitda:      m['ebitda'] ?? 0,
      }
    }
    return out
  }, [openMonth, getMonthly])

  if (sorted.length === 0) return null

  const accuracyColor = (pct: number | null): string => {
    if (pct == null) return 'var(--t3)'
    if (pct < 5)     return 'var(--green)'
    if (pct < 10)    return 'var(--amber)'
    return 'var(--red)'
  }

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="card-hdr" style={{ borderBottom: '1px solid var(--bd)', padding: '8px 12px' }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>📈 LE-accuraatheid — afgesloten maanden</span>
        <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--t3)' }}>
          Hoe dichtbij zat de Latest Estimate bij de werkelijke actuals?
        </span>
      </div>
      <div style={{ padding: '4px 0' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--bd2)' }}>
              <th style={{ textAlign: 'left',  padding: '6px 12px', color: 'var(--t3)', fontWeight: 600 }}>Maand</th>
              <th style={{ textAlign: 'left',  padding: '6px 12px', color: 'var(--t3)', fontWeight: 600 }}>Afgesloten</th>
              <th style={{ textAlign: 'right', padding: '6px 12px', color: 'var(--t3)', fontWeight: 600 }}>LE omzet</th>
              <th style={{ textAlign: 'right', padding: '6px 12px', color: 'var(--t3)', fontWeight: 600 }}>Actuals omzet</th>
              <th style={{ textAlign: 'right', padding: '6px 12px', color: 'var(--t3)', fontWeight: 600 }}>Δ</th>
              <th style={{ textAlign: 'right', padding: '6px 12px', color: 'var(--t3)', fontWeight: 600 }}>% afw.</th>
              <th style={{ textAlign: 'right', padding: '6px 12px', color: 'var(--t3)', fontWeight: 600 }}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map(({ rec, totalLe, totalAct, delta, pctOff, hasSnapshot }) => (
              <tr
                key={rec.month}
                style={{
                  borderBottom: '1px solid var(--bd2)',
                  cursor: 'pointer',
                }}
                onClick={() => setOpenMonth(rec.month)}
                title="Klik om het volledige LE-vs-Actuals rapport te openen"
              >
                <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--t1)' }}>{rec.month}</td>
                <td style={{ padding: '8px 12px', color: 'var(--t3)', fontSize: 10 }}>
                  {rec.finalizedAt ? new Date(rec.finalizedAt).toLocaleDateString('nl-NL') : '—'}
                  {rec.finalizedBy && (
                    <span style={{ marginLeft: 4, color: 'var(--t3)' }}>· {rec.finalizedBy}</span>
                  )}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--mono)', color: hasSnapshot ? 'var(--blue)' : 'var(--t3)' }}>
                  {hasSnapshot ? fmt(totalLe) : '—'}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--t1)' }}>
                  {fmt(totalAct)}
                </td>
                <td style={{
                  padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--mono)',
                  color: !hasSnapshot ? 'var(--t3)' : (delta >= 0 ? 'var(--green)' : 'var(--red)'),
                }}>
                  {!hasSnapshot ? '—' : `${delta >= 0 ? '+' : ''}${fmt(delta)}`}
                </td>
                <td style={{
                  padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--mono)',
                  fontWeight: 600, color: accuracyColor(hasSnapshot ? pctOff : null),
                }}>
                  {hasSnapshot && pctOff != null ? `${pctOff.toFixed(1)}%` : '—'}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                  <span style={{ color: 'var(--blue)', fontSize: 11 }}>📊 Open →</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openRec && (
        <MaandFinalizeReport
          month={openRec.month}
          leSnapshot={openRec.leSnapshot}
          actuals={openActuals}
          showSuccessBanner={false}
          finalizedAt={openRec.finalizedAt}
          finalizedBy={openRec.finalizedBy}
          onClose={() => setOpenMonth(null)}
        />
      )}
    </div>
  )
}
