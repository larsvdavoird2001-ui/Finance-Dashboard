import { memo, useState } from 'react'
import { fmt, parseNL } from '../../lib/format'
import { focusNextInColumn } from '../../lib/cellNav'

interface Props {
  value: number
  onCommit: (v: number) => void
  /** Inline style override (bv. kleur voor IC-rij). */
  style?: React.CSSProperties
  /** Row-id voor Enter-nav (omlaag in dezelfde kolom). */
  navRow?: string
  /** Kolom-id voor Enter-nav (meestal de maand, bv. 'Mar-26'). */
  navCol?: string
  /** Tooltip bij hover (bv. bij IC-pair spiegeling). */
  title?: string
  /** Read-only: input wordt disabled en accepteert geen edits. Gebruikt voor
   *  IC-rijen die uit de IC facturatie-upload komen — de waarden zijn de
   *  bron-van-waarheid, gebruiker moet het bestand opnieuw uploaden. */
  readOnly?: boolean
}

/** Generieke cel-input voor de OHW Overzicht (en IC Sectie, Vooruit-
 *  gefactureerd). Toont:
 *   - display-modus: '€ 1.234' (of '−€ 1.234' bij negatief) via `fmt()`,
 *     '€ 0' placeholder wanneer leeg.
 *   - edit-modus: ruwe invoer zoals getypt, zodat user niet door '€'
 *     heen hoeft te tikken. Tekst wordt auto-geselecteerd bij focus.
 *  Keyboard:
 *   - Enter: commit + spring naar de volgende input in dezelfde kolom
 *   - Tab: default browser (rechts).
 */
export const OhwCellInput = memo(function OhwCellInput({ value, onCommit, style, navRow, navCol, title, readOnly }: Props) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState('')
  const display = editing && !readOnly ? raw : (value !== 0 ? fmt(value) : '')

  const commit = () => {
    setEditing(false)
    if (readOnly) return
    const parsed = parseNL(raw || '0')
    if (!isFinite(parsed)) return
    if (parsed !== value) onCommit(parsed)
  }

  return (
    <input
      className="ohw-inp"
      style={readOnly
        ? { ...style, cursor: 'not-allowed', opacity: 0.85 }
        : style}
      value={display}
      placeholder={readOnly ? '' : '€ 0'}
      title={title}
      readOnly={readOnly}
      data-nav-col={readOnly ? undefined : navCol}
      data-nav-row={readOnly ? undefined : navRow}
      onFocus={(e) => {
        if (readOnly) { e.target.blur(); return }
        setEditing(true)
        setRaw(value !== 0 ? String(value) : '')
        setTimeout(() => e.target.select(), 0)
      }}
      onChange={e => { if (!readOnly) setRaw(e.target.value) }}
      onBlur={commit}
      onKeyDown={e => {
        if (readOnly) return
        if (e.key === 'Enter') {
          e.preventDefault()
          const target = e.currentTarget
          target.blur()
          setTimeout(() => focusNextInColumn(target), 0)
        }
      }}
    />
  )
})
