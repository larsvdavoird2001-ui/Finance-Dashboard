import { useRef, useState, useEffect } from 'react'
import { useFinStore, CLOSING_MONTHS } from '../../store/useFinStore'
import { useImportStore } from '../../store/useImportStore'
import { useOhwStore } from '../../store/useOhwStore'
import { useFteStore, FTE_MONTHS } from '../../store/useFteStore'
import { monthlyActuals2026 } from '../../data/plData'
import type { EntityName } from '../../data/plData'
import { fmt, parseNL } from '../../lib/format'
import { parseImportFile } from '../../lib/parseImport'
import type { ParseOverrides, TariffLookup } from '../../lib/parseImport'
import { useTariffStore } from '../../store/useTariffStore'
import { useRawDataStore } from '../../store/useRawDataStore'
import type { BvId, ClosingEntry, ImportRecord, GlobalFilter } from '../../data/types'
import { useToast } from '../../hooks/useToast'
import { Toast } from '../common/Toast'
import { ImportApprovalModal } from './ImportApprovalModal'
import { useNavStore } from '../../store/useNavStore'
import { TariffTable } from './TariffTable'

const BVS: BvId[] = ['Consultancy', 'Projects', 'Software']

const BV_COLORS: Record<BvId, string> = {
  Consultancy: '#4d8ef8',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
}

interface UploadSlot {
  id: string
  label: string
  description: string
  icon: string
  appliesTo: Array<'factuurvolume' | 'ohwMutatie'>
  /** Als dit slot voor één BV is, toon dit in de UI */
  targetBv?: BvId
  /** OHW-rij die gevuld wordt bij goedkeuring */
  targetRowId?: string
  /** Entity (BV) waar de OHW-rij in zit */
  targetEntity?: string
}

const UPLOAD_SLOTS: UploadSlot[] = [
  { id: 'factuurvolume',   label: 'Factuurvolume',    icon: '🧾', description: 'SAP facturenlijst — gefactureerde omzet per BV (alle BVs)', appliesTo: ['factuurvolume'] },
  { id: 'geschreven_uren', label: 'Geschreven uren',  icon: '⏱', description: 'SAP urenregistratie — totaal geschreven uren per BV (alle BVs)', appliesTo: [] },
  { id: 'uren_lijst',      label: 'Uren lijst',       icon: '📋', description: 'Alleen Projects — vult OHW-regel "U-Projecten met tarief"', appliesTo: [], targetBv: 'Projects', targetRowId: 'p1', targetEntity: 'Projects' },
  { id: 'd_lijst',         label: 'D Lijst',          icon: '📊', description: 'Alleen Consultancy — vult OHW-regel "D facturatie"', appliesTo: [], targetBv: 'Consultancy', targetRowId: 'c1', targetEntity: 'Consultancy' },
  { id: 'conceptfacturen', label: 'Conceptfacturen',  icon: '📄', description: 'SAP conceptfacturen — bijdrage aan factuurvolume (alle BVs)', appliesTo: ['factuurvolume'] },
  { id: 'missing_hours',   label: 'Missing Hours',    icon: '⚠', description: 'Alleen Consultancy — berekent missing hours × tarief × 0,9 → OHW', appliesTo: [], targetBv: 'Consultancy', targetRowId: 'c4', targetEntity: 'Consultancy' },
  { id: 'ohw',             label: 'OHW Excel',        icon: '🏗', description: 'Alleen Projects — vult OHW-regel "Onderhanden projecten (OHW Excel)"', appliesTo: [], targetBv: 'Projects', targetRowId: 'p10', targetEntity: 'Projects' },
]

interface NumInputProps {
  value: number
  onChange: (v: number) => void
  color?: string
}

function NumInput({ value, onChange, color }: NumInputProps) {
  const [raw, setRaw] = useState('')
  const [editing, setEditing] = useState(false)
  return (
    <input
      className="ohw-inp"
      style={{ width: 130, ...(color ? { color } : {}) }}
      value={editing ? raw : value === 0 ? '' : value.toLocaleString('nl-NL')}
      placeholder="0"
      onFocus={() => { setEditing(true); setRaw(value === 0 ? '' : String(value)) }}
      onChange={e => setRaw(e.target.value)}
      onBlur={() => {
        setEditing(false)
        const v = parseNL(raw || '0')
        onChange(isNaN(v) ? 0 : v)
      }}
    />
  )
}

function sectionRow(label: string, children: React.ReactNode, bold?: boolean) {
  return (
    <tr style={{ background: bold ? 'var(--bg3)' : undefined }}>
      <td style={{ padding: '6px 12px', fontWeight: bold ? 700 : 400, minWidth: 240, position: 'sticky', left: 0, background: bold ? 'var(--bg3)' : 'var(--bg1)', zIndex: 1 }}>{label}</td>
      {children}
    </tr>
  )
}

interface Props { filter: GlobalFilter }

const COST_SECTIONS = ['directe_kosten', 'operationele_kosten', 'amortisatie_afschrijvingen'] as const
type CostSectionId = typeof COST_SECTIONS[number]

const DIRECTE_KOSTEN_SUBS = [
  { key: 'directe_inkoopkosten',              label: 'Directe inkoopkosten' },
  { key: 'directe_personeelskosten',          label: 'Directe personeelskosten' },
  { key: 'directe_overige_personeelskosten',  label: 'Overige personeelskosten' },
  { key: 'directe_autokosten',                label: 'Autokosten' },
]
const OPERATIONELE_KOSTEN_SUBS = [
  { key: 'indirecte_personeelskosten',  label: 'Indirecte personeelskosten' },
  { key: 'overige_personeelskosten',    label: 'Overige personeelskosten' },
  { key: 'huisvestingskosten',          label: 'Huisvestingskosten' },
  { key: 'automatiseringskosten',       label: 'Automatiseringskosten' },
  { key: 'indirecte_autokosten',        label: 'Indirecte autokosten' },
  { key: 'verkoopkosten',               label: 'Verkoopkosten' },
  { key: 'algemene_kosten',             label: 'Algemene kosten' },
  { key: 'doorbelaste_kosten',          label: 'Doorbelaste kosten' },
]
const AMORTISATIE_SUBS = [
  { key: 'amortisatie_goodwill',  label: 'Amortisatie goodwill' },
  { key: 'amortisatie_software',  label: 'Amortisatie software' },
  { key: 'afschrijvingen',        label: 'Afschrijvingen' },
]

