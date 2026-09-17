import { useMemo, useState } from 'react'
import {
  marktOmzet, marktTopKlanten, MARKT_ENTITIES, MARKT_SEGMENTS, MARKT_META,
} from '../../data/customerRevenue'
import type { MarktEntity, MarktSegment } from '../../data/customerRevenue'

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

function fmtK(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `€ ${(v / 1_000_000).toFixed(2).replace('.', ',')}M`
  return `€ ${Math.round(v / 1000)}k`
}

/** Maandreeks (12 posities) voor een cel; 'totaal'-assen sommeren. */
function reeks(jaar: '2024' | '2025' | '2026', ent: MarktEntity | 'totaal', seg: MarktSegment | 'totaal'): number[] {
  const ents = ent === 'totaal' ? [...MARKT_ENTITIES] : [ent]
  const segs = seg === 'totaal' ? [...MARKT_SEGMENTS] : [seg]
  const out = new Array(12).fill(0)
  for (const e of ents) for (const s of segs) {
    const arr = marktOmzet[jaar][e][s] ?? []
    for (let i = 0; i < 12; i++) out[i] += arr[i] ?? 0
  }
  return out
}

const som = (arr: number[], t: number) => arr.slice(0, t).reduce((a, b) => a + b, 0)

interface SparkProps { y26: number[]; y25: number[]; kleur: string; totMaand: number }
function Sparkline({ y26, y25, kleur, totMaand }: SparkProps) {
  const W = 116, H = 30, P = 2
  const max = Math.max(...y26.slice(0, totMaand).map(Math.abs), ...y25.map(Math.abs), 1)
  const x = (i: number) => P + (i / 11) * (W - 2 * P)
  const y = (v: number) => H - P - ((v + max) / (2 * max)) * (H - 2 * P)
  const pad = (vals: number[], n: number) =>
    vals.slice(0, n).map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <svg width={W} height={H} style={{ display: 'block' }} aria-hidden="true">
      <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="var(--bd2)" strokeWidth={1} />
      <polyline points={pad(y25, 12)} fill="none" stroke="var(--t3)" strokeWidth={1.5} strokeDasharray="3 3" opacity={0.7} />
      <polyline points={pad(y26, totMaand)} fill="none" stroke={kleur} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

interface TileProps {
  ent: MarktEntity | 'totaal'
  seg: MarktSegment | 'totaal'
  mode: 'maand' | 'ytd'
  maand: number           // 1-12
  selected: boolean
  onSelect: () => void
}
function Tile({ ent, seg, mode, maand, selected, onSelect }: TileProps) {
  const y26 = reeks('2026', ent, seg)
  const y25 = reeks('2025', ent, seg)
  const val = mode === 'maand' ? (y26[maand - 1] ?? 0) : som(y26, maand)
  const ref = mode === 'maand' ? (y25[maand - 1] ?? 0) : som(y25, maand)
  const pct = ref !== 0 ? ((val - ref) / Math.abs(ref)) * 100 : null
  const leeg = val === 0 && ref === 0
  const pos = (pct ?? 0) >= 0
  const kleur = ent === 'totaal' ? 'var(--blue)' : ENT_COLORS[ent]

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
      title="Klik voor maanddetail en top-klanten"
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
        {pct != null && !leeg && (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: pos ? 'var(--green)' : 'var(--red)', whiteSpace: 'nowrap' }}>
            {pos ? '▲' : '▼'} {Math.abs(pct).toFixed(0)}%
          </span>
        )}
        {pct == null && !leeg && (
          <span style={{ fontSize: 10, color: 'var(--t3)' }}>nieuw</span>
        )}
      </div>
      {!leeg && <Sparkline y26={y26} y25={y25} kleur={kleur} totMaand={MARKT_META.laatsteVolledigeMaand + (MARKT_META.septemberLopend ? 1 : 0)} />}
      {!leeg && (
        <div style={{ fontSize: 9.5, color: 'var(--t3)' }}>
          {mode === 'maand' ? MAAND_LABELS[maand - 1] : `YTD t/m ${MAAND_LABELS[maand - 1]}`} · 2025: {fmtK(ref)}
        </div>
      )}
    </button>
  )
}

