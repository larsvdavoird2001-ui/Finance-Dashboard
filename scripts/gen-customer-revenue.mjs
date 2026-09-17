#!/usr/bin/env node
// Genereert src/data/customerRevenue.ts (data voor het tabblad "Omzet per markt")
// uit de SAP factuurvolume-uitdraai (CRMCIVIB_Q0001) van het sales dashboard.
//
//   node scripts/gen-customer-revenue.mjs [pad-naar-factuurvolume.csv]
//
// Regels:
//  - Entiteit = "Verantwoordelijke eenheid (Project)"; ontbreekt die, dan het
//    factuurnummer-prefix (KF01=Projects, KF07=Software, KF15=Consultancy, ...).
//  - KFT-reeks (holding/lease-administratie, o.a. Vision Car Lease), interne
//    TPG-facturen en TPG Spanje worden uitgesloten (geen klantomzet).
//  - Marktsegment = Bedrijfstak-kolom; is die leeg / "Niet toegewezen" /
//    "6. Overig", dan geldt de handmatige toewijzing uit
//    scripts/klant-toewijzing.json (ingevuld door Lars, 17-09-2026).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CSV = process.argv[2] ?? 'C:/Users/lvanderavoird/OneDrive - The People Group/Documenten/Claude Projects/Dashboard Sales/automation/tmp/factuurvolume.csv'

const TOEWIJZING = JSON.parse(fs.readFileSync(path.join(__dirname, 'klant-toewijzing.json'), 'utf8')).toewijzingen
const ZONDER_SEGMENT = new Set(['', 'Niet toegewezen', '6. Overig'])

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
const PREFIX_ENT = {
  '15': 'Consultancy', '09': 'Consultancy', '06': 'Consultancy', '05': 'Consultancy',
  '01': 'Projects', '08': 'Projects', '18': 'Projects',
  '07': 'Software', '12': 'Software', '17': 'Software',
}
function entFromFactuur(factuur) {
  const m = factuur.match(/^[A-Z]{2,3}(T\d|\d{2})-/)
  const code = m?.[1]
  if (!code) {
    // TM-reeks (Mechatronics-administratie) → Consultancy
    if (/^TM(CC)?-/.test(factuur)) return 'Consultancy'
    return null
  }
  if (code.startsWith('T')) return 'T-ADMIN'
  return PREFIX_ENT[code] ?? null
}
function parseAmount(str) {
  if (!str) return 0
  let s = str.replace(/EUR/gi, '').trim()
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/\./g, '')
  return parseFloat(s) || 0
}
const isIntern = k => k.toLowerCase().includes('the people group')

// ── CSV inlezen ─────────────────────────────────────────────────────────────
const lines = fs.readFileSync(CSV, 'utf8').replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n')
let headerIdx = -1
for (let i = 0; i < 25; i++) {
  const parts = (lines[i] ?? '').split(';').map(h => h.trim())
  if (['Klant', 'Bedrijfstak', 'Factuur', 'Factuurdatum', 'Gefactureerde nettowaarde'].every(r => parts.includes(r))) { headerIdx = i; break }
}
if (headerIdx < 0) throw new Error('kolom-header niet gevonden in ' + CSV)
const headers = lines[headerIdx].split(';').map(h => h.trim())
const col = n => headers.indexOf(n)
const iKlant = col('Klant'), iBtk = col('Bedrijfstak'), iEenheid = col('Verantwoordelijke eenheid (Project)'),
  iDatum = col('Factuurdatum'), iWaarde = col('Gefactureerde nettowaarde'), iFactuur = col('Factuur')

