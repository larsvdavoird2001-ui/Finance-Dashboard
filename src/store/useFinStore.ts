import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ClosingEntry, ClosingBv } from '../data/types'
import {
  fetchClosingEntries,
  upsertClosingEntry,
  upsertAllClosingEntries,
  fetchFinalizedMonths,
  upsertFinalizedMonth,
  deleteFinalizedMonth,
  type FinalizedMonth,
} from '../lib/db'

// ── Afsluitbare maanden ───────────────────────────────────────────────────
// De Maandafsluiting-tab toont elke maand t/m de vorige kalendermaand (de
// maand die net is afgelopen en dus afgesloten kan worden). De lijst groeit
// automatisch mee zodra een nieuwe kalendermaand begint — eerder stond deze
// hard op Jan–Apr, waardoor nieuwe maanden niet in de tab verschenen terwijl
// de Maandafsluiting-notificatie ze wél aankondigde.
//   Ondergrens: Apr-26 (de maanden met hardgecodeerde Q1+April-actuals blijven
//   altijd zichtbaar). Bovengrens: Dec-26.
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const APP_YEAR = 2026
const MIN_CLOSING_IDX = 7 // t/m Aug-26 (maanden met hardgecodeerde actuals blijven altijd zichtbaar)

function computeClosingMonths(now: Date = new Date()): string[] {
  let lastIdx: number
  if (now.getFullYear() > APP_YEAR) lastIdx = 11               // app-jaar voorbij → hele jaar afsluitbaar
  else if (now.getFullYear() < APP_YEAR) lastIdx = MIN_CLOSING_IDX
  else lastIdx = now.getMonth() - 1                            // vorige kalendermaand
  lastIdx = Math.min(11, Math.max(MIN_CLOSING_IDX, lastIdx))
  return MONTH_ABBR.slice(0, lastIdx + 1).map(m => `${m}-26`)
}

export const CLOSING_MONTHS = computeClosingMonths()

// Financieel resultaat & vennootschapsbelasting per BV/maand — bekende
// actuals-waardes uit de P&L (plData 2026). Jan-Apr worden voor-ingevuld
// zodat de user ze alleen hoeft te bevestigen / aanpassen.
const FIN_RES_JAN: Record<ClosingBv, number> = { Consultancy: -512,   Projects: -242,   Software: -102,    Holdings: -37559  }
const FIN_RES_FEB: Record<ClosingBv, number> = { Consultancy: -382,   Projects: -196,   Software: -7431,   Holdings: -37135  }
const FIN_RES_MAR: Record<ClosingBv, number> = { Consultancy: -3700,  Projects: -2632,  Software: 6848,    Holdings: -40718  }
const FIN_RES_APR: Record<ClosingBv, number> = { Consultancy: -444,   Projects: -188,   Software: -78,     Holdings: -112089 }
const FIN_RES_MAY: Record<ClosingBv, number> = { Consultancy: -378,   Projects: -143,   Software: -78,     Holdings: 40457   }
const FIN_RES_JUN: Record<ClosingBv, number> = { Consultancy: -362,   Projects: -139,   Software: -88,     Holdings: -16834  }
const FIN_RES_JUL: Record<ClosingBv, number> = { Consultancy: -466,   Projects: -137,   Software: -127,    Holdings: -33017  }
const FIN_RES_AUG: Record<ClosingBv, number> = { Consultancy: -680,   Projects: -169,   Software: -87,     Holdings: -33208  }
const VPB_JAN:     Record<ClosingBv, number> = { Consultancy: 0,      Projects: 0,      Software: 0,       Holdings: 0       }
const VPB_FEB:     Record<ClosingBv, number> = { Consultancy: 0,      Projects: 0,      Software: 0,       Holdings: 0       }
const VPB_MAR:     Record<ClosingBv, number> = { Consultancy: 0,      Projects: 0,      Software: 0,       Holdings: 0       }
const VPB_APR:     Record<ClosingBv, number> = { Consultancy: 0,      Projects: 0,      Software: 0,       Holdings: 0       }
const VPB_MAY:     Record<ClosingBv, number> = { Consultancy: 0,      Projects: 0,      Software: 0,       Holdings: 0       }
const VPB_JUN:     Record<ClosingBv, number> = { Consultancy: 0,      Projects: 0,      Software: 0,       Holdings: 0       }
const VPB_JUL:     Record<ClosingBv, number> = { Consultancy: 0,      Projects: 0,      Software: 0,       Holdings: 0       }
const VPB_AUG:     Record<ClosingBv, number> = { Consultancy: 0,      Projects: 0,      Software: 0,       Holdings: 0       }

