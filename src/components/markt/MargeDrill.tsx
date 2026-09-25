import { Fragment, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { DetailProject, DetailEmp, DetailMedewerker, WeekRow, TariefBron } from '../../data/marginDetail'
import { MARGE_MAANDEN, MARGE_META } from '../../data/marginData'

type DetailModule = typeof import('../../data/marginDetail')

const MAAND_LABELS = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']
const TYPE_LABEL: Record<string, string> = {
  D: 'detachering', U: 'urenproject', E: 'eenheden', S: 'software', F: 'fixed price', G: 'licentie/product', T: 'training',
}
const fmtK = (v: number) => Math.abs(v) >= 1_000_000 ? `€ ${(v / 1_000_000).toFixed(2).replace('.', ',')}M` : `€ ${Math.round(v / 1000)}k`
const fmtEur = (v: number) => `€ ${Math.round(v).toLocaleString('nl-NL')}`
const fmtU = (v: number) => Math.round(v).toLocaleString('nl-NL')
const pct = (deel: number, totaal: number) => totaal !== 0 ? Math.round(deel / Math.abs(totaal) * 100) : null
const pctStr = (marge: number, omzet: number) => { const p = pct(marge, omzet); return p == null ? '—' : `${p}%` }
const somOver = (a: number[], maanden: number[]) => maanden.reduce((s, i) => s + (a[i] ?? 0), 0)

interface Kpi { omzet: number; kosten: number; marge: number; uren: number; geenUren: boolean; mh: number; mhKosten: number }
function kpiVan(p: DetailProject, metMh: boolean, maanden: number[]): Kpi {
  const s = (a: number[]) => somOver(a, maanden)
  const omzet = s(p.omzet) + s(p.ohw) + (metMh ? s(p.mhOmzet) : 0)
  const kosten = s(p.kosten) + (metMh ? s(p.mhKosten) : 0)
  const uren = s(p.uren)
  return { omzet, kosten, marge: omzet - kosten, uren, geenUren: uren === 0 && omzet !== 0, mh: metMh ? s(p.mhOmzet) : 0, mhKosten: metMh ? s(p.mhKosten) : 0 }
}

const th = (align: 'left' | 'right' = 'right', extra: CSSProperties = {}): CSSProperties => ({ textAlign: align, padding: '3px 8px', fontWeight: 600, whiteSpace: 'nowrap', ...extra })
const td = (align: 'left' | 'right' = 'right', extra: CSSProperties = {}): CSSProperties => ({ textAlign: align, padding: '3px 8px', whiteSpace: 'nowrap', ...extra })
const groupTh = (extra: CSSProperties = {}): CSSProperties => th('left', { color: 'var(--t2)', borderLeft: '1px solid var(--bd2)', borderBottom: '1px solid var(--bd2)', ...extra })
const groupRow: CSSProperties = { color: 'var(--t3)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.05em' }
const margeColor = (v: number) => v >= 0 ? 'var(--green)' : 'var(--red)'
const declColor = (v: number | null) => v == null ? 'var(--t3)' : v >= 80 ? 'var(--green)' : v >= 60 ? 'var(--amber)' : 'var(--red)'
const mono: CSSProperties = { fontFamily: 'var(--mono)' }
// Kostprijs-herkomst: tarievenbestand, invullijst Lars en Spanje €35 zijn vaste gegevens; alleen 'geschat'
// (mediaan van het bedrijf, tarief ontbreekt) krijgt een markering.
const BRON_TITEL: Record<TariefBron, string> = {
  tarievenbestand: 'Tarievenbestand',
  ingevuld: 'Tarief uit de invullijst (Lars, 25-09-2026)',
  spanje: 'S.L. (Spanje): €35/uur',
  geschat: 'Tarief ontbreekt (niet in tarievenbestand of invullijst) — geschat op de mediaan kostprijs+AK van het bedrijf',
}
const BRON_LABEL: Record<TariefBron, string> = { tarievenbestand: 'tarievenbestand', ingevuld: 'invullijst', spanje: 'Spanje €35', geschat: 'geschat (mediaan)' }
const linkStyle: CSSProperties = { background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 11.5, padding: 0, textAlign: 'left' }
const sectionTitle: CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }
const inputStyle: CSSProperties = { fontSize: 10.5, padding: '2px 6px', background: 'var(--bg1)', border: '1px solid var(--bd2)', borderRadius: 4, color: 'var(--t1)', fontFamily: 'var(--font)' }

function BronMarker({ bron, tarief }: { bron: TariefBron; tarief: number }) {
  if (bron !== 'geschat') return null
  return <span style={{ color: 'var(--amber)', marginLeft: 4, fontSize: 10 }} title={`${BRON_TITEL[bron]} — €${tarief}/uur`}>≈</span>
}

// ── Generiek sorteren + filteren ────────────────────────────────────────────
type CelWaarde = string | number | null | undefined
interface Kolom<T> { key: string; get: (r: T) => CelWaarde; text?: boolean }
interface SortState { key: string; desc: boolean }
interface TabelState { sort: SortState; toggle: (key: string) => void; q: string; setQ: (q: string) => void }

function useTabel<T>(rows: T[], kolommen: Kolom<T>[], init: SortState, extraFilter?: (r: T) => boolean) {
  const [sort, setSort] = useState<SortState>(init)
  const [q, setQ] = useState('')
  const out = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const tekst = kolommen.filter(c => c.text)
    let r = rows
    if (needle) r = r.filter(row => tekst.some(c => String(c.get(row) ?? '').toLowerCase().includes(needle)))
    if (extraFilter) r = r.filter(extraFilter)
    const col = kolommen.find(c => c.key === sort.key)
    if (col) {
      r = [...r].sort((a, b) => {
        const va = col.get(a), vb = col.get(b)
        if (va == null && vb == null) return 0
        if (va == null) return 1
        if (vb == null) return -1
        const c = typeof va === 'string' || typeof vb === 'string' ? String(va).localeCompare(String(vb), 'nl') : (va as number) - (vb as number)
        return sort.desc ? -c : c
      })
    }
    return r
  }, [rows, kolommen, sort, q, extraFilter])
  const toggle = (key: string) => setSort(s => s.key === key ? { key, desc: !s.desc } : { key, desc: !kolommen.find(c => c.key === key)?.text })
  const state: TabelState = { sort, toggle, q, setQ }
  return { rows: out, state }
}

function SortTh({ k, label, state, align = 'right', title, extra }: { k: string; label: string; state: TabelState; align?: 'left' | 'right'; title?: string; extra?: CSSProperties }) {
  const active = state.sort.key === k
  return (
    <th style={th(align, { cursor: 'pointer', userSelect: 'none', color: active ? 'var(--t1)' : undefined, ...extra })} title={title ?? 'Klik om te sorteren'} onClick={() => state.toggle(k)}>
      {label}{active ? (state.sort.desc ? ' ▾' : ' ▴') : ''}
    </th>
  )
}

function FilterBar({ state, placeholder, children, n, totaal }: { state: TabelState; placeholder: string; children?: ReactNode; n: number; totaal: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
      <input value={state.q} onChange={e => state.setQ(e.target.value)} placeholder={placeholder} style={{ ...inputStyle, width: 190 }} />
      {children}
      <span style={{ fontSize: 10, color: 'var(--t3)' }}>{n === totaal ? `${n} rijen` : `${n} van ${totaal} rijen`} · klik op een kolomkop om te sorteren</span>
    </div>
  )
}