export function MaandTab({ filter: _filter }: Props) {
  const [month, setMonth] = useState<string>('Mar-26')
  const [activeSection, setActiveSection] = useState<'afsluiting' | 'import' | 'export' | 'tarieven'>('afsluiting')
  const [expandedCosts, setExpandedCosts] = useState<Set<CostSectionId>>(new Set())
  const toggleCostSection = (id: CostSectionId) =>
    setExpandedCosts(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const [uploadMonth, setUploadMonth] = useState<string>('Mar-26')
  const [uploadLoading, setUploadLoading] = useState<Record<string, boolean>>({})
  const [pendingRecord, setPendingRecord] = useState<ImportRecord | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [exportMonths, setExportMonths] = useState<string[]>(['Jan-26', 'Feb-26', 'Mar-26'])
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [highlightSlot, setHighlightSlot] = useState<string | null>(null)

  // Navigatie vanuit andere tabs (bijv. OHW → klik op getal → ga naar import)
  const navPending = useNavStore(s => s.pending)
  const navConsume = useNavStore(s => s.consume)
  useEffect(() => {
    const target = navConsume()
    if (target?.section === 'import') {
      setActiveSection('import')
      setUploadMonth(target.month)
      setHighlightSlot(target.slotId)
      // Scroll de juiste kaart in beeld na korte render-delay
      setTimeout(() => {
        const el = document.getElementById(`import-slot-${target.slotId}`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 100)
      // Highlight na 3 seconden weer weghalen
      setTimeout(() => setHighlightSlot(null), 3000)
    }
  }, [navPending])

  const { entries, updateEntry } = useFinStore()
  const { records: importRecords, addRecord, approveRecord, rejectRecord, removeRecord, exportPeriod } = useImportStore()
  const { addEntry: addRawEntry, approveEntry: approveRawEntry, rejectEntry: rejectRawEntry } = useRawDataStore()
  const { toasts, showToast } = useToast()
  const ohwData2026 = useOhwStore(s => s.data2026)
  const updateRowValue = useOhwStore(s => s.updateRowValue)
  const tariffEntries = useTariffStore(s => s.entries)

  // Bouw tariff lookup voor missing hours parser — ALLEEN Consultancy medewerkers
  const tariffLookup: TariffLookup = {}
  for (const t of tariffEntries) {
    if (t.bedrijf === 'Consultancy') {
      tariffLookup[t.id] = { tarief: t.tarief, naam: t.naam }
    }
  }
  const { entries: fteEntries, updateEntry: updateFte } = useFteStore()
  const fteEntry = (bv: BvId) => fteEntries.find(e => e.bv === bv && e.month === month)

  const monthEntries = entries.filter(e => e.month === month)
  const entry = (bv: BvId): ClosingEntry | undefined => monthEntries.find(e => e.bv === bv)
  const update = (id: string, field: keyof Omit<ClosingEntry, 'id'>, val: number | string) => {
    updateEntry(id, { [field]: val } as Partial<Omit<ClosingEntry, 'id'>>)
  }

  // ── OHW-afkomstige waarden: altijd read-only uit OHW store ────────────────
  const getOhwMutatie = (bv: BvId): number => {
    const ohwEntity = ohwData2026.entities.find(e => e.entity === bv)
    return ohwEntity?.mutatieOhw[month] ?? 0
  }

  const getIcVerrekening = (bv: BvId): number => {
    const ohwEntity = ohwData2026.entities.find(e => e.entity === bv)
    return ohwEntity?.totaalIC[month] ?? 0
  }

  // ── Kosten helpers: override per sub-regel, fallback naar actuals ────────
  /** Geeft de positieve waarde voor een kosten-sleutel: override > actuals */
  const getKostenVal = (bv: BvId, key: string): number => {
    const e = entry(bv)
    if (e && e.kostenOverrides[key] !== undefined) return e.kostenOverrides[key]
    return Math.abs(monthlyActuals2026[bv as EntityName]?.[month]?.[key] ?? 0)
  }

  /** Slaat een override op; 0 wist de override (fallback naar actuals) */
  const updateKosten = (bv: BvId, key: string, val: number) => {
    const e = entry(bv)
    if (!e) return
    const next = { ...e.kostenOverrides }
    if (val === 0) delete next[key]
    else next[key] = val
    updateEntry(e.id, { kostenOverrides: next })
  }

  // ── Derived totals ──────────────────────────────────────────────────────
  /** Netto-omzet voor IC = factuurvolume + OHW mutatie [+ mutatie vooruitgefactureerd voor Software] (= rij 52 in de Excel) */
  const getNettoomzetVoorIC = (bv: BvId): number => {
    const ohwEntity = ohwData2026.entities.find(e => e.entity === bv)
    const fv   = entry(bv)?.factuurvolume ?? (ohwEntity?.factuurvolume[month] ?? 0)
    const mut  = ohwEntity?.mutatieOhw[month] ?? 0
    const mutatieVf = ohwEntity?.mutatieVooruitgefactureerd?.[month] ?? 0
    return fv + mut + mutatieVf
  }

  /** Netto-omzet definitief = netto-omzet voor IC + IC + accruals + handmatige correctie */
  const netRevenue = (e: ClosingEntry, bv: BvId) =>
    getNettoomzetVoorIC(bv) + getIcVerrekening(bv) + e.accruals + e.handmatigeCorrectie

  const finalCosts = (bv: BvId) =>
    DIRECTE_KOSTEN_SUBS.reduce((s, sub) => s + getKostenVal(bv, sub.key), 0)

  const grossMargin = (bv: BvId) => {
    const e = entry(bv)
    if (!e) return 0
    return netRevenue(e, bv) - finalCosts(bv)
  }

  const opKosten = (bv: BvId) =>
    OPERATIONELE_KOSTEN_SUBS.reduce((s, sub) => s + getKostenVal(bv, sub.key), 0)

  const amortisatie = (bv: BvId) =>
    AMORTISATIE_SUBS.reduce((s, sub) => s + getKostenVal(bv, sub.key), 0)

  const ebitda = (bv: BvId) => grossMargin(bv) - opKosten(bv)
  const ebit   = (bv: BvId) => ebitda(bv) - amortisatie(bv)

  const totFactuur       = BVS.reduce((a, bv) => a + (entry(bv)?.factuurvolume       ?? 0), 0)
  const totDebiteuren    = BVS.reduce((a, bv) => a + (entry(bv)?.debiteuren          ?? 0), 0)
  const totOhw           = BVS.reduce((a, bv) => a + getOhwMutatie(bv), 0)
  const totAccruals      = BVS.reduce((a, bv) => a + (entry(bv)?.accruals            ?? 0), 0)
  const totHandmatig     = BVS.reduce((a, bv) => a + (entry(bv)?.handmatigeCorrectie ?? 0), 0)
  const totIc           = BVS.reduce((a, bv) => a + getIcVerrekening(bv), 0)
  const totNetRevVoorIC = BVS.reduce((a, bv) => a + getNettoomzetVoorIC(bv), 0)
  const totNetRev       = BVS.reduce((a, bv) => a + (entry(bv) ? netRevenue(entry(bv)!, bv) : getNettoomzetVoorIC(bv) + getIcVerrekening(bv)), 0)
  const totCosts       = BVS.reduce((a, bv) => a + finalCosts(bv), 0)
  const totMargin      = BVS.reduce((a, bv) => a + grossMargin(bv), 0)
  const totMarginPct   = totNetRev > 0 ? totMargin / totNetRev * 100 : 0
  const totOpKosten    = BVS.reduce((a, bv) => a + opKosten(bv), 0)
  const totAmortisatie = BVS.reduce((a, bv) => a + amortisatie(bv), 0)
  const totEbitda      = BVS.reduce((a, bv) => a + ebitda(bv), 0)
  const totEbit        = BVS.reduce((a, bv) => a + ebit(bv), 0)

  // ── Smart suggestions ───────────────────────────────────────────────────
  const prevMonth = CLOSING_MONTHS[CLOSING_MONTHS.indexOf(month) - 1] as string | undefined
  const suggestions = BVS.map(bv => {
    const prevEntry = prevMonth ? entries.find(e => e.bv === bv && e.month === prevMonth) : undefined
    const prevFv = prevEntry?.factuurvolume ?? 0
    return {
      bv,
      suggestFv: prevFv,
      fromPrev: !!prevEntry,
    }
  })

  // ── Validation ──────────────────────────────────────────────────────────
  const warnings: string[] = []
  if (BVS.some(bv => entry(bv)?.factuurvolume === 0))
    warnings.push('Eén of meer BV\'s hebben geen factuurvolume ingevoerd.')
  if (totMarginPct < 20 && totNetRev > 0)
    warnings.push(`Brutomarge (${totMarginPct.toFixed(1)}%) is lager dan 20%. Controleer invoer.`)
  if (Math.abs(totOhw) > 500000)
    warnings.push(`OHW mutatie (${fmt(totOhw)}) is groot (automatisch vanuit OHW Overzicht). Controleer de OHW-tab.`)
  if (BVS.some(bv => { const e = entry(bv); return e && Math.abs(e.handmatigeCorrectie) > 50000 }))
    warnings.push('Handmatige correctie > € 50.000. Voeg een toelichting toe.')

  // Check for months without upload backing
  const approvedForMonth = importRecords.filter(r => r.month === month && r.status === 'approved')
  const hasFactuurUpload = approvedForMonth.some(r => ['factuurvolume', 'conceptfacturen'].includes(r.slotId))
  const hasOhwUpload = approvedForMonth.some(r => r.slotId === 'ohw')
  if (!hasFactuurUpload && totFactuur > 0)
    warnings.push('⚠ Geen goedgekeurd factuurvolume-bestand voor deze maand — onderbouwing ontbreekt.')
  if (!hasOhwUpload && Math.abs(totOhw) > 0)
    warnings.push('⚠ Geen goedgekeurd OHW-bestand voor deze maand — onderbouwing ontbreekt.')

  const actualsCheck = (bv: BvId) => {
    const a = monthlyActuals2026[bv as EntityName]?.[month]?.['netto_omzet'] ?? 0
    const e = entry(bv)
    if (!e || a === 0) return null
    const diff = netRevenue(e, bv) - a
    return { diff, pct: Math.abs(diff / a * 100) }
  }

  // ── File upload handler ─────────────────────────────────────────────────
  const handleFileUpload = async (slotId: string, file: File) => {
    setUploadLoading(prev => ({ ...prev, [slotId]: true }))
    try {
      const result = await parseImportFile(file, slotId, undefined, slotId === 'missing_hours' ? tariffLookup : undefined)
      const slot = UPLOAD_SLOTS.find(s => s.id === slotId)!
      const record: ImportRecord = {
        id: `${slotId}-${Date.now()}`,
        slotId,
        slotLabel: slot.label,
        month: uploadMonth,
        fileName: file.name,
        uploadedAt: new Date().toLocaleString('nl-NL'),
        perBv: result.perBv,
        totalAmount: result.totalAmount,
        rowCount: result.rowCount,
        parsedCount: result.parsedCount,
        skippedCount: result.skippedCount,
        detectedAmountCol: result.detectedAmountCol,
        detectedBvCol: result.detectedBvCol,
        headers: result.headers,
        preview: result.preview,
        status: 'pending',
      }
      addRecord(record)
      addRawEntry({
        recordId: record.id,
        slotId,
        slotLabel: slot.label,
        month: uploadMonth,
        fileName: file.name,
        uploadedAt: record.uploadedAt,
        rows: result.rawRows,
        amountCol: result.detectedAmountCol,
        bvCol: result.detectedBvCol,
        status: 'pending',
      })
      setPendingRecord(record)
      setPendingFile(file)
      if (result.warnings.length > 0) {
        showToast(result.warnings[0], 'r')
      }
    } catch (err) {
      showToast(`Fout: ${err instanceof Error ? err.message : String(err)}`, 'r')
    } finally {
      setUploadLoading(prev => ({ ...prev, [slotId]: false }))
    }
  }

  // Herbereken het bestand met handmatig gekozen kolommen
  const handleReparse = async (amountCol: string, bvCol: string) => {
    if (!pendingRecord || !pendingFile) return
    const overrides: ParseOverrides = { amountCol: amountCol || undefined, bvCol: bvCol || undefined }
    try {
      const result = await parseImportFile(pendingFile, pendingRecord.slotId, overrides, pendingRecord.slotId === 'missing_hours' ? tariffLookup : undefined)
      const updated: ImportRecord = {
        ...pendingRecord,
        perBv: result.perBv,
        totalAmount: result.totalAmount,
        rowCount: result.rowCount,
        parsedCount: result.parsedCount,
        skippedCount: result.skippedCount,
        detectedAmountCol: result.detectedAmountCol,
        detectedBvCol: result.detectedBvCol,
        headers: result.headers,
        preview: result.preview,
      }
      removeRecord(pendingRecord.id)
      addRecord(updated)
      // Update ook de raw data store met nieuwe kolomselectie
      addRawEntry({
        recordId: updated.id,
        slotId: updated.slotId,
        slotLabel: updated.slotLabel,
        month: updated.month,
        fileName: updated.fileName,
        uploadedAt: updated.uploadedAt,
        rows: result.rawRows,
        amountCol: result.detectedAmountCol,
        bvCol: result.detectedBvCol,
        status: 'pending',
      })
      setPendingRecord(updated)
      if (result.warnings.length > 0) showToast(result.warnings[0], 'r')
    } catch (err) {
      showToast(`Herberekening mislukt: ${err instanceof Error ? err.message : String(err)}`, 'r')
    }
  }

  // Apply approved import to closing entries AND/OR OHW rows
  const applyImportToEntries = (record: ImportRecord) => {
    const slot = UPLOAD_SLOTS.find(s => s.id === record.slotId)
    if (!slot) return

    let applied = 0

    // Als het slot een OHW-rij target, schrijf daarheen
    if (slot.targetRowId && slot.targetEntity) {
      const amount = record.totalAmount
      if (amount !== 0) {
        updateRowValue('2026', slot.targetEntity, slot.targetRowId, record.month, amount)
        applied++
        showToast(`${record.slotLabel}: ${fmt(amount)} ingevuld in OHW Overzicht → ${slot.targetEntity}`, 'g')
      }
      return
    }

    // Anders: pas toe op closing entries (factuurvolume etc.)
    if (slot.appliesTo.length === 0) return
    for (const bv of BVS) {
      const e = entry(bv) ?? entries.find(x => x.bv === bv && x.month === record.month)
      if (!e) continue
      const amount = record.perBv[bv] ?? 0
      if (amount === 0) continue
      for (const field of slot.appliesTo) {
        update(e.id, field, amount)
      }
      applied++
    }
    if (applied > 0) showToast(`${record.slotLabel} toegepast op ${applied} BV(s) voor ${record.month}`, 'g')
    else showToast('Geen BV-verdeling beschikbaar — vul handmatig in', 'r')
  }

  const handleApprove = (record: ImportRecord) => {
    approveRecord(record.id)
    approveRawEntry(record.id)
    applyImportToEntries(record)
    setPendingRecord(null)
    setPendingFile(null)
    showToast(`${record.slotLabel} goedgekeurd en toegepast`, 'g')
  }

  const handleReject = (record: ImportRecord, reason: string) => {
    rejectRecord(record.id, reason)
    rejectRawEntry(record.id)
    setPendingRecord(null)
    setPendingFile(null)
    showToast(`${record.slotLabel} afgekeurd`, 'r')
  }

  // Imports for current upload month
  const monthImports = importRecords.filter(r => r.month === uploadMonth)

  return (
    <>
      <div className="page">
        {/* Section tabs + month selector */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="tabs-row">
            <button className={`tab${activeSection === 'afsluiting' ? ' active' : ''}`} onClick={() => setActiveSection('afsluiting')}>Maandafsluiting</button>
            <button className={`tab${activeSection === 'import' ? ' active' : ''}`} onClick={() => setActiveSection('import')}>
              Bestanden importeren
              {importRecords.filter(r => r.status === 'pending').length > 0 && (
                <span style={{ marginLeft: 5, background: 'var(--amber)', color: '#000', fontSize: 9, padding: '1px 4px', borderRadius: 3, fontWeight: 700 }}>
                  {importRecords.filter(r => r.status === 'pending').length}
                </span>
              )}
            </button>
            <button className={`tab${activeSection === 'export' ? ' active' : ''}`} onClick={() => setActiveSection('export')}>Export & Log</button>
            <button className={`tab${activeSection === 'tarieven' ? ' active' : ''}`} onClick={() => setActiveSection('tarieven')}>IC Tarieven</button>
          </div>

          {activeSection === 'afsluiting' && (
            <div style={{ display: 'flex', gap: 4 }}>
              {CLOSING_MONTHS.map(m => (
                <button key={m} className={`btn sm${month === m ? ' primary' : ' ghost'}`} onClick={() => setMonth(m)}>{m}</button>
              ))}
            </div>
          )}

          {activeSection === 'import' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 600 }}>MAAND:</span>
              {CLOSING_MONTHS.map(m => (
                <button key={m} className={`btn sm${uploadMonth === m ? ' primary' : ' ghost'}`} onClick={() => setUploadMonth(m)}>{m}</button>
              ))}
            </div>
          )}

          {activeSection === 'afsluiting' && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button className="btn sm success" onClick={() => showToast(`Maandafsluiting ${month} opgeslagen`, 'g')}>
                ✓ Afsluiting opslaan
              </button>
            </div>
          )}
        </div>

        {/* ── IMPORT SECTION ──────────────────────────────────────────────── */}
        {activeSection === 'import' && (
          <>
            <div style={{ background: 'var(--bd-blue)', border: '1px solid var(--blue)', borderRadius: 8, padding: '10px 14px', fontSize: 11, color: 'var(--t2)' }}>
              <strong style={{ color: 'var(--blue)' }}>ℹ Bestandsimport voor {uploadMonth}</strong> — Upload SAP-exports of de OHW-Excel.
              Na het inlezen zie je een pop-up met de gedetecteerde bedragen per BV. Jij keurt goed of af vóór de cijfers worden doorgezet.
              Je kunt ook altijd handmatig invullen in de Maandafsluiting — dan verschijnt wel een waarschuwing dat onderbouwing ontbreekt.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
              {UPLOAD_SLOTS.map(slot => {
                const approved = monthImports.filter(r => r.slotId === slot.id && r.status === 'approved')
                const pending  = monthImports.filter(r => r.slotId === slot.id && r.status === 'pending')
                const rejected = monthImports.filter(r => r.slotId === slot.id && r.status === 'rejected')
                const latest   = approved[approved.length - 1]
                const loading  = uploadLoading[slot.id]

                return (
                  <div
                    key={slot.id}
                    className="card"
                    id={`import-slot-${slot.id}`}
                    style={{
                      border: `1px solid ${highlightSlot === slot.id ? 'var(--blue)' : latest ? 'var(--green)' : pending.length > 0 ? 'var(--amber)' : 'var(--bd)'}`,
                      boxShadow: highlightSlot === slot.id ? '0 0 12px rgba(77,142,248,0.4)' : undefined,
                      transition: 'box-shadow 0.3s, border-color 0.3s',
                    }}
                  >
                    <div className="card-hdr" style={{ borderBottom: '1px solid var(--bd)' }}>
                      <span style={{ fontSize: 16, marginRight: 6 }}>{slot.icon}</span>
                      <span className="card-title">{slot.label}</span>
                      {slot.targetBv && (
                        <span style={{
                          fontSize: 9, padding: '2px 6px', borderRadius: 3, fontWeight: 700, marginLeft: 6,
                          background: `${BV_COLORS[slot.targetBv]}22`,
                          color: BV_COLORS[slot.targetBv],
                          border: `1px solid ${BV_COLORS[slot.targetBv]}44`,
                        }}>
                          {slot.targetBv}
                        </span>
                      )}
                      {!slot.targetBv && (
                        <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, fontWeight: 600, marginLeft: 6, background: 'var(--bg3)', color: 'var(--t3)' }}>
                          Alle BVs
                        </span>
                      )}
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                        {latest && <span style={{ fontSize: 9, background: 'var(--bd-green)', color: 'var(--green)', padding: '2px 6px', borderRadius: 3 }}>✓ Goedgekeurd</span>}
                        {pending.length > 0 && <span style={{ fontSize: 9, background: 'var(--bd-amber)', color: 'var(--amber)', padding: '2px 6px', borderRadius: 3 }}>⌛ In afwachting</span>}
                        {rejected.length > 0 && !latest && <span style={{ fontSize: 9, background: 'var(--bd-red)', color: 'var(--red)', padding: '2px 6px', borderRadius: 3 }}>✕ Afgekeurd</span>}
                      </div>
                    </div>
                    <div style={{ padding: '12px 14px' }}>
                      <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 10 }}>{slot.description}</div>

                      {/* Approved data summary */}
                      {latest && (
                        <div style={{ marginBottom: 10, background: 'var(--bd-green)', borderRadius: 6, padding: '8px 10px' }}>
                          <div style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600, marginBottom: 5 }}>
                            {latest.fileName} · {latest.uploadedAt}
                          </div>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            {BVS.map(bv => (
                              <span key={bv} style={{ fontSize: 11 }}>
                                <span style={{ color: BV_COLORS[bv] }}>{bv}:</span>
                                <strong style={{ marginLeft: 3, fontFamily: 'var(--mono)', fontSize: 11 }}>
                                  {(latest.perBv[bv] ?? 0) > 0 ? fmt(latest.perBv[bv]) : '—'}
                                </strong>
                              </span>
                            ))}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
                            Totaal: <strong>{fmt(latest.totalAmount)}</strong> · {latest.rowCount} rijen
                          </div>
                          <button
                            className="btn sm ghost"
                            style={{ marginTop: 6, fontSize: 10, color: 'var(--red)' }}
                            onClick={() => removeRecord(latest.id)}
                          >
                            ✕ Verwijderen
                          </button>
                        </div>
                      )}

                      {/* Pending */}
                      {pending.map(r => (
                        <div key={r.id} style={{ marginBottom: 8, background: 'var(--bd-amber)', borderRadius: 6, padding: '8px 10px' }}>
                          <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 600, marginBottom: 4 }}>
                            ⌛ {r.fileName} — in afwachting
                          </div>
                          <button className="btn sm" style={{ fontSize: 10 }} onClick={() => setPendingRecord(r)}>
                            → Bekijk & keur goed/af
                          </button>
                        </div>
                      ))}

                      {/* Upload area */}
                      <div
                        style={{
                          border: `2px dashed ${loading ? 'var(--blue)' : latest ? 'var(--green)' : 'var(--bd2)'}`,
                          borderRadius: 7, padding: '12px', textAlign: 'center', cursor: 'pointer',
                          background: 'var(--bg3)', transition: 'all .15s',
                        }}
                        onClick={() => fileRefs.current[slot.id]?.click()}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileUpload(slot.id, f) }}
                      >
                        <input
                          type="file" accept=".xlsx,.xls,.csv"
                          style={{ display: 'none' }}
                          ref={el => { fileRefs.current[slot.id] = el }}
                          onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(slot.id, f); e.target.value = '' }}
                        />
                        <span style={{ fontSize: 11, color: loading ? 'var(--blue)' : 'var(--t3)' }}>
                          {loading ? 'Bezig met inlezen...' : latest ? '↑ Nieuw bestand uploaden' : 'Klik of sleep .xlsx/.csv'}
                        </span>
                      </div>

                      {/* Manual fallback notice */}
                      {!latest && (
                        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--t3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span>💡</span>
                          <span>Je kunt ook handmatig invullen in de Maandafsluiting — dan geldt wel de "geen onderbouwing" waarschuwing.</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* ── EXPORT & LOG ────────────────────────────────────────────────── */}
        {activeSection === 'export' && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--t2)', fontWeight: 600 }}>Selecteer maanden voor export:</span>
              {CLOSING_MONTHS.map(m => (
                <button
                  key={m}
                  className={`btn sm${exportMonths.includes(m) ? ' primary' : ' ghost'}`}
                  onClick={() => setExportMonths(prev =>
                    prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]
                  )}
                >{m}</button>
              ))}
              <button
                className="btn sm success"
                style={{ marginLeft: 'auto' }}
                onClick={() => {
                  if (exportMonths.length === 0) { showToast('Selecteer eerst een maand', 'r'); return }
                  exportPeriod(exportMonths)
                  showToast(`Export aangemaakt voor ${exportMonths.join(', ')}`, 'g')
                }}
              >
                ↓ Download Excel
              </button>
            </div>

            {/* Import log */}
            <div className="card">
              <div className="card-hdr">
                <span className="card-title">Import log — alle uploads</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>{importRecords.length} records</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Maand</th>
                      <th>Type</th>
                      <th>Bestand</th>
                      <th className="r">Totaal</th>
                      <th className="r">Consultancy</th>
                      <th className="r">Projects</th>
                      <th className="r">Software</th>
                      <th>Status</th>
                      <th>Geüpload</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {importRecords.length === 0 && (
                      <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--t3)', padding: 20 }}>Nog geen uploads</td></tr>
                    )}
                    {importRecords.map(r => (
                      <tr key={r.id} className="sub">
                        <td style={{ fontWeight: 600 }}>{r.month}</td>
                        <td>{UPLOAD_SLOTS.find(s => s.id === r.slotId)?.icon} {r.slotLabel}</td>
                        <td style={{ color: 'var(--t3)', fontSize: 11 }}>{r.fileName}</td>
                        <td className="mono r">{fmt(r.totalAmount)}</td>
                        <td className="mono r" style={{ color: BV_COLORS.Consultancy }}>{r.perBv['Consultancy'] > 0 ? fmt(r.perBv['Consultancy']) : '—'}</td>
                        <td className="mono r" style={{ color: BV_COLORS.Projects }}>{r.perBv['Projects'] > 0 ? fmt(r.perBv['Projects']) : '—'}</td>
                        <td className="mono r" style={{ color: BV_COLORS.Software }}>{r.perBv['Software'] > 0 ? fmt(r.perBv['Software']) : '—'}</td>
                        <td>
                          <span style={{
                            fontSize: 10, padding: '2px 6px', borderRadius: 3, fontWeight: 600,
                            background: r.status === 'approved' ? 'var(--bd-green)' : r.status === 'rejected' ? 'var(--bd-red)' : 'var(--bd-amber)',
                            color: r.status === 'approved' ? 'var(--green)' : r.status === 'rejected' ? 'var(--red)' : 'var(--amber)',
                          }}>
                            {r.status === 'approved' ? '✓ Goedgekeurd' : r.status === 'rejected' ? '✕ Afgekeurd' : '⌛ Wacht'}
                          </span>
                        </td>
                        <td style={{ fontSize: 10, color: 'var(--t3)' }}>{r.uploadedAt}</td>
                        <td>
                          <button className="btn sm ghost" style={{ fontSize: 10, color: 'var(--t3)' }} onClick={() => removeRecord(r.id)}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── IC TARIEVEN ─────────────────────────────────────────────────── */}
        {activeSection === 'tarieven' && <TariffTable />}

        {/* ── AFSLUITING ──────────────────────────────────────────────────── */}
        {activeSection === 'afsluiting' && (
          <>
            {/* ── Smart suggesties ───────────────────────────────────────── */}
            <div className="card" style={{ border: '1px solid var(--blue)' }}>
              <div className="card-hdr" style={{ background: 'rgba(77,142,248,.07)' }}>
                <span style={{ fontSize: 13, marginRight: 6 }}>💡</span>
                <span className="card-title">Slimme suggesties — {month}</span>
                <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--t3)' }}>
                  {prevMonth ? `Gebaseerd op ${prevMonth}` : 'Geen vorige maand beschikbaar'}
                </span>
                <button
                  className="btn sm primary"
                  style={{ marginLeft: 'auto', fontSize: 10 }}
                  onClick={() => {
                    let applied = 0
                    for (const sug of suggestions) {
                      const e = entry(sug.bv)
                      if (!e) continue
                      if (e.factuurvolume === 0 && sug.suggestFv !== 0) {
                        updateEntry(e.id, { factuurvolume: sug.suggestFv })
                        applied++
                      }
                    }
                    showToast(applied > 0 ? `Factuurvolume suggesties toegepast op ${applied} BV(s)` : 'Factuurvolume al aanwezig — geen suggesties toegepast', applied > 0 ? 'g' : 'r')
                  }}
                >
                  Pas alle toe
                </button>
              </div>
              <div style={{ padding: '10px 14px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {suggestions.map(sug => {
                  const ohwMut = getOhwMutatie(sug.bv)
                  const hasOhw = ohwData2026.entities.some(e => e.entity === sug.bv && e.mutatieOhw[month] != null)
                  return (
                    <div key={sug.bv} style={{ background: 'var(--bg3)', borderRadius: 8, padding: '10px 12px', border: `1px solid ${BV_COLORS[sug.bv]}22` }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: BV_COLORS[sug.bv], marginBottom: 6 }}>{sug.bv}</div>
                      <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 4 }}>
                        {prevMonth ? `📅 Factuurvolume vorige maand (${prevMonth})` : '—'}
                      </div>
                      <div style={{ fontSize: 11, marginBottom: 2 }}>
                        <span style={{ color: 'var(--t3)' }}>Factuurvolume: </span>
                        <strong style={{ fontFamily: 'var(--mono)' }}>{sug.suggestFv !== 0 ? fmt(sug.suggestFv) : '—'}</strong>
                      </div>
                      <div style={{ fontSize: 11, marginBottom: 8 }}>
                        <span style={{ color: 'var(--t3)' }}>OHW mutatie: </span>
                        {hasOhw ? (
                          <strong style={{ fontFamily: 'var(--mono)', color: ohwMut >= 0 ? 'var(--green)' : 'var(--red)' }}>
                            {fmt(ohwMut)}
                          </strong>
                        ) : (
                          <span style={{ color: 'var(--t3)' }}>automatisch vanuit OHW</span>
                        )}
                        <span style={{ marginLeft: 4, fontSize: 9 }}>🔒</span>
                      </div>
                      <button
                        className="btn sm ghost"
                        style={{ fontSize: 10, width: '100%' }}
                        onClick={() => {
                          const e = entry(sug.bv)
                          if (!e || sug.suggestFv === 0) return
                          updateEntry(e.id, { factuurvolume: sug.suggestFv })
                          showToast(`Factuurvolume suggestie toegepast voor ${sug.bv}`, 'g')
                        }}
                      >
                        ↓ Pas factuurvolume toe
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Onderbouwing status */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--t3)' }}>Onderbouwing {month}:</span>
              {UPLOAD_SLOTS.filter(s => s.appliesTo.length > 0).map(slot => {
                const ok = importRecords.some(r => r.month === month && r.slotId === slot.id && r.status === 'approved')
                return (
                  <span key={slot.id} style={{
                    fontSize: 10, padding: '2px 7px', borderRadius: 4,
                    background: ok ? 'var(--bd-green)' : 'var(--bd)',
                    color: ok ? 'var(--green)' : 'var(--t3)',
                    border: `1px solid ${ok ? 'var(--green)' : 'var(--bd2)'}`,
                  }}>
                    {slot.icon} {slot.label} {ok ? '✓' : '—'}
                  </span>
                )
              })}
            </div>

            {/* Warnings */}
            {warnings.length > 0 && (
              <div style={{ background: 'var(--bd-amber)', border: '1px solid var(--amber)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--amber)', marginBottom: 6 }}>⚠ Validatiewaarschuwingen</div>
                {warnings.map((w, i) => <div key={i} style={{ fontSize: 11, color: 'var(--amber)', marginBottom: 2 }}>• {w}</div>)}
              </div>
            )}

            {/* Input table */}
            <div className="card">
              <div className="card-hdr">
                <span className="card-title">Maandafsluiting invoer — {month}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>Alle bedragen in €</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ minWidth: 240, position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 3 }}>Omschrijving</th>
                      {BVS.map(bv => (
                        <th key={bv} className="r" style={{ minWidth: 165 }}>
                          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: BV_COLORS[bv], marginRight: 6 }} />
                          {bv}
                        </th>
                      ))}
                      <th className="r" style={{ minWidth: 160, fontWeight: 700 }}>Totaal</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ background: 'var(--bg3)' }}>
                      <td colSpan={5} style={{ padding: '8px 12px', fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', position: 'sticky', left: 0 }}>Omzet</td>
                    </tr>

                    {sectionRow('Factuurvolume (gefactureerde omzet)',
                      <>
                        {BVS.map(bv => {
                          const e = entry(bv)
                          const backed = importRecords.some(r => r.month === month && ['factuurvolume','conceptfacturen'].includes(r.slotId) && r.status === 'approved')
                          return (
                            <td key={bv} className="r" style={{ padding: '4px 8px' }}>
                              {e ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                                  {!backed && <span title="Geen upload onderbouwing" style={{ fontSize: 9, color: 'var(--amber)' }}>⚠</span>}
                                  <NumInput value={e.factuurvolume} onChange={v => update(e.id, 'factuurvolume', v)} />
                                </div>
                              ) : '—'}
                            </td>
                          )
                        })}
                        <td className="mono r" style={{ fontWeight: 700 }}>{fmt(totFactuur)}</td>
                      </>
                    )}

                    {sectionRow('Debiteuren (uitstaande vorderingen)',
                      <>
                        {BVS.map(bv => {
                          const e = entry(bv)
                          return (
                            <td key={bv} className="r" style={{ padding: '4px 8px' }}>
                              {e ? <NumInput value={e.debiteuren} onChange={v => update(e.id, 'debiteuren', v)} /> : '—'}
                            </td>
                          )
                        })}
                        <td className="mono r">{fmt(totDebiteuren)}</td>
                      </>
                    )}

                    {sectionRow('OHW mutatie (periode-allocatie)',
                      <>
                        {BVS.map(bv => {
                          const mut = getOhwMutatie(bv)
                          const hasData = ohwData2026.entities.some(e => e.entity === bv && e.mutatieOhw[month] != null)
                          return (
                            <td key={bv} className="r" style={{ padding: '4px 8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                                <span
                                  title="Automatisch ingevuld vanuit OHW Overzicht — wijzig dit in de OHW tab"
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 4,
                                    background: 'var(--bg3)', border: '1px solid var(--bd2)',
                                    borderRadius: 6, padding: '4px 10px',
                                    fontFamily: 'var(--mono)', fontSize: 12,
                                    color: mut >= 0 ? 'var(--green)' : 'var(--red)',
                                    cursor: 'default', userSelect: 'none',
                                    width: 130, justifyContent: 'flex-end',
                                  }}
                                >
                                  {hasData ? fmt(mut) : <span style={{ color: 'var(--t3)' }}>—</span>}
                                  <span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }} title="Automatisch vanuit OHW Overzicht">🔒</span>
                                </span>
                              </div>
                              {!hasData && (
                                <div style={{ fontSize: 9, color: 'var(--t3)', textAlign: 'right', marginTop: 2 }}>
                                  Geen OHW-data
                                </div>
                              )}
                            </td>
                          )
                        })}
                        <td className="mono r" style={{ color: totOhw >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(totOhw)}</td>
                      </>
                    )}

                    {sectionRow('Netto-omzet voor IC verrekening',
                      <>
                        {BVS.map(bv => (
                          <td key={bv} className="mono r" style={{ fontWeight: 600 }}>{fmt(getNettoomzetVoorIC(bv))}</td>
                        ))}
                        <td className="mono r" style={{ fontWeight: 600 }}>{fmt(totNetRevVoorIC)}</td>
                      </>, true
                    )}

                    {/* IC verrekening — read-only uit OHW */}
                    <tr>
                      <td style={{ padding: '5px 12px', position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 1 }}>
                        IC verrekening
                      </td>
                      {BVS.map(bv => {
                        const ic = getIcVerrekening(bv)
                        const hasData = ohwData2026.entities.some(e => e.entity === bv && e.totaalIC[month] != null)
                        return (
                          <td key={bv} className="r" style={{ padding: '4px 8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                              <span
                                title="Automatisch vanuit OHW Overzicht (IC verrekening) — wijzig dit in de OHW tab"
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 4,
                                  background: 'var(--bg3)', border: '1px solid var(--bd2)',
                                  borderRadius: 6, padding: '4px 10px',
                                  fontFamily: 'var(--mono)', fontSize: 12,
                                  color: !hasData ? 'var(--t3)' : ic >= 0 ? 'var(--green)' : 'var(--red)',
                                  cursor: 'default', userSelect: 'none',
                                  width: 130, justifyContent: 'flex-end',
                                }}
                              >
                                {hasData
                                  ? <>{ic >= 0 ? '+' : ''}{fmt(ic)}</>
                                  : <span style={{ color: 'var(--t3)' }}>—</span>}
                                <span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }}>🔒</span>
                              </span>
                            </div>
                          </td>
                        )
                      })}
                      <td className="mono r" style={{ color: totIc >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {totIc >= 0 ? '+' : ''}{fmt(totIc)}
                      </td>
                    </tr>

                    {sectionRow('Accruals / overlopende posten',
                      <>
                        {BVS.map(bv => {
                          const e = entry(bv)
                          return (
                            <td key={bv} className="r" style={{ padding: '4px 8px' }}>
                              {e ? <NumInput value={e.accruals} onChange={v => update(e.id, 'accruals', v)} /> : '—'}
                            </td>
                          )
                        })}
                        <td className="mono r">{fmt(totAccruals)}</td>
                      </>
                    )}

                    {sectionRow('Handmatige correctie',
                      <>
                        {BVS.map(bv => {
                          const e = entry(bv)
                          return (
                            <td key={bv} className="r" style={{ padding: '4px 8px' }}>
                              {e ? <NumInput value={e.handmatigeCorrectie} onChange={v => update(e.id, 'handmatigeCorrectie', v)} color={e.handmatigeCorrectie !== 0 ? 'var(--amber)' : undefined} /> : '—'}
                            </td>
                          )
                        })}
                        <td className="mono r" style={{ color: totHandmatig !== 0 ? 'var(--amber)' : undefined }}>{fmt(totHandmatig)}</td>
                      </>
                    )}

                    {sectionRow('Netto-omzet definitief',
                      <>
                        {BVS.map(bv => {
                          const e = entry(bv)
                          return <td key={bv} className="mono r" style={{ fontWeight: 700 }}>{fmt(e ? netRevenue(e, bv) : 0)}</td>
                        })}
                        <td className="mono r" style={{ fontWeight: 700 }}>{fmt(totNetRev)}</td>
                      </>, true
                    )}

                    <tr style={{ background: 'var(--bg3)' }}>
                      <td colSpan={5} style={{ padding: '8px 12px', fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', position: 'sticky', left: 0 }}>Kosten</td>
                    </tr>

                    {/* ── Directe kosten (uitklapbaar) ── */}
                    <tr
                      style={{ background: 'var(--bg3)', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => toggleCostSection('directe_kosten')}
                    >
                      <td style={{ padding: '6px 12px', fontWeight: 600, position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 1 }}>
                        <span style={{ fontSize: 10, marginRight: 6, display: 'inline-block', transition: 'transform .2s', transform: expandedCosts.has('directe_kosten') ? 'rotate(90deg)' : 'none' }}>▶</span>
                        Directe kosten
                        <span style={{ marginLeft: 8, fontSize: 9, color: 'var(--t3)', fontWeight: 400 }}>{expandedCosts.has('directe_kosten') ? 'inklappen' : 'uitklappen'}</span>
                      </td>
                      {BVS.map(bv => {
                        const a = monthlyActuals2026[bv as EntityName]?.[month]
                        return <td key={bv} className="mono r" style={{ fontWeight: 600, color: 'var(--t2)' }}>{fmt(a?.['directe_kosten'] ?? 0)}</td>
                      })}
                      <td className="mono r" style={{ fontWeight: 600, color: 'var(--t2)' }}>{fmt(-totCosts)}</td>
                    </tr>
                    {expandedCosts.has('directe_kosten') && <>
                      {DIRECTE_KOSTEN_SUBS.map(sub => {
                        const rowTot = BVS.reduce((s, bv) => s + getKostenVal(bv, sub.key), 0)
                        const isOverridden = BVS.some(bv => entry(bv)?.kostenOverrides[sub.key] !== undefined)
                        return (
                          <tr key={sub.key} style={{ background: 'var(--bg1)' }}>
                            <td style={{ padding: '4px 12px', paddingLeft: 30, fontSize: 11, color: isOverridden ? 'var(--amber)' : 'var(--t2)', position: 'sticky', left: 0, background: 'var(--bg1)', zIndex: 1 }}>
                              {sub.label}{isOverridden && <span style={{ marginLeft: 5, fontSize: 9 }}>✏</span>}
                            </td>
                            {BVS.map(bv => (
                              <td key={bv} className="r" style={{ padding: '3px 8px' }}>
                                <NumInput
                                  value={getKostenVal(bv, sub.key)}
                                  onChange={v => updateKosten(bv, sub.key, v)}
                                  color={entry(bv)?.kostenOverrides[sub.key] !== undefined ? 'var(--amber)' : undefined}
                                />
                              </td>
                            ))}
                            <td className="mono r" style={{ fontSize: 11, fontWeight: 600 }}>{fmt(rowTot)}</td>
                          </tr>
                        )
                      })}
                    </>}
                    {!expandedCosts.has('directe_kosten') && (
                      <tr style={{ background: 'var(--bg1)' }}>
                        <td colSpan={5} style={{ padding: '2px 12px', paddingLeft: 30, fontSize: 10, color: 'var(--t3)', position: 'sticky', left: 0 }}>
                          {DIRECTE_KOSTEN_SUBS.map(s => s.label).join(' · ')}
                          {DIRECTE_KOSTEN_SUBS.some(sub => BVS.some(bv => entry(bv)?.kostenOverrides[sub.key] !== undefined)) && <span style={{ color: 'var(--amber)', marginLeft: 6 }}>✏ aangepaste regels</span>}
                        </td>
                      </tr>
                    )}

                    {/* ── Operationele kosten (uitklapbaar) ── */}
                    <tr
                      style={{ background: 'var(--bg3)', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => toggleCostSection('operationele_kosten')}
                    >
                      <td style={{ padding: '6px 12px', fontWeight: 600, position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 1 }}>
                        <span style={{ fontSize: 10, marginRight: 6, display: 'inline-block', transition: 'transform .2s', transform: expandedCosts.has('operationele_kosten') ? 'rotate(90deg)' : 'none' }}>▶</span>
                        Operationele kosten
                        <span style={{ marginLeft: 8, fontSize: 9, color: 'var(--t3)', fontWeight: 400 }}>{expandedCosts.has('operationele_kosten') ? 'inklappen' : 'uitklappen'}</span>
                      </td>
                      {BVS.map(bv => {
                        const v = opKosten(bv)
                        const hasOverride = OPERATIONELE_KOSTEN_SUBS.some(sub => entry(bv)?.kostenOverrides[sub.key] !== undefined)
                        return <td key={bv} className="mono r" style={{ fontWeight: 600, color: hasOverride ? 'var(--amber)' : 'var(--t2)' }}>{fmt(-v)}</td>
                      })}
                      <td className="mono r" style={{ fontWeight: 600, color: 'var(--t2)' }}>{fmt(-totOpKosten)}</td>
                    </tr>
                    {expandedCosts.has('operationele_kosten') && <>
                      {OPERATIONELE_KOSTEN_SUBS.map(sub => {
                        const rowTot = BVS.reduce((s, bv) => s + getKostenVal(bv, sub.key), 0)
                        const isOverridden = BVS.some(bv => entry(bv)?.kostenOverrides[sub.key] !== undefined)
                        return (
                          <tr key={sub.key} style={{ background: 'var(--bg1)' }}>
                            <td style={{ padding: '4px 12px', paddingLeft: 30, fontSize: 11, color: isOverridden ? 'var(--amber)' : 'var(--t2)', position: 'sticky', left: 0, background: 'var(--bg1)', zIndex: 1 }}>
                              {sub.label}{isOverridden && <span style={{ marginLeft: 5, fontSize: 9 }}>✏</span>}
                            </td>
                            {BVS.map(bv => (
                              <td key={bv} className="r" style={{ padding: '3px 8px' }}>
                                <NumInput
                                  value={getKostenVal(bv, sub.key)}
                                  onChange={v => updateKosten(bv, sub.key, v)}
                                  color={entry(bv)?.kostenOverrides[sub.key] !== undefined ? 'var(--amber)' : undefined}
                                />
                              </td>
                            ))}
                            <td className="mono r" style={{ fontSize: 11, fontWeight: 600 }}>{fmt(rowTot)}</td>
                          </tr>
                        )
                      })}
                    </>}
                    {!expandedCosts.has('operationele_kosten') && (
                      <tr style={{ background: 'var(--bg1)' }}>
                        <td colSpan={5} style={{ padding: '2px 12px', paddingLeft: 30, fontSize: 10, color: 'var(--t3)', position: 'sticky', left: 0 }}>
                          {OPERATIONELE_KOSTEN_SUBS.map(s => s.label).join(' · ')}
                          {OPERATIONELE_KOSTEN_SUBS.some(sub => BVS.some(bv => entry(bv)?.kostenOverrides[sub.key] !== undefined)) && <span style={{ color: 'var(--amber)', marginLeft: 6 }}>✏ aangepaste regels</span>}
                        </td>
                      </tr>
                    )}

                    {/* ── Amortisatie & afschrijvingen (uitklapbaar) ── */}
                    <tr
                      style={{ background: 'var(--bg3)', cursor: 'pointer', userSelect: 'none' }}
                      onClick={() => toggleCostSection('amortisatie_afschrijvingen')}
                    >
                      <td style={{ padding: '6px 12px', fontWeight: 600, position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 1 }}>
                        <span style={{ fontSize: 10, marginRight: 6, display: 'inline-block', transition: 'transform .2s', transform: expandedCosts.has('amortisatie_afschrijvingen') ? 'rotate(90deg)' : 'none' }}>▶</span>
                        Amortisatie &amp; afschrijvingen
                        <span style={{ marginLeft: 8, fontSize: 9, color: 'var(--t3)', fontWeight: 400 }}>{expandedCosts.has('amortisatie_afschrijvingen') ? 'inklappen' : 'uitklappen'}</span>
                      </td>
                      {BVS.map(bv => {
                        const v = amortisatie(bv)
                        const hasOverride = AMORTISATIE_SUBS.some(sub => entry(bv)?.kostenOverrides[sub.key] !== undefined)
                        return <td key={bv} className="mono r" style={{ fontWeight: 600, color: hasOverride ? 'var(--amber)' : 'var(--t2)' }}>{fmt(-v)}</td>
                      })}
                      <td className="mono r" style={{ fontWeight: 600, color: 'var(--t2)' }}>{fmt(-totAmortisatie)}</td>
                    </tr>
                    {expandedCosts.has('amortisatie_afschrijvingen') && <>
                      {AMORTISATIE_SUBS.map(sub => {
                        const rowTot = BVS.reduce((s, bv) => s + getKostenVal(bv, sub.key), 0)
                        const isOverridden = BVS.some(bv => entry(bv)?.kostenOverrides[sub.key] !== undefined)
                        return (
                          <tr key={sub.key} style={{ background: 'var(--bg1)' }}>
                            <td style={{ padding: '4px 12px', paddingLeft: 30, fontSize: 11, color: isOverridden ? 'var(--amber)' : 'var(--t2)', position: 'sticky', left: 0, background: 'var(--bg1)', zIndex: 1 }}>
                              {sub.label}{isOverridden && <span style={{ marginLeft: 5, fontSize: 9 }}>✏</span>}
                            </td>
                            {BVS.map(bv => (
                              <td key={bv} className="r" style={{ padding: '3px 8px' }}>
                                <NumInput
                                  value={getKostenVal(bv, sub.key)}
                                  onChange={v => updateKosten(bv, sub.key, v)}
                                  color={entry(bv)?.kostenOverrides[sub.key] !== undefined ? 'var(--amber)' : undefined}
                                />
                              </td>
                            ))}
                            <td className="mono r" style={{ fontSize: 11, fontWeight: 600 }}>{fmt(rowTot)}</td>
                          </tr>
                        )
                      })}
                    </>}
                    {!expandedCosts.has('amortisatie_afschrijvingen') && (
                      <tr style={{ background: 'var(--bg1)' }}>
                        <td colSpan={5} style={{ padding: '2px 12px', paddingLeft: 30, fontSize: 10, color: 'var(--t3)', position: 'sticky', left: 0 }}>
                          {AMORTISATIE_SUBS.map(s => s.label).join(' · ')}
                          {AMORTISATIE_SUBS.some(sub => BVS.some(bv => entry(bv)?.kostenOverrides[sub.key] !== undefined)) && <span style={{ color: 'var(--amber)', marginLeft: 6 }}>✏ aangepaste regels</span>}
                        </td>
                      </tr>
                    )}

                    <tr style={{ background: 'var(--bg3)' }}>
                      <td colSpan={5} style={{ padding: '8px 12px', fontSize: 10, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', position: 'sticky', left: 0 }}>Resultaat</td>
                    </tr>

                    {sectionRow('Brutomarge definitief',
                      <>
                        {BVS.map(bv => {
                          const gm = grossMargin(bv)
                          const e  = entry(bv)
                          const nr = e ? netRevenue(e, bv) : 0
                          const pct = nr > 0 ? (gm / nr * 100).toFixed(1) : '—'
                          return (
                            <td key={bv} className="mono r" style={{ color: gm >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                              {fmt(gm)} <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--t3)' }}>({pct}%)</span>
                            </td>
                          )
                        })}
                        <td className="mono r" style={{ color: totMargin >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                          {fmt(totMargin)} <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--t3)' }}>({totMarginPct.toFixed(1)}%)</span>
                        </td>
                      </>, true
                    )}

                    {sectionRow('EBITDA',
                      <>
                        {BVS.map(bv => {
                          const eb = ebitda(bv)
                          const nr = entry(bv) ? netRevenue(entry(bv)!, bv) : 0
                          const pct = nr > 0 ? (eb / nr * 100).toFixed(1) : '—'
                          return (
                            <td key={bv} className="mono r" style={{ color: eb >= 0 ? 'var(--t1)' : 'var(--red)', fontWeight: 600 }}>
                              {fmt(eb)} <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--t3)' }}>({pct}%)</span>
                            </td>
                          )
                        })}
                        <td className="mono r" style={{ fontWeight: 600, color: totEbitda >= 0 ? 'var(--t1)' : 'var(--red)' }}>
                          {fmt(totEbitda)}
                        </td>
                      </>, true
                    )}

                    {sectionRow('EBIT',
                      <>
                        {BVS.map(bv => {
                          const eb = ebit(bv)
                          return (
                            <td key={bv} className="mono r" style={{ color: eb >= 0 ? 'var(--t1)' : 'var(--red)', fontWeight: 600 }}>
                              {fmt(eb)}
                            </td>
                          )
                        })}
                        <td className="mono r" style={{ fontWeight: 600, color: totEbit >= 0 ? 'var(--t1)' : 'var(--red)' }}>
                          {fmt(totEbit)}
                        </td>
                      </>, true
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Toelichtingen */}
            <div className="card">
              <div className="card-hdr"><span className="card-title">Toelichtingen — {month}</span></div>
              <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {BVS.map(bv => {
                  const e = entry(bv)
                  return (
                    <div key={bv}>
                      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: BV_COLORS[bv] }}>{bv}</div>
                      <textarea
                        style={{ width: '100%', minHeight: 72, background: 'var(--bg3)', border: '1px solid var(--bd2)', borderRadius: 6, color: 'var(--t1)', fontSize: 11, padding: '7px 9px', fontFamily: 'var(--font)', resize: 'vertical', outline: 'none' }}
                        placeholder="Toelichting correcties..."
                        value={e?.remark ?? ''}
                        onChange={ev => e && update(e.id, 'remark', ev.target.value)}
                      />
                    </div>
                  )
                })}
              </div>
            </div>

            {/* P&L aansluiting */}
            {monthlyActuals2026['Consultancy']?.[month] && (
              <div className="card">
                <div className="card-hdr"><span className="card-title">Aansluiting P&amp;L — {month}</span></div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th style={{ minWidth: 140 }}>BV</th>
                        <th className="r">Netto-omzet (closing)</th>
                        <th className="r">Netto-omzet (P&L)</th>
                        <th className="r">Verschil</th>
                        <th className="r">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {BVS.map(bv => {
                        const e = entry(bv)
                        const closingRev = e ? netRevenue(e, bv) : 0
                        const plRev = monthlyActuals2026[bv as EntityName]?.[month]?.['netto_omzet'] ?? 0
                        const diff  = closingRev - plRev
                        const chk   = actualsCheck(bv)
                        const ok    = chk ? chk.pct < 0.5 : closingRev === 0
                        return (
                          <tr key={bv}>
                            <td><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: BV_COLORS[bv], marginRight: 6 }} />{bv}</td>
                            <td className="mono r">{fmt(closingRev)}</td>
                            <td className="mono r" style={{ color: 'var(--t3)' }}>{fmt(plRev)}</td>
                            <td className="mono r" style={{ color: Math.abs(diff) < 1 ? 'var(--t3)' : 'var(--amber)' }}>
                              {Math.abs(diff) < 1 ? '—' : (diff > 0 ? '+' : '') + fmt(diff)}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <span style={{ fontSize: 12, color: ok ? 'var(--green)' : 'var(--amber)' }}>
                                {ok ? '✓ Aansluitend' : '⚠ Verschil'}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                      <tr className="tot">
                        <td>Totaal</td>
                        <td className="mono r">{fmt(totNetRev)}</td>
                        <td className="mono r" style={{ color: 'var(--t3)' }}>
                          {fmt(BVS.reduce((a, bv) => a + (monthlyActuals2026[bv as EntityName]?.[month]?.['netto_omzet'] ?? 0), 0))}
                        </td>
                        <td className="mono r">—</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── OHW Overzicht ─────────────────────────────────────────── */}
            {(() => {
              const BV_COLORS: Record<BvId, string> = { Consultancy: '#4d8ef8', Projects: '#26c997', Software: '#8b5cf6' }
              const ohwMonthKey = month // 'Jan-26', 'Feb-26', 'Mar-26'
              const hasOhwData = ohwData2026.entities.some(e => e.nettoOmzet[ohwMonthKey] != null)
              return (
                <div className="card">
                  <div className="card-hdr">
                    <span className="card-title">OHW Overzicht — {month}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--green)', background: 'var(--bd-green)', padding: '2px 7px', borderRadius: 4 }}>
                      ● Live vanuit OHW tab
                    </span>
                  </div>
                  {!hasOhwData ? (
                    <div style={{ padding: '20px 16px', fontSize: 12, color: 'var(--t3)', textAlign: 'center' }}>
                      Geen OHW-data beschikbaar voor {month}.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th style={{ minWidth: 220, position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 2 }}>Metric</th>
                            {BVS.map(bv => (
                              <th key={bv} className="r" style={{ minWidth: 150 }}>
                                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: BV_COLORS[bv], marginRight: 6 }} />
                                {bv}
                              </th>
                            ))}
                            <th className="r" style={{ minWidth: 150, fontWeight: 700 }}>Totaal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            { key: 'totaalOnderhanden',    label: 'Totaal OHW (saldo)',       bold: true },
                            { key: 'mutatieOhw',           label: 'Mutatie OHW',              bold: false },
                            { key: 'totaalIC',             label: 'IC-verrekening',           bold: false },
                            { key: 'nettoOmzet',           label: 'Netto-omzet (OHW-bijdrage)', bold: true },
                            { key: 'budget',               label: 'Budget',                   bold: false },
                            { key: 'delta',                label: 'Delta (Actuals vs Budget)', bold: false },
                          ].map(row => {
                            const vals = BVS.map(bv => {
                              const entity = ohwData2026.entities.find(e => e.entity === bv)
                              const v = entity?.[row.key as keyof typeof entity] as Record<string, number | null> | undefined
                              return v?.[ohwMonthKey] ?? null
                            })
                            const tot = vals.reduce<number>((s, v) => s + (v ?? 0), 0)
                            const isMatchRow = row.key === 'nettoOmzet'
                            return (
                              <tr key={row.key} style={{ background: row.bold ? 'var(--bg3)' : undefined }}>
                                <td style={{ padding: '5px 12px', fontWeight: row.bold ? 700 : 400, position: 'sticky', left: 0, background: row.bold ? 'var(--bg3)' : 'var(--bg2)', zIndex: 1 }}>
                                  {row.label}
                                </td>
                                {vals.map((v, i) => {
                                  const bv = BVS[i]
                                  const closingVal = entry(bv) ? (row.key === 'nettoOmzet' ? netRevenue(entry(bv)!, bv) : null) : null
                                  const diff = isMatchRow && closingVal != null && v != null ? closingVal - v : null
                                  return (
                                    <td key={bv} className="mono r" style={{ padding: '5px 8px', fontWeight: row.bold ? 700 : 400 }}>
                                      {v != null ? (
                                        <>
                                          <span style={{ color: row.key === 'delta' ? (v >= 0 ? 'var(--green)' : 'var(--red)') : undefined }}>
                                            {row.key === 'delta' && v >= 0 ? '+' : ''}{fmt(v)}
                                          </span>
                                          {isMatchRow && diff != null && Math.abs(diff) > 1 && (
                                            <span style={{ fontSize: 9, color: 'var(--amber)', marginLeft: 4 }} title="Verschil t.o.v. closing invoer">
                                              ⚠ Δ{fmt(diff)}
                                            </span>
                                          )}
                                        </>
                                      ) : <span style={{ color: 'var(--t3)' }}>—</span>}
                                    </td>
                                  )
                                })}
                                <td className="mono r" style={{ padding: '5px 8px', fontWeight: row.bold ? 700 : 400, color: row.key === 'delta' ? (tot >= 0 ? 'var(--green)' : 'var(--red)') : undefined }}>
                                  {row.key === 'delta' && tot >= 0 ? '+' : ''}{fmt(tot)}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div style={{ padding: '8px 14px', fontSize: 10, color: 'var(--t3)', borderTop: '1px solid var(--bd)' }}>
                    ⚠ Discrepanties (Δ) tussen OHW-tab en Closing invoer duiden op een afwijking — gebruik "🔄 Sync OHW" om te synchroniseren.
                  </div>
                </div>
              )
            })()}

            {/* ── FTE & Headcount ───────────────────────────────────────── */}
            {FTE_MONTHS.includes(month) && (
              <div className="card">
                <div className="card-hdr">
                  <span className="card-title">FTE &amp; Headcount — {month}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>Personeelsinzet per BV</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th style={{ minWidth: 200, position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 2 }}>BV</th>
                        <th className="r" style={{ minWidth: 160 }}>FTE (voltijdsequivalent)</th>
                        <th className="r" style={{ minWidth: 160 }}>Headcount (personen)</th>
                        <th className="r" style={{ minWidth: 140 }}>FTE/HC verhouding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {BVS.map(bv => {
                        const fe = fteEntry(bv)
                        if (!fe) return null
                        const ratio = fe.headcount > 0 ? (fe.fte / fe.headcount * 100).toFixed(1) + '%' : '—'
                        return (
                          <tr key={bv}>
                            <td style={{ position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 1 }}>
                              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: BV_COLORS[bv], marginRight: 6 }} />
                              <strong>{bv}</strong>
                            </td>
                            <td className="r" style={{ padding: '4px 8px' }}>
                              <input
                                className="ohw-inp"
                                style={{ width: 110, textAlign: 'right' }}
                                value={fe.fte === 0 ? '' : fe.fte.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                                placeholder="0.0"
                                onChange={e => {
                                  const v = parseFloat(e.target.value.replace(',', '.'))
                                  if (!isNaN(v)) updateFte(fe.id, { fte: v })
                                }}
                              />
                            </td>
                            <td className="r" style={{ padding: '4px 8px' }}>
                              <input
                                className="ohw-inp"
                                style={{ width: 110, textAlign: 'right' }}
                                value={fe.headcount === 0 ? '' : fe.headcount}
                                placeholder="0"
                                onChange={e => {
                                  const v = parseInt(e.target.value)
                                  if (!isNaN(v)) updateFte(fe.id, { headcount: v })
                                }}
                              />
                            </td>
                            <td className="mono r" style={{ color: 'var(--t3)', fontWeight: 600 }}>{ratio}</td>
                          </tr>
                        )
                      })}
                      <tr className="tot">
                        <td style={{ position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 1 }}>Totaal</td>
                        <td className="mono r">
                          {BVS.reduce((s, bv) => s + (fteEntry(bv)?.fte ?? 0), 0).toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                        </td>
                        <td className="mono r">
                          {BVS.reduce((s, bv) => s + (fteEntry(bv)?.headcount ?? 0), 0)}
                        </td>
                        <td className="mono r" style={{ color: 'var(--t3)' }}>
                          {(() => {
                            const totFte = BVS.reduce((s, bv) => s + (fteEntry(bv)?.fte ?? 0), 0)
                            const totHc  = BVS.reduce((s, bv) => s + (fteEntry(bv)?.headcount ?? 0), 0)
                            return totHc > 0 ? (totFte / totHc * 100).toFixed(1) + '%' : '—'
                          })()}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {warnings.length === 0 && totNetRev > 0 && (
              <div style={{ background: 'var(--bd-green)', border: '1px solid var(--green)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--green)', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 16 }}>✓</span>
                Maandafsluiting {month} is gereed — alle controles geslaagd. Brutomarge {totMarginPct.toFixed(1)}% over netto-omzet {fmt(totNetRev)}.
              </div>
            )}
          </>
        )}
      </div>

      {/* Approval modal */}
      {pendingRecord && (
        <ImportApprovalModal
          record={pendingRecord}
          onApprove={() => handleApprove(pendingRecord)}
          onReject={(reason) => handleReject(pendingRecord, reason)}
          onClose={() => { setPendingRecord(null); setPendingFile(null) }}
          onReparse={pendingFile ? handleReparse : undefined}
        />
      )}

      <Toast toasts={toasts} />
    </>
  )
}
