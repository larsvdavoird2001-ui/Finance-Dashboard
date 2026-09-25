#!/usr/bin/env node
// Genereert src/data/marginData.ts — brutomarge per entiteit × marktsegment × maand
// (2026) voor het tabblad "Omzet per markt" (weergave "Marge").
//
//   node scripts/gen-margin-data.mjs
//
// Rekenmodel per project (daarna opgeteld naar klant → segment → entiteit):
//   omzet_productie = factuurvolume (SAP CRMCIVIB) + Δ onderhanden werk
//   Δ OHW           = verschil tussen maandsnapshots van de SAP-overzichten:
//                     U-facturatie (uren nog niet gefactureerd), D-facturatie
//                     (detachering), conceptfacturen en de OHW-eenhedenlijst
//   kosten          = productieve uren (SAP-urenexport) × kostprijs+AK per
//                     medewerker (tarievenbestand kolom F)
//   marge           = omzet_productie − kosten
// Kosten worden toegerekend aan de entiteit van het PROJECT (niet van de
// medewerker): IC-uren zitten dus in de marge van het project.
//
// Bronbestanden (paden hieronder; pas aan bij een volgende maand):
//   - urenexport: "WN Tijden P1-8 20260910.xlsx", tab SAPAnalyticsReport(ZEB…)
//   - tarieven:   "20260507 TPG TARIEVEN P4 2026 EN VERDER gedeeld met Lars.xlsx"
//   - factuurvolume.csv (sales-dashboard sync)
//   - per maand de map "Overzichten SAP <maand>" uit de maandafsluiting-zip
//   - scripts/klant-toewijzing.json (handmatige segment-toewijzing)
import xlsx from 'xlsx'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const ZIP = 'X:/2026/2026'
const SRC = {
  uren: `${ZIP}/08 Augustus 2026/WN Tijden P1-8 20260910.xlsx`,
  urenSheet: 'SAPAnalyticsReport(ZEB647CDC3F5',
  tarieven: 'C:/Users/lvanderavoird/Downloads/20260507 TPG TARIEVEN P4 2026 EN VERDER gedeeld met Lars.xlsx',
  factuurvolume: 'C:/Users/lvanderavoird/OneDrive - The People Group/Documenten/Claude Projects/Dashboard Sales/automation/tmp/factuurvolume.csv',
  toewijzing: path.join(__dirname, 'klant-toewijzing.json'),
  tarievenAanvulling: path.join(__dirname, 'tarieven-aanvulling.json'), // uit import-tarieven-invullijst.mjs
}
// Maandsnapshots van de SAP-overzichten (index = maand 1..8). null = geen snapshot.
const SNAP = [
  null,
  { dir: `${ZIP}/01. Januari 2026/Overzichten SAP januari 2026`, u: 'U-facturatie januari 2026.xlsx', d: 'D-facturatie januari 2026.xlsx', c: 'Conceptfacturen januari 2026.xlsx', e: 'Onderhanden Werk eind week 5 NA.xlsx' },
  { dir: `${ZIP}/02. Februari 2026/Overzichten SAP februari 2026`, u: 'U-facturatie februari .xlsx', d: 'D-facturatie februari.xlsx', c: 'Conceptfacturen februari.xlsx', e: 'Onderhanden Werk eind week 9 NA.xlsx' },
  { dir: `${ZIP}/03. Maart 2026/Overzichten SAP maart 2026`, u: 'U-facturatie maart.xlsx', d: 'D-facturatie maart.xlsx', c: 'Conceptfacturatie maart.xlsx', e: null },
  { dir: `${ZIP}/04. April 2026/Overzichten SAP april 2026`, u: 'U-facturatie april.xlsx', d: 'D-facturatie april.xlsx', c: 'Conceptfacturen april.xlsx', e: 'Onderhanden Werk week 18 NA.xlsx' },
  { dir: `${ZIP}/05. Mei 2026/Overzichten SAP mei 2026`, u: 'U-facturatie mei.xlsx', d: 'D-facturatie mei.xlsx', c: 'Conceptfacturen mei.xlsx', e: 'Onderhanden Werk week 22 NA.xlsx' },
  { dir: `${ZIP}/06. Juni 2026/Overzichten SAP juni 2026`, u: 'U-facturatie juni 2026.xlsx', d: 'D-facturatie juni 2026.xlsx', c: 'Conceptfacture juni 2026.xlsx', e: 'Onderhanden Werk week 27 VOOR.xlsx' },
  { dir: `${ZIP}/07. Juli 2026/Overzichten SAP juli 2026`, u: 'U-facturatie juli.xlsx', d: 'D-facturatie juli.xlsx', c: 'Conceptfacturatie juli.xlsx', e: null },
  { dir: `${ZIP}/08 Augustus 2026/Overzichten SAP augustus 2026`, u: 'U-facturatie augustus.xlsx', d: 'D-facturatie augustus.xlsx', c: 'Conceptfacturen augustus.xlsx', e: 'EXCEL Onderhanden Werk P8 2026.xlsx' },
]
const N_MONTHS = 8
// Openingsstand Dec-25 per OHW-lijst (uit de OHW-administratie P08, sheet OHW mbM);
// wordt naar rato van de jan-snapshot over projecten verdeeld.
const OPENING_DEC25 = { u: 123447.88 + 9375.99, d: 182462.9, c: 311120.3, e: 299966 }
// Missing hours-lijsten (nog niet geboekte/goedgekeurde uren) per maand, index = maand.
const MISSING = [null,
  'Missing hours januari 2026.xlsx', 'Missing hours februari.xlsx', 'Missing hours maart.xlsx', 'Missing hours april.xlsx',
  'Missing hours mei (aangepast).xlsx', 'Missing hours juni 2026.xlsx', 'Missing hours juli.xlsx', 'Missing hours augustus.xlsx',
]
// Openingsstand missing hours Dec-25 (OHW-admin): Consultancy 39.569, Projects 0
const MISSING_OPENING = { Consultancy: 39569, Projects: 0, Software: 0 }

