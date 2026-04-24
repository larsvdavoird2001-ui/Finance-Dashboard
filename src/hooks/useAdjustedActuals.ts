import { useFinStore } from '../store/useFinStore'
import { useOhwStore } from '../store/useOhwStore'
import { useCostBreakdownStore } from '../store/useCostBreakdownStore'
import { monthlyActuals2026 } from '../data/plData'
import type { EntityName } from '../data/plData'
import type { BvId } from '../data/types'

// Sub-sleutels die samen de kosten-totals vormen. Zelfde indeling als MaandTab
// zodat getMonthly (deze hook) én MaandTab één waarheid delen. Als deze lijsten
// in MaandTab wijzigen, pas ze hier ook aan (kleine set, bewust gedupliceerd).
const DIRECTE_KOSTEN_SUBS = [
  'directe_inkoopkosten',
  'directe_personeelskosten',
  'directe_overige_personeelskosten',
  'directe_autokosten',
] as const
const OPERATIONELE_KOSTEN_SUBS = [
  'indirecte_personeelskosten',
  'overige_personeelskosten',
  'huisvestingskosten',
  'automatiseringskosten',
  'indirecte_autokosten',
  'verkoopkosten',
  'algemene_kosten',
  'doorbelaste_kosten',
] as const
const AMORTISATIE_SUBS = [
  'amortisatie_goodwill',
  'amortisatie_software',
  'afschrijvingen',
] as const

/**
 * Returns P&L actuals that incorporate live OHW edits + FinStore adjustments +
 * MaandTab kosten-specificaties (kostenOverrides + useCostBreakdownStore).
 *
 * Priority model:
 * 1. OHW mutatieOhw is ALWAYS live (ook voor closed months)
 * 2. FinStore factuurvolume overschrijft OHW factuurvolume wanneer gezet
 * 3. Manual FinStore adjustments (accruals, handmatige correctie) worden
 *    bovenop OHW-revenue opgeteld
 * 4. Kosten: per sub-key — breakdowns-sum > kostenOverrides > base (plData)
 * 5. Fallback: alleen FinStore als OHW leeg is; anders pure base-actuals
 *
 * Sign convention: costs worden teruggegeven als NEGATIEVE getallen
 * (plData-conventie). MaandTab slaat overrides/breakdowns positief op; hier
 * flippen we naar negatief bij het samenvoegen.
 */
