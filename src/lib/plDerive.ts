/**
 * Gedeelde P&L-derivatieregels — zorgt dat Budget vs Actuals (BudgetTab) en
 * Budgetten (BudgetsTab) exact dezelfde aggregate/derived waardes laten zien.
 *
 * Aggregate keys: som van hun subposten uit SUBS_OF.
 * Derived keys:   berekend uit andere aggregate/flat keys via DERIVED_FORMULA.
 * Andere keys (sub of flat): direct uit de raw-lookup gelezen.
 */

export const SUBS_OF: Record<string, string[]> = {
  netto_omzet:                ['gefactureerde_omzet', 'omzet_periode_allocatie'],
  directe_kosten:             ['directe_inkoopkosten', 'directe_personeelskosten', 'directe_overige_personeelskosten', 'directe_autokosten'],
  operationele_kosten:        ['indirecte_personeelskosten', 'overige_personeelskosten', 'huisvestingskosten', 'automatiseringskosten', 'indirecte_autokosten', 'verkoopkosten', 'algemene_kosten', 'doorbelaste_kosten'],
  amortisatie_afschrijvingen: ['amortisatie_goodwill', 'amortisatie_software', 'afschrijvingen'],
}

export const DERIVED_FORMULA: Record<string, (v: (k: string) => number) => number> = {
  brutomarge:      v => v('netto_omzet') + v('directe_kosten'),
  ebitda:          v => v('brutomarge') + v('operationele_kosten'),
  ebit:            v => v('ebitda') + v('amortisatie_afschrijvingen'),
  netto_resultaat: v => v('ebit') + v('financieel_resultaat') + v('vennootschapsbelasting'),
}

export const AGGREGATE_KEYS = new Set(Object.keys(SUBS_OF))
export const DERIVED_KEYS   = new Set(Object.keys(DERIVED_FORMULA))
export const READONLY_KEYS  = new Set([...AGGREGATE_KEYS, ...DERIVED_KEYS])

/**
 * Bepaalt de effective waarde voor een P&L-key:
 *  - aggregate → som van subs (genegeerd wordt een mogelijk stale opgeslagen
 *    aggregate-waarde, zodat sub-edits in de Budgetten-tab altijd winnen)
 *  - derived → formule over andere keys (recursief gederiveerd)
 *  - leaf → directe raw-lookup
 *
 * Caller levert `rawLookup(key)` voor een specifieke (entity, maand, …) —
 * deze helper is onafhankelijk van de data-bron.
 */
export function derivePL(rawLookup: (key: string) => number, key: string): number {
  if (AGGREGATE_KEYS.has(key)) {
    return SUBS_OF[key].reduce((s, sk) => s + rawLookup(sk), 0)
  }
  if (DERIVED_KEYS.has(key)) {
    return DERIVED_FORMULA[key](k => derivePL(rawLookup, k))
  }
  return rawLookup(key)
}
