import { useEffect } from 'react'
import { supabase, supabaseEnabled } from '../lib/supabase'
import { useFinStore } from '../store/useFinStore'
import { useFteStore } from '../store/useFteStore'
import { useImportStore } from '../store/useImportStore'
import { useRawDataStore } from '../store/useRawDataStore'
import { useOhwStore } from '../store/useOhwStore'
import { useTariffStore } from '../store/useTariffStore'
import { useEvidenceStore } from '../store/useEvidenceStore'
import { useBudgetStore } from '../store/useBudgetStore'
import { useHoursStore } from '../store/useHoursStore'
import { useHoursWeekStore } from '../store/useHoursWeekStore'
import { useCostBreakdownStore } from '../store/useCostBreakdownStore'
import { useReflectionStore } from '../store/useReflectionStore'
import { useInternalHoursStore } from '../store/useInternalHoursStore'

/** Live sync — zorgt dat iedere ingelogde gebruiker altijd de laatste data
 *  ziet. Drie elkaar aanvullende mechanismen:
 *
 *   1. Supabase Realtime — pusht een wijziging direct (0s) naar alle clients.
 *      Werkt alleen als de tabellen onder de `supabase_realtime` publication
 *      staan (zie het Realtime-blok onderin supabase/schema.sql).
 *   2. Refetch bij tab-/venster-focus — wie de app (opnieuw) opent of
 *      terugkeert naar het tabblad krijgt meteen verse data.
 *   3. Poll elke 30s zolang het tabblad zichtbaar is — veiligheidsnet voor
 *      als Realtime niet (correct) is geconfigureerd of de websocket wegvalt.
 *
 *  Mechanisme 2 en 3 verversen alleen de "core"-stores (maandafsluiting,
 *  OHW, budget, FTE, imports, tarieven). De zware stores (ruwe importdata en
 *  bijlage-bestanden) blijven daarbuiten — die worden via Realtime alsnog
 *  per-tabel ververst zodra ze écht wijzigen. */
export function useRealtimeSync(enabled: boolean) {
  const loadFin      = useFinStore(s => s.loadFromDb)
  const loadFte      = useFteStore(s => s.loadFromDb)
  const loadImport   = useImportStore(s => s.loadFromDb)
  const loadRaw      = useRawDataStore(s => s.loadFromDb)
  const loadOhw      = useOhwStore(s => s.loadFromDb)
  const loadTariff   = useTariffStore(s => s.loadFromDb)
  const loadEvidence = useEvidenceStore(s => s.loadFromDb)
  const loadBudget   = useBudgetStore(s => s.loadFromDb)
  const loadHours          = useHoursStore(s => s.loadFromDb)
  const loadHoursWeek      = useHoursWeekStore(s => s.loadFromDb)
  const loadCostBreakdown  = useCostBreakdownStore(s => s.loadFromDb)
  const loadReflection     = useReflectionStore(s => s.loadFromDb)
  const loadInternalHours  = useInternalHoursStore(s => s.loadFromDb)

  useEffect(() => {
    if (!supabaseEnabled || !enabled) return

    // Debounced re-fetch — voorkomt 100 fetches bij een batch updates.
    const debouncers = new Map<string, ReturnType<typeof setTimeout>>()
    const debouncedRefetch = (key: string, fn: () => Promise<void>, ms = 400) => {
      const prev = debouncers.get(key)
      if (prev) clearTimeout(prev)
      debouncers.set(key, setTimeout(() => {
        debouncers.delete(key)
        fn().catch(e => console.warn(`[livesync] refetch ${key} failed:`, e))
      }, ms))
    }

    // Core-stores die bij focus + poll worden ververst. Ruwe importdata
    // (`raw`) en bijlagen (`evidence`) zitten hier bewust niet in — die zijn
    // zwaar en worden uitsluitend via Realtime ververst wanneer ze wijzigen.
    const refetchCore = () => {
      debouncedRefetch('fin', loadFin)
      debouncedRefetch('fte', loadFte)
      debouncedRefetch('imp', loadImport)
      debouncedRefetch('ohw', loadOhw)
      debouncedRefetch('tariff', loadTariff)
      debouncedRefetch('budget', loadBudget)
      debouncedRefetch('hours', loadHours)
      debouncedRefetch('hoursWeek', loadHoursWeek)
      debouncedRefetch('costBreakdown', loadCostBreakdown)
      debouncedRefetch('reflection', loadReflection)
      debouncedRefetch('internalHours', loadInternalHours)
    }

    // ── 1. Supabase Realtime — directe push per gewijzigde tabel ──
    const ch = supabase
      .channel('tpg-finance-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'closing_entries'  }, () => debouncedRefetch('fin', loadFin))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'closing_finalized' }, () => debouncedRefetch('fin', loadFin))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fte_entries'      }, () => debouncedRefetch('fte', loadFte))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'import_records'   }, () => debouncedRefetch('imp', loadImport))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'import_raw_data'  }, () => debouncedRefetch('raw', loadRaw))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ohw_entities'     }, () => debouncedRefetch('ohw', loadOhw))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tariff_entries'   }, () => debouncedRefetch('tariff', loadTariff))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ohw_evidence'     }, () => debouncedRefetch('evidence', loadEvidence))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_overrides' }, () => debouncedRefetch('budget', loadBudget))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hours_entries' }, () => debouncedRefetch('hours', loadHours))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hours_week_entries' }, () => debouncedRefetch('hoursWeek', loadHoursWeek))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cost_breakdowns' }, () => debouncedRefetch('costBreakdown', loadCostBreakdown))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'closing_reflections' }, () => debouncedRefetch('reflection', loadReflection))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'internal_hours' }, () => debouncedRefetch('internalHours', loadInternalHours))
      .subscribe(status => {
        if (status === 'SUBSCRIBED') console.info('[livesync] Realtime verbonden')
      })

    // ── 2. Refetch bij terugkeer naar de tab / het venster ──
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetchCore()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', refetchCore)

    // ── 3. Poll als veiligheidsnet — alleen wanneer de tab zichtbaar is ──
    const POLL_MS = 30_000
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') refetchCore()
    }, POLL_MS)

    return () => {
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', refetchCore)
      for (const t of debouncers.values()) clearTimeout(t)
      supabase.removeChannel(ch)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
}