const ENTS = ['Consultancy', 'Projects', 'Software']
const SEGS = ['1. Public', '2. Telecom', '3. Energy', '4. Civil', '5. Industry', '6. Overig']
const CODE_ENT = {
  '15': 'Consultancy', '09': 'Consultancy', '06': 'Consultancy', '05': 'Consultancy',
  '01': 'Projects', '08': 'Projects', '18': 'Projects',
  '07': 'Software', '12': 'Software', '17': 'Software',
}
const EENHEID_ENT = {
  'projects ak': 'Projects', 'team kort cyclisch werk': 'Projects', 'team infra': 'Projects',
  'team externe projecten': 'Projects', 'team interne projecten': 'Projects',
  'bovengrondse infra b.v.': 'Projects', 'team ruimtelijke ordening': 'Projects', '4d b.v.': 'Projects',
  'software ak': 'Software', 'geo & data b.v.': 'Software', 'gis specialisten b.v.': 'Software',
  'geoheating': 'Software', 'geofiber': 'Software',
  'consultancy ak': 'Consultancy', 'ingenieurs & specialisten ak': 'Consultancy',
  'professional services': 'Consultancy', 'industrie & energie b.v.': 'Consultancy',
  'bouw & installatietechniek b.v.': 'Consultancy', 'design house': 'Consultancy',
  'public': 'Consultancy', 'the people group | mechatronics': 'Consultancy',
}
const SEG_ALIAS = {
  'public': '1. Public', 'telecom': '2. Telecom', 'energy': '3. Energy', 'energie': '3. Energy',
  'civil': '4. Civil', 'civiel': '4. Civil', 'industry': '5. Industry', 'industrie': '5. Industry',
  'overig': '6. Overig',
}
const normSeg = s => {
  if (!s) return null
  const t = String(s).trim()
  if (SEGS.includes(t)) return t
  const a = SEG_ALIAS[t.toLowerCase().replace(/^\d\.\s*/, '')]
  return a ?? null
}
const projIdOf = task => { const m = String(task ?? '').trim().match(/^([A-Z]-\d+)/); return m ? m[1] : null }
const projBedrijfEnt = v => {
  const s = String(v ?? '').trim()
  const m = s.match(/^P(\d{2})000/)
  if (m) return CODE_ENT[m[1]] ?? null
  const l = s.toLowerCase()
  if (l.includes('software')) return 'Software'
  if (l.includes('consultancy')) return 'Consultancy'
  if (l.includes('projects')) return 'Projects'
  return null
}
const serialToMonth = ser => { const d = new Date(Date.UTC(1899, 11, 30) + ser * 86400000); return [d.getUTCFullYear(), d.getUTCMonth() + 1] }
const arr12 = () => new Array(12).fill(0)
const sheetRows = (file, sheetName) => {
  const wb = xlsx.readFile(file)
  const ws = wb.Sheets[sheetName ?? wb.SheetNames.find(n => n.startsWith('Exporteren')) ?? wb.SheetNames[0]]
  return xlsx.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
}
const findHeader = (rows, must) => rows.findIndex(r => r && must.every(m => r.some(c => typeof c === 'string' && c.startsWith(m))))
const colIdx = (hdr, name) => hdr.findIndex(c => typeof c === 'string' && c.startsWith(name))

// ── 1. Tarieven ─────────────────────────────────────────────────────────────
// rate[id] = { bedrijf, naam, kostprijsAK, bron }; bron: 'tarievenbestand' | 'ingevuld' | 'spanje'.
// Wie nergens in staat krijgt de mediaan van zijn bedrijf (bron 'geschat', kostenFallback).
const rate = {}
{
  const rows = sheetRows(SRC.tarieven, 'HC Tarieven 20260507')
  for (const r of rows) {
    if (typeof r?.[1] === 'number' && typeof r[5] === 'number') rate[r[1]] = { bedrijf: r[0], naam: r[2], kostprijsAK: r[5], bron: 'tarievenbestand' }
  }
}
const medianBy = {}
for (const b of ['Consultancy', 'Projects', 'Software']) {
  const v = Object.values(rate).filter(x => x.bedrijf === b).map(x => x.kostprijsAK).sort((a, c) => a - c)
  medianBy[b] = v[Math.floor(v.length / 2)]
}
const bedrijfKey = b => /Software/i.test(b) ? 'Software' : /Consultancy/i.test(b) ? 'Consultancy' : 'Projects'
console.log(`tarieven: ${Object.keys(rate).length} medewerkers; mediaan kostprijs+AK`, medianBy)
// Aanvulling (invullijst Lars + Spanje-regel); tarief null = blijft schatting
const AANVULLING = fs.existsSync(SRC.tarievenAanvulling) ? JSON.parse(fs.readFileSync(SRC.tarievenAanvulling, 'utf8')) : { medewerkers: [] }
for (const m of AANVULLING.medewerkers) {
  if (typeof m.tarief === 'number' && !rate[m.id]) rate[m.id] = { bedrijf: m.bedrijf, naam: m.naam, kostprijsAK: m.tarief, bron: m.bron }
}
const bronVan = emp => rate[emp]?.bron ?? 'geschat'
const kostprijsVan = (emp, bedrijfStr) => rate[emp]?.kostprijsAK ?? (/Spanje/i.test(String(bedrijfStr)) ? medianBy.Projects : medianBy[bedrijfKey(String(bedrijfStr))])
console.log(`aanvulling: ${AANVULLING.medewerkers.filter(m => typeof m.tarief === 'number').length} tarieven uit ${path.basename(SRC.tarievenAanvulling)} (${AANVULLING.datum ?? '?'})`)
const bronTot = {} // bron → { personen:Set, uren, kosten } — voor MARGE_META.tariefBronnen

// ── 2. Uren × kostprijs per project per maand ───────────────────────────────
const proj = {} // id → { naam, uren[12], kosten[12], kostenFallback[12], empEnt:{}, omzet[12], ohw:{u,d,c,e}[snapshots], klant, btk, segFromList, ent }
const P = id => (proj[id] ??= { id, naam: '', uren: arr12(), kosten: arr12(), kostenFallback: arr12(), mhOmzet: arr12(), mhKosten: arr12(), empEnt: {}, omzet: arr12(), omzet2025: arr12(), snaps: { u: [], d: [], c: [], e: [] }, klant: null, klanten: {}, btks: {}, segList: {}, ents: {}, feron: false })
const missingRate = {}
const empMix = {}   // werknemer-id → maand(1-12) → { projId: uren }  (projectmix voor verdeling missing hours)
const empInfo = {}  // werknemer-id → { naam, bedrijf }
{
  const rows = sheetRows(SRC.uren, SRC.urenSheet)
  for (let i = 1; i < rows.length; i++) {
    const x = rows[i]
    if (!x || x[15] !== 'Productieve tijd' || !x[7] || typeof x[11] !== 'number') continue
    const [y, m] = serialToMonth(x[11])
    if (y !== 2026) continue
    const uren = x[17] ?? 0
    const p = P(String(x[7]).trim())
    if (!p.naam && x[8]) p.naam = String(x[8]).trim()
    p.uren[m - 1] += uren
    const eb = bedrijfKey(String(x[0] ?? ''))
    p.empEnt[eb] = (p.empEnt[eb] ?? 0) + uren
    const emp = x[2]
    ;((empMix[emp] ??= {})[m] ??= {})[p.id] = (empMix[emp][m][p.id] ?? 0) + uren
    empInfo[emp] ??= { naam: x[3], bedrijf: bedrijfKey(String(x[0] ?? '')) }
    const rt = rate[x[2]]
    const bt = (bronTot[bronVan(emp)] ??= { personen: new Set(), uren: 0, kosten: 0 })
    bt.personen.add(emp); bt.uren += uren
    if (rt) { p.kosten[m - 1] += uren * rt.kostprijsAK; bt.kosten += uren * rt.kostprijsAK }
    else {
      const fb = kostprijsVan(emp, x[0])
      p.kostenFallback[m - 1] += uren * fb; bt.kosten += uren * fb
      const key = `${x[3]}|${x[0]}`
      missingRate[key] ??= { naam: x[3], bedrijf: String(x[0]).replace('The People Group', 'TPG'), uren: 0 }
      missingRate[key].uren += uren
    }
  }
}

