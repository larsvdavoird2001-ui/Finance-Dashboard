// LE-accuracy card — toont per BV per kerngetal hoe vaak en hoe ver de pre-
// close Latest Estimate ernaast zat. Sluit aan op de drift-correction die de
// engine zelf gebruikt: als hier een systematische bias zichtbaar is (bv. LE
// schat netto omzet structureel 8% te laag) kalibreert de engine zich
// daaromheen voor de volgende maand. Voor de gebruiker bewijst deze view ook
// dat de LE elke maand smarter wordt — de driftPct-trend hoort over tijd
// naar 0 te zakken.

import { useMemo } from 'react'
import type { EntityName } from '../../data/plData'
import type { ClosingBv } from '../../data/types'
import type { LeSnapshotByBv } from '../../lib/db'
import { useFinStore } from '../../store/useFinStore'
import { useAdjustedActuals } from '../../hooks/useAdjustedActuals'
import {
  summariseAccuracy, ACCURACY_KEYS, ACCURACY_KEY_LABELS,
  type AccuracySummary,
} from '../../lib/leAccuracy'
import { fmt } from '../../lib/format'

const BV_COLORS: Record<ClosingBv, string> = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
  Holdings:    '#8fa3c0',
}

interface Props {
  activeBvs: ClosingBv[]
}

function ConfidenceBadge({ confidence, n }: { confidence: AccuracySummary['confidence']; n: number }) {
  const palette: Record<typeof confidence, { bg: string; border: string; color: string; label: string }> = {
    low:    { bg: 'var(--bd-amber)', border: 'var(--amber)', color: 'var(--amber)', label: 'Weinig data' },
    medium: { bg: 'var(--bd-blue)',  border: 'var(--blue)',  color: 'var(--blue)',  label: 'Indicatief' },
    high:   { bg: 'var(--bd-green)', border: 'var(--green)', color: 'var(--green)', label: 'Betrouwbaar' },
  }
  const p = palette[confidence]
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
      background: p.bg, color: p.color, border: `1px solid ${p.border}`,
      whiteSpace: 'nowrap',
    }}>{p.label} · n={n}</span>
  )
}

function DriftBar({ summary }: { summary: AccuracySummary }) {
  // Mini-balk van -25% tot +25% met markers voor median drift.
  const RANGE = 25
  const median = Math.max(-RANGE, Math.min(RANGE, summary.medianDriftPct))
  const posPct = ((median + RANGE) / (RANGE * 2)) * 100  // 0..100
  const isGood = Math.abs(median) < 5
  const color = isGood ? 'var(--green)' : Math.abs(median) < 12 ? 'var(--amber)' : 'var(--red)'
  return (
    <div style={{ position: 'relative', height: 8, background: 'var(--bg3)', borderRadius: 4, overflow: 'visible' }}>
      {/* Center reference line */}
      <div style={{
        position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1,
        background: 'var(--bd2)',
      }} />
      {/* Drift marker */}
      <div style={{
        position: 'absolute', left: `${posPct}%`, top: -2, bottom: -2, width: 3,
        background: color, transform: 'translateX(-50%)', borderRadius: 2,
        boxShadow: `0 0 4px ${color}`,
      }} />
    </div>
  )
}

