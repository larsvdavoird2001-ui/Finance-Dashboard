import { useFinStore } from '../store/useFinStore'
import { useOhwStore } from '../store/useOhwStore'
import { useCostBreakdownStore } from '../store/useCostBreakdownStore'
import { monthlyActuals2026 } from '../data/plData'
import type { EntityName } from '../data/plData'
import type { BvId } from '../data/types'

// Sub-sleutels die samen de kosten-totals vormen. Zelfde indeling als MaandTab
// zodat getMonthly (deze hook) én MaandTab één waarheid delen.
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

const ALL_SUBS: readonly string[] = [
  ...DIRECTE_KOSTEN_SUBS,
  ...OPERATIONELE_KOSTEN_SUBS,
  ...AMORTISATIE_SUBS,
]

/**
 * Returns P&L actuals that incorporate live OHW edits + FinStore adjustments +
 * MaandTab kosten-specificaties (kostenOverrides + useCostBreakdownStore).
 *
 * Priority voor elke sub-kostensleutel:
 *   breakdowns-sum > entry.kostenOverrides[sub] > |base[sub]|
 *
 * Sign convention: costs worden teruggegeven als NEGATIEVE getallen
 * (plData-conventie). MaandTab slaat overrides/breakdowns positief op; hier
 * flippen we naar negatief bij het samenvoegen.
 */
export function useAdjustedActuals() {
  const entries     = useFinStore(s => s.entries)
  const ohwData2026 = useOhwStore(s => s.data2026)
  const breakdowns  = useCostBreakdownStore(s => s.entries)

  /** Som van breakdowns voor (month, category, bv). Null = geen breakdowns. */
  const sumBreakdowns = (month: string, category: string, bv: BvId): number | null => {
    let sum = 0
    let found = false
    for (const b of breakdowns) {
      if (b.month === month && b.category === category) {
        sum += b.values[bv] ?? 0
        found = true
      }
    }
    return found ? sum : null
  }

  /** Positieve waarde voor één sub-kostensleutel: breakdowns > override > |base|. */
  const getSubCostPositive = (
    bv: BvId,
    month: string,
    subKey: string,
    kostenOverrides: Record<string, number> | undefined,
    base: Record<string, number>,
  ): number => {
    const bd = sumBreakdowns(month, subKey, bv)
    if (bd != null) return bd
    if (kostenOverrides && kostenOverrides[subKey] !== undefined) {
      return kostenOverrides[subKey]
    }
    return Math.abs(base[subKey] ?? 0)
  }

  function getMonthly(bv: BvId, month: string): Record<string, number> {
    const base: Record<string, number> = { ...(monthlyActuals2026[bv as EntityName]?.[month] ?? {}) }
    const entry     = entries.find(e => e.bv === bv && e.month === month)
    const ohwEntity = ohwData2026.entities.find(e => e.entity === bv)
    // Defensieve unwrap: oude persisted entries kunnen kostenOverrides missen.
    const kostenOv: Record<string, number> = entry?.kostenOverrides ?? {}

    // Stap 1: per-sub positief. Eerst breakdowns, dan override, dan |base|.
    const subPos: Record<string, number> = {}
    for (const k of ALL_SUBS) {
      subPos[k] = getSubCostPositive(bv, month, k, kostenOv, base)
    }

    // Stap 2: aggregate negatieven (plData-conventie).
    const sumSubs = (subs: readonly string[]) =>
      -subs.reduce((s, k) => s + (subPos[k] ?? 0), 0)
    const directeKosten      = sumSubs(DIRECTE_KOSTEN_SUBS)
    const operationeleKosten = sumSubs(OPERATIONELE_KOSTEN_SUBS)
    const amortisatie        = sumSubs(AMORTISATIE_SUBS)

    // Stap 3: per-sub negatief (spread naar return object) zodat detail-rijen
    // in Budget vs Actuals direct werken — ook voor Mar-26 zonder plData.
    const subSigned: Record<string, number> = {}
    for (const k of ALL_SUBS) subSigned[k] = -(subPos[k] ?? 0)

    // Heeft de user écht sub-kosten ingevuld (breakdown of override)?
    const hasAnySubCustom = ALL_SUBS.some(k =>
      sumBreakdowns(month, k, bv) != null ||
      kostenOv[k] !== undefined,
    )

    // Oude kostencorrectie: alleen toepassen als er geen sub-specs zijn,
    // anders dubbel aftrekken.
    const kostencorrectie = entry?.kostencorrectie ?? 0
    const adjDirecteKosten = hasAnySubCustom ? directeKosten : directeKosten - kostencorrectie

    // ── OHW-first: live OHW + sub-cost spec ─────────────────────────────────
    if (ohwEntity && ohwEntity.nettoOmzet[month] != null) {
      const ohwFv      = ohwEntity.factuurvolume[month] ?? 0
      const ohwMut     = ohwEntity.mutatieOhw[month]    ?? 0
      const ohwIC      = ohwEntity.totaalIC[month]       ?? 0
      const factuurvolume = (entry?.factuurvolume && entry.factuurvolume !== 0)
        ? entry.factuurvolume
        : ohwFv
      const accruals       = entry?.accruals            ?? 0
      const handmatigeCorr = entry?.handmatigeCorrectie ?? 0
      const mutatieVf      = ohwEntity.mutatieVooruitgefactureerd?.[month] ?? 0
      const netRevenueVoorIC = factuurvolume + ohwMut + mutatieVf
      const netRevenue       = netRevenueVoorIC + ohwIC + accruals + handmatigeCorr

      const brutomarge = netRevenue + adjDirecteKosten
      const ebitda     = brutomarge + operationeleKosten
      const ebit       = ebitda + amortisatie

      return {
        ...base,
        ...subSigned,
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

    // ── Fallback: FinStore only (geen OHW voor deze maand) ──────────────────
    if (entry) {
      const touched =
        entry.factuurvolume !== 0 || entry.ohwMutatie !== 0 ||
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
          ...subSigned,
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

    // Laatste fallback: als er sub-specs zijn maar geen OHW/entry-touched,
    // nog steeds de kosten teruggeven (voorkomt "altijd 0" bij pure cost-only
    // maanden).
    if (hasAnySubCustom) {
      const brutomarge = (base['netto_omzet'] ?? 0) + adjDirecteKosten
      const ebitda     = brutomarge + operationeleKosten
      const ebit       = ebitda + amortisatie
      return {
        ...base,
        ...subSigned,
        directe_kosten:             adjDirecteKosten,
        brutomarge,
        operationele_kosten:        operationeleKosten,
        amortisatie_afschrijvingen: amortisatie,
        ebitda,
        ebit,
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