// Initial closing data sourced from P02.2026 Maandrapportage actuals
const BASE_ENTRIES: ClosingEntry[] = [
  // ── January 2026 ─────────────────────────────────────────────────────────
  {
    id: 'c-jan26', bv: 'Consultancy', month: 'Jan-26',
    factuurvolume: 719770, debiteuren: 0, ohwMutatie: 217688,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_JAN.Consultancy, vennootschapsbelasting: VPB_JAN.Consultancy,
    remark: '',
  },
  {
    id: 'p-jan26', bv: 'Projects', month: 'Jan-26',
    factuurvolume: 364790, debiteuren: 0, ohwMutatie: 180298,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_JAN.Projects, vennootschapsbelasting: VPB_JAN.Projects,
    remark: '',
  },
  {
    id: 's-jan26', bv: 'Software', month: 'Jan-26',
    factuurvolume: 493761, debiteuren: 0, ohwMutatie: -35002,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_JAN.Software, vennootschapsbelasting: VPB_JAN.Software,
    remark: '',
  },
  // ── February 2026 ────────────────────────────────────────────────────────
  {
    id: 'c-feb26', bv: 'Consultancy', month: 'Feb-26',
    factuurvolume: 797454, debiteuren: 0, ohwMutatie: 205300,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_FEB.Consultancy, vennootschapsbelasting: VPB_FEB.Consultancy,
    remark: '',
  },
  {
    id: 'p-feb26', bv: 'Projects', month: 'Feb-26',
    factuurvolume: 418811, debiteuren: 0, ohwMutatie: 107890,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_FEB.Projects, vennootschapsbelasting: VPB_FEB.Projects,
    remark: '',
  },
  {
    id: 's-feb26', bv: 'Software', month: 'Feb-26',
    factuurvolume: 261030, debiteuren: 0, ohwMutatie: -7000,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_FEB.Software, vennootschapsbelasting: VPB_FEB.Software,
    remark: '',
  },
  // ── March 2026 (actuals uit maandafsluiting) ─────────────────────────────
  {
    id: 'c-mar26', bv: 'Consultancy', month: 'Mar-26',
    // P08-rapportage reviseerde maart: fv 1.068.056 → 1.053.260, mutatie -44.348 → -24.169
    factuurvolume: 1053260, debiteuren: 0, ohwMutatie: -24169,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_MAR.Consultancy, vennootschapsbelasting: VPB_MAR.Consultancy,
    remark: '',
  },
  {
    id: 'p-mar26', bv: 'Projects', month: 'Mar-26',
    // P08-rapportage reviseerde maart: fv 698.848 → 608.848, mutatie 14.646 → 104.646
    factuurvolume: 608848, debiteuren: 0, ohwMutatie: 104646,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_MAR.Projects, vennootschapsbelasting: VPB_MAR.Projects,
    remark: '',
  },
  {
    id: 's-mar26', bv: 'Software', month: 'Mar-26',
    // P08-rapportage reviseerde maart: fv 203.630 → 151.630, mutatie 49.665 → -5.300
    factuurvolume: 151630, debiteuren: 0, ohwMutatie: -5300,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_MAR.Software, vennootschapsbelasting: VPB_MAR.Software,
    remark: '',
  },
  // ── April 2026 (actuals uit maandafsluiting) ─────────────────────────────
  {
    id: 'c-apr26', bv: 'Consultancy', month: 'Apr-26',
    // P08-rapportage reviseerde april: mutatie -175.592 → -165.504
    factuurvolume: 1113614, debiteuren: 0, ohwMutatie: -165504,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_APR.Consultancy, vennootschapsbelasting: VPB_APR.Consultancy,
    remark: '',
  },
  {
    id: 'p-apr26', bv: 'Projects', month: 'Apr-26',
    factuurvolume: 477026, debiteuren: 0, ohwMutatie: 166062,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_APR.Projects, vennootschapsbelasting: VPB_APR.Projects,
    remark: '',
  },
  {
    id: 's-apr26', bv: 'Software', month: 'Apr-26',
    factuurvolume: 272008, debiteuren: 0, ohwMutatie: 110015,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_APR.Software, vennootschapsbelasting: VPB_APR.Software,
    remark: '',
  },
  // ── Mei 2026 (actuals uit P08-maandrapportage) ───────────────────────────
  {
    id: 'c-may26', bv: 'Consultancy', month: 'May-26',
    factuurvolume: 923527, debiteuren: 0, ohwMutatie: -86891,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_MAY.Consultancy, vennootschapsbelasting: VPB_MAY.Consultancy,
    remark: '',
  },
  {
    id: 'p-may26', bv: 'Projects', month: 'May-26',
    factuurvolume: 560722, debiteuren: 0, ohwMutatie: 70914,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_MAY.Projects, vennootschapsbelasting: VPB_MAY.Projects,
    remark: '',
  },
  {
    id: 's-may26', bv: 'Software', month: 'May-26',
    factuurvolume: 125169, debiteuren: 0, ohwMutatie: 144540,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_MAY.Software, vennootschapsbelasting: VPB_MAY.Software,
    remark: '',
  },
  // ── Juni 2026 (actuals uit P08-maandrapportage) ──────────────────────────
  {
    id: 'c-jun26', bv: 'Consultancy', month: 'Jun-26',
    factuurvolume: 863206, debiteuren: 0, ohwMutatie: 85282,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_JUN.Consultancy, vennootschapsbelasting: VPB_JUN.Consultancy,
    remark: '',
  },
  {
    id: 'p-jun26', bv: 'Projects', month: 'Jun-26',
    factuurvolume: 354763, debiteuren: 0, ohwMutatie: 88859,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_JUN.Projects, vennootschapsbelasting: VPB_JUN.Projects,
    remark: '',
  },
  {
    id: 's-jun26', bv: 'Software', month: 'Jun-26',
    factuurvolume: 625042, debiteuren: 0, ohwMutatie: -199572,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_JUN.Software, vennootschapsbelasting: VPB_JUN.Software,
    remark: '',
  },
  // ── Juli 2026 (actuals uit P08-maandrapportage) ──────────────────────────
  {
    id: 'c-jul26', bv: 'Consultancy', month: 'Jul-26',
    factuurvolume: 820152, debiteuren: 0, ohwMutatie: 55265,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_JUL.Consultancy, vennootschapsbelasting: VPB_JUL.Consultancy,
    remark: '',
  },
  {
    id: 'p-jul26', bv: 'Projects', month: 'Jul-26',
    factuurvolume: 785029, debiteuren: 0, ohwMutatie: -223955,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_JUL.Projects, vennootschapsbelasting: VPB_JUL.Projects,
    remark: '',
  },
  {
    id: 's-jul26', bv: 'Software', month: 'Jul-26',
    factuurvolume: 78568, debiteuren: 0, ohwMutatie: 19976,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_JUL.Software, vennootschapsbelasting: VPB_JUL.Software,
    remark: '',
  },
  // ── Augustus 2026 (actuals uit P08-maandrapportage) ──────────────────────
  {
    id: 'c-aug26', bv: 'Consultancy', month: 'Aug-26',
    factuurvolume: 733182, debiteuren: 0, ohwMutatie: 9692,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_AUG.Consultancy, vennootschapsbelasting: VPB_AUG.Consultancy,
    remark: '',
  },
  {
    id: 'p-aug26', bv: 'Projects', month: 'Aug-26',
    factuurvolume: 402188, debiteuren: 0, ohwMutatie: 83502,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_AUG.Projects, vennootschapsbelasting: VPB_AUG.Projects,
    remark: '',
  },
  {
    id: 's-aug26', bv: 'Software', month: 'Aug-26',
    factuurvolume: 163295, debiteuren: 0, ohwMutatie: 101578,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_AUG.Software, vennootschapsbelasting: VPB_AUG.Software,
    remark: '',
  },
  // ── Holdings: geen OHW/factuurvolume flow, alleen kosten-invoer ─────
  {
    id: 'h-jan26', bv: 'Holdings', month: 'Jan-26',
    factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_JAN.Holdings, vennootschapsbelasting: VPB_JAN.Holdings,
    remark: '',
  },
  {
    id: 'h-feb26', bv: 'Holdings', month: 'Feb-26',
    factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_FEB.Holdings, vennootschapsbelasting: VPB_FEB.Holdings,
    remark: '',
  },
  {
    id: 'h-mar26', bv: 'Holdings', month: 'Mar-26',
    factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_MAR.Holdings, vennootschapsbelasting: VPB_MAR.Holdings,
    remark: '',
  },
  {
    id: 'h-apr26', bv: 'Holdings', month: 'Apr-26',
    factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_APR.Holdings, vennootschapsbelasting: VPB_APR.Holdings,
    remark: '',
  },
  {
    id: 'h-may26', bv: 'Holdings', month: 'May-26',
    factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_MAY.Holdings, vennootschapsbelasting: VPB_MAY.Holdings,
    remark: '',
  },
  {
    id: 'h-jun26', bv: 'Holdings', month: 'Jun-26',
    factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_JUN.Holdings, vennootschapsbelasting: VPB_JUN.Holdings,
    remark: '',
  },
  {
    id: 'h-jul26', bv: 'Holdings', month: 'Jul-26',
    factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_JUL.Holdings, vennootschapsbelasting: VPB_JUL.Holdings,
    remark: '',
  },
  {
    id: 'h-aug26', bv: 'Holdings', month: 'Aug-26',
    factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {},
    financieelResultaat: FIN_RES_AUG.Holdings, vennootschapsbelasting: VPB_AUG.Holdings,
    remark: '',
  },
]

