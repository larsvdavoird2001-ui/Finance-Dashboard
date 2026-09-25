import { useMemo, useState } from 'react'
import {
  marktOmzet, marktTopKlanten, MARKT_ENTITIES, MARKT_SEGMENTS, MARKT_META,
} from '../../data/customerRevenue'
import type { MarktEntity, MarktSegment } from '../../data/customerRevenue'
import { marge2026, margeIntern2026, margeProjecten2026, MARGE_MAANDEN, MARGE_META } from '../../data/marginData'
import { useAdjustedActuals } from '../../hooks/useAdjustedActuals'
import { BASE_ACTUAL_MONTHS_2026 } from '../../store/useFinStore'

const MAAND_LABELS = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']
const SEG_LABELS: Record<string, string> = {
  '1. Public': 'Public',
  '2. Telecom': 'Telecom',
  '3. Energy': 'Energy',
  '4. Civil': 'Civil',
  '5. Industry': 'Industry',
  '6. Overig': 'Overig',
  'Niet toegewezen': 'Niet toegew.',
}

const ENT_COLORS: Record<MarktEntity, string> = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
}

type Jaar = '2026' | '2025'
type Metric = 'omzet' | 'marge'
const JAAR_OPTIES: Jaar[] = ['2026', '2025']
const REF_JAAR: Record<Jaar, '2025' | '2024'> = { '2026': '2025', '2025': '2024' }

function fmtK(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `€ ${(v / 1_000_000).toFixed(2).replace('.', ',')}M`
  return `€ ${Math.round(v / 1000)}k`
}
const fmtEur = (v: number) => `€ ${Math.round(v).toLocaleString('nl-NL')}`

/** Laatste bruikbare maand (1-12) voor een weergavejaar/metric. */
function maxMaandVoor(jaar: Jaar, metric: Metric): number {
  if (metric === 'marge') return MARGE_MAANDEN
  if (jaar === '2026') return MARKT_META.laatsteVolledigeMaand + (MARKT_META.septemberLopend ? 1 : 0)
  return 12
}

/** Omzet-maandreeks (12 posities) voor een cel; 'totaal'-assen sommeren. */
function reeks(jaar: '2024' | '2025' | '2026', ent: MarktEntity | 'totaal', seg: string | 'totaal'): number[] {
  const ents = ent === 'totaal' ? [...MARKT_ENTITIES] : [ent]
  const segs = seg === 'totaal' ? [...MARKT_SEGMENTS] : [seg as MarktSegment]
  const out = new Array(12).fill(0)
  for (const e of ents) for (const s of segs) {
    const arr = marktOmzet[jaar][e][s] ?? []
    for (let i = 0; i < 12; i++) out[i] += arr[i] ?? 0
  }
  return out
}

interface MargeReeks { omzetFact: number[]; ohw: number[]; mhOmzet: number[]; mhKosten: number[]; omzet: number[]; kosten: number[]; fallback: number[]; marge: number[]; uren: number[] }
/** Marge-maandreeksen (12 posities) voor een cel; 'totaal'-assen sommeren.
 *  metMh: missing hours (nog niet geboekte uren) meenemen in omzet én kosten. */
function margeReeks(ent: MarktEntity | 'totaal', seg: string | 'totaal', segs: string[], metMh: boolean): MargeReeks {
  const ents = ent === 'totaal' ? [...MARKT_ENTITIES] : [ent]
  const sl = seg === 'totaal' ? segs : [seg]
  const z = () => new Array(12).fill(0)
  const r: MargeReeks = { omzetFact: z(), ohw: z(), mhOmzet: z(), mhKosten: z(), omzet: z(), kosten: z(), fallback: z(), marge: z(), uren: z() }
  for (const e of ents) for (const s of sl) {
    const c = marge2026[e]?.[s]
    if (!c) continue
    for (let i = 0; i < MARGE_MAANDEN; i++) {
      r.omzetFact[i] += c.omzet[i] ?? 0
      r.ohw[i] += c.ohw[i] ?? 0
      r.mhOmzet[i] += c.mhOmzet?.[i] ?? 0
      r.mhKosten[i] += c.mhKosten?.[i] ?? 0
      r.kosten[i] += c.kosten[i] ?? 0
      r.fallback[i] += c.kostenFallback[i] ?? 0
      r.uren[i] += c.uren[i] ?? 0
    }
  }
  for (let i = 0; i < 12; i++) {
    r.omzet[i] = r.omzetFact[i] + r.ohw[i] + (metMh ? r.mhOmzet[i] : 0)
    r.marge[i] = r.omzet[i] - r.kosten[i] - r.fallback[i] - (metMh ? r.mhKosten[i] : 0)
  }
  return r
}

const som = (arr: number[], t: number) => arr.slice(0, t).reduce((a, b) => a + b, 0)

