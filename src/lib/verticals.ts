// verticals.ts — helpers rond de vertical-indeling binnen de productie-BVs.
//
// De vertical is een sub-bucket binnen een BV waarin een persoon (en daarmee
// FTE / headcount) is ingedeeld. Bron: kolom O van "Specificatie op persoons-
// niveau" — Telecom / Public / Energy / Civiel / Industry / "–" (geen). De
// "–"-categorie wordt in de UI gerenderd als "Overig" zodat hij visueel
// duidelijk is en niet samenvalt met een ontbrekende waarde.
//
// Holdings heeft géén vertical-breakdown — daar wordt FTE/headcount alleen
// op BV-totaal-niveau geregistreerd.

import type { FteBv, PersonSpec } from '../data/types'
import { personSpec, PERSON_SPEC_MONTH } from '../data/personSpec'

/** Volgorde waarin verticals in de UI worden gerenderd. */
export const VERTICALS = ['Telecom', 'Public', 'Energy', 'Civiel', 'Industry', 'Overig'] as const
export type Vertical = typeof VERTICALS[number]

/** Visuele kleuren per vertical — gebruikt voor labels en lichte
 *  rij-achtergronden in de FTE & Headcount tabellen. */
export const VERTICAL_COLORS: Record<Vertical, string> = {
  Telecom:  '#00a9e0', // TPG cyan
  Public:   '#26c997', // groen
  Energy:   '#f59e0b', // amber
  Civiel:   '#8b5cf6', // paars
  Industry: '#ef4444', // rood
  Overig:   '#8fa3c0', // grijs
}

/** Verticals die in de UI getoond worden voor een productie-BV. Alleen de
 *  buckets waar daadwerkelijk personen in zitten — als bv. Software geen
 *  Industry-personen heeft, vallen die kolommen weg. */
export function verticalsForBv(bv: FteBv): Vertical[] {
  if (bv === 'Holdings') return []
  const present = new Set<string>()
  for (const p of personSpec) {
    if (p.bv === bv && p.vertical) present.add(p.vertical)
  }
  return VERTICALS.filter(v => present.has(v))
}

/** Aggregaat over personSpec voor één BV, optioneel gefilterd op vertical.
 *  Geeft headcount + opgetelde FTE terug — undefined wanneer er geen rijen
 *  matchen, zodat de UI een "—" kan tonen i.p.v. een misleidende 0. */
export function personSpecAggregate(
  bv: FteBv,
  vertical?: Vertical | null,
): { fte: number; headcount: number } | undefined {
  const matching = personSpec.filter(p => {
    if (p.bv !== bv) return false
    if (vertical === undefined) return true
    return p.vertical === vertical
  })
  if (matching.length === 0) return undefined
  return {
    fte: matching.reduce((s, p) => s + (p.fte || 0), 0),
    headcount: matching.length,
  }
}

/** Snapshot-actuals voor een (BV, optionele vertical) op de snapshot-maand
 *  (zie PERSON_SPEC_MONTH). Null als er geen personen voor zijn. */
export function snapshotActuals(
  bv: FteBv,
  vertical?: Vertical | null,
): { month: string; fte: number; headcount: number } | null {
  const agg = personSpecAggregate(bv, vertical)
  if (!agg) return null
  return { month: PERSON_SPEC_MONTH, ...agg }
}

/** Normalize raw vertical-string uit externe data (bv. parsing) naar onze
 *  set. Onbekende waardes vallen door naar "Overig". Lege/null/"–" → "Overig". */
export function normalizeVertical(raw: string | null | undefined): Vertical {
  if (!raw || raw === '–' || raw === '-' || raw === '—') return 'Overig'
  if ((VERTICALS as readonly string[]).includes(raw)) return raw as Vertical
  return 'Overig'
}

/** Lookup: vertical voor een gegeven werknemer-ID (uit de IC-tarief tabel).
 *  Geeft null als de medewerker niet in de persoonsspec voorkomt of in
 *  Holdings zit (Holdings heeft geen vertical). */
export function verticalForEmployeeId(id: string): Vertical | null {
  const p: PersonSpec | undefined = personSpec.find(x => x.id === id)
  if (!p || !p.vertical) return null
  return normalizeVertical(p.vertical)
}
