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
const rate = {}
{
  const rows = sheetRows(SRC.tarieven, 'HC Tarieven 20260507')
  for (const r of rows) {
    if (typeof r?.[1] === 'number' && typeof r[5] === 'number') rate[r[1]] = { bedrijf: r[0], naam: r[2], kostprijsAK: r[5] }
  }
}
const medianBy = {}
for (const b of ['Consultancy', 'Projects', 'Software']) {
  const v = Object.values(rate).filter(x => x.bedrijf === b).map(x => x.kostprijsAK).sort((a, c) => a - c)
  medianBy[b] = v[Math.floor(v.length / 2)]
}
const bedrijfKey = b => /Software/i.test(b) ? 'Software' : /Consultancy/i.test(b) ? 'Consultancy' : 'Projects'
console.log(`tarieven: ${Object.keys(rate).length} medewerkers; mediaan kostprijs+AK`, medianBy)

// ── 2. Uren × kostprijs per project per maand ───────────────────────────────
const proj = {} // id → { naam, uren[12], kosten[12], kostenFallback[12], empEnt:{}, omzet[12], ohw:{u,d,c,e}[snapshots], klant, btk, segFromList, ent }
const P = id => (proj[id] ??= { id, naam: '', uren: arr12(), kosten: arr12(), kostenFallback: arr12(), empEnt: {}, omzet: arr12(), omzet2025: arr12(), snaps: { u: [], d: [], c: [], e: [] }, klant: null, klanten: {}, btks: {}, segList: {}, ents: {}, feron: false })
const missingRate = {}
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
    const rt = rate[x[2]]
    if (rt) p.kosten[m - 1] += uren * rt.kostprijsAK
    else {
      const fb = /Spanje/i.test(String(x[0])) ? medianBy.Projects : medianBy[eb]
      p.kostenFallback[m - 1] += uren * fb
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
const C = (e, s) => ((cell[e] ??= {})[s] ??= { omzet: arr12(), ohw: arr12(), kosten: arr12(), kostenFallback: arr12(), uren: arr12() })
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
  }
  const omzet = tot(p.omzet), ohw = tot(ohwDelta), kosten = tot(p.kosten) + tot(p.kostenFallback), uren = tot(p.uren)
  if (omzet !== 0 || ohw !== 0 || kosten !== 0) {
    projectRows.push({ ent: p.ent, seg: p.seg, id: p.id, naam: p.naam, klant: p.klant ?? '', omzet: Math.round(omzet), ohw: Math.round(ohw), kosten: Math.round(kosten), uren: Math.round(uren), marge: Math.round(omzet + ohw - kosten), geenUren: uren === 0 && (omzet + ohw) !== 0 })
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
L.push(` *   kosten  = productieve uren × kostprijs+AK (tarievenbestand P4 2026); kostenFallback = uren van`)
L.push(` *             medewerkers zónder tarief × mediaan van hun bedrijf (zie MARGE_META.zonderTarief)`)
L.push(` * Kosten volgen het project (IC-uren tellen mee bij het project), directe inkoop/auto/overige`)
L.push(` * personeelskosten zitten er NIET in — zie de aansluiting met de P&L in het tabblad.`)
L.push(` */`)
L.push(`export interface MargeCel { omzet: number[]; ohw: number[]; kosten: number[]; kostenFallback: number[]; uren: number[] }`)
L.push(`export const MARGE_MAANDEN = ${N_MONTHS}  // aantal gevulde maanden (jan..)`)
L.push(`export const marge2026: Record<string, Record<string, MargeCel>> = {`)
for (const e of ENTS) {
  L.push(`  ${e}: {`)
  for (const s of [...SEGS, 'Niet toegewezen']) {
    const c = cell[e]?.[s]; if (!c) continue
    L.push(`    '${s}': { omzet: ${JSON.stringify(rnd(c.omzet))}, ohw: ${JSON.stringify(rnd(c.ohw))}, kosten: ${JSON.stringify(rnd(c.kosten))}, kostenFallback: ${JSON.stringify(rnd(c.kostenFallback))}, uren: ${JSON.stringify(rnd(c.uren))} },`)
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
L.push(`export interface MargeProject { ent: string; seg: string; id: string; naam: string; klant: string; omzet: number; ohw: number; kosten: number; uren: number; marge: number; geenUren: boolean }`)
L.push(`/** Per project (YTD t/m aug), gesorteerd op |marge| — voor het detailpaneel. */`)
L.push(`export const margeProjecten2026: MargeProject[] = [`)
for (const r of projectRows.sort((a, b) => Math.abs(b.marge) - Math.abs(a.marge))) L.push(`  ${JSON.stringify(r)},`)
L.push(`]`)
L.push(``)
L.push(`export const MARGE_META = {`)
L.push(`  peildatum: '${new Date().toISOString().slice(0, 10)}',`)
L.push(`  tarievenBron: 'TPG TARIEVEN P4 2026 EN VERDER (07-05-2026), kolom F kostprijs+AK',`)
L.push(`  urenBron: 'SAP urenexport WN Tijden P1-8 (10-09-2026), alleen Productieve tijd',`)
L.push(`  urenTotaal: ${Math.round(totUren)},`)
L.push(`  urenZonderTarief: ${missingUren},`)
L.push(`  medianKostprijs: ${JSON.stringify(medianBy)},`)
L.push(`  eenhedenSnapshotsOntbreken: ['Mar-26', 'Jul-26'], // lineair geïnterpoleerd per project`)
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
