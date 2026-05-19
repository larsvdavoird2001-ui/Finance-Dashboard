#!/usr/bin/env node
// Extract ALLE P&L-regels uit "M new" tabbladen van elke maandafsluiting-Excel
// en regenereer:
//   - src/data/maandafsluitingActuals.ts (omzet-componenten — backwards compat)
//   - src/data/maandafsluitingPL.ts     (volledige P&L per (BV, maand))
//   - src/data/ohwTotaal2025.ts         (Totaal Onderhanden per BV per maand uit OHW Excel)
//
// Pakt automatisch de laatste revisie per maand voor de maandafsluitingen.
// Run: node scripts/extract-maandafsluiting-full.mjs

import xlsx from 'xlsx'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIR = path.join(ROOT, 'Maandafsluitingen')

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function parseMonth(name) {
  let m = name.match(/P(\d+)\.(\d{4})/i)
  if (m) return { month: parseInt(m[1]), year: parseInt(m[2]) }
  m = name.match(/(\d{4})\s+p(\d+)/i)
  if (m) return { month: parseInt(m[2]), year: parseInt(m[1]) }
  return null
}
function monthKey(year, month) {
  return `${MONTH_LABELS[month - 1]}-${String(year).slice(-2)}`
}

const TABS = {
  'Consultancy M new': 'Consultancy',
  'Projects M new':    'Projects',
  'Software M new':    'Software',
  'Holding M new':     'Holdings',
}

// Mapping van Excel-label (in kolom A) → plData-key. Eerste voorkomen wint:
// we kiezen de hoofd-regels van de P&L, NIET de sub-detail-uitsplitsingen
// (die hebben dezelfde label-naam maar staan eronder). Daarom een lijst van
// "section-niveau" labels in de volgorde waarin ze in Excel staan.
const LABEL_TO_KEY = {
  'Netto-omzet':                       'netto_omzet',
  'Gefactureerde omzet':               'gefactureerde_omzet',
  'Netto-omzet extern':                'netto_omzet_extern',
  'Netto-omzet IC':                    'netto_omzet_ic',
  'Omzet periode allocatie':           'omzet_periode_allocatie',
  'Nog te factureren omzet extern':    'nog_te_fact_extern',
  'Vooruitgefactureerde omzet':        'vooruitgefactureerd',
  'Directe kosten':                    'directe_kosten',
  'Directe inkoopkosten':              'directe_inkoopkosten',
  'Directe personeelskosten':          'directe_personeelskosten',
  'Directe overige personeelskosten':  'directe_overige_personeelskosten',
  'Directe autokosten':                'directe_autokosten',
  'Brutomarge':                        'brutomarge',
  'Operationele kosten':               'operationele_kosten',
  'Indirecte personeelskosten':        'indirecte_personeelskosten',
  'Huisvestingskosten':                'huisvestingskosten',
  'Automatiseringskosten':             'automatiseringskosten',
  'Indirecte autokosten':              'indirecte_autokosten',
  'Verkoopkosten':                     'verkoopkosten',
  'Algemene kosten':                   'algemene_kosten',
  'Doorbelaste kosten':                'doorbelaste_kosten',
  'EBITDA':                            'ebitda',
  'Amortisatie en afschrijvingen':     'amortisatie_afschrijvingen',
  'Amortisatie goodwill':              'amortisatie_goodwill',
  'Amortisatie software':              'amortisatie_software',
  'Afschrijvingen':                    'afschrijvingen',
  'EBIT':                              'ebit',
  'Financieel resultaat':              'financieel_resultaat',
  'Vennootschapsbelasting':            'vennootschapsbelasting',
  'Netto resultaat':                   'netto_resultaat',
}

// Pak laatste revisie per maand
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.xlsx'))
const byMonth = new Map()
for (const f of files) {
  const meta = parseMonth(f)
  if (!meta) continue
  const k = `${meta.year}-${meta.month}`
  const prev = byMonth.get(k)
  if (!prev || f > prev) byMonth.set(k, f)
}

const round = v => v == null ? null : Math.round(v)
const round2 = v => v == null ? null : Math.round(v * 100) / 100

