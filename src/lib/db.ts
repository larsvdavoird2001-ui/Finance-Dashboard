// db.ts — Supabase database service laag voor TPG Finance
// Alle CRUD operaties voor de 5 tabellen.
// Als Supabase niet geconfigureerd is, retourneren alle functies lege data.
import { supabase, supabaseEnabled } from './supabase'
import type { ClosingEntry, FteEntry, ImportRecord, OhwEntityData } from '../data/types'
import type { RawDataEntry } from '../store/useRawDataStore'
import type { HoursEntry } from '../store/useHoursStore'
import type { HoursWeekEntry } from '../store/useHoursWeekStore'
import type { CostBreakdown } from '../store/useCostBreakdownStore'
import type { ReflectionRecord } from '../store/useReflectionStore'
import type { InternalHoursEntry } from './parseInternalHours'
import { emitDbEvent } from './dbEvents'
import { useSaveStatus } from './saveStatus'

// ── Helpers ─────────────────────────────────────────────────────────────────
/** Wrap een Supabase-write in save-status tracking + error-toast.
 *  Hiermee wordt elke upsert zichtbaar in de Topbar-indicator: de user
 *  ziet 'syncen...' tijdens de write en '✓ gesynchroniseerd' bij succes.
 *  Accepteert elke thenable (Supabase query-builders zijn thenable maar
 *  geen strikte Promises). */
async function trackedWrite(
  table: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec: () => PromiseLike<{ error: any }>,
): Promise<void> {
  const status = useSaveStatus.getState()
  status.starting(table)
  try {
    const { error } = await exec()
    if (error) {
      const msg = error.message ?? String(error)
      useSaveStatus.getState().failed(table, msg)
      emitDbEvent({ type: 'save-error', table, message: msg })
    } else {
      useSaveStatus.getState().success(table)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    useSaveStatus.getState().failed(table, msg)
    emitDbEvent({ type: 'save-error', table, message: msg })
  }
}

function camelToSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k.replace(/[A-Z]/g, m => '_' + m.toLowerCase())] = v
  }
  return out
}

function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v
  }
  return out
}

// ── Closing Entries ─────────────────────────────────────────────────────────
export async function fetchClosingEntries(): Promise<ClosingEntry[]> {
  if (!supabaseEnabled) return []
  const { data, error } = await supabase.from('closing_entries').select('*')
  // GOOI bij een echte fout (i.p.v. [] terug te geven): anders ziet de
  // reconcile-laag in loadFromDb de DB als "leeg" en pusht álle lokale entries
  // terug naar Supabase — bij een aanhoudende lees-fout (RLS/sessie/netwerk)
  // herhaalt dat elke 30s-poll → continue save-fouten. De caller vangt de
  // throw op en behoudt lokale state.
  if (error) throw new Error(`fetchClosingEntries: ${error.message ?? error}`)
  return (data ?? []).map(row => snakeToCamel(row) as unknown as ClosingEntry)
}

export async function upsertClosingEntry(entry: ClosingEntry): Promise<void> {
  if (!supabaseEnabled) return
  const row = camelToSnake(entry as unknown as Record<string, unknown>)
  await trackedWrite('closing_entries', () =>
    supabase.from('closing_entries').upsert(row, { onConflict: 'id' }),
  )
}

export async function upsertAllClosingEntries(entries: ClosingEntry[]): Promise<void> {
  if (!supabaseEnabled) return
  const rows = entries.map(e => camelToSnake(e as unknown as Record<string, unknown>))
  await trackedWrite('closing_entries', () =>
    supabase.from('closing_entries').upsert(rows, { onConflict: 'id' }),
  )
}

// ── FTE Entries ─────────────────────────────────────────────────────────────
export async function fetchFteEntries(): Promise<FteEntry[]> {
  if (!supabaseEnabled) return []
  const { data, error } = await supabase.from('fte_entries').select('*')
  // Throw bij echte fout — zie fetchClosingEntries: voorkomt reconcile-push-loop.
  if (error) throw new Error(`fetchFteEntries: ${error.message ?? error}`)
  return (data ?? []).map(row => snakeToCamel(row) as unknown as FteEntry)
}

