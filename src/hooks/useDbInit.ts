import { useEffect, useState } from 'react'
import { useFinStore } from '../store/useFinStore'
import { useFteStore } from '../store/useFteStore'
import { useImportStore } from '../store/useImportStore'
import { useRawDataStore } from '../store/useRawDataStore'
import { useOhwStore } from '../store/useOhwStore'
import { useTariffStore } from '../store/useTariffStore'
import { useEvidenceStore } from '../store/useEvidenceStore'
import { useBudgetStore } from '../store/useBudgetStore'

/** Laad alle stores vanuit Supabase bij app start.
 *  Retourneert { ready, error } — toon een loader tot ready=true. */
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

    async function init() {
      try {
        // Laad alle stores parallel
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
        if (!cancelled) setReady(true)
      } catch (err) {
        console.error('Database init failed:', err)
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          // Toch ready maken zodat de app werkt met lokale defaults
          setReady(true)
        }
      }
    }

    init()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { ready, error }
}
