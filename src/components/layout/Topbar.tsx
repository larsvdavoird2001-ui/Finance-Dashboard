import type { ClosingBv, TabId } from '../../data/types'
import { useSaveStatus } from '../../lib/saveStatus'
import { NotificationInbox } from './NotificationInbox'

const TITLES: Record<TabId, string> = {
  dashboard:  'Executive Overview',
  hours:      'Uren Dashboard',
  ohw:        'OHW Overzicht',
  budget:     'Budget vs Actuals',
  budgets:    'Budgetten',
  maand:      'Maandafsluiting',
  users:      'Gebruikersbeheer',
  backups:    'Backups',
}

export const BV_COLORS: Record<ClosingBv, string> = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
  Holdings:    '#8fa3c0',
}

interface Props {
  tab: TabId
  userEmail?: string | null
}

function fmtSyncTime(ts: number | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function SyncIndicator() {
  const state = useSaveStatus(s => s.state)
  const pending = useSaveStatus(s => s.pending)
  const successCount = useSaveStatus(s => s.successCount)
  const errorCount = useSaveStatus(s => s.errorCount)
  const lastSyncedAt = useSaveStatus(s => s.lastSyncedAt)
  const lastError = useSaveStatus(s => s.lastError)
  const activeTables = useSaveStatus(s => s.activeTables)

  let dotColor = 'var(--t3)'
  let label = 'Geen wijzigingen nog'
  let tooltip = `${successCount} succesvolle saves · ${errorCount} fouten`

  if (state === 'syncing' || pending > 0) {
    dotColor = 'var(--amber)'
    label = `⏳ Syncen... (${pending})`
    tooltip = `Bezig met opslaan van: ${[...activeTables].join(', ')}`
  } else if (state === 'error') {
    dotColor = 'var(--red)'
    label = `⚠ Save-fout`
    tooltip = lastError ?? 'Onbekende fout — zie console'
  } else if (state === 'synced' && lastSyncedAt) {
    dotColor = 'var(--green)'
    label = `✓ Gesynchroniseerd ${fmtSyncTime(lastSyncedAt)}`
    tooltip = `Laatste save naar Supabase: ${fmtSyncTime(lastSyncedAt)}\n${successCount} succesvolle saves deze sessie`
  }

  return (
    <div
      title={tooltip}
      style={{
        fontSize: 11, color: 'var(--t2)',
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '3px 9px', borderRadius: 5,
        background: state === 'error' ? 'var(--bd-red)' : 'transparent',
        border: state === 'error' ? '1px solid var(--red)' : '1px solid transparent',
      }}
    >
      <span style={{
        width: 7, height: 7, borderRadius: '50%',
        background: dotColor,
        animation: state === 'syncing' ? 'pulse 1.2s infinite' : undefined,
      }} />
      {label}
    </div>
  )
}

export function Topbar({ tab, userEmail }: Props) {
  return (
    <div className="topbar" style={{ flexWrap: 'wrap', height: 'auto', minHeight: 52, gap: 0, padding: '0 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', minHeight: 52, gap: 10 }}>
        <div className="tb-title">{TITLES[tab] ?? tab}</div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <NotificationInbox userEmail={userEmail ?? null} />
          <SyncIndicator />
          <div style={{ fontSize: 11, color: 'var(--t3)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', animation: 'pulse 2s infinite' }} />
            Live
          </div>
        </div>
      </div>
    </div>
  )
}
