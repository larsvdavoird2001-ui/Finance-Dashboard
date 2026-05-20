// Uren Dashboard — blok "Interne uren": onderverdeling van de niet-declarabele
// uren per BV en per categorie. Toont de actuals van de volledig gepasseerde
// maanden (t/m april) en daarna een Latest Estimate t/m einde jaar, met het
// aandeel van de totale werknemer-uren (bv. hoeveel % naar leegloop gaat).
import { useMemo, useState } from 'react'
import { Line } from 'react-chartjs-2'
import '../../lib/chartSetup'
import { useInternalHoursStore } from '../../store/useInternalHoursStore'
import { useHoursStore } from '../../store/useHoursStore'
import { INTERNAL_HOURS_CATEGORIES, INTERNAL_CAT_KEYS } from '../../lib/parseInternalHours'
import { MONTHS_2026, hoursData2026 } from '../../data/hoursData'
import type { BvId } from '../../data/types'

const CAT_COLOR: Record<string, string> = {
  leegloop:    '#ef5350',
  teamleiding: '#00a9e0',
  opleiding:   '#8b5cf6',
  sales:       '#26c997',
  opex:        '#f5a623',
  overleg:     '#5b8def',
  overig:      '#8fa3c0',
}
const BVS: BvId[] = ['Consultancy', 'Projects', 'Software']
const fmtU = (n: number) => Math.round(n).toLocaleString('nl-NL') + ' u'
const fmtP = (n: number) => n.toFixed(1) + '%'

/** Index van de eerste niet-volledig-gepasseerde maand in 2026 (0 = Jan).
 *  Alles ervóór = actuals, vanaf hier = Latest Estimate. */
function currentMonthIdx2026(): number {
  const now = new Date()
  if (now.getFullYear() > 2026) return 12
  if (now.getFullYear() < 2026) return 0
  return now.getMonth()
}