// Maanden met hardgecodeerde actuals hierboven; al het overige in CLOSING_MONTHS
// krijgt een lege entry per BV.
//
// BASE_ACTUAL_MONTHS_2026 is de autoritatieve, in-code gedeelde lijst van
// maanden waarvoor TPG-brede actuals bekend zijn. Deze lijst is dezelfde voor
// elke gebruiker (zit in de bundle, niet in per-user state) en moet daarom de
// bron zijn voor wat de Executive Overview als "actual"-maanden toont — anders
// ziet een nieuw account minder maanden dan iemand die een maand lokaal al
// heeft afgesloten. Breid deze lijst uit zodra een nieuwe maand harde actuals
// krijgt in BASE_ENTRIES hierboven.
export const BASE_ACTUAL_MONTHS_2026: string[] = ['Jan-26', 'Feb-26', 'Mar-26', 'Apr-26', 'May-26', 'Jun-26', 'Jul-26', 'Aug-26']
const BASE_MONTHS = new Set<string>(BASE_ACTUAL_MONTHS_2026)
const ALL_CLOSING_BVS: ClosingBv[] = ['Consultancy', 'Projects', 'Software', 'Holdings']

/** Lege closing-entry voor een (bv, maand) zonder hardgecodeerde actuals. Nodig
 *  zodat factuurvolume-imports en kosten-invoer voor nieuwe maanden ergens in
 *  landen — zonder bestaande entry doet applyImportToEntries `continue` en gaat
 *  de import stilletjes verloren. Het id volgt hetzelfde schema als hierboven
 *  (en als ensureEntry's fallback): bv. 'c-may26'. */
