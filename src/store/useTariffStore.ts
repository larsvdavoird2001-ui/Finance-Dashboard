import { create } from 'zustand'
import type { TariffEntry } from '../data/types'
import { supabase, supabaseEnabled } from '../lib/supabase'
import initialData from '../data/tariffData.json'

interface TariffStore {
  entries: TariffEntry[]
  loaded: boolean
  loadFromDb: () => Promise<void>
  updateEntry: (id: string, patch: Partial<Omit<TariffEntry, 'id'>>) => void
  addEntry: (entry: TariffEntry) => void
  removeEntry: (id: string) => void
  getByEmployeeId: (employeeId: string) => TariffEntry | undefined
}

async function fetchTariffs(): Promise<TariffEntry[]> {
  if (!supabaseEnabled) return []
  const { data, error } = await supabase.from('tariff_entries').select('*')
  if (error) { console.error('fetchTariffs:', error); return [] }
  return (data ?? []).map(row => ({
    id: row.id,
    bedrijf: row.bedrijf ?? '',
    naam: row.naam ?? '',
    powerbiNaam: row.powerbi_naam ?? '',
    stroming: row.stroming ?? '',
    tarief: row.tarief ?? 0,
    fte: row.fte ?? null,
    functie: row.functie ?? '',
    leidingGevende: row.leiding_gevende ?? '',
    manager: row.manager ?? '',
    powerbiNaam2: row.powerbi_naam2 ?? '',
    team: row.team ?? '',
  }))
}

async function upsertTariff(entry: TariffEntry): Promise<void> {
  if (!supabaseEnabled) return
  const row = {
    id: entry.id,
    bedrijf: entry.bedrijf,
    naam: entry.naam,
    powerbi_naam: entry.powerbiNaam,
    stroming: entry.stroming,
    tarief: entry.tarief,
    fte: entry.fte,
    functie: entry.functie,
    leiding_gevende: entry.leidingGevende,
    manager: entry.manager,
    powerbi_naam2: entry.powerbiNaam2,
    team: entry.team,
  }
  const { error } = await supabase.from('tariff_entries').upsert(row, { onConflict: 'id' })
  if (error) console.error('upsertTariff:', error)
}

async function upsertAllTariffs(entries: TariffEntry[]): Promise<void> {
  if (!supabaseEnabled) return
  const rows = entries.map(e => ({
    id: e.id,
    bedrijf: e.bedrijf,
    naam: e.naam,
    powerbi_naam: e.powerbiNaam,
    stroming: e.stroming,
    tarief: e.tarief,
    fte: e.fte,
    functie: e.functie,
    leiding_gevende: e.leidingGevende,
    manager: e.manager,
    powerbi_naam2: e.powerbiNaam2,
    team: e.team,
  }))
  const { error } = await supabase.from('tariff_entries').upsert(rows, { onConflict: 'id' })
  if (error) console.error('upsertAllTariffs:', error)
}

async function deleteTariff(id: string): Promise<void> {
  if (!supabaseEnabled) return
  const { error } = await supabase.from('tariff_entries').delete().eq('id', id)
  if (error) console.error('deleteTariff:', error)
}

export const useTariffStore = create<TariffStore>((set, get) => ({
  entries: initialData as TariffEntry[],
  loaded: false,

  loadFromDb: async () => {
    const rows = await fetchTariffs()
    if (rows.length > 0) {
      set({ entries: rows, loaded: true })
    } else {
      // Seed initial data
      const seed = initialData as TariffEntry[]
      await upsertAllTariffs(seed)
      set({ loaded: true })
    }
  },

  updateEntry: (id, patch) => {
    set(s => ({
      entries: s.entries.map(e => e.id === id ? { ...e, ...patch } : e),
    }))
    const entry = get().entries.find(e => e.id === id)
    if (entry) upsertTariff(entry)
  },

  addEntry: (entry) => {
    set(s => ({ entries: [...s.entries, entry] }))
    upsertTariff(entry)
  },

  removeEntry: (id) => {
    set(s => ({ entries: s.entries.filter(e => e.id !== id) }))
    deleteTariff(id)
  },

  getByEmployeeId: (employeeId) =>
    get().entries.find(e => e.id === employeeId),
}))
