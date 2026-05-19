#!/usr/bin/env node
// Extract actuals (kolom B) van "<BV> M new" tabbladen uit alle
// Maandafsluitingen/*.xlsx bestanden en regenereer
// src/data/maandafsluitingActuals.ts.
//
// Run: node scripts/extract-maandafsluiting-actuals.mjs
//
// Pakt automatisch de laatste revisie per maand (hoogste filename in
// lexicografische volgorde — werkt voor "(3)" < "(4)" suffixes).

import xlsx from 'xlsx'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIR = path.join(ROOT, 'Maandafsluitingen')
const OUT = path.join(ROOT, 'src/data/maandafsluitingActuals.ts')

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
const LABELS = [
  'Netto-omzet',
  'Netto-omzet extern',
  'Netto-omzet IC',
  'Nog te factureren omzet extern',
  'Vooruitgefactureerde omzet',
]

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.xlsx'))

// Hoogste filename per maand wint (laatste revisie)
const byMonth = new Map()
for (const f of files) {
  const meta = parseMonth(f)
  if (!meta) continue
  const k = `${meta.year}-${meta.month}`
  const prev = byMonth.get(k)
  if (!prev || f > prev) byMonth.set(k, f)
}

const round = v => v == null ? null : Math.round(v * 100) / 100
const out = []

for (const [, f] of [...byMonth.entries()].sort()) {
  const meta = parseMonth(f)
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
      if (!LABELS.includes(lab)) continue
      const bCell = sh[xlsx.utils.encode_cell({ r: R, c: 1 })]
      const v = bCell ? Number(bCell.v) : null
      if (found[lab] === undefined) found[lab] = v
    }
    out.push({
      month: monthKey(meta.year, meta.month),
      bv,
      nettoOmzetTotaal:    round(found['Netto-omzet']                    ?? null),
      nettoOmzetExtern:    round(found['Netto-omzet extern']             ?? null),
      nettoOmzetIc:        round(found['Netto-omzet IC']                 ?? null),
      nogTeFactExtern:     round(found['Nog te factureren omzet extern'] ?? null),
      vooruitgefactureerd: round(found['Vooruitgefactureerde omzet']     ?? null),
      sourceFile: f,
    })
  }
}

const header = `// AUTO-GENERATED door scripts/extract-maandafsluiting-actuals.mjs
// Source: Excel-bestanden in Maandafsluitingen/ (P*.xlsx)
// Iedere record = Actuals (kolom B) van "<BV> M new" tabblad
// Gebruikt voor de OHW Overzicht ↔ Excel maandafsluiting controle in MaandTab.
import type { ClosingBv } from './types'

export interface MaandafsluitingActual {
  month: string
  bv: ClosingBv
  /** Netto-omzet TOTAAL (B-cel "Netto-omzet") — soms corrupt in oudere bestanden (literal "15"), valideer via som van components. */
  nettoOmzetTotaal: number | null
  /** Netto-omzet extern (~ Factuurvolume in app) */
  nettoOmzetExtern: number | null
  /** Netto-omzet IC (~ Totaal IC in OHW) */
  nettoOmzetIc: number | null
  /** Nog te factureren omzet extern (~ Mutatie OHW in OHW Overzicht) */
  nogTeFactExtern: number | null
  /** Vooruitgefactureerde omzet (~ Mutatie Vooruitgefactureerd in OHW, Software only) */
  vooruitgefactureerd: number | null
  /** Bestandsnaam voor herleidbaarheid */
  sourceFile: string
}

export const MAANDAFSLUITING_ACTUALS: MaandafsluitingActual[] = [
`

const body = out.map(r => `  {
    month: ${JSON.stringify(r.month)},
    bv: ${JSON.stringify(r.bv)},
    nettoOmzetTotaal: ${JSON.stringify(r.nettoOmzetTotaal)},
    nettoOmzetExtern: ${JSON.stringify(r.nettoOmzetExtern)},
    nettoOmzetIc: ${JSON.stringify(r.nettoOmzetIc)},
    nogTeFactExtern: ${JSON.stringify(r.nogTeFactExtern)},
    vooruitgefactureerd: ${JSON.stringify(r.vooruitgefactureerd)},
    sourceFile: ${JSON.stringify(r.sourceFile)},
  },`).join('\n')

const footer = `
]

/** Lookup helper: vind 1 actual record voor (maand, BV) of undefined. */
export function findMaandafsluitingActual(month: string, bv: ClosingBv): MaandafsluitingActual | undefined {
  return MAANDAFSLUITING_ACTUALS.find(a => a.month === month && a.bv === bv)
}
`

fs.writeFileSync(OUT, header + body + footer)
console.log(`Wrote ${out.length} records to ${path.relative(ROOT, OUT)}`)