interface SparkProps { yCur: number[]; yRef: number[]; kleur: string; totMaand: number }
function Sparkline({ yCur, yRef, kleur, totMaand }: SparkProps) {
  const W = 116, H = 30, P = 2
  const max = Math.max(...yCur.slice(0, totMaand).map(Math.abs), ...yRef.map(Math.abs), 1)
  const x = (i: number) => P + (i / 11) * (W - 2 * P)
  const y = (v: number) => H - P - ((v + max) / (2 * max)) * (H - 2 * P)
  const pad = (vals: number[], n: number) =>
    vals.slice(0, n).map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <svg width={W} height={H} style={{ display: 'block' }} aria-hidden="true">
      <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="var(--bd2)" strokeWidth={1} />
      {yRef.length > 0 && <polyline points={pad(yRef, 12)} fill="none" stroke="var(--t3)" strokeWidth={1.5} strokeDasharray="3 3" opacity={0.7} />}
      <polyline points={pad(yCur, totMaand)} fill="none" stroke={kleur} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

interface TileProps {
  ent: MarktEntity | 'totaal'
  seg: string | 'totaal'
  segs: string[]
  jaar: Jaar
  metric: Metric
  metMh: boolean
  mode: 'maand' | 'ytd'
  maand: number           // 1-12
  selected: boolean
  onSelect: () => void
}
function Tile({ ent, seg, segs, jaar, metric, metMh, mode, maand, selected, onSelect }: TileProps) {
  const kleur = ent === 'totaal' ? 'var(--blue)' : ENT_COLORS[ent]
  let val: number, ref: number, pct: number | null, leeg: boolean, pos: boolean
  let yCur: number[], yRef: number[], caption: string, badge: string | null

  if (metric === 'omzet') {
    yCur = reeks(jaar, ent, seg)
    yRef = reeks(REF_JAAR[jaar], ent, seg)
    val = mode === 'maand' ? (yCur[maand - 1] ?? 0) : som(yCur, maand)
    ref = mode === 'maand' ? (yRef[maand - 1] ?? 0) : som(yRef, maand)
    pct = ref !== 0 ? ((val - ref) / Math.abs(ref)) * 100 : null
    leeg = val === 0 && ref === 0
    pos = (pct ?? 0) >= 0
    caption = `${mode === 'maand' ? MAAND_LABELS[maand - 1] : `YTD t/m ${MAAND_LABELS[maand - 1]}`} · ${REF_JAAR[jaar]}: ${fmtK(ref)}`
    badge = pct == null ? null : `${pos ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}%`
  } else {
    const r = margeReeks(ent, seg, segs, metMh)
    yCur = r.marge
    yRef = []
    const omz = mode === 'maand' ? r.omzet[maand - 1] : som(r.omzet, maand)
    const mrg = mode === 'maand' ? r.marge[maand - 1] : som(r.marge, maand)
    const kst = omz - mrg
    val = mrg
    ref = omz
    pct = omz !== 0 ? (val / Math.abs(omz)) * 100 : null
    leeg = omz === 0 && kst === 0
    pos = val >= 0
    const mh = mode === 'maand' ? r.mhOmzet[maand - 1] : som(r.mhOmzet, maand)
    caption = `omz ${fmtK(omz)} · kst ${fmtK(kst)}${metMh && mh !== 0 && ent === 'Projects' ? ' · mh≈' : ''}`
    badge = pct == null ? null : `${Math.round(pct)}%`
  }

  const bg = leeg || pct == null
    ? 'var(--bg2)'
    : pos ? 'color-mix(in srgb, var(--green) 10%, var(--bg2))'
          : 'color-mix(in srgb, var(--red) 10%, var(--bg2))'
  const bd = selected
    ? kleur
    : leeg || pct == null ? 'var(--bd2)' : pos ? 'color-mix(in srgb, var(--green) 45%, var(--bd2))' : 'color-mix(in srgb, var(--red) 45%, var(--bd2))'

  return (
    <button
      onClick={onSelect}
      title={metric === 'omzet' ? 'Klik voor maanddetail en top-klanten' : 'Klik voor maanddetail en projecten'}
      style={{
        display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'stretch',
        padding: '8px 10px', minWidth: 132, flex: 1,
        background: bg, border: `1px solid ${bd}`, borderRadius: 8,
        cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font)',
        outline: selected ? `2px solid ${kleur}` : 'none', outlineOffset: 1,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)', fontFamily: 'var(--mono)', letterSpacing: '-.3px' }}>
          {leeg ? '—' : fmtK(val)}
        </span>
        {badge && !leeg && (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: pos ? 'var(--green)' : 'var(--red)', whiteSpace: 'nowrap' }}>
            {badge}
          </span>
        )}
        {pct == null && !leeg && (
          <span style={{ fontSize: 10, color: 'var(--t3)' }}>{metric === 'omzet' ? 'nieuw' : 'geen omzet'}</span>
        )}
      </div>
      {!leeg && <Sparkline yCur={yCur} yRef={yRef} kleur={kleur} totMaand={maxMaandVoor(jaar, metric)} />}
      {!leeg && (
        <div style={{ fontSize: 9.5, color: 'var(--t3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {caption}
        </div>
      )}
    </button>
  )
}

function ToggleGroup<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'flex', gap: 0, border: '1px solid var(--bd2)', borderRadius: 7, overflow: 'hidden' }}>
      {options.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          style={{
            padding: '6px 14px', fontSize: 12, fontWeight: value === o.id ? 700 : 500,
            background: value === o.id ? 'var(--bg4)' : 'var(--bg2)',
            color: value === o.id ? 'var(--t1)' : 'var(--t2)',
            border: 'none', cursor: 'pointer', fontFamily: 'var(--font)',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function MarktTab() {
  const [metric, setMetric] = useState<Metric>('omzet')
  const [jaar, setJaar] = useState<Jaar>('2026')
  const [mode, setMode] = useState<'maand' | 'ytd'>('ytd')
  const [maand, setMaand] = useState<number>(Math.min(MARKT_META.laatsteVolledigeMaand, maxMaandVoor('2026', 'omzet')))
  const [sel, setSel] = useState<{ ent: MarktEntity | 'totaal'; seg: string | 'totaal' } | null>(null)
  const [metMh, setMetMh] = useState(true)
  const { getYtd } = useAdjustedActuals()

  const effJaar: Jaar = metric === 'marge' ? '2026' : jaar
  const maxMaand = maxMaandVoor(effJaar, metric)

  // Segmentkolommen: omzet-segmenten, in marge-modus aangevuld met segmenten
  // die daar (per saldo) data hebben.
  const segs: string[] = useMemo(() => {
    if (metric === 'omzet') return [...MARKT_SEGMENTS]
    const set = new Set<string>(MARKT_SEGMENTS)
    for (const e of MARKT_ENTITIES) for (const [s, c] of Object.entries(marge2026[e] ?? {})) {
      const any = [c.omzet, c.ohw, c.kosten, c.kostenFallback].some(a => a.slice(0, MARGE_MAANDEN).some(v => v !== 0))
      if (any) set.add(s)
    }
    return [...set]
  }, [metric])

  const kiesMetric = (m: Metric) => {
    setMetric(m)
    setMaand(x => Math.min(x, maxMaandVoor(m === 'marge' ? '2026' : jaar, m)))
    setSel(null)
  }
  const kiesJaar = (j: Jaar) => {
    setJaar(j)
    setMaand(m => Math.min(m, maxMaandVoor(j, metric)))
  }

  const detail = useMemo(() => {
    if (!sel) return null
    const y26 = reeks('2026', sel.ent, sel.seg)
    const y25 = reeks('2025', sel.ent, sel.seg)
    const y24 = reeks('2024', sel.ent, sel.seg)
    const top = sel.ent !== 'totaal' && sel.seg !== 'totaal'
      ? (marktTopKlanten[`${sel.ent}|${sel.seg}`] ?? [])
      : []
    const mr = margeReeks(sel.ent, sel.seg, segs, metMh)
    const projecten = margeProjecten2026
      .filter(p => (sel.ent === 'totaal' || p.ent === sel.ent) && (sel.seg === 'totaal' || p.seg === sel.seg))
      .map(p => metMh
        ? { ...p, omzet: p.omzet + (p.mhOmzet ?? 0), kosten: p.kosten + (p.mhKosten ?? 0), marge: p.marge + (p.mhOmzet ?? 0) - (p.mhKosten ?? 0) }
        : p)
      .sort((a, b) => Math.abs(b.marge) - Math.abs(a.marge))
      .slice(0, 10)
    return { y26, y25, y24, top, mr, projecten }
  }, [sel, segs, metMh])

  // Aansluiting marge-model ↔ P&L (YTD t/m MARGE_MAANDEN)
  const aansluiting = useMemo(() => {
    if (metric !== 'marge') return null
    const months = BASE_ACTUAL_MONTHS_2026.slice(0, MARGE_MAANDEN)
    return MARKT_ENTITIES.map(e => {
      const r = margeReeks(e, 'totaal', segs, metMh)
      const pl = getYtd(e, months)
      const omzetToeg = som(r.omzet, MARGE_MAANDEN)
      const kosten = som(r.kosten, MARGE_MAANDEN) + (metMh ? som(r.mhKosten, MARGE_MAANDEN) : 0)
      const fallback = som(r.fallback, MARGE_MAANDEN)
      const mhOmzet = som(r.mhOmzet, MARGE_MAANDEN)
      const intern = margeIntern2026[e] ? som(margeIntern2026[e].kosten, MARGE_MAANDEN) : 0
      const zonderUren = (MARGE_META.zonderUren as Record<string, { omzet: number } | undefined> | undefined)?.[e]?.omzet ?? 0
      return {
        ent: e, omzetToeg, plOmzet: pl['netto_omzet'] ?? 0, kosten, fallback, intern, zonderUren, mhOmzet,
        marge: omzetToeg - kosten - fallback,
        plDirect: pl['directe_kosten'] ?? 0, plOpex: pl['operationele_kosten'] ?? 0, plEbitda: pl['ebitda'] ?? 0,
      }
    })
  }, [metric, segs, getYtd, metMh])

  return (
    <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── Titel + keuzes ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--t1)' }}>
            {metric === 'omzet' ? 'Omzet' : 'Marge'} per markt × entiteit
          </div>
          <div style={{ fontSize: 11, color: 'var(--t2)' }}>
            {metric === 'omzet'
              ? `Gefactureerde nettowaarde per marktsegment, vergeleken met dezelfde periode ${REF_JAAR[effJaar]}`
              : 'Productie-omzet (facturatie + OHW-mutatie) minus uren × kostprijs+AK, per project toegerekend — 2026'}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <ToggleGroup value={metric} onChange={kiesMetric} options={[{ id: 'omzet', label: 'Omzet' }, { id: 'marge', label: 'Marge' }]} />
        {metric === 'marge' && (
          <label
            title="Missing hours = nog niet geboekte/goedgekeurde uren (stand uit de OHW-administratie). Verdeeld per medewerker over diens projecten: bij Consultancy-detachering exact, bij Projects een schatting naar rato van geschreven uren."
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--t2)', cursor: 'pointer', userSelect: 'none' }}
          >
            <input type="checkbox" checked={metMh} onChange={e => setMetMh(e.target.checked)} style={{ accentColor: 'var(--blue)' }} />
            incl. missing hours <span style={{ color: 'var(--t3)', fontSize: 10.5 }}>(Projects ≈ schatting)</span>
          </label>
        )}
        <ToggleGroup value={mode} onChange={setMode} options={[{ id: 'ytd', label: 'YTD' }, { id: 'maand', label: 'Per maand' }]} />
        <select
          value={effJaar}
          disabled={metric === 'marge'}
          onChange={e => kiesJaar(e.target.value as Jaar)}
          title={metric === 'marge' ? 'Marge is alleen voor 2026 beschikbaar (geen urenexport 2025)' : undefined}
          style={{
            padding: '6px 10px', fontSize: 12, fontWeight: 700, borderRadius: 7,
            background: 'var(--bg2)', color: 'var(--t1)', border: '1px solid var(--bd2)', fontFamily: 'var(--font)',
            opacity: metric === 'marge' ? 0.55 : 1,
          }}
        >
          {JAAR_OPTIES.map(j => (
            <option key={j} value={j}>{metric === 'marge' ? j : `${j} (vs ${REF_JAAR[j]})`}</option>
          ))}
        </select>
      </div>

      {/* ── Maandknoppen ── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {MAAND_LABELS.map((l, i) => {
          const mNr = i + 1
          const beschikbaar = mNr <= maxMaand
          const actief = maand === mNr
          const lopend = metric === 'omzet' && effJaar === '2026' && mNr > MARKT_META.laatsteVolledigeMaand && beschikbaar
          return (
            <button
              key={l}
              onClick={() => beschikbaar && setMaand(mNr)}
              disabled={!beschikbaar}
              title={!beschikbaar ? 'Nog geen data' : lopend ? 'Lopende maand (nog niet volledig gefactureerd)' : undefined}
              style={{
                padding: '6px 0', width: 52, fontSize: 12,
                fontWeight: actief ? 700 : 500,
                background: actief ? 'var(--blue)' : 'var(--bg2)',
                color: actief ? '#fff' : beschikbaar ? 'var(--t2)' : 'var(--t3)',
                border: `1px solid ${actief ? 'var(--blue)' : 'var(--bd2)'}`,
                borderRadius: 7,
                cursor: beschikbaar ? 'pointer' : 'not-allowed',
                opacity: beschikbaar ? 1 : 0.45,
                fontFamily: 'var(--font)',
              }}
            >
              {l}{lopend ? '*' : ''}
            </button>
          )
        })}
        <span style={{ fontSize: 10.5, color: 'var(--t3)', marginLeft: 6 }}>
          {mode === 'ytd' ? `YTD t/m ${MAAND_LABELS[maand - 1]} ${effJaar}` : `${MAAND_LABELS[maand - 1]} ${effJaar}`}
          {metric === 'omzet' && effJaar === '2026' && maand > MARKT_META.laatsteVolledigeMaand ? ' · * lopende maand' : ''}
        </span>
      </div>

      {/* ── Legenda ── */}
      {metric === 'omzet' ? (
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', fontSize: 10.5, color: 'var(--t2)' }}>
          <span><svg width="26" height="8" style={{ verticalAlign: 'middle', marginRight: 4 }}><line x1="1" x2="25" y1="4" y2="4" stroke="var(--t1)" strokeWidth="2" /></svg>{effJaar}{effJaar === '2026' ? ` (t/m ${MAAND_LABELS[maxMaand - 1]})` : ''}</span>
          <span><svg width="26" height="8" style={{ verticalAlign: 'middle', marginRight: 4 }}><line x1="1" x2="25" y1="4" y2="4" stroke="var(--t3)" strokeWidth="1.5" strokeDasharray="3 3" /></svg>{REF_JAAR[effJaar]} (referentie, hele jaar)</span>
          <span style={{ color: 'var(--green)', fontWeight: 600 }}>▲ boven {REF_JAAR[effJaar]}</span>
          <span style={{ color: 'var(--red)', fontWeight: 600 }}>▼ onder {REF_JAAR[effJaar]}</span>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', fontSize: 10.5, color: 'var(--t2)', flexWrap: 'wrap' }}>
          <span><svg width="26" height="8" style={{ verticalAlign: 'middle', marginRight: 4 }}><line x1="1" x2="25" y1="4" y2="4" stroke="var(--t1)" strokeWidth="2" /></svg>marge per maand 2026 (t/m {MAAND_LABELS[MARGE_MAANDEN - 1]})</span>
          <span style={{ color: 'var(--green)', fontWeight: 600 }}>groen = positieve marge</span>
          <span style={{ color: 'var(--red)', fontWeight: 600 }}>rood = negatieve marge</span>
          <span>badge = marge in % van productie-omzet</span>
        </div>
      )}

      {/* ── Matrix ── */}
      <div className="card" style={{ padding: 14, overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `110px repeat(${segs.length + 1}, minmax(132px, 1fr))`, gap: 8, minWidth: 1100 }}>
          <div />
          {segs.map(s => (
            <div key={s} style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.06em', alignSelf: 'end', padding: '0 2px' }}>
              {SEG_LABELS[s] ?? s}
            </div>
          ))}
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--t1)', textTransform: 'uppercase', letterSpacing: '.06em', alignSelf: 'end', padding: '0 2px' }}>
            Totaal
          </div>

          {MARKT_ENTITIES.map(ent => (
            <div key={ent} style={{ display: 'contents' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, color: 'var(--t1)' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: ENT_COLORS[ent], flexShrink: 0 }} />
                {ent}
              </div>
              {segs.map(seg => (
                <Tile
                  key={`${ent}|${seg}`}
                  ent={ent} seg={seg} segs={segs} jaar={effJaar} metric={metric} metMh={metMh} mode={mode} maand={maand}
                  selected={sel?.ent === ent && sel?.seg === seg}
                  onSelect={() => setSel(prev => prev?.ent === ent && prev?.seg === seg ? null : { ent, seg })}
                />
              ))}
              <Tile
                ent={ent} seg="totaal" segs={segs} jaar={effJaar} metric={metric} metMh={metMh} mode={mode} maand={maand}
                selected={sel?.ent === ent && sel?.seg === 'totaal'}
                onSelect={() => setSel(prev => prev?.ent === ent && prev?.seg === 'totaal' ? null : { ent, seg: 'totaal' })}
              />
            </div>
          ))}

          <div style={{ display: 'contents' }}>
            <div style={{ display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 700, color: 'var(--t1)' }}>Totaal</div>
            {segs.map(seg => (
              <Tile
                key={`tot|${seg}`}
                ent="totaal" seg={seg} segs={segs} jaar={effJaar} metric={metric} metMh={metMh} mode={mode} maand={maand}
                selected={sel?.ent === 'totaal' && sel?.seg === seg}
                onSelect={() => setSel(prev => prev?.ent === 'totaal' && prev?.seg === seg ? null : { ent: 'totaal', seg })}
              />
            ))}
            <Tile
              ent="totaal" seg="totaal" segs={segs} jaar={effJaar} metric={metric} metMh={metMh} mode={mode} maand={maand}
              selected={sel?.ent === 'totaal' && sel?.seg === 'totaal'}
              onSelect={() => setSel(prev => prev?.ent === 'totaal' && prev?.seg === 'totaal' ? null : { ent: 'totaal', seg: 'totaal' })}
            />
          </div>
        </div>
      </div>

      {/* ── Detailpaneel ── */}
      {sel && detail && (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>
              {sel.ent === 'totaal' ? 'Alle entiteiten' : sel.ent} × {sel.seg === 'totaal' ? 'alle segmenten' : (SEG_LABELS[sel.seg] ?? sel.seg)}
            </div>
            <button onClick={() => setSel(null)} style={{ marginLeft: 'auto', fontSize: 11, background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer' }}>✕ sluiten</button>
          </div>

          {metric === 'omzet' ? (
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--mono)' }}>
                <thead>
                  <tr style={{ color: 'var(--t2)', fontFamily: 'var(--font)' }}>
                    <th style={{ textAlign: 'left', padding: '3px 10px 3px 0', fontWeight: 600 }}>Maand</th>
                    <th style={{ textAlign: 'right', padding: '3px 10px', fontWeight: 600 }}>2024</th>
                    <th style={{ textAlign: 'right', padding: '3px 10px', fontWeight: 600 }}>2025</th>
                    <th style={{ textAlign: 'right', padding: '3px 10px', fontWeight: 600 }}>2026</th>
                    <th style={{ textAlign: 'right', padding: '3px 0 3px 10px', fontWeight: 600 }}>Δ {REF_JAAR[effJaar].slice(2)}→{effJaar.slice(2)}</th>
                  </tr>
                </thead>
                <tbody>
                  {MAAND_LABELS.map((l, i) => {
                    const perJaar: Record<'2024' | '2025' | '2026', number | null> = {
                      '2024': detail.y24[i],
                      '2025': detail.y25[i],
                      '2026': i < maxMaandVoor('2026', 'omzet') ? detail.y26[i] : null,
                    }
                    const vCur = perJaar[effJaar]
                    const vRef = perJaar[REF_JAAR[effJaar]]
                    const dpct = vCur != null && vRef != null && vRef !== 0 ? ((vCur - vRef) / Math.abs(vRef)) * 100 : null
                    return (
                      <tr key={l} style={{ borderTop: '1px solid var(--bd2)', color: 'var(--t1)' }}>
                        <td style={{ padding: '3px 10px 3px 0', fontFamily: 'var(--font)', color: 'var(--t2)' }}>
                          {l}{i + 1 > MARKT_META.laatsteVolledigeMaand && i < maxMaandVoor('2026', 'omzet') ? ' *' : ''}
                        </td>
                        <td style={{ textAlign: 'right', padding: '3px 10px', color: 'var(--t3)' }}>{fmtK(detail.y24[i])}</td>
                        <td style={{ textAlign: 'right', padding: '3px 10px', color: 'var(--t2)' }}>{fmtK(detail.y25[i])}</td>
                        <td style={{ textAlign: 'right', padding: '3px 10px', fontWeight: 700 }}>{perJaar['2026'] == null ? '—' : fmtK(detail.y26[i])}</td>
                        <td style={{ textAlign: 'right', padding: '3px 0 3px 10px', color: dpct == null ? 'var(--t3)' : dpct >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                          {dpct == null ? '—' : `${dpct >= 0 ? '+' : ''}${dpct.toFixed(0)}%`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {detail.top.length > 0 && (
                <div style={{ minWidth: 260 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
                    Top-klanten 2026
                  </div>
                  {detail.top.map(k => (
                    <div key={k.klant} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 11.5, padding: '4px 0', borderTop: '1px solid var(--bd2)' }}>
                      <span style={{ color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }} title={k.klant}>{k.klant}</span>
                      <span style={{ fontFamily: 'var(--mono)', color: 'var(--t1)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {fmtK(k.omzet2026)}
                        <span style={{ color: 'var(--t3)', fontWeight: 400 }}> · 25: {fmtK(k.omzet2025)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--mono)' }}>
                <thead>
                  <tr style={{ color: 'var(--t2)', fontFamily: 'var(--font)' }}>
                    <th style={{ textAlign: 'left', padding: '3px 10px 3px 0', fontWeight: 600 }}>Maand</th>
                    <th style={{ textAlign: 'right', padding: '3px 8px', fontWeight: 600 }}>Facturatie</th>
                    <th style={{ textAlign: 'right', padding: '3px 8px', fontWeight: 600 }}>Δ OHW</th>
                    {metMh && <th style={{ textAlign: 'right', padding: '3px 8px', fontWeight: 600 }} title="Missing hours (mutatie, toegerekend)">Δ MH</th>}
                    <th style={{ textAlign: 'right', padding: '3px 8px', fontWeight: 600 }}>Omzet</th>
                    <th style={{ textAlign: 'right', padding: '3px 8px', fontWeight: 600 }}>Uren</th>
                    <th style={{ textAlign: 'right', padding: '3px 8px', fontWeight: 600 }}>Kosten</th>
                    <th style={{ textAlign: 'right', padding: '3px 8px', fontWeight: 600 }}>Marge</th>
                    <th style={{ textAlign: 'right', padding: '3px 0 3px 8px', fontWeight: 600 }}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {MAAND_LABELS.slice(0, MARGE_MAANDEN).map((l, i) => {
                    const r = detail.mr
                    const kst = r.omzet[i] - r.marge[i]
                    const pct = r.omzet[i] !== 0 ? (r.marge[i] / Math.abs(r.omzet[i])) * 100 : null
                    return (
                      <tr key={l} style={{ borderTop: '1px solid var(--bd2)', color: 'var(--t1)' }}>
                        <td style={{ padding: '3px 10px 3px 0', fontFamily: 'var(--font)', color: 'var(--t2)' }}>{l}</td>
                        <td style={{ textAlign: 'right', padding: '3px 8px', color: 'var(--t2)' }}>{fmtK(r.omzetFact[i])}</td>
                        <td style={{ textAlign: 'right', padding: '3px 8px', color: 'var(--t2)' }}>{fmtK(r.ohw[i])}</td>
                        {metMh && <td style={{ textAlign: 'right', padding: '3px 8px', color: 'var(--t2)' }}>{fmtK(r.mhOmzet[i])}</td>}
                        <td style={{ textAlign: 'right', padding: '3px 8px', fontWeight: 600 }}>{fmtK(r.omzet[i])}</td>
                        <td style={{ textAlign: 'right', padding: '3px 8px', color: 'var(--t3)' }}>{Math.round(r.uren[i]).toLocaleString('nl-NL')}</td>
                        <td style={{ textAlign: 'right', padding: '3px 8px', color: 'var(--t2)' }}>{fmtK(kst)}</td>
                        <td style={{ textAlign: 'right', padding: '3px 8px', fontWeight: 700, color: r.marge[i] >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtK(r.marge[i])}</td>
                        <td style={{ textAlign: 'right', padding: '3px 0 3px 8px', color: 'var(--t2)' }}>{pct == null ? '—' : `${Math.round(pct)}%`}</td>
                      </tr>
                    )
                  })}
                  {(() => {
                    const r = detail.mr
                    const n = MARGE_MAANDEN
                    const omz = som(r.omzet, n), mrg = som(r.marge, n), kst = omz - mrg
                    return (
                      <tr style={{ borderTop: '2px solid var(--bd3)', color: 'var(--t1)', fontWeight: 700 }}>
                        <td style={{ padding: '4px 10px 3px 0', fontFamily: 'var(--font)' }}>YTD</td>
                        <td style={{ textAlign: 'right', padding: '4px 8px' }}>{fmtK(som(r.omzetFact, n))}</td>
                        <td style={{ textAlign: 'right', padding: '4px 8px' }}>{fmtK(som(r.ohw, n))}</td>
                        {metMh && <td style={{ textAlign: 'right', padding: '4px 8px' }}>{fmtK(som(r.mhOmzet, n))}</td>}
                        <td style={{ textAlign: 'right', padding: '4px 8px' }}>{fmtK(omz)}</td>
                        <td style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--t3)' }}>{Math.round(som(r.uren, n)).toLocaleString('nl-NL')}</td>
                        <td style={{ textAlign: 'right', padding: '4px 8px' }}>{fmtK(kst)}</td>
                        <td style={{ textAlign: 'right', padding: '4px 8px', color: mrg >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtK(mrg)}</td>
                        <td style={{ textAlign: 'right', padding: '4px 0 4px 8px' }}>{omz !== 0 ? `${Math.round(mrg / Math.abs(omz) * 100)}%` : '—'}</td>
                      </tr>
                    )
                  })()}
                </tbody>
              </table>
              {detail.projecten.length > 0 && (
                <div style={{ minWidth: 420, flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
                    Grootste projecten (YTD, op |marge|)
                  </div>
                  <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
                    <thead>
                      <tr style={{ color: 'var(--t3)' }}>
                        <th style={{ textAlign: 'left', padding: '2px 6px 2px 0', fontWeight: 600 }}>Project</th>
                        <th style={{ textAlign: 'left', padding: '2px 6px', fontWeight: 600 }}>Klant</th>
                        <th style={{ textAlign: 'right', padding: '2px 6px', fontWeight: 600 }}>Omzet</th>
                        <th style={{ textAlign: 'right', padding: '2px 6px', fontWeight: 600 }}>Kosten</th>
                        <th style={{ textAlign: 'right', padding: '2px 0 2px 6px', fontWeight: 600 }}>Marge</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.projecten.map(p => (
                        <tr key={p.id} style={{ borderTop: '1px solid var(--bd2)', color: 'var(--t1)' }}>
                          <td style={{ padding: '3px 6px 3px 0', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${p.id} ${p.naam}${p.geenUren ? ' — geen uren geboekt: kosten onbekend (inhuur/onderaanneming/fixed price)' : ''}`}>
                            {p.geenUren && <span style={{ color: 'var(--amber)', marginRight: 4 }} aria-label="geen uren geboekt">⚠</span>}
                            <span style={{ fontFamily: 'var(--mono)', color: 'var(--t2)' }}>{p.id}</span> {p.naam}
                          </td>
                          <td style={{ padding: '3px 6px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--t2)' }} title={p.klant}>{p.klant}</td>
                          <td style={{ textAlign: 'right', padding: '3px 6px', fontFamily: 'var(--mono)' }}>{fmtK(p.omzet + p.ohw)}</td>
                          <td style={{ textAlign: 'right', padding: '3px 6px', fontFamily: 'var(--mono)', color: 'var(--t2)' }}>{fmtK(p.kosten)}</td>
                          <td style={{ textAlign: 'right', padding: '3px 0 3px 6px', fontFamily: 'var(--mono)', fontWeight: 700, color: p.marge >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtK(p.marge)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {metric === 'omzet' && <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 10 }}>* lopende maand (nog niet volledig gefactureerd)</div>}
        </div>
      )}

      {/* ── Aansluiting met de P&L (marge-modus) ── */}
      {metric === 'marge' && aansluiting && (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)', marginBottom: 8 }}>
            Aansluiting marge-model ↔ P&amp;L (YTD t/m {MAAND_LABELS[MARGE_MAANDEN - 1]} 2026)
          </div>
          <table style={{ borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--mono)' }}>
            <thead>
              <tr style={{ color: 'var(--t2)', fontFamily: 'var(--font)' }}>
                <th style={{ textAlign: 'left', padding: '3px 12px 3px 0', fontWeight: 600 }}>Entiteit</th>
                <th style={{ textAlign: 'right', padding: '3px 10px', fontWeight: 600 }}>Omzet toegerekend</th>
                <th style={{ textAlign: 'right', padding: '3px 10px', fontWeight: 600 }}>P&amp;L netto-omzet</th>
                <th style={{ textAlign: 'right', padding: '3px 10px', fontWeight: 600 }}>Dekking</th>
                <th style={{ textAlign: 'right', padding: '3px 10px', fontWeight: 600 }}>Urenkosten</th>
                <th style={{ textAlign: 'right', padding: '3px 10px', fontWeight: 600 }}>w.v. geschat tarief</th>
                <th style={{ textAlign: 'right', padding: '3px 10px', fontWeight: 600 }}>w.v. missing hours</th>
                <th style={{ textAlign: 'right', padding: '3px 10px', fontWeight: 600 }}>Omzet zonder uren</th>
                <th style={{ textAlign: 'right', padding: '3px 10px', fontWeight: 600 }}>Intern (geen omzet)</th>
                <th style={{ textAlign: 'right', padding: '3px 10px', fontWeight: 600 }}>Marge model</th>
                <th style={{ textAlign: 'right', padding: '3px 0 3px 10px', fontWeight: 600 }}>P&amp;L EBITDA</th>
              </tr>
            </thead>
            <tbody>
              {aansluiting.map(a => (
                <tr key={a.ent} style={{ borderTop: '1px solid var(--bd2)', color: 'var(--t1)' }}>
                  <td style={{ padding: '3px 12px 3px 0', fontFamily: 'var(--font)', fontWeight: 600 }}>{a.ent}</td>
                  <td style={{ textAlign: 'right', padding: '3px 10px' }}>{fmtEur(a.omzetToeg)}</td>
                  <td style={{ textAlign: 'right', padding: '3px 10px', color: 'var(--t2)' }}>{fmtEur(a.plOmzet)}</td>
                  <td style={{ textAlign: 'right', padding: '3px 10px', color: 'var(--t2)' }}>{a.plOmzet ? `${Math.round(a.omzetToeg / a.plOmzet * 100)}%` : '—'}</td>
                  <td style={{ textAlign: 'right', padding: '3px 10px' }}>{fmtEur(a.kosten + a.fallback)}</td>
                  <td style={{ textAlign: 'right', padding: '3px 10px', color: 'var(--amber)' }}>{a.kosten + a.fallback ? `${Math.round(a.fallback / (a.kosten + a.fallback) * 100)}%` : '—'}</td>
                  <td style={{ textAlign: 'right', padding: '3px 10px', color: 'var(--t2)' }} title="Missing hours (nog niet geboekte uren) in de toegerekende omzet; Projects = schatting">{metMh && a.mhOmzet ? fmtEur(a.mhOmzet) : '—'}</td>
                  <td style={{ textAlign: 'right', padding: '3px 10px', color: 'var(--amber)' }} title="Omzet op projecten zonder geboekte uren — kosten (inhuur/onderaanneming/fixed price) onbekend, marge overschat">{a.zonderUren ? fmtEur(a.zonderUren) : '—'}</td>
                  <td style={{ textAlign: 'right', padding: '3px 10px', color: 'var(--t2)' }}>{a.intern ? fmtEur(a.intern) : '—'}</td>
                  <td style={{ textAlign: 'right', padding: '3px 10px', fontWeight: 700, color: a.marge >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtEur(a.marge)}</td>
                  <td style={{ textAlign: 'right', padding: '3px 0 3px 10px', color: 'var(--t2)' }}>{fmtEur(a.plEbitda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 10.5, color: 'var(--t2)', marginTop: 10, lineHeight: 1.6 }}>
            Het model rekent alleen wat aan een klantproject te koppelen is: omzet = facturatie per project + mutatie van
            U-/D-facturatie, conceptfacturen en de OHW-eenhedenlijst; kosten = productieve uren × kostprijs+AK
            (tarievenbestand P4 2026, kolom F). Niet toegerekend: handmatige OHW-posten (indexaties, voorzieningen,
            fees), vooruitgefactureerde licenties (Software), directe inkoop, autokosten en overige personeelskosten.
            Omdat de kostprijs+AK al een opslag voor algemene kosten bevat, ligt de modelmarge qua niveau tussen
            brutomarge en EBITDA in. {MARGE_META.zonderTarief.length} medewerkers ({Math.round(MARGE_META.urenZonderTarief / MARGE_META.urenTotaal * 100)}% van de uren)
            staan niet in het tarievenbestand en zijn op de mediaan van hun bedrijf gezet (kolom "geschat tarief").
            OHW-eenhedensnapshots van maart en juli ontbreken en zijn lineair geïnterpoleerd. Projecten met omzet maar
            zonder geboekte uren (⚠ in de projectenlijst, kolom "Omzet zonder uren") betreffen inhuur, onderaanneming of
            fixed price: hun kosten zitten niet in het model en hun marge is dus overschat.
            {' '}Missing hours (nog niet geboekte/goedgekeurde uren; maandstand uit de OHW-administratie) zijn per
            medewerker over diens projecten verdeeld — bij Consultancy-detachering is dat exact, bij Projects een
            schatting naar rato van geschreven uren; met het vinkje "incl. missing hours" zet je ze uit.
          </div>
        </div>
      )}

      {/* ── Bronvermelding ── */}
      <div style={{ fontSize: 10, color: 'var(--t3)', lineHeight: 1.6 }}>
        {metric === 'omzet' ? (
          <>Bron: {MARKT_META.bron}, peildatum {MARKT_META.peildatum}. Omzet = gefactureerde nettowaarde per klant;
          entiteit via verantwoordelijke eenheid op de factuur (met factuurnummer-prefix als fallback), marktsegment
          conform SAP aangevuld met de handmatige toewijzing. Interne TPG-facturen, TPG Spanje en de
          holding-/lease-administratie zijn uitgesloten. Dit is factuurvolume — geen netto-omzet uit de P&amp;L
          (OHW-mutaties en periodetoerekening zitten er niet in).</>
        ) : (
          <>Bron: {MARGE_META.urenBron}; {MARGE_META.tarievenBron}; SAP-overzichten per maand (U-/D-facturatie,
          conceptfacturen, OHW-eenheden) en factuurvolume. Peildatum {MARGE_META.peildatum}. Kosten volgen het
          project — IC-uren van een andere BV tellen mee bij het project waar ze op geschreven zijn. Eenheden-OHW
          telt als Telecom, behalve de projecten van Feron van Hoeven (Civil).</>
        )}
      </div>
    </div>
  )
}
