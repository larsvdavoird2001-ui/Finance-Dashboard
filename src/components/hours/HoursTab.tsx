import { useState, useMemo } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import '../../lib/chartSetup'
import { CHART_COLORS } from '../../lib/chartSetup'
import { hoursData2026, hoursData2025, MONTHS_2026, MONTHS_2025, ACTUAL_MONTHS, CURRENT_MONTH } from '../../data/hoursData'
import type { BvId, GlobalFilter, HoursRecord } from '../../data/types'
import { useHoursStore, totalLeave } from '../../store/useHoursStore'
import { useHoursWeekStore } from '../../store/useHoursWeekStore'
import { useImportStore } from '../../store/useImportStore'
import { useFteStore } from '../../store/useFteStore'
import { useBudgetStore, BUDGET_MONTHS_2026 } from '../../store/useBudgetStore'
import { useFinStore } from '../../store/useFinStore'
import { fmt } from '../../lib/format'
import { getFteLe as sharedGetFteLe } from '../../lib/fteLe'

// ── Capaciteit-budget keys ─ gespiegeld met BudgetsTab ─────────────────────
// Productief / Verlof / Improductief / Ziek per BV per maand worden in
// useBudgetStore.overrides opgeslagen onder deze pseudo-keys.
const CAPACITY_KEYS = [
  { key: 'capacity_productive_pct',     label: 'Productief',   color: 'var(--green)' },
  { key: 'capacity_leave_pct',          label: 'Verlof',       color: '#8b5cf6'      },
  { key: 'capacity_nonproductive_pct',  label: 'Improductief', color: 'var(--amber)' },
  { key: 'capacity_sick_pct',           label: 'Ziek',         color: 'var(--red)'   },
] as const

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

/** Begin- en einddatum (YYYY-MM-DD) van een ISO-week, zodat we ook voor
 *  niet-geüploade weken een datum-range kunnen tonen + de "future"-check
 *  kunnen doen. ISO 8601: dag 4 januari valt altijd in week 1. */
