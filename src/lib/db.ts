// db.ts — Supabase database service laag voor TPG Finance
// Alle CRUD operaties voor de 5 tabellen.
// Als Supabase niet geconfigureerd is, retourneren alle functies lege data.
import { supabase, supabaseEnabled } from './supabase'
import type { ClosingEntry, FteEntry, ImportRecord, OhwEntityData } from '../data/types'
import type { RawDataEntry } from '../store/useRawDataStore'
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
  if (error) { console.error('fetchClosingEntries:', error); return [] }
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
  if (error) { console.error('fetchFteEntries:', error); return [] }
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
  if (error) { console.error('fetchOhwEntities:', error); return [] }
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
  const { data, error } = await supabase.from('budget_overrides').select('*')
  if (error) { console.error('fetchBudgetOverrides:', error); return [] }
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

// ── User Profiles (multi-user beheer) ───────────────────────────────────────
export interface UserProfile {
  email: string
  role: 'admin' | 'user'
  active: boolean
  needsPassword: boolean
  invitedBy: string
  invitedAt: string
  lastSignIn?: string | null
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
    role:          (row.role === 'admin' ? 'admin' : 'user') as 'admin' | 'user',
    active:        !!row.active,
    needsPassword: !!row.needs_password,
    invitedBy:     String(row.invited_by ?? ''),
    invitedAt:     String(row.invited_at ?? ''),
    lastSignIn:    row.last_sign_in ?? null,
  }))
}

export async function upsertUserProfile(p: {
  email: string
  role?: 'admin' | 'user'
  active?: boolean
  needsPassword?: boolean
  invitedBy?: string
}): Promise<{ error: string | null }> {
  if (!supabaseEnabled) return { error: 'Supabase niet geconfigureerd' }
  const payload: Record<string, unknown> = {
    email: p.email.trim().toLowerCase(),
  }
  if (p.role !== undefined)          payload.role = p.role
  if (p.active !== undefined)        payload.active = p.active
  if (p.needsPassword !== undefined) payload.needs_password = p.needsPassword
  if (p.invitedBy !== undefined)     payload.invited_by = p.invitedBy
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
