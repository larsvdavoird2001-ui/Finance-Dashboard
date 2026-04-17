// db.ts — Supabase database service laag voor TPG Finance
// Alle CRUD operaties voor de 5 tabellen.
// Als Supabase niet geconfigureerd is, retourneren alle functies lege data.
import { supabase, supabaseEnabled } from './supabase'
import type { ClosingEntry, FteEntry, ImportRecord, OhwEntityData } from '../data/types'
import type { RawDataEntry } from '../store/useRawDataStore'

// ── Helpers ─────────────────────────────────────────────────────────────────
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
  const { error } = await supabase.from('closing_entries').upsert(row, { onConflict: 'id' })
  if (error) console.error('upsertClosingEntry:', error)
}

export async function upsertAllClosingEntries(entries: ClosingEntry[]): Promise<void> {
  if (!supabaseEnabled) return
  const rows = entries.map(e => camelToSnake(e as unknown as Record<string, unknown>))
  const { error } = await supabase.from('closing_entries').upsert(rows, { onConflict: 'id' })
  if (error) console.error('upsertAllClosingEntries:', error)
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
  const { error } = await supabase.from('fte_entries').upsert(row, { onConflict: 'id' })
  if (error) console.error('upsertFteEntry:', error)
}

export async function upsertAllFteEntries(entries: FteEntry[]): Promise<void> {
  if (!supabaseEnabled) return
  const rows = entries.map(e => camelToSnake(e as unknown as Record<string, unknown>))
  const { error } = await supabase.from('fte_entries').upsert(rows, { onConflict: 'id' })
  if (error) console.error('upsertAllFteEntries:', error)
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
  const { error } = await supabase
    .from('ohw_entities')
    .upsert(row, { onConflict: 'year,entity' })
  if (error) console.error('upsertOhwEntity:', error)
}

export async function upsertAllOhwEntities(year: string, entities: OhwEntityData[]): Promise<void> {
  if (!supabaseEnabled) return
  const rows = entities.map(e => ({
    year,
    entity: e.entity,
    data: e,
  }))
  const { error } = await supabase
    .from('ohw_entities')
    .upsert(rows, { onConflict: 'year,entity' })
  if (error) console.error('upsertAllOhwEntities:', error)
}
