import { useState } from 'react'
import type { FullReportSections } from '../../lib/exportMonthBundle'

/** Eén optie in de modal — keuzes worden opgeslagen als FullReportSections. */
interface OptionDef {
  id: keyof FullReportSections
  label: string
  description: string
  icon: string
}

const OPTIONS: OptionDef[] = [
  { id: 'pptx',           label: 'Maandrapportage (PowerPoint)', description: 'Volledige slide-deck met KPIs, trends, per-BV deep-dives en bijlage', icon: '📊' },
  { id: 'closingExcel',   label: 'Maandafsluiting (Excel)',      description: 'Closing-entries per BV: factuurvolume, OHW-mutatie, kosten, accruals',  icon: '📋' },
  { id: 'ohwOverview',    label: 'OHW Overzicht (Excel)',        description: 'Volledig OHW-overzicht 2025 + 2026, één werkblad per (jaar, BV)',     icon: '🏗' },
  { id: 'fteOverview',    label: 'FTE & Headcount (Excel)',      description: 'Alle BVs + maanden, inclusief budget en delta',                       icon: '👥' },
  { id: 'importedFiles',  label: 'Geïmporteerde bestanden',      description: 'Goedgekeurde upload-bestanden (D-lijst, Factuurvolume, Uren, …) + import-log', icon: '📁' },
  { id: 'bijlagen',       label: 'Bijlagen (evidence)',          description: 'Originele bijlagen bij OHW-rijen — PDF, Excel, e-mails, etc. + index',  icon: '📎' },
  { id: 'costBreakdowns', label: 'Kosten-specificaties',         description: 'Handmatige uitsplitsingen onder kosten-regels (Excel)',                icon: '💸' },
  { id: 'summary',        label: 'Samenvatting + JSON snapshot', description: 'Leesbare markdown-samenvatting + JSON voor archivering',                icon: '📝' },
]

interface Props {
  open: boolean
  months: string[]
  /** Initiële vinkjes — default is alles aan. */
  initial?: Partial<FullReportSections>
  /** Voor BV-locked gebruikers: tonen we welke BV in de export zit. */
  lockedBv?: string | null
  onCancel: () => void
  onConfirm: (sections: FullReportSections) => void | Promise<void>
}

const DEFAULT_ON: FullReportSections = {
  pptx: true,
  closingExcel: true,
  ohwOverview: true,
  fteOverview: true,
  importedFiles: true,
  bijlagen: true,
  costBreakdowns: true,
  summary: true,
}

export function ExportOptionsModal({ open, months, initial, lockedBv, onCancel, onConfirm }: Props) {
  const [sections, setSections] = useState<FullReportSections>(() => ({ ...DEFAULT_ON, ...(initial ?? {}) }))
  const [busy, setBusy] = useState(false)

  if (!open) return null

  const toggle = (id: keyof FullReportSections) =>
    setSections(s => ({ ...s, [id]: !s[id] }))

  const setAll = (val: boolean) => {
    const next: FullReportSections = { ...sections }
    for (const k of Object.keys(next) as (keyof FullReportSections)[]) next[k] = val
    setSections(next)
  }

  const enabledCount = Object.values(sections).filter(Boolean).length
  const allOn = enabledCount === OPTIONS.length

  const handleConfirm = async () => {
    if (enabledCount === 0) return
    setBusy(true)
    try {
      await onConfirm(sections)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      onClick={() => !busy && onCancel()}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg2)', border: '1px solid var(--bd2)', borderRadius: 10,
          width: '100%', maxWidth: 620, maxHeight: '90vh', overflow: 'auto',
          boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--bd2)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>🗂</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)' }}>
              Volledig rapport exporteren
            </div>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
              {months.length === 1
                ? `Maand: ${months[0]}`
                : `${months.length} maanden: ${months.join(', ')}`}
              {lockedBv && (
                <span style={{ marginLeft: 6, color: 'var(--blue)' }}>· beperkt tot {lockedBv}</span>
              )}
            </div>
          </div>
          <button
            onClick={() => onCancel()}
            disabled={busy}
            className="btn sm ghost"
            style={{ fontSize: 12 }}
          >✕</button>
        </div>

        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--bd2)', display: 'flex', gap: 8 }}>
          <button
            className="btn sm ghost"
            onClick={() => setAll(true)}
            disabled={busy || allOn}
            style={{ fontSize: 11 }}
          >☑ Alles aan</button>
          <button
            className="btn sm ghost"
            onClick={() => setAll(false)}
            disabled={busy || enabledCount === 0}
            style={{ fontSize: 11 }}
          >☐ Niets</button>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)', alignSelf: 'center' }}>
            {enabledCount} / {OPTIONS.length} onderdelen geselecteerd
          </span>
        </div>

        <div style={{ padding: '8px 12px' }}>
          {OPTIONS.map(opt => {
            const checked = !!sections[opt.id]
            return (
              <label
                key={opt.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                  padding: '10px 12px', borderRadius: 8,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  background: checked ? 'rgba(0,169,224,0.07)' : 'transparent',
                  border: `1px solid ${checked ? 'var(--blue)' : 'transparent'}`,
                  marginBottom: 4,
                  opacity: busy ? 0.6 : 1,
                  transition: 'background .12s, border-color .12s',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => !busy && toggle(opt.id)}
                  disabled={busy}
                  style={{ marginTop: 3, width: 16, height: 16, accentColor: 'var(--blue)' }}
                />
                <span style={{ fontSize: 18, marginTop: -1 }}>{opt.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2, lineHeight: 1.5 }}>{opt.description}</div>
                </div>
              </label>
            )
          })}
        </div>

        <div style={{
          padding: '14px 20px', borderTop: '1px solid var(--bd2)',
          display: 'flex', gap: 8, alignItems: 'center',
        }}>
          <span style={{ fontSize: 11, color: 'var(--t3)', flex: 1 }}>
            Resultaat: één ZIP per maand met de aangevinkte onderdelen.
          </span>
          <button className="btn sm ghost" onClick={() => onCancel()} disabled={busy}>
            Annuleren
          </button>
          <button
            className="btn sm primary"
            onClick={handleConfirm}
            disabled={busy || enabledCount === 0}
            style={{ minWidth: 140 }}
          >
            {busy ? '⏳ Exporteren...' : `📦 Exporteer (${enabledCount})`}
          </button>
        </div>
      </div>
    </div>
  )
}