export function useAdjustedActuals() {
  const entries        = useFinStore(s => s.entries)
  const ohwData2026    = useOhwStore(s => s.data2026)
  const breakdowns     = useCostBreakdownStore(s => s.entries)

  /** Som van breakdowns voor (month, category, bv). Null = geen breakdowns. */
  const sumBreakdowns = (month: string, category: string, bv: BvId): number | null => {
    const rows = breakdowns.filter(b => b.month === month && b.category === category)
    if (rows.length === 0) return null
    return rows.reduce((s, r) => s + (r.values[bv] ?? 0), 0)
  }

  /** Positieve waarde voor een sub-kostensleutel: breakdowns > override > |base|. */
  const getSubCostPositive = (
    bv: BvId,
    month: string,
    subKey: string,
    entry: { kostenOverrides: Record<string, number> } | undefined,
    base: Record<string, number>,
  ): number => {
    const bd = sumBreakdowns(month, subKey, bv)
    if (bd != null) return bd
    if (entry && entry.kostenOverrides && entry.kostenOverrides[subKey] !== undefined) {
      return entry.kostenOverrides[subKey]
    }
    return Math.abs(base[subKey] ?? 0)
  }

  /** Som van sub-keys als negatief totaal (plData-conventie). */
  const sumSubsNegative = (
    bv: BvId,
    month: string,
    subs: readonly string[],
    entry: { kostenOverrides: Record<string, number> } | undefined,
    base: Record<string, number>,
  ): number => {
    let pos = 0
    for (const k of subs) pos += getSubCostPositive(bv, month, k, entry, base)
    return -pos
  }

  function getMonthly(bv: BvId, month: string): Record<string, number> {
    const base: Record<string, number> = { ...(monthlyActuals2026[bv as EntityName]?.[month] ?? {}) }
    const entry     = entries.find(e => e.bv === bv && e.month === month)
    const ohwEntity = ohwData2026.entities.find(e => e.entity === bv)

    // Per-sub details (altijd berekend zodat ze ook in de fallback-tak
    // meegenomen kunnen worden voor maanden zonder OHW-data).
    const subPositives: Record<string, number> = {}
    for (const k of [...DIRECTE_KOSTEN_SUBS, ...OPERATIONELE_KOSTEN_SUBS, ...AMORTISATIE_SUBS]) {
      subPositives[k] = getSubCostPositive(bv, month, k, entry, base)
    }
    const directeKosten       = -DIRECTE_KOSTEN_SUBS.reduce((s, k) => s + subPositives[k], 0)
    const operationeleKosten  = -OPERATIONELE_KOSTEN_SUBS.reduce((s, k) => s + subPositives[k], 0)
    const amortisatie         = -AMORTISATIE_SUBS.reduce((s, k) => s + subPositives[k], 0)
    const subKeysSignedSpread: Record<string, number> = {}
    for (const k of DIRECTE_KOSTEN_SUBS) subKeysSignedSpread[k] = -subPositives[k]
    for (const k of OPERATIONELE_KOSTEN_SUBS) subKeysSignedSpread[k] = -subPositives[k]
    for (const k of AMORTISATIE_SUBS) subKeysSignedSpread[k] = -subPositives[k]

    // Oude `kostencorrectie` werkt als aanpassing op directe_kosten (negatief
    // getal = extra last). Preserve voor back-compat als er géén sub-specs zijn.
    const hasAnySubCustom = [...DIRECTE_KOSTEN_SUBS, ...OPERATIONELE_KOSTEN_SUBS, ...AMORTISATIE_SUBS]
      .some(k => sumBreakdowns(month, k, bv) != null ||
                 (entry && entry.kostenOverrides && entry.kostenOverrides[k] !== undefined))
    const kostencorrectie = entry?.kostencorrectie ?? 0
    const adjDirecteKosten = hasAnySubCustom ? directeKosten : directeKosten - kostencorrectie

    // ── OHW-first: use live OHW data when available ────────────────────────
    if (ohwEntity && ohwEntity.nettoOmzet[month] != null) {
      const ohwFv      = ohwEntity.factuurvolume[month] ?? 0
      const ohwMut     = ohwEntity.mutatieOhw[month]    ?? 0
      const ohwIC      = ohwEntity.totaalIC[month]       ?? 0
      const factuurvolume = (entry?.factuurvolume && entry.factuurvolume !== 0)
        ? entry.factuurvolume
        : ohwFv

      const accruals          = entry?.accruals           ?? 0
      const handmatigeCorr    = entry?.handmatigeCorrectie ?? 0

      const mutatieVf        = ohwEntity.mutatieVooruitgefactureerd?.[month] ?? 0
      const netRevenueVoorIC = factuurvolume + ohwMut + mutatieVf
      const netRevenue       = netRevenueVoorIC + ohwIC + accruals + handmatigeCorr

      const brutomarge = netRevenue + adjDirecteKosten
      const ebitda     = brutomarge + operationeleKosten
      const ebit       = ebitda + amortisatie

      return {
        ...base,
        ...subKeysSignedSpread,
        gefactureerde_omzet:        factuurvolume,
        omzet_periode_allocatie:    ohwMut,
        netto_omzet:                netRevenue,
        netto_omzet_voor_ic:        netRevenueVoorIC,
        directe_kosten:             adjDirecteKosten,
        brutomarge,
        operationele_kosten:        operationeleKosten,
        amortisatie_afschrijvingen: amortisatie,
        ebitda,
        ebit,
      }
    }

    // ── Fallback: FinStore only (no OHW data for this month) ───────────────
    if (entry) {
      const touched = entry.factuurvolume !== 0 || entry.ohwMutatie !== 0 ||
                      entry.accruals !== 0 || entry.handmatigeCorrectie !== 0 ||
                      entry.kostencorrectie !== 0 || hasAnySubCustom
      const isClosed = month === 'Jan-26' || month === 'Feb-26'
      if (touched || isClosed) {
        const netRevenue =
          entry.factuurvolume + entry.ohwMutatie + entry.accruals + entry.handmatigeCorrectie
        const brutomarge = netRevenue + adjDirecteKosten
        const ebitda     = brutomarge + operationeleKosten
        const ebit       = ebitda + amortisatie
        return {
          ...base,
          ...subKeysSignedSpread,
          gefactureerde_omzet:        entry.factuurvolume,
          omzet_periode_allocatie:    entry.ohwMutatie,
          netto_omzet:                netRevenue,
          directe_kosten:             adjDirecteKosten,
          brutomarge,
          operationele_kosten:        operationeleKosten,
          amortisatie_afschrijvingen: amortisatie,
          ebitda,
          ebit,
        }
      }
    }

    return base
  }

  /** Sum monthly actuals across a list of months (for YTD) */
  function getYtd(bv: BvId, months: string[]): Record<string, number> {
    const result: Record<string, number> = {}
    for (const m of months) {
      const d = getMonthly(bv, m)
      for (const k of Object.keys(d)) {
        result[k] = (result[k] ?? 0) + (d[k] ?? 0)
      }
    }
    return result
  }

  return { getMonthly, getYtd }
}