// ── 3. Factuurvolume → omzet per project + klant/segment/entiteit ───────────
const TOEWIJZING = JSON.parse(fs.readFileSync(SRC.toewijzing, 'utf8')).toewijzingen
const klantBtk = {}        // klant → { btk: bedrag } (fallback-segment per klant)
const zonderProject = {}   // facturen zonder projectnummer ('#') — buiten de matrix
{
  const lines = fs.readFileSync(SRC.factuurvolume, 'utf8').replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n')
  let h = -1
  for (let i = 0; i < 25; i++) { const p = (lines[i] ?? '').split(';').map(s => s.trim()); if (['Klant', 'Bedrijfstak', 'Factuur', 'Factuurdatum'].every(r => p.includes(r))) { h = i; break } }
  const hd = lines[h].split(';').map(s => s.trim())
  const c = n => hd.indexOf(n)
  const iP = c('Project'), iK = c('Klant'), iB = c('Bedrijfstak'), iE = c('Verantwoordelijke eenheid (Project)'), iF = c('Factuur'), iD = c('Factuurdatum'), iW = c('Gefactureerde nettowaarde')
  const amt = s => { let t = String(s ?? '').replace(/EUR/gi, '').trim(); t = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/\./g, ''); return parseFloat(t) || 0 }
  for (let i = h + 1; i < lines.length; i++) {
    const x = lines[i].split(';')
    if (x.length < 6) continue
    const id = (x[iP] ?? '').trim(); const klant = (x[iK] ?? '').trim(); const dat = (x[iD] ?? '').trim()
    if (!id || !klant || !dat) continue
    if (klant.toLowerCase().includes('the people group')) continue
    const [dd, mm, yy] = dat.split('.')
    const bedrag = amt(x[iW])
    const btk0 = (x[iB] ?? '').trim()
    if (btk0 && btk0 !== 'Niet toegewezen') { (klantBtk[klant] ??= {})[btk0] = (klantBtk[klant][btk0] ?? 0) + Math.abs(bedrag) }
    if (id === '#' || !/^[A-Z]-\d+/.test(id)) {
      if (yy === '2026') zonderProject[klant] = (zonderProject[klant] ?? 0) + bedrag
      continue
    }
    const p = P(id)
    if (yy === '2026') p.omzet[parseInt(mm) - 1] += bedrag
    else if (yy === '2025') p.omzet2025[parseInt(mm) - 1] += bedrag
    p.klanten[klant] = (p.klanten[klant] ?? 0) + Math.abs(bedrag)
    const btk = (x[iB] ?? '').trim()
    if (btk) p.btks[btk] = (p.btks[btk] ?? 0) + Math.abs(bedrag)
    const een = EENHEID_ENT[(x[iE] ?? '').trim().toLowerCase()]
    const pre = String(x[iF] ?? '').match(/^[A-Z]{2,3}(\d{2})-/)
    const ent = een ?? (pre ? CODE_ENT[pre[1]] : null)
    if (ent) p.ents[ent] = (p.ents[ent] ?? 0) + Math.abs(bedrag)
    void dd
  }
}

// ── 4. OHW-snapshots per project ────────────────────────────────────────────
function readList(file, kind) {
  const rows = sheetRows(file)
  const hi = findHeader(rows, ['Project', 'Nog niet gefactureerde nettowaarde'])
  if (hi < 0) throw new Error(`geen header in ${file}`)
  const hdr = rows[hi]
  const iProj = hdr.indexOf('Project'), iVal = colIdx(hdr, 'Nog niet gefactureerde nettowaarde'), iKl = hdr.indexOf('Klant'),
    iSeg = hdr.indexOf('Marktsegment'), iPb = hdr.indexOf('Projectbedrijf'), iSt = colIdx(hdr, 'Projectfactuuraanvraag - status')
  const out = {}
  for (let i = hi + 1; i < rows.length; i++) {
    const x = rows[i]; if (!x) continue
    const id = projIdOf(x[iProj]); if (!id) continue
    // Subtotaalregels (status leeg) en al gefactureerde regels overslaan — de
    // OHW-administratie telt alleen 'Niet toegewezen' (+ 'Vrijgegeven' = factuuraanvraag).
    const status = iSt >= 0 ? String(x[iSt] ?? '').trim() : 'Niet toegewezen'
    if (!status || status === 'Gefactureerd') continue
    const v = typeof x[iVal] === 'number' ? x[iVal] : 0
    out[id] = (out[id] ?? 0) + v
    const p = P(id)
    if (iKl >= 0 && x[iKl] && !p.klanten[x[iKl]]) p.klanten[x[iKl]] = (p.klanten[x[iKl]] ?? 0) + 0.001
    if (iSeg >= 0 && x[iSeg]) { const s = normSeg(x[iSeg]); if (s) p.segList[s] = (p.segList[s] ?? 0) + 1 }
    if (iPb >= 0 && x[iPb]) { const e = projBedrijfEnt(x[iPb]); if (e) p.ents[e] = (p.ents[e] ?? 0) + 0.001 }
  }
  void kind
  return out
}
function readConcept(file) {
  const rows = sheetRows(file)
  const hi = findHeader(rows, ['Klant', 'Factuur', 'Nettowaarde'])
  const hdr = rows[hi]
  const iTask = hdr.indexOf('Projecttaak'), iVal = hdr.indexOf('Nettowaarde'), iKl = hdr.indexOf('Klant'), iSeg = hdr.indexOf('Marktsegment'), iPb = hdr.indexOf('Bedrijf')
  const out = {}
  for (let i = hi + 1; i < rows.length; i++) {
    const x = rows[i]; if (!x) continue
    const id = projIdOf(x[iTask]); if (!id) continue
    out[id] = (out[id] ?? 0) + (typeof x[iVal] === 'number' ? x[iVal] : 0)
    const p = P(id)
    if (x[iKl] && !p.klanten[x[iKl]]) p.klanten[x[iKl]] = 0.001
    if (x[iSeg]) { const s = normSeg(x[iSeg]); if (s) p.segList[s] = (p.segList[s] ?? 0) + 1 }
    if (x[iPb]) { const e = projBedrijfEnt(x[iPb]); if (e) p.ents[e] = (p.ents[e] ?? 0) + 0.001 }
  }
  return out
}
function readEenheden(file) {
  const rows = sheetRows(file, 'Onderhande Werk')
  const hdr = rows[1]
  // 'Waarde NTF' is de totaalkolom van de OHW-kolommen — niet meetellen
  const wCols = hdr.map((h, i) => [h, i]).filter(([h]) => typeof h === 'string' && /^Waarde OHW/.test(h)).map(([, i]) => i)
  const iResp = hdr.indexOf('Responsible TPG'), iKl = hdr.indexOf('Klant')
  const out = {}
  for (let i = 2; i < rows.length; i++) {
    const x = rows[i]; if (!x || !x[0]) continue
    const id = projIdOf(x[0]); if (!id) continue
    let v = 0; for (const c of wCols) v += typeof x[c] === 'number' ? x[c] : 0
    out[id] = (out[id] ?? 0) + v
    const p = P(id)
    if (String(x[iResp] ?? '').trim() === 'Feron van Hoeven' && v !== 0) p.feron = true
    if (x[iKl] && !Object.keys(p.klanten).length) p.klanten[String(x[iKl])] = 0.001
  }
  return out
}
const snapTotals = { u: [], d: [], c: [], e: [] }
for (let m = 1; m <= N_MONTHS; m++) {
  const s = SNAP[m]
  const lists = {
    u: s.u ? readList(path.join(s.dir, s.u), 'u') : null,
    d: s.d ? readList(path.join(s.dir, s.d), 'd') : null,
    c: s.c ? readConcept(path.join(s.dir, s.c)) : null,
    e: s.e ? readEenheden(path.join(s.dir, s.e)) : null,
  }
  for (const k of ['u', 'd', 'c', 'e']) {
    const l = lists[k]
    snapTotals[k][m] = l ? Math.round(Object.values(l).reduce((a, b) => a + b, 0)) : null
    if (!l) continue
    for (const [id, v] of Object.entries(l)) P(id).snaps[k][m] = v
  }
}
// ontbrekende eenheden-snapshots (mrt, jul) lineair interpoleren per project
for (const p of Object.values(proj)) {
  for (let m = 1; m <= N_MONTHS; m++) {
    if (SNAP[m].e) continue
    const prev = p.snaps.e[m - 1] ?? 0, next = p.snaps.e[m + 1] ?? 0
    p.snaps.e[m] = (prev + next) / 2
  }
}
// openingsstand Dec-25 naar rato van de jan-snapshot
for (const k of ['u', 'd', 'c', 'e']) {
  const tot = Object.values(proj).reduce((a, p) => a + (p.snaps[k][1] ?? 0), 0)
  for (const p of Object.values(proj)) p.snaps[k][0] = tot ? (p.snaps[k][1] ?? 0) / tot * OPENING_DEC25[k] : 0
}
console.log('snapshot-totalen per lijst (jan..aug):')
for (const k of ['u', 'd', 'c', 'e']) console.log(`  ${k}:`, snapTotals[k].slice(1).map(v => v == null ? '—' : v).join(' | '))

