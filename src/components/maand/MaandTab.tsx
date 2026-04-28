import { useRef, useState, useEffect } from 'react'
import { flushSync } from 'react-dom'
import { useFinStore, CLOSING_MONTHS, getFinResDefault, getVpbDefault } from '../../store/useFinStore'
import { useImportStore } from '../../store/useImportStore'
import { useOhwStore } from '../../store/useOhwStore'
// FTE store werd hier inline gebruikt; dat blok is verhuisd naar FteTab.
// Import blijft hier voor compat — als later een ander stukje van MaandTab
// de FTE-data nodig heeft, kan het hierop teruggrijpen zonder extra import.
// import { useFteStore, FTE_MONTHS } from '../../store/useFteStore'
import { monthlyActuals2026, monthlyBudget2026 } from '../../data/plData'
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

// Alle "generic wizard"-slots doorlopen stap-voor-stap kolom-detectie.
// geschreven_uren staat hier ook in zodat de user kan verifiëren welke
// kolommen gebruikt worden — ná confirm aggregeren we de SAP-timesheet
// layout (Bedrijf / Kalenderjaar / Projecttype / Tijdtype / Gewerkte /
// Afwezigheidstijd) naar ParsedHoursEntry[] voor de uren-store. Deze
// import wordt NIET toegepast op maandafsluiting-regels — alleen op het
// Uren Dashboard en de LE-forecast.
const GENERIC_WIZARD_SLOTS = new Set(['factuurvolume', 'geschreven_uren', 'uren_lijst', 'd_lijst', 'conceptfacturen'])
import { useTariffStore } from '../../store/useTariffStore'
import { useRawDataStore } from '../../store/useRawDataStore'
import type { BvId, ClosingBv, ClosingEntry, ImportRecord, GlobalFilter } from '../../data/types'
import { useToast } from '../../hooks/useToast'
import { Toast } from '../common/Toast'
import { ImportApprovalModal } from './ImportApprovalModal'
import { useNavStore } from '../../store/useNavStore'
import { TariffTable } from './TariffTable'
import { FteTab } from './FteTab'
import { useCostBreakdownStore } from '../../store/useCostBreakdownStore'
import { useHoursStore } from '../../store/useHoursStore'
import { isSapTimesheetHeaders, aggregateSapTimesheet } from '../../lib/parseImport'
import type { ParsedHoursEntry } from '../../lib/parseImport'

// OHW-gerelateerde flows blijven op de 3 "productie" BVs (OHW heeft geen
// Holdings-entity). Maar de maandafsluiting en derived P&L-flow nemen
// Holdings wél mee als 4e kolom — daar is-ie beschikbaar voor kosten-invoer.
const BVS: ClosingBv[] = ['Consultancy', 'Projects', 'Software', 'Holdings']

const BV_COLORS: Record<ClosingBv, string> = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
  Holdings:    '#8fa3c0',
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
  /** Cost mode: toont altijd met € en minteken (rood), input wordt intern
   *  altijd positief opgeslagen. Heeft de user een minteken zelf ingetypt,
   *  dan wordt dat weggenomen voor opslag. */
  isCost?: boolean
  /** Signed-mode: preserveert het teken van de ingevoerde waarde (positief
   *  óf negatief). Voor Holdings, waar sommige "kosten"-regels natuurlijk
   *  credits (positief) zijn. Rode kleur bij negatief, normaal bij positief. */
  signed?: boolean
  /** data-attributes voor Enter/Tab navigatie tussen cellen */
  navRow?: string
  navCol?: string
}

/** Zoek het volgende input-veld in dezelfde column (Enter = omlaag) of row
 *  (horizontaal = standaard browser Tab). Voor Enter gebruiken we onze eigen
 *  navigatie via data-nav-* attributen. */
