import { useState, useEffect, useMemo } from 'react'
import { Bar, Line } from 'react-chartjs-2'
import '../../lib/chartSetup'
import { ytdActuals2025 } from '../../data/plData'
import { monthlyActuals2025, monthlyBudget2025, MONTHS_2025_LABELS } from '../../data/plData2025'
import type { EntityName } from '../../data/plData'
import { hoursData2026, hoursData2025, MONTHS_2025, ACTUAL_MONTHS } from '../../data/hoursData'
import { fmt } from '../../lib/format'
import type { BvId, ClosingBv, GlobalFilter } from '../../data/types'
import { useAdjustedActuals } from '../../hooks/useAdjustedActuals'
import { useLatestEstimate } from '../../hooks/useLatestEstimate'
import { useOhwStore } from '../../store/useOhwStore'
import { useBudgetStore, BUDGET_MONTHS_2026 } from '../../store/useBudgetStore'
import { derivePL } from '../../lib/plDerive'

const BVS: BvId[] = ['Consultancy', 'Projects', 'Software']

const BV_COLORS: Record<ClosingBv, string> = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
  Holdings:    '#8fa3c0',
}

interface BvFilterPillProps {
  active: boolean
  color?: string
  label: string
  sub?: string
  onClick: () => void
}
function BvFilterPill({ active, color, label, sub, onClick }: BvFilterPillProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 12px', borderRadius: 7,
        fontSize: 12, fontWeight: active ? 700 : 500,
        cursor: 'pointer',
        fontFamily: 'var(--font)',
        border: '1px solid',
        borderColor: active ? (color ?? 'var(--bd3)') : 'var(--bd2)',
        background: active
          ? color ? color + '22' : 'var(--bg4)'
          : 'var(--bg2)',
        color: active ? (color ?? 'var(--t1)') : 'var(--t2)',
        transition: 'all .12s',
      }}
    >
      {color && (
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: active ? color : 'var(--t3)',
          flexShrink: 0,
        }} />
      )}
      <span>{label}</span>
      {sub && (
        <span style={{ fontSize: 10, opacity: 0.7, fontWeight: 500 }}>· {sub}</span>
      )}
    </button>
  )
}

const ACTUAL_PERIODS_2026 = ['Jan-26', 'Feb-26', 'Mar-26']

interface KpiCardProps {
  label: string
  value: string
  sub?: string
  color?: string
  trend?: number  // positive = green, negative = red
  trendLabel?: string
}
function KpiCard({ label, value, sub, color, trend, trendLabel }: KpiCardProps) {
  const trendColor = trend == null ? undefined : trend >= 0 ? 'var(--green)' : 'var(--red)'
  const trendArrow = trend == null ? '' : trend >= 0 ? '▲' : '▼'
  return (
    <div className="card" style={{ flex: 1, minWidth: 175 }}>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: color ?? 'var(--t1)', fontFamily: 'var(--mono)', letterSpacing: '-.5px' }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 4 }}>{sub}</div>}
        {trend != null && (
          <div style={{ fontSize: 11, color: trendColor, marginTop: 3, fontWeight: 600 }}>
            {trendArrow} {Math.abs(trend).toFixed(1)}% {trendLabel ?? ''}
          </div>
        )}
      </div>
    </div>
  )
}

interface FindingProps {
  type: 'good' | 'warn' | 'bad' | 'info'
  title: string
  body: string
}
function Finding({ type, title, body }: FindingProps) {
  const colors = {
    good: { bg: 'var(--bd-green)',  bd: 'var(--green)',  fg: 'var(--green)',  ic: '✓' },
    warn: { bg: 'var(--bd-amber)',  bd: 'var(--amber)',  fg: 'var(--amber)',  ic: '⚠' },
    bad:  { bg: 'var(--bd-red)',    bd: 'var(--red)',    fg: 'var(--red)',    ic: '⊗' },
    info: { bg: 'var(--bd-blue)',   bd: 'var(--blue)',   fg: 'var(--blue)',   ic: 'ℹ' },
  }[type]
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 7,
      background: colors.bg, border: `1px solid ${colors.bd}`,
      display: 'flex', gap: 10, alignItems: 'flex-start',
    }}>
      <span style={{ color: colors.fg, fontSize: 14, fontWeight: 700, lineHeight: 1.2 }}>{colors.ic}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: colors.fg, marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--t2)', lineHeight: 1.5 }}>{body}</div>
      </div>
    </div>
  )
}

interface Props {
  filter: GlobalFilter
  onNav: (tab: 'ohw') => void
  onFilterChange?: (patch: Partial<GlobalFilter>) => void
}

type ViewMode = 'monthly' | 'ytd'

