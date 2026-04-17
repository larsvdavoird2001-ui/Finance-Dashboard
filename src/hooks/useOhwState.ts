import { useOhwStore } from '../store/useOhwStore'

/** Thin wrapper kept for backwards-compat; delegates to useOhwStore. */
export function useOhwState() {
  const data2025    = useOhwStore(s => s.data2025)
  const data2026    = useOhwStore(s => s.data2026)
  const updateEntity = useOhwStore(s => s.updateEntity)
  return { data2025, data2026, updateEntity }
}
