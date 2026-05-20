// Parser voor het "Interne uren"-export (SAP) — gedetailleerde uitsplitsing
// van de niet-declarabele/interne uren per werknemer.
//
// Formaat: CSV, ';'-gescheiden, NL-decimalen ("2,25 u"), kolommen:
//   Project ; Projectnaam ; Bedrijf ; Projectstatus ; Projecttaak ;
//   Taaknaam ; Werknemer ; Datum (dd.mm.yyyy) ; Geregistreerde tijd
//
// De rommelige Taaknamen (vaak met persoonsnaam ervoor) worden genormaliseerd
// naar 7 vaste categorieën.
import type { BvId } from '../data/types'

/** De 7 categorieën waarin interne uren worden ingedeeld. */
export const INTERNAL_HOURS_CATEGORIES: { key: string; label: string }[] = [
  { key: 'leegloop',    label: 'Leegloop / niet-declarabel' },
  { key: 'teamleiding', label: 'Teamleiding & planning' },
  { key: 'opleiding',   label: 'Opleiding & onboarding' },
  { key: 'sales',       label: 'Sales & pré-sales' },
  { key: 'opex',        label: 'OpEx' },
  { key: 'overleg',     label: 'Overleg' },
  { key: 'overig',      label: 'Overig' },
]
export const INTERNAL_CAT_KEYS = INTERNAL_HOURS_CATEGORIES.map(c => c.key)
export const INTERNAL_CAT_LABEL: Record<string, string> =
  Object.fromEntries(INTERNAL_HOURS_CATEGORIES.map(c => [c.key, c.label]))

/** Eén werknemer-aggregaat binnen een (bv, maand). */
export interface InternalHoursEmployee {
  naam: string
  totaal: number     // alle interne uren
  leegloop: number   // alleen de leegloop/niet-declarabel categorie
}

/** Interne uren voor één (bv, maand). */
export interface InternalHoursEntry {
  id: string                          // `${bv}-${month}`
  bv: BvId
  month: string                       // 'Jan-26'
  categories: Record<string, number>  // categorie-key → uren
  employees: InternalHoursEmployee[]   // gesorteerd op leegloop (hoog→laag)
}

export interface InternalHoursParseResult {
  entries: InternalHoursEntry[]
  totalHours: number
  perBv: Record<BvId, number>
  rowCount: number
  parsedCount: number
  skippedCount: number
  months: string[]
}

const MONTH_CODES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Normaliseer een ruwe Taaknaam naar één van de 7 categorie-keys. */
export function categorizeInternalTask(taaknaam: string): string {
  const t = (taaknaam || '').toLowerCase()
  if (t.includes('leegloop') || t.includes('niet declarabel') || t.includes('afboeken')) return 'leegloop'
  if (t.includes('sales')) return 'sales'
  if (t.includes('overleg')) return 'overleg'
  if (t.includes('opleiding') || t.includes('training') || t.includes('inwerken') ||
      t.includes('onboarding') || t.includes('studie')) return 'opleiding'
  if (t.includes('teamleider') || t.includes('planning')) return 'teamleiding'
  if (t.includes('opex')) return 'opex'
  return 'overig'
}

function bvFromBedrijf(s: string): BvId | null {
  const v = (s || '').toLowerCase()
  if (v.includes('software')) return 'Software'
  if (v.includes('projects')) return 'Projects'
  if (v.includes('consultancy')) return 'Consultancy'
  return null
}

/** 'dd.mm.yyyy' → maandcode 'Jan-26'. */
function monthCodeFromDate(datum: string): string | null {
  const parts = (datum || '').split('.')
  if (parts.length < 3) return null
  const mm = parseInt(parts[1], 10)
  const yyyy = parseInt(parts[2], 10)
  if (!(mm >= 1 && mm <= 12) || !isFinite(yyyy)) return null
  return `${MONTH_CODES[mm - 1]}-${String(yyyy).slice(-2)}`
}

function parseHours(s: string): number {
  const v = parseFloat((s || '').replace(/u/gi, '').replace(',', '.').trim())
  return isFinite(v) ? v : 0
}
const round1 = (n: number) => Math.round(n * 10) / 10

/** Herkent of een header-regel van het Interne-uren-formaat is. */
export function isInternalHoursHeader(firstLine: string): boolean {
  const h = (firstLine || '').toLowerCase()
  return h.includes('project') && h.includes('bedrijf') &&
    h.includes('werknemer') && h.includes('geregistreerde tijd')
}

/** Lees + parse een Interne-uren CSV-bestand. */
export async function parseInternalHoursFile(file: File): Promise<InternalHoursParseResult> {
  const text = (await file.text())
  const lines = text.split(/\r\n|\r|\n/).filter(l => l.trim().length > 0)
  if (lines.length < 2) throw new Error('Het bestand bevat geen data-rijen.')
  if (!isInternalHoursHeader(lines[0])) {
    throw new Error('Dit lijkt geen Interne-uren-export (verwacht kolommen Project/Bedrijf/Werknemer/Geregistreerde tijd).')
  }

  type Acc = {
    bv: BvId; month: string
    categories: Record<string, number>
    emp: Map<string, InternalHoursEmployee>
  }
  const acc = new Map<string, Acc>()
  const perBv: Record<BvId, number> = { Consultancy: 0, Projects: 0, Software: 0 }
  let total = 0, parsed = 0, skipped = 0
  const dataRows = lines.slice(1)

  for (const line of dataRows) {
    const r = line.split(';')
    if (r.length < 9) { skipped++; continue }
    const bv = bvFromBedrijf(r[2])
    const month = monthCodeFromDate(r[7])
    const h = parseHours(r[8])
    if (!bv || !month || h <= 0) { skipped++; continue }

    parsed++
    total += h
    perBv[bv] += h
    const cat = categorizeInternalTask(r[5])
    const key = `${bv}-${month}`
    let e = acc.get(key)
    if (!e) { e = { bv, month, categories: {}, emp: new Map() }; acc.set(key, e) }
    e.categories[cat] = (e.categories[cat] ?? 0) + h
    const naam = (r[6] || '').trim() || 'Onbekend'
    let em = e.emp.get(naam)
    if (!em) { em = { naam, totaal: 0, leegloop: 0 }; e.emp.set(naam, em) }
    em.totaal += h
    if (cat === 'leegloop') em.leegloop += h
  }

  const entries: InternalHoursEntry[] = [...acc.values()].map(e => {
    const categories: Record<string, number> = {}
    for (const k of INTERNAL_CAT_KEYS) categories[k] = round1(e.categories[k] ?? 0)
    return {
      id: `${e.bv}-${e.month}`,
      bv: e.bv,
      month: e.month,
      categories,
      employees: [...e.emp.values()]
        .map(v => ({ naam: v.naam, totaal: round1(v.totaal), leegloop: round1(v.leegloop) }))
        .sort((a, b) => b.leegloop - a.leegloop || b.totaal - a.totaal),
    }
  })

  return {
    entries,
    totalHours: round1(total),
    perBv: { Consultancy: round1(perBv.Consultancy), Projects: round1(perBv.Projects), Software: round1(perBv.Software) },
    rowCount: dataRows.length,
    parsedCount: parsed,
    skippedCount: skipped,
    months: [...new Set(entries.map(e => e.month))].sort(),
  }
}
