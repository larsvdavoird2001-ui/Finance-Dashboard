import { create } from 'zustand'

/** Algemene nav-target voor cross-tab deep-linking.
 *  - `tab: 'maand'`  → springen naar Maandafsluiting (sub-section via `section`)
 *  - `tab: 'ohw'`    → springen naar OHW Overzicht met optionele entity + rowId
 *                      zodat een specifieke rij in view komt en knippert.
 */
export interface NavTarget {
  tab: 'maand' | 'ohw'
  /** Voor tab='maand' */
  section?: 'import' | 'afsluiting' | 'tarieven' | 'fte' | 'export'
  /** Voor tab='maand' met section='import' (slot-highlight in importoverzicht) */
  month?: string
  slotId?: string
  /** Voor tab='ohw' — welk jaar en BV + welke rij gehighlight moet worden */
  year?: '2025' | '2026'
  entity?: 'Consultancy' | 'Projects' | 'Software'
  rowId?: string
}

interface NavStore {
  pending: NavTarget | null
  navigateTo: (target: NavTarget) => void
  consume: () => NavTarget | null
}

export const useNavStore = create<NavStore>((set, get) => ({
  pending: null,
  navigateTo: (target) => set({ pending: target }),
  consume: () => {
    const t = get().pending
    if (t) set({ pending: null })
    return t
  },
}))
