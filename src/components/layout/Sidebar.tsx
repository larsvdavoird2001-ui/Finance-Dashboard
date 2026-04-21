import type { TabId } from '../../data/types'

interface Props {
  active: TabId
  onNav: (t: TabId) => void
  userEmail?: string | null
  onSignOut?: () => void | Promise<void>
}

const items: { id: TabId; ic: string; label: string; group: string }[] = [
  // CFO Dashboards
  { id: 'dashboard',  ic: '🏠', label: 'Executive Overview',   group: 'CFO Dashboard' },
  { id: 'hours',      ic: '⏱',  label: 'Uren Dashboard',       group: 'CFO Dashboard' },
  { id: 'financials', ic: '📈', label: 'Financiële Prestatie', group: 'CFO Dashboard' },
  // Rapportage
  { id: 'budget',  ic: '🎯', label: 'Budget vs Actuals',  group: 'Rapportage' },
  { id: 'budgets', ic: '💼', label: 'Budgetten',          group: 'Rapportage' },
  // Input
  { id: 'ohw',   ic: '📋', label: 'OHW Overzicht',   group: 'Input' },
  { id: 'maand', ic: '📅', label: 'Maandafsluiting',  group: 'Input' },
]

export function Sidebar({ active, onNav, userEmail, onSignOut }: Props) {
  const groups = [...new Set(items.map(i => i.group))]
  return (
    <nav className="sb">
      <div className="sb-logo">
        <img src="/tpg-logo.png" alt="The People Group" className="sb-logo-img" />
        <div className="sb-logo-sub">Finance · CFO</div>
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
        {userEmail && (
          <div style={{
            padding: '8px 10px', marginBottom: 6,
            background: 'var(--bg3)', borderRadius: 7,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 26, height: 26, borderRadius: '50%',
              background: 'var(--brand)', color: '#fff',
              fontSize: 11, fontWeight: 700, flexShrink: 0,
            }}>
              {userEmail.slice(0, 2).toUpperCase()}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' }}>
                Admin
              </div>
              <div style={{
                fontSize: 10, color: 'var(--t2)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }} title={userEmail}>
                {userEmail}
              </div>
            </div>
          </div>
        )}
        {onSignOut && userEmail && (
          <button
            className="btn sm ghost"
            style={{ fontSize: 10, width: '100%', justifyContent: 'center', color: 'var(--red)', marginBottom: 4 }}
            onClick={() => onSignOut()}
          >
            ↩ Uitloggen
          </button>
        )}
        <div style={{ fontSize: 9, color: 'var(--t3)', padding: '4px 6px', textAlign: 'center' }}>v10.0 · React 19</div>
      </div>
    </nav>
  )
}