export function InternalHoursSection() {
  const entries = useInternalHoursStore(s => s.entries)
  const hoursEntries = useHoursStore(s => s.entries)
  const [sel, setSel] = useState<'all' | BvId>('all')

  const data = useMemo(() => {
    const ent = entries.filter(e => e.month.endsWith('-26'))
    if (ent.length === 0) return null

    const closedCount = currentMonthIdx2026()        // bv. 4 → Jan–Apr zijn actuals
    const selBvs: BvId[] = sel === 'all' ? BVS : [sel]

    // Totale werknemer-uren per (bv, maand). Voor een volledig gepasseerde
    // maand: declarabel + intern uit de geschreven-uren-upload (echte data).
    // Voor de lopende/toekomstige maanden: het capaciteitsplan — anders zou
    // een nog-niet-volledige maand (bv. mei) een veel te kleine noemer geven
    // en het aandeel-% kunstmatig opblazen.
    const workedOf = (bv: BvId, month: string, closed: boolean): number => {
      if (closed) {
        const h = hoursEntries.find(e => e.bv === bv && e.month === month)
        if (h && (h.declarable + h.internal) > 0) return h.declarable + h.internal
      }
      const r = hoursData2026.find(x => x.bv === bv && x.month === month)
      return r ? r.written : 0
    }

    // Actuals per categorie per maand (alleen volledig gepasseerde maanden).
    const catActual: Record<string, number[]> = {}
    for (const k of INTERNAL_CAT_KEYS) {
      catActual[k] = MONTHS_2026.map((m, i) => i >= closedCount ? 0
        : ent.filter(e => e.month === m && selBvs.includes(e.bv))
            .reduce((s, e) => s + (e.categories[k] ?? 0), 0))
    }
    // Gesloten maanden mét data — basis voor de Latest Estimate.
    const closedWithData = MONTHS_2026
      .map((_, i) => i)
      .filter(i => i < closedCount && ent.some(e => e.month === MONTHS_2026[i] && selBvs.includes(e.bv)))
    const fcBasis = closedWithData.slice(-3)          // laatste 3 gesloten maanden
    const catFc: Record<string, number> = {}
    for (const k of INTERNAL_CAT_KEYS) {
      catFc[k] = fcBasis.length > 0
        ? fcBasis.reduce((s, i) => s + catActual[k][i], 0) / fcBasis.length
        : 0
    }
    // Volledige 12-maands reeks: actuals t/m april, daarna Latest Estimate.
    const catSeries: Record<string, number[]> = {}
    for (const k of INTERNAL_CAT_KEYS) {
      catSeries[k] = MONTHS_2026.map((_, i) => i < closedCount ? catActual[k][i] : catFc[k])
    }
    const workedSeries = MONTHS_2026.map((m, i) => selBvs.reduce((s, bv) => s + workedOf(bv, m, i < closedCount), 0))

    // YTD (alleen actuals)
    const catYtd: Record<string, number> = {}
    for (const k of INTERNAL_CAT_KEYS) catYtd[k] = catActual[k].reduce((s, v) => s + v, 0)
    const totalYtd = Object.values(catYtd).reduce((s, v) => s + v, 0)
    const workedYtd = workedSeries.slice(0, closedCount).reduce((s, v) => s + v, 0)
    // Prognose rest van het jaar
    const catRest: Record<string, number> = {}
    for (const k of INTERNAL_CAT_KEYS) catRest[k] = catFc[k] * Math.max(0, 12 - closedCount)

    // Per BV — leegloop-aandeel van de werknemer-uren (actuals)
    const perBv = BVS.map(bv => {
      let tot = 0, leeg = 0, worked = 0
      for (let i = 0; i < closedCount; i++) {
        const m = MONTHS_2026[i]
        const bvEnt = ent.filter(e => e.month === m && e.bv === bv)
        tot += bvEnt.reduce((s, e) => s + INTERNAL_CAT_KEYS.reduce((ss, k) => ss + (e.categories[k] ?? 0), 0), 0)
        leeg += bvEnt.reduce((s, e) => s + (e.categories.leegloop ?? 0), 0)
        worked += workedOf(bv, m, true)
      }
      return { bv, tot, leeg, leegPctWorked: worked > 0 ? leeg / worked * 100 : 0 }
    })

    // Top werknemers met leegloop (actuals, scope)
    const empMap = new Map<string, { leegloop: number; totaal: number }>()
    for (let i = 0; i < closedCount; i++) {
      for (const e of ent.filter(e => e.month === MONTHS_2026[i] && selBvs.includes(e.bv))) {
        for (const emp of e.employees) {
          const cur = empMap.get(emp.naam) ?? { leegloop: 0, totaal: 0 }
          cur.leegloop += emp.leegloop
          cur.totaal += emp.totaal
          empMap.set(emp.naam, cur)
        }
      }
    }
    const topEmp = [...empMap.entries()].map(([naam, v]) => ({ naam, ...v }))
      .sort((a, b) => b.leegloop - a.leegloop).slice(0, 10)

    return { closedCount, catSeries, workedSeries, catActual, catYtd, totalYtd, workedYtd, catFc, catRest, perBv, topEmp }
  }, [entries, hoursEntries, sel])

  if (!data) {
    return (
      <div className="card">
        <div className="card-hdr"><span className="card-title">🧩 Interne uren — onderverdeling niet-declarabele uren</span></div>
        <div style={{ padding: '16px 14px', fontSize: 12, color: 'var(--t3)' }}>
          Nog geen Interne-uren-bestand geüpload. Upload het via <strong>Maandafsluiting → Bestanden importeren → Interne uren</strong>.
        </div>
      </div>
    )
  }

  const { closedCount, catSeries, workedSeries, catActual, catYtd, totalYtd, workedYtd, catFc, catRest, perBv, topEmp } = data
  const leegloopPctWorked = workedYtd > 0 ? catYtd.leegloop / workedYtd * 100 : 0
  const monthLabels = MONTHS_2026.map(m => m.split('-')[0])
  const closedLabels = monthLabels.slice(0, closedCount)
  const lastClosed = closedCount > 0 ? monthLabels[closedCount - 1] : '—'

  // Trendlijnen: % van de totale werknemer-uren per categorie (12 mnd).
  const chartData = {
    labels: monthLabels,
    datasets: INTERNAL_HOURS_CATEGORIES.map(cat => ({
      label: cat.label,
      data: MONTHS_2026.map((_, i) => workedSeries[i] > 0 ? catSeries[cat.key][i] / workedSeries[i] * 100 : 0),
      borderColor: CAT_COLOR[cat.key],
      backgroundColor: CAT_COLOR[cat.key],
      borderWidth: cat.key === 'leegloop' ? 3 : 2,
      tension: 0.3,
      pointRadius: 3,
      // Latest-Estimate-deel (vanaf de eerste niet-gesloten maand) gestippeld.
      segment: { borderDash: (ctx: { p1DataIndex: number }) => ctx.p1DataIndex >= closedCount ? [6, 4] : undefined },
    })),
  }
  const chartOptions = {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: { position: 'bottom' as const, labels: { boxWidth: 10, font: { size: 10 }, color: '#8fa3c0' } },
      tooltip: { callbacks: { label: (c: { dataset: { label?: string }; parsed: { y: number } }) => `${c.dataset.label}: ${c.parsed.y.toFixed(1)}%` } },
    },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8fa3c0', font: { size: 10 } } },
      y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8fa3c0', font: { size: 10 }, callback: (v: string | number) => v + '%' }, beginAtZero: true },
    },
  }

  return (
    <div className="card">
      <div className="card-hdr">
        <span className="card-title">🧩 Interne uren — onderverdeling niet-declarabele uren</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {(['all', ...BVS] as const).map(b => (
            <button key={b} className={`btn sm${sel === b ? ' primary' : ' ghost'}`} onClick={() => setSel(b)} style={{ fontSize: 10 }}>
              {b === 'all' ? 'Alle BVs' : b}
            </button>
          ))}
        </div>
      </div>

      {/* Per-BV: leegloop-aandeel van de totale werknemer-uren (actuals) */}
      <div style={{ display: 'flex', gap: 8, padding: '10px 14px', flexWrap: 'wrap' }}>
        {perBv.map(b => (
          <div key={b.bv} style={{ flex: 1, minWidth: 160, background: 'var(--bg2)', border: `1px solid ${sel === b.bv ? 'var(--cyan)' : 'var(--bd2)'}`, borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t1)' }}>{b.bv}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: b.leegPctWorked > 12 ? 'var(--red)' : 'var(--amber)' }}>
              {fmtP(b.leegPctWorked)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--t3)' }}>
              van de werknemer-uren is leegloop · {fmtU(b.tot)} interne uren YTD
            </div>
          </div>
        ))}
      </div>

      {/* Trendlijnen: % van de werknemer-uren per categorie */}
      <div style={{ padding: '4px 14px 0' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t1)' }}>
          Aandeel van de totale werknemer-uren per categorie — {sel === 'all' ? 'alle BVs' : sel}
        </div>
        <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 2 }}>
          Doorgetrokken = actuals t/m {lastClosed} · gestippeld = Latest Estimate t/m december
        </div>
        <div style={{ height: 250, padding: '4px 0' }}>
          <Line data={chartData} options={chartOptions as Parameters<typeof Line>[0]['options']} />
        </div>
      </div>

      {/* Categorie-tabel: actuals per gesloten maand + YTD + LE */}
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Categorie</th>
              {closedLabels.map(m => <th key={m} style={{ textAlign: 'right' }}>{m}</th>)}
              <th style={{ textAlign: 'right' }}>YTD uren</th>
              <th style={{ textAlign: 'right' }}>% werknemer-uren</th>
              <th style={{ textAlign: 'right' }}>LE / mnd</th>
              <th style={{ textAlign: 'right' }}>Prognose rest '26</th>
            </tr>
          </thead>
          <tbody>
            {INTERNAL_HOURS_CATEGORIES.map(cat => (
              <tr key={cat.key}>
                <td>
                  <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: CAT_COLOR[cat.key], marginRight: 7 }} />
                  {cat.label}
                </td>
                {closedLabels.map((_, i) => (
                  <td key={i} style={{ textAlign: 'right' }}>{Math.round(catActual[cat.key][i]).toLocaleString('nl-NL')}</td>
                ))}
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{Math.round(catYtd[cat.key]).toLocaleString('nl-NL')}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: cat.key === 'leegloop' ? 'var(--red)' : 'var(--t2)' }}>
                  {workedYtd > 0 ? fmtP(catYtd[cat.key] / workedYtd * 100) : '—'}
                </td>
                <td style={{ textAlign: 'right', color: 'var(--t2)' }}>{Math.round(catFc[cat.key]).toLocaleString('nl-NL')}</td>
                <td style={{ textAlign: 'right', color: 'var(--amber)' }}>{Math.round(catRest[cat.key]).toLocaleString('nl-NL')}</td>
              </tr>
            ))}
            <tr style={{ background: 'var(--bg3)', fontWeight: 700 }}>
              <td>Totaal interne uren</td>
              {closedLabels.map((_, i) => (
                <td key={i} style={{ textAlign: 'right' }}>
                  {Math.round(INTERNAL_CAT_KEYS.reduce((s, k) => s + catActual[k][i], 0)).toLocaleString('nl-NL')}
                </td>
              ))}
              <td style={{ textAlign: 'right' }}>{Math.round(totalYtd).toLocaleString('nl-NL')}</td>
              <td style={{ textAlign: 'right' }}>{workedYtd > 0 ? fmtP(totalYtd / workedYtd * 100) : '—'}</td>
              <td style={{ textAlign: 'right' }}>{Math.round(INTERNAL_CAT_KEYS.reduce((s, k) => s + catFc[k], 0)).toLocaleString('nl-NL')}</td>
              <td style={{ textAlign: 'right', color: 'var(--amber)' }}>{Math.round(INTERNAL_CAT_KEYS.reduce((s, k) => s + catRest[k], 0)).toLocaleString('nl-NL')}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Inzicht */}
      <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--t2)', borderTop: '1px solid var(--bd2)' }}>
        <strong style={{ color: 'var(--red)' }}>{fmtP(leegloopPctWorked)}</strong> van de totale werknemer-uren
        ({sel === 'all' ? 'alle BVs' : sel}) gaat naar leegloop / niet-declarabele tijd (actuals t/m {lastClosed}).
        De Latest Estimate is het gemiddelde van de laatste 3 gesloten maanden, geprojecteerd t/m december.
      </div>

      {/* Top werknemers met leegloop */}
      {topEmp.length > 0 && (
        <div style={{ overflowX: 'auto', borderTop: '1px solid var(--bd2)' }}>
          <div style={{ padding: '8px 14px 2px', fontSize: 11, fontWeight: 700, color: 'var(--t1)' }}>
            Werknemers met de meeste leegloop — {sel === 'all' ? 'alle BVs' : sel} (actuals)
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>#</th>
                <th style={{ textAlign: 'left' }}>Werknemer</th>
                <th style={{ textAlign: 'right' }}>Leegloop</th>
                <th style={{ textAlign: 'right' }}>Totaal intern</th>
                <th style={{ textAlign: 'right' }}>Leegloop-aandeel</th>
              </tr>
            </thead>
            <tbody>
              {topEmp.map((e, i) => (
                <tr key={e.naam}>
                  <td style={{ color: 'var(--t3)' }}>{i + 1}</td>
                  <td>{e.naam}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--red)' }}>{fmtU(e.leegloop)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--t2)' }}>{fmtU(e.totaal)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--t3)' }}>
                    {e.totaal > 0 ? (e.leegloop / e.totaal * 100).toFixed(0) : 0}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