function emptyClosingEntry(bv: ClosingBv, month: string): ClosingEntry {
  return {
    id: `${bv[0].toLowerCase()}-${month.replace('-', '').toLowerCase()}`,
    bv, month,
    factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0,
    kostenOverrides: {}, remark: '',
  }
}

// Volledige initiële set: hardgecodeerde Jan–Apr + lege entries voor elke
// verdere afsluitbare maand × alle 4 BVs. Groeit mee met CLOSING_MONTHS, en
// via mergeWithInitialEntries krijgen bestaande users de nieuwe maanden erbij.
const INITIAL_ENTRIES: ClosingEntry[] = [
  ...BASE_ENTRIES,
  ...CLOSING_MONTHS
    .filter(m => !BASE_MONTHS.has(m))
    .flatMap(m => ALL_CLOSING_BVS.map(bv => emptyClosingEntry(bv, m))),
]

/** Pre-fill-defaults die read-paden kunnen gebruiken als een persisted entry
 *  de nieuwe velden (financieelResultaat / vennootschapsbelasting) nog niet
 *  heeft. Voorkomt "leeg veld" voor bestaande users die hun store al hadden. */
export function getFinResDefault(bv: ClosingBv, month: string): number {
  if (month === 'Jan-26') return FIN_RES_JAN[bv] ?? 0
  if (month === 'Feb-26') return FIN_RES_FEB[bv] ?? 0
  if (month === 'Mar-26') return FIN_RES_MAR[bv] ?? 0
  if (month === 'Apr-26') return FIN_RES_APR[bv] ?? 0
  if (month === 'May-26') return FIN_RES_MAY[bv] ?? 0
  if (month === 'Jun-26') return FIN_RES_JUN[bv] ?? 0
  if (month === 'Jul-26') return FIN_RES_JUL[bv] ?? 0
  if (month === 'Aug-26') return FIN_RES_AUG[bv] ?? 0
  return 0
}
export function getVpbDefault(bv: ClosingBv, month: string): number {
  if (month === 'Jan-26') return VPB_JAN[bv] ?? 0
  if (month === 'Feb-26') return VPB_FEB[bv] ?? 0
  if (month === 'Mar-26') return VPB_MAR[bv] ?? 0
  if (month === 'Apr-26') return VPB_APR[bv] ?? 0
  if (month === 'May-26') return VPB_MAY[bv] ?? 0
  if (month === 'Jun-26') return VPB_JUN[bv] ?? 0
  if (month === 'Jul-26') return VPB_JUL[bv] ?? 0
  if (month === 'Aug-26') return VPB_AUG[bv] ?? 0
  return 0
}

