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

/** Subscribe op alle relevante tabellen via Supabase Realtime.
 *  Bij elke mutatie van een ander device (bv. admin past iets aan terwijl
 *  een gebruiker meekijkt) re-fetchen we de bijbehorende store.
 *
 *  Werkt alleen als de tabellen onder Realtime publication staan in
 *  Supabase (Database → Replication → enable voor de relevante tabellen). */
export function useRealtimeSync(enabled: boolean) {
  const loadFin      = useFinStore(s => s.loadFromDb)
  const loadFte      = useFteStore(s => s.loadFromDb)
  const loadImport   = useImportStore(s => s.loadFromDb)
  const loadRaw      = useRawDataStore(s => s.loadFromDb)
  const loadOhw      = useOhwStore(s => s.loadFromDb)
  const loadTariff   = useTariffStore(s => s.loadFromDb)
  const loadEvidence = useEvidenceStore(s => s.loadFromDb)
  const loadBudget   = useBudgetStore(s => s.loadFromDb)

  useEffect(() => {
    if (!supabaseEnabled || !enabled) return

    // Helper om debounced re-fetch te doen — voorkomt 100 fetches als er
    // een batch updates voorbij komt.
    const debouncers = new Map<string, ReturnType<typeof setTimeout>>()
    const debouncedRefetch = (key: string, fn: () => Promise<void>, ms = 400) => {
      const prev = debouncers.get(key)
      if (prev) clearTimeout(prev)
      debouncers.set(key, setTimeout(() => {
        debouncers.delete(key)
        fn().catch(e => console.warn(`[realtime] refetch ${key} failed:`, e))
      }, ms))
    }

    // Eén kanaal per store-tabel. We kijken naar alle events (INSERT/UPDATE/
    // DELETE) en re-fetchen het hele store-bestand. Dat is iets duurder dan
    // incrementele updates maar veel simpeler en altijd consistent.
    const ch = supabase
      .channel('tpg-finance-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'closing_entries'  }, () => debouncedRefetch('fin', loadFin))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fte_entries'      }, () => debouncedRefetch('fte', loadFte))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'import_records'   }, () => debouncedRefetch('imp', loadImport))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'import_raw_data'  }, () => debouncedRefetch('raw', loadRaw))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ohw_entities'     }, () => debouncedRefetch('ohw', loadOhw))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tariff_entries'   }, () => debouncedRefetch('tariff', loadTariff))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ohw_evidence'     }, () => debouncedRefetch('evidence', loadEvidence))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_overrides' }, () => debouncedRefetch('budget', loadBudget))
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          console.info('[realtime] verbonden — live sync actief')
        }
      })

    return () => {
      for (const t of debouncers.values()) clearTimeout(t)
      supabase.removeChannel(ch)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
}
