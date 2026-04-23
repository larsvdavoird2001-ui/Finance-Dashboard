import { useRef, useState, useEffect } from 'react'
import { flushSync } from 'react-dom'
import { useFinStore, CLOSING_MONTHS } from '../../store/useFinStore'
import { useImportStore } from '../../store/useImportStore'
import { useOhwStore } from '../../store/useOhwStore'
import { useFteStore, FTE_MONTHS } from '../../store/useFteStore'
import { monthlyActuals2026 } from '../../data/plData'
import type { EntityName } from '../../data/plData'
import { fmt, parseNL } from '../../lib/format'
import {
  parseImportFile,
  buildTariffLookup,
  readWorkbookFromFile,
  computeMissingHours,
  getMissingHoursSlotConfig,
} from '../../lib/parseImport'
import type { ParseOverrides, ParseResult, MissingHoursComputeConfig } from '../../lib/parseImport'
import type * as XLSX from 'xlsx'
import { MissingHoursWizard } from './MissingHoursWizard'
import { GenericImportWizard } from './GenericImportWizard'
import { BijlagenSection } from './BijlagenSection'
import { buildMonthBundleZip, downloadBlob } from '../../lib/exportMonthBundle'
import { generateMonthPptx, monthLabelFromCode } from '../../lib/exportPptx'
import { useRawDataStore as useRawDataStoreFull } from '../../store/useRawDataStore'

const GENERIC_WIZARD_SLOTS = new Set(['factuurvolume', 'geschreven_uren', 'uren_lijst', 'd_lijst', 'conceptfacturen'])
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
  Consultancy: '#00a9e0',
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
  /** OHW-rij die gevuld wordt bij goedkeuring (single-BV slot) */
  targetRowId?: string
  /** Entity (BV) waar de OHW-rij in zit (single-BV slot) */
  targetEntity?: string
  /** Multi-BV mapping: per BV een OHW-rij. Gebruikt i.p.v. targetRowId/Entity
   *  voor slots zoals uren_lijst waar de ruwe data per BV verdeeld wordt. */
  targetRowByBv?: Partial<Record<BvId, string>>
}