interface FinStore {
  entries: ClosingEntry[]
  /** Maanden waarvoor de Maandafsluiting expliciet definitief is gemaakt.
   *  ALLEEN deze maanden worden door de LE-hook als 'actual' gezien — open
   *  maanden (incl. kalender-gesloten maar nog niet finaliseerde) blijven LE-
   *  forecast. Bewaart óók de checklist-snapshot zodat een unfinalize→
   *  refinalize de eerder afgevinkte items niet kwijtraakt. */
  finalized: FinalizedMonth[]
  /** Sentinel: éénmalige migratie heeft Jan-26/Feb-26 als auto-finalized
   *  toegevoegd op basis van de hardgecodeerde initial actuals. Voorkomt
   *  re-seeding nadat de gebruiker een gesloten maand bewust unfinalized. */
  seededInitialFinalized: boolean
  loaded: boolean
  loadFromDb: () => Promise<void>
  updateEntry: (id: string, patch: Partial<Omit<ClosingEntry, 'id'>>) => void
  getEntry: (bv: ClosingBv, month: string) => ClosingEntry | undefined
  getMonthEntries: (month: string) => ClosingEntry[]
  /** Zorgt dat er een entry bestaat voor (bv, month). Returned de entry.
   *  Nodig voor gevallen waar de persisted state een oude versie was
   *  (bv. voor Holdings werd toegevoegd). Lazy create maakt een lege
   *  entry met INITIAL_ENTRIES-defaults. */
  ensureEntry: (bv: ClosingBv, month: string) => ClosingEntry
  /** Is deze maand definitief afgesloten? */
  isMonthFinalized: (month: string) => boolean
  /** Geef het record terug (incl. checklist-snapshot) of undefined. */
  getFinalized: (month: string) => FinalizedMonth | undefined
  /** Markeer een maand als definitief afgesloten. checklist = snapshot van
   *  afgevinkte items op het moment van finaliseren. leSnapshot = LE-forecast
   *  per BV (netto omzet, brutomarge, EBITDA) zoals die was vóór de eigen
   *  actuals meetelden — voor het LE-vs-Actuals accuraatheidsrapport en de
   *  AI LE-leerlus. Optional zodat oudere call-sites blijven werken. */
  finalizeMonth: (
    month: string,
    by: string,
    checklist: Record<string, boolean>,
    leSnapshot?: Record<string, import('../lib/db').LeSnapshotByBv>,
  ) => Promise<void>
  /** Onderwijs een maand opnieuw als open. */
  unfinalizeMonth: (month: string) => Promise<void>
}

