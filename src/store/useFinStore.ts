import { create } from 'zustand'
import type { ClosingEntry, BvId } from '../data/types'

// Initial closing data sourced from P02.2026 Maandrapportage actuals
const INITIAL_ENTRIES: ClosingEntry[] = [
  // ── January 2026 ─────────────────────────────────────────────────────────
  {
    id: 'c-jan26', bv: 'Consultancy', month: 'Jan-26',
    factuurvolume: 719770, debiteuren: 0, ohwMutatie: 217688,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {}, remark: '',
  },
  {
    id: 'p-jan26', bv: 'Projects', month: 'Jan-26',
    factuurvolume: 364790, debiteuren: 0, ohwMutatie: 180298,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {}, remark: '',
  },
  {
    id: 's-jan26', bv: 'Software', month: 'Jan-26',
    factuurvolume: 493761, debiteuren: 0, ohwMutatie: -35002,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {}, remark: '',
  },
  // ── February 2026 ────────────────────────────────────────────────────────
  {
    id: 'c-feb26', bv: 'Consultancy', month: 'Feb-26',
    factuurvolume: 797454, debiteuren: 0, ohwMutatie: 205300,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {}, remark: '',
  },
  {
    id: 'p-feb26', bv: 'Projects', month: 'Feb-26',
    factuurvolume: 418811, debiteuren: 0, ohwMutatie: 107890,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {}, remark: '',
  },
  {
    id: 's-feb26', bv: 'Software', month: 'Feb-26',
    factuurvolume: 261030, debiteuren: 0, ohwMutatie: -7000,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {}, remark: '',
  },
  // ── March 2026 (open / empty template) ───────────────────────────────────
  {
    id: 'c-mar26', bv: 'Consultancy', month: 'Mar-26',
    factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {}, remark: '',
  },
  {
    id: 'p-mar26', bv: 'Projects', month: 'Mar-26',
    factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {}, remark: '',
  },
  {
    id: 's-mar26', bv: 'Software', month: 'Mar-26',
    factuurvolume: 0, debiteuren: 0, ohwMutatie: 0,
    kostencorrectie: 0, accruals: 0, handmatigeCorrectie: 0,
    operationeleKosten: 0, amortisatieAfschrijvingen: 0, kostenOverrides: {}, remark: '',
  },
]

interface FinStore {
  entries: ClosingEntry[]
  updateEntry: (id: string, patch: Partial<Omit<ClosingEntry, 'id'>>) => void
  getEntry: (bv: BvId, month: string) => ClosingEntry | undefined
  getMonthEntries: (month: string) => ClosingEntry[]
}

export const useFinStore = create<FinStore>((set, get) => ({
  entries: INITIAL_ENTRIES,

  updateEntry: (id, patch) =>
    set(s => ({
      entries: s.entries.map(e => e.id === id ? { ...e, ...patch } : e),
    })),

  getEntry: (bv, month) =>
    get().entries.find(e => e.bv === bv && e.month === month),

  getMonthEntries: (month) =>
    get().entries.filter(e => e.month === month),
}))

export const CLOSING_MONTHS = ['Jan-26', 'Feb-26', 'Mar-26']