// ── 4b. Missing hours (nog niet geboekte/goedgekeurde uren) ─────────────────
// De maandstand per entiteit komt uit de OHW-administratie (leidend, zoals
// geboekt in de maandafsluiting). De missing-hours-lijst van die maand levert
// alleen de VERDEELSLEUTEL over medewerkers (positieve missing hours × bruto
// verkooptarief). De mutatie per medewerker per maand wordt vervolgens verdeeld
// over de projecten waar die medewerker in die maand op heeft geschreven (naar
// rato van uren; fallback: YTD-mix). Kosten = mutatie-uren × kostprijs+AK.
// Bij detachering (één project per medewerker) is dit exact; bij Projects een
// schatting — daarom apart opgeslagen (mhOmzet/mhKosten) en in de UI uitzetbaar.
const MH_STAND = {  // OHW-admin P08: stand per maand (Dec-25 .. Aug-26)
  Consultancy: [39569, 64256, 76090, 49700, 48750.5, 33768, 56173.5, 49938, 72037.5],
  Projects:    [0, 12000, 12000, 6000, 0, 0, 0, 23152.5, 32000],
  Software:    [0, 0, 0, 0, 0, 0, 0, 0, 0],
}
const nameToId = {}
for (const [id, e] of Object.entries(empInfo)) nameToId[String(e.naam).trim().toLowerCase()] = Number(id)
function readMissing(file) {
  const wb = xlsx.readFile(file)
  const tarief = {}
  for (const n of wb.SheetNames) {
    const rows = xlsx.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null })
    const hi = rows.findIndex(r => r && r.some(c => typeof c === 'string' && /Persoons-?ID/i.test(c)))
    if (hi < 0) continue
    const hdr = rows[hi]
    const iId = hdr.findIndex(c => typeof c === 'string' && /Persoons-?ID/i.test(c))
    const iN = hdr.findIndex(c => typeof c === 'string' && /^Naam$/i.test(c))
    const iT = hdr.findIndex(c => typeof c === 'string' && /verkoop\s*tarief/i.test(c))
    if (iId < 0 || iT < 0) continue
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i]
      if (typeof r?.[iId] === 'number' && typeof r[iT] === 'number') {
        tarief[r[iId]] = r[iT]
        if (iN >= 0 && r[iN]) nameToId[String(r[iN]).trim().toLowerCase()] ??= r[iId]
      }
    }
    break
  }
  const rows = sheetRows(file)
  const hi = rows.findIndex(r => r && r.some(c => typeof c === 'string' && /^Missing hours/i.test(c)))
  if (hi < 0) throw new Error(`geen Missing Hours-header in ${file}`)
  const hdr = rows[hi]
  // positieve weekwaarden van 'Missing Hours' (negatief = overuren, telt niet mee)
  const iMh = hdr.findIndex(c => typeof c === 'string' && /^Missing hours$/i.test(c))
  const iBed = hdr.indexOf('Bedrijf'), iEmp = hdr.indexOf('Werknemer')
  const share = {} // ent → emp → gewogen uren (uren × tarief)
  let onbekend = 0
  for (let i = hi + 1; i < rows.length; i++) {
    const x = rows[i]; if (!x) continue
    const mh = typeof x[iMh] === 'number' ? x[iMh] : 0
    if (mh <= 0) continue
    let emp = x[iEmp]
    if (typeof emp === 'string') emp = /^\d+$/.test(emp.trim()) ? Number(emp.trim()) : (nameToId[emp.trim().toLowerCase()] ?? null)
    if (typeof emp !== 'number') { onbekend += mh; continue }
    const ent = projBedrijfEnt(x[iBed]) ?? 'Projects'
    ;(share[ent] ??= {})[emp] = (share[ent][emp] ?? 0) + mh
  }
  return { share, tarief, onbekend }
}
const mhSnap = []
const mhTariefAll = {}
const mhLog = []
for (let m = 1; m <= N_MONTHS; m++) {
  if (!MISSING[m]) { mhSnap[m] = null; continue }
  const s = readMissing(path.join(SNAP[m].dir, MISSING[m]))
  Object.assign(mhTariefAll, s.tarief)
  mhSnap[m] = s
  mhLog.push(`${m}: ${Object.entries(s.share).map(([e, o]) => `${e} ${Object.keys(o).length} mdw/${Math.round(Object.values(o).reduce((a, b) => a + b, 0))}u`).join(', ')}${s.onbekend ? ` (onbekend ${Math.round(s.onbekend)}u)` : ''}`)
}
console.log('missing hours-lijsten (verdeelsleutel):', mhLog.join(' | '))
// stand per medewerker per maand = entiteitstand × aandeel (uren × verkooptarief)
const mhEmpStand = [] // m → ent → emp → waarde
const mhOnverdeeld = {}
for (let m = 0; m <= N_MONTHS; m++) {
  mhEmpStand[m] = {}
  const src = mhSnap[m] ?? mhSnap[1] // Dec-25: verdeel opening met de jan-sleutel
  for (const ent of Object.keys(MH_STAND)) {
    const total = MH_STAND[ent][m] ?? 0
    const sh = src?.share[ent] ?? {}
    const w = Object.fromEntries(Object.entries(sh).map(([emp, u]) => [emp, u * (mhTariefAll[emp] ?? 70)]))
    const wt = Object.values(w).reduce((a, b) => a + b, 0)
    // geen verdeelsleutel voor deze entiteit/maand → hele stand op één pseudo-medewerker
    mhEmpStand[m][ent] = wt ? Object.fromEntries(Object.entries(w).map(([emp, v]) => [emp, total * v / wt])) : (total ? { '_onverdeeld': total } : {})
  }
}
let mhUrenTot = 0
for (let m = 1; m <= N_MONTHS; m++) {
  for (const ent of Object.keys(MH_STAND)) {
    const cur = mhEmpStand[m][ent], prev = mhEmpStand[m - 1][ent]
    const emps = new Set([...Object.keys(cur), ...Object.keys(prev)])
    for (const emp of emps) {
      const dOmzet = (cur[emp] ?? 0) - (prev[emp] ?? 0)
      if (!dOmzet) continue
      if (emp === '_onverdeeld') { (mhOnverdeeld[ent] ??= arr12())[m - 1] += dOmzet; continue }
      const vt = mhTariefAll[emp] ?? 70
      const dUren = dOmzet / vt
      const dKosten = dUren * (rate[emp]?.kostprijsAK ?? medianBy[ent] ?? 60)
      mhUrenTot += Math.abs(dUren)
      let mix = empMix[emp]?.[m]
      if (!mix || Object.keys(mix).length === 0) {
        mix = {}
        for (let mm = 1; mm <= N_MONTHS; mm++) for (const [pid, u] of Object.entries(empMix[emp]?.[mm] ?? {})) mix[pid] = (mix[pid] ?? 0) + u
      }
      const tot = Object.values(mix).reduce((a, b) => a + b, 0)
      if (!tot) { (mhOnverdeeld[ent] ??= arr12())[m - 1] += dOmzet; continue }
      for (const [pid, u] of Object.entries(mix)) {
        const p = P(pid)
        p.mhOmzet[m - 1] += dOmzet * u / tot
        p.mhKosten[m - 1] += dKosten * u / tot
      }
    }
  }
}
const mhTotals = Object.fromEntries(Object.entries(MH_STAND).map(([e, a]) => [e, a.slice(1)]))
for (const [e, arr] of Object.entries(mhOnverdeeld)) console.log(`  missing hours onverdeeld ${e}:`, arr.slice(0, N_MONTHS).map(v => Math.round(v / 1000) + 'k').join(' '))