/** Merge: voeg ontbrekende INITIAL_ENTRIES toe aan de gegeven lijst.
 *  Critical voor migraties — users met oudere persisted state (bv. zonder
 *  Holdings) krijgen de nieuwe entries er automatisch bij. Hiermee bailt
 *  updateKosten niet meer uit bij Holdings-cellen. */
/** P08-rapportage reviseerde eerder geseede maart/april-waarden. Persisted
 *  entries die nog exact het OUDE seed-bedrag dragen (dus onaangeraakt zijn)
 *  worden opgetild naar de gereviseerde waarde; door de gebruiker gewijzigde
 *  bedragen blijven staan. Key = entry-id. */
const SEED_REVISIONS: Record<string, { fv?: [number, number]; mut?: [number, number] }> = {
  'c-mar26': { fv: [1068056, 1053260], mut: [-44348, -24169] },
  'p-mar26': { fv: [698848, 608848],   mut: [14646, 104646] },
  's-mar26': { fv: [203630, 151630],   mut: [49665, -5300] },
  'c-apr26': { mut: [-175592, -165504] },
}
function applySeedRevisions(entries: ClosingEntry[]): ClosingEntry[] {
  let changed = false
  const out = entries.map(e => {
    const rev = SEED_REVISIONS[e.id]
    if (!rev) return e
    let next = e
    if (rev.fv && e.factuurvolume === rev.fv[0]) { next = { ...next, factuurvolume: rev.fv[1] }; changed = true }
    if (rev.mut && next.ohwMutatie === rev.mut[0]) { next = { ...next, ohwMutatie: rev.mut[1] }; changed = true }
    return next
  })
  return changed ? out : entries
}

function mergeWithInitialEntries(existing: ClosingEntry[]): ClosingEntry[] {
  const existingIds = new Set(existing.map(e => e.id))
  const missing = INITIAL_ENTRIES.filter(e => !existingIds.has(e.id))
  const merged = missing.length > 0 ? [...existing, ...missing] : existing
  return applySeedRevisions(merged)
}

