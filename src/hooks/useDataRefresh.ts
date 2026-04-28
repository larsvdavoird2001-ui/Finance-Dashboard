import { useCallback } from 'react'
import { useFinStore } from '../store/useFinStore'
import { useFteStore } from '../store/useFteStore'
import { useImportStore } from '../store/useImportStore'
import { useRawDataStore } from '../store/useRawDataStore'
import { useOhwStore } from '../store/useOhwStore'
import { useTariffStore } from '../store/useTariffStore'
import { useEvidenceStore } from '../store/useEvidenceStore'
import { useBudgetStore } from '../store/useBudgetStore'

/** Geeft één functie terug die alle data-stores opnieuw uit Supabase laadt.
 *  Bedoeld voor:
 *   - na een succesvolle login (verse user die misschien stale localStorage
 *     heeft van een vorige sessie / ander account)
 *   - via een handmatige "Herlaad data" knop
 *   - als fallback wanneer realtime events binnenkomen */
export function useDataRefresh() {
  const loadFin      = useFinStore(s => s.loadFromDb)
  const loadFte      = useFteStore(s => s.loadFromDb)
  const loadImport   = useImportStore(s => s.loadFromDb)
  const loadRaw      = useRawDataStore(s => s.loadFromDb)
  const loadOhw      = useOhwStore(s => s.loadFromDb)
  const loadTariff   = useTariffStore(s => s.loadFromDb)
  const loadEvidence = useEvidenceStore(s => s.loadFromDb)
  const loadBudget   = useBudgetStore(s => s.loadFromDb)

  return useCallback(async () => {
    await Promise.all([
      loadFin().catch(e => console.warn('[refresh] fin:', e)),
      loadFte().catch(e => console.warn('[refresh] fte:', e)),
      loadImport().catch(e => console.warn('[refresh] import:', e)),
      loadRaw().catch(e => console.warn('[refresh] raw:', e)),
      loadOhw().catch(e => console.warn('[refresh] ohw:', e)),
      loadTariff().catch(e => console.warn('[refresh] tariff:', e)),
      loadEvidence().catch(e => console.warn('[refresh] evidence:', e)),
      loadBudget().catch(e => console.warn('[refresh] budget:', e)),
    ])
  }, [loadFin, loadFte, loadImport, loadRaw, loadOhw, loadTariff, loadEvidence, loadBudget])
}