// ── 5. Projectmaster: entiteit / klant / segment ────────────────────────────
const top = obj => Object.entries(obj).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
const INTERN_RE = /^(S-2301|S-2302|S-2801|S-2501|S-2701|G-1009)$/
for (const p of Object.values(proj)) {
  p.klant = top(p.klanten)
  p.ent = top(p.ents) ?? (p.id.startsWith('S-') ? 'Software' : p.id.startsWith('D-') ? 'Consultancy' : top(p.empEnt) ?? 'Projects')
  const btk = top(p.btks)
  let seg = normSeg(btk) ?? top(p.segList)
  if ((!seg || seg === '6. Overig' || btk === 'Niet toegewezen') && p.klant) {
    const tw = TOEWIJZING[p.klant.trim().toLowerCase()]
    if (tw) seg = normSeg(tw.segment) ?? seg
  }
  if (!seg && p.klant && klantBtk[p.klant]) seg = normSeg(top(klantBtk[p.klant]))
  if (p.feron) seg = '4. Civil'
  if (!seg && p.id.startsWith('E-')) seg = '2. Telecom'
  p.intern = INTERN_RE.test(p.id) || (!p.klant && p.id.startsWith('S-'))
  p.seg = p.intern ? 'Intern' : (seg ?? 'Niet toegewezen')
}

// ── 6. Aggregeren ───────────────────────────────────────────────────────────
const cell = {} // ent → seg → { omzet, ohw, kosten, kostenFallback, uren }
const C = (e, s) => ((cell[e] ??= {})[s] ??= { omzet: arr12(), ohw: arr12(), kosten: arr12(), kostenFallback: arr12(), uren: arr12(), mhOmzet: arr12(), mhKosten: arr12() })
const intern = {}  // ent → { kosten, uren }
const projectRows = []
for (const p of Object.values(proj)) {
  const ohwDelta = arr12()
  for (let m = 1; m <= N_MONTHS; m++) for (const k of ['u', 'd', 'c', 'e']) ohwDelta[m - 1] += (p.snaps[k][m] ?? 0) - (p.snaps[k][m - 1] ?? 0)
  const tot = a => a.slice(0, N_MONTHS).reduce((x, y) => x + y, 0)
  if (p.intern) {
    const t = (intern[p.ent] ??= { kosten: arr12(), uren: arr12() })
    for (let i = 0; i < 12; i++) { t.kosten[i] += p.kosten[i] + p.kostenFallback[i]; t.uren[i] += p.uren[i] }
    continue
  }
  const c = C(p.ent, p.seg)
  for (let i = 0; i < 12; i++) {
    c.omzet[i] += p.omzet[i]; c.ohw[i] += ohwDelta[i]; c.kosten[i] += p.kosten[i]; c.kostenFallback[i] += p.kostenFallback[i]; c.uren[i] += p.uren[i]
    c.mhOmzet[i] += p.mhOmzet[i]; c.mhKosten[i] += p.mhKosten[i]
  }
  const omzet = tot(p.omzet), ohw = tot(ohwDelta), kosten = tot(p.kosten) + tot(p.kostenFallback), uren = tot(p.uren)
  const mhO = tot(p.mhOmzet), mhK = tot(p.mhKosten)
  if (omzet !== 0 || ohw !== 0 || kosten !== 0 || mhO !== 0) {
    projectRows.push({ ent: p.ent, seg: p.seg, id: p.id, naam: p.naam, klant: p.klant ?? '', omzet: Math.round(omzet), ohw: Math.round(ohw), kosten: Math.round(kosten), uren: Math.round(uren), marge: Math.round(omzet + ohw - kosten), mhOmzet: Math.round(mhO), mhKosten: Math.round(mhK), geenUren: uren === 0 && (omzet + ohw) !== 0 })
  }
}
// Omzet op projecten zonder geboekte uren (kosten onbekend: inhuur/onderaanneming/fixed price)
const zonderUren = {}
for (const r of projectRows) if (r.geenUren) { (zonderUren[r.ent] ??= { omzet: 0, projecten: 0 }); zonderUren[r.ent].omzet += r.omzet + r.ohw; zonderUren[r.ent].projecten++ }
const rnd = a => a.map(v => Math.round(v))
const missingList = Object.values(missingRate).sort((a, b) => b.uren - a.uren).map(x => ({ naam: x.naam, bedrijf: x.bedrijf, uren: Math.round(x.uren) }))
const missingUren = missingList.reduce((a, b) => a + b.uren, 0)
const totUren = Object.values(proj).reduce((a, p) => a + p.uren.reduce((x, y) => x + y, 0), 0)