export const useFinStore = create<FinStore>()(
  persist(
    (set, get) => ({
      entries: INITIAL_ENTRIES,
      finalized: [],
      seededInitialFinalized: false,
      loaded: false,

      loadFromDb: async () => {
        // Merge-laad + reconcile zodat lokaal-only data niet kwijtraakt.
        //  - DB-rij bestaat → DB wint (gedeelde waarheid)
        //  - alleen lokaal → behoud lokaal én push terug naar Supabase
        //  - geen van beide → INITIAL_ENTRIES default
        try {
          const rows = await fetchClosingEntries()
          const dbById = new Map(rows.map(r => [r.id, r]))
          const localEntries = get().entries
          const localOnly: ClosingEntry[] = []

          // Bepaal of een lokale entry "data" heeft (anders dan default).
          const hasLocalData = (e: ClosingEntry): boolean =>
            e.factuurvolume !== 0 || e.debiteuren !== 0 || e.ohwMutatie !== 0 ||
            e.kostencorrectie !== 0 || e.accruals !== 0 ||
            e.handmatigeCorrectie !== 0 || (e.remark ?? '') !== '' ||
            Object.keys(e.kostenOverrides ?? {}).length > 0 ||
            (typeof e.financieelResultaat === 'number') ||
            (typeof e.vennootschapsbelasting === 'number')

          // Bouw merged: DB wint, dan lokaal-only, dan defaults voor wat ontbreekt
          const seen = new Set<string>()
          const merged: ClosingEntry[] = []
          for (const r of rows) { merged.push(r); seen.add(r.id) }
          for (const le of localEntries) {
            if (seen.has(le.id)) continue
            seen.add(le.id)
            merged.push(le)
            if (hasLocalData(le)) localOnly.push(le)
          }
          const finalMerged = mergeWithInitialEntries(merged)
          console.info(`[useFinStore] DB=${rows.length}, local-only=${localOnly.length}, total=${finalMerged.length}`)
          set({ entries: finalMerged, loaded: true })

          // Seed-revisies (P08) die op DB-rijen zijn toegepast ook terugpushen,
          // zodat alle clients dezelfde gecorrigeerde maart/april-waarden zien.
          const revised = finalMerged.filter(e => {
            const before = merged.find(m => m.id === e.id)
            return before && (before.factuurvolume !== e.factuurvolume || before.ohwMutatie !== e.ohwMutatie)
          })
          if (revised.length > 0) {
            console.info(`[useFinStore] seed-revisies pushen: ${revised.map(e => e.id).join(', ')}`)
            await upsertAllClosingEntries(revised)
          }

          // Reconcile: lokaal-only entries pushen naar Supabase
          if (localOnly.length > 0) {
            console.info(`[useFinStore] reconcile: pushing ${localOnly.length} local-only entries`)
            await upsertAllClosingEntries(localOnly)
          }

          // Eerste keer ooit (alles leeg) → seed defaults
          if (rows.length === 0 && localOnly.length === 0) {
            await upsertAllClosingEntries(INITIAL_ENTRIES)
          } else if (finalMerged.length > rows.length + localOnly.length) {
            // Nieuwe BV/maanden in code → push die ook
            const known = new Set([...rows.map(r => r.id), ...localOnly.map(e => e.id)])
            const newOnes = finalMerged.filter(e => !known.has(e.id))
            if (newOnes.length > 0) await upsertAllClosingEntries(newOnes)
          }
          void dbById  // typescript-tevreden, anders 'never used'

          // Laad ook de finalized-status van Maandafsluitingen.
          try {
            const dbFinalized = await fetchFinalizedMonths()
            const localFinalized = get().finalized
            // Defensieve merge: DB wint per-maand, maar lokale records die
            // (nog) niet in de DB-respons staan blijven bewaard. Dit voorkomt
            // dat een silent-empty read (RLS verkeerd geconfigureerd, of
            // realtime-event arriveert vóór commit-zichtbaarheid) een net
            // optimistisch ge-finaliseerde maand wegpoetst. Cross-client
            // unfinalize blijft werken: de DELETE-realtime triggert pas een
            // refetch nadat de DELETE in DB zichtbaar is, en in die respons
            // staat de unfinalized maand niet meer — maar omdat de andere
            // client de unfinalize zelf niet lokaal heeft gedaan, blijft de
            // record in lokaal zichtbaar. Dat is de geaccepteerde trade-off:
            // gebruiker kan handmatig refreshen bij cross-device gebruik.
            const dbMonths = new Set(dbFinalized.map(f => f.month))
            const merged: FinalizedMonth[] = [
              ...dbFinalized,
              ...localFinalized.filter(f => !dbMonths.has(f.month)),
            ]
            set({ finalized: merged })
          } catch (e) {
            console.warn('[useFinStore] fetchFinalizedMonths failed:', e)
          }
        } catch (err) {
          console.error('[useFinStore] Supabase load failed:', err)
          set({ loaded: true })
        }
      },

      updateEntry: (id, patch) => {
        set(s => ({
          entries: s.entries.map(e => e.id === id ? { ...e, ...patch } : e),
        }))
        const entry = get().entries.find(e => e.id === id)
        if (entry) upsertClosingEntry(entry)
      },

      getEntry: (bv, month) =>
        get().entries.find(e => e.bv === bv && e.month === month),

      getMonthEntries: (month) =>
        get().entries.filter(e => e.month === month),

      ensureEntry: (bv, month) => {
        const existing = get().entries.find(e => e.bv === bv && e.month === month)
        if (existing) return existing
        // Fallback op een INITIAL_ENTRIES-template voor (bv, month) of
        // anders een minimale lege entry.
        const template = INITIAL_ENTRIES.find(e => e.bv === bv && e.month === month)
        const fresh: ClosingEntry = template
          ? { ...template, kostenOverrides: { ...(template.kostenOverrides ?? {}) } }
          : {
              id: `${bv[0].toLowerCase()}-${month.replace('-', '').toLowerCase()}`,
              bv, month,
              factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
              kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
              operationeleKosten: 0, amortisatieAfschrijvingen: 0,
              kostenOverrides: {}, remark: '',
            }
        set(s => ({ entries: [...s.entries, fresh] }))
        upsertClosingEntry(fresh)
        return fresh
      },

      isMonthFinalized: (month) =>
        get().finalized.some(f => f.month === month),

      getFinalized: (month) =>
        get().finalized.find(f => f.month === month),

      finalizeMonth: async (month, by, checklist, leSnapshot) => {
        const record: FinalizedMonth = {
          month,
          finalizedAt: new Date().toISOString(),
          finalizedBy: by,
          checklist: { ...checklist },
          leSnapshot: leSnapshot ? { ...leSnapshot } : undefined,
        }
        // Optimistic update — wordt door persist-middleware lokaal bewaard,
        // dus blijft staan over page-reloads heen ook als de DB-sync faalt.
        set(s => ({
          finalized: [...s.finalized.filter(f => f.month !== month), record],
        }))
        const r = await upsertFinalizedMonth(record)
        if (r.error) {
          // GEEN rollback: de optimistische state is lokaal gepersisteerd
          // (zustand persist) en de gebruiker mag de Maandafsluiting blijven
          // gebruiken ook als de Supabase-tabel ontbreekt of RLS verkeerd
          // staat. Cross-device sync vraagt om correct DB-schema; in lokale
          // degraded mode persisteert de finalisatie via localStorage.
          console.warn(`[useFinStore] DB-sync van finalizeMonth(${month}) faalde: ${r.error}. State blijft lokaal bewaard.`)
        }
      },

      unfinalizeMonth: async (month) => {
        // Zelfde ratio als finalizeMonth: geen rollback bij DB-fout. Lokaal
        // is de unfinalize altijd toegepast; cross-device hoort dat via een
        // werkende DB-laag te lopen, maar de UI moet niet vastlopen als de
        // DB even niet meewerkt.
        set(s => ({ finalized: s.finalized.filter(f => f.month !== month) }))
        const r = await deleteFinalizedMonth(month)
        if (r.error) {
          console.warn(`[useFinStore] DB-sync van unfinalizeMonth(${month}) faalde: ${r.error}. State blijft lokaal bewaard.`)
        }
      },
    }),
    {
      name: 'tpg-closing-entries',
      // Entries, finalized én seed-flag lokaal persisten; `loaded` blijft false bij reload
      partialize: (state) => ({
        entries: state.entries,
        finalized: state.finalized,
        seededInitialFinalized: state.seededInitialFinalized,
      }) as unknown as FinStore,
      // Bij rehydratie:
      //   1. Merge ontbrekende default-entries (Holdings-migratie etc.).
      //   2. Eénmalige seed: Jan-26 / Feb-26 als auto-finalized markeren als
      //      ze hardgecodeerde actuals hebben en nog niet in finalized staan.
      //      Reden: in het strikte model telt alleen finalized als 'actual';
      //      zonder seed zouden Q1-actuals opeens als forecast renderen voor
      //      bestaande gebruikers. Sentinel voorkomt re-seed na unfinalize.
      onRehydrateStorage: () => (state) => {
        if (!state) return
        if (Array.isArray(state.entries)) {
          state.entries = mergeWithInitialEntries(state.entries)
        }
        if (!state.seededInitialFinalized) {
          const seedTargets = ['Jan-26', 'Feb-26']
          const finalizedMonths = new Set((state.finalized ?? []).map(f => f.month))
          const toSeed: FinalizedMonth[] = []
          for (const m of seedTargets) {
            if (finalizedMonths.has(m)) continue
            const hasActuals = (state.entries ?? []).some(e =>
              e.month === m && (e.factuurvolume ?? 0) > 0
            )
            if (hasActuals) {
              toSeed.push({
                month: m,
                finalizedAt: new Date().toISOString(),
                finalizedBy: 'auto-seed (initial Q1 actuals)',
                checklist: {},
              })
            }
          }
          if (toSeed.length > 0) {
            state.finalized = [...(state.finalized ?? []), ...toSeed]
          }
          state.seededInitialFinalized = true
        }
      },
    },
  ),
)
