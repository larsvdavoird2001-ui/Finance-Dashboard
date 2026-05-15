/** Focus de volgende input in dezelfde kolom (Enter = omlaag). Inputs
 *  moeten data-nav-col en data-nav-row attributes hebben. */
export function focusNextInColumn(current: HTMLInputElement) {
  const col = current.dataset.navCol
  const row = current.dataset.navRow
  if (!col || !row) return
  const all = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-nav-col]'))
  const idx = all.indexOf(current)
  for (let i = idx + 1; i < all.length; i++) {
    if (all[i].dataset.navCol === col && all[i].dataset.navRow !== row) {
      all[i].focus()
      all[i].select?.()
      return
    }
  }
}

/** Focus de volgende (of vorige) input in dezelfde rij (Tab = naar rechts,
 *  Shift+Tab = naar links). Returnt true als er gefocust is, anders false
 *  (zodat de caller default browser-tab-gedrag kan laten doorgaan). */
export function focusNextInRow(current: HTMLInputElement, reverse = false): boolean {
  const row = current.dataset.navRow
  const col = current.dataset.navCol
  if (!row) return false
  const all = Array.from(document.querySelectorAll<HTMLInputElement>('input[data-nav-row]'))
  const idx = all.indexOf(current)
  if (idx < 0) return false
  const step = reverse ? -1 : 1
  for (let i = idx + step; i >= 0 && i < all.length; i += step) {
    if (all[i].dataset.navRow === row && all[i].dataset.navCol !== col) {
      all[i].focus()
      all[i].select?.()
      return true
    }
  }
  return false
}