function isoWeekRangeLocal(year: number, week: number): { start: string; end: string } {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = (jan4.getUTCDay() + 6) % 7
  const monday = new Date(jan4)
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + (week - 1) * 7)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  return { start: fmt(monday), end: fmt(sunday) }
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

  // Capaciteit-card: welke BVs uitgeklapt
  const [capExpanded, setCapExpanded] = useState<Set<BvId>>(new Set(['Consultancy']))

  const is2025 = filter.year === '2025'
  // Stores voor de FTE/capaciteit-budget vs actuals card
  const fteEntries = useFteStore(s => s.entries)
  const budgetOverrides = useBudgetStore(s => s.overrides)
  const finalizedMonths = useFinStore(s => s.finalized)
  // Hours-store: geuploade SAP-timesheet data. Override hoursData2026
  // per (bv, maand) waar we een geuploade entry hebben met werkuren > 0.
  const hoursStoreEntries = useHoursStore(s => s.entries)
  // Week-store: nieuwere per-week data uit het v14+ SAP-format. Gebruikt
  // door de detail-tabel in week-mode voor exacte getallen + open
  // missing-hours per week (i.p.v. een geschatte verdeling van maand-data).
  const hoursWeekEntries = useHoursWeekStore(s => s.entries)
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

  // ── Waarde Declarabel YTD (alleen voor de KPI-tegel) ──────────────────
  let ytdWaardeDecl = 0
  for (const r of actualRecords) {
    ytdWaardeDecl += waardeDeclarabel(r.bv, r.month)
  }

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

  // ── FTE / Capaciteit-budget helpers (alleen 2026) ─────────────────────
  // Spiegelt logica uit BudgetsTab (FTE-store + budget_overrides voor
  // capaciteits-%). Actuals komen uit useHoursStore (productive/verlof/
  // improductief/ziek-percentages worden afgeleid uit declarable / vakantie /
  // overigVerlof / internal+missing / ziekte).
  const finalizedSet = useMemo(() => new Set(finalizedMonths.map(f => f.month)), [finalizedMonths])
  const isFinalized = (m: string) => finalizedSet.has(m)

  const getFteBudget = (bv: BvId, m: string): number | undefined =>
    fteEntries.find(e => e.bv === bv && e.month === m)?.fteBudget
  const getFteActual = (bv: BvId, m: string): number | undefined =>
    fteEntries.find(e => e.bv === bv && e.month === m)?.fte

  // ── LE-shifts: bouw één keer per BV de YTD over/under-run vs budget ──
  // FTE: gedeelde helper (`sharedGetFteLe`) — actual als finalized, anders
  // (fteBudget + last-known actual−budget shift) capped op ≥ 0, anders
  // forward-fill. Diezelfde helper wordt ook gebruikt door BudgetsTab,
  // useLatestEstimate en leReflection zodat de FTE-shift consistent
  // doorschuift naar omzet-/kosten-LE.
  //
  // Capaciteit-%: gemiddelde afwijking over alle gesloten maanden waar
  // beide bekend zijn. % wijkt minder explosief af van maand tot maand,
  // dus stabieler om te middelen dan de laatste maand.
  const getCapShift = (bv: BvId, key: string): number => {
    let sum = 0, n = 0
    for (const m of MONTHS_2026) {
      const a = getCapActualPct(bv, m, key)
      const b = getCapBudgetPct(bv, m, key)
      if (a != null && b != null) {
        sum += (a - b)
        n++
      }
    }
    return n > 0 ? sum / n : 0
  }

  const getFteLe = (bv: BvId, m: string): number | undefined =>
    sharedGetFteLe({ entries: fteEntries, bv, month: m, isFinalized })

  const getCapBudgetPct = (bv: BvId, m: string, key: string): number | undefined => {
    const v = budgetOverrides[bv]?.[m]?.[key]
    return v == null || v === 0 ? undefined : v
  }

  // Actuele capaciteit-% afgeleid uit useHoursStore (SAP). Categorieën:
  //   productive    = declarable
  //   leave         = vakantie + overigVerlof
  //   nonproductive = internal + (missing capacity)
  //   sick          = ziekte
  // Noemer = totaal aantal uren (incl. afwezigheid + missing). Dit komt
  // overeen met de berekening in de detailtabel hierboven (zelfde 'totaal').
  const getCapActualPct = (bv: BvId, m: string, key: string): number | undefined => {
    const e = hoursStoreEntries.find(x => x.bv === bv && x.month === m)
    if (!e) return undefined
    const work = e.declarable + e.internal
    const verlof = e.vakantie + e.overigVerlof
    const ziekte = e.ziekte
    // Missing alleen voor Consultancy (zelfde regel als detailtabel)
    const baseRec = hoursData2026.find(r => r.bv === bv && r.month === m)
    const cap = baseRec ? Math.max(baseRec.capacity, work + verlof + ziekte) : work + verlof + ziekte
    const sumKnown = work + verlof + ziekte
    const missing = bv === 'Consultancy' ? Math.max(0, cap - sumKnown) : 0
    const totaal = work + verlof + ziekte + missing
    if (totaal <= 0) return undefined
    let val = 0
    if      (key === 'capacity_productive_pct')    val = e.declarable
    else if (key === 'capacity_leave_pct')         val = verlof
    else if (key === 'capacity_nonproductive_pct') val = e.internal + missing
    else if (key === 'capacity_sick_pct')          val = ziekte
    return (val / totaal) * 100
  }

  // Capaciteit-% LE: closed/finalized → actual; future → budget + gem.
  // YTD-afwijking, geclamped op [0..100]. Hierdoor reflecteert de LE-rij
  // geen 1-op-1 budget meer, maar de richting van de werkelijke realisatie.
  // Voorbeeld: budget productief 85% maar actuals lopen op 82% (-3pp) →
  // LE voor toekomstige maanden ≈ 82% (= 85 - 3).
  const getCapLe = (bv: BvId, m: string, key: string): number | undefined => {
    if (isFinalized(m)) {
      const a = getCapActualPct(bv, m, key)
      if (a != null) return a
    }
    const b = getCapBudgetPct(bv, m, key)
    const shift = getCapShift(bv, key)
    if (b != null) {
      return Math.min(100, Math.max(0, b + shift))
    }
    // Geen budget — toon bij gebrek aan beter de actuele % uit hours-data
    return getCapActualPct(bv, m, key)
  }

  const fmtFte = (v: number | undefined): string =>
    v == null ? '—' : v.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const fmtPct = (v: number | undefined): string =>
    v == null ? '—' : v.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'

  const toggleCap = (bv: BvId) => {
    setCapExpanded(prev => {
      const next = new Set(prev)
      if (next.has(bv)) next.delete(bv); else next.add(bv)
      return next
    })
  }

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

      {/* ── FTE & Capaciteit — Budget vs Actuals (& LE) ── alleen 2026 ── */}
      {!is2025 && activeBvs.length > 0 && (
        <>
          <div style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', marginTop: 4 }}>
            FTE &amp; Capaciteit-budget vs Actuals
            <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: 6, letterSpacing: 0 }}>
              — budget komt uit de Budgetten-tab · actuals uit de Maandafsluiting (FTE) en SAP-uren · LE voor toekomst = budget + gemiddelde YTD afwijking (actual − budget) zodat de LE de werkelijke trend volgt i.p.v. 1-op-1 het budget
            </span>
          </div>
          {activeBvs.map(bv => {
            const isOpen = capExpanded.has(bv)
            // FY-gemiddelden voor de header
            const fyAvgFteB = (() => {
              const xs = MONTHS_2026.map(m => getFteBudget(bv, m)).filter((v): v is number => v != null)
              return xs.length === 0 ? null : xs.reduce((s, v) => s + v, 0) / xs.length
            })()
            const fyAvgFteA = (() => {
              const xs = MONTHS_2026.map(m => getFteActual(bv, m)).filter((v): v is number => v != null)
              return xs.length === 0 ? null : xs.reduce((s, v) => s + v, 0) / xs.length
            })()
            const fyAvgFteLe = (() => {
              const xs = MONTHS_2026.map(m => getFteLe(bv, m)).filter((v): v is number => v != null)
              return xs.length === 0 ? null : xs.reduce((s, v) => s + v, 0) / xs.length
            })()

            return (
              <div key={bv} className="card" style={{ borderLeft: `3px solid ${BV_COLORS[bv]}` }}>
                <div
                  className="card-hdr"
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleCap(bv)}
                  title={isOpen ? 'Klik om in te klappen' : 'Klik om uit te klappen'}
                >
                  <span style={{ fontSize: 10, marginRight: 8, display: 'inline-block', transition: 'transform .2s', transform: isOpen ? 'rotate(90deg)' : 'none' }}>▶</span>
                  <span className="card-title" style={{ color: BV_COLORS[bv] }}>{bv} — Capaciteit</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)', display: 'flex', gap: 14 }}>
                    <span>FY ø FTE B: <strong style={{ color: BV_COLORS[bv] }}>{fmtFte(fyAvgFteB ?? undefined)}</strong></span>
                    <span>A: <strong style={{ color: 'var(--brand)' }}>{fmtFte(fyAvgFteA ?? undefined)}</strong></span>
                    <span>LE: <strong style={{ color: 'var(--amber)' }}>{fmtFte(fyAvgFteLe ?? undefined)}</strong></span>
                  </span>
                </div>
                {isOpen && (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="tbl" style={{ tableLayout: 'fixed', borderCollapse: 'collapse', minWidth: 'max-content', fontSize: 11 }}>
                      <colgroup>
                        <col style={{ width: 200 }} />
                        {BUDGET_MONTHS_2026.map(m => <col key={m} style={{ width: 80 }} />)}
                        <col style={{ width: 90 }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th style={{ position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 2 }}>Regel</th>
                          {BUDGET_MONTHS_2026.map(m => (
                            <th key={m} className="r" style={{ padding: '4px 6px' }}>
                              {m}
                              {isFinalized(m) && <span style={{ marginLeft: 3, fontSize: 8, color: 'var(--brand)' }} title="Afgesloten maand — actuals">✓</span>}
                            </th>
                          ))}
                          <th className="r" style={{ borderLeft: '1px solid var(--bd2)', color: 'var(--brand)' }}>FY ø</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* FTE-blok: Budget / Actual / LE */}
                        {([
                          { label: 'FTE — Budget',  get: (m: string) => getFteBudget(bv, m), color: BV_COLORS[bv], italic: false, bold: true,  bg: 'var(--bg3)' },
                          { label: 'FTE — Actual',  get: (m: string) => getFteActual(bv, m), color: 'var(--brand)', italic: false, bold: true,  bg: 'rgba(0,169,224,.05)' },
                          { label: 'FTE — LE',      get: (m: string) => getFteLe(bv, m),     color: 'var(--amber)', italic: true,  bold: false, bg: 'rgba(245,158,11,.04)' },
                        ] as const).map(row => {
                          const vals = BUDGET_MONTHS_2026.map(m => row.get(m))
                          const filled = vals.filter((v): v is number => v != null)
                          const fy = filled.length === 0 ? null : filled.reduce((s, v) => s + v, 0) / filled.length
                          return (
                            <tr key={row.label} style={{ background: row.bg }}>
                              <td style={{
                                position: 'sticky', left: 0, zIndex: 1, background: row.bg,
                                padding: '4px 12px', fontSize: 11, fontWeight: row.bold ? 700 : 500,
                                color: row.color, fontStyle: row.italic ? 'italic' : 'normal',
                                whiteSpace: 'nowrap',
                              }}>{row.label}</td>
                              {vals.map((v, i) => (
                                <td key={i} className="mono r" style={{
                                  padding: '3px 6px', fontSize: 11,
                                  color: v == null ? 'var(--t3)' : row.color,
                                  fontStyle: row.italic ? 'italic' : 'normal',
                                  fontWeight: row.bold ? 600 : 500,
                                }}>{fmtFte(v)}</td>
                              ))}
                              <td className="mono r" style={{
                                padding: '3px 6px', fontSize: 11, fontWeight: 700,
                                borderLeft: '1px solid var(--bd2)',
                                color: fy == null ? 'var(--t3)' : row.color,
                              }}>{fmtFte(fy ?? undefined)}</td>
                            </tr>
                          )
                        })}
                        {/* Spacer */}
                        <tr><td colSpan={14} style={{ borderTop: '1px solid var(--bd2)', padding: 0, height: 1 }} /></tr>
                        {/* Capaciteit-% blokken: per categorie 3 rijen (B/A/LE) */}
                        {CAPACITY_KEYS.flatMap(cap => ([
                          { label: `${cap.label} % — Budget`, kind: 'B' as const, get: (m: string) => getCapBudgetPct(bv, m, cap.key), italic: false, bold: true,  color: cap.color, bg: 'transparent' },
                          { label: `${cap.label} % — Actual`, kind: 'A' as const, get: (m: string) => getCapActualPct(bv, m, cap.key), italic: false, bold: true,  color: cap.color, bg: 'rgba(0,169,224,.04)' },
                          { label: `${cap.label} % — LE`,     kind: 'LE' as const, get: (m: string) => getCapLe(bv, m, cap.key),       italic: true,  bold: false, color: cap.color, bg: 'rgba(245,158,11,.03)' },
                        ])).map(row => {
                          const vals = BUDGET_MONTHS_2026.map(m => row.get(m))
                          const filled = vals.filter((v): v is number => v != null)
                          const fy = filled.length === 0 ? null : filled.reduce((s, v) => s + v, 0) / filled.length
                          return (
                            <tr key={row.label} style={{ background: row.bg }}>
                              <td style={{
                                position: 'sticky', left: 0, zIndex: 1,
                                background: row.bg === 'transparent' ? 'var(--bg2)' : row.bg,
                                padding: '4px 12px', fontSize: 11, fontWeight: row.bold ? 700 : 500,
                                color: row.color, fontStyle: row.italic ? 'italic' : 'normal',
                                whiteSpace: 'nowrap',
                              }}>{row.label}</td>
                              {vals.map((v, i) => (
                                <td key={i} className="mono r" style={{
                                  padding: '3px 6px', fontSize: 11,
                                  color: v == null ? 'var(--t3)' : row.color,
                                  fontStyle: row.italic ? 'italic' : 'normal',
                                  fontWeight: row.bold ? 600 : 500,
                                  opacity: row.kind === 'LE' ? 0.85 : 1,
                                }}>{fmtPct(v)}</td>
                              ))}
                              <td className="mono r" style={{
                                padding: '3px 6px', fontSize: 11, fontWeight: 700,
                                borderLeft: '1px solid var(--bd2)',
                                color: fy == null ? 'var(--t3)' : row.color,
                              }}>{fmtPct(fy ?? undefined)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}

      {/* Detail table — uren-overzicht per BV (en per week):
            BV · Maand · (Week) · SVW dagen · Decl uren/% · NietDecl uren/% ·
            Verlof uren/% · Ziekte uren/% · Missend uren/% · Totaal uren */}
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">
            Urenverdeling per BV & {period === 'week' ? 'Week' : 'Maand'}
          </span>
          {period === 'week' && hoursWeekEntries.length === 0 && (
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--amber)' }}>
              ⓘ Week-verdeling is geschat — upload het nieuwe per-week SAP-export voor exacte week-cijfers
            </span>
          )}
          {period === 'week' && hoursWeekEntries.length > 0 && (
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--green)' }}>
              ✓ Week-data uit per-week SAP-export · open missing-hours per week zichtbaar
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
                const rows: React.ReactNode[] = []

                const today = new Date()
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
                  // Missende uren: bij voorkeur uit de per-week SAP-data
                  // (sommeer alleen PAST weeks — future weeks tellen niet
                  // als missing-actuals; missing-hours convergeert per
                  // definitie naar 0 aan eind jaar dus géén LE).
                  // Fallback voor maanden zónder week-data:
                  //   - alleen Consultancy & alleen actual maand: capaciteit-formule
                  //   - forecast/future: 0
                  const realWeeksForMonth = hoursWeekEntries.filter(w => w.bv === bv && w.month === r.month)
                  let missing = 0
                  if (realWeeksForMonth.length > 0) {
                    for (const wRec of realWeeksForMonth) {
                      const wEnd = new Date(wRec.weekEnd + 'T23:59:59Z')
                      if (wEnd > today) continue   // skip future weeks
                      missing += wRec.missingHoursOpen
                    }
                    missing = Math.round(missing * 100) / 100
                  } else if (bv === 'Consultancy' && !isForecast) {
                    const sumKnown = decl + nond + verlof + ziekte
                    missing = Math.max(0, r.capacity - sumKnown)
                  }
                  const totaal = decl + nond + verlof + ziekte + missing

                  // SVW dagen: 5 voor een normale werkweek (placeholder tot
                  // SAP-export werkdagen-kolom bevat).
                  const svwDgn = 5

                  // Procent berekeningen (delen op totaal incl. afwezigheid)
                  const pct = (n: number) => totaal > 0 ? (n / totaal * 100).toFixed(1) : '—'

                  if (!isForecast) {
                    totDecl += decl; totND += nond; totVer += verlof; totZk += ziekte; totMs += missing
                  }

                  // Per-week split. Voorkeur: echte SAP-week data uit
                  // useHoursWeekStore voor deze BV+maand. Fallback: schatting
                  // (gelijkmatige verdeling over ISO-weken in de maand).
                  if (period === 'week') {
                    const realWeeks = hoursWeekEntries
                      .filter(w => w.bv === bv && w.month === r.month)
                      .sort((a, b) => a.week - b.week)
                    // Tonen we week-rijen zodra er ÉRGENS in het jaar week-
                    // data is; anders fallt door naar de geschatte split.
                    if (hoursWeekEntries.length > 0) {
                      const fmtH = (v: number): string => {
                        if (v === 0) return '0'
                        return v.toLocaleString('nl-NL', { maximumFractionDigits: 2 })
                      }
                      // Volledige set ISO-weken voor deze maand zodat er geen
                      // gaten ontstaan: weken zonder upload krijgen LE-waardes
                      // op basis van FTE × werkuren-per-week × capaciteit-%-LE
                      // (productief/verlof/improductief/ziek). Hierdoor heeft
                      // ELKE week een gevulde LE-rij, óók als het maand-
                      // totaal nog leeg is (toekomstige maanden zonder data).
                      const isoWeeks = splitMonthIntoWeeks(r.month)
                      const yyyy = 2000 + Number(r.month.slice(-2))
                      const numWeeks = Math.max(1, isoWeeks.length)
                      // Synthese-input: weekcapaciteit + capaciteit-%-LE.
                      // Eén FTE = 40 werkuren per week (NL standaard).
                      const fteLeForMonth = getFteLe(bv, r.month) ?? 0
                      const weeklyCap     = fteLeForMonth * 40
                      const pctOf = (k: string): number => {
                        const v = getCapLe(bv, r.month, k)
                        return v == null ? 0 : v / 100
                      }
                      const synthDecl   = weeklyCap * pctOf('capacity_productive_pct')
                      const synthNond   = weeklyCap * pctOf('capacity_nonproductive_pct')
                      const synthVerlof = weeklyCap * pctOf('capacity_leave_pct')
                      const synthZiekte = weeklyCap * pctOf('capacity_sick_pct')
                      // Fallback: als FTE-LE 0 is en/of capaciteit-% leeg is,
                      // val terug op het maand-totaal / numWeeks (legacy).
                      const useSynth =
                        synthDecl + synthNond + synthVerlof + synthZiekte > 0
                      const fallbackDecl   = decl   / numWeeks
                      const fallbackNond   = nond   / numWeeks
                      const fallbackVerlof = verlof / numWeeks
                      const fallbackZiekte = ziekte / numWeeks
                      for (const wNum of isoWeeks) {
                        const wRec = realWeeks.find(rw => rw.week === wNum)
                        const range = wRec
                          ? { start: wRec.weekStart, end: wRec.weekEnd }
                          : isoWeekRangeLocal(yyyy, wNum)
                        const wEndDate = new Date(range.end + 'T23:59:59Z')
                        const isFutureWeek = wEndDate > today
                        const isLE = !wRec
                        // LE-waardes per categorie. Voor weken zónder upload:
                        // gebruik FTE × cap-% als die ingevuld zijn, anders
                        // de fallback maand/numWeeks.
                        const wDecl   = wRec ? wRec.declarable                    : (useSynth ? synthDecl   : fallbackDecl)
                        const wNond   = wRec ? wRec.internal                      : (useSynth ? synthNond   : fallbackNond)
                        const wVerlof = wRec ? wRec.vakantie + wRec.overigVerlof  : (useSynth ? synthVerlof : fallbackVerlof)
                        const wZiekte = wRec ? wRec.ziekte                        : (useSynth ? synthZiekte : fallbackZiekte)
                        const wMissOpen = wRec ? wRec.missingHoursOpen : 0
                        const wPlanned  = wRec ? wRec.plannedWork      : weeklyCap
                        const wTotaal = wDecl + wNond + wVerlof + wZiekte + wMissOpen
                        const wPct = (n: number) => wTotaal > 0 ? (n / wTotaal * 100).toFixed(1) : '—'
                        const opacity = isFutureWeek ? 0.6 : isLE ? 0.8 : 1
                        rows.push(
                          <tr key={`${bv}-${r.month}-W${wNum}`} className="sub" style={{ opacity }}>
                            <td style={{ color: BV_COLORS[bv], fontWeight: 600 }}>{bv}</td>
                            <td style={{ fontWeight: 500 }}>{r.month}</td>
                            <td style={{ fontWeight: 500, fontStyle: isLE ? 'italic' : 'normal' }} title={`${range.start} t/m ${range.end}${isLE ? ' · LE (geen upload voor deze week)' : ''}`}>
                              W{wNum}
                              {isFutureWeek && <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--amber)' }}>plan</span>}
                              {!isFutureWeek && isLE && <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--amber)' }}>LE</span>}
                            </td>
                            <td className="mono r" style={{ color: 'var(--t3)' }}>5</td>
                            <td className="mono r" style={{ color: 'var(--green)', fontStyle: isLE ? 'italic' : 'normal' }}>{fmtH(wDecl)}</td>
                            <td className="mono r" style={{ color: 'var(--green)', fontStyle: isLE ? 'italic' : 'normal' }}>{wPct(wDecl)}%</td>
                            <td className="mono r" style={{ color: 'var(--amber)', fontStyle: isLE ? 'italic' : 'normal' }}>{fmtH(wNond)}</td>
                            <td className="mono r" style={{ color: 'var(--amber)', fontStyle: isLE ? 'italic' : 'normal' }}>{wPct(wNond)}%</td>
                            <td className="mono r" style={{ color: '#8b5cf6', fontStyle: isLE ? 'italic' : 'normal' }}>{fmtH(wVerlof)}</td>
                            <td className="mono r" style={{ color: '#8b5cf6', fontStyle: isLE ? 'italic' : 'normal' }}>{wPct(wVerlof)}%</td>
                            <td className="mono r" style={{ color: 'var(--red)', fontStyle: isLE ? 'italic' : 'normal' }}>{fmtH(wZiekte)}</td>
                            <td className="mono r" style={{ color: 'var(--red)', fontStyle: isLE ? 'italic' : 'normal' }}>{wPct(wZiekte)}%</td>
                            {/* Missing-hours: alleen voor weken waar we echte
                                upload-data hebben EN week is verlopen. LE-rijen
                                en future weken tonen '—' (convergeert naar 0). */}
                            <td className="mono r"
                                style={{ color: !isFutureWeek && !isLE && wMissOpen > 0 ? 'var(--amber)' : 'var(--t3)' }}
                                title={isFutureWeek
                                  ? 'Toekomstige week — missing-hours wordt pas zichtbaar als de week is verlopen'
                                  : isLE
                                    ? 'Geen SAP-upload voor deze week — geen missing-hours-data beschikbaar'
                                    : `Geplande werktijd: ${fmtH(wPlanned)} u · open missing-hours: ${fmtH(wMissOpen)} u`}>
                              {isFutureWeek || isLE ? '—' : (wMissOpen > 0 ? fmtH(wMissOpen) : '—')}
                            </td>
                            <td className="mono r"
                                style={{ color: !isFutureWeek && !isLE && wMissOpen > 0 ? 'var(--amber)' : 'var(--t3)' }}>
                              {isFutureWeek || isLE ? '—' : (wMissOpen > 0 ? `${wPct(wMissOpen)}%` : '—')}
                            </td>
                            <td className="mono r" style={{ fontWeight: 600, fontStyle: isLE ? 'italic' : 'normal' }}
                                title={wPlanned > 0
                                  ? `Geplande werktijd voor deze week: ${fmtH(wPlanned)} u`
                                  : isLE
                                    ? (useSynth
                                        ? `LE op basis van FTE-LE (${fteLeForMonth.toFixed(1)}) × 40u × capaciteit-% LE`
                                        : 'LE op basis van maand-totaal / aantal weken')
                                    : undefined}>
                              {fmtH(wTotaal)}
                            </td>
                          </tr>
                        )
                      }
                      continue
                    }
                  }

                  // ── Geen week-mode of geen real-data → maand-/geschatte-rij ──
                  const weeks = period === 'week' ? splitMonthIntoWeeks(r.month) : [null]
                  for (let wi = 0; wi < weeks.length; wi++) {
                    const w = weeks[wi]
                    const div = period === 'week' ? weeks.length : 1
                    const sd = period === 'week' ? svwDgn / div : svwDgn
                    rows.push(
                      <tr key={`${bv}-${r.month}-${w ?? 'm'}`} className="sub" style={{ opacity: isForecast ? 0.55 : 1 }}>
                        <td style={{ color: BV_COLORS[bv], fontWeight: 600 }}>{bv}</td>
                        <td style={{ fontWeight: 500 }}>{r.month}{isForecast && <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--t3)' }}>FC</span>}{isCurrent && <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--amber)' }}>lopend</span>}</td>
                        {period === 'week' && <td style={{ fontWeight: 500 }}>W{w}{period === 'week' && <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--amber)' }} title="Geschat — geen per-week SAP-data voor deze maand">≈</span>}</td>}
                        <td className="mono r" style={{ color: 'var(--t3)' }}>{Math.round(sd * 10) / 10}</td>
                        <td className="mono r" style={{ color: 'var(--green)' }}>{Math.round(decl / div).toLocaleString('nl-NL')}</td>
                        <td className="mono r" style={{ color: 'var(--green)' }}>{pct(decl)}%</td>
                        <td className="mono r" style={{ color: 'var(--amber)' }}>{Math.round(nond / div).toLocaleString('nl-NL')}</td>
                        <td className="mono r" style={{ color: 'var(--amber)' }}>{pct(nond)}%</td>
                        <td className="mono r" style={{ color: '#8b5cf6' }}>{Math.round(verlof / div).toLocaleString('nl-NL')}</td>
                        <td className="mono r" style={{ color: '#8b5cf6' }}>{pct(verlof)}%</td>
                        <td className="mono r" style={{ color: 'var(--red)' }}>{Math.round(ziekte / div).toLocaleString('nl-NL')}</td>
                        <td className="mono r" style={{ color: 'var(--red)' }}>{pct(ziekte)}%</td>
                        {/* Missing-hours niet voor forecast/LE: convergeert naar 0
                            aan eind jaar — alleen actuals tonen. */}
                        <td className="mono r" style={{ color: !isForecast && missing > 0 ? 'var(--amber)' : 'var(--t3)' }}>
                          {isForecast || missing <= 0 ? '—' : (missing % 1 === 0 ? Math.round(missing / div).toLocaleString('nl-NL') : (missing / div).toLocaleString('nl-NL', { maximumFractionDigits: 2 }))}
                        </td>
                        <td className="mono r" style={{ color: !isForecast && missing > 0 ? 'var(--amber)' : 'var(--t3)' }}>
                          {isForecast || missing <= 0 ? '—' : `${pct(missing)}%`}
                        </td>
                        <td className="mono r" style={{ fontWeight: 600 }}>{Math.round(totaal / div).toLocaleString('nl-NL')}</td>
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
                  </tr>
                )
                return rows
              })}
            </tbody>
          </table>
        </div>
        {period === 'week' && (
          <div style={{ padding: '8px 14px', fontSize: 10, color: 'var(--t3)', borderTop: '1px solid var(--bd2)' }}>
            {hoursWeekEntries.length > 0
              ? <>
                  ✓ Per-week getallen komen rechtstreeks uit de SAP-export (Kalenderjaar/-week + Missing Hours kolom).
                  Open missing-hours per week = <code>geplande werktijd</code> minus geregistreerde uren in die week.
                  Weken zonder upload-data tonen <em>cursief</em> met label <strong>LE</strong> — die zijn afgeleid uit het maand-totaal (gelijkmatig over de weken verdeeld).
                  Toekomstige weken (label "plan") tonen de pre-registered vakantie/ziekte; missing-hours zijn alleen beschikbaar voor afgesloten weken met SAP-upload.
                </>
              : <>
                  ⓘ Geen per-week SAP-export geüpload — de getoonde week-verdeling is een gelijkmatige split van de maand-totalen.
                  Upload het nieuwe per-week formaat (Kalenderjaar/-week + Missing Hours kolom) voor exacte week-cijfers.
                </>}
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