export async function upsertFteEntry(entry: FteEntry): Promise<void> {
  if (!supabaseEnabled) return
  const row = camelToSnake(entry as unknown as Record<string, unknown>)
  await trackedWrite('fte_entries', () =>
    supabase.from('fte_entries').upsert(row, { onConflict: 'id' }),
  )
}

export async function upsertAllFteEntries(entries: FteEntry[]): Promise<void> {
  if (!supabaseEnabled) return
  const rows = entries.map(e => camelToSnake(e as unknown as Record<string, unknown>))
  await trackedWrite('fte_entries', () =>
    supabase.from('fte_entries').upsert(rows, { onConflict: 'id' }),
  )
}

// ── Import Records ──────────────────────────────────────────────────────────
export async function fetchImportRecords(): Promise<ImportRecord[]> {
  if (!supabaseEnabled) return []
  const { data, error } = await supabase.from('import_records').select('*').order('created_at', { ascending: false })
  if (error) { console.error('fetchImportRecords:', error); return [] }
  return (data ?? []).map(row => {
    const obj = snakeToCamel(row) as unknown as ImportRecord
    obj.perBv = row.per_bv ?? {}
    obj.headers = row.headers ?? []
    obj.preview = row.preview ?? []
    return obj
  })
}

export async function insertImportRecord(record: ImportRecord): Promise<void> {
  if (!supabaseEnabled) return
  const row: Record<string, unknown> = {
    id: record.id,
    slot_id: record.slotId,
    slot_label: record.slotLabel,
    month: record.month,
    file_name: record.fileName,
    uploaded_at: record.uploadedAt,
    per_bv: record.perBv,
    total_amount: record.totalAmount,
    row_count: record.rowCount,
    parsed_count: record.parsedCount,
    skipped_count: record.skippedCount,
    detected_amount_col: record.detectedAmountCol,
    detected_bv_col: record.detectedBvCol,
    headers: record.headers,
    preview: record.preview,
    status: record.status,
    rejection_reason: record.rejectionReason ?? null,
  }
  const { error } = await supabase.from('import_records').upsert(row, { onConflict: 'id' })
  if (error) console.error('insertImportRecord:', error)
}

export async function updateImportRecordStatus(id: string, status: string, reason?: string): Promise<void> {
  if (!supabaseEnabled) return
  const patch: Record<string, unknown> = { status }
  if (reason !== undefined) patch['rejection_reason'] = reason
  const { error } = await supabase.from('import_records').update(patch).eq('id', id)
  if (error) console.error('updateImportRecordStatus:', error)
}

export async function deleteImportRecord(id: string): Promise<void> {
  if (!supabaseEnabled) return
  const { error } = await supabase.from('import_records').delete().eq('id', id)
  if (error) console.error('deleteImportRecord:', error)
}

// ── Import Raw Data ─────────────────────────────────────────────────────────
export async function insertRawData(entry: RawDataEntry): Promise<void> {
  if (!supabaseEnabled) return
  const row = {
    record_id: entry.recordId,
    slot_id: entry.slotId,
    slot_label: entry.slotLabel,
    month: entry.month,
    file_name: entry.fileName,
    uploaded_at: entry.uploadedAt,
    rows: entry.rows,
    amount_col: entry.amountCol,
    bv_col: entry.bvCol,
    status: entry.status,
  }
  // delete+insert pattern (import_raw_data heeft geen unique op record_id)
  await supabase.from('import_raw_data').delete().eq('record_id', entry.recordId)
  const { error } = await supabase.from('import_raw_data').insert(row)
  if (error) console.error('insertRawData:', error)
}

export async function updateRawDataStatus(recordId: string, status: string): Promise<void> {
  if (!supabaseEnabled) return
  const { error } = await supabase.from('import_raw_data').update({ status }).eq('record_id', recordId)
  if (error) console.error('updateRawDataStatus:', error)
}