// ── 7. Schrijven ────────────────────────────────────────────────────────────
const L = []
L.push(`/**`)
L.push(` * AUTO-GENERATED door scripts/gen-margin-data.mjs — niet met de hand bewerken.`)
L.push(` * Brutomarge-benadering per entiteit × marktsegment × maand, 2026 t/m augustus.`)
L.push(` *   omzet   = factuurvolume per project (SAP CRMCIVIB)`)
L.push(` *   ohw     = mutatie onderhanden werk per project (U-/D-facturatie, conceptfacturen, OHW-eenheden)`)
L.push(` *   kosten  = productieve uren × kostprijs+AK (tarievenbestand P4 2026, aangevuld met de invullijst`)
L.push(` *             van Lars en de Spanje-regel — zie MARGE_META.tariefBronnen); kostenFallback = uren van`)
L.push(` *             medewerkers zónder enig tarief × mediaan van hun bedrijf (zie MARGE_META.zonderTarief)`)
L.push(` * Kosten volgen het project (IC-uren tellen mee bij het project), directe inkoop/auto/overige`)
L.push(` * personeelskosten zitten er NIET in — zie de aansluiting met de P&L in het tabblad.`)
L.push(` */`)
L.push(`/** mhOmzet/mhKosten = missing hours (nog niet geboekte uren): mutatie per maand, per medewerker`)
L.push(` *  verdeeld over diens projecten (exact bij detachering, schatting bij Projects) — apart zodat de UI ze kan uitzetten. */`)
L.push(`export interface MargeCel { omzet: number[]; ohw: number[]; kosten: number[]; kostenFallback: number[]; uren: number[]; mhOmzet: number[]; mhKosten: number[] }`)
L.push(`export const MARGE_MAANDEN = ${N_MONTHS}  // aantal gevulde maanden (jan..)`)
L.push(`export const marge2026: Record<string, Record<string, MargeCel>> = {`)
for (const e of ENTS) {
  L.push(`  ${e}: {`)
  for (const s of [...SEGS, 'Niet toegewezen']) {
    const c = cell[e]?.[s]; if (!c) continue
    L.push(`    '${s}': { omzet: ${JSON.stringify(rnd(c.omzet))}, ohw: ${JSON.stringify(rnd(c.ohw))}, kosten: ${JSON.stringify(rnd(c.kosten))}, kostenFallback: ${JSON.stringify(rnd(c.kostenFallback))}, uren: ${JSON.stringify(rnd(c.uren))}, mhOmzet: ${JSON.stringify(rnd(c.mhOmzet))}, mhKosten: ${JSON.stringify(rnd(c.mhKosten))} },`)
  }
  L.push(`  },`)
}
L.push(`}`)
L.push(``)
L.push(`/** Interne (niet-klant) projecten: kosten zonder omzet, per entiteit — buiten de matrix gehouden. */`)
L.push(`export const margeIntern2026: Record<string, { kosten: number[]; uren: number[] }> = {`)
for (const [e, t] of Object.entries(intern)) L.push(`  ${e}: { kosten: ${JSON.stringify(rnd(t.kosten))}, uren: ${JSON.stringify(rnd(t.uren))} },`)
L.push(`}`)
L.push(``)
L.push(`export interface MargeProject { ent: string; seg: string; id: string; naam: string; klant: string; omzet: number; ohw: number; kosten: number; uren: number; marge: number; mhOmzet: number; mhKosten: number; geenUren: boolean }`)
L.push(`/** Per project (YTD t/m aug), gesorteerd op |marge| — voor het detailpaneel. */`)
L.push(`export const margeProjecten2026: MargeProject[] = [`)
for (const r of projectRows.sort((a, b) => Math.abs(b.marge) - Math.abs(a.marge))) L.push(`  ${JSON.stringify(r)},`)
L.push(`]`)
L.push(``)
L.push(`export const MARGE_META = {`)
L.push(`  peildatum: '${new Date().toISOString().slice(0, 10)}',`)
L.push(`  tarievenBron: 'TPG TARIEVEN P4 2026 EN VERDER (07-05-2026), kolom F kostprijs+AK; aangevuld met de invullijst van Lars (${AANVULLING.datum ?? '-'}) en de Spanje-regel €${AANVULLING.spanjeTarief ?? '-'}/uur',`)
L.push(`  urenBron: 'SAP urenexport WN Tijden P1-8 (10-09-2026), alleen Productieve tijd',`)
L.push(`  urenTotaal: ${Math.round(totUren)},`)
L.push(`  urenZonderTarief: ${missingUren},`)
L.push(`  medianKostprijs: ${JSON.stringify(medianBy)},`)
L.push(`  /** Herkomst van de kostprijs per uur, over alle productieve uren:`)
L.push(` *  tarievenbestand = HC-tarievenbestand; ingevuld = invullijst Lars; spanje = €${AANVULLING.spanjeTarief ?? 35}-regel S.L.; geschat = mediaan bedrijf. */`)
L.push(`  tariefBronnen: ${JSON.stringify(Object.fromEntries(['tarievenbestand', 'ingevuld', 'spanje', 'geschat'].map(b => [b, { personen: bronTot[b]?.personen.size ?? 0, uren: Math.round(bronTot[b]?.uren ?? 0), kosten: Math.round(bronTot[b]?.kosten ?? 0) }])))},`)
L.push(`  /** Alle medewerkers buiten het tarievenbestand, met het gebruikte tarief en de bron (scripts/tarieven-aanvulling.json). */`)
L.push(`  tarievenAanvulling: ${JSON.stringify(AANVULLING.medewerkers.map(m => ({ id: m.id, naam: m.naam, bedrijf: m.bedrijf, uren: Math.round(m.urenProductief ?? 0), tarief: typeof m.tarief === 'number' ? m.tarief : (/Spanje/i.test(m.bedrijf) ? medianBy.Projects : medianBy[bedrijfKey(m.bedrijf)]), bron: m.bron })))},`)
L.push(`  eenhedenSnapshotsOntbreken: ['Mar-26', 'Jul-26'], // lineair geïnterpoleerd per project`)
L.push(`  /** Missing hours: stand per entiteit per maand (uren × verkooptarief) zoals berekend uit de lijsten;`)
L.push(` *  onverdeeld = mutatie van medewerkers zonder geschreven uren (niet aan een project te koppelen). */`)
L.push(`  missingHours: { stand: ${JSON.stringify(Object.fromEntries(Object.entries(mhTotals).map(([e, a]) => [e, rnd(a)])))}, onverdeeld: ${JSON.stringify(Object.fromEntries(Object.entries(mhOnverdeeld).map(([e, a]) => [e, rnd(a)])))}, mutatieUren: ${Math.round(mhUrenTot)} },`)
L.push(`  /** Omzet op projecten zonder geboekte uren (kosten onbekend), per entiteit. */`)
L.push(`  zonderUren: ${JSON.stringify(Object.fromEntries(Object.entries(zonderUren).map(([e, v]) => [e, { omzet: Math.round(v.omzet), projecten: v.projecten }])))},`)
L.push(`  /** Facturen 2026 zonder projectnummer (buiten de matrix gehouden), per klant. */`)
L.push(`  zonderProject: ${JSON.stringify(Object.fromEntries(Object.entries(zonderProject).filter(([, v]) => Math.abs(v) >= 1).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([k, v]) => [k, Math.round(v)])))},`)
L.push(`  zonderTarief: ${JSON.stringify(missingList)},`)
L.push(`}`)
L.push(``)
fs.writeFileSync(path.join(ROOT, 'src/data/marginData.ts'), L.join('\n'))