function Select({ value, onChange, opties, title }: { value: string; onChange: (v: string) => void; opties: [string, string][]; title?: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={inputStyle} title={title}>
      {opties.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
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

// Rijtypes van de tabellen (alle getallen vooraf berekend, zodat de kolomdefinities statisch zijn)
interface KlantRij { klant: string; n: number; omzet: number; kosten: number; marge: number; pct: number | null; uren: number }
interface ProjectRij { p: DetailProject; id: string; naam: string; type: string; seg: string; omzet: number; kosten: number; marge: number; pct: number | null; uren: number; geenUren: boolean }
/** omzet/kosten = aandeel van de medewerker; projOmzet/projMarge = totaal van de projecten waar hij/zij op schreef */
interface MedewerkerRij { id: number; naam: string; bedrijf: string; bron: TariefBron; tarief: number; urenSel: number; omzet: number; kosten: number; marge: number; pct: number | null; projOmzet: number; projMarge: number; nProj: number; profiel: UrenProfiel }

const KLANT_KOL: Kolom<KlantRij>[] = [
  { key: 'klant', get: r => r.klant, text: true }, { key: 'n', get: r => r.n }, { key: 'omzet', get: r => r.omzet }, { key: 'kosten', get: r => r.kosten },
  { key: 'marge', get: r => r.marge }, { key: 'pct', get: r => r.pct }, { key: 'uren', get: r => r.uren },
]
const PROJECT_KOL: Kolom<ProjectRij>[] = [
  { key: 'id', get: r => `${r.id} ${r.naam}`, text: true }, { key: 'type', get: r => r.type, text: true }, { key: 'seg', get: r => r.seg, text: true },
  { key: 'omzet', get: r => r.omzet }, { key: 'kosten', get: r => r.kosten }, { key: 'marge', get: r => r.marge }, { key: 'pct', get: r => r.pct }, { key: 'uren', get: r => r.uren },
]
const MEDEWERKER_KOL: Kolom<MedewerkerRij>[] = [
  { key: 'naam', get: r => r.naam, text: true }, { key: 'bedrijf', get: r => r.bedrijf, text: true },
  { key: 'urenSel', get: r => r.urenSel }, { key: 'omzet', get: r => r.omzet }, { key: 'kosten', get: r => r.kosten }, { key: 'marge', get: r => r.marge }, { key: 'pct', get: r => r.pct },
  { key: 'nProj', get: r => r.nProj }, { key: 'projOmzet', get: r => r.projOmzet }, { key: 'projMarge', get: r => r.projMarge },
  { key: 'totaal', get: r => r.profiel.totaal }, { key: 'klant', get: r => r.profiel.klant }, { key: 'intern', get: r => r.profiel.intern }, { key: 'improductief', get: r => r.profiel.improductief },
  { key: 'verlof', get: r => r.profiel.verlof }, { key: 'ziekte', get: r => r.profiel.ziekte }, { key: 'overig', get: r => r.profiel.overig },
  { key: 'declAlle', get: r => r.profiel.declAlle }, { key: 'declExcl', get: r => r.profiel.declExcl },
]

export function MargeDrill({ ent, seg, metMh, maanden, maandTabel }: Props) {
  const [mod, setMod] = useState<DetailModule | null>(null)
  const [klant, setKlant] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [empId, setEmpId] = useState<number | null>(null)
  const [alleRijen, setAlleRijen] = useState(false)
  const [bvFilter, setBvFilter] = useState('alle')
  const [bronFilter, setBronFilter] = useState('alle')
  const [typeFilter, setTypeFilter] = useState('alle')

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

  const klantRijen = useMemo<KlantRij[]>(() => {
    const byKlant = new Map<string, KlantRij>()
    for (const p of projecten) {
      const k = kpi(p)
      const key = p.klant || '(geen klant)'
      const row = byKlant.get(key) ?? { klant: key, n: 0, omzet: 0, kosten: 0, marge: 0, pct: null, uren: 0 }
      row.n++; row.omzet += k.omzet; row.kosten += k.kosten; row.uren += k.uren
      byKlant.set(key, row)
    }
    return [...byKlant.values()].map(r => ({ ...r, marge: r.omzet - r.kosten, pct: pct(r.omzet - r.kosten, r.omzet) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projecten, metMh, maanden])
  const klantTabel = useTabel(klantRijen, KLANT_KOL, { key: 'omzet', desc: true })

  const project = projectId ? projecten.find(p => p.id === projectId) ?? null : null
  const klantProjecten = useMemo(() => klant ? projecten.filter(p => (p.klant || '(geen klant)') === klant) : [], [projecten, klant])
  const projectRijen = useMemo<ProjectRij[]>(() => klantProjecten.map(p => {
    const k = kpi(p)
    return { p, id: p.id, naam: p.naam, type: TYPE_LABEL[p.id[0]] ?? p.id[0], seg: p.seg, omzet: k.omzet, kosten: k.kosten, marge: k.marge, pct: pct(k.marge, k.omzet), uren: k.uren, geenUren: k.geenUren }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [klantProjecten, metMh, maanden])
  const typeFilterFn = useMemo(() => typeFilter === 'alle' ? undefined : (r: ProjectRij) => r.id[0] === typeFilter, [typeFilter])
  const projectTabel = useTabel(projectRijen, PROJECT_KOL, { key: 'omzet', desc: true }, typeFilterFn)

  // De filterset: tegel → klant → project. De medewerkerstabel en de aannames volgen deze set.
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
      if (!r) { r = { id: m.id, naam: m.naam, bedrijf: m.bedrijf, bron: m.bron, tarief: m.tarief, urenSel: 0, omzet: 0, kosten: 0, marge: 0, pct: null, projOmzet: 0, projMarge: 0, nProj: 0, profiel: urenProfiel(m, maanden) }; map.set(m.id, r) }
      return r
    }
    let nietToerekenbaar = 0
    for (const p of filterProj) {
      const k = kpi(p)
      if (k.uren === 0) { nietToerekenbaar += k.omzet; continue }
      for (const e of p.emps) {
        const u = somM(e.uren); if (!u) continue
        const m = profielen.get(e.id); if (!m) continue
        const r = rij(m)
        r.urenSel += u; r.omzet += somM(e.omzet) + (metMh ? somM(e.mhOmzet) : 0); r.kosten += somM(e.kosten) + (metMh ? somM(e.mhKosten) : 0)
        r.projOmzet += k.omzet; r.projMarge += k.marge; r.nProj++
      }
    }
    // Op de totaaltegel zonder verdere filter: iedereen uit de urenexport, ook zonder klanturen (declarabiliteit 0%)
    if (ent === 'totaal' && seg === 'totaal' && !klant && !project) for (const m of mod.detailMedewerkers) if (urenProfiel(m, maanden).totaal > 0) rij(m)
    for (const r of map.values()) { r.marge = r.omzet - r.kosten; r.pct = pct(r.marge, r.omzet) }
    return { rijen: [...map.values()], nietToerekenbaar }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mod, filterProj, metMh, maanden])
  const mdwFilterFn = useMemo(() => (bvFilter === 'alle' && bronFilter === 'alle') ? undefined
    : (r: MedewerkerRij) => (bvFilter === 'alle' || r.bedrijf === bvFilter) && (bronFilter === 'alle' || r.bron === bronFilter), [bvFilter, bronFilter])
  const mdwTabel = useTabel(medewerkers.rijen, MEDEWERKER_KOL, { key: 'omzet', desc: true }, mdwFilterFn)

  if (!mod) return <div style={{ fontSize: 11, color: 'var(--t3)' }}>Detaildata laden…</div>

  const selectedEmp = empId != null ? mod.detailMedewerkers.find(m => m.id === empId) ?? null : null
  const tot = mdwTabel.rows.reduce((a, r) => ({ urenSel: a.urenSel + r.urenSel, omzet: a.omzet + r.omzet, kosten: a.kosten + r.kosten, totaal: a.totaal + r.profiel.totaal, klant: a.klant + r.profiel.klant }), { urenSel: 0, omzet: 0, kosten: 0, totaal: 0, klant: 0 })
  const zichtbaar = alleRijen ? mdwTabel.rows : mdwTabel.rows.slice(0, 40)
  const typesInLijst = [...new Set(projectRijen.map(r => r.id[0]))].sort()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ── Rij 1: maandtabel + klant/project-inzoom ── */}
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
        {maandTabel}
        <div style={{ minWidth: 420, flex: 1 }}>
          <div style={sectionTitle}>Inzoomen op klanten → projecten → weekoverzicht</div>
          {/* Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, marginBottom: 8, flexWrap: 'wrap' }}>
            <button style={{ ...linkStyle, fontWeight: klant ? 500 : 700, color: klant ? 'var(--blue)' : 'var(--t1)' }} onClick={() => { setKlant(null); setProjectId(null) }}>Klanten ({klantRijen.length})</button>
            {klant && <>
              <span style={{ color: 'var(--t3)' }}>›</span>
              <button style={{ ...linkStyle, fontWeight: project ? 500 : 700, color: project ? 'var(--blue)' : 'var(--t1)' }} onClick={() => setProjectId(null)}>{klant} ({klantProjecten.length} projecten)</button>
            </>}
            {project && <>
              <span style={{ color: 'var(--t3)' }}>›</span>
              <span style={{ fontWeight: 700, color: 'var(--t1)' }}><span style={{ ...mono, color: 'var(--t2)' }}>{project.id}</span> {project.naam}</span>
            </>}
            <span style={{ color: 'var(--t3)', marginLeft: 'auto' }}>{periodeLabel}</span>
          </div>

          {/* Niveau 1: klanten */}
          {!klant && (
            <>
              <FilterBar state={klantTabel.state} placeholder="filter op klantnaam…" n={klantTabel.rows.length} totaal={klantRijen.length} />
              <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
                <thead>
                  <tr style={{ color: 'var(--t3)' }}>
                    <SortTh k="klant" label="Klant" state={klantTabel.state} align="left" /><SortTh k="n" label="Proj." state={klantTabel.state} /><SortTh k="omzet" label="Omzet" state={klantTabel.state} />
                    <SortTh k="kosten" label="Kosten" state={klantTabel.state} /><SortTh k="marge" label="Marge" state={klantTabel.state} /><SortTh k="pct" label="%" state={klantTabel.state} /><SortTh k="uren" label="Uren" state={klantTabel.state} />
                  </tr>
                </thead>
                <tbody>
                  {klantTabel.rows.slice(0, 80).map(r => (
                    <tr key={r.klant} style={{ borderTop: '1px solid var(--bd2)', color: 'var(--t1)' }}>
                      <td style={td('left', { maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' })}><button style={linkStyle} onClick={() => setKlant(r.klant)} title="Klik voor projecten van deze klant (de medewerkerstabel hieronder filtert mee)">{r.klant}</button></td>
                      <td style={td('right', { color: 'var(--t3)' })}>{r.n}</td>
                      <td style={td('right', mono)}>{fmtK(r.omzet)}</td>
                      <td style={td('right', { ...mono, color: 'var(--t2)' })}>{fmtK(r.kosten)}</td>
                      <td style={td('right', { ...mono, fontWeight: 700, color: margeColor(r.marge) })}>{fmtK(r.marge)}</td>
                      <td style={td('right', { color: 'var(--t2)' })}>{pctStr(r.marge, r.omzet)}</td>
                      <td style={td('right', { color: 'var(--t3)' })}>{fmtU(r.uren)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* Niveau 2: projecten van klant */}
          {klant && !project && (
            <>
              <FilterBar state={projectTabel.state} placeholder="filter op projectnummer/naam…" n={projectTabel.rows.length} totaal={projectRijen.length}>
                <Select value={typeFilter} onChange={setTypeFilter} title="Projecttype" opties={[['alle', 'alle types'], ...typesInLijst.map(t => [t, `${t} · ${TYPE_LABEL[t] ?? t}`] as [string, string])]} />
              </FilterBar>
              <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
                <thead>
                  <tr style={{ color: 'var(--t3)' }}>
                    <SortTh k="id" label="Project" state={projectTabel.state} align="left" /><SortTh k="type" label="Type" state={projectTabel.state} align="left" /><SortTh k="seg" label="Segment" state={projectTabel.state} align="left" />
                    <SortTh k="omzet" label="Omzet" state={projectTabel.state} /><SortTh k="kosten" label="Kosten" state={projectTabel.state} /><SortTh k="marge" label="Marge" state={projectTabel.state} /><SortTh k="pct" label="%" state={projectTabel.state} /><SortTh k="uren" label="Uren" state={projectTabel.state} />
                  </tr>
                </thead>
                <tbody>
                  {projectTabel.rows.map(r => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--bd2)', color: 'var(--t1)' }}>
                      <td style={td('left', { maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' })}>
                        {r.geenUren && <span style={{ color: 'var(--amber)', marginRight: 4 }} title="Los dossier: omzet zonder geboekte uren — hangt niet aan projectwerk (telt wel mee als omzet)">◌</span>}
                        <button style={linkStyle} onClick={() => setProjectId(r.id)} title="Klik voor maandreeks en weekoverzicht (de medewerkerstabel hieronder filtert mee)"><span style={{ ...mono, color: 'var(--t2)' }}>{r.id}</span> {r.naam}</button>
                      </td>
                      <td style={td('left', { color: 'var(--t2)' })}>{r.type}</td>
                      <td style={td('left', { color: 'var(--t2)' })}>{r.seg}</td>
                      <td style={td('right', mono)}>{fmtK(r.omzet)}</td>
                      <td style={td('right', { ...mono, color: 'var(--t2)' })}>{fmtK(r.kosten)}</td>
                      <td style={td('right', { ...mono, fontWeight: 700, color: margeColor(r.marge) })}>{fmtK(r.marge)}</td>
                      <td style={td('right', { color: 'var(--t2)' })}>{pctStr(r.marge, r.omzet)}</td>
                      <td style={td('right', { color: 'var(--t3)' })}>{fmtU(r.uren)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* Niveau 3: project */}
          {project && <ProjectDetail p={project} k={kpi(project)} metMh={metMh} periodeLabel={periodeLabel} />}
        </div>
      </div>

      {/* ── Aannames & nuances in deze filterset ── */}
      <Aannames filterProj={filterProj} metMh={metMh} maanden={maanden} ent={ent} label={filterLabel} periodeLabel={periodeLabel} nietToerekenbaar={medewerkers.nietToerekenbaar} />

      {/* ── Rij 2: medewerkers in de filterset (tweede inzoom-as) ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
          <div style={sectionTitle}>Medewerkers — {filterLabel} · {periodeLabel} ({medewerkers.rijen.length})</div>
          <span style={{ fontSize: 10.5, color: 'var(--t3)' }}>klik op een naam: de projecten, klanten en aannames van die medewerker klappen eronder open</span>
        </div>

        <FilterBar state={mdwTabel.state} placeholder="filter op naam…" n={mdwTabel.rows.length} totaal={medewerkers.rijen.length}>
          <Select value={bvFilter} onChange={setBvFilter} title="BV van de medewerker" opties={[['alle', 'alle BV\'s'], ['Consultancy', 'Consultancy'], ['Projects', 'Projects'], ['Software', 'Software']]} />
          <Select value={bronFilter} onChange={setBronFilter} title="Herkomst kostprijs" opties={[['alle', 'alle tarieven'], ...(['tarievenbestand', 'ingevuld', 'spanje', 'geschat'] as TariefBron[]).map(b => [b, BRON_LABEL[b]] as [string, string])]} />
        </FilterBar>
        {mdwTabel.rows.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--amber)' }}>Geen medewerkers {medewerkers.rijen.length ? 'die aan het filter voldoen' : 'met geschreven uren in deze selectie'}{!medewerkers.rijen.length && medewerkers.nietToerekenbaar ? ` — de omzet (${fmtEur(medewerkers.nietToerekenbaar)}) is een los dossier zonder projectwerk` : ''}.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 10.5, width: '100%' }}>
              <thead>
                <tr style={groupRow}>
                  <th colSpan={2} />
                  <th colSpan={5} style={groupTh({ borderLeft: 'none' })} title="Wat deze medewerker zelf bijdroeg: aandeel in de projecturen × projectomzet, minus eigen urenkosten">Aandeel medewerker</th>
                  <th colSpan={3} style={groupTh()} title="Totaal van de projecten (in deze selectie) waar de medewerker op schreef — hele project, niet alleen zijn deel">Projecten totaal</th>
                  <th colSpan={7} style={groupTh()}>Alle geschreven uren</th>
                  <th colSpan={2} style={groupTh()}>Declarabiliteit</th>
                </tr>
                <tr style={{ color: 'var(--t3)' }}>
                  <SortTh k="naam" label="Medewerker" state={mdwTabel.state} align="left" />
                  <SortTh k="bedrijf" label="BV" state={mdwTabel.state} align="left" />
                  <SortTh k="urenSel" label="Uren" state={mdwTabel.state} title="Productieve uren op de projecten in deze selectie" />
                  <SortTh k="omzet" label="Omzet" state={mdwTabel.state} title="Toegerekende omzet: aandeel in de projecturen × projectomzet (facturatie + Δ OHW), per project" />
                  <SortTh k="kosten" label="Kosten" state={mdwTabel.state} title="Uren × kostprijs+AK (+ aandeel missing-hours-kosten)" />
                  <SortTh k="marge" label="Marge" state={mdwTabel.state} />
                  <SortTh k="pct" label="%" state={mdwTabel.state} />
                  <SortTh k="nProj" label="Proj." state={mdwTabel.state} extra={{ borderLeft: '1px solid var(--bd2)' }} title="Aantal projecten in de selectie waar de medewerker op schreef" />
                  <SortTh k="projOmzet" label="Omzet" state={mdwTabel.state} title="Totale omzet van die projecten (hele project, alle medewerkers)" />
                  <SortTh k="projMarge" label="Marge" state={mdwTabel.state} title="Totale marge van die projecten (hele project, alle medewerkers)" />
                  <SortTh k="totaal" label="Totaal" state={mdwTabel.state} extra={{ borderLeft: '1px solid var(--bd2)' }} title="Alle geschreven uren van deze medewerker in de periode (alle projecten, incl. verlof/ziekte)" />
                  <SortTh k="klant" label="Klant" state={mdwTabel.state} title="Productief op klantprojecten" />
                  <SortTh k="intern" label="Intern" state={mdwTabel.state} title="Productief op interne/G-projecten" />
                  <SortTh k="improductief" label="Improd." state={mdwTabel.state} title="Improductief + NTCS" />
                  <SortTh k="verlof" label="Verlof" state={mdwTabel.state} />
                  <SortTh k="ziekte" label="Ziekte" state={mdwTabel.state} />
                  <SortTh k="overig" label="Overig" state={mdwTabel.state} title="Bijzonder verlof, missing, productief zonder project" />
                  <SortTh k="declAlle" label="Alle uren" state={mdwTabel.state} extra={{ borderLeft: '1px solid var(--bd2)' }} title="Declarabiliteit = klanturen / alle geschreven uren (incl. verlof, ziekte)" />
                  <SortTh k="declExcl" label="Excl. verlof" state={mdwTabel.state} title="Declarabiliteit excl. verlof/ziekte/bijz. verlof (definitie Power BI)" />
                </tr>
              </thead>
              <tbody>
                {zichtbaar.map(r => {
                  const pr = r.profiel
                  const active = r.id === empId
                  return (
                    <Fragment key={r.id}>
                    <tr style={{ borderTop: '1px solid var(--bd2)', color: 'var(--t1)', background: active ? 'rgba(0,169,224,.08)' : undefined }}>
                      <td style={td('left')}><button style={{ ...linkStyle, fontSize: 11, fontWeight: active ? 700 : 500 }} onClick={() => setEmpId(active ? null : r.id)} title="Klik om de projecten, klanten en aannames van deze medewerker hieronder open te klappen">{active ? '▾ ' : '▸ '}{r.naam}</button><BronMarker bron={r.bron} tarief={r.tarief} /></td>
                      <td style={td('left', { color: 'var(--t2)' })}>{r.bedrijf}</td>
                      <td style={td('right', mono)}>{fmtU(r.urenSel)}</td>
                      <td style={td('right', mono)}>{fmtK(r.omzet)}</td>
                      <td style={td('right', { ...mono, color: 'var(--t2)' })}>{fmtK(r.kosten)}</td>
                      <td style={td('right', { ...mono, fontWeight: 700, color: margeColor(r.marge) })}>{fmtK(r.marge)}</td>
                      <td style={td('right', { color: 'var(--t2)' })}>{pctStr(r.marge, r.omzet)}</td>
                      <td style={td('right', { color: 'var(--t3)', borderLeft: '1px solid var(--bd2)' })}>{r.nProj || '—'}</td>
                      <td style={td('right', { ...mono, color: 'var(--t2)' })}>{r.nProj ? fmtK(r.projOmzet) : '—'}</td>
                      <td style={td('right', { ...mono, fontWeight: 600, color: r.nProj ? margeColor(r.projMarge) : 'var(--t3)' })}>{r.nProj ? fmtK(r.projMarge) : '—'}</td>
                      <td style={td('right', { ...mono, borderLeft: '1px solid var(--bd2)' })}>{fmtU(pr.totaal)}</td>
                      <td style={td('right', { color: 'var(--t2)' })}>{fmtU(pr.klant)}</td>
                      <td style={td('right', { color: 'var(--t2)' })}>{fmtU(pr.intern)}</td>
                      <td style={td('right', { color: 'var(--t2)' })}>{fmtU(pr.improductief)}</td>
                      <td style={td('right', { color: 'var(--t2)' })}>{fmtU(pr.verlof)}</td>
                      <td style={td('right', { color: 'var(--t2)' })}>{fmtU(pr.ziekte)}</td>
                      <td style={td('right', { color: 'var(--t2)' })}>{fmtU(pr.overig)}</td>
                      <td style={td('right', { fontWeight: 700, color: declColor(pr.declAlle), borderLeft: '1px solid var(--bd2)' })}>{pr.declAlle == null ? '—' : `${pr.declAlle}%`}</td>
                      <td style={td('right', { color: declColor(pr.declExcl) })}>{pr.declExcl == null ? '—' : `${pr.declExcl}%`}</td>
                    </tr>
                    {active && selectedEmp && (
                      <tr>
                        <td colSpan={19} style={{ padding: '4px 0 10px 18px', background: 'rgba(0,169,224,.04)' }}>
                          <MedewerkerDetail
                            m={selectedEmp} mod={mod} metMh={metMh} maanden={maanden} periodeLabel={periodeLabel}
                            inSelectie={new Set(filterProj.map(p => p.id))}
                            onClose={() => setEmpId(null)}
                          />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
                <tr style={{ borderTop: '2px solid var(--bd3)', color: 'var(--t1)', fontWeight: 700 }}>
                  <td style={td('left')}>Totaal ({mdwTabel.rows.length})</td><td />
                  <td style={td('right', mono)}>{fmtU(tot.urenSel)}</td>
                  <td style={td('right', mono)}>{fmtK(tot.omzet)}</td>
                  <td style={td('right', mono)}>{fmtK(tot.kosten)}</td>
                  <td style={td('right', { ...mono, color: margeColor(tot.omzet - tot.kosten) })}>{fmtK(tot.omzet - tot.kosten)}</td>
                  <td style={td('right')}>{pctStr(tot.omzet - tot.kosten, tot.omzet)}</td>
                  <td colSpan={3} style={td('left', { borderLeft: '1px solid var(--bd2)', color: 'var(--t3)', fontWeight: 400, fontSize: 10 })} title="Projecttotalen tellen per medewerker dubbel (meerdere mensen op één project) en zijn daarom niet gesommeerd">niet optelbaar</td>
                  <td style={td('right', { ...mono, borderLeft: '1px solid var(--bd2)' })}>{fmtU(tot.totaal)}</td>
                  <td style={td('right')}>{fmtU(tot.klant)}</td><td colSpan={5} />
                  <td style={td('right', { color: declColor(tot.totaal ? tot.klant / tot.totaal * 100 : null), borderLeft: '1px solid var(--bd2)' })}>{tot.totaal ? `${Math.round(tot.klant / tot.totaal * 100)}%` : '—'}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {mdwTabel.rows.length > 40 && (
          <button style={{ ...linkStyle, marginTop: 6 }} onClick={() => setAlleRijen(v => !v)}>{alleRijen ? 'toon top 40' : `toon alle ${mdwTabel.rows.length} medewerkers`}</button>
        )}
      </div>
    </div>
  )
}

// ── Aannames & nuances per filterset ────────────────────────────────────────
// schatting = cijfer is geschat; nuance = modelkeuze die je moet kennen; signaal = opvallend in de data;
// niet in model = zit er niet in (verklaart verschil met de P&L)
type Status = 'schatting' | 'nuance' | 'signaal' | 'niet in model'
interface Aanname { status: Status; tekst: string; bedrag?: number; basis?: 'omzet' | 'kosten'; detail?: string }
const STATUS_STIJL: Record<Status, { kleur: string; label: string }> = {
  schatting: { kleur: 'var(--amber)', label: 'schatting' },
  nuance: { kleur: 'var(--t3)', label: 'nuance' },
  signaal: { kleur: 'var(--blue)', label: 'signaal' },
  'niet in model': { kleur: 'var(--red)', label: 'niet in model' },
}

function AannameBlok({ titel, lijst, omzet, kosten, startOpen = true, compact = false }: { titel: string; lijst: Aanname[]; omzet: number; kosten: number; startOpen?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(startOpen)
  const schatOmzet = lijst.filter(x => x.status === 'schatting' && x.basis === 'omzet').reduce((t, x) => t + (x.bedrag ?? 0), 0)
  const schatKosten = lijst.filter(x => x.status === 'schatting' && x.basis === 'kosten').reduce((t, x) => t + (x.bedrag ?? 0), 0)
  return (
    <div style={{ border: '1px solid var(--bd2)', borderRadius: 8, padding: compact ? '6px 10px' : '8px 12px', background: 'var(--bg1)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={() => setOpen(v => !v)} style={{ ...linkStyle, ...sectionTitle, marginBottom: 0, color: 'var(--t2)' }}>{open ? '▾' : '▸'} {titel}</button>
        <span style={{ fontSize: 10.5, color: 'var(--t2)' }}>
          schattingen: omzet <b style={{ color: 'var(--amber)', ...mono }}>{fmtK(schatOmzet)}</b> ({pct(schatOmzet, omzet) ?? 0}% van {fmtK(omzet)}) · kosten <b style={{ color: 'var(--amber)', ...mono }}>{fmtK(schatKosten)}</b> ({pct(schatKosten, kosten) ?? 0}% van {fmtK(kosten)})
        </span>
      </div>
      {open && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 0, listStyle: 'none', fontSize: 10.5, color: 'var(--t1)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '2px 24px' }}>
          {lijst.map((x, i) => (
            <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0', borderTop: '1px solid var(--bd2)' }} title={x.detail}>
              <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.05em', color: STATUS_STIJL[x.status].kleur, width: 74, flexShrink: 0 }}>{STATUS_STIJL[x.status].label}</span>
              <span style={{ flex: 1 }}>{x.tekst}<span style={{ color: 'var(--t3)' }}>{x.detail ? ` — ${x.detail}` : ''}</span></span>
              {x.bedrag != null && (
                <span style={{ ...mono, whiteSpace: 'nowrap', color: 'var(--t2)' }}>
                  {fmtK(x.bedrag)}{x.basis && <span style={{ color: 'var(--t3)' }}> ({pct(x.bedrag, x.basis === 'omzet' ? omzet : kosten) ?? 0}% {x.basis})</span>}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Aannames({ filterProj, metMh, maanden, ent, label, periodeLabel, nietToerekenbaar }: {
  filterProj: DetailProject[]; metMh: boolean; maanden: number[]; ent: string; label: string; periodeLabel: string; nietToerekenbaar: number
}) {
  const a = useMemo(() => {
    const s = (arr: number[]) => somOver(arr, maanden)
    let omzet = 0, kosten = 0, mhOmzet = 0, mhKosten = 0, eenhAug = 0, kostSleutel = 0, kostSleutelN = 0, andereBv = 0, andereBvUren = 0, losN = 0
    const geschat = { pers: new Set<number>(), uren: 0, kosten: 0 }
    const vtGeschat = { pers: new Set<number>(), omzet: 0 }
    const alias = Object.entries(MARGE_META.projectAlias ?? {}).filter(([, naar]) => filterProj.some(p => p.id === naar))
    for (const p of filterProj) {
      const k = kpiVan(p, metMh, maanden)
      omzet += k.omzet; kosten += k.kosten; mhOmzet += k.mh; mhKosten += k.mhKosten
      if (k.geenUren) losN++
      if (p.id.startsWith('E-') && maanden.includes(7)) eenhAug += p.ohw[7] ?? 0
      if (!['D', 'U'].includes(p.id[0]) && k.uren > 0) { kostSleutel += k.omzet; kostSleutelN++ }
      for (const e of p.emps) {
        const u = s(e.uren); if (!u) continue
        const c = s(e.kosten)
        if (e.bron === 'geschat') { geschat.pers.add(e.id); geschat.uren += u; geschat.kosten += c }
        if (e.sleutel === 'tarief' && e.vtBron === 'geschat') { vtGeschat.pers.add(e.id); vtGeschat.omzet += s(e.omzet) }
        if (e.bedrijf !== p.ent) { andereBv += c; andereBvUren += u }
      }
    }
    const augAfw = MARGE_META.eenhedenAfwijking?.[7] ?? 0
    const lijst: Aanname[] = []
    if (geschat.uren) lijst.push({ status: 'schatting', basis: 'kosten', bedrag: geschat.kosten, tekst: `Kostprijs ontbreekt voor ${geschat.pers.size} pers. (${fmtU(geschat.uren)} uur) → mediaan van het bedrijf`, detail: 'niet in tarievenbestand en niet ingevuld in de invullijst (≈ bij de naam)' })
    if (metMh && (mhOmzet || mhKosten) && ent !== 'Consultancy') lijst.push({ status: 'schatting', basis: 'omzet', bedrag: mhOmzet, tekst: `Missing hours: stand OHW-admin, over projecten verdeeld naar rato van geschreven uren`, detail: `kosten ${fmtK(mhKosten)}; uit te zetten met het vinkje bovenaan` })
    if (metMh && (mhOmzet || mhKosten) && ent === 'Consultancy') lijst.push({ status: 'nuance', basis: 'omzet', bedrag: mhOmzet, tekst: `Missing hours (stand OHW-admin) per gedetacheerde toegerekend`, detail: `kosten ${fmtK(mhKosten)}` })
    if (vtGeschat.omzet) lijst.push({ status: 'schatting', basis: 'omzet', bedrag: vtGeschat.omzet, tekst: `Omzetverdeling binnen urenproject: verkooptarief onbekend voor ${vtGeschat.pers.size} pers.`, detail: 'kostprijs × 1,25 als gewicht; projecttotaal verandert niet' })
    if (eenhAug && augAfw) lijst.push({ status: 'schatting', basis: 'omzet', bedrag: augAfw, tekst: 'Eenheden-OHW augustus wijkt af van de geboekte stand', detail: 'P8-bestand vs OHW-administratie; jan–jul sluiten exact (weekfreezes)' })
    for (const [van, naar] of alias) lijst.push({ status: 'nuance', tekst: `${van} (uren vanaf augustus) meegeteld bij ${naar}`, detail: 'zelfde projectnaam; facturatie en OHW-productie lopen door op ' + naar })
    if (nietToerekenbaar) lijst.push({ status: 'nuance', basis: 'omzet', bedrag: nietToerekenbaar, tekst: `Losse dossiers: ${losN} project(en) met omzet zonder uren`, detail: 'telt mee als omzet, geen kosten, niet aan medewerkers toe te rekenen' })
    if (kostSleutel) lijst.push({ status: 'nuance', basis: 'omzet', bedrag: kostSleutel, tekst: `Omzet per medewerker op ${kostSleutelN} eenheden-/vaste-prijsproject(en) naar rato van kosten`, detail: 'geen tarief per persoon: iedereen krijgt het margepercentage van het project' })
    if (andereBv) lijst.push({ status: 'nuance', basis: 'kosten', bedrag: andereBv, tekst: `Medewerkers uit een andere BV: ${fmtU(andereBvUren)} uur`, detail: 'kosten volgen het project; in de P&L staat dit als IC-omzet/-kosten' })
    lijst.push({ status: 'niet in model', tekst: 'Inkoop/onderaanneming, handmatige OHW-posten, licenties zonder project, improductieve uren, opex buiten de AK-opslag', detail: 'zie aansluitingsblok onderaan' })
    return { lijst, omzet, kosten }
  }, [filterProj, metMh, maanden, ent, nietToerekenbaar])

  return <AannameBlok titel={`Aannames & nuances — ${label} · ${periodeLabel}`} lijst={a.lijst} omzet={a.omzet} kosten={a.kosten} />
}

// ── Inzoom per medewerker ───────────────────────────────────────────────────
interface EmpProjRij { p: DetailProject; e: DetailEmp; sleutel: 'tarief' | 'kosten'; vt: number | null; vtBron: string | null; mhOmzet: number; id: string; naam: string; klant: string; entSeg: string; u: number; share: number; omzet: number; kosten: number; marge: number; pct: number | null; projOmzet: number; projMarge: number; projPct: number | null; sel: boolean; intern: boolean }
interface EmpKlantRij { klant: string; n: number; u: number; omzet: number; marge: number; projOmzet: number; projMarge: number; intern: boolean }
const EMP_PROJ_KOL: Kolom<EmpProjRij>[] = [
  { key: 'id', get: r => `${r.id} ${r.naam}`, text: true }, { key: 'klant', get: r => r.klant, text: true }, { key: 'entSeg', get: r => r.entSeg, text: true },
  { key: 'u', get: r => r.u }, { key: 'share', get: r => r.share }, { key: 'vt', get: r => r.u ? r.omzet / r.u : null }, { key: 'omzet', get: r => r.omzet }, { key: 'kosten', get: r => r.kosten }, { key: 'marge', get: r => r.marge }, { key: 'pct', get: r => r.pct },
  { key: 'projOmzet', get: r => r.projOmzet }, { key: 'projMarge', get: r => r.projMarge }, { key: 'projPct', get: r => r.projPct }, { key: 'sel', get: r => r.sel ? 1 : 0 },
]
const EMP_KLANT_KOL: Kolom<EmpKlantRij>[] = [
  { key: 'klant', get: r => r.klant, text: true }, { key: 'n', get: r => r.n }, { key: 'u', get: r => r.u }, { key: 'omzet', get: r => r.omzet }, { key: 'marge', get: r => r.marge }, { key: 'projOmzet', get: r => r.projOmzet }, { key: 'projMarge', get: r => r.projMarge },
]

/** Inzoom per medewerker: alle projecten en klanten waar hij/zij op schreef (over alle tegels), met toegerekende omzet/marge. */
function MedewerkerDetail({ m, mod, metMh, maanden, periodeLabel, inSelectie, onClose }: {
  m: DetailMedewerker; mod: DetailModule; metMh: boolean; maanden: number[]; periodeLabel: string; inSelectie: Set<string>; onClose: () => void
}) {
  const [alleenSel, setAlleenSel] = useState(false)
  const pr = urenProfiel(m, maanden)
  const rows = useMemo<EmpProjRij[]>(() => {
    const somM = (a: number[]) => somOver(a, maanden)
    return mod.detailProjecten.flatMap(p => {
      const e = p.emps.find(x => x.id === m.id); if (!e) return []
      const u = somM(e.uren); if (!u) return []
      const k = kpiVan(p, metMh, maanden)
      const share = k.uren ? u / k.uren : 0
      const omzet = p.intern ? 0 : somM(e.omzet) + (metMh ? somM(e.mhOmzet) : 0), kosten = somM(e.kosten) + (metMh ? somM(e.mhKosten) : 0)
      return [{ p, e, id: p.id, naam: p.naam, klant: p.intern ? '(intern)' : p.klant || '(geen klant)', entSeg: `${p.ent} · ${p.seg}`, u, share, omzet, kosten, marge: omzet - kosten, pct: p.intern ? null : pct(omzet - kosten, omzet), projOmzet: p.intern ? 0 : k.omzet, projMarge: p.intern ? 0 : k.marge, projPct: p.intern ? null : pct(k.marge, k.omzet), sel: inSelectie.has(p.id), intern: !!p.intern, sleutel: e.sleutel, vt: e.vt, vtBron: e.vtBron, mhOmzet: metMh ? somM(e.mhOmzet) : 0 }]
    })
  }, [mod, m.id, metMh, maanden, inSelectie])
  const klantRijen = useMemo<EmpKlantRij[]>(() => {
    const map = new Map<string, EmpKlantRij>()
    for (const r of rows) {
      const c = map.get(r.klant) ?? { klant: r.klant, n: 0, u: 0, omzet: 0, marge: 0, projOmzet: 0, projMarge: 0, intern: r.intern }
      c.n++; c.u += r.u; c.omzet += r.omzet; c.marge += r.marge; c.projOmzet += r.projOmzet; c.projMarge += r.projMarge; map.set(r.klant, c)
    }
    return [...map.values()]
  }, [rows])
  const selFn = useMemo(() => alleenSel ? (r: EmpProjRij) => r.sel : undefined, [alleenSel])
  const projTabel = useTabel(rows, EMP_PROJ_KOL, { key: 'u', desc: true }, selFn)
  const klantTabel = useTabel(klantRijen, EMP_KLANT_KOL, { key: 'u', desc: true })
  const tot = rows.reduce((a, r) => ({ u: a.u + r.u, omzet: a.omzet + r.omzet, kosten: a.kosten + r.kosten, projOmzet: a.projOmzet + r.projOmzet, projMarge: a.projMarge + r.projMarge }), { u: 0, omzet: 0, kosten: 0, projOmzet: 0, projMarge: 0 })

  // Aannames, schattingen en signalen voor deze medewerker in de gekozen periode
  const lijst = useMemo<Aanname[]>(() => {
    const l: Aanname[] = []
    const extern = rows.filter(r => !r.intern)
    if (m.bron === 'geschat') l.push({ status: 'schatting', basis: 'kosten', bedrag: tot.kosten, tekst: `Kostprijs ontbreekt → mediaan ${m.bedrijf} €${m.tarief}/uur`, detail: 'niet in tarievenbestand of invullijst' })
    const mh = extern.reduce((a, r) => a + r.mhOmzet, 0)
    if (mh) l.push({ status: m.bedrijf === 'Consultancy' ? 'nuance' : 'schatting', basis: 'omzet', bedrag: mh, tekst: 'Missing hours van deze medewerker, verdeeld over zijn/haar projecten', detail: m.bedrijf === 'Consultancy' ? 'stand OHW-admin, sleutel = missing-hours-lijst' : 'naar rato van geschreven uren in die maand' })
    const tar = extern.filter(r => r.sleutel === 'tarief'), kos = extern.filter(r => r.sleutel === 'kosten')
    const vtNiet = tar.filter(r => r.vtBron && r.vtBron !== 'gefactureerd' && r.p.emps.length > 1)
    if (vtNiet.length) l.push({ status: vtNiet.some(r => r.vtBron === 'geschat') ? 'schatting' : 'nuance', basis: 'omzet', bedrag: vtNiet.reduce((a, r) => a + r.omzet, 0), tekst: `Verkooptarief niet op dit project gefactureerd (${vtNiet.map(r => r.id).join(', ')})`, detail: `gewicht via ${[...new Set(vtNiet.map(r => r.vtBron))].join(' / ')}; bepaalt alleen de verdeling binnen het project` })
    if (kos.length) l.push({ status: 'nuance', basis: 'omzet', bedrag: kos.reduce((a, r) => a + r.omzet, 0), tekst: `${kos.length} eenheden-/vaste-prijsproject(en): omzet naar rato van kosten`, detail: 'geen tarief per persoon; marge% = die van het project' })
    const onder = tar.filter(r => r.u >= 4 && r.omzet / r.u < m.tarief)
    if (onder.length) l.push({ status: 'signaal', basis: 'kosten', bedrag: onder.reduce((a, r) => a + r.kosten - r.omzet, 0), tekst: `Omzet per uur onder kostprijs €${m.tarief}: ${onder.map(r => `${r.id} €${Math.round(r.omzet / r.u)}`).join(', ')}`, detail: 'urenprojecten; bedrag = kosten − omzet op die projecten' })
    const verlies = extern.filter(r => r.projMarge < 0)
    if (verlies.length) l.push({ status: 'signaal', bedrag: verlies.reduce((a, r) => a + r.marge, 0), tekst: `Werkt op ${verlies.length} verlieslatend(e) project(en): ${verlies.sort((a, b) => a.projMarge - b.projMarge).slice(0, 4).map(r => r.id).join(', ')}${verlies.length > 4 ? ', …' : ''}`, detail: 'bedrag = zijn/haar aandeel in die marge' })
    const alias = Object.entries(MARGE_META.projectAlias ?? {}).filter(([, naar]) => rows.some(r => r.id === naar))
    for (const [van, naar] of alias) l.push({ status: 'nuance', tekst: `${van} (uren vanaf augustus) meegeteld bij ${naar}`, detail: 'zelfde projectnaam; facturatie en productie lopen op ' + naar })
    const intern = rows.filter(r => r.intern).reduce((a, r) => a + r.kosten, 0)
    if (intern) l.push({ status: 'nuance', bedrag: intern, tekst: 'Uren op interne projecten: kosten zonder omzet' })
    const improd = pr.improductief * m.tarief, afw = (pr.verlof + pr.ziekte) * m.tarief
    if (improd || afw) l.push({ status: 'niet in model', bedrag: improd + afw, tekst: `Niet als projectkosten: improductief ${fmtU(pr.improductief)}u, verlof/ziekte ${fmtU(pr.verlof + pr.ziekte)}u`, detail: `× kostprijs €${m.tarief}; zit in de P&L, niet in de projectmarge` })
    return l
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, m, pr.improductief, pr.verlof, pr.ziekte, tot.kosten])

  return (
    <div style={{ border: '1px solid var(--bd3)', borderRadius: 8, padding: '10px 12px', marginBottom: 12, background: 'var(--bg1)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginBottom: 8, fontSize: 11.5, color: 'var(--t2)' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>{m.naam}<BronMarker bron={m.bron} tarief={m.tarief} /></span>
        <span>{m.bedrijf} · kostprijs+AK <b style={{ color: 'var(--t1)', ...mono }}>€{m.tarief}</b>/uur ({BRON_LABEL[m.bron]})</span>
        <span>{periodeLabel}</span>
        <span>Uren <b style={{ color: 'var(--t1)', ...mono }}>{fmtU(pr.totaal)}</b> = klant {fmtU(pr.klant)} · intern {fmtU(pr.intern)} · improd. {fmtU(pr.improductief)} · verlof {fmtU(pr.verlof)} · ziekte {fmtU(pr.ziekte)} · overig {fmtU(pr.overig)}</span>
        <span>Declarabel <b style={{ color: declColor(pr.declAlle) }}>{pr.declAlle == null ? '—' : `${pr.declAlle}%`}</b> (excl. verlof/ziekte <b style={{ color: declColor(pr.declExcl) }}>{pr.declExcl == null ? '—' : `${pr.declExcl}%`}</b>)</span>
        <span>Aandeel: omzet <b style={{ color: 'var(--t1)', ...mono }}>{fmtEur(tot.omzet)}</b> · marge <b style={{ color: margeColor(tot.omzet - tot.kosten), ...mono }}>{fmtEur(tot.omzet - tot.kosten)}</b></span>
        <span>Projecten totaal: omzet <b style={{ color: 'var(--t1)', ...mono }}>{fmtEur(tot.projOmzet)}</b> · marge <b style={{ color: margeColor(tot.projMarge), ...mono }}>{fmtEur(tot.projMarge)}</b></span>
        <button onClick={onClose} style={{ marginLeft: 'auto', fontSize: 11, background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer' }}>✕ sluiten</button>
      </div>
      <div style={{ marginBottom: 10 }}>
        <AannameBlok titel={`Aannames & signalen — ${m.naam} · ${periodeLabel}`} lijst={lijst} omzet={tot.omzet} kosten={tot.kosten} compact />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ overflowX: 'auto' }}>
          <FilterBar state={projTabel.state} placeholder="filter op project/klant…" n={projTabel.rows.length} totaal={rows.length}>
            <label style={{ fontSize: 10.5, color: 'var(--t2)', cursor: 'pointer' }}><input type="checkbox" checked={alleenSel} onChange={e => setAlleenSel(e.target.checked)} style={{ accentColor: 'var(--blue)', marginRight: 4 }} />alleen huidige selectie</label>
          </FilterBar>
          <table style={{ borderCollapse: 'collapse', fontSize: 10.5, width: '100%' }}>
            <thead>
              <tr style={groupRow}>
                <th colSpan={4} />
                <th colSpan={6} style={groupTh()}>Aandeel medewerker</th>
                <th colSpan={3} style={groupTh()}>Project totaal</th>
              </tr>
              <tr style={{ color: 'var(--t3)' }}>
                <SortTh k="id" label="Project" state={projTabel.state} align="left" /><SortTh k="klant" label="Klant" state={projTabel.state} align="left" /><SortTh k="entSeg" label="Entiteit · segment" state={projTabel.state} align="left" /><SortTh k="u" label="Uren" state={projTabel.state} />
                <SortTh k="share" label="Uren%" state={projTabel.state} extra={{ borderLeft: '1px solid var(--bd2)' }} title="Aandeel van deze medewerker in de projecturen" /><SortTh k="vt" label="Omzet/u" state={projTabel.state} title="Toegerekende omzet per uur van deze medewerker op dit project (rood = onder zijn/haar kostprijs). Cursief = eenheden/vaste prijs: omzet naar rato van kosten." /><SortTh k="omzet" label="Omzet" state={projTabel.state} /><SortTh k="kosten" label="Kosten" state={projTabel.state} /><SortTh k="marge" label="Marge" state={projTabel.state} /><SortTh k="pct" label="%" state={projTabel.state} />
                <SortTh k="projOmzet" label="Omzet" state={projTabel.state} extra={{ borderLeft: '1px solid var(--bd2)' }} title="Hele projectomzet (alle medewerkers)" /><SortTh k="projMarge" label="Marge" state={projTabel.state} title="Hele projectmarge (alle medewerkers)" /><SortTh k="projPct" label="%" state={projTabel.state} />
              </tr>
            </thead>
            <tbody>
              {projTabel.rows.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--bd2)', color: r.sel ? 'var(--t1)' : 'var(--t2)' }}>
                  <td style={td('left', { maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' })} title={r.sel ? 'In de huidige selectie' : 'Buiten de huidige selectie'}>
                    {r.sel && <span style={{ color: 'var(--blue)', marginRight: 4 }}>●</span>}<span style={mono}>{r.id}</span> {r.naam}{r.intern && <span style={{ color: 'var(--t3)' }}> (intern)</span>}
                  </td>
                  <td style={td('left', { maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' })}>{r.intern ? '—' : r.klant}</td>
                  <td style={td('left')}>{r.entSeg}</td>
                  <td style={td('right', mono)}>{fmtU(r.u)}</td>
                  <td style={td('right', { borderLeft: '1px solid var(--bd2)' })}>{Math.round(r.share * 100)}%</td>
                  <td style={td('right', { ...mono, fontStyle: r.sleutel === 'kosten' ? 'italic' : undefined, color: !r.intern && r.u && r.omzet / r.u < m.tarief ? 'var(--red)' : 'var(--t2)' })} title={r.sleutel === 'tarief' ? `urenproject: omzet verdeeld met tarief €${r.vt} (${r.vtBron}); kostprijs €${m.tarief}` : `eenheden/vaste prijs (cursief): omzet naar rato van kosten, dus marge% = project; kostprijs €${m.tarief}`}>{r.intern || !r.u ? '—' : `€${Math.round(r.omzet / r.u)}`}</td>
                  <td style={td('right', mono)}>{r.intern ? '—' : fmtK(r.omzet)}</td>
                  <td style={td('right', mono)}>{fmtK(r.kosten)}</td>
                  <td style={td('right', { ...mono, fontWeight: 700, color: margeColor(r.marge) })}>{r.intern ? '—' : fmtK(r.marge)}</td>
                  <td style={td('right')}>{r.intern ? '—' : pctStr(r.marge, r.omzet)}</td>
                  <td style={td('right', { ...mono, borderLeft: '1px solid var(--bd2)' })}>{r.intern ? '—' : fmtK(r.projOmzet)}</td>
                  <td style={td('right', { ...mono, fontWeight: 600, color: r.intern ? 'var(--t3)' : margeColor(r.projMarge) })}>{r.intern ? '—' : fmtK(r.projMarge)}</td>
                  <td style={td('right')}>{r.intern ? '—' : pctStr(r.projMarge, r.projOmzet)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '2px solid var(--bd3)', color: 'var(--t1)', fontWeight: 700 }}>
                <td style={td('left')}>Totaal ({rows.length} projecten)</td><td /><td />
                <td style={td('right', mono)}>{fmtU(tot.u)}</td><td style={td('right', { borderLeft: '1px solid var(--bd2)' })} /><td />
                <td style={td('right', mono)}>{fmtK(tot.omzet)}</td>
                <td style={td('right', mono)}>{fmtK(tot.kosten)}</td>
                <td style={td('right', { ...mono, color: margeColor(tot.omzet - tot.kosten) })}>{fmtK(tot.omzet - tot.kosten)}</td>
                <td style={td('right')}>{pctStr(tot.omzet - tot.kosten, tot.omzet)}</td>
                <td style={td('right', { ...mono, borderLeft: '1px solid var(--bd2)' })}>{fmtK(tot.projOmzet)}</td>
                <td style={td('right', { ...mono, color: margeColor(tot.projMarge) })}>{fmtK(tot.projMarge)}</td>
                <td style={td('right')}>{pctStr(tot.projMarge, tot.projOmzet)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ maxWidth: 720, overflowX: 'auto' }}>
          <FilterBar state={klantTabel.state} placeholder="filter op klant…" n={klantTabel.rows.length} totaal={klantRijen.length} />
          <table style={{ borderCollapse: 'collapse', fontSize: 10.5, width: '100%' }}>
            <thead>
              <tr style={groupRow}>
                <th colSpan={3} />
                <th colSpan={2} style={groupTh()}>Aandeel</th>
                <th colSpan={2} style={groupTh()}>Projecten totaal</th>
              </tr>
              <tr style={{ color: 'var(--t3)' }}>
                <SortTh k="klant" label="Klant" state={klantTabel.state} align="left" /><SortTh k="n" label="Proj." state={klantTabel.state} /><SortTh k="u" label="Uren" state={klantTabel.state} />
                <SortTh k="omzet" label="Omzet" state={klantTabel.state} extra={{ borderLeft: '1px solid var(--bd2)' }} /><SortTh k="marge" label="Marge" state={klantTabel.state} />
                <SortTh k="projOmzet" label="Omzet" state={klantTabel.state} extra={{ borderLeft: '1px solid var(--bd2)' }} /><SortTh k="projMarge" label="Marge" state={klantTabel.state} />
              </tr>
            </thead>
            <tbody>
              {klantTabel.rows.map(c => (
                <tr key={c.klant} style={{ borderTop: '1px solid var(--bd2)', color: 'var(--t1)' }}>
                  <td style={td('left', { maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' })}>{c.klant}</td>
                  <td style={td('right', { color: 'var(--t3)' })}>{c.n}</td>
                  <td style={td('right', mono)}>{fmtU(c.u)}</td>
                  <td style={td('right', { ...mono, borderLeft: '1px solid var(--bd2)' })}>{c.intern ? '—' : fmtK(c.omzet)}</td>
                  <td style={td('right', { ...mono, fontWeight: 700, color: margeColor(c.marge) })}>{c.intern ? '—' : fmtK(c.marge)}</td>
                  <td style={td('right', { ...mono, borderLeft: '1px solid var(--bd2)', color: 'var(--t2)' })}>{c.intern ? '—' : fmtK(c.projOmzet)}</td>
                  <td style={td('right', { ...mono, fontWeight: 600, color: c.intern ? 'var(--t3)' : margeColor(c.projMarge) })}>{c.intern ? '—' : fmtK(c.projMarge)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 6 }}>● = project valt in de huidige selectie. "Aandeel" op uren-/detacheringsprojecten = uren × gefactureerd tarief van deze medewerker (geschaald naar de projectomzet); op eenheden/vaste prijs = naar rato van kosten. "Project totaal" = het hele project met alle medewerkers.</div>
    </div>
  )
}

// ── Projectdetail: maandreeks + weekoverzicht ───────────────────────────────
interface WeekRij extends WeekRow { margeWk: number; empsTekst: string }
const WEEK_KOL: Kolom<WeekRij>[] = [
  { key: 'w', get: r => r.w }, { key: 'productie', get: r => r.productie }, { key: 'bevestigd', get: r => r.bevestigd }, { key: 'uren', get: r => r.uren }, { key: 'kosten', get: r => r.kosten }, { key: 'margeWk', get: r => r.margeWk }, { key: 'empsTekst', get: r => r.empsTekst, text: true },
]

function ProjectDetail({ p, k, metMh, periodeLabel }: { p: DetailProject; k: Kpi; metMh: boolean; periodeLabel: string }) {
  const isE = p.id.startsWith('E-')
  const [alleWeken, setAlleWeken] = useState(false)
  const weekRijen = useMemo<WeekRij[]>(() => (p.weeks ?? []).map(w => ({ ...w, margeWk: w.productie - w.kosten, empsTekst: w.emps.map(([n, u]) => `${n} (${u})`).join(', ') })), [p])
  const legeFn = useMemo(() => alleWeken ? undefined : (w: WeekRij) => w.productie !== 0 || w.uren !== 0, [alleWeken])
  const weekTabel = useTabel(weekRijen, WEEK_KOL, { key: 'w', desc: false }, legeFn)
  const wTot = weekRijen.reduce((a, w) => ({ productie: a.productie + w.productie, bevestigd: a.bevestigd + w.bevestigd, uren: a.uren + w.uren, kosten: a.kosten + w.kosten }), { productie: 0, bevestigd: 0, uren: 0, kosten: 0 })
  const s = (a: number[]) => a.slice(0, MARGE_MAANDEN).reduce((x, y) => x + y, 0)
  const modelOmzetYtd = s(p.omzet) + s(p.ohw)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* KPI-regel */}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--t2)' }}>
        <span>Klant <b style={{ color: 'var(--t1)' }}>{p.klant || '—'}</b></span>
        <span>{p.ent} · {p.seg} · {TYPE_LABEL[p.id[0]] ?? p.id[0]}</span>
        <span>Omzet {periodeLabel} <b style={{ color: 'var(--t1)', ...mono }}>{fmtEur(k.omzet)}</b></span>
        <span>Kosten <b style={{ color: 'var(--t1)', ...mono }}>{fmtEur(k.kosten)}</b></span>
        <span>Marge <b style={{ color: margeColor(k.marge), ...mono }}>{fmtEur(k.marge)}</b> ({pctStr(k.marge, k.omzet)})</span>
        <span>Uren <b style={{ color: 'var(--t1)', ...mono }}>{fmtU(k.uren)}</b></span>
        {k.geenUren && <span style={{ color: 'var(--amber)' }}>◌ los dossier — omzet zonder geboekte uren, hangt niet aan projectwerk</span>}
      </div>

      {/* Maandreeks */}
      <table style={{ borderCollapse: 'collapse', fontSize: 11, ...mono, alignSelf: 'flex-start' }}>
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
          <div style={sectionTitle}>Weekoverzicht eenheden — productie (OHW Freezes) vs uren/kosten van die week</div>
          {weekRijen.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--amber)' }}>Geen weekproductie (OHW Freezes) en geen weekuren voor dit project gevonden — koppeling via projectnummer "Nummer 2026" niet mogelijk.</div>
          ) : (
            <>
              <FilterBar state={weekTabel.state} placeholder="filter op medewerker…" n={weekTabel.rows.length} totaal={weekRijen.length}>
                <label style={{ fontSize: 10.5, color: 'var(--t2)', cursor: 'pointer' }}><input type="checkbox" checked={alleWeken} onChange={e => setAlleWeken(e.target.checked)} style={{ accentColor: 'var(--blue)', marginRight: 4 }} />ook lege weken</label>
              </FilterBar>
              <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
                <thead>
                  <tr style={{ color: 'var(--t3)' }}>
                    <SortTh k="w" label="Week" state={weekTabel.state} align="left" /><SortTh k="productie" label="Productie" state={weekTabel.state} /><SortTh k="bevestigd" label="Bevestigd" state={weekTabel.state} title="Servicebevestigingen (meters/revisie) uit de Projectadministratie" />
                    <SortTh k="uren" label="Uren" state={weekTabel.state} /><SortTh k="kosten" label="Kosten" state={weekTabel.state} /><SortTh k="margeWk" label="Marge wk" state={weekTabel.state} /><SortTh k="empsTekst" label="Medewerkers (uren)" state={weekTabel.state} align="left" />
                  </tr>
                </thead>
                <tbody>
                  {weekTabel.rows.map(w => (
                    <tr key={w.w} style={{ borderTop: '1px solid var(--bd2)', color: 'var(--t1)' }}>
                      <td style={td('left', { ...mono, color: 'var(--t2)' })} title={w.taken ? w.taken.map(([t, v]) => `${t}: ${fmtEur(v)}`).join('\n') : undefined}>wk {w.w}</td>
                      <td style={td('right', mono)}>{fmtEur(w.productie)}</td>
                      <td style={td('right', { ...mono, color: 'var(--t2)' })}>{w.bevestigd ? fmtEur(w.bevestigd) : '—'}</td>
                      <td style={td('right', { color: 'var(--t3)' })}>{w.uren}</td>
                      <td style={td('right', { ...mono, color: 'var(--t2)' })}>{fmtEur(w.kosten)}</td>
                      <td style={td('right', { ...mono, fontWeight: 700, color: margeColor(w.margeWk) })}>{fmtEur(w.margeWk)}</td>
                      <td style={{ ...td('left'), whiteSpace: 'normal', color: 'var(--t2)', fontSize: 10.5 }}>{w.empsTekst}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid var(--bd3)', color: 'var(--t1)', fontWeight: 700 }}>
                    <td style={td('left')}>YTD</td>
                    <td style={td('right', mono)}>{fmtEur(wTot.productie)}</td>
                    <td style={td('right', mono)}>{wTot.bevestigd ? fmtEur(wTot.bevestigd) : '—'}</td>
                    <td style={td('right')}>{wTot.uren}</td>
                    <td style={td('right', mono)}>{fmtEur(wTot.kosten)}</td>
                    <td style={td('right', { ...mono, color: margeColor(wTot.productie - wTot.kosten) })}>{fmtEur(wTot.productie - wTot.kosten)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
              <ul style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 6, paddingLeft: 16, lineHeight: 1.5 }}>
                <li>Productie = "Delta waarde vorige week" uit OHW Trendlijnen - 2026 (OHW Freezes), gekoppeld op projectnummer; hover over de week voor de work packages.</li>
                <li>Weekproductie YTD {fmtEur(wTot.productie)} vs. maandmodel (facturatie + Δ OHW) {fmtEur(modelOmzetYtd)}{Math.abs(wTot.productie - modelOmzetYtd) > 1000 ? ` — verschil ${fmtEur(wTot.productie - modelOmzetYtd)} (timing facturatie/OHW-snapshots)` : ''}.</li>
                <li>Uren van de week zijn op projectniveau gekoppeld (niet per work package). Bron eenheden-snapshots: {MARGE_META.eenhedenSnapshotsOntbreken.join(', ')} ontbreken (geïnterpoleerd).</li>
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
