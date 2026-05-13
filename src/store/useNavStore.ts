import { create } from 'zustand'

/** Algemene nav-target voor cross-tab deep-linking.
 *  - `tab: 'maand'`     → springen naar Maandafsluiting (sub-section via `section`)
 *  - `tab: 'ohw'`       → springen naar OHW Overzicht met optionele entity + rowId
 *                          zodat een specifieke rij in view komt en knippert.
 *  - `tab: 'budget'`    → springen naar Budget vs Actuals; met `reviewMonth`
 *                          opent direct de Maandreflectie-pane voor die maand.
 *  - `tab: 'dashboard'` → springen naar Executive Overview; met `reviewMonth`
 *                          opent direct de Maandafsluiting-review-pane.
 */
export interface NavTarget {
  tab: 'maand' | 'ohw' | 'budget' | 'dashboard'
  /** Voor tab='maand' */
  section?: 'import' | 'afsluiting' | 'tarieven' | 'fte' | 'export' | 'ic_facturatie'
  /** Voor tab='maand' met section='import' (slot-highlight in importoverzicht) */
  month?: string
  slotId?: string
  /** Voor tab='ohw' — welk jaar en BV + welke rij gehighlight moet worden */
  year?: '2025' | '2026'
  entity?: 'Consultancy' | 'Projects' | 'Software'
  rowId?: string
  /** Voor tab='budget' / tab='dashboard' — open direct de review-pane van een
   *  zojuist afgesloten maand (LE-leerlus / actuals + LE-prognose voor de
   *  maand erna). Gebruikt o.a. door MaandChecklist na finalize. */
  reviewMonth?: string
  /** Optioneel DOM-id om naar te scrollen na het schakelen van de tab/section.
   *  Gebruikt door MaandChecklist om gericht binnen de Maandafsluiting-sectie
   *  naar bv. de kostenposten-tabel of een specifieke OHW-rubriek te springen. */
  anchor?: string
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