export async function deleteRawData(recordId: string): Promise<void> {
  if (!supabaseEnabled) return
  const { error } = await supabase.from('import_raw_data').delete().eq('record_id', recordId)
  if (error) console.error('deleteRawData:', error)
}

export async function fetchRawData(): Promise<RawDataEntry[]> {
  if (!supabaseEnabled) return []
  const { data, error } = await supabase.from('import_raw_data').select('*')
  if (error) { console.error('fetchRawData:', error); return [] }
  return (data ?? []).map(row => ({
    recordId: row.record_id,
    slotId: row.slot_id,
    slotLabel: row.slot_label,
    month: row.month,
    fileName: row.file_name,
    uploadedAt: row.uploaded_at,
    rows: row.rows ?? [],
    amountCol: row.amount_col ?? '',
    bvCol: row.bv_col ?? '',
    status: row.status ?? 'pending',
  }))
}

// ── OHW Entities ────────────────────────────────────────────────────────────
export async function fetchOhwEntities(year: string): Promise<OhwEntityData[]> {
  if (!supabaseEnabled) return []
  const { data, error } = await supabase
    .from('ohw_entities')
    .select('*')
    .eq('year', year)
    .order('entity')
  // Throw bij echte fout — zie fetchClosingEntries: anders pusht de OHW-
  // reconcile bij elke poll alle entities terug → continue save-fouten.
  if (error) throw new Error(`fetchOhwEntities(${year}): ${error.message ?? error}`)
  return (data ?? []).map(row => row.data as OhwEntityData)
}

export async function upsertOhwEntity(year: string, entity: OhwEntityData): Promise<void> {
  if (!supabaseEnabled) return
  const row = {
    year,
    entity: entity.entity,
    data: entity,
  }
  await trackedWrite('ohw_entities', () =>
    supabase.from('ohw_entities').upsert(row, { onConflict: 'year,entity' }),
  )
}

export async function upsertAllOhwEntities(year: string, entities: OhwEntityData[]): Promise<void> {
  if (!supabaseEnabled) return
  const rows = entities.map(e => ({
    year,
    entity: e.entity,
    data: e,
  }))
  await trackedWrite('ohw_entities', () =>
    supabase.from('ohw_entities').upsert(rows, { onConflict: 'year,entity' }),
  )
}

// ── Budget Overrides (Budgetten tab — editable forward-month budgets) ──────
export interface BudgetOverrideRow {
  entity: string  // 'Consultancy' | 'Projects' | 'Software' | 'Holdings'
  month: string   // bv. 'Apr-26'
  plKey: string   // P&L-sleutel, bv. 'netto_omzet'
  value: number
}

export async function fetchBudgetOverrides(): Promise<BudgetOverrideRow[]> {
  if (!supabaseEnabled) return []
  // Throw bij echte fouten zodat de caller (useBudgetStore.loadFromDb) ze
  // via zijn try/catch kan opvangen en de reconcile-push kan overslaan.
  // Voorheen retourneerden we [] bij fouten, waardoor lokale overrides ten
  // onrechte als "missing in DB" werden gezien en in een loop terug werden
  // gepusht — bij netwerkfouten (Supabase offline) gaf dat honderden
  // "Failed to fetch"-toasts.
  const { data, error } = await supabase.from('budget_overrides').select('*')
  if (error) {
    console.error('fetchBudgetOverrides:', error)
    throw new Error(error.message ?? 'fetchBudgetOverrides failed')
  }
  return (data ?? []).map(row => ({
    entity: row.entity,
    month: row.month,
    plKey: row.pl_key,
    value: Number(row.value ?? 0),
  }))
}

export async function upsertBudgetOverride(row: BudgetOverrideRow): Promise<void> {
  if (!supabaseEnabled) return
  const payload = {
    entity: row.entity,
    month: row.month,
    pl_key: row.plKey,
    value: row.value,
  }
  await trackedWrite('budget_overrides', () =>
    supabase.from('budget_overrides').upsert(payload, { onConflict: 'entity,month,pl_key' }),
  )
}