// ── Stap 1: Maandafsluiting P&L per (BV, maand) ────────────────────────────
const plData = []
const omzetData = []
for (const [, f] of [...byMonth.entries()].sort()) {
  const meta = parseMonth(f)
  const month = monthKey(meta.year, meta.month)
  const wb = xlsx.readFile(path.join(DIR, f))
  for (const [tab, bv] of Object.entries(TABS)) {
    const sh = wb.Sheets[tab]
    if (!sh) continue
    const range = xlsx.utils.decode_range(sh['!ref'])
    const found = {}
    for (let R = range.s.r; R <= range.e.r; R++) {
      const aCell = sh[xlsx.utils.encode_cell({ r: R, c: 0 })]
      if (!aCell) continue
      const lab = String(aCell.v).trim()
      const key = LABEL_TO_KEY[lab]
      if (!key) continue
      // Eerste voorkomen wint (hoofd-regel, niet sub-detail)
      if (found[key] !== undefined) continue
      const bCell = sh[xlsx.utils.encode_cell({ r: R, c: 1 })]
      const v = bCell ? Number(bCell.v) : null
      found[key] = v
    }
    plData.push({ month, bv, ...found, sourceFile: f })
    omzetData.push({
      month, bv,
      nettoOmzetTotaal:    round2(found.netto_omzet ?? null),
      nettoOmzetExtern:    round2(found.netto_omzet_extern ?? null),
      nettoOmzetIc:        round2(found.netto_omzet_ic ?? null),
      nogTeFactExtern:     round2(found.nog_te_fact_extern ?? null),
      vooruitgefactureerd: round2(found.vooruitgefactureerd ?? null),
      sourceFile: f,
    })
  }
}

// ── Stap 2: OHW Totaal per (BV, maand) uit OHW-Excel ───────────────────────
// "P12.2025 - Onderhanden werk 2025 (3).xlsx" sheet "OHW mbM" rows 2-5
// bevatten Consultancy/Projects/Software/Totaal per maand. Header row 1
// heeft Excel-date-serials (45627 = Dec-24, 45658 = Jan-25, etc.).
const OHW_FILE = 'P12.2025 - Onderhanden werk 2025 (3).xlsx'
const ohwTotaal2025 = { Consultancy: {}, Projects: {}, Software: {} }
try {
  const ohwPath = path.join(ROOT, OHW_FILE)
  if (fs.existsSync(ohwPath)) {
    const wb = xlsx.readFile(ohwPath)
    const sh = wb.Sheets['OHW mbM']
    // Excel-date-serial → "MMM-YY"
    const serialToMonth = serial => {
      const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000)
      return `${MONTH_LABELS[date.getUTCMonth()]}-${String(date.getUTCFullYear()).slice(-2)}`
    }
    // Headers in row 1 (cols B-N)
    const range = xlsx.utils.decode_range(sh['!ref'])
    const monthByCol = {}
    for (let C = 1; C <= range.e.c; C++) {
      const cell = sh[xlsx.utils.encode_cell({ r: 0, c: C })]
      if (cell && typeof cell.v === 'number' && cell.v > 40000 && cell.v < 50000) {
        monthByCol[C] = serialToMonth(cell.v)
      }
    }
    // Rows 2-4 = Consultancy / Projects / Software
    const ROW_BV = { 1: 'Consultancy', 2: 'Projects', 3: 'Software' }
    for (const [rIdx, bv] of Object.entries(ROW_BV)) {
      const R = parseInt(rIdx)
      for (const [cIdx, mLabel] of Object.entries(monthByCol)) {
        const cell = sh[xlsx.utils.encode_cell({ r: R, c: parseInt(cIdx) })]
        if (cell && typeof cell.v === 'number') {
          ohwTotaal2025[bv][mLabel] = round(cell.v)
        }
      }
    }
  } else {
    console.warn(`⚠ OHW-bestand niet gevonden: ${OHW_FILE}`)
  }
} catch (e) {
  console.error('OHW extractie faalde:', e)
}

// ── Stap 3: schrijf bestanden ──────────────────────────────────────────────