// ── 8. Rapportage ───────────────────────────────────────────────────────────
console.log(`\nprojecten: ${Object.keys(proj).length}, waarvan intern: ${Object.values(proj).filter(p => p.intern).length}`)
console.log(`uren totaal ${Math.round(totUren)}, zonder tarief ${missingUren} (${(missingUren / totUren * 100).toFixed(1)}%) over ${missingList.length} medewerkers`)
for (const e of ENTS) {
  const segs = cell[e] ?? {}
  const sum = k => Object.values(segs).reduce((a, c) => a + c[k].slice(0, N_MONTHS).reduce((x, y) => x + y, 0), 0)
  console.log(`${e}: omzet ${Math.round(sum('omzet'))} + ohw ${Math.round(sum('ohw'))} − kosten ${Math.round(sum('kosten') + sum('kostenFallback'))} = marge ${Math.round(sum('omzet') + sum('ohw') - sum('kosten') - sum('kostenFallback'))}  | segmenten: ${Object.keys(segs).join(', ')}`)
}
console.log('✓ src/data/marginData.ts geschreven')

// ── 9. Detaildata (drill-down: klant → project → medewerkers / weekoverzicht) ──
// Bronnen bovenop het maandmodel:
//  - urenexport per medewerker per project per maand (+ ISO-week voor E-projecten)
//  - declarabiliteit per medewerker (definitie zoals in Power BI 'Declarabel /
//    Niet Declarabel': klantproject-uren / alle geschreven uren excl. afwezigheid)
//  - OHW Freezes (OHW Trendlijnen - 2026.xlsx): weekproductie per work package
//    ('Delta waarde vorige week', kolom 'Nummer 2026' → project)
//  - Servicebevestigingen (Projectadministratie en Registratie Vergaderingen.xlsm):
//    bevestigde/gefactureerde meters per project per week (2026)
const SRC_DETAIL = {
  freezes: 'C:/Users/lvanderavoird/The People Group/TPG Projects 2025 - Documenten/03 Finance/01 Finance Alex versie/OHW 2026/OHW Trendlijnen - 2026.xlsx',
  projectadmin: 'C:/Users/lvanderavoird/The People Group/TPG Projects - OpEx - Planning/Projectadministratie en Registratie Vergaderingen.xlsm',
}
const isoWeek = ser => {
  const d = new Date(Date.UTC(1899, 11, 30) + ser * 86400000)
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return { jaar: t.getUTCFullYear(), week: Math.ceil(((t - y0) / 86400000 + 1) / 7) }
}
const empProj = {}   // emp → proj → { uren[12], kosten[12], weeks: { w: uren } }
const empDecl = {}   // emp → { naam, bedrijf, klant, intern, afwezig }
{
  const rows = sheetRows(SRC.uren, SRC.urenSheet)
  for (let i = 1; i < rows.length; i++) {
    const x = rows[i]
    if (!x || typeof x[11] !== 'number' || x[2] == null) continue
    const [y, m] = serialToMonth(x[11])
    if (y !== 2026) continue
    const emp = x[2], uren = x[17] ?? 0, cat = x[15]
    const d = (empDecl[emp] ??= { naam: x[3], bedrijf: bedrijfKey(String(x[0] ?? '')), klant: 0, intern: 0, afwezig: 0 })
    const pid = x[7] ? String(x[7]).trim() : null
    if (cat === 'Productieve tijd' && pid) {
      if (INTERN_RE.test(pid) || pid.startsWith('G-')) d.intern += uren; else d.klant += uren
      const ep = ((empProj[emp] ??= {})[pid] ??= { uren: arr12(), kosten: arr12(), weeks: {} })
      const kp = kostprijsVan(emp, x[0])
      ep.uren[m - 1] += uren
      ep.kosten[m - 1] += uren * kp
      if (pid.startsWith('E-')) { const { jaar, week } = isoWeek(x[11]); if (jaar === 2026) ep.weeks[week] = (ep.weeks[week] ?? 0) + uren }
    } else if (cat === 'Improductief' || cat === 'NTCS') d.intern += uren
    else if (cat === 'Verlof' || cat === 'Ziekte' || cat === 'BijzVerlof') d.afwezig += uren
  }
}
// weekproductie per project (OHW Freezes) + per taak
const weekProd = {}   // proj → week → productie
const weekProdTask = {} // proj → week → { taak: productie }
try {
  const fr = sheetRows(SRC_DETAIL.freezes, 'OHW Freezes')
  const h = fr[0]; const c = n => h.indexOf(n)
  const iW = c('Week'), iD = c('Delta waarde vorige week'), iN26 = c('Nummer 2026'), iSap = c('SAP-nummer'), iWp = c('Work Package')
  for (let i = 1; i < fr.length; i++) {
    const x = fr[i]; if (!x) continue
    const w = parseInt(String(x[iW] ?? '')); if (!w || w > 38) continue
    const d = typeof x[iD] === 'number' ? x[iD] : 0; if (!d) continue
    const t = String(x[iN26] ?? '').trim()
    const pid = (/^E-\d+/.test(t) ? t : String(x[iSap] ?? '')).split('-').slice(0, 2).join('-')
    if (!/^E-\d+$/.test(pid)) continue
    ;(weekProd[pid] ??= {})[w] = (weekProd[pid][w] ?? 0) + d
    const tk = `${t || x[iSap]} ${x[iWp] ?? ''}`.trim()
    ;((weekProdTask[pid] ??= {})[w] ??= {})[tk] = (weekProdTask[pid][w][tk] ?? 0) + d
  }
  console.log(`OHW Freezes: weekproductie voor ${Object.keys(weekProd).length} E-projecten`)
} catch (e) { console.warn('OHW Freezes niet gelezen:', e.message) }
// servicebevestigingen 2026 per project per week
const weekBev = {}
try {
  const sb = sheetRows(SRC_DETAIL.projectadmin, 'Servicebevestigingen')
  const h = sb[0]; const c = n => h.indexOf(n)
  const iJ = c('Jaar'), iWk = c('Weeknr'), iFv = c('Factuurvolume €'), iSapK = c('SAP Klantlevel')
  for (let i = 1; i < sb.length; i++) {
    const x = sb[i]; if (!x || String(x[iJ]) !== '2026') continue
    const w = parseInt(String(x[iWk] ?? '')); const v = typeof x[iFv] === 'number' ? x[iFv] : 0
    const pid = String(x[iSapK] ?? '').trim().split('-').slice(0, 2).join('-')
    if (!w || !/^[A-Z]-\d+$/.test(pid)) continue
    ;(weekBev[pid] ??= {})[w] = (weekBev[pid][w] ?? 0) + v
  }
  console.log(`Servicebevestigingen 2026: ${Object.keys(weekBev).length} projecten`)
} catch (e) { console.warn('Servicebevestigingen niet gelezen:', e.message) }

