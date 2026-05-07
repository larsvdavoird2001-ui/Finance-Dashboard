import { useState, useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import '../../lib/chartSetup'
import { baseChartOptions } from '../../lib/chartSetup'
import { useFteStore } from '../../store/useFteStore'
import { useBudgetStore, BUDGET_MONTHS_2026 } from '../../store/useBudgetStore'
import { useFinStore } from '../../store/useFinStore'
import { useLockedBv } from '../../lib/permissions'
import {
  verticalsForBv,
  snapshotActuals,
  VERTICALS,
  VERTICAL_COLORS,
  type Vertical,
} from '../../lib/verticals'
import { PERSON_SPEC_MONTH, PERSON_SPEC_SNAPSHOT_DATE } from '../../data/personSpec'
import type { EntityName } from '../../data/plData'
import type { BvId, FteBv, FteEntry } from '../../data/types'

const ENTITIES: EntityName[] = ['Consultancy', 'Projects', 'Software', 'Holdings']

const BV_COLORS: Record<string, string> = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
  Holdings:    '#8fa3c0',
}

// Capaciteit-% pseudo-keys (gedeeld met BudgetsTab — uitgesplitst hier zodat
// dit bestand zelf-bevattend is). Worden persisted via useBudgetStore.overrides.
const CAPACITY_KEYS = [
  { key: 'capacity_productive_pct',     label: 'Productief %',   color: 'var(--green)' },
  { key: 'capacity_leave_pct',          label: 'Verlof %',       color: 'var(--blue)'  },
  { key: 'capacity_nonproductive_pct',  label: 'Improductief %', color: 'var(--amber)' },
  { key: 'capacity_sick_pct',           label: 'Ziek %',         color: 'var(--red)'   },
] as const

/** Generieke decimaal-input — kopie van BudgetsTab's NumberInput. Hier gerepliceerd
 *  zodat dit subtab-bestand standalone is (geen circulaire import). */
