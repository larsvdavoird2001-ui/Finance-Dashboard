import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  remark: string
  hasRemark: boolean
  onSave: (remark: string) => void
  /** Tooltip-hint bij hover op het indicator-driehoekje */
  hint?: string
}

/** Excel-style cel-opmerking.
 *
 *  UX:
 *  - Zonder opmerking: er is niets zichtbaar in de cel. Hover op de cel →
 *    klein 💬 iconLP verschijnt rechtsboven. Klik = popover open.
 *  - Met opmerking: oranje driehoekje rechtsboven (Excel-conventie). Hover
 *    toont de opmerking als tooltip. Klik = popover open voor bewerken.
 *
 *  De popover rendert via React-portal op document.body om boven sticky-
 *  headers uit te komen, en positioneert zichzelf vlak onder/rechts van de
 *  trigger via getBoundingClientRect.
 */
export function CellCommentPopover({ remark, hasRemark, onSave, hint }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(remark)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Reset draft wanneer remark van buitenaf wijzigt
  useEffect(() => { setDraft(remark) }, [remark])

  // Bereken positie bij openen
  useEffect(() => {
    if (!open) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 260
    const left = Math.min(rect.right + 4, window.innerWidth - width - 12)
    const top = rect.bottom + 4
    setPos({ top, left })
  }, [open])

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return
      if (triggerRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const commit = () => {
    if (draft !== remark) onSave(draft.trim())
    setOpen(false)
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        title={hasRemark ? (hint ?? remark) : (hint ?? 'Opmerking toevoegen')}
        className={`cell-comment-trigger${hasRemark ? ' has-remark' : ''}`}
        style={{
          position: 'absolute', top: 0, right: 0,
          width: 14, height: 14,
          padding: 0, margin: 0,
          background: 'transparent', border: 'none', cursor: 'pointer',
          zIndex: 2,
        }}
      >
        {hasRemark ? (
          // Excel-style oranje corner triangle
          <span style={{
            position: 'absolute', top: 0, right: 0,
            width: 0, height: 0,
            borderTop: '7px solid var(--amber, #f5a623)',
            borderLeft: '7px solid transparent',
            pointerEvents: 'none',
          }} />
        ) : (
          // Discrete 💬 iconLP bij hover
          <span style={{
            position: 'absolute', top: -1, right: 0,
            fontSize: 10, lineHeight: 1, color: 'var(--t3)',
            pointerEvents: 'none',
          }}>💬</span>
        )}
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          style={{
            position: 'fixed',
            top: pos.top, left: pos.left,
            width: 260,
            background: 'var(--bg2)',
            border: '1px solid var(--amber, #f5a623)',
            borderRadius: 7,
            padding: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 10000,
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--amber, #f5a623)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
            📝 Opmerking
          </div>
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Typ een toelichting..."
            style={{
              width: '100%', minHeight: 80, resize: 'vertical',
              background: 'var(--bg3)', border: '1px solid var(--bd2)',
              borderRadius: 5, color: 'var(--t1)', fontSize: 11,
              padding: '6px 8px', outline: 'none',
              fontFamily: 'var(--font)',
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit() }
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginTop: 8 }}>
            <button
              onClick={() => { onSave(''); setOpen(false) }}
              disabled={!remark}
              style={{
                background: 'none', border: 'none',
                color: remark ? 'var(--red)' : 'var(--t3)',
                cursor: remark ? 'pointer' : 'not-allowed',
                fontSize: 11, padding: '4px 8px',
              }}
              title="Opmerking verwijderen"
            >
              ✕ Verwijder
            </button>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => { setDraft(remark); setOpen(false) }}
                style={{
                  background: 'var(--bg3)', border: '1px solid var(--bd2)',
                  borderRadius: 4, padding: '4px 10px', color: 'var(--t2)',
                  fontSize: 11, cursor: 'pointer',
                }}
              >
                Annuleren
              </button>
              <button
                onClick={commit}
                style={{
                  background: 'var(--amber, #f5a623)', border: 'none',
                  borderRadius: 4, padding: '4px 10px', color: '#000',
                  fontSize: 11, fontWeight: 600, cursor: 'pointer',
                }}
              >
                ✓ Opslaan
              </button>
            </div>
          </div>
          <div style={{ marginTop: 4, fontSize: 9, color: 'var(--t3)' }}>
            Ctrl+Enter of Cmd+Enter om op te slaan · Esc om te sluiten
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

/** Wrapper helper — zorgt dat de cel-knop absolute-positioneerbaar is. */
export function CellCommentWrapper({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{ position: 'relative', width: '100%', height: '100%', ...style }}
      className="cell-comment-wrapper"
    >
      {children}
    </div>
  )
}
