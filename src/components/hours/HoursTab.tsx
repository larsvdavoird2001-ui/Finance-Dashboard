import { useState, useMemo } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import '../../lib/chartSetup'
import { CHART_COLORS } from '../../lib/chartSetup'
import { hoursData2026, hoursData2025, MONTHS_2026, MONTHS_2025, ACTUAL_MONTHS, CURRENT_MONTH } from '../../data/hoursData'
import type { BvId, GlobalFilter, HoursRecord } from '../../data/types'
import { useHoursStore, totalLeave } from '../../store/useHoursStore'
import { useImportStore } from '../../store/useImportStore'
import { fmt } from '../../lib/format'

const BVS: BvId[] = ['Consultancy', 'Projects', 'Software']

/** Bepaal de ISO-weeknummers die binnen een maand-code (bv. "Mar-26") vallen.
 *  Een ISO-week wordt geteld bij een maand wanneer de donderdag van die week
 *  in die maand valt — dat geeft de meest natuurlijke 4-5 weken split. */
const SHORT_TO_MONTHIDX: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
}
function splitMonthIntoWeeks(monthCode: string): number[] {
  const m = monthCode.match(/^(\w+)-(\d{2})$/)
  if (!m) return [1]
  const monIdx = SHORT_TO_MONTHIDX[m[1]]
  const year = 2000 + Number(m[2])
  if (monIdx == null) return [1]
  const first = new Date(year, monIdx, 1)
  const last  = new Date(year, monIdx + 1, 0)
  const weeks = new Set<number>()
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    // Donderdag-test: alleen weken meetellen waarvan de donderdag in de maand valt
    if (d.getDay() !== 4) continue
    weeks.add(getIsoWeek(d))
  }
  if (weeks.size === 0) {
    // fallback: 4 weken
    return [1, 2, 3, 4]
  }
  return Array.from(weeks).sort((a, b) => a - b)
}

/** ISO 8601 weeknummer voor een datum. */
function getIsoWeek(d: Date): number {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = (dt.getUTCDay() + 6) % 7  // ma=0..zo=6
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3) // donderdag van deze week
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4))
  const diff = (dt.getTime() - firstThursday.getTime()) / 86400000
  return 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
}

const BV_COLORS: Record<BvId, string> = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
}

function kpiCard(label: string, value: string, sub?: string, color?: string, tag?: string) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 160 }}>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{label}</div>
          {tag && <span style={{ fontSize: 9, background: 'var(--bd-blue)', color: 'var(--blue)', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>{tag}</span>}
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: color ?? 'var(--t1)', fontFamily: 'var(--mono)', letterSpacing: '-.5px' }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  )
}

const baseOpts = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#7c8aa0', font: { family: 'Inter', size: 11 }, boxWidth: 10 } },
    tooltip: {
      backgroundColor: '#10141f',
      borderColor: 'rgba(255,255,255,0.1)',
      borderWidth: 1,
      titleColor: '#dde3f0',
      bodyColor: '#7c8aa0',
    },
  },
  scales: {
    x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#3f4d63', font: { family: 'Inter', size: 10 } } },
    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#3f4d63', font: { family: 'Inter', size: 10 } } },
  },
}

interface Props { filter: GlobalFilter }

