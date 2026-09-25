import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { DetailProject, DetailMedewerker, WeekRow, TariefBron } from '../../data/marginDetail'
import { MARGE_MAANDEN } from '../../data/marginData'

type DetailModule = typeof import('../../data/marginDetail')

const MAAND_LABELS = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']
const TYPE_LABEL: Record<string, string> = {
  D: 'detachering', U: 'urenproject', E: 'eenheden', S: 'software', F: 'fixed price', G: 'licentie/product', T: 'training',
}
const fmtK = (v: number) => Math.abs(v) >= 1_000_000 ? `€ ${(v / 1_000_000).toFixed(2).replace('.', ',')}M` : `€ ${Math.round(v / 1000)}k`
const fmtEur = (v: number) => `€ ${Math.round(v).toLocaleString('nl-NL')}`
const fmtU = (v: number) => Math.round(v).toLocaleString('nl-NL')
const pctStr = (marge: number, omzet: number) => omzet !== 0 ? `${Math.round(marge / Math.abs(omzet) * 100)}%` : '—'
const somOver = (a: number[], maanden: number[]) => maanden.reduce((s, i) => s + (a[i] ?? 0), 0)

interface Kpi { omzet: number; kosten: number; marge: number; uren: number; geenUren: boolean; mh: number; mhKosten: number }
function kpiVan(p: DetailProject, metMh: boolean, maanden: number[]): Kpi {
  const s = (a: number[]) => somOver(a, maanden)
  const omzet = s(p.omzet) + s(p.ohw) + (metMh ? s(p.mhOmzet) : 0)
  const kosten = s(p.kosten) + (metMh ? s(p.mhKosten) : 0)
  const uren = s(p.uren)
  return { omzet, kosten, marge: omzet - kosten, uren, geenUren: uren === 0 && omzet !== 0, mh: s(p.mhOmzet), mhKosten: metMh ? s(p.mhKosten) : 0 }
}

const th = (align: 'left' | 'right' = 'right', extra: CSSProperties = {}): CSSProperties => ({ textAlign: align, padding: '3px 8px', fontWeight: 600, whiteSpace: 'nowrap', ...extra })
const td = (align: 'left' | 'right' = 'right', extra: CSSProperties = {}): CSSProperties => ({ textAlign: align, padding: '3px 8px', whiteSpace: 'nowrap', ...extra })
const margeColor = (v: number) => v >= 0 ? 'var(--green)' : 'var(--red)'
const declColor = (v: number | null) => v == null ? 'var(--t3)' : v >= 80 ? 'var(--green)' : v >= 60 ? 'var(--amber)' : 'var(--red)'
// Kostprijs-herkomst van een medewerker die niet in het HC-tarievenbestand staat (scripts/tarieven-aanvulling.json)
const BRON_MARKER: Record<TariefBron, string> = { tarievenbestand: '', ingevuld: '✎', spanje: 'ES', geschat: '≈' }
const BRON_KLEUR: Record<TariefBron, string> = { tarievenbestand: 'inherit', ingevuld: 'var(--t3)', spanje: 'var(--t3)', geschat: 'var(--amber)' }
const BRON_TITEL: Record<TariefBron, string> = {
  tarievenbestand: 'Tarievenbestand',
  ingevuld: 'Niet in tarievenbestand — tarief ingevuld door Lars (invullijst 25-09-2026)',
  spanje: 'Niet in tarievenbestand — Spanje-regel: €35/uur voor alle S.L.-medewerkers (Lars, 25-09-2026)',
  geschat: 'Niet in tarievenbestand en niet ingevuld — geschat op de mediaan kostprijs+AK van het bedrijf',
}
const linkStyle: CSSProperties = { background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 11.5, padding: 0, textAlign: 'left' }
const sectionTitle: CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }

function BronMarker({ bron, tarief }: { bron: TariefBron; tarief: number }) {
  if (bron === 'tarievenbestand') return null
  return <span style={{ color: BRON_KLEUR[bron], marginLeft: 4, fontSize: 10 }} title={`${BRON_TITEL[bron]} — €${tarief}/uur`}>{BRON_MARKER[bron]}</span>
}

/** Uren per soort van één medewerker over de gekozen maanden + beide declarabiliteitsdefinities. */
interface UrenProfiel { totaal: number; klant: number; intern: number; improductief: number; verlof: number; ziekte: number; overig: number; declAlle: number | null; declExcl: number | null }
function urenProfiel(m: DetailMedewerker, maanden: number[]): UrenProfiel {
  const s = (a: number[]) => somOver(a, maanden)
  const klant = s(m.klant), intern = s(m.intern), improductief = s(m.improductief), verlof = s(m.verlof), ziekte = s(m.ziekte), overig = s(m.bijzverlof) + s(m.overig)
  const totaal = klant + intern + improductief + verlof + ziekte + overig
  const werk = klant + intern + improductief + s(m.overig)
  return { totaal, klant, intern, improductief, verlof, ziekte, overig, declAlle: totaal ? Math.round(klant / totaal * 100) : null, declExcl: werk ? Math.round(klant / werk * 100) : null }
}

