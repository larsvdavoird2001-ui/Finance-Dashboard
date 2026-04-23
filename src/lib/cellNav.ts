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