function MiniSparkline({ summary }: { summary: AccuracySummary }) {
  if (summary.points.length < 2) return null
  const W = 80, H = 24
  const vals = summary.points.map(p => p.driftPct)
  const max = Math.max(10, ...vals.map(Math.abs))
  const points = summary.points.map((p, i) => {
    const x = (i / (summary.points.length - 1)) * W
    const y = H / 2 - (p.driftPct / max) * (H / 2 - 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="var(--bd2)" strokeDasharray="2 2" />
      <polyline fill="none" stroke="var(--blue)" strokeWidth={1.5} points={points} />
      {summary.points.map((p, i) => {
        const x = (i / (summary.points.length - 1)) * W
        const y = H / 2 - (p.driftPct / max) * (H / 2 - 2)
        const isLast = i === summary.points.length - 1
        return (
          <circle
            key={i} cx={x} cy={y} r={isLast ? 2.5 : 1.5}
            fill={isLast ? 'var(--blue)' : 'var(--t3)'}
          />
        )
      })}
    </svg>
  )
}

export function LeAccuracyCard({ activeBvs }: Props) {
  const finalized = useFinStore(s => s.finalized)
  const { getMonthly } = useAdjustedActuals()

  const summaries = useMemo(() => {
    const out: AccuracySummary[] = []
    for (const bv of activeBvs) {
      for (const key of ACCURACY_KEYS) {
        out.push(summariseAccuracy(
          bv as EntityName, key, finalized,
          (b, m, k) => getMonthly(b, m)[k] ?? 0,
        ))
      }
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBvs.join(','), finalized])

  // Verberg de card als er nog geen enkele snapshot is — pas zinvol vanaf
  // de eerste afgesloten maand mét snapshot (= vanaf de feature werd toegevoegd).
  const anyData = summaries.some(s => s.n > 0)
  if (!anyData) return null

  return (
    <div className="card">
      <div className="card-hdr">
        <span className="card-title">🎯 LE-accuraatheid — engine self-calibration</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>
          Median drift vs werkelijke actuals · backtest op afgesloten maanden
        </span>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {activeBvs.map(bv => {
          const bvSummaries = summaries.filter(s => s.bv === bv && s.n > 0)
          if (bvSummaries.length === 0) return (
            <div key={bv} style={{ fontSize: 11, color: 'var(--t3)' }}>
              <strong style={{ color: BV_COLORS[bv] }}>{bv}</strong> — nog geen LE-snapshots beschikbaar
            </div>
          )
          return (
            <div key={bv} style={{ borderLeft: `3px solid ${BV_COLORS[bv]}`, paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                  background: BV_COLORS[bv],
                }} />
                <strong style={{ fontSize: 12, color: BV_COLORS[bv] }}>{bv}</strong>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 90px 90px 90px', gap: 10, alignItems: 'center', fontSize: 11 }}>
                <div style={{ fontSize: 9, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase' }}>Kerngetal</div>
                <div style={{ fontSize: 9, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase' }}>Drift (mediaan)</div>
                <div style={{ fontSize: 9, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', textAlign: 'center' }}>Trend</div>
                <div style={{ fontSize: 9, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase' }}>Stabiliteit</div>
                <div style={{ fontSize: 9, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', textAlign: 'right' }}>Status</div>
                {bvSummaries.map(s => {
                  const driftSign = s.medianDriftPct >= 0 ? '+' : ''
                  const driftAbs = Math.abs(s.medianDriftPct)
                  const driftColor = driftAbs < 5 ? 'var(--green)' : driftAbs < 12 ? 'var(--amber)' : 'var(--red)'
                  // Trend > 0 = drift daalt over tijd = LE wordt smarter
                  const trendImproving = s.trendPct > 0.5
                  const trendWorsening = s.trendPct < -0.5
                  return (
                    <div key={s.key} style={{ display: 'contents' }}>
                      <div style={{ fontSize: 11, color: 'var(--t1)' }}>
                        {ACCURACY_KEY_LABELS[s.key]}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 80 }}>
                          <DriftBar summary={s} />
                        </div>
                        <span style={{
                          fontFamily: 'var(--mono)', fontSize: 11, color: driftColor, fontWeight: 600,
                          minWidth: 50, textAlign: 'right',
                        }}>
                          {driftSign}{s.medianDriftPct.toFixed(1)}%
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <MiniSparkline summary={s} />
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--t2)' }}>
                        σ {s.stdDevPct.toFixed(1)}%
                        {trendImproving && <span style={{ color: 'var(--green)', marginLeft: 4 }}>↘ beter</span>}
                        {trendWorsening && <span style={{ color: 'var(--red)', marginLeft: 4 }}>↗ slechter</span>}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <ConfidenceBadge confidence={s.confidence} n={s.n} />
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* Laatste maand-detail: kort weergegeven onder de tabel. */}
              {bvSummaries[0].points.length > 0 && (
                <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2, paddingLeft: 4 }}>
                  Laatste afsluiting <strong>{bvSummaries[0].points[bvSummaries[0].points.length - 1].month}</strong>:
                  {' '}{bvSummaries.map(s => {
                    const last = s.points[s.points.length - 1]
                    if (!last) return null
                    const sign = last.driftPct >= 0 ? '+' : ''
                    return `${ACCURACY_KEY_LABELS[s.key]} ${sign}${last.driftPct.toFixed(1)}% (LE ${fmt(last.preCloseLE)} → actual ${fmt(last.actual)})`
                  }).filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          )
        })}
        <div style={{
          fontSize: 10, color: 'var(--t3)', borderTop: '1px solid var(--bd2)',
          paddingTop: 8, lineHeight: 1.5,
        }}>
          <strong style={{ color: 'var(--t2)' }}>Wat doet dit?</strong> De engine gebruikt deze drift-statistieken om
          zichzelf te kalibreren: bij een consistente bias (bv. LE schat omzet structureel 8% te laag) past hij
          toekomstige forecasts daar zacht op aan. Hoe meer afgesloten maanden, hoe smarter de engine wordt.
        </div>
      </div>
    </div>
  )
}
