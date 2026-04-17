import type { TabId } from '../../data/types'

interface Props { active: TabId; onNav: (t: TabId) => void }

const items: { id: TabId; ic: string; label: string; group: string }[] = [
  // CFO Dashboards
  { id: 'dashboard',  ic: '🏠', label: 'Executive Overview',   group: 'CFO Dashboard' },
  { id: 'hours',      ic: '⏱',  label: 'Uren Dashboard',       group: 'CFO Dashboard' },
  { id: 'financials', ic: '📈', label: 'Financiële Prestatie', group: 'CFO Dashboard' },
  // Rapportage
  { id: 'pl',     ic: '📊', label: 'P&L Dashboard',      group: 'Rapportage' },
  { id: 'budget', ic: '🎯', label: 'Budget vs Actuals',  group: 'Rapportage' },
  // Input
  { id: 'ohw',   ic: '📋', label: 'OHW Overzicht',   group: 'Input' },
  { id: 'maand', ic: '📅', label: 'Maandafsluiting',  group: 'Input' },
]

export function Sidebar({ active, onNav }: Props) {
  const groups = [...new Set(items.map(i => i.group))]
  return (
    <nav className="sb">
      <div className="sb-logo">
        <div className="logo-mark">TPG</div>
        <div>
          <div className="logo-name">Finance OS</div>
          <div className="logo-sub">CFO Dashboard</div>
        </div>
      </div>
      {groups.map(g => (
        <div key={g} className="sb-group">
          <div className="sb-grp-lbl">{g}</div>
          {items.filter(i => i.group === g).map(i => (
            <button
              key={i.id}
              className={`nav${active === i.id ? ' active' : ''}`}
              onClick={() => onNav(i.id)}
            >
              <span className="nav-ic">{i.ic}</span>{i.label}
            </button>
          ))}
        </div>
      ))}
      <div className="sb-foot">
        <div style={{ fontSize: 10, color: 'var(--t3)', padding: '4px 6px' }}>v9.0 · React 19</div>
      </div>
    </nav>
  )
}
