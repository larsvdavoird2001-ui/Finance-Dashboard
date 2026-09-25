import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { DetailProject, DetailEmp, WeekRow } from '../../data/marginDetail'
import { MARGE_MAANDEN } from '../../data/marginData'

type DetailModule = typeof import('../../data/marginDetail')

const MAAND_LABELS = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']
const TYPE_LABEL: Record<string, string> = {
  D: 'detachering', U: 'urenproject', E: 'eenheden', S: 'software', F: 'fixed price', G: 'licentie/product', T: 'training',
}
const fmtK = (v: number) => Math.abs(v) >= 1_000_000 ? `€ ${(v / 1_000_000).toFixed(2).replace('.', ',')}M` : `€ ${Math.round(v / 1000)}k`
const fmtEur = (v: number) => `€ ${Math.round(v).toLocaleString('nl-NL')}`
const som = (a: number[], n = MARGE_MAANDEN) => a.slice(0, n).reduce((x, y) => x + y, 0)
const pctStr = (marge: number, omzet: number) => omzet !== 0 ? `${Math.round(marge / Math.abs(omzet) * 100)}%` : '—'

interface Kpi { omzet: number; kosten: number; marge: number; uren: number; geenUren: boolean; mh: number }
function kpi(p: DetailProject, metMh: boolean): Kpi {
  const omzet = som(p.omzet) + som(p.ohw) + (metMh ? som(p.mhOmzet) : 0)
  const kosten = som(p.kosten) + (metMh ? som(p.mhKosten) : 0)
  const uren = som(p.uren)
  return { omzet, kosten, marge: omzet - kosten, uren, geenUren: uren === 0 && omzet !== 0, mh: som(p.mhOmzet) }
}

const th = (align: 'left' | 'right' = 'right'): CSSProperties => ({ textAlign: align, padding: '3px 8px', fontWeight: 600, whiteSpace: 'nowrap' })
const td = (align: 'left' | 'right' = 'right', extra: CSSProperties = {}): CSSProperties => ({ textAlign: align, padding: '3px 8px', whiteSpace: 'nowrap', ...extra })
const margeColor = (v: number) => v >= 0 ? 'var(--green)' : 'var(--red)'
const linkStyle: CSSProperties = { background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 11.5, padding: 0, textAlign: 'left' }

interface Props {
  ent: string | 'totaal'
  seg: string | 'totaal'
  metMh: boolean
}

