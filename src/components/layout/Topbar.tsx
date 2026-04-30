import type { GlobalFilter, ClosingBv, TabId } from '../../data/types'
import { useSaveStatus } from '../../lib/saveStatus'
import { useLockedBv } from '../../lib/permissions'

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

const BV_OPTIONS: Array<{ id: ClosingBv | 'all'; label: string; sub?: string }> = [
  { id: 'all',         label: 'Alle BV\'s' },
  { id: 'Consultancy', label: 'Consultancy' },
  { id: 'Projects',    label: 'Projects' },
  { id: 'Software',    label: 'Software' },
  { id: 'Holdings',    label: 'Holdings', sub: 'kosten' },
]

const YEAR_OPTIONS: Array<{ id: GlobalFilter['year']; label: string }> = [
  { id: '2026', label: '2026' },
  { id: '2025', label: '2025' },
  { id: 'all',  label: 'Alle jaren' },
]

// Only show global filters on dashboard tabs
const FILTER_TABS: TabId[] = ['dashboard', 'hours', 'ohw', 'budget', 'budgets', 'maand']

interface Props {
  tab: TabId
  filter: GlobalFilter
  onFilterChange: (f: Partial<GlobalFilter>) => void
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

export function Topbar({ tab, filter, onFilterChange }: Props) {
  const showFilters = FILTER_TABS.includes(tab)
  const lockedBv = useLockedBv()

  return (
    <div className="topbar" style={{ flexWrap: 'wrap', height: 'auto', minHeight: 52, gap: 0, padding: '0 18px' }}>
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', width: '100%', minHeight: 52, gap: 10 }}>
        <div className="tb-title">{TITLES[tab] ?? tab}</div>

        {showFilters && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Year selector */}
            <span style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', marginRight: 2 }}>Jaar:</span>
            {YEAR_OPTIONS.map(o => (
              <button
                key={o.id}
                onClick={() => onFilterChange({ year: o.id })}
                style={{
                  padding: '3px 8px',
                  borderRadius: 5,
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: 'pointer',
                  border: '1px solid',
                  fontFamily: 'var(--font)',
                  transition: 'all .12s',
                  borderColor: filter.year === o.id ? 'rgba(255,255,255,0.25)' : 'var(--bd2)',
                  background: filter.year === o.id ? 'var(--bg4)' : 'transparent',
                  color: filter.year === o.id ? 'var(--t1)' : 'var(--t3)',
                }}
              >
                {o.label}
              </button>
            ))}

            <div style={{ width: 1, height: 18, background: 'var(--bd2)', margin: '0 6px' }} />

            {/* BV selector — tabs met kleurcodering. Voor BV-locked users tonen we
                alleen een read-only badge i.p.v. de switcher. */}
            <span style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', marginRight: 2 }}>BV:</span>
            {lockedBv ? (
              <span
                title={`Je account is gekoppeld aan ${lockedBv} — je ziet alleen data van deze BV.`}
                style={{
                  padding: '3px 10px',
                  borderRadius: 5,
                  fontSize: 11,
                  fontWeight: 600,
                  border: `1px solid ${BV_COLORS[lockedBv]}`,
                  background: BV_COLORS[lockedBv] + '22',
                  color: BV_COLORS[lockedBv],
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontFamily: 'var(--font)',
                }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: BV_COLORS[lockedBv], display: 'inline-block', flexShrink: 0,
                }} />
                {lockedBv}
                <span style={{ fontSize: 9, marginLeft: 2, opacity: 0.7 }}>🔒</span>
              </span>
            ) : (
              <>
                {BV_OPTIONS.map(o => {
                  const isActive = filter.bv === o.id
                  const color = o.id !== 'all' ? BV_COLORS[o.id as ClosingBv] : undefined
                  return (
                    <button
                      key={o.id}
                      onClick={() => onFilterChange({ bv: o.id })}
                      style={{
                        padding: '3px 10px',
                        borderRadius: 5,
                        fontSize: 11,
                        fontWeight: isActive ? 600 : 500,
                        cursor: 'pointer',
                        border: '1px solid',
                        fontFamily: 'var(--font)',
                        transition: 'all .12s',
                        borderColor: isActive ? (color ?? 'rgba(255,255,255,0.25)') : 'var(--bd2)',
                        background: isActive
                          ? color ? color + '22' : 'var(--bg4)'
                          : 'transparent',
                        color: isActive ? (color ?? 'var(--t1)') : 'var(--t3)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      {color && (
                        <span style={{
                          width: 6, height: 6, borderRadius: '50%',
                          background: isActive ? color : 'var(--t3)',
                          display: 'inline-block',
                          flexShrink: 0,
                        }} />
                      )}
                      {o.label}
                      {o.sub && (
                        <span style={{ fontSize: 9, color: isActive ? color : 'var(--t3)', opacity: 0.75, marginLeft: 2 }}>
                          ({o.sub})
                        </span>
                      )}
                    </button>
                  )
                })}

                {(filter.bv !== 'all' || filter.year !== '2026') && (
                  <button
                    style={{
                      padding: '3px 7px',
                      borderRadius: 5,
                      fontSize: 10,
                      cursor: 'pointer',
                      border: '1px solid var(--bd2)',
                      background: 'transparent',
                      color: 'var(--t3)',
                      fontFamily: 'var(--font)',
                      marginLeft: 2,
                    }}
                    onClick={() => onFilterChange({ bv: 'all', year: '2026' })}
                    title="Reset filters"
                  >
                    ✕ Reset
                  </button>
                )}
              </>
            )}
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
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