// ── Aggregeren ──────────────────────────────────────────────────────────────
let internBedrag = 0, spanjeBedrag = 0, tAdminBedrag = 0, onbekend = 0
const agg = {}       // [jaar][ent][segment] = number[12]
const klantAgg = {}  // klant → { entiteit, segment, jaren: {jaar: number[12]} }
let laatsteDatum = ''
for (let i = headerIdx + 1; i < lines.length; i++) {
  const c = lines[i].split(';')
  if (c.length < 6) continue
  const rawDatum = c[iDatum]?.trim() ?? ''
  const klant = c[iKlant]?.trim() ?? ''
  if (!rawDatum || !klant) continue
  const dp = rawDatum.split('.')
  if (dp.length !== 3) continue
  if (isIntern(klant)) { internBedrag += parseAmount(c[iWaarde]?.trim()); continue }
  const eenheid = c[iEenheid]?.trim() ?? ''
  const bedrag = parseAmount(c[iWaarde]?.trim())
  if (eenheid.toLowerCase().includes('spanje')) { spanjeBedrag += bedrag; continue }
  let ent = EENHEID_ENT[eenheid.toLowerCase()] ?? null
  if (!ent) {
    const pe = entFromFactuur(c[iFactuur]?.trim() ?? '')
    if (pe === 'T-ADMIN') { tAdminBedrag += bedrag; continue }
    ent = pe
  }
  if (!ent) { onbekend += bedrag; continue }
  let btk = (c[iBtk]?.trim() ?? '').trim()
  if (ZONDER_SEGMENT.has(btk)) {
    const tw = TOEWIJZING[klant.trim().toLowerCase()]
    if (tw) btk = tw.segment
    else if (!btk) btk = 'Niet toegewezen'
  }
  const [jaar, mnd] = [dp[2], dp[1]]
  const iso = `${dp[2]}-${dp[1].padStart(2, '0')}-${dp[0].padStart(2, '0')}`
  if (iso > laatsteDatum) laatsteDatum = iso
  const mi = parseInt(mnd) - 1
  agg[jaar] ??= {}
  agg[jaar][ent] ??= {}
  agg[jaar][ent][btk] ??= new Array(12).fill(0)
  agg[jaar][ent][btk][mi] += bedrag
  const kk = klant.trim()
  klantAgg[kk] ??= { entiteit: ent, segment: btk, jaren: {} }
  klantAgg[kk].jaren[jaar] ??= new Array(12).fill(0)
  klantAgg[kk].jaren[jaar][mi] += bedrag
}
for (const j of Object.keys(agg)) for (const e of Object.keys(agg[j])) for (const b of Object.keys(agg[j][e]))
  agg[j][e][b] = agg[j][e][b].map(v => Math.round(v))
for (const k of Object.keys(klantAgg)) for (const j of Object.keys(klantAgg[k].jaren))
  klantAgg[k].jaren[j] = klantAgg[k].jaren[j].map(v => Math.round(v))

if (onbekend !== 0) console.warn(`!! niet-koppelbare omzet: € ${Math.round(onbekend)} — check nieuwe factuurnummer-reeksen`)

// ── customerRevenue.ts schrijven ────────────────────────────────────────────
const SEG_ORDER_ALL = ['1. Public', '2. Telecom', '3. Energy', '4. Civil', '5. Industry', '6. Overig', 'Niet toegewezen']
const MENT = ['Consultancy', 'Projects', 'Software']
// Segmenten die overal per saldo nul zijn (bv. alleen een gecrediteerde
// factuur) verdwijnen uit de matrix.
const SEG_ORDER = SEG_ORDER_ALL.filter(s =>
  Object.values(agg).some(byEnt => Object.values(byEnt).some(bySeg =>
    (bySeg[s] ?? []).reduce((a, b) => a + b, 0) !== 0)))
const YEARS = ['2024', '2025', '2026']
const vandaag = new Date().toISOString().slice(0, 10)
const laatsteMaand = laatsteDatum ? parseInt(laatsteDatum.slice(5, 7)) : 12
const cellArr = (jaar, ent, seg) => (agg[jaar]?.[ent]?.[seg] ?? new Array(12).fill(0))

