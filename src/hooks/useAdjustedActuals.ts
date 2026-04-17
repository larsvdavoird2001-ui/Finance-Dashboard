import { useFinStore } from '../store/useFinStore'
import { useOhwStore } from '../store/useOhwStore'
import { monthlyActuals2026 } from '../data/plData'
import type { EntityName } from '../data/plData'
import type { BvId } from '../data/types'

/**
 * Returns P&L actuals that incorporate live OHW edits + FinStore adjustments.
 *
 * NEW priority model — OHW is the central source:
 * 1. OHW mutatieOhw is ALWAYS live (even for closed months Jan/Feb)
 * 2. FinStore factuurvolume is used when non-zero (from SAP upload)
 * 3. FinStore manual adjustments (accruals, handmatigeCorrectie, kostencorrectie)
 *    are layered ON TOP of OHW revenue
 * 4. Fallback: if no OHW data → FinStore (if touched) → base actuals
 *
 * This ensures: editing OHW rows always propagates to P&L and Budget vs Actuals.
 */
export function useAdjustedActuals() {
  const entries   = useFinStore(s => s.entries)
  const ohwData2026 = useOhwStore(s => s.data2026)

  function getMonthly(bv: BvId, month: string): Record<string, number> {
    const base: Record<string, number> = { ...(monthlyActuals2026[bv as EntityName]?.[month] ?? {}) }
    const entry     = entries.find(e => e.bv === bv && e.month === month)
    const ohwEntity = ohwData2026.entities.find(e => e.entity === bv)

    // ── OHW-first: use live OHW data when available ────────────────────────
    if (ohwEntity && ohwEntity.nettoOmzet[month] != null) {
      // Revenue: OHW mutatieOhw is always live; factuurvolume from FinStore (SAP) or OHW
      const ohwFv      = ohwEntity.factuurvolume[month] ?? 0
      const ohwMut     = ohwEntity.mutatieOhw[month]    ?? 0
      const ohwIC      = ohwEntity.totaalIC[month]       ?? 0
      const factuurvolume = (entry?.factuurvolume && entry.factuurvolume !== 0)
        ? entry.factuurvolume
        : ohwFv

      // FinStore manual adjustments on top of OHW
      const accruals          = entry?.accruals           ?? 0
      const handmatigeCorr    = entry?.handmatigeCorrectie ?? 0
      const kostencorrectie   = entry?.kostencorrectie    ?? 0

      // netto-omzet voor IC = fv + ohwMut [+ mutatieVooruitgefactureerd voor Software] (= rij 52 in Excel)
      // netto-omzet definitief = netto-omzet voor IC + IC + accruals + handmatige correctie
      const mutatieVf        = ohwEntity.mutatieVooruitgefactureerd?.[month] ?? 0
      const netRevenueVoorIC = factuurvolume + ohwMut + mutatieVf
      const netRevenue       = netRevenueVoorIC + ohwIC + accruals + handmatigeCorr

      // Costs: FinStore override if explicitly set, else base actuals
      const adjKosten  = (base['directe_kosten'] ?? 0) - kostencorrectie
      const opKosten   = (entry?.operationeleKosten ?? 0) !== 0
        ? entry!.operationeleKosten
        : (base['operationele_kosten'] ?? 0)
      const amortisatie = (entry?.amortisatieAfschrijvingen ?? 0) !== 0
        ? entry!.amortisatieAfschrijvingen
        : (base['amortisatie_afschrijvingen'] ?? 0)

      const brutomarge = netRevenue + adjKosten
      const ebitda     = brutomarge + opKosten
      const ebit       = ebitda + amortisatie

      return {
        ...base,
        gefactureerde_omzet:        factuurvolume,
        omzet_periode_allocatie:    ohwMut,
        netto_omzet:                netRevenue,      // inclusief IC verrekening
        netto_omzet_voor_ic:        netRevenueVoorIC,
        directe_kosten:             adjKosten,
        brutomarge,
        operationele_kosten:        opKosten,
        amortisatie_afschrijvingen: amortisatie,
        ebitda,
        ebit,
      }
    }

    // ── Fallback: FinStore only (no OHW data for this month) ───────────────
    if (entry) {
      const touched = entry.factuurvolume !== 0 || entry.ohwMutatie !== 0 ||
                      entry.accruals !== 0 || entry.handmatigeCorrectie !== 0 ||
                      entry.kostencorrectie !== 0
      const isClosed = month === 'Jan-26' || month === 'Feb-26'
      if (touched || isClosed) {
        // Fallback: geen OHW-data, IC onbekend — netto-omzet zonder IC
        const netRevenue =
          entry.factuurvolume + entry.ohwMutatie + entry.accruals + entry.handmatigeCorrectie
        const adjKosten  = (base['directe_kosten'] ?? 0) - entry.kostencorrectie
        const opKosten   = entry.operationeleKosten !== 0
          ? entry.operationeleKosten
          : (base['operationele_kosten'] ?? 0)
        const amortisatie = entry.amortisatieAfschrijvingen !== 0
          ? entry.amortisatieAfschrijvingen
          : (base['amortisatie_afschrijvingen'] ?? 0)
        const brutomarge = netRevenue + adjKosten
        const ebitda     = brutomarge + opKosten
        const ebit       = ebitda + amortisatie
        return {
          ...base,
          gefactureerde_omzet:        entry.factuurvolume,
          omzet_periode_allocatie:    entry.ohwMutatie,
          netto_omzet:                netRevenue,
          directe_kosten:             adjKosten,
          brutomarge,
          operationele_kosten:        opKosten,
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
