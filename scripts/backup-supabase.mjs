#!/usr/bin/env node
/**
 * Supabase backup script — wordt door GitHub Actions periodiek uitgevoerd.
 *
 * Leest alle tabellen via de Supabase REST API met de service-role key
 * (bypassed RLS) en schrijft één JSON-bestand naar backups/<datum>/<ts>.json.
 *
 * Vereiste env-vars:
 *   SUPABASE_URL          — bv. https://xxx.supabase.co
 *   SUPABASE_SERVICE_ROLE — service_role key (NIET de anon key)
 *
 * In Github → Settings → Secrets and variables → Actions → New repository secret.
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('❌ SUPABASE_URL en SUPABASE_SERVICE_ROLE moeten als env-vars gezet zijn')
  process.exit(1)
}

// Tabellen die we backuppen. user_profiles bewaren we ook (admin-lijst).
const TABLES = [
  'closing_entries',
  'fte_entries',
  'import_records',
  'import_raw_data',
  'ohw_entities',
  'budget_overrides',
  'tariff_entries',
  'ohw_evidence',
  'closing_archives',
  'user_profiles',
]

async function fetchTable(name) {
  // PostgREST geeft maximaal 1000 rijen per request — paginate als nodig.
  let all = []
  let offset = 0
  const pageSize = 1000
  for (;;) {
    const url = `${SUPABASE_URL}/rest/v1/${name}?select=*&offset=${offset}&limit=${pageSize}`
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
        Prefer: 'count=exact',
      },
    })
    if (!res.ok) {
      const txt = await res.text()
      console.warn(`  ⚠ ${name}: ${res.status} — ${txt.slice(0, 200)}`)
      return all
    }
    const rows = await res.json()
    all = all.concat(rows)
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return all
}

async function main() {
  const exportedAt = new Date().toISOString()
  console.log(`📦 Supabase backup gestart — ${exportedAt}`)
  const tables = {}
  let totalRows = 0
  for (const t of TABLES) {
    const rows = await fetchTable(t)
    tables[t] = rows
    totalRows += rows.length
    console.log(`  ${t.padEnd(22)} ${String(rows.length).padStart(5)} rijen`)
  }

  const date = exportedAt.slice(0, 10)        // 2026-04-28
  const ts   = exportedAt.slice(0, 19).replace(/[:T]/g, '-')  // 2026-04-28-12-34-56
  const dir  = `backups/${date}`
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })

  const file = `${dir}/${ts}.json`
  await writeFile(file, JSON.stringify({ exportedAt, totalRows, tables }, null, 2))
  console.log(`✅ Geschreven: ${file} (${totalRows} totaal rijen)`)

  // 'latest' shortcut — staat altijd op het meest recente backup-pad.
  await writeFile(
    'backups/LATEST.json',
    JSON.stringify({ exportedAt, totalRows, file }, null, 2),
  )
}

main().catch(e => {
  console.error('❌ Backup faalde:', e)
  process.exit(1)
})