function NumberInput({
  value,
  onCommit,
  suffix,
  highlight,
  decimals = 1,
  width = 75,
}: {
  value: number | undefined
  onCommit: (v: number | undefined) => void
  suffix?: string
  highlight?: boolean
  decimals?: number
  width?: number
}) {
  const [raw, setRaw] = useState<string | null>(null)
  const editing = raw !== null
  const display = editing
    ? raw
    : (value == null
        ? ''
        : value.toLocaleString('nl-NL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + (suffix ?? ''))
  const commit = () => {
    if (raw === null) return
    const trimmed = raw.replace(suffix ?? '', '').replace(/\s/g, '').replace(',', '.').trim()
    if (trimmed === '') {
      if (value != null) onCommit(undefined)
    } else {
      const v = parseFloat(trimmed)
      if (!isNaN(v) && v !== value) onCommit(v)
    }
    setRaw(null)
  }
  return (
    <input
      className="ohw-inp"
      value={display}
      placeholder="—"
      style={{
        width, fontSize: 11, padding: '2px 6px',
        textAlign: 'right',
        fontFamily: 'var(--mono)',
        color: value == null ? 'var(--t3)' : highlight ? 'var(--green)' : 'var(--t1)',
        background: highlight ? 'rgba(38,201,151,.05)' : 'var(--bg1)',
        border: '1px solid transparent',
        borderRadius: 3,
      }}
      onFocus={e => {
        setRaw(value == null ? '' : String(value))
        setTimeout(() => e.target.select(), 0)
      }}
      onChange={e => setRaw(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          setRaw(null)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

function fmtFte(v: number | undefined | null): string {
  if (v == null) return '—'
  return v.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}
function fmtHc(v: number | undefined | null): string {
  if (v == null) return '—'
  return String(Math.round(v))
}

export function BudgetsFteSubtab() {
  const fteEntries  = useFteStore(s => s.entries)
  const fteUpsert   = useFteStore(s => s.upsertEntry)
  const store       = useBudgetStore()
  const lockedBv    = useLockedBv()
  const finalized   = useFinStore(s => s.finalized)

  const months = BUDGET_MONTHS_2026
  const activeEntities: EntityName[] = lockedBv
    ? (ENTITIES.includes(lockedBv as EntityName) ? [lockedBv as EntityName] : [])
    : ENTITIES

  // Closed-detectie identiek aan BudgetsTab (Financieel): alleen wanneer de
  // Maandafsluiting voor die maand definitief is. Gebruikt door de LE-logica
  // om actuals (gefinaliseerd) te onderscheiden van forecast.
  const finalizedSet = useMemo(() => new Set(finalized.map(f => f.month)), [finalized])
  const isClosedMonth = (m: string) => finalizedSet.has(m)

  // ── Lookups ──────────────────────────────────────────────────────────
  /** BV-totaal (vertical=undefined) entry. */
  const getTotalEntry = (bv: FteBv, m: string) =>
    fteEntries.find(e => e.bv === bv && e.month === m && !e.vertical)
  const getVerticalEntry = (bv: FteBv, vertical: Vertical, m: string) =>
    fteEntries.find(e => e.bv === bv && e.month === m && e.vertical === vertical)

  const getFteBudget       = (bv: FteBv, m: string) => getTotalEntry(bv, m)?.fteBudget
  const getFteBudgetVert   = (bv: FteBv, v: Vertical, m: string) => getVerticalEntry(bv, v, m)?.fteBudget

  const setFteBudget       = (bv: FteBv, m: string, v: number | undefined) =>
    fteUpsert(bv, m, { fteBudget: v })
  const setFteBudgetVert   = (bv: FteBv, vert: Vertical, m: string, v: number | undefined) =>
    fteUpsert(bv as BvId, m, { fteBudget: v }, vert)

  // Capaciteit-% (per BV, opgeslagen in useBudgetStore.overrides)
  const getCapacityPct = (e: EntityName, m: string, k: string): number | undefined => {
    const ov = store.overrides[e]?.[m]?.[k]
    return ov === undefined ? undefined : ov
  }
  const setCapacityPct = (e: EntityName, m: string, k: string, v: number | undefined) => {
    if (v === undefined) {
      store.setValue(e, m, k, 0)
    } else {
      store.setValue(e, m, k, v)
    }
  }
  const capacityTotal = (e: EntityName, m: string): number =>
    CAPACITY_KEYS.reduce((s, c) => s + (getCapacityPct(e, m, c.key) ?? 0), 0)

  // ── Helpers voor verschil-rij (Σ verticals vs totaal) ─────────────────
  const vertSum = (bv: FteBv, m: string): number | null => {
    const verts = verticalsForBv(bv)
    if (verts.length === 0) return null
    const vals = verts
      .map(v => getVerticalEntry(bv, v, m)?.fteBudget)
      .filter((x): x is number => x != null)
    if (vals.length === 0) return null
    return vals.reduce((s, v) => s + v, 0)
  }

  // ── FY-totaal helpers ────────────────────────────────────────────────
  const fyAvgFteBudget = (bv: FteBv): number => {
    const total = months.reduce((s, m) => s + (getFteBudget(bv, m) ?? 0), 0)
    return total / 12
  }

  // ── Actuals + LE-helpers voor de chart (alleen FTE) ──────────────────
  // De chart toont uitsluitend FTE — headcount kent geen budget meer en
  // wordt alleen als actual ingevoerd in de Maandafsluiting. We spiegelen
  // hetzelfde "shift"-mechaniek als getFteLe in lib/fteLe, maar met een
  // aparte tak voor vertical-rijen:
  //   - finalized maand met actual → actual
  //   - manueel ingevoerde actual voor toekomst → die actual (override)
  //   - budget aanwezig → max(0, budget + lastDelta)
  //                       waar lastDelta = laatst-bekende (actual − budget)
  //   - anders → forward-fill van laatste actual.

  /** Vind een entry binnen de fte-store voor een specifieke (BV, maand,
   *  optionele vertical). vertical=undefined ⇒ BV-totaal. */
  const findEntry = (bv: FteBv, m: string, vertical?: Vertical): FteEntry | undefined =>
    fteEntries.find(e =>
      e.bv === bv && e.month === m
      && (vertical ? e.vertical === vertical : !e.vertical),
    )

  const getActual = (bv: FteBv, m: string, vertical?: Vertical): number | undefined =>
    findEntry(bv, m, vertical)?.fte
  const getBudgetVal = (bv: FteBv, m: string, vertical?: Vertical): number | undefined =>
    findEntry(bv, m, vertical)?.fteBudget

  /** Laatste bekende delta (actual − budget) voor (bv, vertical) over alle 2026-maanden. */
  const getShift = (bv: FteBv, vertical?: Vertical): number => {
    let lastDelta = 0
    for (const m of months) {
      const a = getActual(bv, m, vertical)
      const b = getBudgetVal(bv, m, vertical)
      if (a != null && a > 0 && b != null && b > 0) {
        lastDelta = a - b
      }
    }
    return lastDelta
  }

  /** Latest Estimate FTE per (bv, maand, optionele vertical). */
  const getLeVal = (bv: FteBv, m: string, vertical?: Vertical): number | undefined => {
    const cur = findEntry(bv, m, vertical)
    const a = cur?.fte
    if (isClosedMonth(m) && a != null) return a
    if (a != null) return a // user-override voor toekomst
    const b = cur?.fteBudget
    if (b != null) {
      return Math.max(0, b + getShift(bv, vertical))
    }
    // Forward-fill: laatste eerdere actual
    const idx = months.indexOf(m)
    for (let i = idx - 1; i >= 0; i--) {
      const prev = findEntry(bv, months[i], vertical)
      if (prev?.fte != null) return prev.fte
    }
    return undefined
  }

  // ── Chart-state ──────────────────────────────────────────────────────
  // Twee onafhankelijke filter-rijen: BVs + verticals. De grafiek toont één
  // lijn per (BV × vertical) combinatie waar een dataset bij hoort. "Totaal"
  // = BV-niveau (vertical=undefined). Holdings + een specifieke vertical
  // levert geen lijn op (Holdings heeft geen vertical-breakdown).
  type VerticalKey = Vertical | 'Totaal'
  const ALL_VERTICAL_KEYS: VerticalKey[] = ['Totaal', ...VERTICALS]
  const [chartBvs,       setChartBvs]      = useState<Set<FteBv>>(new Set(activeEntities as FteBv[]))
  const [chartVerticals, setChartVerticals] = useState<Set<VerticalKey>>(new Set(['Totaal']))
  const [showBudget,     setShowBudget]    = useState<boolean>(true)
  const [showLe,         setShowLe]        = useState<boolean>(true)
  const [showActual,     setShowActual]    = useState<boolean>(true)

  /** Welke verticals binnen een BV daadwerkelijk in personSpec voorkomen.
   *  Voor het renderen van vertical-lijnen die "niet bestaan" voor die BV
   *  hebben we niet per se data nodig (user kan toch budgetten); maar voor
   *  Holdings + vertical sluiten we hard af want Holdings is geen
   *  vertical-BV. */
  const isVerticalApplicable = (bv: FteBv, vk: VerticalKey): boolean => {
    if (vk === 'Totaal') return true
    if (bv === 'Holdings') return false
    return verticalsForBv(bv).includes(vk)
  }

  /** Helper: numeriek of null voor de Y-as. Chart.js negeert null waardes
   *  zodat ontbrekende maanden geen "nul-knik" geven. */
  const valOrNull = (v: number | undefined): number | null => v == null ? null : v

  const chartData = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const datasets: any[] = []
    const bvs = activeEntities.filter(e => chartBvs.has(e as FteBv)) as FteBv[]
    // Render in een vaste volgorde: eerst Totaal, dan de standaard-verticals.
    const verticalKeys = ALL_VERTICAL_KEYS.filter(v => chartVerticals.has(v))

    for (const bv of bvs) {
      for (const vk of verticalKeys) {
        if (!isVerticalApplicable(bv, vk)) continue
        const isTotal = vk === 'Totaal'
        const vertical: Vertical | undefined = isTotal ? undefined : (vk as Vertical)
        // Kleur: Totaal = BV-kleur, vertical = vertical-kleur. Dat groepeert
        // visueel BV-totalen per BV en vertical-lijnen per vertical. Dat gaf
        // overlap met dezelfde hex (Telecom = Cons-cyan, etc.) — bewust:
        // gebruikers selecteren typisch óf BV-totalen óf één BV met meerdere
        // verticals, in beide gevallen is de legenda-tekst leidend.
        const color = isTotal ? BV_COLORS[bv] : VERTICAL_COLORS[vertical as Vertical]
        const labelSuffix = isTotal ? `${bv} · Totaal` : `${bv} · ${vk}`
        // Totaal-lijnen iets dikker zodat ze prominent blijven boven hun
        // verticals-uitsplitsing.
        const baseWidth = isTotal ? 3 : 2

        if (showBudget) {
          datasets.push({
            label: `${labelSuffix} — Budget`,
            data: months.map(m => valOrNull(getBudgetVal(bv, m, vertical))),
            borderColor: color, backgroundColor: color + '22',
            borderWidth: baseWidth, tension: 0.3, pointRadius: 3, fill: false,
            spanGaps: true,
          })
        }
        if (showLe) {
          datasets.push({
            label: `${labelSuffix} — LE`,
            data: months.map(m => valOrNull(getLeVal(bv, m, vertical))),
            borderColor: color, backgroundColor: 'transparent',
            borderWidth: baseWidth, borderDash: [6, 4], tension: 0.3,
            pointRadius: 2, pointStyle: 'rectRot' as const, fill: false,
            spanGaps: true,
          })
        }
        if (showActual) {
          datasets.push({
            label: `${labelSuffix} — Actual`,
            data: months.map(m => valOrNull(getActual(bv, m, vertical))),
            borderColor: color, backgroundColor: color + '44',
            borderWidth: 0, // alleen punten
            pointRadius: isTotal ? 6 : 4, pointStyle: 'circle' as const,
            showLine: false, fill: false,
            spanGaps: true,
          })
        }
      }
    }
    return { labels: months, datasets }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    chartBvs, chartVerticals,
    showBudget, showLe, showActual, fteEntries, finalizedSet,
  ])

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>
            FY 2026 · FTE-budget per BV en vertical
          </div>
          <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>
            Vul FTE-budget in per BV én optioneel per vertical · capaciteits-% (productief / verlof / improductief / ziek) per BV per maand · headcount wordt alleen als actual ingevuld bij de Maandafsluiting · referentie-snapshot: {PERSON_SPEC_SNAPSHOT_DATE}
          </div>
        </div>
      </div>

      {/* ── Chart: Budget vs LE per BV / per vertical ──────────────── */}
      {activeEntities.length > 0 && (
        <div className="card">
          <div className="card-hdr">
            <span className="card-title">📈 FTE — Budget vs Latest Estimate</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>
              Solid = Budget · Dashed = LE · Dot = Actual
            </span>
          </div>

          {/* Series toggles */}
          <div style={{ padding: '10px 14px 6px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid var(--bd)' }}>
            <span style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>Series:</span>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={showBudget} onChange={e => setShowBudget(e.target.checked)} /> Budget
            </label>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={showLe} onChange={e => setShowLe(e.target.checked)} /> LE
            </label>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={showActual} onChange={e => setShowActual(e.target.checked)} /> Actual
            </label>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>
              Lijn-aantal = (BV × vertical) × series. Hou de selectie compact voor een leesbare grafiek.
            </span>
          </div>

          {/* Filter-rij 1: BVs */}
          <div style={{ padding: '8px 14px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid var(--bd)' }}>
            <span style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', minWidth: 60 }}>BVs:</span>
            {activeEntities.map(e => {
              const bv = e as FteBv
              const active = chartBvs.has(bv)
              return (
                <button
                  key={bv}
                  onClick={() => setChartBvs(prev => {
                    const next = new Set(prev)
                    if (next.has(bv)) next.delete(bv); else next.add(bv)
                    return next
                  })}
                  style={{
                    padding: '3px 10px', borderRadius: 5, fontSize: 11,
                    fontWeight: active ? 700 : 400, cursor: 'pointer',
                    border: '1px solid',
                    borderColor: active ? BV_COLORS[bv] : 'var(--bd2)',
                    background: active ? BV_COLORS[bv] + '22' : 'transparent',
                    color: active ? BV_COLORS[bv] : 'var(--t3)',
                    fontFamily: 'var(--font)',
                  }}
                >
                  <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: BV_COLORS[bv], marginRight: 5, verticalAlign: 'middle' }} />
                  {bv}
                </button>
              )
            })}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              <button
                className="btn sm ghost"
                style={{ fontSize: 10 }}
                onClick={() => setChartBvs(new Set(activeEntities as FteBv[]))}
                title="Alle BVs aanvinken"
              >Alle</button>
              <button
                className="btn sm ghost"
                style={{ fontSize: 10 }}
                onClick={() => setChartBvs(new Set())}
                title="Alle BVs uit"
              >Geen</button>
            </span>
          </div>

          {/* Filter-rij 2: verticals */}
          <div style={{ padding: '8px 14px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid var(--bd)' }}>
            <span style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', minWidth: 60 }}>Verticals:</span>
            {ALL_VERTICAL_KEYS.map(vk => {
              const active = chartVerticals.has(vk)
              const isTotal = vk === 'Totaal'
              const c = isTotal ? 'var(--t1)' : VERTICAL_COLORS[vk as Vertical]
              return (
                <button
                  key={vk}
                  onClick={() => setChartVerticals(prev => {
                    const next = new Set(prev)
                    if (next.has(vk)) next.delete(vk); else next.add(vk)
                    return next
                  })}
                  style={{
                    padding: '3px 10px', borderRadius: 5, fontSize: 11,
                    fontWeight: active ? 700 : 400, cursor: 'pointer',
                    border: '1px solid',
                    borderColor: active ? c : 'var(--bd2)',
                    background: active
                      ? (isTotal ? 'rgba(255,255,255,0.06)' : (VERTICAL_COLORS[vk as Vertical] + '22'))
                      : 'transparent',
                    color: active ? c : 'var(--t3)',
                    fontFamily: 'var(--font)',
                  }}
                >
                  {!isTotal && (
                    <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: VERTICAL_COLORS[vk as Vertical], marginRight: 5, verticalAlign: 'middle' }} />
                  )}
                  {isTotal ? 'BV-Totaal' : vk}
                </button>
              )
            })}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              <button
                className="btn sm ghost"
                style={{ fontSize: 10 }}
                onClick={() => setChartVerticals(new Set(ALL_VERTICAL_KEYS))}
                title="Alle verticals aanvinken"
              >Alle</button>
              <button
                className="btn sm ghost"
                style={{ fontSize: 10 }}
                onClick={() => setChartVerticals(new Set(['Totaal']))}
                title="Alleen BV-totalen"
              >Alleen Totaal</button>
            </span>
          </div>

          <div style={{ padding: 14, height: 340 }}>
            <Line data={chartData} options={baseChartOptions as any} />
          </div>
        </div>
      )}

      {activeEntities.length === 0 && (
        <div className="card" style={{ padding: 14, color: 'var(--t3)' }}>
          Geen toegankelijke BV voor jouw account.
        </div>
      )}

      {activeEntities.map(scope => {
        const bv = scope as FteBv
        const verticals = verticalsForBv(bv)
        const snapTotal = snapshotActuals(bv)

        return (
          <div key={scope} className="card" style={{ borderLeft: `3px solid ${BV_COLORS[scope]}` }}>
            <div className="card-hdr">
              <span className="card-title" style={{ color: BV_COLORS[scope] }}>{scope}</span>
              {snapTotal && (
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>
                  Snapshot {PERSON_SPEC_MONTH}:&nbsp;
                  <strong style={{ color: BV_COLORS[scope] }}>
                    {fmtFte(snapTotal.fte)} FTE · {fmtHc(snapTotal.headcount)} hc
                  </strong>
                </span>
              )}
            </div>

            {/* ── FTE budget tabel ─────────────────────────────────────── */}
            <div style={{ padding: '8px 14px 0', fontSize: 10, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>
              FTE budget
              <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: 6, letterSpacing: 0 }}>
                — totaal-rij is leidend; vertical-rijen zijn optioneel (Σ wordt vergeleken)
              </span>
            </div>
            <div style={{ overflowX: 'auto', marginTop: 4 }}>
              <table className="tbl" style={{ minWidth: 'max-content', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 220, position: 'sticky', left: 0, background: 'var(--bg3)' }}>Regel</th>
                    {months.map(m => (
                      <th key={m} className="r" style={{ minWidth: 80, padding: '4px 6px' }}>{m}</th>
                    ))}
                    <th className="r" style={{ borderLeft: '1px solid var(--bd2)', color: 'var(--brand)', minWidth: 80 }}>FY ø</th>
                  </tr>
                </thead>
                <tbody>
                  {/* FTE — totaal */}
                  <tr style={{ background: 'var(--bg3)' }}>
                    <td style={{ position: 'sticky', left: 0, background: 'var(--bg3)', padding: '4px 12px', fontWeight: 700, color: BV_COLORS[scope] }}>
                      FTE budget — Totaal
                    </td>
                    {months.map(m => (
                      <td key={m} className="r mono" style={{ padding: '3px 6px', fontSize: 11 }}>
                        <NumberInput
                          value={getFteBudget(bv, m)}
                          onCommit={v => setFteBudget(bv, m, v)}
                          decimals={1}
                          width={70}
                        />
                      </td>
                    ))}
                    <td className="r mono" style={{ borderLeft: '1px solid var(--bd2)', padding: '3px 6px', fontWeight: 700, color: 'var(--brand)' }}>
                      {fyAvgFteBudget(bv) > 0 ? fmtFte(fyAvgFteBudget(bv)) : '—'}
                    </td>
                  </tr>

                  {/* Vertical-FTE-rijen */}
                  {verticals.map(v => {
                    const fyTot = months.reduce((s, m) => s + (getFteBudgetVert(bv, v, m) ?? 0), 0)
                    return (
                      <tr key={v}>
                        <td style={{
                          position: 'sticky', left: 0, background: 'var(--bg2)',
                          padding: '4px 12px 4px 28px', fontSize: 11,
                          color: VERTICAL_COLORS[v], fontWeight: 600,
                        }}>
                          ↳ {v}
                        </td>
                        {months.map(m => (
                          <td key={m} className="r mono" style={{ padding: '3px 6px', fontSize: 11 }}>
                            <NumberInput
                              value={getFteBudgetVert(bv, v, m)}
                              onCommit={val => setFteBudgetVert(bv, v, m, val)}
                              decimals={1}
                              width={70}
                            />
                          </td>
                        ))}
                        <td className="r mono" style={{ borderLeft: '1px solid var(--bd2)', padding: '3px 6px', color: 'var(--t3)' }}>
                          {fyTot > 0 ? fmtFte(fyTot / 12) : '—'}
                        </td>
                      </tr>
                    )
                  })}

                  {/* Verschil-rij Σ verticals vs totaal */}
                  {verticals.length > 0 && (
                    <tr>
                      <td style={{
                        position: 'sticky', left: 0, background: 'var(--bg2)',
                        padding: '4px 12px 4px 28px', fontSize: 10,
                        color: 'var(--t3)', fontStyle: 'italic',
                      }}>
                        Σ verticals → check vs totaal
                      </td>
                      {months.map(m => {
                        const sum = vertSum(bv, m)
                        const tot = getFteBudget(bv, m)
                        const diff = (sum != null && tot != null) ? sum - tot : null
                        const ok = diff != null && Math.abs(diff) < 0.05
                        return (
                          <td key={m} className="r mono" style={{
                            padding: '3px 6px', fontSize: 10,
                            color: sum == null ? 'var(--t3)' : (tot == null ? 'var(--t3)' : ok ? 'var(--green)' : 'var(--amber)'),
                          }}
                            title={diff != null && !ok ? `Σ = ${fmtFte(sum!)}, totaal = ${fmtFte(tot!)}, diff = ${diff > 0 ? '+' : ''}${fmtFte(diff)}` : undefined}
                          >
                            {sum == null ? '—' : fmtFte(sum)}
                            {diff != null && !ok && <span style={{ marginLeft: 3 }}>⚠</span>}
                          </td>
                        )
                      })}
                      <td style={{ borderLeft: '1px solid var(--bd2)' }} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Headcount-budget is bewust verwijderd — headcount wordt
                alleen nog als actual ingevoerd in de Maandafsluiting. */}

            {/* ── Capaciteit-% tabel — alleen productie-BVs ──────────── */}
            {bv !== 'Holdings' && (
              <>
                <div style={{ padding: '14px 14px 0', fontSize: 10, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                  Capaciteits-verdeling per maand
                  <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: 6, letterSpacing: 0 }}>
                    — productief / verlof / improductief / ziek · totaal moet ≈ 100%
                  </span>
                </div>
                <div style={{ overflowX: 'auto', marginTop: 4 }}>
                  <table className="tbl" style={{ minWidth: 'max-content', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ minWidth: 220, position: 'sticky', left: 0, background: 'var(--bg3)' }}>Regel</th>
                        {months.map(m => (
                          <th key={m} className="r" style={{ minWidth: 80, padding: '4px 6px' }}>{m}</th>
                        ))}
                        <th className="r" style={{ borderLeft: '1px solid var(--bd2)', color: 'var(--brand)', minWidth: 80 }}>FY ø</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CAPACITY_KEYS.map(cap => {
                        const vals = months
                          .map(m => getCapacityPct(scope as EntityName, m, cap.key))
                          .filter((v): v is number => v != null && v > 0)
                        const fyAvg = vals.length > 0
                          ? vals.reduce((s, v) => s + v, 0) / vals.length
                          : null
                        return (
                          <tr key={cap.key}>
                            <td style={{
                              position: 'sticky', left: 0, background: 'var(--bg2)',
                              padding: '4px 12px', fontSize: 11,
                              color: cap.color, fontWeight: 600,
                            }}>
                              {cap.label}
                            </td>
                            {months.map(m => {
                              const val = getCapacityPct(scope as EntityName, m, cap.key)
                              const display = val == null || val === 0 ? undefined : val
                              return (
                                <td key={m} className="r mono" style={{ padding: '3px 6px', fontSize: 11 }}>
                                  <NumberInput
                                    value={display}
                                    onCommit={v => setCapacityPct(scope as EntityName, m, cap.key, v)}
                                    suffix="%"
                                    decimals={1}
                                    width={70}
                                  />
                                </td>
                              )
                            })}
                            <td className="r mono" style={{
                              borderLeft: '1px solid var(--bd2)',
                              padding: '3px 6px', fontWeight: 700, color: cap.color,
                            }}>
                              {fyAvg == null ? '—' : fyAvg.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'}
                            </td>
                          </tr>
                        )
                      })}
                      {/* Totaal-% rij */}
                      <tr style={{ background: 'var(--bg3)' }}>
                        <td style={{ position: 'sticky', left: 0, background: 'var(--bg3)', padding: '4px 12px', fontWeight: 700, fontSize: 11 }}>
                          Totaal %
                        </td>
                        {months.map(m => {
                          const t = capacityTotal(scope as EntityName, m)
                          const filled = t > 0
                          const ok = filled && Math.abs(t - 100) < 0.05
                          const color = !filled ? 'var(--t3)' : ok ? 'var(--green)' : 'var(--amber)'
                          return (
                            <td key={m} className="r mono" style={{
                              padding: '3px 6px', fontSize: 11,
                              color, fontWeight: 700,
                            }}
                              title={filled && !ok ? `Som = ${t.toFixed(1)}% — moet 100% zijn` : undefined}
                            >
                              {filled
                                ? t.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
                                : '—'}
                              {filled && !ok && <span style={{ marginLeft: 3 }}>⚠</span>}
                            </td>
                          )
                        })}
                        <td style={{ borderLeft: '1px solid var(--bd2)' }} />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* ── Actuals snapshot ({PERSON_SPEC_MONTH}) onderaan ─── */}
            <div style={{
              padding: '12px 14px 14px',
              fontSize: 11, color: 'var(--t3)',
              borderTop: '1px dashed var(--bd2)',
              marginTop: 14,
            }}>
              <strong style={{ color: 'var(--t2)', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase' }}>
                Actuals {PERSON_SPEC_MONTH} (snapshot {PERSON_SPEC_SNAPSHOT_DATE})
              </strong>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6 }}>
                {snapTotal && (
                  <div style={{
                    padding: '4px 10px', borderRadius: 4,
                    background: BV_COLORS[scope] + '14',
                    border: `1px solid ${BV_COLORS[scope]}33`,
                    fontSize: 11,
                  }}>
                    <strong style={{ color: BV_COLORS[scope] }}>Totaal:</strong>{' '}
                    <span style={{ fontFamily: 'var(--mono)' }}>{fmtFte(snapTotal.fte)} FTE</span>
                    <span style={{ color: 'var(--t3)', margin: '0 4px' }}>·</span>
                    <span style={{ fontFamily: 'var(--mono)' }}>{fmtHc(snapTotal.headcount)} hc</span>
                  </div>
                )}
                {verticals.map(v => {
                  const snap = snapshotActuals(bv, v)
                  if (!snap) return null
                  return (
                    <div key={v} style={{
                      padding: '4px 10px', borderRadius: 4,
                      background: VERTICAL_COLORS[v] + '14',
                      border: `1px solid ${VERTICAL_COLORS[v]}33`,
                      fontSize: 11,
                    }}>
                      <strong style={{ color: VERTICAL_COLORS[v] }}>{v}:</strong>{' '}
                      <span style={{ fontFamily: 'var(--mono)' }}>{fmtFte(snap.fte)} FTE</span>
                      <span style={{ color: 'var(--t3)', margin: '0 4px' }}>·</span>
                      <span style={{ fontFamily: 'var(--mono)' }}>{fmtHc(snap.headcount)} hc</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )
      })}

      <div style={{ fontSize: 11, color: 'var(--t3)', padding: '8px 0' }}>
        💡 <strong>Actuals invoeren:</strong> ga naar de Maandafsluiting → tab &quot;FTE &amp;
        Headcount&quot; om actuals (totaal en per vertical) per maand vast te leggen.
      </div>
    </div>
  )
}
