import type { GlobalFilter, ClosingBv, TabId } from '../../data/types'

const TITLES: Record<TabId, string> = {
  dashboard:  'Executive Overview',
  hours:      'Uren Dashboard',
  ohw:        'OHW Overzicht',
  budget:     'Budget vs Actuals',
  budgets:    'Budgetten',
  maand:      'Maandafsluiting',
  users:      'Gebruikersbeheer',
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

export function Topbar({ tab, filter, onFilterChange }: Props) {
  const showFilters = FILTER_TABS.includes(tab)

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

            {/* BV selector — tabs met kleurcodering */}
            <span style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', marginRight: 2 }}>BV:</span>
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
          </div>
        )}

        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', animation: 'pulse 2s infinite' }} />
          Live
        </div>
      </div>
    </div>
  )
}