export function HoursTab({ filter }: Props) {
  const [view, setView] = useState<'monthly' | 'bv'>('monthly')
  const [metric, setMetric] = useState<'written' | 'declarable' | 'util'>('written')
  const [showForecast, setShowForecast] = useState(true)
  // Maand vs Week — voor de gedetailleerde overview-tabel onderaan. Wekelijkse
  // weergave verdeelt de geuploade SAP-maanddata gelijkmatig over de ISO-
  // weken van die maand (geschatte verdeling) zolang de SAP-export geen
  // Kalenderweek-kolom bevat. Toont een 'geschat'-badge in de tabel.
  const [period, setPeriod] = useState<'month' | 'week'>('month')

  const is2025 = filter.year === '2025'
  // Hours-store: geuploade SAP-timesheet data. Override hoursData2026
  // per (bv, maand) waar we een geuploade entry hebben met werkuren > 0.
  const hoursStoreEntries = useHoursStore(s => s.entries)
  const storeMap = useMemo(() => {
    const m = new Map<string, (typeof hoursStoreEntries)[number]>()
    for (const e of hoursStoreEntries) m.set(e.id, e)
    return m
  }, [hoursStoreEntries])

  // Import records — voor "Waarde Declarabel" (uren_facturering_totaal) en
  // "Waarde missing hours" (missing_hours). We pakken de laatst goedgekeurde
  // upload per (slot, maand) en lezen perBv uit. Niet aanwezig = 0.
  const importRecords = useImportStore(s => s.records)
  const valueLookup = useMemo(() => {
    const fact = new Map<string, Record<string, number>>()
    const miss = new Map<string, Record<string, number>>()
    for (const r of importRecords) {
      if (r.status !== 'approved') continue
      if (r.slotId === 'uren_facturering_totaal') {
        // Latest wins — records zijn niet gegarandeerd geordend dus we
        // overschrijven; in de praktijk is er per maand vaak één approved.
        fact.set(r.month, r.perBv ?? {})
      } else if (r.slotId === 'missing_hours') {
        miss.set(r.month, r.perBv ?? {})
      }
    }
    return { fact, miss }
  }, [importRecords])
  // Waarde Declarabel komt uit "Uren Facturering Totaal" en is alleen voor
  // Consultancy gedefinieerd. Voor andere BVs returneren we 0 — die hebben
  // geen vergelijkbaar bron-bestand. De parser routeert de upload ook al
  // exclusief naar Consultancy (targetBv='Consultancy'), dus theoretisch
  // staat er bij de andere BVs niets, maar deze guard maakt het expliciet.
  const waardeDeclarabel = (bv: BvId, month: string): number => {
    if (bv !== 'Consultancy') return 0
    return valueLookup.fact.get(month)?.[bv] ?? 0
  }
  const waardeMissingHours = (bv: BvId, month: string): number =>
    valueLookup.miss.get(month)?.[bv] ?? 0

  // ── Kalender-status per maand ──────────────────────────────────────────
  // 'closed'  = maand is volledig verstreken (t/m de afgelopen maand)
  // 'current' = de huidige kalendermaand (gedeeltelijk verstreken)
  // 'future'  = nog te komen
  const now = new Date()
  const nowY = now.getFullYear()
  const nowM = now.getMonth()   // 0-11
  const nowD = now.getDate()
  const daysInCur = new Date(nowY, nowM + 1, 0).getDate()
  // Fractie van de huidige kalendermaand die al verstreken is (24-apr ≈ 0.80).
  const curMonthFraction = Math.min(1, nowD / daysInCur)
  const MMM = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const monthStatus = (m: string): 'closed' | 'current' | 'future' => {
    const [mmm, yy] = m.split('-')
    const y = 2000 + Number(yy)
    const idx = MMM.indexOf(mmm)
    if (y < nowY) return 'closed'
    if (y > nowY) return 'future'
    if (idx < nowM) return 'closed'
    if (idx === nowM) return 'current'
    return 'future'
  }
  const MONTH_TO_PY = (m: string) => m.replace('-26', '-25')

  // ── LE-forecast voor hours: zelfde patroon als BudgetsTab.getForecastFor ──
  // blend = 0.6 × (2025-seizoen × perf_YTD) + 0.4 × run-rate, × leave-adj.
  // Voor hours gebruiken we hoursData2025 als seizoensbasis; run-rate is het
  // gemiddelde van de closed SAP-maanden in 2026.
  type Metric = 'written' | 'declarable'
  const getMetricVal = (r: HoursRecord, key: Metric): number =>
    key === 'written' ? r.written : r.declarable

  const forecastHours = (bv: BvId, month: string, key: Metric): number => {
    // Seizoen (2025 actual zelfde maand)
    const sameMonth2025 = hoursData2025.find(r => r.bv === bv && r.month === MONTH_TO_PY(month))
    const seasonal = sameMonth2025 ? getMetricVal(sameMonth2025, key) : 0

    // Run-rate: gemiddelde over gesloten 2026-maanden met SAP-data
    let runRateSum = 0, runRateCount = 0
    let ytd2026 = 0, ytd2025 = 0
    for (const closedM of MONTHS_2026) {
      if (monthStatus(closedM) !== 'closed') continue
      const e = storeMap.get(`${bv}-${closedM}`)
      if (e && e.declarable + e.internal > 0) {
        const val = key === 'written' ? (e.declarable + e.internal) : e.declarable
        runRateSum += val
        runRateCount++
        ytd2026 += val
      }
      // 2025 YTD voor perf-multiplier
      const py2025 = hoursData2025.find(r => r.bv === bv && r.month === MONTH_TO_PY(closedM))
      if (py2025) ytd2025 += getMetricVal(py2025, key)
    }
    const avgRunRate = runRateCount > 0 ? runRateSum / runRateCount : 0
    const perfMult = ytd2025 !== 0 ? ytd2026 / ytd2025 : 1

    // Leave dampening: geplande vakantie in deze specifieke maand (uit store)
    const storeEntry = storeMap.get(`${bv}-${month}`)
    const plannedVak = storeEntry?.vakantie ?? 0
    let leaveAdj = 1
    if (plannedVak > 0 && avgRunRate > 0) {
      leaveAdj = 1 - Math.min(plannedVak / avgRunRate, 0.5)
    }

    const seasonalForecast = seasonal * perfMult * leaveAdj
    const runRateForecast  = avgRunRate * leaveAdj

    if (seasonalForecast === 0 && runRateForecast === 0) return 0
    if (seasonalForecast === 0) return Math.round(runRateForecast)
    if (runRateForecast === 0)  return Math.round(seasonalForecast)
    return Math.round(0.6 * seasonalForecast + 0.4 * runRateForecast)
  }

  // Bepaalt per (bv, maand) de effective HoursRecord:
  //  - closed maand met SAP-data → 'actual' uit store
  //  - closed maand zonder SAP-data → 'actual' uit hardcoded fallback
  //  - current maand met SAP-partial → registered + prorated rest = 'current'
  //  - current maand zonder data → hardcoded 'current' of forecast
  //  - future maand → LE-forecast
  const mergedHours2026: HoursRecord[] = useMemo(() => {
    return hoursData2026.map(rec => {
      const status = monthStatus(rec.month)
      const storeEntry = storeMap.get(`${rec.bv}-${rec.month}`)
      const work = storeEntry ? storeEntry.declarable + storeEntry.internal : 0
      const leave = storeEntry ? totalLeave(storeEntry) : 0

      if (status === 'closed') {
        if (storeEntry && work > 0) {
          return {
            ...rec,
            written: work,
            declarable: storeEntry.declarable,
            nonDeclarable: storeEntry.internal,
            capacity: Math.max(rec.capacity, work + leave),
            type: 'actual',
          }
        }
        return { ...rec, type: 'actual' }  // hardcoded fallback
      }

      if (status === 'current') {
        // LE-forecast voor de hele maand
        const fcWritten = forecastHours(rec.bv, rec.month, 'written')
        const fcDecl    = forecastHours(rec.bv, rec.month, 'declarable')
        if (storeEntry && work > 0) {
          // SAP heeft partial data voor huidige maand (bv. gedeelte april
          // geregistreerd). Behoud de registered hours en blend met forecast
          // voor de resterende fractie van de maand.
          const remainFrac = Math.max(0, 1 - curMonthFraction)
          const combinedWritten   = Math.round(work + fcWritten * remainFrac)
          const combinedDecl      = Math.round(storeEntry.declarable + fcDecl * remainFrac)
          const combinedNonDecl   = Math.round(storeEntry.internal + (fcWritten - fcDecl) * remainFrac)
          return {
            ...rec,
            written: combinedWritten,
            declarable: combinedDecl,
            nonDeclarable: combinedNonDecl,
            capacity: Math.max(rec.capacity, combinedWritten + leave),
            type: 'current',
          }
        }
        // Geen SAP-partial: gebruik pure forecast voor huidige maand, gemarkeerd als current.
        if (fcWritten > 0) {
          return {
            ...rec,
            written: fcWritten,
            declarable: fcDecl,
            nonDeclarable: Math.max(0, fcWritten - fcDecl),
            type: 'current',
          }
        }
        return { ...rec, type: 'current' }
      }

      // Future: puur LE-forecast
      const fcWritten = forecastHours(rec.bv, rec.month, 'written')
      const fcDecl    = forecastHours(rec.bv, rec.month, 'declarable')
      if (fcWritten > 0) {
        return {
          ...rec,
          written: fcWritten,
          declarable: fcDecl,
          nonDeclarable: Math.max(0, fcWritten - fcDecl),
          // Capacity: behoud hardcoded baseline (capaciteitsplan), anders
          // fallback op forecasted werkuren + geplande verlof.
          capacity: Math.max(rec.capacity, fcWritten + leave),
          type: 'forecast',
        }
      }
      return { ...rec, type: 'forecast' }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeMap])

  const hoursData = is2025 ? hoursData2025 : mergedHours2026
  const months    = is2025 ? MONTHS_2025   : MONTHS_2026

  const activeBvs = filter.bv === 'all' ? BVS : [filter.bv as BvId]

  const allRecords     = hoursData.filter(r => activeBvs.includes(r.bv))
  const actualRecords  = allRecords.filter(r => r.type === 'actual')
  const currentRecords = is2025 ? [] : allRecords.filter(r => r.type === 'current')

  // ── YTD / Full-year actuals ────────────────────────────────────────────
  const ytdWritten  = actualRecords.reduce((a, r) => a + r.written, 0)
  const ytdDecl     = actualRecords.reduce((a, r) => a + r.declarable, 0)
  const ytdNonDecl  = actualRecords.reduce((a, r) => a + r.nonDeclarable, 0)
  const ytdCap      = actualRecords.reduce((a, r) => a + r.capacity, 0)
  const ytdDeclPct  = ytdWritten > 0 ? ytdDecl / ytdWritten * 100 : 0
  const ytdCapUtil  = ytdCap > 0 ? ytdWritten / ytdCap * 100 : 0

  // ── Verlof + ziekte YTD (afgesloten maanden, alle actieve BVs) ─────────
  // Gebruikt useHoursStore — data uit de geschreven_uren SAP-upload. We
  // tellen alleen entries op die corresponderen met een 'actual'-record om
  // te voorkomen dat forecast-maanden meetellen voor "geboekte" verlof/ziekte.
  let ytdVakantie = 0, ytdZiekte = 0, ytdOverig = 0, ytdLeaveTotaal = 0
  for (const r of actualRecords) {
    const e = storeMap.get(`${r.bv}-${r.month}`)
    if (!e) continue
    ytdVakantie    += e.vakantie
    ytdZiekte      += e.ziekte
    ytdOverig      += e.overigVerlof
    ytdLeaveTotaal += totalLeave(e)
  }
  // Noemer voor % = werkuren + alle afwezigheid (= "totaal aantal uren" zoals
  // in de Consultancy overview). Komt overeen met Excel-referentie.
  const ytdAlle = ytdWritten + ytdLeaveTotaal
  const ytdVakPct    = ytdAlle > 0 ? (ytdVakantie / ytdAlle) * 100 : 0
  const ytdZiekPct   = ytdAlle > 0 ? (ytdZiekte    / ytdAlle) * 100 : 0

  // ── Waarde Declarabel + Missing-hours waarde YTD ───────────────────────
  let ytdWaardeDecl = 0, ytdWaardeMiss = 0
  for (const r of actualRecords) {
    ytdWaardeDecl += waardeDeclarabel(r.bv, r.month)
    ytdWaardeMiss += waardeMissingHours(r.bv, r.month)
  }
  const ytdOmzetTotaal = ytdWaardeDecl + ytdWaardeMiss

  // ── Current month (partial, 2026 only) ────────────────────────────────
  const curWritten = currentRecords.reduce((a, r) => a + r.written, 0)
  const curDecl    = currentRecords.reduce((a, r) => a + r.declarable, 0)
  const curDeclPct = curWritten > 0 ? curDecl / curWritten * 100 : 0

  // ── Full year forecast (2026 only) ─────────────────────────────────────
  const fyWritten = allRecords.reduce((a, r) => a + (r.type !== 'current' ? r.written : 0), 0) + curWritten
  const fyDecl    = allRecords.reduce((a, r) => a + (r.type !== 'current' ? r.declarable : 0), 0) + curDecl

  // ── Monthly trend datasets ─────────────────────────────────────────────
  const displayMonths = is2025
    ? months
    : (showForecast ? MONTHS_2026 : [...ACTUAL_MONTHS, CURRENT_MONTH])

  const getVal = (bv: BvId, m: string) => {
    const r = hoursData.find(x => x.bv === bv && x.month === m)
    if (!r) return null
    if (metric === 'written')    return r.written
    if (metric === 'declarable') return r.declarable
    return r.written > 0 ? r.declarable / r.written * 100 : 0
  }

  const trendDatasets = is2025
    // 2025: all solid lines (all actuals)
    ? activeBvs.map(bv => ({
        label: bv,
        data: displayMonths.map(m => getVal(bv, m)),
        borderColor: CHART_COLORS[bv],
        backgroundColor: CHART_COLORS[bv] + '20',
        borderWidth: 2.5,
        tension: 0.3,
        fill: false,
        pointRadius: 4,
        pointBackgroundColor: CHART_COLORS[bv],
        spanGaps: false,
      }))
    // 2026: actuals solid, forecast dashed
    : activeBvs.flatMap(bv => {
        const color = CHART_COLORS[bv]
        const actualVals = displayMonths.map(m => {
          const r = hoursData.find(x => x.bv === bv && x.month === m)
          if (!r || r.type === 'forecast') return null
          return getVal(bv, m)
        })
        const forecastVals = displayMonths.map(m => {
          const r = hoursData.find(x => x.bv === bv && x.month === m)
          if (!r || r.type === 'actual') return null
          return getVal(bv, m)
        })
        return [
          {
            label: `${bv} (actuals)`,
            data: actualVals,
            borderColor: color,
            backgroundColor: color + '20',
            borderWidth: 2.5,
            tension: 0.3,
            fill: false,
            pointRadius: 4,
            pointBackgroundColor: color,
            spanGaps: false,
          },
          {
            label: `${bv} (forecast)`,
            data: forecastVals,
            borderColor: color,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [5, 4],
            tension: 0.3,
            fill: false,
            pointRadius: 3,
            pointStyle: 'circle' as const,
            pointBackgroundColor: 'transparent',
            pointBorderColor: color,
            spanGaps: true,
          },
        ]
      })

  const trendData = { labels: displayMonths, datasets: trendDatasets }

  // ── BV bar chart ────────────────────────────────────────────────────────
  const bvBar = {
    labels: activeBvs,
    datasets: [
      {
        label: 'Geschreven (actuals)',
        data: activeBvs.map(bv => hoursData.filter(r => r.bv === bv && r.type === 'actual').reduce((a, r) => a + r.written, 0)),
        backgroundColor: activeBvs.map(bv => BV_COLORS[bv]),
        borderRadius: 4,
      },
      {
        label: 'Declarabel (actuals)',
        data: activeBvs.map(bv => hoursData.filter(r => r.bv === bv && r.type === 'actual').reduce((a, r) => a + r.declarable, 0)),
        backgroundColor: activeBvs.map(bv => BV_COLORS[bv] + '55'),
        borderRadius: 4,
      },
    ],
  }

  return (
    <div className="page">
      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className={`btn sm${view === 'monthly' ? ' primary' : ' ghost'}`} onClick={() => setView('monthly')}>Maandtrend</button>
        <button className={`btn sm${view === 'bv'      ? ' primary' : ' ghost'}`} onClick={() => setView('bv')}>Per BV</button>
        <div style={{ borderLeft: '1px solid var(--bd)', margin: '0 4px', height: 18 }} />
        <button className={`btn sm${metric === 'written'    ? ' primary' : ' ghost'}`} onClick={() => setMetric('written')}>Geschreven</button>
        <button className={`btn sm${metric === 'declarable' ? ' primary' : ' ghost'}`} onClick={() => setMetric('declarable')}>Declarabel</button>
        <button className={`btn sm${metric === 'util'       ? ' primary' : ' ghost'}`} onClick={() => setMetric('util')}>Util %</button>
        <div style={{ borderLeft: '1px solid var(--bd)', margin: '0 4px', height: 18 }} />
        <span style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase' }}>Detailtabel:</span>
        <button
          className={`btn sm${period === 'month' ? ' primary' : ' ghost'}`}
          onClick={() => setPeriod('month')}
          title="Toon één rij per BV per maand"
        >📅 Maand</button>
        <button
          className={`btn sm${period === 'week' ? ' primary' : ' ghost'}`}
          onClick={() => setPeriod('week')}
          title="Toon één rij per BV per ISO-week (geschat — SAP-export bevat meestal alleen maand-niveau)"
        >🗓 Week</button>
        {!is2025 && (
          <>
            <div style={{ borderLeft: '1px solid var(--bd)', margin: '0 4px', height: 18 }} />
            <button
              className={`btn sm${showForecast ? ' primary' : ' ghost'}`}
              onClick={() => setShowForecast(s => !s)}
              title="Toon/verberg forecast maanden"
            >
              {showForecast ? '📅 Incl. forecast' : '📅 Actuals only'}
            </button>
          </>
        )}
      </div>

      {/* KPI cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {kpiCard(
          'Geschreven uren',
          ytdWritten.toLocaleString('nl-NL'),
          is2025 ? 'FY2025 — alle maanden' : `YTD ${ACTUAL_MONTHS[ACTUAL_MONTHS.length-1]} actuals`,
          undefined,
          is2025 ? 'FY' : 'YTD'
        )}
        {kpiCard('Declarabel', ytdDecl.toLocaleString('nl-NL'), `${ytdDeclPct.toFixed(1)}% van geschreven`, 'var(--green)', is2025 ? 'FY' : 'YTD')}
        {kpiCard('Niet-declarabel', ytdNonDecl.toLocaleString('nl-NL'), `${(100-ytdDeclPct).toFixed(1)}% overhead`, 'var(--amber)', is2025 ? 'FY' : 'YTD')}
        {kpiCard('Vakantie / verlof', ytdVakantie.toLocaleString('nl-NL'), `${ytdVakPct.toFixed(1)}% van totaal · ${ytdOverig > 0 ? ytdOverig.toLocaleString('nl-NL') + ' overig verlof' : 'geen overig verlof'}`, '#8b5cf6', is2025 ? 'FY' : 'YTD')}
        {kpiCard('Ziekte', ytdZiekte.toLocaleString('nl-NL'), `${ytdZiekPct.toFixed(1)}% van totaal`, 'var(--red)', is2025 ? 'FY' : 'YTD')}
        {kpiCard('Bezettingsgraad', `${ytdCapUtil.toFixed(0)}%`, `${ytdWritten.toLocaleString('nl-NL')} / ${ytdCap.toLocaleString('nl-NL')} cap`, ytdCapUtil >= 90 ? 'var(--green)' : ytdCapUtil >= 75 ? 'var(--amber)' : 'var(--red)', is2025 ? 'FY' : 'YTD')}
        {!is2025 && ytdWaardeDecl > 0 && kpiCard('Waarde declarabel', fmt(ytdWaardeDecl), 'Uren Facturering Totaal · Consultancy', 'var(--green)', is2025 ? 'FY' : 'YTD')}
        {!is2025 && ytdOmzetTotaal > 0 && kpiCard('Omzet totaal', fmt(ytdOmzetTotaal), `Consultancy · incl. ${fmt(ytdWaardeMiss)} missing-hours`, 'var(--blue)', is2025 ? 'FY' : 'YTD')}
        {!is2025 && kpiCard(CURRENT_MONTH + ' (lopend)', curWritten.toLocaleString('nl-NL'), `${curDeclPct.toFixed(1)}% declarabel · gedeeltelijk`, 'var(--amber)', 'Nu')}
        {!is2025 && kpiCard('FY2026 forecast', fyWritten.toLocaleString('nl-NL'), `${fyDecl.toLocaleString('nl-NL')} declarabel`, 'var(--t3)', 'FC')}
      </div>

      {/* Legenda actuals vs forecast */}
      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--t2)', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 20, height: 2, background: 'var(--blue)', display: 'inline-block', borderRadius: 1 }} /> Actuals (SAP)
        </span>
        {!is2025 && <>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 20, borderTop: '2px dashed var(--blue)', display: 'inline-block' }} /> Forecast (capaciteitsplan)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, background: 'var(--amber)', borderRadius: '50%', display: 'inline-block' }} /> {CURRENT_MONTH} lopend
          </span>
        </>}
      </div>

      {/* Chart */}
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">{view === 'monthly' ? `Maandtrend Uren ${is2025 ? '2025' : '2026'}` : `Uren per BV (${is2025 ? 'FY2025' : 'YTD actuals'})`}</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>
            {metric === 'util' ? 'Declarabelheid %' : 'Uren'}
            {!is2025 && view === 'monthly' && showForecast && <span style={{ marginLeft: 8, color: 'var(--amber)', fontSize: 9 }}>FORECAST ≥ {CURRENT_MONTH}</span>}
          </span>
        </div>
        <div style={{ padding: 16, height: 280 }}>
          {view === 'monthly'
            ? <Line data={trendData} options={{
                ...baseOpts,
                scales: {
                  ...baseOpts.scales,
                  y: {
                    ...baseOpts.scales.y,
                    ticks: { ...baseOpts.scales.y.ticks, callback: (v: number | string) => metric === 'util' ? `${v}%` : Number(v).toLocaleString('nl-NL') },
                  },
                },
              } as Parameters<typeof Line>[0]['options']} />
            : <Bar data={bvBar} options={baseOpts as Parameters<typeof Bar>[0]['options']} />
          }
        </div>
      </div>

      {/* Detail table — Consultancy overview structuur:
            BV · Maand · (Week) · SVW dagen · Decl uren/% · NietDecl uren/% ·
            Verlof uren/% · Ziekte uren/% · Missend uren/% · Totaal uren ·
            Waarde Declarabel · Waarde missing-hours · Omzet totaal */}
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">
            Urenverdeling per BV & {period === 'week' ? 'Week' : 'Maand'}
          </span>
          {period === 'week' && (
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--amber)' }}>
              ⓘ Week-verdeling is geschat (SAP-export bevat meestal alleen maand-niveau)
            </span>
          )}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ minWidth: 1200, fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 110 }}>BV</th>
                <th style={{ minWidth: 70 }}>Maand</th>
                {period === 'week' && <th style={{ minWidth: 50 }}>Week</th>}
                <th className="r">SVW dgn</th>
                <th className="r">Decl. uren</th>
                <th className="r">Decl. %</th>
                <th className="r">Niet-decl.</th>
                <th className="r">N-d %</th>
                <th className="r" style={{ color: '#8b5cf6' }}>Verlof</th>
                <th className="r" style={{ color: '#8b5cf6' }}>Verlof %</th>
                <th className="r" style={{ color: 'var(--red)' }}>Ziekte</th>
                <th className="r" style={{ color: 'var(--red)' }}>Ziekte %</th>
                <th className="r">Missend</th>
                <th className="r">Miss %</th>
                <th className="r" style={{ fontWeight: 700 }}>Totaal</th>
                <th className="r" title="Uit Uren Facturering Totaal — alleen voor Consultancy ingevuld">Waarde declarabel</th>
                <th className="r" title="Uit Missing Hours — alleen voor Consultancy">Waarde missing-h</th>
                <th className="r" style={{ fontWeight: 700 }} title="Som van Waarde declarabel + Missing-hours waarde — alleen Consultancy">Omzet totaal</th>
              </tr>
            </thead>
            <tbody>
              {activeBvs.map(bv => {
                const displayR = is2025
                  ? hoursData.filter(r => r.bv === bv)
                  : showForecast
                    ? hoursData.filter(r => r.bv === bv)
                    : hoursData.filter(r => r.bv === bv && r.type !== 'forecast')

                // Subtotaal-accumulators per BV (alleen actuals).
                let totDecl = 0, totND = 0, totVer = 0, totZk = 0, totMs = 0
                let totWDecl = 0, totWMiss = 0
                const rows: React.ReactNode[] = []

                for (const r of displayR) {
                  const isForecast = r.type === 'forecast'
                  const isCurrent  = r.type === 'current'
                  const e = storeMap.get(`${bv}-${r.month}`)
                  // Verlof = vakantie + overigVerlof, ziekte apart, niet-decl =
                  // r.nonDeclarable (al berekend in mergedHours2026).
                  const vak    = e?.vakantie ?? 0
                  const ovr    = e?.overigVerlof ?? 0
                  const verlof = vak + ovr
                  const ziekte = e?.ziekte ?? 0
                  const decl   = r.declarable
                  const nond   = r.nonDeclarable
                  // Missende uren: voor Consultancy berekenen we ze uit
                  // capaciteit (= aantal werkdagen × 8 × headcount). Wij
                  // hebben echter alleen hoursData.capacity dat is aangepast
                  // op (werkuren + verlof) — niet op originele capaciteit.
                  // Voor de Excel-referentie tonen we hier het verschil tussen
                  // capacity en (decl + nond + verlof + ziekte). Voor andere
                  // BVs is missing_hours niet van toepassing → 0.
                  const sumKnown = decl + nond + verlof + ziekte
                  const missing  = bv === 'Consultancy'
                    ? Math.max(0, r.capacity - sumKnown)
                    : 0
                  const totaal = decl + nond + verlof + ziekte + missing
                  const wDecl  = waardeDeclarabel(bv, r.month)
                  const wMiss  = waardeMissingHours(bv, r.month)
                  const omzet  = wDecl + wMiss

                  // SVW dagen: 5 voor een normale werkweek (placeholder tot
                  // SAP-export werkdagen-kolom bevat).
                  const svwDgn = 5

                  // Procent berekeningen (delen op totaal incl. afwezigheid)
                  const pct = (n: number) => totaal > 0 ? (n / totaal * 100).toFixed(1) : '—'

                  if (!isForecast) {
                    totDecl += decl; totND += nond; totVer += verlof; totZk += ziekte; totMs += missing
                    totWDecl += wDecl; totWMiss += wMiss
                  }

                  // Per-week split: gelijkmatig over 4-5 ISO-weken van de maand.
                  const weeks = period === 'week' ? splitMonthIntoWeeks(r.month) : [null]
                  for (let wi = 0; wi < weeks.length; wi++) {
                    const w = weeks[wi]
                    const div = period === 'week' ? weeks.length : 1
                    const sd = period === 'week' ? svwDgn / div : svwDgn
                    rows.push(
                      <tr key={`${bv}-${r.month}-${w ?? 'm'}`} className="sub" style={{ opacity: isForecast ? 0.55 : 1 }}>
                        <td style={{ color: BV_COLORS[bv], fontWeight: 600 }}>{bv}</td>
                        <td style={{ fontWeight: 500 }}>{r.month}{isForecast && <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--t3)' }}>FC</span>}{isCurrent && <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--amber)' }}>lopend</span>}</td>
                        {period === 'week' && <td style={{ fontWeight: 500 }}>W{w}{period === 'week' && <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--amber)' }} title="Geschat — SAP-export bevat geen weekkolom">≈</span>}</td>}
                        <td className="mono r" style={{ color: 'var(--t3)' }}>{Math.round(sd * 10) / 10}</td>
                        <td className="mono r" style={{ color: 'var(--green)' }}>{Math.round(decl / div).toLocaleString('nl-NL')}</td>
                        <td className="mono r" style={{ color: 'var(--green)' }}>{pct(decl)}%</td>
                        <td className="mono r" style={{ color: 'var(--amber)' }}>{Math.round(nond / div).toLocaleString('nl-NL')}</td>
                        <td className="mono r" style={{ color: 'var(--amber)' }}>{pct(nond)}%</td>
                        <td className="mono r" style={{ color: '#8b5cf6' }}>{Math.round(verlof / div).toLocaleString('nl-NL')}</td>
                        <td className="mono r" style={{ color: '#8b5cf6' }}>{pct(verlof)}%</td>
                        <td className="mono r" style={{ color: 'var(--red)' }}>{Math.round(ziekte / div).toLocaleString('nl-NL')}</td>
                        <td className="mono r" style={{ color: 'var(--red)' }}>{pct(ziekte)}%</td>
                        <td className="mono r" style={{ color: missing > 0 ? 'var(--amber)' : 'var(--t3)' }}>{missing > 0 ? Math.round(missing / div).toLocaleString('nl-NL') : '—'}</td>
                        <td className="mono r" style={{ color: missing > 0 ? 'var(--amber)' : 'var(--t3)' }}>{missing > 0 ? `${pct(missing)}%` : '—'}</td>
                        <td className="mono r" style={{ fontWeight: 600 }}>{Math.round(totaal / div).toLocaleString('nl-NL')}</td>
                        <td className="mono r" style={{ color: 'var(--green)' }}>{wDecl > 0 ? fmt(wDecl / div) : '—'}</td>
                        <td className="mono r" style={{ color: 'var(--amber)' }}>{wMiss > 0 ? fmt(wMiss / div) : '—'}</td>
                        <td className="mono r" style={{ fontWeight: 600, color: 'var(--blue)' }}>{omzet > 0 ? fmt(omzet / div) : '—'}</td>
                      </tr>
                    )
                  }
                }

                const totAll = totDecl + totND + totVer + totZk + totMs
                const tpct = (n: number) => totAll > 0 ? (n / totAll * 100).toFixed(1) : '—'
                rows.push(
                  <tr key={`${bv}-tot`} className="tot">
                    <td colSpan={period === 'week' ? 4 : 3} style={{ fontWeight: 700 }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: BV_COLORS[bv], marginRight: 6 }} />
                      {bv} {is2025 ? 'FY2025' : 'YTD actuals'}
                    </td>
                    <td className="mono r" style={{ color: 'var(--green)' }}>{totDecl.toLocaleString('nl-NL')}</td>
                    <td className="mono r" style={{ color: 'var(--green)' }}>{tpct(totDecl)}%</td>
                    <td className="mono r" style={{ color: 'var(--amber)' }}>{totND.toLocaleString('nl-NL')}</td>
                    <td className="mono r" style={{ color: 'var(--amber)' }}>{tpct(totND)}%</td>
                    <td className="mono r" style={{ color: '#8b5cf6' }}>{totVer.toLocaleString('nl-NL')}</td>
                    <td className="mono r" style={{ color: '#8b5cf6' }}>{tpct(totVer)}%</td>
                    <td className="mono r" style={{ color: 'var(--red)' }}>{totZk.toLocaleString('nl-NL')}</td>
                    <td className="mono r" style={{ color: 'var(--red)' }}>{tpct(totZk)}%</td>
                    <td className="mono r" style={{ color: totMs > 0 ? 'var(--amber)' : 'var(--t3)' }}>{totMs > 0 ? totMs.toLocaleString('nl-NL') : '—'}</td>
                    <td className="mono r" style={{ color: totMs > 0 ? 'var(--amber)' : 'var(--t3)' }}>{totMs > 0 ? `${tpct(totMs)}%` : '—'}</td>
                    <td className="mono r" style={{ fontWeight: 700 }}>{totAll.toLocaleString('nl-NL')}</td>
                    <td className="mono r" style={{ color: 'var(--green)' }}>{totWDecl > 0 ? fmt(totWDecl) : '—'}</td>
                    <td className="mono r" style={{ color: 'var(--amber)' }}>{totWMiss > 0 ? fmt(totWMiss) : '—'}</td>
                    <td className="mono r" style={{ fontWeight: 700, color: 'var(--blue)' }}>{(totWDecl + totWMiss) > 0 ? fmt(totWDecl + totWMiss) : '—'}</td>
                  </tr>
                )
                return rows
              })}
            </tbody>
          </table>
        </div>
        {period === 'week' && (
          <div style={{ padding: '8px 14px', fontSize: 10, color: 'var(--t3)', borderTop: '1px solid var(--bd2)' }}>
            ⓘ De wekelijkse verdeling is een gelijkmatige split van de maand-totalen over de ISO-weken die binnen die maand vallen.
            Voor exacte per-week cijfers moet de SAP-export een <code>Kalenderweek</code>-kolom bevatten — dan worden de echte
            wekelijkse waardes gebruikt zodra de parser is uitgebreid.
          </div>
        )}
      </div>

      {/* Warning */}
      {ytdDeclPct < 75 && (
        <div style={{ background: 'var(--bd-amber)', border: '1px solid var(--amber)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--amber)' }}>
          ⚠ Gemiddelde declarabelheid {ytdDeclPct.toFixed(1)}% (YTD actuals) ligt onder de norm van 75%. Controleer niet-declarabele uren.
        </div>
      )}
    </div>
  )
}