export async function deleteBudgetOverridesForMonth(entity: string, month: string): Promise<void> {
  if (!supabaseEnabled) return
  const { error } = await supabase
    .from('budget_overrides')
    .delete()
    .eq('entity', entity)
    .eq('month', month)
  if (error) console.error('deleteBudgetOverridesForMonth:', error)
}

// ── OHW Evidence (bijlages / onderbouwing bestanden) ────────────────────────
export interface EvidenceEntry {
  id: string
  month: string
  entity: string          // BV
  ohwRowId: string        // ID van de OHW-rij (bv. 'c1', 'p10', 'c_ul')
  fileName: string
  mimeType: string
  fileSize: number        // bytes
  fileData: string        // base64 encoded content
  description: string
  uploadedAt: string
}

export async function fetchEvidence(): Promise<EvidenceEntry[]> {
  if (!supabaseEnabled) return []
  const { data, error } = await supabase.from('ohw_evidence').select('*').order('created_at', { ascending: false })
  if (error) { console.error('fetchEvidence:', error); return [] }
  return (data ?? []).map(row => snakeToCamel(row) as unknown as EvidenceEntry)
}

export async function insertEvidence(entry: EvidenceEntry): Promise<void> {
  if (!supabaseEnabled) return
  const row = {
    id: entry.id,
    month: entry.month,
    entity: entry.entity,
    ohw_row_id: entry.ohwRowId,
    file_name: entry.fileName,
    mime_type: entry.mimeType,
    file_size: entry.fileSize,
    file_data: entry.fileData,
    description: entry.description,
    uploaded_at: entry.uploadedAt,
  }
  const { error } = await supabase.from('ohw_evidence').upsert(row, { onConflict: 'id' })
  if (error) console.error('insertEvidence:', error)
}

export async function deleteEvidence(id: string): Promise<void> {
  if (!supabaseEnabled) return
  const { error } = await supabase.from('ohw_evidence').delete().eq('id', id)
  if (error) console.error('deleteEvidence:', error)
}

// ── Maandafsluiting finalisatie ─────────────────────────────────────────────
/** LE-forecast per BV op het moment dat een maand definitief werd afgesloten,
 *  zoals die was vóór de eigen actuals werden meegerekend. Drie KPIs zodat het
 *  rapport toont waar de prognose van afweek: netto omzet, brutomarge, EBITDA. */
export interface LeSnapshotByBv {
  netto_omzet?: number
  brutomarge?: number
  ebitda?: number
}

export interface FinalizedMonth {
  month: string                                 // 'Mar-26'
  finalizedAt: string
  finalizedBy: string
  checklist: Record<string, boolean>            // snapshot van afgevinkte items
  /** LE-snapshot per BV — optional zodat records van vóór deze feature blijven
   *  laden. Ontbrekend = popup toont "geen snapshot" en leReflection valt terug
   *  op live forecast-simulatie. */
  leSnapshot?: Record<string, LeSnapshotByBv>
}

export async function fetchFinalizedMonths(): Promise<FinalizedMonth[]> {
  if (!supabaseEnabled) return []
  const { data, error } = await supabase.from('closing_finalized').select('*')
  // Bij fout: throwen zodat de caller (useFinStore.loadFromDb) de bestaande
  // (mogelijk net optimistisch ge-update) finalized-state behoudt i.p.v. te
  // overschrijven met een lege array. Anders zou een tijdelijke read-fout
  // (RLS, netwerk, replicatie-lag) de zojuist afgesloten Maandafsluiting
  // weer als 'open' tonen.
  if (error) { console.error('fetchFinalizedMonths:', error); throw new Error(error.message) }
  return (data ?? []).map(row => ({
    month:       String(row.month),
    finalizedAt: String(row.finalized_at ?? ''),
    finalizedBy: String(row.finalized_by ?? ''),
    checklist:   (row.checklist ?? {}) as Record<string, boolean>,
    leSnapshot:  (row.le_snapshot ?? undefined) as Record<string, LeSnapshotByBv> | undefined,
  }))
}