// maandafsluitingActuals.ts (backwards-compat met bestaande controle-panel)
const actualsHeader = `// AUTO-GENERATED door scripts/extract-maandafsluiting-full.mjs
// Source: Excel-bestanden in Maandafsluitingen/ (P*.xlsx)
// Per (maand, BV): kolom B (Actuals) van "<BV> M new" tabblad — omzet-componenten.
import type { ClosingBv } from './types'

export interface MaandafsluitingActual {
  month: string
  bv: ClosingBv
  nettoOmzetTotaal: number | null
  nettoOmzetExtern: number | null
  nettoOmzetIc: number | null
  nogTeFactExtern: number | null
  vooruitgefactureerd: number | null
  sourceFile: string
}

export const MAANDAFSLUITING_ACTUALS: MaandafsluitingActual[] = [
`
const actualsBody = omzetData.map(r => `  {
    month: ${JSON.stringify(r.month)},
    bv: ${JSON.stringify(r.bv)},
    nettoOmzetTotaal: ${JSON.stringify(r.nettoOmzetTotaal)},
    nettoOmzetExtern: ${JSON.stringify(r.nettoOmzetExtern)},
    nettoOmzetIc: ${JSON.stringify(r.nettoOmzetIc)},
    nogTeFactExtern: ${JSON.stringify(r.nogTeFactExtern)},
    vooruitgefactureerd: ${JSON.stringify(r.vooruitgefactureerd)},
    sourceFile: ${JSON.stringify(r.sourceFile)},
  },`).join('\n')
const actualsFooter = `
]

export function findMaandafsluitingActual(month: string, bv: ClosingBv): MaandafsluitingActual | undefined {
  return MAANDAFSLUITING_ACTUALS.find(a => a.month === month && a.bv === bv)
}
`
fs.writeFileSync(
  path.join(ROOT, 'src/data/maandafsluitingActuals.ts'),
  actualsHeader + actualsBody + actualsFooter,
)

// maandafsluitingPL.ts — volledige P&L per (BV, maand)
const plHeader = `// AUTO-GENERATED door scripts/extract-maandafsluiting-full.mjs
// Per (BV, maand): alle P&L-regels uit kolom B (Actuals) van "<BV> M new".
// Vervangt de seasonal-weighted schatting in plData2025.ts voor de actuals-view.
import type { ClosingBv } from './types'

export interface MaandafsluitingPL {
  month: string
  bv: ClosingBv
  // Omzet
  netto_omzet: number | null
  gefactureerde_omzet: number | null
  netto_omzet_extern: number | null
  netto_omzet_ic: number | null
  omzet_periode_allocatie: number | null
  nog_te_fact_extern: number | null
  vooruitgefactureerd: number | null
  // Directe kosten
  directe_kosten: number | null
  directe_inkoopkosten: number | null
  directe_personeelskosten: number | null
  directe_overige_personeelskosten: number | null
  directe_autokosten: number | null
  // Brutomarge
  brutomarge: number | null
  // Operationele kosten
  operationele_kosten: number | null
  indirecte_personeelskosten: number | null
  huisvestingskosten: number | null
  automatiseringskosten: number | null
  indirecte_autokosten: number | null
  verkoopkosten: number | null
  algemene_kosten: number | null
  doorbelaste_kosten: number | null
  // EBITDA & onder
  ebitda: number | null
  amortisatie_afschrijvingen: number | null
  amortisatie_goodwill: number | null
  amortisatie_software: number | null
  afschrijvingen: number | null
  ebit: number | null
  financieel_resultaat: number | null
  vennootschapsbelasting: number | null
  netto_resultaat: number | null
  sourceFile: string
}

export const MAANDAFSLUITING_PL: MaandafsluitingPL[] = [
`
const plBody = plData.map(r => {
  const fields = [
    'netto_omzet', 'gefactureerde_omzet', 'netto_omzet_extern', 'netto_omzet_ic',
    'omzet_periode_allocatie', 'nog_te_fact_extern', 'vooruitgefactureerd',
    'directe_kosten', 'directe_inkoopkosten', 'directe_personeelskosten',
    'directe_overige_personeelskosten', 'directe_autokosten',
    'brutomarge',
    'operationele_kosten', 'indirecte_personeelskosten', 'huisvestingskosten',
    'automatiseringskosten', 'indirecte_autokosten', 'verkoopkosten',
    'algemene_kosten', 'doorbelaste_kosten',
    'ebitda', 'amortisatie_afschrijvingen', 'amortisatie_goodwill',
    'amortisatie_software', 'afschrijvingen', 'ebit',
    'financieel_resultaat', 'vennootschapsbelasting', 'netto_resultaat',
  ]
  const lines = fields.map(k => `    ${k}: ${JSON.stringify(round(r[k] ?? null))},`)
  return `  {
    month: ${JSON.stringify(r.month)},
    bv: ${JSON.stringify(r.bv)},
${lines.join('\n')}
    sourceFile: ${JSON.stringify(r.sourceFile)},
  },`
}).join('\n')