function focusNextInColumn(current: HTMLInputElement) {
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

function NumInput({ value, onChange, color, isCost, signed, navRow, navCol }: NumInputProps) {
  const [raw, setRaw] = useState('')
  const [editing, setEditing] = useState(false)
  const displayColor =
    isCost && value !== 0 ? 'var(--red)' :
    signed && value < 0   ? 'var(--red)' :
    color
  // Display: isCost → altijd '−€ X'; signed → '€ X' of '−€ X' naar teken; anders '€ X'
  const displayValue = editing
    ? raw
    : value === 0
      ? ''
      : isCost
        ? `−€ ${Math.abs(value).toLocaleString('nl-NL')}`
        : signed
          ? `${value < 0 ? '−' : ''}€ ${Math.abs(value).toLocaleString('nl-NL')}`
          : `€ ${value.toLocaleString('nl-NL')}`
  const commit = () => {
    setEditing(false)
    let v = parseNL(raw || '0')
    if (isNaN(v)) v = 0
    // Cost-mode: negeer het teken en sla altijd positief op. Signed-mode:
    // bewaar het teken zoals ingetypt.
    if (isCost) v = Math.abs(v)
    onChange(v)
  }
  return (
    <input
      className="ohw-inp"
      style={{ width: 130, color: displayColor, fontWeight: isCost || signed ? 600 : undefined }}
      value={displayValue}
      placeholder={isCost ? '−€ 0' : signed ? '€ 0 (+/−)' : '€ 0'}
      data-nav-col={navCol}
      data-nav-row={navRow}
      onFocus={(e) => { setEditing(true); setRaw(value === 0 ? '' : String(value)); setTimeout(() => e.target.select(), 0) }}
      onChange={e => setRaw(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          const target = e.currentTarget
          target.blur()
          // Na blur: focus de volgende input in dezelfde kolom (volgende rij)
          setTimeout(() => focusNextInColumn(target), 0)
        }
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
  const [activeSection, setActiveSection] = useState<'afsluiting' | 'import' | 'export' | 'tarieven' | 'fte' | 'bijlagen'>('afsluiting')
  const [expandedCosts, setExpandedCosts] = useState<Set<CostSectionId>>(new Set())
  const toggleCostSection = (id: CostSectionId) =>
    setExpandedCosts(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  // Drill-down expansion state per sub-categorie (bv. 'directe_inkoopkosten')
  const [expandedSubCosts, setExpandedSubCosts] = useState<Set<string>>(new Set())
  const toggleSubCost = (key: string) =>
    setExpandedSubCosts(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })
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
  const navigateTo = useNavStore(s => s.navigateTo)
  useEffect(() => {
    const target = navConsume()
    if (target?.section === 'import' && target.month && target.slotId) {
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
  const ensureEntry = useFinStore(s => s.ensureEntry)
  const upsertHoursBulk = useHoursStore(s => s.upsertBulk)
  // Pending geschreven-uren-batches per record-id. Worden gepusht naar de
  // hours-store zodra de user ze goedkeurt in de ImportApprovalModal.
  const [pendingHoursByRecord, setPendingHoursByRecord] = useState<Record<string, ParsedHoursEntry[]>>({})
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
  // FTE/Headcount zit nu in FteTab (eigen subtab). Geen inline gebruik meer.

  const monthEntries = entries.filter(e => e.month === month)
  const entry = (bv: ClosingBv): ClosingEntry | undefined => monthEntries.find(e => e.bv === bv)
  const update = (id: string, field: keyof Omit<ClosingEntry, 'id'>, val: number | string) => {
    updateEntry(id, { [field]: val } as Partial<Omit<ClosingEntry, 'id'>>)
  }

  // ── OHW-afkomstige waarden: altijd read-only uit OHW store ────────────────
  const getOhwMutatie = (bv: ClosingBv): number => {
    const ohwEntity = ohwData2026.entities.find(e => e.entity === bv)
    return ohwEntity?.mutatieOhw[month] ?? 0
  }

  const getIcVerrekening = (bv: ClosingBv): number => {
    const ohwEntity = ohwData2026.entities.find(e => e.entity === bv)
    return ohwEntity?.totaalIC[month] ?? 0
  }

  // ── Kosten helpers: breakdowns > override > actuals ────────────────────
  const costBreakdownEntries = useCostBreakdownStore(s => s.entries)
  const addBreakdown = useCostBreakdownStore(s => s.add)
  const updateBreakdownLabel = useCostBreakdownStore(s => s.updateLabel)
  const updateBreakdownValue = useCostBreakdownStore(s => s.updateValue)
  const removeBreakdown = useCostBreakdownStore(s => s.remove)

  /** Heeft deze (maand, categorie) specifieke drill-down rijen? */
  const hasBreakdowns = (key: string) =>
    costBreakdownEntries.some(e => e.month === month && e.category === key)
  /** Som van alle breakdowns voor (maand, categorie) per BV. */
  const sumBreakdowns = (bv: ClosingBv, key: string): number => {
    let sum = 0
    for (const e of costBreakdownEntries) {
      if (e.month === month && e.category === key) sum += e.values[bv] ?? 0
    }
    return sum
  }

  /** Geeft de waarde voor een kosten-sleutel:
   *  breakdowns-sum > override > actuals (fallback).
   *  - BVs: positief magnitude (cost), sign wordt bij display geflipped.
   *  - Holdings: signed (plData heeft mixed signs — sommige subs zijn
   *    credits i.p.v. kosten). */
  const getKostenVal = (bv: ClosingBv, key: string): number => {
    if (hasBreakdowns(key)) return sumBreakdowns(bv, key)
    const e = entry(bv)
    if (e && e.kostenOverrides[key] !== undefined) return e.kostenOverrides[key]
    const plVal = monthlyActuals2026[bv as EntityName]?.[month]?.[key] ?? 0
    return bv === 'Holdings' ? plVal : Math.abs(plVal)
  }

  /** Slaat een override op; 0 wist de override (fallback naar actuals) */
  const updateKosten = (bv: ClosingBv, key: string, val: number) => {
    // ensureEntry garandeert dat er een entry bestaat voor (bv, month) — ook
    // voor Holdings met een oudere persisted state waar die entry nog
    // ontbrak. Zonder deze guard ging de invoer stilletjes verloren en
    // viel de cel bij re-render terug op de plData-fallback ("verspringen").
    const e = entry(bv) ?? ensureEntry(bv, month)
    // Altijd de ingevulde waarde bewaren — óók 0. Eerder werd 0 geïnterpreteerd
    // als "override wissen" waardoor de cel terugsprong naar de plData-fallback.
    const next = { ...(e.kostenOverrides ?? {}), [key]: val }
    updateEntry(e.id, { kostenOverrides: next })
  }

  // ── Derived totals ──────────────────────────────────────────────────────
  /** Netto-omzet voor IC = factuurvolume + OHW mutatie [+ mutatie vooruitgefactureerd voor Software] (= rij 52 in de Excel) */
  const getNettoomzetVoorIC = (bv: ClosingBv): number => {
    const ohwEntity = ohwData2026.entities.find(e => e.entity === bv)
    const fv   = entry(bv)?.factuurvolume ?? (ohwEntity?.factuurvolume[month] ?? 0)
    const mut  = ohwEntity?.mutatieOhw[month] ?? 0
    const mutatieVf = ohwEntity?.mutatieVooruitgefactureerd?.[month] ?? 0
    return fv + mut + mutatieVf
  }

  /** Netto-omzet definitief = netto-omzet voor IC + IC + accruals + handmatige correctie */
  const netRevenue = (e: ClosingEntry, bv: ClosingBv) =>
    getNettoomzetVoorIC(bv) + getIcVerrekening(bv) + e.accruals + e.handmatigeCorrectie

  const finalCosts = (bv: ClosingBv) =>
    DIRECTE_KOSTEN_SUBS.reduce((s, sub) => s + getKostenVal(bv, sub.key), 0)

  /** Convert een finalCosts / opKosten / amortisatie naar signed P&L-waarde.
   *  - BVs: magnitude positief → negeer (kosten zijn negatief in P&L).
   *  - Holdings: al signed → overnemen. */
  const signedCost = (bv: ClosingBv, magnitude: number) =>
    bv === 'Holdings' ? magnitude : -magnitude

  const grossMargin = (bv: ClosingBv) => {
    const e = entry(bv)
    if (!e) return 0
    // netRevenue + signed directe kosten: voor BVs trek je finalCosts af,
    // voor Holdings tel je finalCosts (signed) erbij op.
    return netRevenue(e, bv) + signedCost(bv, finalCosts(bv))
  }

  const opKosten = (bv: ClosingBv) =>
    OPERATIONELE_KOSTEN_SUBS.reduce((s, sub) => s + getKostenVal(bv, sub.key), 0)

  const amortisatie = (bv: ClosingBv) =>
    AMORTISATIE_SUBS.reduce((s, sub) => s + getKostenVal(bv, sub.key), 0)

  const ebitda = (bv: ClosingBv) => grossMargin(bv) + signedCost(bv, opKosten(bv))
  const ebit   = (bv: ClosingBv) => ebitda(bv) + signedCost(bv, amortisatie(bv))

  // Financieel resultaat & vennootschapsbelasting — per BV. Ontbrekende
  // velden (oude persisted entries) krijgen plData-defaults voor Jan/Feb.
  const finResultaat = (bv: ClosingBv): number => {
    const e = entry(bv)
    if (e && typeof e.financieelResultaat === 'number') return e.financieelResultaat
    return getFinResDefault(bv, month)
  }
  const vpb = (bv: ClosingBv): number => {
    const e = entry(bv)
    if (e && typeof e.vennootschapsbelasting === 'number') return e.vennootschapsbelasting
    return getVpbDefault(bv, month)
  }
  const nettoResultaat = (bv: ClosingBv) => ebit(bv) + finResultaat(bv) + vpb(bv)

  // ── Budget lookups (monthlyBudget2026) ──────────────────────────────────
  // Gebruikt voor EBITDA/EBIT analyse tegen budget. Budget-waardes in plData
  // zijn ALTIJD zoals in de P&L-structuur: kosten negatief, omzet positief.
  const budgetVal = (bv: ClosingBv, key: string): number => {
    return monthlyBudget2026[bv as EntityName]?.[month]?.[key] ?? 0
  }
  const budgetNetRevenue  = (bv: ClosingBv) => budgetVal(bv, 'netto_omzet')
  const budgetDirCosts    = (bv: ClosingBv) => Math.abs(budgetVal(bv, 'directe_kosten'))
  const budgetBrutomarge  = (bv: ClosingBv) => budgetVal(bv, 'brutomarge')
  const budgetOpKosten    = (bv: ClosingBv) => Math.abs(budgetVal(bv, 'operationele_kosten'))
  const budgetAmortisatie = (bv: ClosingBv) => Math.abs(budgetVal(bv, 'amortisatie_afschrijvingen'))
  const budgetEbitda      = (bv: ClosingBv) => budgetVal(bv, 'ebitda')
  const budgetEbit        = (bv: ClosingBv) => budgetVal(bv, 'ebit')

  const totFactuur       = BVS.reduce((a, bv) => a + (entry(bv)?.factuurvolume       ?? 0), 0)
  const totDebiteuren    = BVS.reduce((a, bv) => a + (entry(bv)?.debiteuren          ?? 0), 0)
  const totOhw           = BVS.reduce((a, bv) => a + getOhwMutatie(bv), 0)
  const totAccruals      = BVS.reduce((a, bv) => a + (entry(bv)?.accruals            ?? 0), 0)
  const totHandmatig     = BVS.reduce((a, bv) => a + (entry(bv)?.handmatigeCorrectie ?? 0), 0)
  const totIc           = BVS.reduce((a, bv) => a + getIcVerrekening(bv), 0)
  const totNetRevVoorIC = BVS.reduce((a, bv) => a + getNettoomzetVoorIC(bv), 0)
  const totNetRev       = BVS.reduce((a, bv) => a + (entry(bv) ? netRevenue(entry(bv)!, bv) : getNettoomzetVoorIC(bv) + getIcVerrekening(bv)), 0)
  const totMargin      = BVS.reduce((a, bv) => a + grossMargin(bv), 0)
  const totMarginPct   = totNetRev > 0 ? totMargin / totNetRev * 100 : 0
  // Signed P&L-totalen — Holdings telt met real-sign mee, BVs als magnitude geflipped.
  const totCostsSigned  = BVS.reduce((a, bv) => a + signedCost(bv, finalCosts(bv)), 0)
  const totOpSigned     = BVS.reduce((a, bv) => a + signedCost(bv, opKosten(bv)), 0)
  const totAmortSigned  = BVS.reduce((a, bv) => a + signedCost(bv, amortisatie(bv)), 0)
  const totEbitda      = BVS.reduce((a, bv) => a + ebitda(bv), 0)
  const totEbit        = BVS.reduce((a, bv) => a + ebit(bv), 0)
  const totFinRes      = BVS.reduce((a, bv) => a + finResultaat(bv), 0)
  const totVpb         = BVS.reduce((a, bv) => a + vpb(bv), 0)
  const totNettoRes    = BVS.reduce((a, bv) => a + nettoResultaat(bv), 0)
  const totBudgetEbitda = BVS.reduce((a, bv) => a + budgetEbitda(bv), 0)
  const totBudgetEbit   = BVS.reduce((a, bv) => a + budgetEbit(bv), 0)
  const totBudgetNetRev = BVS.reduce((a, bv) => a + budgetNetRevenue(bv), 0)
  const hasBudgetData   = totBudgetEbitda !== 0 || totBudgetEbit !== 0 || totBudgetNetRev !== 0

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

  const actualsCheck = (bv: ClosingBv) => {
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
      // Stash geschreven-uren batch voor later push bij approve
      if (slotId === 'geschreven_uren' && result.hoursEntries && result.hoursEntries.length > 0) {
        setPendingHoursByRecord(prev => ({ ...prev, [record.id]: result.hoursEntries! }))
      }
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
    // Holdings doet niet mee met OHW — skip daar expliciet voor type-safety.
    if (slot.targetRowByBv) {
      let total = 0
      const bvLabels: string[] = []
      for (const bv of BVS) {
        if (bv === 'Holdings') continue
        const rowId = slot.targetRowByBv[bv as BvId]
        if (!rowId) continue
        const amount = record.perBv[bv] ?? 0
        if (amount === 0) continue
        updateRowValue('2026', bv as BvId, rowId, record.month, amount)
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
    // Voor geschreven_uren: push de geparseerde BV × maand × uren-entries
    // naar de hours-store zodat Uren Dashboard en LE-forecast live bijwerken.
    try {
      const pending = pendingHoursByRecord[record.id]
      if (pending && pending.length > 0) {
        upsertHoursBulk(pending)
        setPendingHoursByRecord(prev => {
          const next = { ...prev }
          delete next[record.id]
          return next
        })
        showToast(`${record.slotLabel}: ${pending.length} BV×maand regels verwerkt in Uren Dashboard`, 'g')
      }
    } catch (err) { console.error('upsertHoursBulk faalde:', err) }
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
        // Multi-BV OHW target (bv. uren_lijst → c_ul/p1/s_ul). Holdings doet
        // niet mee met OHW, dus skip die voor type-safety.
        if (slot.targetRowByBv) {
          for (const bv of BVS) {
            if (bv === 'Holdings') continue
            const rowId = slot.targetRowByBv[bv as BvId]
            if (!rowId) continue
            const restoreAmount = fallback ? (fallback.perBv[bv] ?? 0) : 0
            updateRowValue('2026', bv as BvId, rowId, record.month, restoreAmount)
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

    // ── Geschreven uren: overrulen we met SAP-aggregate als de kolom-layout
    // matcht. De generic wizard gebruikt één amount-kolom die optelt over ALLE
    // maanden (en soms inclusief verlof) — voor uren willen we per (BV, maand)
    // declarable+internal. De SAP-aggregate levert dat én stashten we
    // hoursEntries voor de store-push bij approve.
    let recPerBv = result.perBv
    let recTotal = result.totalAmount
    let pendingHours: ParsedHoursEntry[] | null = null
    if (wizState.slotId === 'geschreven_uren' && isSapTimesheetHeaders(result.headers)) {
      const agg = aggregateSapTimesheet(result.rawRows, result.headers)
      if (agg.entries.length > 0) {
        const byBv: Record<BvId, number> = { Consultancy: 0, Projects: 0, Software: 0 }
        for (const e of agg.entries) byBv[e.bv] += e.declarable + e.internal
        recPerBv = byBv
        recTotal = byBv.Consultancy + byBv.Projects + byBv.Software
        pendingHours = agg.entries
      }
    }

    const record: ImportRecord = {
      id: `${wizState.slotId}-${Date.now()}`,
      slotId: wizState.slotId,
      slotLabel: slot.label,
      month: uploadMonth,
      fileName: wizState.fileName,
      uploadedAt: new Date().toLocaleString('nl-NL'),
      perBv: recPerBv,
      totalAmount: recTotal,
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

    // Stash SAP-aggregated hoursEntries (hierboven al opgebouwd) voor
    // push-naar-hours-store bij approve.
    if (pendingHours && pendingHours.length > 0) {
      setPendingHoursByRecord(prev => ({ ...prev, [record.id]: pendingHours! }))
    }

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

  // ── Kosten sub-row renderer + drill-down (verdieping) ─────────────────
  // `prefix` onderscheidt de sectie (dk / op / am) zodat Enter-nav alleen
  // binnen dezelfde kolom van dezelfde sectie navigeert.
  const renderCostSubRow = (sub: { key: string; label: string }, prefix: string): React.ReactNode[] => {
    const rowTot = BVS.reduce((s, bv) => s + getKostenVal(bv, sub.key), 0)
    const isExpanded = expandedSubCosts.has(sub.key)
    const subBreakdowns = costBreakdownEntries
      .filter(e => e.month === month && e.category === sub.key)
    const breakdownCount = subBreakdowns.length

    const rows: React.ReactNode[] = []

    // 1. De hoofd-sub-regel zelf
    rows.push(
      <tr key={sub.key} style={{ background: 'var(--bg1)' }}>
        <td style={{ padding: '4px 12px', paddingLeft: 30, fontSize: 11, color: 'var(--t2)', position: 'sticky', left: 0, background: 'var(--bg1)', zIndex: 1 }}>
          <button
            onClick={() => toggleSubCost(sub.key)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--t3)', fontSize: 10, padding: 0, marginRight: 6,
              transition: 'transform .15s',
              transform: isExpanded ? 'rotate(90deg)' : 'none',
              display: 'inline-block',
            }}
            title={isExpanded ? 'Verdieping inklappen' : 'Klik om specifieke posten toe te voegen'}
          >▸</button>
          <span style={{ cursor: 'pointer' }} onClick={() => toggleSubCost(sub.key)}>
            {sub.label}
          </span>
          {breakdownCount > 0 && (
            <span style={{ fontSize: 9, marginLeft: 6, color: 'var(--blue)', background: 'var(--bd-blue)', padding: '1px 5px', borderRadius: 3 }}>
              {breakdownCount} specifiek
            </span>
          )}
        </td>
        {BVS.map(bv => {
          const isHld = bv === 'Holdings'
          const hasBr = breakdownCount > 0
          const val = getKostenVal(bv, sub.key)
          // Als er breakdowns zijn: toon read-only som (berekend). Anders: editable input.
          if (hasBr) {
            // Holdings: val is signed (kan positief=credit of negatief=cost).
            // Andere BVs: val is altijd positief magnitude → display als -val (cost).
            const dispVal = isHld ? val : -val
            const color = val === 0 ? 'var(--t3)' : dispVal < 0 ? 'var(--red)' : 'var(--green)'
            return (
              <td key={bv} className="r mono" style={{ padding: '3px 8px', fontSize: 11, color, fontWeight: 600 }}>
                {val !== 0 ? fmt(dispVal) : '—'}
              </td>
            )
          }
          return (
            <td key={bv} className="r" style={{ padding: '3px 8px' }}>
              <NumInput
                value={val}
                onChange={v => updateKosten(bv, sub.key, v)}
                {...(isHld ? { signed: true } : { isCost: true })}
                navRow={`${prefix}-${sub.key}`}
                navCol={`${bv}`}
              />
            </td>
          )
        })}
        <td className="mono r" style={{ fontSize: 11, fontWeight: 600, color: rowTot !== 0 ? 'var(--red)' : 'var(--t3)' }}>{rowTot !== 0 ? fmt(-rowTot) : '—'}</td>
      </tr>
    )

    // 2. Drill-down rijen als expanded
    if (isExpanded) {
      subBreakdowns.forEach((br, i) => {
        const brRowTot = BVS.reduce((s, bv) => s + (br.values[bv] ?? 0), 0)
        rows.push(
          <tr key={`br-${br.id}`} style={{ background: 'var(--bg2)' }}>
            <td style={{ padding: '3px 12px', paddingLeft: 48, fontSize: 11, position: 'sticky', left: 0, background: 'var(--bg2)', zIndex: 1 }}>
              <span style={{ color: 'var(--t3)', marginRight: 6, fontSize: 9 }}>↳</span>
              <input
                className="ohw-inp"
                style={{ width: 200, fontSize: 11, textAlign: 'left', background: 'var(--bg3)' }}
                defaultValue={br.label}
                placeholder="Specifieke post omschrijving..."
                onBlur={e => updateBreakdownLabel(br.id, e.target.value)}
              />
            </td>
            {BVS.map(bv => (
              <td key={bv} className="r" style={{ padding: '3px 8px' }}>
                <NumInput
                  value={br.values[bv] ?? 0}
                  onChange={v => updateBreakdownValue(br.id, bv, v)}
                  {...(bv === 'Holdings' ? { signed: true } : { isCost: true })}
                  navRow={`${prefix}-${sub.key}-br-${i}`}
                  navCol={`${bv}`}
                />
              </td>
            ))}
            <td style={{ padding: '3px 4px', textAlign: 'right' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: brRowTot !== 0 ? 'var(--red)' : 'var(--t3)', marginRight: 4, fontFamily: 'var(--mono)' }}>
                {brRowTot !== 0 ? fmt(-brRowTot) : '—'}
              </span>
              <button
                onClick={() => removeBreakdown(br.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 12, padding: '2px 4px' }}
                title="Verwijder deze specifieke post"
                data-rw="hide"
              >✕</button>
            </td>
          </tr>
        )
      })

      // 3. "+ Specifiëren"-knop onderin
      rows.push(
        <tr key={`${sub.key}-add`} style={{ background: 'var(--bg2)' }}>
          <td colSpan={5} style={{ padding: '4px 12px 8px 48px', position: 'sticky', left: 0, background: 'var(--bg2)' }}>
            <button
              onClick={() => addBreakdown(month, sub.key, '')}
              className="btn sm"
              style={{
                background: 'rgba(0,169,224,0.08)',
                border: '1px dashed var(--blue)',
                color: 'var(--blue)',
                fontSize: 10, padding: '3px 10px',
              }}
              title="Voeg een specifieke post toe onder deze kostenregel"
              data-rw="hide"
            >
              + specifieke post toevoegen
            </button>
            {breakdownCount > 0 && (
              <span style={{ marginLeft: 10, fontSize: 10, color: 'var(--t3)' }}>
                {breakdownCount} post{breakdownCount === 1 ? '' : 'en'} — totaal overschrijft de hoofdregel
              </span>
            )}
          </td>
        </tr>
      )
    }

    return rows
  }

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
            <button className={`tab${activeSection === 'fte' ? ' active' : ''}`} onClick={() => setActiveSection('fte')}>FTE &amp; Headcount</button>
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
                        data-rw="edit"
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

        {/* ── FTE & HEADCOUNT ─────────────────────────────────────────────── */}
        {activeSection === 'fte' && <FteTab />}

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

                    <tr>
                      <td style={{ padding: '6px 12px', minWidth: 240, position: 'sticky', left: 0, background: 'var(--bg1)', zIndex: 1 }}>
                        <button
                          onClick={() => navigateTo({ tab: 'ohw', year: '2026', rowId: 'mutatieOhw' })}
                          title="Klik om naar OHW Overzicht te springen (rij 'Mutatie OHW' wordt gehighlight)"
                          style={{
                            background: 'none', border: 'none', padding: 0,
                            color: 'var(--blue)', cursor: 'pointer',
                            font: 'inherit', textAlign: 'left',
                            textDecoration: 'underline', textDecorationStyle: 'dotted',
                            textUnderlineOffset: 3,
                          }}
                        >
                          OHW mutatie (periode-allocatie) <span style={{ fontSize: 9, color: 'var(--t3)', marginLeft: 2 }}>↗</span>
                        </button>
                      </td>
                      {BVS.map(bv => {
                        const mut = getOhwMutatie(bv)
                        const hasData = bv !== 'Holdings' && ohwData2026.entities.some(e => e.entity === bv && e.mutatieOhw[month] != null)
                        return (
                          <td key={bv} className="r" style={{ padding: '4px 8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                              <button
                                title={`Klik om naar OHW Overzicht → ${bv} → Mutatie OHW te springen`}
                                onClick={() => {
                                  if (bv === 'Holdings') return
                                  navigateTo({ tab: 'ohw', year: '2026', entity: bv as BvId, rowId: 'mutatieOhw' })
                                }}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 4,
                                  background: 'var(--bg3)', border: '1px solid var(--bd2)',
                                  borderRadius: 6, padding: '4px 10px',
                                  fontFamily: 'var(--mono)', fontSize: 12,
                                  color: mut >= 0 ? 'var(--green)' : 'var(--red)',
                                  cursor: 'pointer', userSelect: 'none',
                                  width: 130, justifyContent: 'flex-end',
                                  transition: 'border-color 0.15s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--blue)' }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--bd2)' }}
                              >
                                {hasData ? fmt(mut) : <span style={{ color: 'var(--t3)' }}>—</span>}
                                <span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }}>↗</span>
                              </button>
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
                    </tr>

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
                        const v = finalCosts(bv)
                        const disp = signedCost(bv, v)
                        const color = v === 0 ? 'var(--t2)' : disp < 0 ? 'var(--red)' : 'var(--green)'
                        return <td key={bv} className="mono r" style={{ fontWeight: 600, color }}>{v !== 0 ? fmt(disp) : '—'}</td>
                      })}
                      <td className="mono r" style={{ fontWeight: 600, color: totCostsSigned === 0 ? 'var(--t2)' : totCostsSigned < 0 ? 'var(--red)' : 'var(--green)' }}>{totCostsSigned !== 0 ? fmt(totCostsSigned) : '—'}</td>
                    </tr>
                    {expandedCosts.has('directe_kosten') && DIRECTE_KOSTEN_SUBS.flatMap(sub =>
                      renderCostSubRow(sub, 'dk')
                    )}
                    {!expandedCosts.has('directe_kosten') && (
                      <tr style={{ background: 'var(--bg1)' }}>
                        <td colSpan={5} style={{ padding: '2px 12px', paddingLeft: 30, fontSize: 10, color: 'var(--t3)', position: 'sticky', left: 0 }}>
                          {DIRECTE_KOSTEN_SUBS.map(s => s.label).join(' · ')}
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
                        const disp = signedCost(bv, v)
                        const color = v === 0 ? 'var(--t2)' : disp < 0 ? 'var(--red)' : 'var(--green)'
                        return <td key={bv} className="mono r" style={{ fontWeight: 600, color }}>{v !== 0 ? fmt(disp) : '—'}</td>
                      })}
                      <td className="mono r" style={{ fontWeight: 600, color: totOpSigned === 0 ? 'var(--t2)' : totOpSigned < 0 ? 'var(--red)' : 'var(--green)' }}>{totOpSigned !== 0 ? fmt(totOpSigned) : '—'}</td>
                    </tr>
                    {expandedCosts.has('operationele_kosten') && OPERATIONELE_KOSTEN_SUBS.flatMap(sub =>
                      renderCostSubRow(sub, 'op')
                    )}
                    {!expandedCosts.has('operationele_kosten') && (
                      <tr style={{ background: 'var(--bg1)' }}>
                        <td colSpan={5} style={{ padding: '2px 12px', paddingLeft: 30, fontSize: 10, color: 'var(--t3)', position: 'sticky', left: 0 }}>
                          {OPERATIONELE_KOSTEN_SUBS.map(s => s.label).join(' · ')}
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
                        const disp = signedCost(bv, v)
                        const color = v === 0 ? 'var(--t2)' : disp < 0 ? 'var(--red)' : 'var(--green)'
                        return <td key={bv} className="mono r" style={{ fontWeight: 600, color }}>{v !== 0 ? fmt(disp) : '—'}</td>
                      })}
                      <td className="mono r" style={{ fontWeight: 600, color: totAmortSigned === 0 ? 'var(--t2)' : totAmortSigned < 0 ? 'var(--red)' : 'var(--green)' }}>{totAmortSigned !== 0 ? fmt(totAmortSigned) : '—'}</td>
                    </tr>
                    {expandedCosts.has('amortisatie_afschrijvingen') && AMORTISATIE_SUBS.flatMap(sub =>
                      renderCostSubRow(sub, 'am')
                    )}
                    {!expandedCosts.has('amortisatie_afschrijvingen') && (
                      <tr style={{ background: 'var(--bg1)' }}>
                        <td colSpan={5} style={{ padding: '2px 12px', paddingLeft: 30, fontSize: 10, color: 'var(--t3)', position: 'sticky', left: 0 }}>
                          {AMORTISATIE_SUBS.map(s => s.label).join(' · ')}
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

                    {hasBudgetData && (
                      <>
                        <tr>
                          <td style={{ padding: '6px 12px', minWidth: 240, position: 'sticky', left: 0, background: 'var(--bg1)', zIndex: 1, color: 'var(--t2)' }}>
                            <span style={{ fontWeight: 500 }}>Budget EBITDA</span>
                          </td>
                          {BVS.map(bv => (
                            <td key={bv} className="mono r" style={{ color: 'var(--t2)' }}>{fmt(budgetEbitda(bv))}</td>
                          ))}
                          <td className="mono r" style={{ color: 'var(--t2)' }}>{fmt(totBudgetEbitda)}</td>
                        </tr>
                        <tr>
                          <td style={{ padding: '6px 12px', minWidth: 240, position: 'sticky', left: 0, background: 'var(--bg1)', zIndex: 1 }}>
                            <span style={{ fontSize: 11, color: 'var(--t3)' }}>↳</span> Δ EBITDA vs Budget
                          </td>
                          {BVS.map(bv => {
                            const d = ebitda(bv) - budgetEbitda(bv)
                            return (
                              <td key={bv} className="mono r" style={{ fontWeight: 600, color: d >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                {d >= 0 ? '+' : ''}{fmt(d)}
                              </td>
                            )
                          })}
                          <td className="mono r" style={{ fontWeight: 700, color: (totEbitda - totBudgetEbitda) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                            {(totEbitda - totBudgetEbitda) >= 0 ? '+' : ''}{fmt(totEbitda - totBudgetEbitda)}
                          </td>
                        </tr>
                      </>
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

                    {/* ── Financieel resultaat & Vennootschapsbelasting (invoerbaar) ── */}
                    {sectionRow('Financieel resultaat',
                      <>
                        {BVS.map(bv => {
                          const e = entry(bv)
                          return (
                            <td key={bv} className="r" style={{ padding: '4px 8px' }}>
                              {e ? (
                                <NumInput
                                  value={finResultaat(bv)}
                                  onChange={v => update(e.id, 'financieelResultaat', v)}
                                  color={finResultaat(bv) < 0 ? 'var(--red)' : undefined}
                                />
                              ) : '—'}
                            </td>
                          )
                        })}
                        <td className="mono r" style={{ color: totFinRes < 0 ? 'var(--red)' : undefined }}>{fmt(totFinRes)}</td>
                      </>
                    )}

                    {sectionRow('Vennootschapsbelasting',
                      <>
                        {BVS.map(bv => {
                          const e = entry(bv)
                          return (
                            <td key={bv} className="r" style={{ padding: '4px 8px' }}>
                              {e ? (
                                <NumInput
                                  value={vpb(bv)}
                                  onChange={v => update(e.id, 'vennootschapsbelasting', v)}
                                  color={vpb(bv) < 0 ? 'var(--red)' : undefined}
                                />
                              ) : '—'}
                            </td>
                          )
                        })}
                        <td className="mono r" style={{ color: totVpb < 0 ? 'var(--red)' : undefined }}>{fmt(totVpb)}</td>
                      </>
                    )}

                    {sectionRow('Netto resultaat',
                      <>
                        {BVS.map(bv => {
                          const nr = nettoResultaat(bv)
                          return (
                            <td key={bv} className="mono r" style={{ color: nr >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                              {fmt(nr)}
                            </td>
                          )
                        })}
                        <td className="mono r" style={{ fontWeight: 700, color: totNettoRes >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {fmt(totNettoRes)}
                        </td>
                      </>, true
                    )}

                    {hasBudgetData && (
                      <>
                        <tr>
                          <td style={{ padding: '6px 12px', minWidth: 240, position: 'sticky', left: 0, background: 'var(--bg1)', zIndex: 1, color: 'var(--t2)' }}>
                            <span style={{ fontWeight: 500 }}>Budget EBIT</span>
                          </td>
                          {BVS.map(bv => (
                            <td key={bv} className="mono r" style={{ color: 'var(--t2)' }}>{fmt(budgetEbit(bv))}</td>
                          ))}
                          <td className="mono r" style={{ color: 'var(--t2)' }}>{fmt(totBudgetEbit)}</td>
                        </tr>
                        <tr>
                          <td style={{ padding: '6px 12px', minWidth: 240, position: 'sticky', left: 0, background: 'var(--bg1)', zIndex: 1 }}>
                            <span style={{ fontSize: 11, color: 'var(--t3)' }}>↳</span> Δ EBIT vs Budget
                          </td>
                          {BVS.map(bv => {
                            const d = ebit(bv) - budgetEbit(bv)
                            return (
                              <td key={bv} className="mono r" style={{ fontWeight: 600, color: d >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                {d >= 0 ? '+' : ''}{fmt(d)}
                              </td>
                            )
                          })}
                          <td className="mono r" style={{ fontWeight: 700, color: (totEbit - totBudgetEbit) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                            {(totEbit - totBudgetEbit) >= 0 ? '+' : ''}{fmt(totEbit - totBudgetEbit)}
                          </td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── EBITDA / EBIT — analyse waar het verschil zit vs budget ── */}
            {hasBudgetData && (
              <div className="card">
                <div className="card-hdr">
                  <span className="card-title">Analyse: waar zit het verschil tov budget? — {month}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>
                    Componenten die het EBITDA/EBIT delta sturen (actuals − budget)
                  </span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th style={{ minWidth: 240, position: 'sticky', left: 0, background: 'var(--bg3)' }}>Component</th>
                        {BVS.map(bv => (
                          <th key={bv} className="r" style={{ minWidth: 130, background: 'var(--bg3)' }}>
                            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: BV_COLORS[bv], marginRight: 6 }} />
                            {bv}
                          </th>
                        ))}
                        <th className="r" style={{ minWidth: 130, background: 'var(--bg3)', fontWeight: 700 }}>Totaal</th>
                        <th style={{ minWidth: 220, background: 'var(--bg3)', padding: '6px 12px' }}>Interpretatie</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* ── Netto-omzet delta ── */}
                      {(() => {
                        const perBv = BVS.map(bv => {
                          const actual = entry(bv) ? netRevenue(entry(bv)!, bv) : 0
                          return actual - budgetNetRevenue(bv)
                        })
                        const tot = perBv.reduce((s, v) => s + v, 0)
                        return (
                          <tr>
                            <td style={{ padding: '6px 12px', position: 'sticky', left: 0, background: 'var(--bg2)' }}>
                              <strong>Δ Netto-omzet</strong>
                              <div style={{ fontSize: 9, color: 'var(--t3)' }}>actuals vs budget</div>
                            </td>
                            {perBv.map((d, i) => (
                              <td key={i} className="mono r" style={{ color: d >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                                {d >= 0 ? '+' : ''}{fmt(d)}
                              </td>
                            ))}
                            <td className="mono r" style={{ color: tot >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                              {tot >= 0 ? '+' : ''}{fmt(tot)}
                            </td>
                            <td style={{ padding: '6px 12px', fontSize: 11, color: 'var(--t2)' }}>
                              {tot > 0 ? '▲ Meer omzet dan begroot → hogere EBITDA' : tot < 0 ? '▼ Minder omzet → lagere EBITDA' : '— op budget'}
                            </td>
                          </tr>
                        )
                      })()}

                      {/* ── Directe kosten delta — omdraaien zodat lagere kosten = positief ── */}
                      {(() => {
                        const perBv = BVS.map(bv => budgetDirCosts(bv) - finalCosts(bv)) // positief = minder kosten dan budget
                        const tot = perBv.reduce((s, v) => s + v, 0)
                        return (
                          <tr>
                            <td style={{ padding: '6px 12px', position: 'sticky', left: 0, background: 'var(--bg2)' }}>
                              <strong>Δ Directe kosten</strong>
                              <div style={{ fontSize: 9, color: 'var(--t3)' }}>budget − actuals (positief = beter)</div>
                            </td>
                            {perBv.map((d, i) => (
                              <td key={i} className="mono r" style={{ color: d >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                                {d >= 0 ? '+' : ''}{fmt(d)}
                              </td>
                            ))}
                            <td className="mono r" style={{ color: tot >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                              {tot >= 0 ? '+' : ''}{fmt(tot)}
                            </td>
                            <td style={{ padding: '6px 12px', fontSize: 11, color: 'var(--t2)' }}>
                              {tot > 0 ? '▲ Lagere directe kosten → hogere brutomarge' : tot < 0 ? '▼ Hogere kosten dan begroot → lagere brutomarge' : '— op budget'}
                            </td>
                          </tr>
                        )
                      })()}

                      {/* ── Subtotaal: Δ Brutomarge (derived) ── */}
                      {(() => {
                        const perBv = BVS.map(bv => grossMargin(bv) - budgetBrutomarge(bv))
                        const tot = perBv.reduce((s, v) => s + v, 0)
                        return (
                          <tr style={{ background: 'var(--bg3)' }}>
                            <td style={{ padding: '6px 12px', fontWeight: 700, position: 'sticky', left: 0, background: 'var(--bg3)' }}>
                              = Δ Brutomarge
                            </td>
                            {perBv.map((d, i) => (
                              <td key={i} className="mono r" style={{ fontWeight: 700, color: d >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                {d >= 0 ? '+' : ''}{fmt(d)}
                              </td>
                            ))}
                            <td className="mono r" style={{ fontWeight: 700, color: tot >= 0 ? 'var(--green)' : 'var(--red)' }}>
                              {tot >= 0 ? '+' : ''}{fmt(tot)}
                            </td>
                            <td style={{ padding: '6px 12px' }} />
                          </tr>
                        )
                      })()}

                      {/* ── Operationele kosten delta ── */}
                      {(() => {
                        const perBv = BVS.map(bv => budgetOpKosten(bv) - opKosten(bv)) // positief = minder kosten dan budget
                        const tot = perBv.reduce((s, v) => s + v, 0)
                        return (
                          <tr>
                            <td style={{ padding: '6px 12px', position: 'sticky', left: 0, background: 'var(--bg2)' }}>
                              <strong>Δ Operationele kosten</strong>
                              <div style={{ fontSize: 9, color: 'var(--t3)' }}>budget − actuals (positief = beter)</div>
                            </td>
                            {perBv.map((d, i) => (
                              <td key={i} className="mono r" style={{ color: d >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                                {d >= 0 ? '+' : ''}{fmt(d)}
                              </td>
                            ))}
                            <td className="mono r" style={{ color: tot >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                              {tot >= 0 ? '+' : ''}{fmt(tot)}
                            </td>
                            <td style={{ padding: '6px 12px', fontSize: 11, color: 'var(--t2)' }}>
                              {tot > 0 ? '▲ Lagere OPEX — mogelijk door minder FTE (zie FTE tab)' : tot < 0 ? '▼ Hogere OPEX dan begroot' : '— op budget'}
                            </td>
                          </tr>
                        )
                      })()}

                      {/* ── Subtotaal: Δ EBITDA (derived) ── */}
                      {(() => {
                        const perBv = BVS.map(bv => ebitda(bv) - budgetEbitda(bv))
                        const tot = perBv.reduce((s, v) => s + v, 0)
                        return (
                          <tr style={{ background: 'var(--bg3)' }}>
                            <td style={{ padding: '6px 12px', fontWeight: 700, position: 'sticky', left: 0, background: 'var(--bg3)' }}>
                              = Δ EBITDA
                            </td>
                            {perBv.map((d, i) => (
                              <td key={i} className="mono r" style={{ fontWeight: 700, color: d >= 0 ? 'var(--green)' : 'var(--red)' }}>
                                {d >= 0 ? '+' : ''}{fmt(d)}
                              </td>
                            ))}
                            <td className="mono r" style={{ fontWeight: 700, color: tot >= 0 ? 'var(--green)' : 'var(--red)' }}>
                              {tot >= 0 ? '+' : ''}{fmt(tot)}
                            </td>
                            <td style={{ padding: '6px 12px' }} />
                          </tr>
                        )
                      })()}

                      {/* ── Amortisatie delta ── */}
                      {(() => {
                        const perBv = BVS.map(bv => budgetAmortisatie(bv) - amortisatie(bv))
                        const tot = perBv.reduce((s, v) => s + v, 0)
                        return (
                          <tr>
                            <td style={{ padding: '6px 12px', position: 'sticky', left: 0, background: 'var(--bg2)' }}>
                              <strong>Δ Amortisatie + afschrijvingen</strong>
                              <div style={{ fontSize: 9, color: 'var(--t3)' }}>budget − actuals</div>
                            </td>
                            {perBv.map((d, i) => (
                              <td key={i} className="mono r" style={{ color: d >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                                {d >= 0 ? '+' : ''}{fmt(d)}
                              </td>
                            ))}
                            <td className="mono r" style={{ color: tot >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                              {tot >= 0 ? '+' : ''}{fmt(tot)}
                            </td>
                            <td style={{ padding: '6px 12px', fontSize: 11, color: 'var(--t2)' }}>
                              {tot > 0 ? '▲ Lagere afschrijving dan budget' : tot < 0 ? '▼ Hogere afschrijvingen' : '— op budget'}
                            </td>
                          </tr>
                        )
                      })()}

                      {/* ── Subtotaal: Δ EBIT (derived) ── */}
                      {(() => {
                        const perBv = BVS.map(bv => ebit(bv) - budgetEbit(bv))
                        const tot = perBv.reduce((s, v) => s + v, 0)
                        return (
                          <tr style={{ background: 'var(--bg3)' }}>
                            <td style={{ padding: '7px 12px', fontWeight: 700, position: 'sticky', left: 0, background: 'var(--bg3)', fontSize: 13 }}>
                              = Δ EBIT
                            </td>
                            {perBv.map((d, i) => (
                              <td key={i} className="mono r" style={{ fontWeight: 700, color: d >= 0 ? 'var(--green)' : 'var(--red)', fontSize: 13 }}>
                                {d >= 0 ? '+' : ''}{fmt(d)}
                              </td>
                            ))}
                            <td className="mono r" style={{ fontWeight: 700, color: tot >= 0 ? 'var(--green)' : 'var(--red)', fontSize: 13 }}>
                              {tot >= 0 ? '+' : ''}{fmt(tot)}
                            </td>
                            <td style={{ padding: '6px 12px', fontSize: 11, color: 'var(--t2)' }}>
                              {tot > 0 ? 'Boven budget — operatie presteert beter' : tot < 0 ? 'Onder budget — onderzoek oorzaken hierboven' : 'Op budget'}
                            </td>
                          </tr>
                        )
                      })()}
                    </tbody>
                  </table>
                </div>
                <div style={{ padding: '8px 14px', fontSize: 10, color: 'var(--t3)', borderTop: '1px solid var(--bd)', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <span>💡 <strong>Lees-richtlijn:</strong> groen = gunstig t.o.v. budget (hogere omzet OF lagere kosten). Hogere kosten staan in rood — ook als het absolute bedrag lager lijkt.</span>
                  <button
                    onClick={() => setActiveSection('fte')}
                    style={{ background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontSize: 11, textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}
                    title="Ga naar FTE/Headcount om personeelsvariance te koppelen aan kostenbeweging"
                  >
                    → Bekijk FTE/Headcount analyse
                  </button>
                </div>
              </div>
            )}

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

            {/* ── EBITDA summary bar — actuals, budget, Δ prominent ──── */}
            {hasBudgetData && (
              <div className="card">
                <div className="card-hdr">
                  <span className="card-title">EBITDA {month} — samenvatting vs budget</span>
                </div>
                <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                  {/* Actuals */}
                  <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--bd2)' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
                      Actuals
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--mono)', color: totEbitda >= 0 ? 'var(--t1)' : 'var(--red)' }}>
                      {fmt(totEbitda)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
                      {totNetRev > 0 ? `${(totEbitda / totNetRev * 100).toFixed(1)}% van netto-omzet` : '—'}
                    </div>
                  </div>
                  {/* Budget */}
                  <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--bg3)', border: '1px solid var(--bd2)' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
                      Budget
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--t2)' }}>
                      {fmt(totBudgetEbitda)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
                      {totBudgetNetRev > 0 ? `${(totBudgetEbitda / totBudgetNetRev * 100).toFixed(1)}% van begrote omzet` : '—'}
                    </div>
                  </div>
                  {/* Delta */}
                  {(() => {
                    const d = totEbitda - totBudgetEbitda
                    const pct = totBudgetEbitda !== 0 ? (d / Math.abs(totBudgetEbitda) * 100) : 0
                    const favourable = d >= 0
                    return (
                      <div style={{
                        padding: '12px 14px', borderRadius: 8,
                        background: favourable ? 'var(--bd-green)' : 'var(--bd-red)',
                        border: `1px solid ${favourable ? 'var(--green)' : 'var(--red)'}`,
                      }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
                          Δ vs Budget
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--mono)', color: favourable ? 'var(--green)' : 'var(--red)' }}>
                          {favourable ? '+' : ''}{fmt(d)}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
                          {totBudgetEbitda !== 0 ? `${favourable ? '+' : ''}${pct.toFixed(1)}% vs budget` : '—'}
                          <span style={{ marginLeft: 8, color: favourable ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                            {favourable ? '▲ boven budget' : '▼ onder budget'}
                          </span>
                        </div>
                      </div>
                    )
                  })()}
                </div>
                {/* Per-BV uitsplitsing */}
                <div style={{ padding: '4px 18px 14px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  {BVS.map(bv => {
                    const a = ebitda(bv)
                    const b = budgetEbitda(bv)
                    const d = a - b
                    return (
                      <div key={bv} style={{ padding: '8px 10px', borderRadius: 6, background: 'var(--bg2)', borderLeft: `3px solid ${BV_COLORS[bv]}`, fontSize: 11 }}>
                        <div style={{ fontWeight: 600, color: BV_COLORS[bv], marginBottom: 3 }}>{bv}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ color: 'var(--t3)' }}>Actuals</span>
                          <span style={{ fontFamily: 'var(--mono)', color: 'var(--t1)' }}>{fmt(a)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ color: 'var(--t3)' }}>Budget</span>
                          <span style={{ fontFamily: 'var(--mono)', color: 'var(--t2)' }}>{fmt(b)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, borderTop: '1px solid var(--bd)', marginTop: 3, paddingTop: 3 }}>
                          <span style={{ color: 'var(--t2)', fontWeight: 600 }}>Δ</span>
                          <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: d >= 0 ? 'var(--green)' : 'var(--red)' }}>
                            {d >= 0 ? '+' : ''}{fmt(d)}
                          </span>
                        </div>
                      </div>
                    )
                  })}
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
          hoursEntries={pendingHoursByRecord[pendingRecord.id]}
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
