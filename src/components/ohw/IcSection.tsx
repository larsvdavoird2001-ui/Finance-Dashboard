import { memo, useState, useCallback } from 'react'
import type { OhwRow } from '../../data/types'
import { fmt, parseNL, gv } from '../../lib/format'

function IcDescCell({ row, onSave }: { row: OhwRow; onSave: (desc: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const isTruncatable = (row.description?.length ?? 0) > 38
  return (
    <td style={{
      paddingLeft: 26, position: 'sticky', left: 0,
      background: 'var(--bg2)', zIndex: expanded ? 6 : 2,
      boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.08)',
    }}>
      <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
        <input
          key={row.id}
          className="ohw-inp"
          style={{
            width: expanded ? 520 : 260,
            textAlign: 'left',
            background: expanded ? 'var(--bg4)' : 'transparent',
            border: expanded ? '1px solid var(--blue)' : 'none',
            fontSize: 11,
            overflow: expanded ? 'visible' : 'hidden',
            textOverflow: expanded ? 'clip' : 'ellipsis',
            whiteSpace: 'nowrap',
            paddingRight: isTruncatable && !expanded ? 20 : 7,
            transition: 'width 0.18s ease, background 0.12s',
            boxShadow: expanded ? '0 4px 16px rgba(0,0,0,0.4)' : 'none',
            position: 'relative', zIndex: 2,
          }}
          defaultValue={row.description}
          placeholder="IC omschrijving..."
          title={row.description || undefined}
          onFocus={() => setExpanded(true)}
          onBlur={e => { setExpanded(false); onSave(e.target.value) }}
        />
        {isTruncatable && !expanded && (
          <span style={{
            position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)',
            fontSize: 11, color: 'var(--t3)', pointerEvents: 'none', zIndex: 3, lineHeight: 1,
          }}>›</span>
        )}
      </div>
    </td>
  )
}

interface Props {
  rows: OhwRow[]
  totaalIC: Record<string, number | null>
  months: string[]
  onChange: (rows: OhwRow[]) => void
}

export const IcSection = memo(function IcSection({ rows, totaalIC, months, onChange }: Props) {
  const [open, setOpen] = useState(false)

  const updateCell = useCallback((rowId: string, month: string, raw: string) => {
    const v = parseNL(raw)
    onChange(rows.map(r => r.id === rowId ? { ...r, values: { ...r.values, [month]: v } } : r))
  }, [rows, onChange])

  const updateDescription = useCallback((rowId: string, desc: string) => {
    onChange(rows.map(r => r.id === rowId ? { ...r, description: desc } : r))
  }, [rows, onChange])

  const addRow = useCallback(() => {
    onChange([...rows, { id: `ic-${Date.now()}`, description: '', values: {} }])
  }, [rows, onChange])

  const removeRow = useCallback((id: string) => {
    onChange(rows.filter(r => r.id !== id))
  }, [rows, onChange])

  const hdrBg = 'rgba(59,130,246,0.06)'

  return (
    <>
      {/* ── IC header — per-month totals always visible ─────────── */}
      <tr className="grp" style={{ background: hdrBg }} onClick={() => setOpen(o => !o)}>
        <td style={{
          position: 'sticky', left: 0, background: hdrBg,
          padding: '7px 12px', cursor: 'pointer',
          boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.06)',
          whiteSpace: 'nowrap',
        }}>
          <span style={{ fontSize: 9, width: 14, display: 'inline-block', transition: 'transform .2s', transform: open ? '' : 'rotate(-90deg)', marginRight: 4 }}>▼</span>
          <strong style={{ fontSize: 12 }}>IC Verrekening</strong>
        </td>
        {months.map(m => {
          const v = gv(totaalIC, m)
          return (
            <td key={m} className="mono r" style={{ padding: '6px 8px', background: hdrBg, fontWeight: 600, color: v < 0 ? 'var(--red)' : v > 0 ? 'var(--green)' : 'var(--t3)', fontSize: 12 }}>
              {v !== 0 ? fmt(v) : '—'}
            </td>
          )
        })}
        <td style={{ background: hdrBg, width: 40 }} />
      </tr>

      {open && rows.map(row => (
        <tr key={row.id} className="sub">
          <IcDescCell row={row} onSave={desc => updateDescription(row.id, desc)} />
          {months.map(m => {
            const v = gv(row.values, m)
            return (
              <td key={m} style={{ padding: 2, textAlign: 'right', background: 'var(--bg2)' }}>
                <input
                  key={`${row.id}-${m}`}
                  className="ohw-inp"
                  style={{ fontSize: 11, color: v < 0 ? 'var(--red)' : v > 0 ? 'var(--t1)' : 'var(--t3)' }}
                  defaultValue={v !== 0 ? fmt(v) : ''}
                  placeholder="—"
                  onBlur={e => updateCell(row.id, m, e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                />
              </td>
            )
          })}
          {/* ✕ helemaal rechts */}
          <td style={{ background: 'var(--bg2)', width: 40, textAlign: 'center' }}>
            <button className="btn sm ghost" style={{ color: 'var(--red)', padding: '2px 6px' }} onClick={() => removeRow(row.id)}>✕</button>
          </td>
        </tr>
      ))}

      {open && (
        <tr>
          <td
            colSpan={months.length + 2}
            style={{ background: 'var(--bg2)', padding: '4px 12px 4px 26px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
          >
            <button
              className="btn sm"
              style={{
                background: 'rgba(59,130,246,0.08)',
                border: '1px dashed var(--blue)',
                color: 'var(--blue)',
                fontSize: 11,
                padding: '3px 10px',
                width: '100%',
                justifyContent: 'center',
              }}
              onClick={addRow}
            >
              + IC-regel toevoegen
            </button>
          </td>
        </tr>
      )}
    </>
  )
})