export function MarktTab() {
  const [mode, setMode] = useState<'maand' | 'ytd'>('ytd')
  const [maand, setMaand] = useState<number>(MARKT_META.laatsteVolledigeMaand)
  const [sel, setSel] = useState<{ ent: MarktEntity | 'totaal'; seg: MarktSegment | 'totaal' } | null>(null)

  const maxMaand = MARKT_META.laatsteVolledigeMaand + (MARKT_META.septemberLopend ? 1 : 0)

  const detail = useMemo(() => {
    if (!sel) return null
    const y26 = reeks('2026', sel.ent, sel.seg)
    const y25 = reeks('2025', sel.ent, sel.seg)
    const y24 = reeks('2024', sel.ent, sel.seg)
    const top = sel.ent !== 'totaal' && sel.seg !== 'totaal'
      ? (marktTopKlanten[`${sel.ent}|${sel.seg}`] ?? [])
      : []
    return { y26, y25, y24, top }
  }, [sel])

  return (
    <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── Controls ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--t1)' }}>Omzet per markt × entiteit</div>
          <div style={{ fontSize: 11, color: 'var(--t2)' }}>
            Gefactureerde nettowaarde per marktsegment, vergeleken met dezelfde periode 2025
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 0, border: '1px solid var(--bd2)', borderRadius: 7, overflow: 'hidden' }}>
          {(['ytd', 'maand'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: mode === m ? 700 : 500,
                background: mode === m ? 'var(--bg4)' : 'var(--bg2)',
                color: mode === m ? 'var(--t1)' : 'var(--t2)',
                border: 'none', cursor: 'pointer', fontFamily: 'var(--font)',
              }}
            >
              {m === 'ytd' ? 'YTD' : 'Per maand'}
            </button>
          ))}
        </div>
        <select
          value={maand}
          onChange={e => setMaand(Number(e.target.value))}
          style={{
            padding: '6px 10px', fontSize: 12, borderRadius: 7,
            background: 'var(--bg2)', color: 'var(--t1)', border: '1px solid var(--bd2)', fontFamily: 'var(--font)',
          }}
        >
          {MAAND_LABELS.slice(0, maxMaand).map((l, i) => (
            <option key={l} value={i + 1}>
              {mode === 'ytd' ? `t/m ${l}` : l} 2026{i + 1 > MARKT_META.laatsteVolledigeMaand ? ' (lopend)' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* ── Legenda ── */}
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', fontSize: 10.5, color: 'var(--t2)' }}>
        <span><svg width="26" height="8" style={{ verticalAlign: 'middle', marginRight: 4 }}><line x1="1" x2="25" y1="4" y2="4" stroke="var(--t1)" strokeWidth="2" /></svg>2026 (t/m {MAAND_LABELS[maxMaand - 1]})</span>
        <span><svg width="26" height="8" style={{ verticalAlign: 'middle', marginRight: 4 }}><line x1="1" x2="25" y1="4" y2="4" stroke="var(--t3)" strokeWidth="1.5" strokeDasharray="3 3" /></svg>2025 (referentie, hele jaar)</span>
        <span style={{ color: 'var(--green)', fontWeight: 600 }}>▲ boven 2025</span>
        <span style={{ color: 'var(--red)', fontWeight: 600 }}>▼ onder 2025</span>
      </div>

      {/* ── Matrix ── */}
      <div className="card" style={{ padding: 14, overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `110px repeat(${MARKT_SEGMENTS.length + 1}, minmax(132px, 1fr))`, gap: 8, minWidth: 1100 }}>
          {/* kop-rij */}
          <div />
          {MARKT_SEGMENTS.map(s => (
            <div key={s} style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.06em', alignSelf: 'end', padding: '0 2px' }}>
              {SEG_LABELS[s] ?? s}
            </div>
          ))}
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--t1)', textTransform: 'uppercase', letterSpacing: '.06em', alignSelf: 'end', padding: '0 2px' }}>
            Totaal
          </div>

          {/* entiteit-rijen */}
          {MARKT_ENTITIES.map(ent => (
            <div key={ent} style={{ display: 'contents' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, color: 'var(--t1)' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: ENT_COLORS[ent], flexShrink: 0 }} />
                {ent}
              </div>
              {MARKT_SEGMENTS.map(seg => (
                <Tile
                  key={`${ent}|${seg}`}
                  ent={ent} seg={seg} mode={mode} maand={maand}
                  selected={sel?.ent === ent && sel?.seg === seg}
                  onSelect={() => setSel(prev => prev?.ent === ent && prev?.seg === seg ? null : { ent, seg })}
                />
              ))}
              <Tile
                ent={ent} seg="totaal" mode={mode} maand={maand}
                selected={sel?.ent === ent && sel?.seg === 'totaal'}
                onSelect={() => setSel(prev => prev?.ent === ent && prev?.seg === 'totaal' ? null : { ent, seg: 'totaal' })}
              />
            </div>
          ))}

          {/* totaal-rij */}
          <div style={{ display: 'contents' }}>
            <div style={{ display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 700, color: 'var(--t1)' }}>Totaal</div>
            {MARKT_SEGMENTS.map(seg => (
              <Tile
                key={`tot|${seg}`}
                ent="totaal" seg={seg} mode={mode} maand={maand}
                selected={sel?.ent === 'totaal' && sel?.seg === seg}
                onSelect={() => setSel(prev => prev?.ent === 'totaal' && prev?.seg === seg ? null : { ent: 'totaal', seg })}
              />
            ))}
            <Tile
              ent="totaal" seg="totaal" mode={mode} maand={maand}
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
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {/* maandtabel */}
            <table style={{ borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--mono)' }}>
              <thead>
                <tr style={{ color: 'var(--t2)', fontFamily: 'var(--font)' }}>
                  <th style={{ textAlign: 'left', padding: '3px 10px 3px 0', fontWeight: 600 }}>Maand</th>
                  <th style={{ textAlign: 'right', padding: '3px 10px', fontWeight: 600 }}>2024</th>
                  <th style={{ textAlign: 'right', padding: '3px 10px', fontWeight: 600 }}>2025</th>
                  <th style={{ textAlign: 'right', padding: '3px 10px', fontWeight: 600 }}>2026</th>
                  <th style={{ textAlign: 'right', padding: '3px 0 3px 10px', fontWeight: 600 }}>Δ 25→26</th>
                </tr>
              </thead>
              <tbody>
                {MAAND_LABELS.map((l, i) => {
                  const v26 = i < maxMaand ? detail.y26[i] : null
                  const v25 = detail.y25[i]
                  const v24 = detail.y24[i]
                  const dpct = v26 != null && v25 !== 0 ? ((v26 - v25) / Math.abs(v25)) * 100 : null
                  return (
                    <tr key={l} style={{ borderTop: '1px solid var(--bd2)', color: 'var(--t1)' }}>
                      <td style={{ padding: '3px 10px 3px 0', fontFamily: 'var(--font)', color: 'var(--t2)' }}>
                        {l}{i + 1 > MARKT_META.laatsteVolledigeMaand && i < maxMaand ? ' *' : ''}
                      </td>
                      <td style={{ textAlign: 'right', padding: '3px 10px', color: 'var(--t3)' }}>{fmtK(v24)}</td>
                      <td style={{ textAlign: 'right', padding: '3px 10px', color: 'var(--t2)' }}>{fmtK(v25)}</td>
                      <td style={{ textAlign: 'right', padding: '3px 10px', fontWeight: 700 }}>{v26 == null ? '—' : fmtK(v26)}</td>
                      <td style={{ textAlign: 'right', padding: '3px 0 3px 10px', color: dpct == null ? 'var(--t3)' : dpct >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                        {dpct == null ? '—' : `${dpct >= 0 ? '+' : ''}${dpct.toFixed(0)}%`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {/* top klanten */}
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
          <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 10 }}>* lopende maand (nog niet volledig gefactureerd)</div>
        </div>
      )}

      {/* ── Bronvermelding ── */}
      <div style={{ fontSize: 10, color: 'var(--t3)', lineHeight: 1.6 }}>
        Bron: {MARKT_META.bron}, peildatum {MARKT_META.peildatum}. Omzet = gefactureerde nettowaarde per klant;
        entiteit via verantwoordelijke eenheid op de factuur, marktsegment conform het sales dashboard.
        Interne TPG-facturen en TPG Spanje zijn uitgesloten. Dit is factuurvolume — geen netto-omzet uit de P&amp;L
        (OHW-mutaties en periodetoerekening zitten er niet in).
      </div>
    </div>
  )
}