export function MargeDrill({ ent, seg, metMh }: Props) {
  const [mod, setMod] = useState<DetailModule | null>(null)
  const [klant, setKlant] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    import('../../data/marginDetail').then(m => { if (alive) setMod(m) })
    return () => { alive = false }
  }, [])
  // Terug naar klantniveau als de cel wijzigt
  useEffect(() => { setKlant(null); setProjectId(null) }, [ent, seg])

  const projecten = useMemo(() => {
    if (!mod) return []
    return mod.detailProjecten.filter(p => !p.intern && (ent === 'totaal' || p.ent === ent) && (seg === 'totaal' || p.seg === seg))
  }, [mod, ent, seg])

  const klanten = useMemo(() => {
    const byKlant = new Map<string, { klant: string; n: number; omzet: number; kosten: number; uren: number; mh: number }>()
    for (const p of projecten) {
      const k = kpi(p, metMh)
      const key = p.klant || '(geen klant)'
      const row = byKlant.get(key) ?? { klant: key, n: 0, omzet: 0, kosten: 0, uren: 0, mh: 0 }
      row.n++; row.omzet += k.omzet; row.kosten += k.kosten; row.uren += k.uren; row.mh += k.mh
      byKlant.set(key, row)
    }
    return [...byKlant.values()].sort((a, b) => Math.abs(b.omzet) - Math.abs(a.omzet))
  }, [projecten, metMh])

  if (!mod) return <div style={{ fontSize: 11, color: 'var(--t3)' }}>Detaildata laden…</div>

  const project = projectId ? projecten.find(p => p.id === projectId) ?? null : null
  const klantProjecten = klant ? projecten.filter(p => (p.klant || '(geen klant)') === klant).sort((a, b) => Math.abs(kpi(b, metMh).omzet) - Math.abs(kpi(a, metMh).omzet)) : []

  return (
    <div style={{ marginTop: 14 }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, marginBottom: 8, flexWrap: 'wrap' }}>
        <button style={{ ...linkStyle, fontWeight: klant ? 500 : 700, color: klant ? 'var(--blue)' : 'var(--t1)' }} onClick={() => { setKlant(null); setProjectId(null) }}>Klanten ({klanten.length})</button>
        {klant && <>
          <span style={{ color: 'var(--t3)' }}>›</span>
          <button style={{ ...linkStyle, fontWeight: project ? 500 : 700, color: project ? 'var(--blue)' : 'var(--t1)' }} onClick={() => setProjectId(null)}>{klant} ({klantProjecten.length} projecten)</button>
        </>}
        {project && <>
          <span style={{ color: 'var(--t3)' }}>›</span>
          <span style={{ fontWeight: 700, color: 'var(--t1)' }}><span style={{ fontFamily: 'var(--mono)', color: 'var(--t2)' }}>{project.id}</span> {project.naam}</span>
        </>}
      </div>

      {/* Niveau 1: klanten */}
      {!klant && (
        <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
          <thead>
            <tr style={{ color: 'var(--t3)' }}>
              <th style={th('left')}>Klant</th><th style={th()}>Proj.</th><th style={th()}>Omzet</th><th style={th()}>Kosten</th><th style={th()}>Marge</th><th style={th()}>%</th><th style={th()}>Uren</th>
            </tr>
          </thead>
          <tbody>
            {klanten.slice(0, 60).map(r => (
              <tr key={r.klant} style={{ borderTop: '1px solid var(--bd2)', color: 'var(--t1)' }}>
                <td style={td('left', { maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' })}><button style={linkStyle} onClick={() => setKlant(r.klant)} title="Klik voor projecten van deze klant">{r.klant}</button></td>
                <td style={td('right', { color: 'var(--t3)' })}>{r.n}</td>
                <td style={td('right', { fontFamily: 'var(--mono)' })}>{fmtK(r.omzet)}</td>
                <td style={td('right', { fontFamily: 'var(--mono)', color: 'var(--t2)' })}>{fmtK(r.kosten)}</td>
                <td style={td('right', { fontFamily: 'var(--mono)', fontWeight: 700, color: margeColor(r.omzet - r.kosten) })}>{fmtK(r.omzet - r.kosten)}</td>
                <td style={td('right', { color: 'var(--t2)' })}>{pctStr(r.omzet - r.kosten, r.omzet)}</td>
                <td style={td('right', { color: 'var(--t3)' })}>{Math.round(r.uren).toLocaleString('nl-NL')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Niveau 2: projecten van klant */}
      {klant && !project && (
        <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
          <thead>
            <tr style={{ color: 'var(--t3)' }}>
              <th style={th('left')}>Project</th><th style={th('left')}>Type</th><th style={th('left')}>Segment</th><th style={th()}>Omzet</th><th style={th()}>Kosten</th><th style={th()}>Marge</th><th style={th()}>%</th><th style={th()}>Uren</th>
            </tr>
          </thead>
          <tbody>
            {klantProjecten.map(p => {
              const k = kpi(p, metMh)
              return (
                <tr key={p.id} style={{ borderTop: '1px solid var(--bd2)', color: 'var(--t1)' }}>
                  <td style={td('left', { maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' })}>
                    {k.geenUren && <span style={{ color: 'var(--amber)', marginRight: 4 }} title="Los dossier: omzet zonder geboekte uren — hangt niet aan projectwerk (telt wel mee als omzet)">◌</span>}
                    <button style={linkStyle} onClick={() => setProjectId(p.id)} title="Klik voor medewerkers en weekoverzicht"><span style={{ fontFamily: 'var(--mono)', color: 'var(--t2)' }}>{p.id}</span> {p.naam}</button>
                  </td>
                  <td style={td('left', { color: 'var(--t2)' })}>{TYPE_LABEL[p.id[0]] ?? p.id[0]}</td>
                  <td style={td('left', { color: 'var(--t2)' })}>{p.seg}</td>
                  <td style={td('right', { fontFamily: 'var(--mono)' })}>{fmtK(k.omzet)}</td>
                  <td style={td('right', { fontFamily: 'var(--mono)', color: 'var(--t2)' })}>{fmtK(k.kosten)}</td>
                  <td style={td('right', { fontFamily: 'var(--mono)', fontWeight: 700, color: margeColor(k.marge) })}>{fmtK(k.marge)}</td>
                  <td style={td('right', { color: 'var(--t2)' })}>{pctStr(k.marge, k.omzet)}</td>
                  <td style={td('right', { color: 'var(--t3)' })}>{Math.round(k.uren).toLocaleString('nl-NL')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {/* Niveau 3: project */}
      {project && <ProjectDetail p={project} metMh={metMh} />}
    </div>
  )
}

function ProjectDetail({ p, metMh }: { p: DetailProject; metMh: boolean }) {
  const k = kpi(p, metMh)
  const isE = p.id.startsWith('E-')
  const weeks: WeekRow[] = p.weeks ?? []
  const [alleWeken, setAlleWeken] = useState(false)
  const wRows = alleWeken ? weeks : weeks.filter(w => w.productie !== 0 || w.uren !== 0)
  const wTot = weeks.reduce((a, w) => ({ productie: a.productie + w.productie, bevestigd: a.bevestigd + w.bevestigd, uren: a.uren + w.uren, kosten: a.kosten + w.kosten }), { productie: 0, bevestigd: 0, uren: 0, kosten: 0 })
  const modelOmzetYtd = som(p.omzet) + som(p.ohw)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* KPI-regel */}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--t2)' }}>
        <span>Klant <b style={{ color: 'var(--t1)' }}>{p.klant || '—'}</b></span>
        <span>{p.ent} · {p.seg} · {TYPE_LABEL[p.id[0]] ?? p.id[0]}</span>
        <span>Omzet YTD <b style={{ color: 'var(--t1)', fontFamily: 'var(--mono)' }}>{fmtEur(k.omzet)}</b></span>
        <span>Kosten <b style={{ color: 'var(--t1)', fontFamily: 'var(--mono)' }}>{fmtEur(k.kosten)}</b></span>
        <span>Marge <b style={{ color: margeColor(k.marge), fontFamily: 'var(--mono)' }}>{fmtEur(k.marge)}</b> ({pctStr(k.marge, k.omzet)})</span>
        <span>Uren <b style={{ color: 'var(--t1)', fontFamily: 'var(--mono)' }}>{Math.round(k.uren).toLocaleString('nl-NL')}</b></span>
        {k.geenUren && <span style={{ color: 'var(--amber)' }}>◌ los dossier — omzet zonder geboekte uren, hangt niet aan projectwerk</span>}
      </div>

      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Maandreeks */}
        <table style={{ borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--mono)' }}>
          <thead>
            <tr style={{ color: 'var(--t3)', fontFamily: 'var(--font)' }}>
              <th style={th('left')}>Maand</th><th style={th()}>Fact.</th><th style={th()}>Δ OHW</th>{metMh && <th style={th()}>Δ MH</th>}<th style={th()}>Uren</th><th style={th()}>Kosten</th><th style={th()}>Marge</th>
            </tr>
          </thead>
          <tbody>
            {MAAND_LABELS.slice(0, MARGE_MAANDEN).map((l, i) => {
              const omz = p.omzet[i] + p.ohw[i] + (metMh ? p.mhOmzet[i] : 0)
              const kst = p.kosten[i] + (metMh ? p.mhKosten[i] : 0)
              return (
                <tr key={l} style={{ borderTop: '1px solid var(--bd2)', color: 'var(--t1)' }}>
                  <td style={td('left', { fontFamily: 'var(--font)', color: 'var(--t2)' })}>{l}</td>
                  <td style={td('right', { color: 'var(--t2)' })}>{fmtK(p.omzet[i])}</td>
                  <td style={td('right', { color: 'var(--t2)' })}>{fmtK(p.ohw[i])}</td>
                  {metMh && <td style={td('right', { color: 'var(--t2)' })}>{fmtK(p.mhOmzet[i])}</td>}
                  <td style={td('right', { color: 'var(--t3)' })}>{Math.round(p.uren[i])}</td>
                  <td style={td('right', { color: 'var(--t2)' })}>{fmtK(kst)}</td>
                  <td style={td('right', { fontWeight: 700, color: margeColor(omz - kst) })}>{fmtK(omz - kst)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* Medewerkers */}
        <div style={{ flex: 1, minWidth: 420 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
            Medewerkers op dit project (YTD) — declarabiliteit = klanturen / alle geschreven uren excl. verlof/ziekte
          </div>
          {p.emps.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--amber)' }}>Los dossier: geen uren in de urenexport — de omzet telt mee in de matrix, maar er is geen medewerker of weekproductie aan te koppelen.</div>
          ) : (
            <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
              <thead>
                <tr style={{ color: 'var(--t3)' }}>
                  <th style={th('left')}>Medewerker</th><th style={th('left')}>BV</th><th style={th()}>Uren</th><th style={th()}>Aandeel</th><th style={th()}>Kosten</th><th style={th()}>Declarabel</th>
                </tr>
              </thead>
              <tbody>
                {p.emps.map((e: DetailEmp) => {
                  const u = som(e.uren), c = som(e.kosten)
                  return (
                    <tr key={e.id} style={{ borderTop: '1px solid var(--bd2)', color: 'var(--t1)' }}>
                      <td style={td('left')}>{e.naam}{e.geschat && <span style={{ color: 'var(--amber)', marginLeft: 4 }} title="Niet in tarievenbestand — kostprijs geschat (mediaan van het bedrijf)">≈</span>}</td>
                      <td style={td('left', { color: 'var(--t2)' })}>{e.bedrijf}</td>
                      <td style={td('right', { fontFamily: 'var(--mono)' })}>{Math.round(u).toLocaleString('nl-NL')}</td>
                      <td style={td('right', { color: 'var(--t2)' })}>{k.uren ? `${Math.round(u / k.uren * 100)}%` : '—'}</td>
                      <td style={td('right', { fontFamily: 'var(--mono)', color: 'var(--t2)' })}>{fmtK(c)}</td>
                      <td style={td('right', { fontWeight: 600, color: e.decl == null ? 'var(--t3)' : e.decl >= 80 ? 'var(--green)' : e.decl >= 60 ? 'var(--amber)' : 'var(--red)' })} title="Over alle projecten van deze medewerker, 2026 t/m aug">{e.decl == null ? '—' : `${e.decl}%`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Weekoverzicht (eenheden-projecten) */}
      {isE && (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              Weekoverzicht eenheden — productie (OHW Freezes) vs uren/kosten van die week
            </div>
            <label style={{ fontSize: 10.5, color: 'var(--t3)', cursor: 'pointer' }}>
              <input type="checkbox" checked={alleWeken} onChange={e => setAlleWeken(e.target.checked)} style={{ accentColor: 'var(--blue)', marginRight: 4 }} />
              ook lege weken
            </label>
          </div>
          {weeks.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--amber)' }}>Geen weekproductie (OHW Freezes) en geen weekuren voor dit project gevonden — koppeling via projectnummer "Nummer 2026" niet mogelijk.</div>
          ) : (
            <>
              <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
                <thead>
                  <tr style={{ color: 'var(--t3)' }}>
                    <th style={th('left')}>Week</th><th style={th()}>Productie</th><th style={th()} title="Servicebevestigingen (meters/revisie) uit de Projectadministratie">Bevestigd</th><th style={th()}>Uren</th><th style={th()}>Kosten</th><th style={th()}>Marge wk</th><th style={th('left')}>Medewerkers (uren)</th>
                  </tr>
                </thead>
                <tbody>
                  {wRows.map(w => (
                    <tr key={w.w} style={{ borderTop: '1px solid var(--bd2)', color: 'var(--t1)' }}>
                      <td style={td('left', { fontFamily: 'var(--mono)', color: 'var(--t2)' })} title={w.taken ? w.taken.map(([t, v]) => `${t}: ${fmtEur(v)}`).join('\n') : undefined}>wk {w.w}</td>
                      <td style={td('right', { fontFamily: 'var(--mono)' })}>{fmtEur(w.productie)}</td>
                      <td style={td('right', { fontFamily: 'var(--mono)', color: 'var(--t2)' })}>{w.bevestigd ? fmtEur(w.bevestigd) : '—'}</td>
                      <td style={td('right', { color: 'var(--t3)' })}>{w.uren}</td>
                      <td style={td('right', { fontFamily: 'var(--mono)', color: 'var(--t2)' })}>{fmtEur(w.kosten)}</td>
                      <td style={td('right', { fontFamily: 'var(--mono)', fontWeight: 700, color: margeColor(w.productie - w.kosten) })}>{fmtEur(w.productie - w.kosten)}</td>
                      <td style={{ ...td('left'), whiteSpace: 'normal', color: 'var(--t2)', fontSize: 10.5 }}>{w.emps.map(([n, u]) => `${n} (${u})`).join(', ')}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid var(--bd3)', color: 'var(--t1)', fontWeight: 700 }}>
                    <td style={td('left')}>YTD</td>
                    <td style={td('right', { fontFamily: 'var(--mono)' })}>{fmtEur(wTot.productie)}</td>
                    <td style={td('right', { fontFamily: 'var(--mono)' })}>{wTot.bevestigd ? fmtEur(wTot.bevestigd) : '—'}</td>
                    <td style={td('right')}>{wTot.uren}</td>
                    <td style={td('right', { fontFamily: 'var(--mono)' })}>{fmtEur(wTot.kosten)}</td>
                    <td style={td('right', { fontFamily: 'var(--mono)', color: margeColor(wTot.productie - wTot.kosten) })}>{fmtEur(wTot.productie - wTot.kosten)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
              <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 6, lineHeight: 1.5 }}>
                Productie = "Delta waarde vorige week" uit OHW Trendlijnen - 2026 (OHW Freezes), gekoppeld op projectnummer;
                hover over de week voor de work packages. Weekproductie YTD {fmtEur(wTot.productie)} vs. maandmodel
                (facturatie + Δ OHW) {fmtEur(modelOmzetYtd)}{Math.abs(wTot.productie - modelOmzetYtd) > 1000 ? ` — verschil ${fmtEur(wTot.productie - modelOmzetYtd)} (timing facturatie/OHW-snapshots)` : ''}.
                Uren van de week worden op het project gekoppeld (niet per work package): welke medewerkers in die week aan dit project werkten.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