export async function upsertFinalizedMonth(m: FinalizedMonth): Promise<{ error: string | null }> {
  if (!supabaseEnabled) return { error: null }  // local-only fallback
  const row = {
    month: m.month,
    finalized_at: m.finalizedAt,
    finalized_by: m.finalizedBy,
    checklist: m.checklist,
    le_snapshot: m.leSnapshot ?? null,
  }
  const { error } = await supabase
    .from('closing_finalized')
    .upsert(row, { onConflict: 'month' })
  if (error) { console.error('upsertFinalizedMonth:', error); return { error: error.message } }
  return { error: null }
}

export async function deleteFinalizedMonth(month: string): Promise<{ error: string | null }> {
  if (!supabaseEnabled) return { error: null }
  const { error } = await supabase.from('closing_finalized').delete().eq('month', month)
  if (error) { console.error('deleteFinalizedMonth:', error); return { error: error.message } }
  return { error: null }
}

// ── User Profiles (multi-user beheer) ───────────────────────────────────────
import type { ClosingBv } from '../data/types'

/** 4-niveau-rolsysteem (zie ook lib/permissions.ts). 'user' is de legacy-naam
 *  uit de 2-rollen-tijd en wordt bij read mapping naar 'viewer' geconverteerd. */
export type UserRole = 'viewer' | 'editor' | 'approver' | 'admin'

export interface UserProfile {
  email: string
  role: UserRole
  active: boolean
  needsPassword: boolean
  invitedBy: string
  invitedAt: string
  lastSignIn?: string | null
  /** Toegewezen BV — beperkt de gebruiker tot data van die BV. null = geen
   *  restrictie (admin / algemeen account). */
  bv?: ClosingBv | null
}

function parseBv(v: unknown): ClosingBv | null {
  if (typeof v !== 'string') return null
  const allowed: ClosingBv[] = ['Consultancy', 'Projects', 'Software', 'Holdings']
  return (allowed as string[]).includes(v) ? (v as ClosingBv) : null
}

function parseRole(v: unknown): UserRole {
  if (v === 'admin' || v === 'approver' || v === 'editor' || v === 'viewer') return v
  if (v === 'user') return 'viewer'  // legacy → viewer
  return 'viewer'
}

export async function fetchUserProfiles(): Promise<UserProfile[]> {
  if (!supabaseEnabled) return []
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .order('invited_at', { ascending: true })
  if (error) { console.error('fetchUserProfiles:', error); return [] }
  return (data ?? []).map(row => ({
    email:         String(row.email ?? ''),
    role:          parseRole(row.role),
    active:        !!row.active,
    needsPassword: !!row.needs_password,
    invitedBy:     String(row.invited_by ?? ''),
    invitedAt:     String(row.invited_at ?? ''),
    lastSignIn:    row.last_sign_in ?? null,
    bv:            parseBv(row.bv),
  }))
}

export async function upsertUserProfile(p: {
  email: string
  role?: UserRole
  active?: boolean
  needsPassword?: boolean
  invitedBy?: string
  /** null = wist de BV-restrictie. */
  bv?: ClosingBv | null
}): Promise<{ error: string | null }> {
  if (!supabaseEnabled) return { error: 'Supabase niet geconfigureerd' }
  const payload: Record<string, unknown> = {
    email: p.email.trim().toLowerCase(),
  }
  if (p.role !== undefined)          payload.role = p.role
  if (p.active !== undefined)        payload.active = p.active
  if (p.needsPassword !== undefined) payload.needs_password = p.needsPassword
  if (p.invitedBy !== undefined)     payload.invited_by = p.invitedBy
  if (p.bv !== undefined)            payload.bv = p.bv
  const { error } = await supabase
    .from('user_profiles')
    .upsert(payload, { onConflict: 'email' })
  if (error) {
    console.error('upsertUserProfile:', error)
    return { error: error.message }
  }
  return { error: null }
}

export async function deleteUserProfile(email: string): Promise<{ error: string | null }> {
  if (!supabaseEnabled) return { error: 'Supabase niet geconfigureerd' }
  const { error } = await supabase
    .from('user_profiles')
    .delete()
    .eq('email', email.trim().toLowerCase())
  if (error) {
    console.error('deleteUserProfile:', error)
    return { error: error.message }
  }
  return { error: null }
}

