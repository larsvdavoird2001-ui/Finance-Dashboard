import { memo, useState, useCallback } from 'react'
import type { OhwRow } from '../../data/types'
import { fmt, parseNL, gv } from '../../lib/format'
import { useOhwStore } from '../../store/useOhwStore'

type BvName = 'Consultancy' | 'Projects' | 'Software'
const BVS: BvName[] = ['Consultancy', 'Projects', 'Software']
const BV_COLORS: Record<BvName, string> = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
}

function BvTag({ bv, dim }: { bv: BvName; dim?: boolean }) {
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 9, fontWeight: 700,
      padding: '1px 6px',
      borderRadius: 3,
      background: `${BV_COLORS[bv]}${dim ? '15' : '22'}`,
      color: BV_COLORS[bv],
      border: `1px solid ${BV_COLORS[bv]}44`,
      whiteSpace: 'nowrap',
      lineHeight: 1.4,
    }}>{bv}</span>
  )
}

/** Header-cel voor een IC-rij: badge "Van BV → Naar BV" (indien pair),
 *  daarnaast een inline-bewerkbaar omschrijving-veld. */
function IcDescCell({
  row,
  currentBv,
  onDescriptionSave,
  leftOffset = 0,
  width = 340,
}: {
  row: OhwRow
  currentBv: BvName
  onDescriptionSave: (desc: string) => void
  leftOffset?: number
  width?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const isPaired = !!(row.icPairId && row.icFromBv && row.icToBv)
  const isTruncatable = (row.description?.length ?? 0) > 38
  return (
    <td style={{
      paddingLeft: 26, position: 'sticky', left: leftOffset,
      background: 'var(--bg2)', zIndex: expanded ? 6 : 2,
      boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.08)',
      width, minWidth: width, maxWidth: width,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap' }}>
        {isPaired && row.icFromBv && row.icToBv && (
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}
            title={`IC-pair: ${row.icFromBv} → ${row.icToBv}. Waardes spiegelen automatisch (deze BV = ${currentBv}).`}
          >
            <BvTag bv={row.icFromBv} dim={currentBv !== row.icFromBv} />
            <span style={{ color: 'var(--t3)', fontSize: 10 }}>→</span>
            <BvTag bv={row.icToBv} dim={currentBv !== row.icToBv} />
          </span>
        )}
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          <input
            key={row.id}
            className="ohw-inp"
            style={{
              width: expanded ? 420 : (isPaired ? 180 : 260),
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
            onBlur={e => { setExpanded(false); onDescriptionSave(e.target.value) }}
          />
          {isTruncatable && !expanded && (
            <span style={{
              position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)',
              fontSize: 11, color: 'var(--t3)', pointerEvents: 'none', zIndex: 3, lineHeight: 1,
            }}>›</span>
          )}
        </div>
      </div>
    </td>
  )
}

/** Modal voor het toevoegen van een nieuwe IC-pair. User kiest Van/Naar/
 *  omschrijving; waardes vult hij later direct in de regel. */
function AddIcPairDialog({
  currentBv,
  onClose,
  onAdd,
}: {
  currentBv: BvName
  onClose: () => void
  onAdd: (fromBv: BvName, toBv: BvName, description: string) => void
}) {
  const [fromBv, setFromBv] = useState<BvName>(currentBv)
  const [toBv, setToBv] = useState<BvName>(BVS.find(b => b !== currentBv) ?? 'Projects')
  const [description, setDescription] = useState('')

  const canSave = fromBv !== toBv && description.trim().length > 0

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, padding: 20,
      }}
    >
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--bd3)', borderRadius: 12,
        width: '100%', maxWidth: 480, padding: 20,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
      }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
          Nieuwe IC-verrekening toevoegen
        </div>
        <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 14 }}>
          Een IC-regel verbindt twee BV's. Als je bij de betalende (Van) BV een bedrag van <strong>-2000</strong> invult, verschijnt er automatisch <strong>+2000</strong> bij de ontvangende (Naar) BV.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t3)', marginBottom: 4 }}>
              Van <span style={{ color: 'var(--red)' }}>(betaalt / minus)</span>
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {BVS.map(b => (
                <button
                  key={b}
                  onClick={() => setFromBv(b)}
                  className={`btn sm${fromBv === b ? ' primary' : ' ghost'}`}
                  style={{
                    fontSize: 11,
                    borderColor: fromBv === b ? BV_COLORS[b] : undefined,
                    color: fromBv === b ? BV_COLORS[b] : undefined,
                  }}
                >{b}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t3)', marginBottom: 4 }}>
              Naar <span style={{ color: 'var(--green)' }}>(ontvangt / plus)</span>
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {BVS.map(b => (
                <button
                  key={b}
                  onClick={() => setToBv(b)}
                  disabled={b === fromBv}
                  className={`btn sm${toBv === b ? ' primary' : ' ghost'}`}
                  style={{
                    fontSize: 11,
                    opacity: b === fromBv ? 0.3 : 1,
                    borderColor: toBv === b ? BV_COLORS[b] : undefined,
                    color: toBv === b ? BV_COLORS[b] : undefined,
                  }}
                >{b}</button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--t3)', marginBottom: 4 }}>
            Omschrijving
          </div>
          <input
            autoFocus
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder='bijv. "IC Software-Projects (Lidar to Go)"'
            style={{
              width: '100%', background: 'var(--bg1)', border: '1px solid var(--bd3)',
              borderRadius: 5, color: 'var(--t1)', fontSize: 12, padding: '7px 10px',
              outline: 'none', fontFamily: 'var(--font)',
            }}
            onKeyDown={e => { if (e.key === 'Enter' && canSave) { onAdd(fromBv, toBv, description.trim()); onClose() } }}
          />
        </div>

        {/* Preview */}
        {canSave && (
          <div style={{
            marginBottom: 14, padding: '10px 12px', background: 'var(--bg3)',
            borderRadius: 7, fontSize: 11, color: 'var(--t2)', lineHeight: 1.5,
          }}>
            <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em' }}>
              Preview
            </div>
            Bij <BvTag bv={fromBv} /> zie je deze regel met een <strong style={{ color: 'var(--red)' }}>minteken</strong> (kosten),
            bij <BvTag bv={toBv} /> met een <strong style={{ color: 'var(--green)' }}>plusteken</strong> (opbrengst).
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>Annuleren</button>
          <button
            className="btn primary"
            disabled={!canSave}
            onClick={() => { onAdd(fromBv, toBv, description.trim()); onClose() }}
          >✓ Toevoegen</button>
        </div>
      </div>
    </div>
  )
}

interface Props {
  rows: OhwRow[]
  totaalIC: Record<string, number | null>
  months: string[]
  onChange: (rows: OhwRow[]) => void
  /** Huidige BV (de entiteit waar deze IC-sectie bij hoort). Wordt gebruikt
   *  om pair-edits correct te spiegelen naar de andere BV. */
  currentBv: BvName
  /** Jaar voor de store-acties. */
  year: '2025' | '2026'
  /** Breedtes van de vaste kolommen — nodig voor sticky-left alignment. */
  contactColWidth?: number
  descColWidth?: number
}

export const IcSection = memo(function IcSection({ rows, totaalIC, months, onChange, currentBv, year, contactColWidth = 150, descColWidth = 340 }: Props) {
  const [open, setOpen] = useState(false)
  const [showAddDialog, setShowAddDialog] = useState(false)

  const addIcPair = useOhwStore(s => s.addIcPair)
  const removeIcPair = useOhwStore(s => s.removeIcPair)
  const updateIcPairValue = useOhwStore(s => s.updateIcPairValue)
  const updateIcPairDescription = useOhwStore(s => s.updateIcPairDescription)

  const updateRowContactStore = useOhwStore(s => s.updateRowContact)

  const updateCell = useCallback((row: OhwRow, month: string, raw: string) => {
    const v = parseNL(raw)
    if (row.icPairId) {
      // Pair: via store-actie zodat de mirror ook geupdate wordt
      updateIcPairValue(year, currentBv, row.id, month, v)
    } else {
      // Gewone IC-rij zonder pair
      onChange(rows.map(r => r.id === row.id ? { ...r, values: { ...r.values, [month]: v } } : r))
    }
  }, [rows, onChange, updateIcPairValue, year, currentBv])

  const updateDescription = useCallback((row: OhwRow, desc: string) => {
    if (row.icPairId) {
      updateIcPairDescription(year, row.icPairId, desc)
    } else {
      onChange(rows.map(r => r.id === row.id ? { ...r, description: desc } : r))
    }
  }, [rows, onChange, updateIcPairDescription, year])

  const addLegacyRow = useCallback(() => {
    onChange([...rows, { id: `ic-${Date.now()}`, description: '', values: {} }])
  }, [rows, onChange])

  const removeRow = useCallback((row: OhwRow) => {
    if (row.icPairId) {
      removeIcPair(year, row.icPairId)
    } else {
      onChange(rows.filter(r => r.id !== row.id))
    }
  }, [rows, onChange, removeIcPair, year])

  const hdrBg = 'rgba(59,130,246,0.06)'

  return (
    <>
      {/* ── IC header — per-month totals always visible ─────────── */}
      <tr className="grp" style={{ background: hdrBg }} onClick={() => setOpen(o => !o)}>
        {/* Kolom 1: lege contactpersoon-cel */}
        <td style={{
          position: 'sticky', left: 0, background: hdrBg, zIndex: 2,
          width: contactColWidth, minWidth: contactColWidth,
        }} />
        {/* Kolom 2: IC Verrekening label */}
        <td style={{
          position: 'sticky', left: contactColWidth, background: hdrBg, zIndex: 2,
          padding: '7px 12px', cursor: 'pointer',
          boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.06)',
          whiteSpace: 'nowrap',
          width: descColWidth, minWidth: descColWidth,
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

      {open && rows.map(row => {
        const isPaired = !!row.icPairId
        return (
          <tr key={row.id} className="sub">
            {/* Kolom 1: Contactpersoon (sticky-left) */}
            <td style={{
              position: 'sticky', left: 0, zIndex: 1,
              background: 'var(--bg2)', padding: '2px 8px',
              width: contactColWidth, minWidth: contactColWidth, maxWidth: contactColWidth,
              boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.05)',
            }}>
              <input
                className="ohw-inp"
                style={{ width: '100%', fontSize: 11, textAlign: 'left', background: 'transparent', border: 'none' }}
                defaultValue={row.contactPerson ?? ''}
                placeholder="—"
                onBlur={e => updateRowContactStore(year, currentBv, row.id, e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                title={row.contactPerson ? `Contact: ${row.contactPerson}` : 'Vul een contactpersoon in'}
              />
            </td>
            {/* Kolom 2: Omschrijving */}
            <IcDescCell
              row={row}
              currentBv={currentBv}
              onDescriptionSave={desc => updateDescription(row, desc)}
              leftOffset={contactColWidth}
              width={descColWidth}
            />
            {months.map(m => {
              const v = gv(row.values, m)
              return (
                <td key={m} style={{ padding: 2, textAlign: 'right', background: 'var(--bg2)' }}>
                  <input
                    key={`${row.id}-${m}-${v}`}
                    className="ohw-inp"
                    style={{ fontSize: 11, color: v < 0 ? 'var(--red)' : v > 0 ? 'var(--green)' : 'var(--t3)' }}
                    defaultValue={v !== 0 ? fmt(v) : ''}
                    placeholder="—"
                    title={isPaired ? `Pair — spiegelt naar ${row.icFromBv === currentBv ? row.icToBv : row.icFromBv} met omgekeerd teken` : undefined}
                    onBlur={e => updateCell(row, m, e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  />
                </td>
              )
            })}
            <td style={{ background: 'var(--bg2)', width: 40, textAlign: 'center' }}>
              <button
                className="btn sm ghost"
                style={{ color: 'var(--red)', padding: '2px 6px' }}
                onClick={() => removeRow(row)}
                title={isPaired ? 'Verwijdert de IC-pair bij beide BVs' : 'Verwijder deze regel'}
              >✕</button>
            </td>
          </tr>
        )
      })}

      {open && (
        <tr>
          <td
            colSpan={months.length + 3}
            style={{ background: 'var(--bg2)', padding: '4px 12px 4px 26px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
          >
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="btn sm"
                style={{
                  background: 'rgba(59,130,246,0.08)',
                  border: '1px dashed var(--blue)',
                  color: 'var(--blue)',
                  fontSize: 11,
                  padding: '3px 10px',
                  flex: 1,
                  justifyContent: 'center',
                }}
                onClick={() => setShowAddDialog(true)}
                title="Voegt tegelijk een rij toe bij beide BV's — invullen bij één kant spiegelt automatisch"
              >
                + IC-verrekening tussen 2 BV's
              </button>
              <button
                className="btn sm ghost"
                style={{ fontSize: 10, color: 'var(--t3)', padding: '3px 10px' }}
                onClick={addLegacyRow}
                title="Losse IC-regel zonder koppeling (enkelzijdig)"
              >
                + enkelvoudig
              </button>
            </div>
          </td>
        </tr>
      )}

      {showAddDialog && (
        <tr><td colSpan={months.length + 3} style={{ padding: 0, background: 'transparent' }}>
          <AddIcPairDialog
            currentBv={currentBv}
            onClose={() => setShowAddDialog(false)}
            onAdd={(from, to, desc) => {
              addIcPair(year, from, to, desc)
            }}
          />
        </td></tr>
      )}
    </>
  )
})