const D = []
D.push(`/**`)
D.push(` * AUTO-GENERATED door scripts/gen-margin-data.mjs — detaildata voor de drill-down in de marge-matrix.`)
D.push(` * Per project: maandreeksen + medewerkers (uren/kosten per maand, declarabiliteit) en voor eenheden-`)
D.push(` * projecten (E-) een weekoverzicht: productie uit OHW Freezes (OHW Trendlijnen - 2026), bevestigde`)
D.push(` * meters uit de Projectadministratie, en de uren/kosten/medewerkers van die week.`)
D.push(` * Declarabiliteit = uren op klantprojecten / alle geschreven uren excl. verlof/ziekte (conform Power BI).`)
D.push(` */`)
D.push(`/** bron van de kostprijs: tarievenbestand | ingevuld (invullijst Lars) | spanje (€35-regel) | geschat (mediaan bedrijf) */`)
D.push(`export type TariefBron = 'tarievenbestand' | 'ingevuld' | 'spanje' | 'geschat'`)
D.push(`export interface DetailEmp { id: number; naam: string; bedrijf: string; uren: number[]; kosten: number[]; geschat: boolean; bron: TariefBron; tarief: number; decl: number | null }`)
D.push(`export interface WeekRow { w: number; productie: number; bevestigd: number; uren: number; kosten: number; emps: [string, number][]; taken?: [string, number][] }`)
D.push(`export interface DetailProject { id: string; naam: string; klant: string; ent: string; seg: string; intern: boolean; omzet: number[]; ohw: number[]; mhOmzet: number[]; mhKosten: number[]; kosten: number[]; uren: number[]; emps: DetailEmp[]; weeks?: WeekRow[]; productieYtd?: number; bevestigdYtd?: number }`)
D.push(`export const detailProjecten: DetailProject[] = [`)
let nWeeks = 0
for (const p of Object.values(proj)) {
  const ohwDelta = arr12()
  for (let m = 1; m <= N_MONTHS; m++) for (const k of ['u', 'd', 'c', 'e']) ohwDelta[m - 1] += (p.snaps[k][m] ?? 0) - (p.snaps[k][m - 1] ?? 0)
  const tot = a => a.slice(0, N_MONTHS).reduce((x, y) => x + y, 0)
  const kostenTot = tot(p.kosten) + tot(p.kostenFallback)
  if (tot(p.omzet) === 0 && tot(ohwDelta) === 0 && kostenTot === 0 && tot(p.mhOmzet) === 0) continue
  const emps = []
  for (const [emp, ep] of Object.entries(empProj)) {
    const e = ep[p.id]; if (!e) continue
    const d = empDecl[emp]
    const worked = d.klant + d.intern
    const totU = e.uren.reduce((x, y) => x + y, 0), totK = e.kosten.reduce((x, y) => x + y, 0)
    emps.push({ id: Number(emp), naam: d.naam, bedrijf: d.bedrijf, uren: rnd(e.uren), kosten: rnd(e.kosten), geschat: !rate[emp], bron: bronVan(emp), tarief: totU ? Math.round(totK / totU * 100) / 100 : 0, decl: worked ? Math.round(d.klant / worked * 100) : null })
  }
  emps.sort((a, b) => b.uren.reduce((x, y) => x + y, 0) - a.uren.reduce((x, y) => x + y, 0))
  const rec = {
    id: p.id, naam: p.naam, klant: p.klant ?? '', ent: p.ent, seg: p.seg, intern: !!p.intern,
    omzet: rnd(p.omzet), ohw: rnd(ohwDelta), mhOmzet: rnd(p.mhOmzet), mhKosten: rnd(p.mhKosten),
    kosten: rnd(p.kosten.map((v, i) => v + p.kostenFallback[i])), uren: rnd(p.uren), emps,
  }
  if (p.id.startsWith('E-') && (weekProd[p.id] || Object.values(empProj).some(ep => ep[p.id] && Object.keys(ep[p.id].weeks).length))) {
    const weeks = []
    for (let w = 1; w <= 38; w++) {
      const prod = weekProd[p.id]?.[w] ?? 0
      const bev = weekBev[p.id]?.[w] ?? 0
      let uren = 0, kosten = 0; const we = []
      for (const [emp, ep] of Object.entries(empProj)) {
        const u = ep[p.id]?.weeks[w]; if (!u) continue
        const kp = rate[emp]?.kostprijsAK ?? medianBy[empDecl[emp]?.bedrijf] ?? 60  // Spanje-medewerkers zitten via de aanvulling in rate
        uren += u; kosten += u * kp; we.push([empDecl[emp].naam, Math.round(u * 10) / 10])
      }
      if (!prod && !bev && !uren) continue
      const row = { w, productie: Math.round(prod), bevestigd: Math.round(bev), uren: Math.round(uren), kosten: Math.round(kosten), emps: we.sort((a, b) => b[1] - a[1]) }
      const taken = weekProdTask[p.id]?.[w]
      if (taken) row.taken = Object.entries(taken).map(([t, v]) => [t, Math.round(v)]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8)
      weeks.push(row)
    }
    rec.weeks = weeks
    rec.productieYtd = Math.round(weeks.reduce((a, r) => a + r.productie, 0))
    rec.bevestigdYtd = Math.round(weeks.reduce((a, r) => a + r.bevestigd, 0))
    nWeeks += weeks.length
  }
  D.push(`  ${JSON.stringify(rec)},`)
}
D.push(`]`)
D.push(``)
D.push(`/** Declarabiliteit per medewerker (2026 t/m aug): klantproject-uren, interne uren, afwezigheid. */`)
D.push(`export const declarabiliteit: Record<string, { naam: string; bedrijf: string; klant: number; intern: number; afwezig: number; pct: number | null }> = {`)
for (const [emp, d] of Object.entries(empDecl)) {
  const worked = d.klant + d.intern
  D.push(`  '${emp}': ${JSON.stringify({ naam: d.naam, bedrijf: d.bedrijf, klant: Math.round(d.klant), intern: Math.round(d.intern), afwezig: Math.round(d.afwezig), pct: worked ? Math.round(d.klant / worked * 100) : null })},`)
}
D.push(`}`)
D.push(``)
fs.writeFileSync(path.join(ROOT, 'src/data/marginDetail.ts'), D.join('\n'))
console.log(`✓ src/data/marginDetail.ts geschreven (${D.length} regels, ${nWeeks} weekregels, ${Object.keys(empDecl).length} medewerkers)`)