const plFooter = `
]

export function findMaandafsluitingPL(month: string, bv: ClosingBv): MaandafsluitingPL | undefined {
  return MAANDAFSLUITING_PL.find(a => a.month === month && a.bv === bv)
}

/** Map naar het format dat monthlyActuals2025/2026 verwacht
 *  (Record<key, number>). NULL waardes → 0. */
export function plToMonthlyActuals(p: MaandafsluitingPL): Record<string, number> {
  return {
    netto_omzet: p.netto_omzet ?? 0,
    gefactureerde_omzet: p.gefactureerde_omzet ?? 0,
    omzet_periode_allocatie: p.omzet_periode_allocatie ?? 0,
    directe_kosten: p.directe_kosten ?? 0,
    directe_inkoopkosten: p.directe_inkoopkosten ?? 0,
    directe_personeelskosten: p.directe_personeelskosten ?? 0,
    directe_overige_personeelskosten: p.directe_overige_personeelskosten ?? 0,
    directe_autokosten: p.directe_autokosten ?? 0,
    brutomarge: p.brutomarge ?? 0,
    operationele_kosten: p.operationele_kosten ?? 0,
    indirecte_personeelskosten: p.indirecte_personeelskosten ?? 0,
    overige_personeelskosten: 0,
    huisvestingskosten: p.huisvestingskosten ?? 0,
    automatiseringskosten: p.automatiseringskosten ?? 0,
    indirecte_autokosten: p.indirecte_autokosten ?? 0,
    verkoopkosten: p.verkoopkosten ?? 0,
    algemene_kosten: p.algemene_kosten ?? 0,
    doorbelaste_kosten: p.doorbelaste_kosten ?? 0,
    ebitda: p.ebitda ?? 0,
    amortisatie_afschrijvingen: p.amortisatie_afschrijvingen ?? 0,
    amortisatie_goodwill: p.amortisatie_goodwill ?? 0,
    amortisatie_software: p.amortisatie_software ?? 0,
    afschrijvingen: p.afschrijvingen ?? 0,
    ebit: p.ebit ?? 0,
    financieel_resultaat: p.financieel_resultaat ?? 0,
    vennootschapsbelasting: p.vennootschapsbelasting ?? 0,
    netto_resultaat: p.netto_resultaat ?? 0,
  }
}
`

fs.writeFileSync(
  path.join(ROOT, 'src/data/maandafsluitingPL.ts'),
  plHeader + plBody + plFooter,
)

// ohwTotaal2025.ts — Totaal Onderhanden per BV per maand uit OHW-Excel
const ohwHeader = `// AUTO-GENERATED door scripts/extract-maandafsluiting-full.mjs
// Source: ${OHW_FILE} (tab "OHW mbM", rijen 2-4)
// Totaal Onderhanden per BV per maand voor 2025. Gebruikt om de OHW-balken
// in het dashboard te vullen voor 2025 (zonder per-debiteur breakdown).

export const OHW_TOTAAL_2025: Record<string, Record<string, number>> = ${JSON.stringify(ohwTotaal2025, null, 2)}

/** Helper: totaal over alle 3 productie-BVs voor een gegeven maand. */
export function totaalOhw2025(month: string): number {
  let sum = 0
  for (const bv of ['Consultancy', 'Projects', 'Software']) {
    sum += OHW_TOTAAL_2025[bv]?.[month] ?? 0
  }
  return sum
}
`
fs.writeFileSync(path.join(ROOT, 'src/data/ohwTotaal2025.ts'), ohwHeader)

console.log(`✓ Geschreven:`)
console.log(`  - src/data/maandafsluitingActuals.ts  (${omzetData.length} records)`)
console.log(`  - src/data/maandafsluitingPL.ts       (${plData.length} records)`)
console.log(`  - src/data/ohwTotaal2025.ts           (${Object.values(ohwTotaal2025).reduce((s, o) => s + Object.keys(o).length, 0)} BV×maand cellen)`)