export function DashboardTab({ filter, onNav, onFilterChange }: Props) {
  const is2025 = filter.year === '2025'
  const ACTUAL_PERIODS = is2025 ? MONTHS_2025_LABELS : ACTUAL_PERIODS_2026

  const [period, setPeriod] = useState<string>('Mar-26')
  const [viewMode, setViewMode] = useState<ViewMode>('monthly')

  useEffect(() => {
    setPeriod(is2025 ? 'Dec-25' : 'Mar-26')
  }, [is2025])

  // 'all' = de drie productie-BV's (klassieke geconsolideerde view).
  // Holdings selecteer je apart om te focussen op de overhead-kosten.
  const activeBvs: ClosingBv[] =
    filter.bv === 'all'
      ? (BVS as ClosingBv[])
      : [filter.bv as ClosingBv]
  const isHoldings = filter.bv === 'Holdings'

  const { getMonthly, getYtd } = useAdjustedActuals()
  const le = useLatestEstimate()

  const getBudgetMonth = useBudgetStore(s => s.getMonth)
  useBudgetStore(s => s.overrides)
  useBudgetStore(s => s.leOverrides)
  const budget2026 = (bv: ClosingBv, month: string, key: string): number => {
    const raw = getBudgetMonth(bv as EntityName, month)
    return derivePL(k => raw[k] ?? 0, key)
  }

  // OHW
  const ohwData2026 = useOhwStore(s => s.data2026)
  const MONTH_CODES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const nowDate = new Date()
  const nowMonthIdx = nowDate.getMonth()
  const nowYear     = nowDate.getFullYear()
  const isClosedOhwMonth = (m: string): boolean => {
    const [mmm, yy] = m.split('-')
    const y = 2000 + Number(yy)
    const mi = MONTH_CODES.indexOf(mmm)
    if (y < nowYear) return true
    if (y > nowYear) return false
    return mi < nowMonthIdx
  }
  const closedOhwMonths = ohwData2026.allMonths.filter(isClosedOhwMonth)
  const wipByMonth: Record<string, number> = {}
  const ohwEntitiesFiltered = filter.bv === 'all'
    ? ohwData2026.entities
    : ohwData2026.entities.filter(e => e.entity === filter.bv)
  for (const m of closedOhwMonths) {
    wipByMonth[m] = ohwEntitiesFiltered.reduce((sum, e) => sum + (e.totaalOnderhanden[m] ?? 0), 0)
  }

  // ── Data selection: monthly or YTD ──────────────────────────────────────
  const getActuals = (bv: ClosingBv, key: string): number => {
    if (is2025) {
      if (viewMode === 'ytd') return ytdActuals2025[bv as EntityName]?.[key] ?? 0
      return monthlyActuals2025[bv as EntityName]?.[period]?.[key] ?? 0
    }
    if (viewMode === 'ytd') return getYtd(bv, ACTUAL_MONTHS)[key] ?? 0
    return getMonthly(bv, period)[key] ?? 0
  }
  const getBudget = (bv: ClosingBv, key: string): number => {
    if (is2025) {
      if (viewMode === 'ytd') return ytdActuals2025[bv as EntityName]?.[key] ?? 0
      return monthlyBudget2025[bv as EntityName]?.[period]?.[key] ?? 0
    }
    if (viewMode === 'ytd') {
      return ACTUAL_MONTHS.reduce((s, m) => s + budget2026(bv, m, key), 0)
    }
    return budget2026(bv, period, key)
  }
  const getPY = (bv: ClosingBv, key: string): number => {
    if (is2025) return 0
    if (viewMode === 'ytd') {
      const py25 = ACTUAL_PERIODS_2026.map(m => m.replace('-26', '-25'))
      return py25.reduce((s, m) => s + (monthlyActuals2025[bv as EntityName]?.[m]?.[key] ?? 0), 0)
    }
    const py = period.replace('-26', '-25')
    return monthlyActuals2025[bv as EntityName]?.[py]?.[key] ?? 0
  }
  // FY 2026 LE / Budget — over alle 12 maanden
  const fyLe = (bv: ClosingBv, key: string): number =>
    is2025 ? 0 : le.fyLE(bv as EntityName, key)
  const fyBudget = (bv: ClosingBv, key: string): number =>
    is2025
      ? 0
      : BUDGET_MONTHS_2026.reduce((s, m) => s + budget2026(bv, m, key), 0)

  // ── Aggregate KPIs over BVs ──────────────────────────────────────────────
  let totalRevenue = 0, totalMargin = 0, totalEbitda = 0,
      totalBudgetRev = 0, totalPyRev = 0
  for (const bv of activeBvs) {
    totalRevenue    += getActuals(bv, 'netto_omzet')
    totalMargin     += getActuals(bv, 'brutomarge')
    totalEbitda     += getActuals(bv, 'ebitda')
    totalBudgetRev  += getBudget(bv, 'netto_omzet')
    totalPyRev      += getPY(bv, 'netto_omzet')
  }
  const marginPct = totalRevenue > 0 ? (totalMargin / totalRevenue * 100) : 0
  const ebitdaPct = totalRevenue > 0 ? (totalEbitda / totalRevenue * 100) : 0
  const revVsBudget = totalBudgetRev > 0 ? (totalRevenue - totalBudgetRev) : 0
  const revVsBudgetPct = totalBudgetRev > 0 ? ((totalRevenue / totalBudgetRev - 1) * 100) : 0
  const revVsPyPct = totalPyRev > 0 ? ((totalRevenue / totalPyRev - 1) * 100) : 0

  // ── FY LE & Budget per BV-aggregaat ──
  const fyLeRev    = activeBvs.reduce((s, bv) => s + fyLe(bv, 'netto_omzet'), 0)
  const fyBudgetRev = activeBvs.reduce((s, bv) => s + fyBudget(bv, 'netto_omzet'), 0)
  const fyLeEbitda = activeBvs.reduce((s, bv) => s + fyLe(bv, 'ebitda'), 0)
  const fyBudEbitda = activeBvs.reduce((s, bv) => s + fyBudget(bv, 'ebitda'), 0)
  const leBudgetGap = fyLeRev - fyBudgetRev
  const leBudgetGapPct = fyBudgetRev !== 0 ? (leBudgetGap / Math.abs(fyBudgetRev) * 100) : 0
  const ebitdaGap = fyLeEbitda - fyBudEbitda

  // ── Hours ────────────────────────────────────────────────────────────────
  const hoursData = is2025 ? hoursData2025 : hoursData2026
  const hRecords = hoursData.filter(r =>
    (filter.bv === 'all' || r.bv === filter.bv) &&
    (viewMode === 'ytd' ? r.type === 'actual' : r.month === period)
  )
  const totalWritten = hRecords.reduce((a, r) => a + r.written, 0)
  const totalDecl    = hRecords.reduce((a, r) => a + r.declarable, 0)
  const declPct      = totalWritten > 0 ? (totalDecl / totalWritten * 100) : 0

  // ── WIP ──────────────────────────────────────────────────────────────────
  const wipTotal = wipByMonth[period] ?? 0
  const prevPeriod = ACTUAL_PERIODS[ACTUAL_PERIODS.indexOf(period) - 1]
  const wipPrev  = prevPeriod ? (wipByMonth[prevPeriod] ?? 0) : 0
  const wipDelta = wipTotal - wipPrev

  // ── Charts: Actual + LE forecast trend ───────────────────────────────────
  const trendChart = useMemo(() => {
    if (is2025) {
      return {
        labels: MONTHS_2025,
        datasets: activeBvs.map(bv => ({
          label: bv,
          data: MONTHS_2025.map(m => (monthlyActuals2025[bv as EntityName]?.[m]?.['netto_omzet'] ?? 0) / 1000),
          borderColor: BV_COLORS[bv],
          backgroundColor: BV_COLORS[bv] + '18',
          tension: 0.3, fill: true, pointRadius: 4,
          pointBackgroundColor: BV_COLORS[bv],
        })),
      }
    }
    // 2026: actuals (solid) Jan→last-closed + LE forecast (dashed) forward
    const lastClosedIdx = (() => {
      let idx = -1
      for (let i = 0; i < BUDGET_MONTHS_2026.length; i++) {
        if (le.isClosed(BUDGET_MONTHS_2026[i])) idx = i
      }
      return idx
    })()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const datasets: any[] = []
    for (const bv of activeBvs) {
      const actData = BUDGET_MONTHS_2026.map((m, i) =>
        i <= lastClosedIdx ? (getMonthly(bv, m)['netto_omzet'] ?? 0) / 1000 : null
      )
      const leData = BUDGET_MONTHS_2026.map((m, i) =>
        // Verbind het laatste actual-punt met de eerste LE-punt door op laatste
        // closed-index ook de waarde te tonen (visuele continuïteit).
        i >= lastClosedIdx ? le.getLE(bv as EntityName, m, 'netto_omzet') / 1000 : null
      )
      datasets.push({
        label: `${bv} — Actual`,
        data: actData,
        borderColor: BV_COLORS[bv],
        backgroundColor: BV_COLORS[bv] + '18',
        tension: 0.3, fill: false, pointRadius: 4, borderWidth: 2.5,
        pointBackgroundColor: BV_COLORS[bv],
      })
      datasets.push({
        label: `${bv} — LE`,
        data: leData,
        borderColor: BV_COLORS[bv],
        borderDash: [5, 4],
        backgroundColor: 'transparent',
        tension: 0.3, fill: false, pointRadius: 3, borderWidth: 2,
        pointStyle: 'rectRot' as const,
        pointBackgroundColor: BV_COLORS[bv],
      })
    }
    return { labels: BUDGET_MONTHS_2026, datasets }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [is2025, JSON.stringify(activeBvs), period, useBudgetStore(s => s.leOverrides), useBudgetStore(s => s.overrides)])

  // ── Cumulative omzet vs budget ──────────────────────────────────────────
  const cumulativeChart = useMemo(() => {
    if (is2025) {
      // Cumulatieve actuals 2025 vs cumulative budget 2025
      let cActual = 0, cBudget = 0
      const actData: number[] = []
      const budData: number[] = []
      for (const m of MONTHS_2025_LABELS) {
        const a = activeBvs.reduce((s, bv) => s + (monthlyActuals2025[bv as EntityName]?.[m]?.['netto_omzet'] ?? 0), 0)
        const b = activeBvs.reduce((s, bv) => s + (monthlyBudget2025[bv as EntityName]?.[m]?.['netto_omzet'] ?? 0), 0)
        cActual += a; cBudget += b
        actData.push(cActual / 1000)
        budData.push(cBudget / 1000)
      }
      return {
        labels: MONTHS_2025_LABELS,
        datasets: [
          { label: 'Actual cumulatief', data: actData, borderColor: '#00a9e0', backgroundColor: '#00a9e022', borderWidth: 2.5, tension: 0.3, fill: true, pointRadius: 3 },
          { label: 'Budget cumulatief', data: budData, borderColor: '#fbbf24', backgroundColor: 'transparent', borderDash: [6, 4], borderWidth: 2, tension: 0.3, fill: false, pointRadius: 2 },
        ],
      }
    }
    // 2026: cumulatief LE (combineert actuals + forecast) vs cumulatief budget
    let cLe = 0, cBudget = 0
    const leData: number[] = []
    const budData: number[] = []
    for (const m of BUDGET_MONTHS_2026) {
      const lev = activeBvs.reduce((s, bv) => s + le.getLE(bv as EntityName, m, 'netto_omzet'), 0)
      const bv2 = activeBvs.reduce((s, bv) => s + budget2026(bv, m, 'netto_omzet'), 0)
      cLe += lev; cBudget += bv2
      leData.push(cLe / 1000)
      budData.push(cBudget / 1000)
    }
    return {
      labels: BUDGET_MONTHS_2026,
      datasets: [
        { label: 'LE cumulatief (Actual + Forecast)', data: leData, borderColor: '#00a9e0', backgroundColor: '#00a9e022', borderWidth: 2.5, tension: 0.3, fill: true, pointRadius: 3 },
        { label: 'Budget cumulatief', data: budData, borderColor: '#fbbf24', backgroundColor: 'transparent', borderDash: [6, 4], borderWidth: 2, tension: 0.3, fill: false, pointRadius: 2 },
      ],
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [is2025, JSON.stringify(activeBvs), useBudgetStore(s => s.leOverrides), useBudgetStore(s => s.overrides)])

  // ── Brutomarge% per BV trend ─────────────────────────────────────────────
  const marginTrendChart = useMemo(() => {
    if (is2025) {
      return {
        labels: MONTHS_2025_LABELS,
        datasets: activeBvs.map(bv => ({
          label: bv,
          data: MONTHS_2025_LABELS.map(m => {
            const r = monthlyActuals2025[bv as EntityName]?.[m]?.['netto_omzet'] ?? 0
            const g = monthlyActuals2025[bv as EntityName]?.[m]?.['brutomarge'] ?? 0
            return r > 0 ? (g / r * 100) : 0
          }),
          borderColor: BV_COLORS[bv],
          backgroundColor: 'transparent',
          tension: 0.3, fill: false, pointRadius: 3, borderWidth: 2,
        })),
      }
    }
    // 2026: marge% over alle 12 maanden, actual+LE
    return {
      labels: BUDGET_MONTHS_2026,
      datasets: activeBvs.map(bv => ({
        label: bv,
        data: BUDGET_MONTHS_2026.map(m => {
          const r = le.getLE(bv as EntityName, m, 'netto_omzet')
          const g = le.getLE(bv as EntityName, m, 'brutomarge')
          return r > 0 ? (g / r * 100) : 0
        }),
        borderColor: BV_COLORS[bv],
        backgroundColor: 'transparent',
        tension: 0.3, fill: false, pointRadius: 3, borderWidth: 2,
      })),
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [is2025, JSON.stringify(activeBvs), useBudgetStore(s => s.leOverrides), useBudgetStore(s => s.overrides)])

  // ── EBITDA per BV (LE vs Budget) FY ──────────────────────────────────────
  const ebitdaCompareChart = {
    labels: activeBvs,
    datasets: [
      {
        label: 'FY LE',
        data: activeBvs.map(bv => fyLe(bv, 'ebitda') / 1000),
        backgroundColor: activeBvs.map(bv => BV_COLORS[bv]),
        borderRadius: 4, borderSkipped: false,
      },
      {
        label: 'FY Budget',
        data: activeBvs.map(bv => fyBudget(bv, 'ebitda') / 1000),
        backgroundColor: activeBvs.map(bv => BV_COLORS[bv] + '44'),
        borderColor: activeBvs.map(bv => BV_COLORS[bv] + '88'),
        borderWidth: 1, borderRadius: 4, borderSkipped: false,
      },
    ],
  }

  // ── Bar chart: omzet per BV (period) ─────────────────────────────────────
  const revenueByBvData = {
    labels: activeBvs,
    datasets: [
      {
        label: 'Netto-omzet',
        data: activeBvs.map(bv => getActuals(bv, 'netto_omzet') / 1000),
        backgroundColor: activeBvs.map(bv => BV_COLORS[bv]),
        borderRadius: 4, borderSkipped: false,
      },
      {
        label: 'Budget',
        data: activeBvs.map(bv => getBudget(bv, 'netto_omzet') / 1000),
        backgroundColor: activeBvs.map(bv => BV_COLORS[bv] + '33'),
        borderColor: activeBvs.map(bv => BV_COLORS[bv] + '88'),
        borderWidth: 1, borderRadius: 4, borderSkipped: false,
      },
    ],
  }

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#8fa3c0', font: { family: 'Inter', size: 11 }, boxWidth: 10 } },
      tooltip: {
        backgroundColor: '#0c1120',
        borderColor: 'rgba(255,255,255,0.15)',
        borderWidth: 1,
        titleColor: '#edf1fc',
        bodyColor: '#8fa3c0',
        callbacks: { label: (ctx: { dataset: { label?: string }; parsed: { y: number | null } }) => ` ${ctx.dataset.label}: € ${(ctx.parsed.y ?? 0).toFixed(0)}k` },
      },
    },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#52657e', font: { family: 'Inter', size: 10 } } },
      y: {
        grid: { color: 'rgba(255,255,255,0.06)' },
        ticks: { color: '#52657e', font: { family: 'Inter', size: 10 }, callback: (v: number | string) => `€${v}k` },
      },
    },
  }
  const pctChartOpts = {
    ...chartOpts,
    scales: {
      ...chartOpts.scales,
      y: {
        ...chartOpts.scales.y,
        ticks: { ...chartOpts.scales.y.ticks, callback: (v: number | string) => `${v}%` },
      },
    },
  }

  // ── Auto-bevindingen — view-mode bewust ──────────────────────────────────
  // YTD-mode → cumulatieve signalen.
  // Monthly-mode → signalen voor de geselecteerde maand (period).
  type Finding = { type: 'good' | 'warn' | 'bad' | 'info'; title: string; body: string }
  const findingsView = viewMode  // alias zodat dep-array eenduidig is
  const findings = useMemo(() => {
    const out: Finding[] = []
    if (is2025) return out
    // Voor Holdings (kosten-only) maakt omzet-vs-budget weinig zin; we focussen
    // dan op kosten-afwijkingen en EBITDA-impact.
    const bvsToScan = activeBvs

    if (findingsView === 'ytd') {
      // ── YTD findings ──
      const ytdActual: Record<string, number> = {}
      const ytdBudget: Record<string, number> = {}
      const ytdMargin: Record<string, number> = {}
      const ytdEbitda: Record<string, number> = {}
      const ytdBudEbitda: Record<string, number> = {}
      for (const bv of bvsToScan) {
        const a = getYtd(bv, ACTUAL_MONTHS)
        ytdActual[bv]    = a['netto_omzet'] ?? 0
        ytdMargin[bv]    = a['brutomarge'] ?? 0
        ytdEbitda[bv]    = a['ebitda'] ?? 0
        ytdBudget[bv]    = ACTUAL_MONTHS.reduce((s, m) => s + budget2026(bv, m, 'netto_omzet'), 0)
        ytdBudEbitda[bv] = ACTUAL_MONTHS.reduce((s, m) => s + budget2026(bv, m, 'ebitda'), 0)
      }
      const ytdActualTotal = bvsToScan.reduce((s, bv) => s + ytdActual[bv], 0)
      const ytdBudgetTotal = bvsToScan.reduce((s, bv) => s + ytdBudget[bv], 0)
      const ytdEbitdaTotal = bvsToScan.reduce((s, bv) => s + ytdEbitda[bv], 0)
      const ytdBudEbitdaTotal = bvsToScan.reduce((s, bv) => s + ytdBudEbitda[bv], 0)

      if (!isHoldings) {
        const revGap = ytdActualTotal - ytdBudgetTotal
        const revGapPct = ytdBudgetTotal > 0 ? (revGap / ytdBudgetTotal * 100) : 0
        if (Math.abs(revGapPct) > 1) {
          out.push({
            type: revGap >= 0 ? 'good' : 'bad',
            title: revGap >= 0 ? `YTD-omzet ${revGapPct.toFixed(1)}% boven budget` : `YTD-omzet ${Math.abs(revGapPct).toFixed(1)}% achter op budget`,
            body: `Cumulatief Q1: ${fmt(ytdActualTotal)} vs budget ${fmt(ytdBudgetTotal)}. ${revGap >= 0 ? 'Voorsprong' : 'Achterstand'}: ${fmt(Math.abs(revGap))}.`,
          })
        }

        const bvDeltas = bvsToScan.map(bv => {
          const d = ytdActual[bv] - ytdBudget[bv]
          const dPct = ytdBudget[bv] > 0 ? (d / ytdBudget[bv] * 100) : 0
          return { bv, d, dPct }
        }).sort((a, b) => Math.abs(b.dPct) - Math.abs(a.dPct))
        for (const item of bvDeltas.slice(0, 2)) {
          if (Math.abs(item.dPct) > 3) {
            out.push({
              type: item.d >= 0 ? 'good' : 'warn',
              title: `${item.bv}: ${item.dPct >= 0 ? '+' : ''}${item.dPct.toFixed(1)}% vs budget YTD`,
              body: `${item.bv} ${item.d >= 0 ? 'overtreft' : 'blijft achter op'} het budget met ${fmt(Math.abs(item.d))} cumulatief.`,
            })
          }
        }

        for (const bv of bvsToScan) {
          const r = ytdActual[bv]
          const g = ytdMargin[bv]
          const m = r > 0 ? g / r * 100 : 0
          const budR = ytdBudget[bv]
          const budG = ACTUAL_MONTHS.reduce((s, mn) => s + budget2026(bv, mn, 'brutomarge'), 0)
          const budM = budR > 0 ? budG / budR * 100 : 0
          const delta = m - budM
          if (Math.abs(delta) > 2 && r > 0) {
            out.push({
              type: delta >= 0 ? 'good' : 'bad',
              title: `${bv} brutomarge ${m.toFixed(1)}% (budget ${budM.toFixed(1)}%)`,
              body: delta >= 0
                ? `${bv} draait ${delta.toFixed(1)} pp boven plan. Stuur op vasthouden van mix en uurtarieven.`
                : `${bv} levert ${Math.abs(delta).toFixed(1)} pp marge in. Onderzoek directe kosten / declarabelheid.`,
            })
          }
        }
      }

      // EBITDA delta — voor zowel productie-BVs als Holdings relevant
      const ebitGap = ytdEbitdaTotal - ytdBudEbitdaTotal
      if (Math.abs(ebitGap) > 50000) {
        out.push({
          type: ebitGap >= 0 ? 'good' : 'bad',
          title: `EBITDA YTD ${ebitGap >= 0 ? '+' : ''}${fmt(ebitGap)} vs budget`,
          body: `Operationele winstgevendheid loopt ${ebitGap >= 0 ? 'voor' : 'achter'}. Q1-actual ${fmt(ytdEbitdaTotal)} vs plan ${fmt(ytdBudEbitdaTotal)}.`,
        })
      }

      // Holdings: directe kostenafwijking signaleren
      if (isHoldings) {
        const ytdOpex = activeBvs.reduce((s, bv) => s + (getYtd(bv, ACTUAL_MONTHS)['operationele_kosten'] ?? 0), 0)
        const budOpex = activeBvs.reduce((s, bv) => s + ACTUAL_MONTHS.reduce((ss, m) => ss + budget2026(bv, m, 'operationele_kosten'), 0), 0)
        const opexDelta = ytdOpex - budOpex
        if (Math.abs(opexDelta) > 30000) {
          out.push({
            type: opexDelta <= 0 ? 'good' : 'warn',
            title: `Holdings opex ${opexDelta <= 0 ? 'onder' : 'boven'} budget: ${fmt(Math.abs(opexDelta))}`,
            body: `Operationele kosten YTD ${fmt(ytdOpex)} vs plan ${fmt(budOpex)}. Voor Holdings is dit hét stuur-signaal.`,
          })
        }
      }

      // Forward-looking
      if (!isHoldings && Math.abs(leBudgetGapPct) > 2 && fyBudgetRev > 0) {
        out.push({
          type: leBudgetGap >= 0 ? 'good' : 'bad',
          title: `FY-LE ${leBudgetGap >= 0 ? '+' : ''}${leBudgetGapPct.toFixed(1)}% vs FY-budget`,
          body: `Latest Estimate FY 2026: ${fmt(fyLeRev)} (budget ${fmt(fyBudgetRev)}). ${leBudgetGap >= 0 ? 'Plan-overtreffen — accountable voor commit.' : 'Bijsturen vereist; review forecast in Budgetten-tab en pas LE-overrides aan.'}`,
        })
      }
      if (ebitdaGap < -100000) {
        out.push({
          type: 'bad',
          title: `FY-EBITDA loopt achter: ${fmt(ebitdaGap)}`,
          body: `LE FY EBITDA ${fmt(fyLeEbitda)} vs plan ${fmt(fyBudEbitda)}. Kosten + omzetdrivers herzien voor herstel.`,
        })
      }
    } else {
      // ── Monthly findings — voor de geselecteerde maand ──
      const curM  = period
      const idx   = ACTUAL_MONTHS.indexOf(curM)
      const prevM = idx > 0 ? ACTUAL_MONTHS[idx - 1] : null

      const curRev  = bvsToScan.reduce((s, bv) => s + (getMonthly(bv, curM)['netto_omzet'] ?? 0), 0)
      const curBud  = bvsToScan.reduce((s, bv) => s + budget2026(bv, curM, 'netto_omzet'), 0)
      const curEbi  = bvsToScan.reduce((s, bv) => s + (getMonthly(bv, curM)['ebitda'] ?? 0), 0)
      const curBudE = bvsToScan.reduce((s, bv) => s + budget2026(bv, curM, 'ebitda'), 0)

      if (!isHoldings) {
        // MoM verschil
        if (prevM) {
          const prevRev = bvsToScan.reduce((s, bv) => s + (getMonthly(bv, prevM)['netto_omzet'] ?? 0), 0)
          const momGap = curRev - prevRev
          const momGapPct = prevRev > 0 ? (momGap / prevRev * 100) : 0
          if (Math.abs(momGapPct) > 3) {
            out.push({
              type: momGap >= 0 ? 'good' : 'warn',
              title: `${curM} omzet ${momGap >= 0 ? '+' : ''}${momGapPct.toFixed(1)}% MoM`,
              body: `${curM}: ${fmt(curRev)} vs ${prevM}: ${fmt(prevRev)} (${momGap >= 0 ? '+' : ''}${fmt(momGap)}).`,
            })
          }
        }
        // vs budget
        const budGap = curRev - curBud
        if (Math.abs(budGap) > 30000 && curBud !== 0) {
          const pct = curBud !== 0 ? (budGap / Math.abs(curBud) * 100) : 0
          out.push({
            type: budGap >= 0 ? 'good' : 'bad',
            title: `${curM} omzet: ${budGap >= 0 ? '+' : ''}${fmt(budGap)} vs budget`,
            body: `Maandbudget ${fmt(curBud)}, actual ${fmt(curRev)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%).`,
          })
        }
        // vs vorig jaar
        const py = curM.replace('-26', '-25')
        const pyRev = bvsToScan.reduce((s, bv) => s + (monthlyActuals2025[bv as EntityName]?.[py]?.['netto_omzet'] ?? 0), 0)
        if (pyRev > 0) {
          const yoy = curRev - pyRev
          const yoyPct = (yoy / pyRev * 100)
          if (Math.abs(yoyPct) > 2) {
            out.push({
              type: yoy >= 0 ? 'good' : 'warn',
              title: `${curM} vs ${py}: ${yoy >= 0 ? '+' : ''}${yoyPct.toFixed(1)}% YoY`,
              body: `Volume ${yoy >= 0 ? 'groeit' : 'krimpt'} met ${fmt(Math.abs(yoy))} t.o.v. dezelfde maand vorig jaar.`,
            })
          }
        }
        // Per-BV variance voor deze maand
        const bvDeltas = bvsToScan.map(bv => {
          const a = getMonthly(bv, curM)['netto_omzet'] ?? 0
          const b = budget2026(bv, curM, 'netto_omzet')
          const d = a - b
          const dPct = b !== 0 ? (d / Math.abs(b) * 100) : 0
          return { bv, a, b, d, dPct }
        }).sort((a, b) => Math.abs(b.dPct) - Math.abs(a.dPct))
        for (const item of bvDeltas.slice(0, 2)) {
          if (Math.abs(item.dPct) > 4 && Math.abs(item.d) > 20000) {
            out.push({
              type: item.d >= 0 ? 'good' : 'warn',
              title: `${item.bv} ${curM}: ${item.dPct >= 0 ? '+' : ''}${item.dPct.toFixed(1)}% vs budget`,
              body: `Actual ${fmt(item.a)} vs budget ${fmt(item.b)} (${fmt(item.d)}).`,
            })
          }
        }
        // OHW mutatie deze maand
        const wipCur  = wipByMonth[curM] ?? 0
        const wipPrev = prevM ? (wipByMonth[prevM] ?? 0) : 0
        const wipChg  = wipCur - wipPrev
        if (Math.abs(wipChg) > 200000 && wipPrev !== 0) {
          out.push({
            type: wipChg > 0 ? 'warn' : 'good',
            title: `OHW-mutatie ${curM}: ${wipChg >= 0 ? '+' : ''}${fmt(wipChg)}`,
            body: wipChg > 0
              ? `OHW loopt op naar ${fmt(wipCur)}. Check of facturatie-cyclus achterloopt.`
              : `OHW daalt naar ${fmt(wipCur)} — facturatiestroom is op gang.`,
          })
        }
        // Declarabelheid deze maand
        const decRec = hoursData2026.filter(r =>
          r.month === curM && (filter.bv === 'all' || r.bv === filter.bv)
        )
        const dW = decRec.reduce((a, r) => a + r.written, 0)
        const dD = decRec.reduce((a, r) => a + r.declarable, 0)
        const dPct = dW > 0 ? dD / dW * 100 : 0
        if (dPct > 0 && dPct < 75) {
          out.push({
            type: 'warn',
            title: `Declarabelheid ${dPct.toFixed(1)}% in ${curM}`,
            body: `Onder de 75%-streefnorm. Per BV evalueren waar de niet-declarabele uren naartoe gaan.`,
          })
        }
      }

      // EBITDA delta voor de maand (ook voor Holdings)
      const ebiGap = curEbi - curBudE
      if (Math.abs(ebiGap) > 30000) {
        out.push({
          type: ebiGap >= 0 ? 'good' : 'bad',
          title: `${curM} EBITDA ${ebiGap >= 0 ? '+' : ''}${fmt(ebiGap)} vs budget`,
          body: `Actual ${fmt(curEbi)} vs plan ${fmt(curBudE)}.`,
        })
      }

      // Holdings: opex-delta voor de maand
      if (isHoldings) {
        const curOpex = bvsToScan.reduce((s, bv) => s + (getMonthly(bv, curM)['operationele_kosten'] ?? 0), 0)
        const budOpex = bvsToScan.reduce((s, bv) => s + budget2026(bv, curM, 'operationele_kosten'), 0)
        const opDelta = curOpex - budOpex
        if (Math.abs(opDelta) > 20000) {
          out.push({
            type: opDelta <= 0 ? 'good' : 'warn',
            title: `Holdings opex ${curM}: ${opDelta <= 0 ? 'onder' : 'boven'} budget`,
            body: `Operationele kosten ${fmt(curOpex)} vs budget ${fmt(budOpex)} (${fmt(opDelta)}).`,
          })
        }
      }
    }

    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [is2025, period, findingsView, useBudgetStore(s => s.leOverrides), useBudgetStore(s => s.overrides), JSON.stringify(activeBvs), isHoldings, fyLeRev, fyBudgetRev, fyLeEbitda, fyBudEbitda, leBudgetGap, leBudgetGapPct, ebitdaGap])

  const periodLabel = viewMode === 'ytd' ? `YTD ${ACTUAL_MONTHS[ACTUAL_MONTHS.length-1]}` : period

  return (
    <div className="page">
      {/* Eigen BV-filter rij — duidelijker dan alleen de Topbar; ondersteunt
          ook Holdings (overhead/kosten-only) als aparte view. */}
      {onFilterChange && (
        <div className="card" style={{ padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.1em', marginRight: 4 }}>
              BV-filter
            </span>
            <BvFilterPill
              active={filter.bv === 'all'}
              label="Alle BV's"
              sub="Cons + Proj + Soft"
              onClick={() => onFilterChange({ bv: 'all' })}
            />
            {(['Consultancy', 'Projects', 'Software'] as ClosingBv[]).map(bv => (
              <BvFilterPill
                key={bv}
                active={filter.bv === bv}
                color={BV_COLORS[bv]}
                label={bv}
                onClick={() => onFilterChange({ bv })}
              />
            ))}
            <BvFilterPill
              active={filter.bv === 'Holdings'}
              color={BV_COLORS.Holdings}
              label="Holdings"
              sub="alleen kosten / overhead"
              onClick={() => onFilterChange({ bv: 'Holdings' })}
            />
          </div>
        </div>
      )}

      {/* Period / view selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="tabs-row">
          <button className={`tab${viewMode === 'monthly' ? ' active' : ''}`} onClick={() => setViewMode('monthly')}>Maandelijks</button>
          <button className={`tab${viewMode === 'ytd' ? ' active' : ''}`} onClick={() => setViewMode('ytd')}>YTD</button>
        </div>
        {viewMode === 'monthly' && (
          <div style={{ display: 'flex', gap: 4 }}>
            {ACTUAL_PERIODS.map(p => (
              <button
                key={p}
                className={`btn sm${period === p ? ' primary' : ' ghost'}`}
                onClick={() => setPeriod(p)}
              >{p}</button>
            ))}
          </div>
        )}
        {filter.bv !== 'all' && (
          <span style={{ marginLeft: 8, fontSize: 11, color: BV_COLORS[filter.bv as ClosingBv] ?? 'var(--blue)', background: BV_COLORS[filter.bv as ClosingBv] + '22', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
            {filter.bv}{isHoldings ? ' · kosten' : ''}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)' }}>
          {viewMode === 'ytd' ? `YTD t/m ${ACTUAL_MONTHS[ACTUAL_MONTHS.length-1]}` : period}
        </span>
      </div>

      {/* KPI tiles — period view */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KpiCard
          label="Netto-omzet"
          value={fmt(totalRevenue)}
          sub={revVsBudget !== 0
            ? `${revVsBudget >= 0 ? '+' : ''}${fmt(revVsBudget)} vs budget`
            : 'vs budget: —'}
          trend={totalBudgetRev > 0 ? revVsBudgetPct : undefined}
          trendLabel="vs budget"
        />
        <KpiCard
          label="Brutomarge"
          value={fmt(totalMargin)}
          sub={`${marginPct.toFixed(1)}% van omzet`}
          color={totalMargin >= 0 ? 'var(--green)' : 'var(--red)'}
        />
        <KpiCard
          label="EBITDA"
          value={fmt(totalEbitda)}
          sub={`${ebitdaPct.toFixed(1)}% van omzet`}
          color={totalEbitda >= 0 ? 'var(--green)' : 'var(--red)'}
        />
        <KpiCard
          label="Geschreven uren"
          value={totalWritten.toLocaleString('nl-NL')}
          sub={`${declPct.toFixed(1)}% declarabel`}
        />
        <KpiCard
          label="OHW totaal"
          value={fmt(wipTotal)}
          sub={prevPeriod ? (wipDelta >= 0 ? `▲ ${fmt(wipDelta)} vs ${prevPeriod}` : `▼ ${fmt(Math.abs(wipDelta))} vs ${prevPeriod}`) : undefined}
          color={wipDelta >= 0 ? 'var(--amber)' : 'var(--green)'}
        />
        {!is2025 && totalPyRev > 0 && (
          <KpiCard
            label="vs Vorig jaar"
            value={`${revVsPyPct >= 0 ? '+' : ''}${revVsPyPct.toFixed(1)}%`}
            sub={`${fmt(totalRevenue - totalPyRev)} verschil`}
            color={revVsPyPct >= 0 ? 'var(--green)' : 'var(--red)'}
          />
        )}
      </div>

      {/* FY 2026 Latest Estimate tiles — alleen 2026 */}
      {!is2025 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '.1em' }}>📈 FY 2026 — Latest Estimate</span>
            <span style={{ fontSize: 10, color: 'var(--t3)' }}>actual t/m laatst gesloten + LE / budget voor de rest</span>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <KpiCard
              label="FY LE Netto-omzet"
              value={fmt(fyLeRev)}
              sub={`Budget ${fmt(fyBudgetRev)}`}
              trend={fyBudgetRev !== 0 ? leBudgetGapPct : undefined}
              trendLabel="vs budget"
            />
            <KpiCard
              label="Δ LE vs Budget"
              value={`${leBudgetGap >= 0 ? '+' : ''}${fmt(leBudgetGap)}`}
              sub={`${leBudgetGapPct >= 0 ? '+' : ''}${leBudgetGapPct.toFixed(1)}% commit-spread`}
              color={leBudgetGap >= 0 ? 'var(--green)' : 'var(--red)'}
            />
            <KpiCard
              label="FY LE EBITDA"
              value={fmt(fyLeEbitda)}
              sub={`Budget ${fmt(fyBudEbitda)}`}
              color={fyLeEbitda >= 0 ? 'var(--green)' : 'var(--red)'}
            />
            <KpiCard
              label="Δ LE-EBITDA vs Budget"
              value={`${ebitdaGap >= 0 ? '+' : ''}${fmt(ebitdaGap)}`}
              sub={fyBudEbitda !== 0 ? `${(ebitdaGap / Math.abs(fyBudEbitda) * 100).toFixed(1)}%` : undefined}
              color={ebitdaGap >= 0 ? 'var(--green)' : 'var(--red)'}
            />
            <KpiCard
              label="Te realiseren Q2-Q4"
              value={fmt(fyLeRev - totalRevenue)}
              sub={`${BUDGET_MONTHS_2026.length - ACTUAL_MONTHS.length} maanden te gaan`}
            />
          </div>
        </>
      )}

      {/* Bevindingen — view-mode aware: YTD-panel als YTD-filter actief is,
          maand-panel als Maandelijks actief is (en dan voor de geselecteerde maand). */}
      {!is2025 && (
        <div className="card">
          <div className="card-hdr">
            <span className="card-title">
              {viewMode === 'ytd'
                ? '🎯 Opvallende bevindingen — YTD'
                : `📅 Opvallende bevindingen — ${period}`}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>
              {findings.length} signal{findings.length === 1 ? '' : 'en'}
              {filter.bv !== 'all' ? ` · ${filter.bv}` : ''}
            </span>
          </div>
          <div style={{ padding: 14, display: 'grid', gridTemplateColumns: findings.length > 1 ? '1fr 1fr' : '1fr', gap: 8 }}>
            {findings.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--t3)', textAlign: 'center', padding: 16, gridColumn: '1 / -1' }}>
                {viewMode === 'ytd'
                  ? 'YTD ligt in lijn met plan — geen signalen om op te sturen.'
                  : `Geen significante afwijkingen voor ${period}.`}
              </div>
            )}
            {findings.map((f, i) => <Finding key={i} {...f} />)}
          </div>
        </div>
      )}

      {/* Charts row 1: trend + cumulative */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="card">
          <div className="card-hdr">
            <span className="card-title">{is2025 ? 'Omzet trend FY 2025' : 'Omzet trend — Actual + Latest Estimate'}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>€k · BV-niveau</span>
          </div>
          <div style={{ padding: 16, height: 260 }}>
            <Line data={trendChart} options={chartOpts as Parameters<typeof Line>[0]['options']} />
          </div>
        </div>
        <div className="card">
          <div className="card-hdr">
            <span className="card-title">Cumulatief: {is2025 ? 'Actual vs Budget' : 'LE vs Budget'}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>€k · YTD-tot-Dec</span>
          </div>
          <div style={{ padding: 16, height: 260 }}>
            <Line data={cumulativeChart} options={chartOpts as Parameters<typeof Line>[0]['options']} />
          </div>
        </div>
      </div>

      {/* Charts row 2: marge%-trend + EBITDA LE vs Budget */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="card">
          <div className="card-hdr">
            <span className="card-title">Brutomarge % per BV</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>%</span>
          </div>
          <div style={{ padding: 16, height: 240 }}>
            <Line data={marginTrendChart} options={pctChartOpts as Parameters<typeof Line>[0]['options']} />
          </div>
        </div>
        <div className="card">
          <div className="card-hdr">
            <span className="card-title">{is2025 ? 'Omzet & Budget per BV' : 'EBITDA: FY LE vs FY Budget per BV'}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>€k</span>
          </div>
          <div style={{ padding: 16, height: 240 }}>
            <Bar data={is2025 ? revenueByBvData : ebitdaCompareChart} options={chartOpts as Parameters<typeof Bar>[0]['options']} />
          </div>
        </div>
      </div>

      {/* Bar: omzet per BV (period) — alleen tonen in 2026 (in 2025 staat ie al boven) */}
      {!is2025 && (
        <div className="card">
          <div className="card-hdr">
            <span className="card-title">Omzet & Budget per BV — {periodLabel}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>€k</span>
          </div>
          <div style={{ padding: 16, height: 240 }}>
            <Bar data={revenueByBvData} options={chartOpts as Parameters<typeof Bar>[0]['options']} />
          </div>
        </div>
      )}

      {/* BV performance table met budget + LE + vorig jaar */}
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">BV Overzicht — {periodLabel}</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ minWidth: 140 }}>BV</th>
                <th className="r">Netto-omzet</th>
                <th className="r">Budget</th>
                <th className="r">Δ Budget</th>
                {!is2025 && <th className="r">VJ {viewMode === 'ytd' ? 'YTD 2025' : period.replace('-26', '-25')}</th>}
                {!is2025 && <th className="r">Δ VJ</th>}
                <th className="r">Brutomarge</th>
                <th className="r">Marge %</th>
                <th className="r">EBITDA</th>
                {!is2025 && <th className="r">FY LE</th>}
                {!is2025 && <th className="r">FY Budget</th>}
              </tr>
            </thead>
            <tbody>
              {activeBvs.map(bv => {
                const rev    = getActuals(bv, 'netto_omzet')
                const gm     = getActuals(bv, 'brutomarge')
                const ebitda = getActuals(bv, 'ebitda')
                const bud    = getBudget(bv, 'netto_omzet')
                const py     = getPY(bv, 'netto_omzet')
                const deltaBud = rev - bud
                const deltaPy  = rev - py
                const pct    = rev > 0 ? gm / rev * 100 : 0
                const fyLeBv = !is2025 ? fyLe(bv, 'netto_omzet') : 0
                const fyBdBv = !is2025 ? fyBudget(bv, 'netto_omzet') : 0
                return (
                  <tr key={bv}>
                    <td>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: BV_COLORS[bv], marginRight: 6 }} />
                      <strong>{bv}</strong>
                    </td>
                    <td className="mono r">{fmt(rev)}</td>
                    <td className="mono r" style={{ color: 'var(--t3)' }}>{fmt(bud)}</td>
                    <td className="mono r" style={{ color: deltaBud >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                      {deltaBud >= 0 ? '+' : ''}{fmt(deltaBud)}
                    </td>
                    {!is2025 && <td className="mono r" style={{ color: 'var(--t3)' }}>{fmt(py)}</td>}
                    {!is2025 && <td className="mono r" style={{ color: deltaPy >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {deltaPy >= 0 ? '+' : ''}{fmt(deltaPy)}
                    </td>}
                    <td className="mono r" style={{ color: gm >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{fmt(gm)}</td>
                    <td className="mono r" style={{ color: pct >= 30 ? 'var(--green)' : pct >= 20 ? 'var(--amber)' : 'var(--red)' }}>{pct.toFixed(1)}%</td>
                    <td className="mono r" style={{ color: ebitda >= 0 ? 'var(--t1)' : 'var(--red)' }}>{fmt(ebitda)}</td>
                    {!is2025 && <td className="mono r" style={{ color: 'var(--blue)', fontWeight: 600 }}>{fmt(fyLeBv)}</td>}
                    {!is2025 && <td className="mono r" style={{ color: 'var(--t3)' }}>{fmt(fyBdBv)}</td>}
                  </tr>
                )
              })}
              {activeBvs.length > 1 && (() => {
                let rT = 0, gT = 0, eT = 0, bT = 0, pyT = 0, leT = 0, fbT = 0
                for (const bv of activeBvs) {
                  rT  += getActuals(bv, 'netto_omzet')
                  gT  += getActuals(bv, 'brutomarge')
                  eT  += getActuals(bv, 'ebitda')
                  bT  += getBudget(bv, 'netto_omzet')
                  pyT += getPY(bv, 'netto_omzet')
                  if (!is2025) {
                    leT += fyLe(bv, 'netto_omzet')
                    fbT += fyBudget(bv, 'netto_omzet')
                  }
                }
                const pT = rT > 0 ? gT / rT * 100 : 0
                const dB = rT - bT, dPy = rT - pyT
                return (
                  <tr className="tot">
                    <td>Totaal</td>
                    <td className="mono r">{fmt(rT)}</td>
                    <td className="mono r" style={{ color: 'var(--t3)' }}>{fmt(bT)}</td>
                    <td className="mono r" style={{ color: dB >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{dB >= 0 ? '+' : ''}{fmt(dB)}</td>
                    {!is2025 && <td className="mono r" style={{ color: 'var(--t3)' }}>{fmt(pyT)}</td>}
                    {!is2025 && <td className="mono r" style={{ color: dPy >= 0 ? 'var(--green)' : 'var(--red)' }}>{dPy >= 0 ? '+' : ''}{fmt(dPy)}</td>}
                    <td className="mono r" style={{ color: 'var(--green)', fontWeight: 700 }}>{fmt(gT)}</td>
                    <td className="mono r" style={{ color: 'var(--green)', fontWeight: 700 }}>{pT.toFixed(1)}%</td>
                    <td className="mono r">{fmt(eT)}</td>
                    {!is2025 && <td className="mono r" style={{ color: 'var(--blue)', fontWeight: 700 }}>{fmt(leT)}</td>}
                    {!is2025 && <td className="mono r" style={{ color: 'var(--t3)', fontWeight: 700 }}>{fmt(fbT)}</td>}
                  </tr>
                )
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* OHW + Validatie row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="card">
          <div className="card-hdr"><span className="card-title">Onderhanden werk (OHW)</span></div>
          <div style={{ padding: 16 }}>
            <div style={{ display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
              {Object.entries(wipByMonth).map(([m, v]) => (
                <div key={m}>
                  <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 2 }}>{m}</div>
                  <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: m === period ? 'var(--amber)' : 'var(--t1)' }}>{fmt(v)}</div>
                </div>
              ))}
            </div>
            <button className="btn sm" onClick={() => onNav('ohw')}>→ OHW Overzicht openen</button>
          </div>
        </div>

        <div className="card">
          <div className="card-hdr"><span className="card-title">Validatie & Health</span></div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { ok: totalRevenue > 0,          msg: `Omzet aanwezig (${periodLabel})` },
              { ok: marginPct > 0,             msg: `Brutomarge positief (${marginPct.toFixed(1)}%)` },
              { ok: ebitdaPct > 5,             msg: `EBITDA-marge gezond (${ebitdaPct.toFixed(1)}%)` },
              { ok: declPct > 70,              msg: `Declarabelheid > 70% (${declPct.toFixed(1)}%)` },
              { ok: wipTotal === 0 || wipTotal < 3000000, msg: `OHW binnen acceptabele bandbreedte (${fmt(wipTotal)})` },
              { ok: revVsBudget >= 0 || totalBudgetRev === 0, msg: `Omzet ${revVsBudget >= 0 ? 'op of boven' : 'onder'} budget (${revVsBudgetPct >= 0 ? '+' : ''}${revVsBudgetPct.toFixed(1)}%)` },
              ...(!is2025 ? [{ ok: leBudgetGap >= 0, msg: `FY-LE ${leBudgetGap >= 0 ? 'overtreft' : 'achter op'} budget (${leBudgetGapPct >= 0 ? '+' : ''}${leBudgetGapPct.toFixed(1)}%)` }] : []),
            ].map((v, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 }}>
                <span style={{ color: v.ok ? 'var(--green)' : 'var(--amber)', fontSize: 13 }}>{v.ok ? '✓' : '⚠'}</span>
                <span style={{ color: v.ok ? 'var(--t2)' : 'var(--amber)' }}>{v.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Budget overzicht detailtabel */}
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">Budget{!is2025 ? ' & Vorig Jaar' : ''} Vergelijking — {periodLabel}</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ minWidth: 160 }}>BV / KPI</th>
                {activeBvs.map(bv => (
                  <th key={bv} className="r" style={{ minWidth: 130 }}>
                    <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: BV_COLORS[bv], marginRight: 5 }} />
                    {bv}
                  </th>
                ))}
                {activeBvs.length > 1 && <th className="r" style={{ minWidth: 120 }}>Totaal</th>}
              </tr>
            </thead>
            <tbody>
              {[
                { key: 'netto_omzet',   label: 'Netto-omzet' },
                { key: 'brutomarge',    label: 'Brutomarge' },
                { key: 'ebitda',        label: 'EBITDA' },
              ].map(({ key, label }) => {
                const actVals  = activeBvs.map(bv => getActuals(bv, key))
                const budVals  = activeBvs.map(bv => getBudget(bv, key))
                const pyVals   = activeBvs.map(bv => getPY(bv, key))
                const actTot   = actVals.reduce((a, v) => a + v, 0)
                const budTot   = budVals.reduce((a, v) => a + v, 0)
                const pyTot    = pyVals.reduce((a, v) => a + v, 0)
                return [
                  <tr key={`${key}-act`} style={{ background: 'var(--bg2)' }}>
                    <td style={{ padding: '5px 10px' }}>{label} — Actueel</td>
                    {actVals.map((v, i) => <td key={i} className="mono r" style={{ fontWeight: 600 }}>{fmt(v)}</td>)}
                    {activeBvs.length > 1 && <td className="mono r" style={{ fontWeight: 700 }}>{fmt(actTot)}</td>}
                  </tr>,
                  <tr key={`${key}-bud`} style={{ background: 'transparent' }}>
                    <td style={{ padding: '5px 10px', paddingLeft: 22, color: 'var(--t3)', fontSize: 11 }}>Budget</td>
                    {budVals.map((v, i) => <td key={i} className="mono r" style={{ color: 'var(--t3)', fontSize: 11 }}>{fmt(v)}</td>)}
                    {activeBvs.length > 1 && <td className="mono r" style={{ color: 'var(--t3)', fontSize: 11 }}>{fmt(budTot)}</td>}
                  </tr>,
                  <tr key={`${key}-delta`} style={{ background: 'transparent' }}>
                    <td style={{ padding: '5px 10px', paddingLeft: 22, color: 'var(--t3)', fontSize: 11 }}>Δ Budget</td>
                    {actVals.map((v, i) => {
                      const d = v - budVals[i]
                      return <td key={i} className="mono r" style={{ fontSize: 11, color: d >= 0 ? 'var(--green)' : 'var(--red)' }}>{d >= 0 ? '+' : ''}{fmt(d)}</td>
                    })}
                    {activeBvs.length > 1 && (() => {
                      const d = actTot - budTot
                      return <td className="mono r" style={{ fontSize: 11, color: d >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{d >= 0 ? '+' : ''}{fmt(d)}</td>
                    })()}
                  </tr>,
                  !is2025 && <tr key={`${key}-py`} style={{ background: 'transparent', borderBottom: '1px solid var(--bd)' }}>
                    <td style={{ padding: '5px 10px', paddingLeft: 22, color: 'var(--t3)', fontSize: 11 }}>Vorig jaar</td>
                    {pyVals.map((v, i) => <td key={i} className="mono r" style={{ color: 'var(--t3)', fontSize: 11 }}>{fmt(v)}</td>)}
                    {activeBvs.length > 1 && <td className="mono r" style={{ color: 'var(--t3)', fontSize: 11 }}>{fmt(pyTot)}</td>}
                  </tr>,
                ]
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
