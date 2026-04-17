import { memo, useState } from 'react'
import { fmt, gv, parseNL } from '../../lib/format'

interface Props {
  label: string
  dict: Record<string, number | null> | undefined
  months: string[]
  bold?: boolean
  colorize?: boolean
  highlight?: boolean
  badge?: string
  dimZero?: boolean
  isDelta?: boolean
  editable?: boolean
  onEdit?: (month: string, value: number) => void
  rowBg?: string
}

// Stable key (no value in key) + uncontrolled input → no DOM remount on blur
const EditCell = memo(function EditCell({ value, month, onEdit, bg }: { value: number; month: string; onEdit: (m: string, v: number) => void; bg: string }) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState('')
  return (
    <td style={{ padding: 2, textAlign: 'right', background: bg }}>
      <input
        className="ohw-inp"
        value={editing ? raw : value !== 0 ? fmt(value) : ''}
        placeholder="—"
        onFocus={() => { setEditing(true); setRaw(value !== 0 ? String(value) : '') }}
        onChange={e => setRaw(e.target.value)}
        onBlur={() => {
          setEditing(false)
          const v = parseNL(raw || '0')
          onEdit(month, isNaN(v) ? 0 : v)
        }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      />
    </td>
  )
})

export const MetricRow = memo(function MetricRow({ label, dict, months, bold, colorize, highlight, badge, dimZero, isDelta, editable, onEdit, rowBg }: Props) {
  const bg = highlight ? 'rgba(38,201,151,0.09)' : (rowBg ?? 'var(--bg2)')
  const fw = bold ? 700 : undefined

  return (
    <tr style={{ background: bg }}>
      <td style={{
        position: 'sticky', left: 0,
        background: bg,
        padding: '6px 12px',
        fontSize: 12, fontWeight: fw, zIndex: 2,
        boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.08)',
        whiteSpace: 'nowrap',
      }}>
        {label}
        {badge && <span style={{ fontSize: 9, marginLeft: 6, background: 'var(--green)', color: '#fff', padding: '1px 5px', borderRadius: 3 }}>{badge}</span>}
      </td>

      {months.map(m => {
        const v = gv(dict, m)
        if (editable && onEdit) {
          return <EditCell key={m} value={v} month={m} onEdit={onEdit} bg={bg} />
        }
        let color: string | undefined
        if (isDelta && dict?.[m] != null) {
          color = v < 0 ? 'var(--red)' : v > 0 ? 'var(--green)' : 'var(--t3)'
        } else if (colorize) {
          color = v < 0 ? 'var(--red)' : v > 0 ? 'var(--green)' : 'var(--t3)'
        } else if (dimZero && v === 0) {
          color = 'var(--t3)'
        }
        const display =
          dict?.[m] == null ? '—'
          : isDelta ? (v >= 0 ? '+' : '') + fmt(v)
          : (dimZero && v === 0) ? '—'
          : fmt(v)
        return (
          <td key={m} className="mono r" style={{ padding: '5px 8px', fontWeight: fw, color, background: bg }}>
            {display}
          </td>
        )
      })}
      <td style={{ background: bg }} />
    </tr>
  )
})