const co = []
co.push(`/**`)
co.push(` * AUTO-GENERATED door scripts/gen-customer-revenue.mjs — niet met de hand bewerken.`)
co.push(` * Omzet (gefactureerde nettowaarde) per entiteit × marktsegment × maand.`)
co.push(` * Bron: SAP-factuurvolume-uitdraai (CRMCIVIB_Q0001), laatste factuurdatum ${laatsteDatum}.`)
co.push(` * Entiteit via projecteenheid, anders factuurnummer-prefix; marktsegment via Bedrijfstak,`)
co.push(` * aangevuld met de handmatige toewijzing in scripts/klant-toewijzing.json.`)
co.push(` * Uitgesloten: interne TPG-facturen, TPG Spanje en de KFT-reeks (holding/lease).`)
co.push(` */`)
co.push(`export const MARKT_ENTITIES = ['Consultancy', 'Projects', 'Software'] as const`)
co.push(`export const MARKT_SEGMENTS = ${JSON.stringify(SEG_ORDER)} as const`)
co.push(`export type MarktEntity = typeof MARKT_ENTITIES[number]`)
co.push(`export type MarktSegment = typeof MARKT_SEGMENTS[number]`)
co.push(``)
co.push(`/** [jaar][entiteit][segment] = 12 maandbedragen (index 0 = januari). */`)
co.push(`export const marktOmzet: Record<'2024' | '2025' | '2026', Record<MarktEntity, Record<MarktSegment, number[]>>> = {`)
for (const j of YEARS) {
  co.push(`  '${j}': {`)
  for (const e of MENT) {
    co.push(`    ${e}: {`)
    for (const s of SEG_ORDER) co.push(`      '${s}': ${JSON.stringify(cellArr(j, e, s))},`)
    co.push(`    },`)
  }
  co.push(`  },`)
}
co.push(`}`)
co.push(``)
co.push(`/** Top-klanten per (entiteit × segment), o.b.v. omzet 2026. */`)
co.push(`export const marktTopKlanten: Record<string, { klant: string; omzet2026: number; omzet2025: number }[]> = {`)
for (const e of MENT) {
  for (const s of SEG_ORDER) {
    const kl = Object.entries(klantAgg)
      .filter(([, v]) => v.entiteit === e && v.segment === s)
      .map(([k, v]) => ({
        klant: k,
        omzet2026: (v.jaren['2026'] ?? []).reduce((a, b) => a + b, 0),
        omzet2025: (v.jaren['2025'] ?? []).reduce((a, b) => a + b, 0),
      }))
      .filter(x => x.omzet2026 !== 0 || x.omzet2025 !== 0)
      .sort((a, b) => Math.abs(b.omzet2026) - Math.abs(a.omzet2026))
      .slice(0, 6)
    if (kl.length === 0) continue
    const items = kl.map(x => `{ klant: ${JSON.stringify(x.klant)}, omzet2026: ${x.omzet2026}, omzet2025: ${x.omzet2025} }`).join(', ')
    co.push(`  '${e}|${s}': [${items}],`)
  }
}
co.push(`}`)
co.push(``)
co.push(`export const MARKT_META = {`)
co.push(`  bron: 'SAP factuurvolume-uitdraai (CRMCIVIB_Q0001)',`)
co.push(`  peildatum: '${vandaag}',`)
co.push(`  laatsteVolledigeMaand: ${Math.max(1, laatsteMaand - 1)}, // laatste factuurmaand minus de lopende (index 1-12)`)
co.push(`  septemberLopend: true,`)
co.push(`  internUitgesloten: ${Math.round(internBedrag)}, // saldo interne TPG-facturen (uitgesloten)`)
co.push(`  tAdminUitgesloten: ${Math.round(tAdminBedrag)}, // KFT-reeks: holding/lease-administratie (uitgesloten)`)
co.push(`}`)
co.push(``)
fs.writeFileSync(path.join(ROOT, 'src/data/customerRevenue.ts'), co.join('\n'))
console.log(`✓ src/data/customerRevenue.ts (laatste factuurdatum ${laatsteDatum}; segmenten: ${SEG_ORDER.join(', ')})`)
console.log(`  uitgesloten: intern € ${Math.round(internBedrag)}, Spanje € ${Math.round(spanjeBedrag)}, T-administratie € ${Math.round(tAdminBedrag)}`)
