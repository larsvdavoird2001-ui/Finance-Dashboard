import { useEffect, useState } from 'react'
import { useFinStore } from '../store/useFinStore'
import { useFteStore } from '../store/useFteStore'
import { useImportStore } from '../store/useImportStore'
import { useRawDataStore } from '../store/useRawDataStore'
import { useOhwStore } from '../store/useOhwStore'
import { useTariffStore } from '../store/useTariffStore'
import { useEvidenceStore } from '../store/useEvidenceStore'
import { useBudgetStore } from '../store/useBudgetStore'

/** Maximale wachttijd voor de db-init voordat we de UI sowieso vrijgeven.
 *  Voorkomt dat een hangende Supabase-call de hele app onbruikbaar maakt. */
const DB_INIT_TIMEOUT_MS = 4000

/** Laad alle stores vanuit Supabase bij app start.
 *  Retourneert { ready, error } — toon een loader tot ready=true.
 *
 *  Belangrijk: ook bij fouten of timeout zetten we ready=true zodat de app
 *  altijd renderbaar wordt. Stores blijven dan op hun (gepersisteerde of
 *  default) waarden staan en zullen automatisch updaten zodra de queries
 *  later alsnog terugkomen. */
export function useDbInit() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadFin = useFinStore(s => s.loadFromDb)
  const loadFte = useFteStore(s => s.loadFromDb)
  const loadImport = useImportStore(s => s.loadFromDb)
  const loadRaw = useRawDataStore(s => s.loadFromDb)
  const loadOhw = useOhwStore(s => s.loadFromDb)
  const loadTariff = useTariffStore(s => s.loadFromDb)
  const loadEvidence = useEvidenceStore(s => s.loadFromDb)
  const loadBudget = useBudgetStore(s => s.loadFromDb)

  useEffect(() => {
    let cancelled = false
    let didFinish = false

    // Race tegen een timeout: na 4s laten we de UI sowieso door, ook als
    // sommige stores nog niet klaar zijn met laden.
    const timeoutId = setTimeout(() => {
      if (!cancelled && !didFinish) {
        console.warn(`[useDbInit] timeout na ${DB_INIT_TIMEOUT_MS}ms — UI vrijgeven, stores updaten in achtergrond`)
        setReady(true)
      }
    }, DB_INIT_TIMEOUT_MS)

    async function init() {
      try {
        // Laad alle stores parallel. Elke store vangt zijn eigen errors af in
        // db.ts (geeft [] terug bij fouten), dus Promise.all faalt zelden.
        await Promise.all([
          loadFin(),
          loadFte(),
          loadImport(),
          loadRaw(),
          loadOhw(),
          loadTariff(),
          loadEvidence(),
          loadBudget(),
        ])
        didFinish = true
        if (!cancelled) setReady(true)
      } catch (err) {
        console.error('[useDbInit] init failed:', err)
        didFinish = true
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setReady(true)
        }
      }
    }

    init()
    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { ready, error }
}