export async function touchUserSignIn(email: string): Promise<void> {
  if (!supabaseEnabled) return
  const { error } = await supabase
    .from('user_profiles')
    .update({ last_sign_in: new Date().toISOString() })
    .eq('email', email.trim().toLowerCase())
  if (error) console.error('touchUserSignIn:', error)
}

// ── Hours entries (SAP geschreven-uren per maand) ───────────────────────────
export async function fetchHoursEntries(): Promise<HoursEntry[]> {
  if (!supabaseEnabled) return []
  const { data, error } = await supabase.from('hours_entries').select('*')
  if (error) { console.error('fetchHoursEntries:', error); return [] }
  return (data ?? []).map(row => ({
    id: String(row.id), bv: row.bv, month: row.month,
    declarable: Number(row.declarable ?? 0), internal: Number(row.internal ?? 0),
    vakantie: Number(row.vakantie ?? 0), ziekte: Number(row.ziekte ?? 0),
    overigVerlof: Number(row.overig_verlof ?? 0),
  }))
}
export async function upsertHoursEntries(entries: HoursEntry[]): Promise<void> {
  if (!supabaseEnabled || entries.length === 0) return
  const rows = entries.map(e => ({
    id: e.id, bv: e.bv, month: e.month,
    declarable: e.declarable, internal: e.internal,
    vakantie: e.vakantie, ziekte: e.ziekte, overig_verlof: e.overigVerlof,
  }))
  await trackedWrite('hours_entries', () =>
    supabase.from('hours_entries').upsert(rows, { onConflict: 'id' }))
}
export async function deleteAllHoursEntries(): Promise<void> {
  if (!supabaseEnabled) return
  const { error } = await supabase.from('hours_entries').delete().neq('id', '')
  if (error) console.error('deleteAllHoursEntries:', error)
}

// ── Hours week entries (SAP-uren per ISO-week) ──────────────────────────────
export async function fetchHoursWeekEntries(): Promise<HoursWeekEntry[]> {
  if (!supabaseEnabled) return []
  const { data, error } = await supabase.from('hours_week_entries').select('*')
  if (error) { console.error('fetchHoursWeekEntries:', error); return [] }
  return (data ?? []).map(row => ({
    id: String(row.id), bv: row.bv, year: Number(row.year ?? 0), week: Number(row.week ?? 0),
    month: row.month, weekStart: row.week_start ?? '', weekEnd: row.week_end ?? '',
    declarable: Number(row.declarable ?? 0), internal: Number(row.internal ?? 0),
    vakantie: Number(row.vakantie ?? 0), ziekte: Number(row.ziekte ?? 0),
    overigVerlof: Number(row.overig_verlof ?? 0),
    plannedWork: Number(row.planned_work ?? 0), missingHoursOpen: Number(row.missing_hours_open ?? 0),
  }))
}
export async function upsertHoursWeekEntries(entries: HoursWeekEntry[]): Promise<void> {
  if (!supabaseEnabled || entries.length === 0) return
  const rows = entries.map(e => ({
    id: e.id, bv: e.bv, year: e.year, week: e.week, month: e.month,
    week_start: e.weekStart, week_end: e.weekEnd,
    declarable: e.declarable, internal: e.internal, vakantie: e.vakantie,
    ziekte: e.ziekte, overig_verlof: e.overigVerlof,
    planned_work: e.plannedWork, missing_hours_open: e.missingHoursOpen,
  }))
  await trackedWrite('hours_week_entries', () =>
    supabase.from('hours_week_entries').upsert(rows, { onConflict: 'id' }))
}
export async function deleteAllHoursWeekEntries(): Promise<void> {
  if (!supabaseEnabled) return
  const { error } = await supabase.from('hours_week_entries').delete().neq('id', '')
  if (error) console.error('deleteAllHoursWeekEntries:', error)
}