interface Props {
  ent: string | 'totaal'
  seg: string | 'totaal'
  metMh: boolean
  /** maandindexen (0-based) waarover gerekend wordt: één maand of YTD */
  maanden: number[]
  /** maandtabel van de tegel (gerenderd door MarktTab), naast de klant/project-inzoom */
  maandTabel?: ReactNode
}

/** omzet/kosten = aandeel van de medewerker; projOmzet/projMarge = totaal van de projecten waar hij/zij op schreef */
interface MedewerkerRij { id: number; naam: string; bedrijf: string; bron: TariefBron; tarief: number; urenSel: number; omzet: number; kosten: number; projOmzet: number; projMarge: number; nProj: number; profiel: UrenProfiel }
type SortKey = 'omzet' | 'marge' | 'projOmzet' | 'projMarge' | 'urenSel' | 'declAlle' | 'naam'

export function MargeDrill({ ent, seg, metMh, maanden, maandTabel }: Props) {
  const [mod, setMod] = useState<DetailModule | null>(null)
  const [klant, setKlant] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [empId, setEmpId] = useState<number | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('omzet')
  const [alleRijen, setAlleRijen] = useState(false)

  useEffect(() => {
    let alive = true
    import('../../data/marginDetail').then(m => { if (alive) setMod(m) })
    return () => { alive = false }
  }, [])
  // Terug naar klantniveau als de cel wijzigt
  useEffect(() => { setKlant(null); setProjectId(null); setEmpId(null); setAlleRijen(false) }, [ent, seg])

  const kpi = (p: DetailProject) => kpiVan(p, metMh, maanden)
  const somM = (a: number[]) => somOver(a, maanden)

  const projecten = useMemo(() => {
    if (!mod) return []
    return mod.detailProjecten.filter(p => !p.intern && (ent === 'totaal' || p.ent === ent) && (seg === 'totaal' || p.seg === seg))
  }, [mod, ent, seg])

  const klanten = useMemo(() => {
    const byKlant = new Map<string, { klant: string; n: number; omzet: number; kosten: number; uren: number; mh: number }>()
    for (const p of projecten) {
      const k = kpi(p)
      const key = p.klant || '(geen klant)'
      const row = byKlant.get(key) ?? { klant: key, n: 0, omzet: 0, kosten: 0, uren: 0, mh: 0 }
      row.n++; row.omzet += k.omzet; row.kosten += k.kosten; row.uren += k.uren; row.mh += k.mh
      byKlant.set(key, row)
    }
    return [...byKlant.values()].sort((a, b) => Math.abs(b.omzet) - Math.abs(a.omzet))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projecten, metMh, maanden])

  const project = projectId ? projecten.find(p => p.id === projectId) ?? null : null
  const klantProjecten = klant ? projecten.filter(p => (p.klant || '(geen klant)') === klant).sort((a, b) => Math.abs(kpi(b).omzet) - Math.abs(kpi(a).omzet)) : []
  // De filterset: tegel → klant → project. De medewerkerstabel volgt deze set.
  const filterProj = project ? [project] : klant ? klantProjecten : projecten
  const filterLabel = project ? `project ${project.id} ${project.naam}` : klant ? `klant ${klant}` : `${ent === 'totaal' ? 'alle entiteiten' : ent} × ${seg === 'totaal' ? 'alle segmenten' : seg}`
  const periodeLabel = maanden.length === 1 ? `${MAAND_LABELS[maanden[0]]} 2026` : `YTD t/m ${MAAND_LABELS[MARGE_MAANDEN - 1]} 2026`

  // Medewerkers in de filterset: uren, toegerekende omzet (aandeel in projecturen × projectomzet) en kosten
  const medewerkers = useMemo<{ rijen: MedewerkerRij[]; nietToerekenbaar: number }>(() => {
    if (!mod) return { rijen: [], nietToerekenbaar: 0 }
    const profielen = new Map(mod.detailMedewerkers.map(m => [m.id, m]))
    const map = new Map<number, MedewerkerRij>()
    const rij = (m: DetailMedewerker) => {
      let r = map.get(m.id)
      if (!r) { r = { id: m.id, naam: m.naam, bedrijf: m.bedrijf, bron: m.bron, tarief: m.tarief, urenSel: 0, omzet: 0, kosten: 0, projOmzet: 0, projMarge: 0, nProj: 0, profiel: urenProfiel(m, maanden) }; map.set(m.id, r) }
      return r
    }
    let nietToerekenbaar = 0
    for (const p of filterProj) {
      const k = kpi(p)
      if (k.uren === 0) { nietToerekenbaar += k.omzet; continue }
      for (const e of p.emps) {
        const u = somM(e.uren); if (!u) continue
        const m = profielen.get(e.id); if (!m) continue
        const share = u / k.uren
        const r = rij(m)
        r.urenSel += u; r.omzet += share * k.omzet; r.kosten += somM(e.kosten) + share * k.mhKosten
        r.projOmzet += k.omzet; r.projMarge += k.marge; r.nProj++
      }
    }
    // Op de totaaltegel zonder verdere filter: iedereen uit de urenexport, ook zonder klanturen (declarabiliteit 0%)
    if (ent === 'totaal' && seg === 'totaal' && !klant && !project) for (const m of mod.detailMedewerkers) if (urenProfiel(m, maanden).totaal > 0) rij(m)
    return { rijen: [...map.values()], nietToerekenbaar }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mod, filterProj, metMh, maanden])

  const rijenSorted = useMemo(() => {
    const r = [...medewerkers.rijen]
    const cmp: Record<SortKey, (a: MedewerkerRij, b: MedewerkerRij) => number> = {
      omzet: (a, b) => b.omzet - a.omzet,
      marge: (a, b) => (b.omzet - b.kosten) - (a.omzet - a.kosten),
      projOmzet: (a, b) => b.projOmzet - a.projOmzet,
      projMarge: (a, b) => b.projMarge - a.projMarge,
      urenSel: (a, b) => b.urenSel - a.urenSel,
      declAlle: (a, b) => (b.profiel.declAlle ?? -1) - (a.profiel.declAlle ?? -1),
      naam: (a, b) => a.naam.localeCompare(b.naam),
    }
    return r.sort(cmp[sortKey])
  }, [medewerkers, sortKey])

  if (!mod) return <div style={{ fontSize: 11, color: 'var(--t3)' }}>Detaildata laden…</div>

  const selectedEmp = empId != null ? mod.detailMedewerkers.find(m => m.id === empId) ?? null : null
  const tot = medewerkers.rijen.reduce((a, r) => ({ urenSel: a.urenSel + r.urenSel, omzet: a.omzet + r.omzet, kosten: a.kosten + r.kosten, totaal: a.totaal + r.profiel.totaal, klant: a.klant + r.profiel.klant }), { urenSel: 0, omzet: 0, kosten: 0, totaal: 0, klant: 0 })
  const zichtbaar = alleRijen ? rijenSorted : rijenSorted.slice(0, 40)
  const sortTh = (key: SortKey, label: string, title?: string) => (
    <th style={th('right', { cursor: 'pointer', color: sortKey === key ? 'var(--t1)' : undefined })} title={title ?? 'Klik om te sorteren'} onClick={() => setSortKey(key)}>{label}{sortKey === key ? ' ▾' : ''}</th>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ── Rij 1: maandtabel + klant/project-inzoom ── */}
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
        {maandTabel}
        <div style={{ minWidth: 420, flex: 1 }}>
          <div style={sectionTitle}>Inzoomen op klanten → projecten → weekoverzicht</div>
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
            <span style={{ color: 'var(--t3)', marginLeft: 'auto' }}>{periodeLabel}</span>
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
                    <td style={td('left', { maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' })}><button style={linkStyle} onClick={() => setKlant(r.klant)} title="Klik voor projecten van deze klant (de medewerkerstabel hieronder filtert mee)">{r.klant}</button></td>
                    <td style={td('right', { color: 'var(--t3)' })}>{r.n}</td>
                    <td style={td('right', { fontFamily: 'var(--mono)' })}>{fmtK(r.omzet)}</td>
                    <td style={td('right', { fontFamily: 'var(--mono)', color: 'var(--t2)' })}>{fmtK(r.kosten)}</td>
                    <td style={td('right', { fontFamily: 'var(--mono)', fontWeight: 700, color: margeColor(r.omzet - r.kosten) })}>{fmtK(r.omzet - r.kosten)}</td>
                    <td style={td('right', { color: 'var(--t2)' })}>{pctStr(r.omzet - r.kosten, r.omzet)}</td>
                    <td style={td('right', { color: 'var(--t3)' })}>{fmtU(r.uren)}</td>
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
                  const k = kpi(p)
                  return (
                    <tr key={p.id} style={{ borderTop: '1px solid var(--bd2)', color: 'var(--t1)' }}>
                      <td style={td('left', { maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' })}>
                        {k.geenUren && <span style={{ color: 'var(--amber)', marginRight: 4 }} title="Los dossier: omzet zonder geboekte uren — hangt niet aan projectwerk (telt wel mee als omzet)">◌</span>}
                        <button style={linkStyle} onClick={() => setProjectId(p.id)} title="Klik voor maandreeks en weekoverzicht (de medewerkerstabel hieronder filtert mee)"><span style={{ fontFamily: 'var(--mono)', color: 'var(--t2)' }}>{p.id}</span> {p.naam}</button>
                      </td>
                      <td style={td('left', { color: 'var(--t2)' })}>{TYPE_LABEL[p.id[0]] ?? p.id[0]}</td>
                      <td style={td('left', { color: 'var(--t2)' })}>{p.seg}</td>
                      <td style={td('right', { fontFamily: 'var(--mono)' })}>{fmtK(k.omzet)}</td>
                      <td style={td('right', { fontFamily: 'var(--mono)', color: 'var(--t2)' })}>{fmtK(k.kosten)}</td>
                      <td style={td('right', { fontFamily: 'var(--mono)', fontWeight: 700, color: margeColor(k.marge) })}>{fmtK(k.marge)}</td>
                      <td style={td('right', { color: 'var(--t2)' })}>{pctStr(k.marge, k.omzet)}</td>
                      <td style={td('right', { color: 'var(--t3)' })}>{fmtU(k.uren)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {/* Niveau 3: project */}
          {project && <ProjectDetail p={project} k={kpi(project)} metMh={metMh} periodeLabel={periodeLabel} />}
        </div>
      </div>

      {/* ── Rij 2: medewerkers in de filterset (tweede inzoom-as) ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
          <div style={sectionTitle}>Medewerkers — {filterLabel} · {periodeLabel} ({medewerkers.rijen.length})</div>
          <span style={{ fontSize: 10.5, color: 'var(--t3)' }}>klik op een naam voor de projecten en klanten van die medewerker</span>
        </div>

        {selectedEmp && (
          <MedewerkerDetail
            m={selectedEmp} mod={mod} metMh={metMh} maanden={maanden} periodeLabel={periodeLabel}
            inSelectie={new Set(filterProj.map(p => p.id))}
            onClose={() => setEmpId(null)}
          />
        )}

        {medewerkers.rijen.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--amber)' }}>Geen medewerkers met geschreven uren in deze selectie{medewerkers.nietToerekenbaar ? ` — de omzet (${fmtEur(medewerkers.nietToerekenbaar)}) is een los dossier zonder projectwerk` : ''}.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 10.5, width: '100%' }}>
              <thead>
                <tr style={{ color: 'var(--t3)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  <th colSpan={2} />
                  <th colSpan={5} style={th('left', { color: 'var(--t2)', borderBottom: '1px solid var(--bd2)' })} title="Wat deze medewerker zelf bijdroeg: aandeel in de projecturen × projectomzet, minus eigen urenkosten">Aandeel medewerker</th>
                  <th colSpan={3} style={th('left', { color: 'var(--t2)', borderLeft: '1px solid var(--bd2)', borderBottom: '1px solid var(--bd2)' })} title="Totaal van de projecten (in deze selectie) waar de medewerker op schreef — hele project, niet alleen zijn deel">Projecten totaal</th>
                  <th colSpan={7} style={th('left', { color: 'var(--t2)', borderLeft: '1px solid var(--bd2)', borderBottom: '1px solid var(--bd2)' })}>Alle geschreven uren</th>
                  <th colSpan={2} style={th('left', { color: 'var(--t2)', borderLeft: '1px solid var(--bd2)', borderBottom: '1px solid var(--bd2)' })}>Declarabiliteit</th>
                </tr>
                <tr style={{ color: 'var(--t3)' }}>
                  <th style={th('left', { cursor: 'pointer', color: sortKey === 'naam' ? 'var(--t1)' : undefined })} onClick={() => setSortKey('naam')}>Medewerker{sortKey === 'naam' ? ' ▾' : ''}</th>
                  <th style={th('left')}>BV</th>
                  {sortTh('urenSel', 'Uren', 'Productieve uren op de projecten in deze selectie')}
                  {sortTh('omzet', 'Omzet', 'Toegerekende omzet: aandeel in de projecturen × projectomzet (facturatie + Δ OHW), per project')}
                  <th style={th()} title="Uren × kostprijs+AK (+ aandeel missing-hours-kosten)">Kosten</th>
                  {sortTh('marge', 'Marge')}
                  <th style={th()}>%</th>
                  <th style={th('right', { borderLeft: '1px solid var(--bd2)' })} title="Aantal projecten in de selectie waar de medewerker op schreef">Proj.</th>
                  {sortTh('projOmzet', 'Omzet', 'Totale omzet van die projecten (hele project, alle medewerkers)')}
                  {sortTh('projMarge', 'Marge', 'Totale marge van die projecten (hele project, alle medewerkers)')}
                  <th style={th('right', { borderLeft: '1px solid var(--bd2)' })} title="Alle geschreven uren van deze medewerker in de periode (alle projecten, incl. verlof/ziekte)">Totaal</th>
                  <th style={th()} title="Productief op klantprojecten">Klant</th>
                  <th style={th()} title="Productief op interne/G-projecten">Intern</th>
                  <th style={th()} title="Improductief + NTCS">Improd.</th>
                  <th style={th()}>Verlof</th>
                  <th style={th()}>Ziekte</th>
                  <th style={th()} title="Bijzonder verlof, missing, productief zonder project">Overig</th>
                  {sortTh('declAlle', 'Alle uren', 'Declarabiliteit = klanturen / alle geschreven uren (incl. verlof, ziekte)')}
                  <th style={th()} title="Declarabiliteit excl. verlof/ziekte/bijz. verlof (definitie Power BI)">Excl. verlof</th>
                </tr>
              </thead>
              <tbody>
                {zichtbaar.map(r => {
                  const marge = r.omzet - r.kosten, pr = r.profiel
                  const active = r.id === empId
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--bd2)', color: 'var(--t1)', background: active ? 'rgba(0,169,224,.08)' : undefined }}>
                      <td style={td('left')}><button style={{ ...linkStyle, fontSize: 11, fontWeight: active ? 700 : 500 }} onClick={() => setEmpId(active ? null : r.id)} title="Klik voor de projecten en klanten van deze medewerker">{r.naam}</button><BronMarker bron={r.bron} tarief={r.tarief} /></td>
                      <td style={td('left', { color: 'var(--t2)' })}>{r.bedrijf}</td>
                      <td style={td('right', { fontFamily: 'var(--mono)' })}>{fmtU(r.urenSel)}</td>
                      <td style={td('right', { fontFamily: 'var(--mono)' })}>{fmtK(r.omzet)}</td>
                      <td style={td('right', { fontFamily: 'var(--mono)', color: 'var(--t2)' })}>{fmtK(r.kosten)}</td>
                      <td style={td('right', { fontFamily: 'var(--mono)', fontWeight: 700, color: margeColor(marge) })}>{fmtK(marge)}</td>
                      <td style={td('right', { color: 'var(--t2)' })}>{pctStr(marge, r.omzet)}</td>
                      <td style={td('right', { color: 'var(--t3)', borderLeft: '1px solid var(--bd2)' })}>{r.nProj || '—'}</td>
                      <td style={td('right', { fontFamily: 'var(--mono)', color: 'var(--t2)' })}>{r.nProj ? fmtK(r.projOmzet) : '—'}</td>
                      <td style={td('right', { fontFamily: 'var(--mono)', fontWeight: 600, color: r.nProj ? margeColor(r.projMarge) : 'var(--t3)' })}>{r.nProj ? fmtK(r.projMarge) : '—'}</td>
                      <td style={td('right', { fontFamily: 'var(--mono)', borderLeft: '1px solid var(--bd2)' })}>{fmtU(pr.totaal)}</td>
                      <td style={td('right', { color: 'var(--t2)' })}>{fmtU(pr.klant)}</td>
                      <td style={td('right', { color: 'var(--t2)' })}>{fmtU(pr.intern)}</td>
                      <td style={td('right', { color: 'var(--t2)' })}>{fmtU(pr.improductief)}</td>
                      <td style={td('right', { color: 'var(--t2)' })}>{fmtU(pr.verlof)}</td>
                      <td style={td('right', { color: 'var(--t2)' })}>{fmtU(pr.ziekte)}</td>
                      <td style={td('right', { color: 'var(--t2)' })}>{fmtU(pr.overig)}</td>
                      <td style={td('right', { fontWeight: 700, color: declColor(pr.declAlle) })}>{pr.declAlle == null ? '—' : `${pr.declAlle}%`}</td>
                      <td style={td('right', { color: declColor(pr.declExcl) })}>{pr.declExcl == null ? '—' : `${pr.declExcl}%`}</td>
                    </tr>
                  )
                })}
                <tr style={{ borderTop: '2px solid var(--bd3)', color: 'var(--t1)', fontWeight: 700 }}>
                  <td style={td('left')}>Totaal ({medewerkers.rijen.length})</td><td />
                  <td style={td('right', { fontFamily: 'var(--mono)' })}>{fmtU(tot.urenSel)}</td>
                  <td style={td('right', { fontFamily: 'var(--mono)' })}>{fmtK(tot.omzet)}</td>
                  <td style={td('right', { fontFamily: 'var(--mono)' })}>{fmtK(tot.kosten)}</td>
                  <td style={td('right', { fontFamily: 'var(--mono)', color: margeColor(tot.omzet - tot.kosten) })}>{fmtK(tot.omzet - tot.kosten)}</td>
                  <td style={td('right')}>{pctStr(tot.omzet - tot.kosten, tot.omzet)}</td>
                  <td colSpan={3} style={td('left', { borderLeft: '1px solid var(--bd2)', color: 'var(--t3)', fontWeight: 400, fontSize: 10 })} title="Projecttotalen tellen per medewerker dubbel (meerdere mensen op één project) en zijn daarom niet gesommeerd">niet optelbaar</td>
                  <td style={td('right', { fontFamily: 'var(--mono)', borderLeft: '1px solid var(--bd2)' })}>{fmtU(tot.totaal)}</td>
                  <td style={td('right')}>{fmtU(tot.klant)}</td><td colSpan={5} />
                  <td style={td('right', { color: declColor(tot.totaal ? tot.klant / tot.totaal * 100 : null) })}>{tot.totaal ? `${Math.round(tot.klant / tot.totaal * 100)}%` : '—'}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {rijenSorted.length > 40 && (
          <button style={{ ...linkStyle, marginTop: 6 }} onClick={() => setAlleRijen(v => !v)}>{alleRijen ? 'toon top 40' : `toon alle ${rijenSorted.length} medewerkers`}</button>
        )}
        <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 6, lineHeight: 1.5 }}>
          "Aandeel medewerker" = toegerekend: per project krijgt iedereen zijn aandeel in de projecturen × de projectomzet
          (facturatie + Δ OHW{metMh ? ' + missing hours' : ''}); bij eenheden- en fixed-price-projecten is dat een verdeelsleutel, geen individuele productie.
          "Projecten totaal" = de hele omzet en marge van de projecten waar de medewerker op schreef (alle medewerkers samen) — kies zelf welke van de twee je pakt;
          projecttotalen zijn per medewerker niet op te tellen, omdat meerdere mensen op hetzelfde project schrijven.
          {medewerkers.nietToerekenbaar !== 0 && <> Niet toe te rekenen (losse dossiers zonder uren): <b style={{ color: 'var(--t2)' }}>{fmtEur(medewerkers.nietToerekenbaar)}</b>.</>}
          {' '}De urenkolommen rechts tellen álle geschreven uren van de medewerker in de periode (ook buiten deze selectie); "Decl. alle" = klanturen / alle uren incl. verlof en ziekte, "Decl. excl." laat verlof, ziekte en bijzonder verlof buiten beschouwing.
        </div>
      </div>
    </div>
  )
}

/** Inzoom per medewerker: alle projecten en klanten waar hij/zij op schreef (over alle tegels), met toegerekende omzet/marge. */
function MedewerkerDetail({ m, mod, metMh, maanden, periodeLabel, inSelectie, onClose }: {
  m: DetailMedewerker; mod: DetailModule; metMh: boolean; maanden: number[]; periodeLabel: string; inSelectie: Set<string>; onClose: () => void
}) {
  const pr = urenProfiel(m, maanden)
  const somM = (a: number[]) => somOver(a, maanden)
  const rows = mod.detailProjecten.flatMap(p => {
    const e = p.emps.find(x => x.id === m.id); if (!e) return []
    const u = somM(e.uren); if (!u) return []
    const k = kpiVan(p, metMh, maanden)
    const share = k.uren ? u / k.uren : 0
    return [{ p, u, share, omzet: share * k.omzet, kosten: somM(e.kosten) + share * k.mhKosten, projOmzet: k.omzet, projMarge: k.marge }]
  }).sort((a, b) => b.u - a.u)
  const klanten = new Map<string, { n: number; u: number; omzet: number; kosten: number; projOmzet: number; projMarge: number }>()
  for (const r of rows) {
    const key = r.p.intern ? '(intern)' : r.p.klant || '(geen klant)'
    const c = klanten.get(key) ?? { n: 0, u: 0, omzet: 0, kosten: 0, projOmzet: 0, projMarge: 0 }
    c.n++; c.u += r.u; c.omzet += r.omzet; c.kosten += r.kosten; c.projOmzet += r.projOmzet; c.projMarge += r.projMarge; klanten.set(key, c)
  }
  const tot = rows.reduce((a, r) => ({ u: a.u + r.u, omzet: a.omzet + r.omzet, kosten: a.kosten + r.kosten, projOmzet: a.projOmzet + (r.p.intern ? 0 : r.projOmzet), projMarge: a.projMarge + (r.p.intern ? 0 : r.projMarge) }), { u: 0, omzet: 0, kosten: 0, projOmzet: 0, projMarge: 0 })

  return (
    <div style={{ border: '1px solid var(--bd3)', borderRadius: 8, padding: '10px 12px', marginBottom: 12, background: 'var(--bg1)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginBottom: 8, fontSize: 11.5, color: 'var(--t2)' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>{m.naam}<BronMarker bron={m.bron} tarief={m.tarief} /></span>
        <span>{m.bedrijf} · kostprijs+AK <b style={{ color: 'var(--t1)', fontFamily: 'var(--mono)' }}>€{m.tarief}</b>/uur</span>
        <span>{periodeLabel}</span>
        <span>Uren <b style={{ color: 'var(--t1)', fontFamily: 'var(--mono)' }}>{fmtU(pr.totaal)}</b> = klant {fmtU(pr.klant)} · intern {fmtU(pr.intern)} · improd. {fmtU(pr.improductief)} · verlof {fmtU(pr.verlof)} · ziekte {fmtU(pr.ziekte)} · overig {fmtU(pr.overig)}</span>
        <span>Declarabel <b style={{ color: declColor(pr.declAlle) }}>{pr.declAlle == null ? '—' : `${pr.declAlle}%`}</b> (excl. verlof/ziekte <b style={{ color: declColor(pr.declExcl) }}>{pr.declExcl == null ? '—' : `${pr.declExcl}%`}</b>)</span>
        <span>Aandeel: omzet <b style={{ color: 'var(--t1)', fontFamily: 'var(--mono)' }}>{fmtEur(tot.omzet)}</b> · marge <b style={{ color: margeColor(tot.omzet - tot.kosten), fontFamily: 'var(--mono)' }}>{fmtEur(tot.omzet - tot.kosten)}</b></span>
        <span>Projecten totaal: omzet <b style={{ color: 'var(--t1)', fontFamily: 'var(--mono)' }}>{fmtEur(tot.projOmzet)}</b> · marge <b style={{ color: margeColor(tot.projMarge), fontFamily: 'var(--mono)' }}>{fmtEur(tot.projMarge)}</b></span>
        <button onClick={onClose} style={{ marginLeft: 'auto', fontSize: 11, background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer' }}>✕ sluiten</button>
      </div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 10.5, flex: 2, minWidth: 520 }}>
          <thead>
            <tr style={{ color: 'var(--t3)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              <th colSpan={4} />
              <th colSpan={5} style={th('left', { color: 'var(--t2)', borderLeft: '1px solid var(--bd2)', borderBottom: '1px solid var(--bd2)' })}>Aandeel medewerker</th>
              <th colSpan={3} style={th('left', { color: 'var(--t2)', borderLeft: '1px solid var(--bd2)', borderBottom: '1px solid var(--bd2)' })}>Project totaal</th>
            </tr>
            <tr style={{ color: 'var(--t3)' }}>
              <th style={th('left')}>Project</th><th style={th('left')}>Klant</th><th style={th('left')}>Entiteit · segment</th><th style={th()}>Uren</th>
              <th style={th('right', { borderLeft: '1px solid var(--bd2)' })} title="Aandeel van deze medewerker in de projecturen">Aandeel</th><th style={th()}>Omzet</th><th style={th()}>Kosten</th><th style={th()}>Marge</th><th style={th()}>%</th>
              <th style={th('right', { borderLeft: '1px solid var(--bd2)' })} title="Hele projectomzet (alle medewerkers)">Omzet</th><th style={th()} title="Hele projectmarge (alle medewerkers)">Marge</th><th style={th()}>%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const sel = inSelectie.has(r.p.id)
              return (
                <tr key={r.p.id} style={{ borderTop: '1px solid var(--bd2)', color: sel ? 'var(--t1)' : 'var(--t2)' }}>
                  <td style={td('left', { maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' })} title={sel ? 'In de huidige selectie' : 'Buiten de huidige selectie'}>
                    {sel && <span style={{ color: 'var(--blue)', marginRight: 4 }}>●</span>}<span style={{ fontFamily: 'var(--mono)' }}>{r.p.id}</span> {r.p.naam}{r.p.intern && <span style={{ color: 'var(--t3)' }}> (intern)</span>}
                  </td>
                  <td style={td('left', { maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' })}>{r.p.intern ? '—' : r.p.klant || '(geen klant)'}</td>
                  <td style={td('left')}>{r.p.ent} · {r.p.seg}</td>
                  <td style={td('right', { fontFamily: 'var(--mono)' })}>{fmtU(r.u)}</td>
                  <td style={td('right', { borderLeft: '1px solid var(--bd2)' })}>{Math.round(r.share * 100)}%</td>
                  <td style={td('right', { fontFamily: 'var(--mono)' })}>{r.p.intern ? '—' : fmtK(r.omzet)}</td>
                  <td style={td('right', { fontFamily: 'var(--mono)' })}>{fmtK(r.kosten)}</td>
                  <td style={td('right', { fontFamily: 'var(--mono)', fontWeight: 700, color: margeColor(r.omzet - r.kosten) })}>{r.p.intern ? '—' : fmtK(r.omzet - r.kosten)}</td>
                  <td style={td('right')}>{r.p.intern ? '—' : pctStr(r.omzet - r.kosten, r.omzet)}</td>
                  <td style={td('right', { fontFamily: 'var(--mono)', borderLeft: '1px solid var(--bd2)' })}>{r.p.intern ? '—' : fmtK(r.projOmzet)}</td>
                  <td style={td('right', { fontFamily: 'var(--mono)', fontWeight: 600, color: r.p.intern ? 'var(--t3)' : margeColor(r.projMarge) })}>{r.p.intern ? '—' : fmtK(r.projMarge)}</td>
                  <td style={td('right')}>{r.p.intern ? '—' : pctStr(r.projMarge, r.projOmzet)}</td>
                </tr>
              )
            })}
            <tr style={{ borderTop: '2px solid var(--bd3)', color: 'var(--t1)', fontWeight: 700 }}>
              <td style={td('left')}>Totaal ({rows.length} projecten)</td><td /><td />
              <td style={td('right', { fontFamily: 'var(--mono)' })}>{fmtU(tot.u)}</td><td style={td('right', { borderLeft: '1px solid var(--bd2)' })} />
              <td style={td('right', { fontFamily: 'var(--mono)' })}>{fmtK(tot.omzet)}</td>
              <td style={td('right', { fontFamily: 'var(--mono)' })}>{fmtK(tot.kosten)}</td>
              <td style={td('right', { fontFamily: 'var(--mono)', color: margeColor(tot.omzet - tot.kosten) })}>{fmtK(tot.omzet - tot.kosten)}</td>
              <td style={td('right')}>{pctStr(tot.omzet - tot.kosten, tot.omzet)}</td>
              <td style={td('right', { fontFamily: 'var(--mono)', borderLeft: '1px solid var(--bd2)' })}>{fmtK(tot.projOmzet)}</td>
              <td style={td('right', { fontFamily: 'var(--mono)', color: margeColor(tot.projMarge) })}>{fmtK(tot.projMarge)}</td>
              <td style={td('right')}>{pctStr(tot.projMarge, tot.projOmzet)}</td>
            </tr>
          </tbody>
        </table>
        <table style={{ borderCollapse: 'collapse', fontSize: 10.5, flex: 1, minWidth: 300 }}>
          <thead>
            <tr style={{ color: 'var(--t3)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              <th colSpan={3} />
              <th colSpan={2} style={th('left', { color: 'var(--t2)', borderLeft: '1px solid var(--bd2)', borderBottom: '1px solid var(--bd2)' })}>Aandeel</th>
              <th colSpan={2} style={th('left', { color: 'var(--t2)', borderLeft: '1px solid var(--bd2)', borderBottom: '1px solid var(--bd2)' })}>Projecten totaal</th>
            </tr>
            <tr style={{ color: 'var(--t3)' }}>
              <th style={th('left')}>Klant</th><th style={th()}>Proj.</th><th style={th()}>Uren</th>
              <th style={th('right', { borderLeft: '1px solid var(--bd2)' })}>Omzet</th><th style={th()}>Marge</th>
              <th style={th('right', { borderLeft: '1px solid var(--bd2)' })}>Omzet</th><th style={th()}>Marge</th>
            </tr>
          </thead>
          <tbody>
            {[...klanten.entries()].sort((a, b) => b[1].u - a[1].u).map(([k, c]) => (
              <tr key={k} style={{ borderTop: '1px solid var(--bd2)', color: 'var(--t1)' }}>
                <td style={td('left', { maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' })}>{k}</td>
                <td style={td('right', { color: 'var(--t3)' })}>{c.n}</td>
                <td style={td('right', { fontFamily: 'var(--mono)' })}>{fmtU(c.u)}</td>
                <td style={td('right', { fontFamily: 'var(--mono)', borderLeft: '1px solid var(--bd2)' })}>{k === '(intern)' ? '—' : fmtK(c.omzet)}</td>
                <td style={td('right', { fontFamily: 'var(--mono)', fontWeight: 700, color: margeColor(c.omzet - c.kosten) })}>{k === '(intern)' ? '—' : fmtK(c.omzet - c.kosten)}</td>
                <td style={td('right', { fontFamily: 'var(--mono)', borderLeft: '1px solid var(--bd2)', color: 'var(--t2)' })}>{k === '(intern)' ? '—' : fmtK(c.projOmzet)}</td>
                <td style={td('right', { fontFamily: 'var(--mono)', fontWeight: 600, color: k === '(intern)' ? 'var(--t3)' : margeColor(c.projMarge) })}>{k === '(intern)' ? '—' : fmtK(c.projMarge)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 6 }}>● = project valt in de huidige tegel/klant/project-selectie. "Aandeel" = eigen uren-aandeel × projectomzet minus eigen kosten; "Project totaal" = het hele project met alle medewerkers. Interne projecten tellen kosten maar geen omzet.</div>
    </div>
  )
}

function ProjectDetail({ p, k, metMh, periodeLabel }: { p: DetailProject; k: Kpi; metMh: boolean; periodeLabel: string }) {
  const isE = p.id.startsWith('E-')
  const weeks: WeekRow[] = p.weeks ?? []
  const [alleWeken, setAlleWeken] = useState(false)
  const wRows = alleWeken ? weeks : weeks.filter(w => w.productie !== 0 || w.uren !== 0)
  const wTot = weeks.reduce((a, w) => ({ productie: a.productie + w.productie, bevestigd: a.bevestigd + w.bevestigd, uren: a.uren + w.uren, kosten: a.kosten + w.kosten }), { productie: 0, bevestigd: 0, uren: 0, kosten: 0 })
  const s = (a: number[]) => a.slice(0, MARGE_MAANDEN).reduce((x, y) => x + y, 0)
  const modelOmzetYtd = s(p.omzet) + s(p.ohw)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* KPI-regel */}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--t2)' }}>
        <span>Klant <b style={{ color: 'var(--t1)' }}>{p.klant || '—'}</b></span>
        <span>{p.ent} · {p.seg} · {TYPE_LABEL[p.id[0]] ?? p.id[0]}</span>
        <span>Omzet {periodeLabel} <b style={{ color: 'var(--t1)', fontFamily: 'var(--mono)' }}>{fmtEur(k.omzet)}</b></span>
        <span>Kosten <b style={{ color: 'var(--t1)', fontFamily: 'var(--mono)' }}>{fmtEur(k.kosten)}</b></span>
        <span>Marge <b style={{ color: margeColor(k.marge), fontFamily: 'var(--mono)' }}>{fmtEur(k.marge)}</b> ({pctStr(k.marge, k.omzet)})</span>
        <span>Uren <b style={{ color: 'var(--t1)', fontFamily: 'var(--mono)' }}>{fmtU(k.uren)}</b></span>
        {k.geenUren && <span style={{ color: 'var(--amber)' }}>◌ los dossier — omzet zonder geboekte uren, hangt niet aan projectwerk</span>}
      </div>

      {/* Maandreeks */}
      <table style={{ borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--mono)', alignSelf: 'flex-start' }}>
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
      {p.emps.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--amber)' }}>Los dossier: geen uren in de urenexport — de omzet telt mee in de matrix, maar er is geen medewerker of weekproductie aan te koppelen.</div>
      )}

      {/* Weekoverzicht (eenheden-projecten) */}
      {isE && (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
            <div style={sectionTitle}>Weekoverzicht eenheden — productie (OHW Freezes) vs uren/kosten van die week</div>
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