const UPLOAD_SLOTS: UploadSlot[] = [
  { id: 'factuurvolume',   label: 'Factuurvolume',    icon: '🧾', description: 'SAP facturenlijst — gefactureerde omzet per BV (alle BVs)', appliesTo: ['factuurvolume'] },
  { id: 'geschreven_uren', label: 'Geschreven uren',  icon: '⏱', description: 'SAP urenregistratie — totaal geschreven uren per BV (alle BVs)', appliesTo: [] },
  { id: 'uren_lijst',      label: 'Uren lijst',       icon: '📋', description: 'Alle BVs — nettowaarde per BV → OHW-regel "U-Projecten met tarief" per BV', appliesTo: [], targetRowByBv: { Consultancy: 'c_ul', Projects: 'p1', Software: 's_ul' } },
  { id: 'd_lijst',         label: 'D Lijst',          icon: '📊', description: 'Alleen Consultancy — vult OHW-regel "D facturatie"', appliesTo: [], targetBv: 'Consultancy', targetRowId: 'c1', targetEntity: 'Consultancy' },
  { id: 'conceptfacturen', label: 'Conceptfacturen',  icon: '📄', description: 'Alleen Projects — vult OHW-regel "E-Projecten (concept facturen) wachtend op inkooporder"', appliesTo: [], targetBv: 'Projects', targetRowId: 'p4', targetEntity: 'Projects' },
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
  const [activeSection, setActiveSection] = useState<'afsluiting' | 'import' | 'export' | 'tarieven' | 'bijlagen'>('afsluiting')
  const [expandedCosts, setExpandedCosts] = useState<Set<CostSectionId>>(new Set())
  const toggleCostSection = (id: CostSectionId) =>
    setExpandedCosts(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const [uploadMonth, setUploadMonth] = useState<string>('Mar-26')
  const [uploadLoading, setUploadLoading] = useState<Record<string, boolean>>({})
  const [pendingRecord, setPendingRecord] = useState<ImportRecord | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  // Missing Hours wizard state (stap-voor-stap analyse van uploaded bestand)
  const [wizardState, setWizardState] = useState<{ workbook: XLSX.WorkBook; fileName: string; file: File } | null>(null)
  // Generic wizard state — voor factuurvolume / geschreven_uren / uren_lijst / d_lijst / conceptfacturen
  const [genericWizardState, setGenericWizardState] = useState<{ workbook: XLSX.WorkBook; fileName: string; file: File; slotId: string } | null>(null)
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
  const { records: importRecords, addRecord, approveRecord, rejectRecord, removeRecord, updateRecordValues, exportPeriod } = useImportStore()
  const { addEntry: addRawEntry, approveEntry: approveRawEntry, rejectEntry: rejectRawEntry, entries: rawDataEntries } = useRawDataStore()
  const { toasts, showToast } = useToast()
  const ohwData2026 = useOhwStore(s => s.data2026)
  const updateRowValue = useOhwStore(s => s.updateRowValue)
  const tariffEntries = useTariffStore(s => s.entries)
  const updateTariffEntry = useTariffStore(s => s.updateEntry)
  const addTariffEntry = useTariffStore(s => s.addEntry)

  // Bouw multi-key lookup voor missing hours parser — ALLEEN Consultancy
  // medewerkers; werknemer kan worden gematcht op werknemernr, SAP alias
  // (powerbiNaam2), "Achternaam, Voornaam" (powerbiNaam) of volledige naam.
  const tariffLookup = buildTariffLookup(tariffEntries, 'Consultancy')
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
    // Missing hours: open de wizard (sheet + header-rij + kolommen bevestigen)
    // in plaats van direct parsen — zo worden bestanden met title-rijen,
    // lege rijen boven de tabel, of afwijkende kolomnamen ook correct verwerkt.
    if (slotId === 'missing_hours') {
      setUploadLoading(prev => ({ ...prev, [slotId]: true }))
      try {
        const workbook = await readWorkbookFromFile(file)
        setWizardState({ workbook, fileName: file.name, file })
      } catch (err) {
        showToast(`Kon bestand niet openen: ${err instanceof Error ? err.message : String(err)}`, 'r')
      } finally {
        setUploadLoading(prev => ({ ...prev, [slotId]: false }))
      }
      return
    }

    // Generic wizard: zelfde workflow (sheet/header/kolommen/verfijnen) voor
    // factuurvolume, geschreven_uren, uren_lijst, d_lijst en conceptfacturen.
    if (GENERIC_WIZARD_SLOTS.has(slotId)) {
      setUploadLoading(prev => ({ ...prev, [slotId]: true }))
      try {
        const workbook = await readWorkbookFromFile(file)
        setGenericWizardState({ workbook, fileName: file.name, file, slotId })
      } catch (err) {
        showToast(`Kon bestand niet openen: ${err instanceof Error ? err.message : String(err)}`, 'r')
      } finally {
        setUploadLoading(prev => ({ ...prev, [slotId]: false }))
      }
      return
    }

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
        warnings: result.warnings,
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
      // Voor missing_hours: waarschuw bij 0 matches zodat user direct ziet dat
      // de kolomselectie aangepast moet worden.
      if (slotId === 'missing_hours' && result.totalAmount === 0) {
        showToast('Missing Hours: 0 matches — controleer de kolomselectie in de popup', 'r')
      } else if (result.warnings.length > 0) {
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
        warnings: result.warnings,
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

    // Multi-BV OHW target: per BV een eigen rij (bijv. uren_lijst)
    if (slot.targetRowByBv) {
      let total = 0
      const bvLabels: string[] = []
      for (const bv of BVS) {
        const rowId = slot.targetRowByBv[bv]
        if (!rowId) continue
        const amount = record.perBv[bv] ?? 0
        if (amount === 0) continue
        updateRowValue('2026', bv, rowId, record.month, amount)
        total += amount
        applied++
        bvLabels.push(`${bv}: ${fmt(amount)}`)
      }
      if (applied > 0) {
        showToast(`${record.slotLabel} verdeeld over ${applied} BV(s) — ${bvLabels.join(' · ')}`, 'g')
      } else {
        showToast(`${record.slotLabel}: geen BV-verdeling gevonden — controleer de BV-kolom`, 'r')
      }
      return
    }

    // Single-BV OHW target: een specifieke rij in één BV
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
    // flushSync: commit de modal-close onmiddellijk (in plaats van batched met
    // de store-updates hieronder). Mocht een downstream store-call gooien —
    // bv. localStorage-quota bij grote imports — dan is de modal al dicht.
    flushSync(() => {
      setPendingRecord(null)
      setPendingFile(null)
    })
    // Elke stap in z'n eigen try/catch zodat een fout in stap X de andere
    // stappen niet overslaat (voorbeeld: approveRawEntry faalt op localStorage
    // quota, maar OHW-regel moet nog steeds geupdated worden).
    try { approveRecord(record.id) } catch (err) { console.error('approveRecord faalde:', err) }
    try { approveRawEntry(record.id) } catch (err) { console.error('approveRawEntry faalde:', err) }
    try {
      applyImportToEntries(record)
      showToast(`${record.slotLabel} goedgekeurd en toegepast`, 'g')
    } catch (err) {
      showToast(`Toepassen mislukt: ${err instanceof Error ? err.message : String(err)}`, 'r')
    }
  }

  const handleReject = (record: ImportRecord, reason: string) => {
    flushSync(() => {
      setPendingRecord(null)
      setPendingFile(null)
    })
    try { rejectRecord(record.id, reason) } catch (err) { console.error('rejectRecord faalde:', err) }
    try { rejectRawEntry(record.id) } catch (err) { console.error('rejectRawEntry faalde:', err) }
    showToast(`${record.slotLabel} afgekeurd`, 'r')
  }

  /** Herberekent een bestaand missing_hours record met de HUIDIGE IC-tarieven.
   *  Update record.perBv/totalAmount/parsedCount en — als het record al
   *  goedgekeurd is — de OHW-rij c4 (Consultancy missing hours).
   *
   *  Return: nieuwe totalAmount, of null als herberekenen niet kon (bv. raw
   *  rows zijn niet in geheugen). Zwijgt bij problemen — dit is een
   *  achtergrond-update, geen user-initiated actie. */
  const recomputeMissingHoursRecord = (record: ImportRecord): number | null => {
    if (record.slotId !== 'missing_hours') return null
    const rawEntry = rawDataEntries.find(e => e.recordId === record.id)
    if (!rawEntry || !rawEntry.rows || rawEntry.rows.length === 0) return null
    if (!rawEntry.amountCol || !rawEntry.bvCol) return null

    try {
      const cfg: MissingHoursComputeConfig = {
        werknemerCol: rawEntry.bvCol,    // opgeslagen als bvCol
        urenCol: rawEntry.amountCol,     // opgeslagen als amountCol
        bedrijfCol: rawEntry.bedrijfCol,
        bedrijfFilter: rawEntry.bedrijfFilter,
      }
      const result = computeMissingHours(
        record.headers,
        rawEntry.rows,
        tariffLookup,
        cfg,
        getMissingHoursSlotConfig(),
      )
      // Alleen bijwerken als er daadwerkelijk iets is veranderd
      const oldTotal = record.totalAmount
      if (Math.abs(result.totalAmount - oldTotal) < 0.5) return oldTotal

      updateRecordValues(record.id, {
        perBv: result.perBv,
        totalAmount: result.totalAmount,
        parsedCount: result.parsedCount,
        warnings: result.warnings,
      })
      // Goedgekeurde records: ook de OHW-rij bijwerken (c4 voor Consultancy)
      if (record.status === 'approved') {
        const slot = UPLOAD_SLOTS.find(s => s.id === 'missing_hours')
        if (slot?.targetRowId && slot?.targetEntity) {
          updateRowValue('2026', slot.targetEntity, slot.targetRowId, record.month, result.totalAmount)
        }
      }
      return result.totalAmount
    } catch (err) {
      console.error('[recomputeMissingHoursRecord] faalde:', err)
      return null
    }
  }

  /** useEffect: bij elke tarief-wijziging checken of er missing_hours records
   *  zijn die opnieuw berekend moeten worden. Draait NIET op mount (skip als
   *  tariff-entries nog niet geladen zijn en records nog niet in store). */
  const recomputeRef = useRef<string>('')
  useEffect(() => {
    // Genereer een stabiele hash over de relevante tarief-data. Alleen
    // herberekenen als deze hash wijzigt t.o.v. vorige render (d.w.z. een
    // tarief is daadwerkelijk toegevoegd/gewijzigd, geen ander re-render).
    const tariffHash = tariffEntries
      .filter(t => t.bedrijf === 'Consultancy')
      .map(t => `${t.id}:${t.tarief}`)
      .sort()
      .join('|')
    if (recomputeRef.current === '') {
      // Eerste render — alleen hash opslaan, nog niet herberekenen
      recomputeRef.current = tariffHash
      return
    }
    if (recomputeRef.current === tariffHash) return
    recomputeRef.current = tariffHash

    // Recompute alle missing_hours records voor alle maanden
    const mhRecords = importRecords.filter(r => r.slotId === 'missing_hours' && r.status !== 'rejected')
    if (mhRecords.length === 0) return

    const updated: string[] = []
    for (const rec of mhRecords) {
      const newTotal = recomputeMissingHoursRecord(rec)
      if (newTotal !== null && newTotal !== rec.totalAmount) {
        updated.push(`${rec.month}: ${fmt(newTotal)}`)
      }
    }
    if (updated.length > 0) {
      showToast(`Missing Hours herberekend met bijgewerkte IC-tarieven — ${updated.join(' · ')}`, 'g')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tariffEntries])

  /** Verwijder een import record — als het record goedgekeurd was, maak ook
   *  de eventuele OHW-waarde / closing-entry-waarde die erdoor was gezet
   *  ongedaan. Als er nog een ANDERE goedgekeurde upload bestaat voor
   *  hetzelfde slot+maand, herstel die waarde i.p.v. op 0 te zetten. */
  const handleRemoveRecord = (record: ImportRecord) => {
    if (record.status === 'approved') {
      const slot = UPLOAD_SLOTS.find(s => s.id === record.slotId)
      // Zoek een andere goedgekeurde record voor hetzelfde slot+maand
      const fallback = importRecords.find(r =>
        r.id !== record.id &&
        r.slotId === record.slotId &&
        r.month === record.month &&
        r.status === 'approved',
      )

      if (slot) {
        // Multi-BV OHW target (bv. uren_lijst → c_ul/p1/s_ul)
        if (slot.targetRowByBv) {
          for (const bv of BVS) {
            const rowId = slot.targetRowByBv[bv]
            if (!rowId) continue
            const restoreAmount = fallback ? (fallback.perBv[bv] ?? 0) : 0
            updateRowValue('2026', bv, rowId, record.month, restoreAmount)
          }
        }
        // Single-BV OHW target (d_lijst, conceptfacturen, missing_hours, ohw)
        else if (slot.targetRowId && slot.targetEntity) {
          const restoreAmount = fallback ? fallback.totalAmount : 0
          updateRowValue('2026', slot.targetEntity, slot.targetRowId, record.month, restoreAmount)
        }

        // Closing entries factuurvolume (factuurvolume slot)
        if (slot.appliesTo.length > 0) {
          for (const bv of BVS) {
            const e = entries.find(x => x.bv === bv && x.month === record.month)
            if (!e) continue
            const restoreAmount = fallback ? (fallback.perBv[bv] ?? 0) : 0
            for (const field of slot.appliesTo) {
              update(e.id, field, restoreAmount)
            }
          }
        }
      }

      if (fallback) {
        showToast(`${record.slotLabel} verwijderd — teruggevallen op andere goedgekeurde upload (${fallback.fileName})`, 'g')
      } else {
        showToast(`${record.slotLabel} verwijderd — OHW/closing waarde voor ${record.month} op 0 gezet`, 'r')
      }
    }

    removeRecord(record.id)
    rejectRawEntry(record.id)
  }

  // ── Generic wizard callback: factuurvolume / geschreven_uren / etc ──
  const handleGenericWizardConfirm = (result: ParseResult) => {
    const wizState = genericWizardState
    if (!wizState) return
    // flushSync: commit wizard-close onmiddellijk, nog vóór store-updates.
    flushSync(() => { setGenericWizardState(null) })

    const slot = UPLOAD_SLOTS.find(s => s.id === wizState.slotId)!
    const record: ImportRecord = {
      id: `${wizState.slotId}-${Date.now()}`,
      slotId: wizState.slotId,
      slotLabel: slot.label,
      month: uploadMonth,
      fileName: wizState.fileName,
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
      warnings: result.warnings,
    }
    // Elke store-operatie in eigen try/catch zodat localStorage-quota of
    // netwerk-issues de approval-modal niet blokkeren.
    try { addRecord(record) } catch (err) { console.error('addRecord faalde:', err) }
    try {
      addRawEntry({
        recordId: record.id,
        slotId: wizState.slotId,
        slotLabel: slot.label,
        month: uploadMonth,
        fileName: wizState.fileName,
        uploadedAt: record.uploadedAt,
        rows: result.rawRows,
        amountCol: result.detectedAmountCol,
        bvCol: result.detectedBvCol,
        status: 'pending',
      })
    } catch (err) { console.error('addRawEntry faalde:', err) }

    setPendingFile(wizState.file)
    setPendingRecord(record)
  }

  // ── Wizard callback: gebruiker heeft bestand-config bevestigd ──
  const handleWizardConfirm = (result: ParseResult, cfg: {
    sheetName: string
    headerRow: number
    werknemerCol: string
    urenCol: string
    bedrijfCol?: string
    bedrijfFilter?: string
  }) => {
    if (!wizardState) return
    const slot = UPLOAD_SLOTS.find(s => s.id === 'missing_hours')!
    const record: ImportRecord = {
      id: `missing_hours-${Date.now()}`,
      slotId: 'missing_hours',
      slotLabel: slot.label,
      month: uploadMonth,
      fileName: wizardState.fileName,
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
      warnings: result.warnings,
    }
    addRecord(record)
    addRawEntry({
      recordId: record.id,
      slotId: 'missing_hours',
      slotLabel: slot.label,
      month: uploadMonth,
      fileName: wizardState.fileName,
      uploadedAt: record.uploadedAt,
      rows: result.rawRows,
      amountCol: cfg.urenCol,        // uren-kolom
      bvCol: cfg.werknemerCol,       // werknemer-kolom
      status: 'pending',
      bedrijfCol: cfg.bedrijfCol,
      bedrijfFilter: cfg.bedrijfFilter,
    })
    setPendingFile(wizardState.file)
    setPendingRecord(record)
    setWizardState(null)
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
            <button className={`tab${activeSection === 'bijlagen' ? ' active' : ''}`} onClick={() => setActiveSection('bijlagen')}>📎 Bijlagen</button>
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
            <div style={{
              marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 11, color: 'var(--green)',
              background: 'var(--bd-green)', padding: '3px 10px', borderRadius: 5,
              border: '1px solid var(--green)',
            }} title="Alle wijzigingen worden direct opgeslagen">
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', animation: 'pulse 2s infinite' }} />
              Auto-opslaan actief
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
                      boxShadow: highlightSlot === slot.id ? '0 0 12px rgba(0,169,224,0.4)' : undefined,
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
                            onClick={() => handleRemoveRecord(latest)}
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
                className="btn sm ghost"
                style={{ marginLeft: 'auto' }}
                onClick={() => {
                  if (exportMonths.length === 0) { showToast('Selecteer eerst een maand', 'r'); return }
                  exportPeriod(exportMonths)
                  showToast(`Import log geëxporteerd voor ${exportMonths.join(', ')}`, 'g')
                }}
              >
                ↓ Import log (Excel)
              </button>

              <button
                className="btn sm primary"
                onClick={async () => {
                  if (exportMonths.length === 0) { showToast('Selecteer eerst een maand', 'r'); return }
                  try {
                    for (const m of exportMonths) {
                      const mEntries   = entries.filter(e => e.month === m)
                      const mImports   = importRecords.filter(r => r.month === m)
                      const mRawData   = useRawDataStoreFull.getState().entries.filter(r => r.month === m)
                      const blob = await buildMonthBundleZip({
                        month: m,
                        closingEntries: mEntries,
                        importRecords: mImports,
                        rawData: mRawData,
                        ohwData2025: useOhwStore.getState().data2025,
                        ohwData2026: useOhwStore.getState().data2026,
                        generatedAt: new Date().toLocaleString('nl-NL'),
                      })
                      downloadBlob(blob, `TPG_Maand_${m.replace(/\s+/g, '_')}.zip`)
                    }
                    showToast(`ZIP-bundle gedownload voor ${exportMonths.join(', ')}`, 'g')
                  } catch (err) {
                    showToast(`ZIP-export mislukt: ${err instanceof Error ? err.message : String(err)}`, 'r')
                  }
                }}
              >
                📦 Maand-bundle (ZIP)
              </button>

              <button
                className="btn sm success"
                onClick={async () => {
                  if (exportMonths.length === 0) { showToast('Selecteer eerst een maand', 'r'); return }
                  try {
                    for (const m of exportMonths) {
                      const mEntries = entries.filter(e => e.month === m)
                      await generateMonthPptx({
                        month: m,
                        monthLabel: monthLabelFromCode(m),
                        ytdMonths: CLOSING_MONTHS.slice(0, CLOSING_MONTHS.indexOf(m) + 1),
                        closingEntries: mEntries,
                        ohwData2026: useOhwStore.getState().data2026,
                        importRecords: importRecords,
                      })
                    }
                    showToast(`Maandrapportage PPTX gegenereerd voor ${exportMonths.join(', ')}`, 'g')
                  } catch (err) {
                    showToast(`PPTX-export mislukt: ${err instanceof Error ? err.message : String(err)}`, 'r')
                  }
                }}
              >
                📊 Maandrapportage (PPTX)
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
                          <button className="btn sm ghost" style={{ fontSize: 10, color: 'var(--t3)' }} onClick={() => handleRemoveRecord(r)}>✕</button>
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

        {/* ── BIJLAGEN / ONDERBOUWING ─────────────────────────────────────── */}
        {activeSection === 'bijlagen' && (
          <BijlagenSection
            month={uploadMonth}
            closingMonths={CLOSING_MONTHS}
            onMonthChange={setUploadMonth}
          />
        )}

        {/* ── AFSLUITING ──────────────────────────────────────────────────── */}
        {activeSection === 'afsluiting' && (
          <>
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
              const BV_COLORS: Record<BvId, string> = { Consultancy: '#00a9e0', Projects: '#26c997', Software: '#8b5cf6' }
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

      {/* Missing Hours wizard (vóór de goedkeur-modal) */}
      {wizardState && (
        <MissingHoursWizard
          workbook={wizardState.workbook}
          fileName={wizardState.fileName}
          tariffs={tariffLookup}
          onConfirm={handleWizardConfirm}
          onCancel={() => setWizardState(null)}
          onSetTariff={(employeeId, tarief) => {
            updateTariffEntry(employeeId, { tarief })
            showToast(`IC tarief €${tarief} opgeslagen voor werknemer ${employeeId}`, 'g')
          }}
          onAddEmployee={(rawIdentifier) => {
            // Formaat-heuristiek: kies het juiste veld op basis van de vorm
            //   - Pure cijfers (≥ 3 digits)       → id (werknemer-nummer)
            //   - Bevat komma                     → powerbiNaam ("Achternaam, Voornaam")
            //   - All-caps, geen spaties, ≥ 3     → powerbiNaam2 (SAP alias)
            //   - Anders                          → naam (volledige naam)
            const s = rawIdentifier.trim()
            const draft = {
              id: `new-${Date.now()}`,
              bedrijf: 'Consultancy',
              naam: '',
              powerbiNaam: '',
              powerbiNaam2: '',
              stroming: '',
              tarief: 0,
              fte: null,
              functie: '',
              leidingGevende: '',
              manager: '',
              team: '',
            }
            if (/^\d{3,}$/.test(s)) {
              draft.id = s
              draft.naam = '(onbekende medewerker — vul aan)'
            } else if (s.includes(',')) {
              draft.powerbiNaam = s
              const parts = s.split(',').map(p => p.trim()).filter(Boolean)
              if (parts.length === 2) draft.naam = `${parts[1]} ${parts[0]}`
            } else if (/^[A-Z0-9]{3,}$/.test(s) && !s.includes(' ')) {
              draft.powerbiNaam2 = s
              draft.naam = s
            } else {
              draft.naam = s
            }
            addTariffEntry(draft)
            showToast(
              `"${s.slice(0, 40)}" toegevoegd als Consultancy medewerker — vul het tarief aan in het IC Tarieven tabblad`,
              'g',
            )
          }}
        />
      )}

      {/* Generic wizard — factuurvolume / geschreven_uren / uren_lijst / d_lijst / conceptfacturen */}
      {genericWizardState && (
        <GenericImportWizard
          workbook={genericWizardState.workbook}
          fileName={genericWizardState.fileName}
          slotId={genericWizardState.slotId}
          onConfirm={handleGenericWizardConfirm}
          onCancel={() => setGenericWizardState(null)}
        />
      )}

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