// ── Kosten-specificaties ────────────────────────────────────────────────────
export async function fetchCostBreakdowns(): Promise<CostBreakdown[]> {
  if (!supabaseEnabled) return []
  const { data, error } = await supabase.from('cost_breakdowns').select('*')
  if (error) { console.error('fetchCostBreakdowns:', error); return [] }
  return (data ?? []).map(row => {
    const v = (row.values ?? {}) as Record<string, number>
    return {
      id: String(row.id), month: row.month, category: row.category, label: row.label ?? '',
      values: {
        Consultancy: Number(v.Consultancy ?? 0), Projects: Number(v.Projects ?? 0),
        Software: Number(v.Software ?? 0), Holdings: Number(v.Holdings ?? 0),
      },
    }
  })
}
export async function upsertCostBreakdowns(items: CostBreakdown[]): Promise<void> {
  if (!supabaseEnabled || items.length === 0) return
  const rows = items.map(b => ({
    id: b.id, month: b.month, category: b.category, label: b.label, values: b.values,
  }))
  await trackedWrite('cost_breakdowns', () =>
    supabase.from('cost_breakdowns').upsert(rows, { onConflict: 'id' }))
}
export async function deleteCostBreakdown(id: string): Promise<void> {
  if (!supabaseEnabled) return
  const { error } = await supabase.from('cost_breakdowns').delete().eq('id', id)
  if (error) console.error('deleteCostBreakdown:', error)
}

// ── LE-reflecties ───────────────────────────────────────────────────────────
export async function fetchReflections(): Promise<ReflectionRecord[]> {
  if (!supabaseEnabled) return []
  const { data, error } = await supabase.from('closing_reflections').select('*')
  if (error) { console.error('fetchReflections:', error); return [] }
  return (data ?? []).map(row => ({
    month: String(row.month),
    bv: row.bv as ReflectionRecord['bv'],
    answers: (row.answers ?? []) as ReflectionRecord['answers'],
  }))
}
export async function upsertReflections(records: ReflectionRecord[]): Promise<void> {
  if (!supabaseEnabled || records.length === 0) return
  const rows = records.map(r => ({
    id: `${r.month}::${r.bv ?? 'all'}`,
    month: r.month, bv: r.bv ?? 'all', answers: r.answers,
  }))
  await trackedWrite('closing_reflections', () =>
    supabase.from('closing_reflections').upsert(rows, { onConflict: 'id' }))
}

// ── Interne uren (gedetailleerde niet-declarabele uren per BV/maand) ────────
export async function fetchInternalHours(): Promise<InternalHoursEntry[]> {
  if (!supabaseEnabled) return []
  const { data, error } = await supabase.from('internal_hours').select('*')
  if (error) { console.error('fetchInternalHours:', error); return [] }
  return (data ?? []).map(row => ({
    id: String(row.id), bv: row.bv, month: row.month,
    categories: (row.categories ?? {}) as Record<string, number>,
    employees: (row.employees ?? []) as InternalHoursEntry['employees'],
  }))
}
export async function upsertInternalHours(entries: InternalHoursEntry[]): Promise<void> {
  if (!supabaseEnabled || entries.length === 0) return
  const rows = entries.map(e => ({
    id: e.id, bv: e.bv, month: e.month,
    categories: e.categories, employees: e.employees,
  }))
  await trackedWrite('internal_hours', () =>
    supabase.from('internal_hours').upsert(rows, { onConflict: 'id' }))
}
export async function deleteAllInternalHours(): Promise<void> {
  if (!supabaseEnabled) return
  const { error } = await supabase.from('internal_hours').delete().neq('id', '')
  if (error) console.error('deleteAllInternalHours:', error)
}

// ── Notificaties (gedeelde bell-inbox) ──────────────────────────────────────
// Alle clients lezen dezelfde notifications-tabel; via Supabase Realtime
// verschijnt een nieuwe melding direct in de bell-inbox van elke ingelogde
// gebruiker. Gelezen-status (`read_by`) is een array van emails — per-user
// markeren-als-gelezen blijft individueel terwijl de melding zelf gedeeld is.
import type { Notification } from '../store/useNotificationStore'

export async function fetchNotifications(): Promise<Notification[]> {
  if (!supabaseEnabled) return []
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) { console.error('fetchNotifications:', error); return [] }
  return (data ?? []).map(row => ({
    id:         String(row.id),
    category:   row.category,
    audience:   Array.isArray(row.audience) ? row.audience : [],
    title:      String(row.title ?? ''),
    body:       row.body ?? undefined,
    link:       row.link_tab
      ? { tab: row.link_tab, month: row.link_month ?? undefined }
      : undefined,
    createdAt:  String(row.created_at ?? ''),
    readBy:     Array.isArray(row.read_by) ? row.read_by : [],
    dedupeKey:  row.dedupe_key ?? undefined,
  }) as Notification)
}

export async function upsertNotification(n: Notification): Promise<void> {
  if (!supabaseEnabled) return
  const row = {
    id:         n.id,
    category:   n.category,
    audience:   n.audience,
    title:      n.title,
    body:       n.body ?? null,
    link_tab:   n.link?.tab ?? null,
    link_month: n.link?.month ?? null,
    dedupe_key: n.dedupeKey ?? null,
    read_by:    n.readBy,
    created_at: n.createdAt,
  }
  await trackedWrite('notifications', () =>
    supabase.from('notifications').upsert(row, { onConflict: 'id' }))
}

export async function deleteNotification(id: string): Promise<void> {
  if (!supabaseEnabled) return
  const { error } = await supabase.from('notifications').delete().eq('id', id)
  if (error) console.error('deleteNotification:', error)
}

export async function deleteNotificationsByDedupe(dedupeKey: string): Promise<void> {
  if (!supabaseEnabled) return
  const { error } = await supabase.from('notifications').delete().eq('dedupe_key', dedupeKey)
  if (error) console.error('deleteNotificationsByDedupe:', error)
}

// ── Forecast inputs (Voorspelling huidige maand) ───────────────────────────
// Partial-month inputs (uploads + handmatige OHW-schatting + notes) die als
// pure prognose-data gebruikt worden door de forecastEngine. Géén effect op
// OHW Overzicht of import_records — de tabel is bewust geïsoleerd.
import type { ForecastInputRecord } from '../store/useForecastStore'

export async function fetchForecastInputs(): Promise<ForecastInputRecord[]> {
  if (!supabaseEnabled) return []
  const { data, error } = await supabase.from('forecast_inputs').select('*').order('updated_at', { ascending: false })
  if (error) { console.error('fetchForecastInputs:', error); return [] }
  return (data ?? []).map(row => ({
    id:          String(row.id),
    month:       String(row.month),
    slot:        String(row.slot),
    bv:          row.bv ?? null,
    payload:     (row.payload ?? {}) as Record<string, unknown>,
    fileName:    row.file_name ?? null,
    uploadedBy:  row.uploaded_by ?? null,
    uploadedAt:  String(row.uploaded_at ?? ''),
  }))
}

export async function upsertForecastInput(rec: ForecastInputRecord): Promise<void> {
  if (!supabaseEnabled) return
  const row = {
    id:          rec.id,
    month:       rec.month,
    slot:        rec.slot,
    bv:          rec.bv,
    payload:     rec.payload,
    file_name:   rec.fileName,
    uploaded_by: rec.uploadedBy,
    uploaded_at: rec.uploadedAt,
  }
  await trackedWrite('forecast_inputs', () =>
    supabase.from('forecast_inputs').upsert(row, { onConflict: 'id' }))
}

export async function deleteForecastInput(id: string): Promise<void> {
  if (!supabaseEnabled) return
  const { error } = await supabase.from('forecast_inputs').delete().eq('id', id)
  if (error) console.error('deleteForecastInput:', error)
}

export async function deleteForecastInputsForMonth(month: string): Promise<void> {
  if (!supabaseEnabled) return
  const { error } = await supabase.from('forecast_inputs').delete().eq('month', month)
  if (error) console.error('deleteForecastInputsForMonth:', error)
}
