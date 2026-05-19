import type { TabId } from '../../data/types'
import type { UserRole } from '../../lib/db'

interface Props {
  active: TabId
  onNav: (t: TabId) => void
  userEmail?: string | null
  isAdmin?: boolean
  userRole?: UserRole
  onSignOut?: () => void | Promise<void>
}

const items: { id: TabId; ic: string; label: string; group: string; adminOnly?: boolean; hideForViewer?: boolean }[] = [
  // Executive dashboards — bovenste groep in de sidebar
  { id: 'dashboard',  ic: '🏠', label: 'Executive Overview',   group: 'Overview' },
  { id: 'hours',      ic: '⏱',  label: 'Uren Dashboard',       group: 'Overview' },
  // Rapportage
  { id: 'budget',  ic: '🎯', label: 'Budget vs Actuals',  group: 'Rapportage' },
  { id: 'budgets', ic: '💼', label: 'Budgetten',          group: 'Rapportage' },
  // Input
  { id: 'ohw',   ic: '📋', label: 'OHW Overzicht',   group: 'Input' },
  // Maandafsluiting is alleen relevant voor users die data invullen/goedkeuren —
  // viewers (alleen-lezen) hebben er niets te zoeken.
  { id: 'maand', ic: '📅', label: 'Maandafsluiting',  group: 'Input', hideForViewer: true },
  // Beheer (admin-only). Backups zijn volledig automatisch (start-van-de-dag
  // + na elke wijziging) — er is daarom geen losse tab meer voor. Een admin
  // kan via het kleine "↺ Backup herstellen" knopje in de sidebar-footer
  // alsnog naar de restore-UI navigeren als een rollback nodig is.
  { id: 'users',   ic: '👥', label: 'Gebruikers', group: 'Beheer', adminOnly: true },
]

export function Sidebar({ active, onNav, userEmail, isAdmin, userRole, onSignOut }: Props) {
  const isViewer = !isAdmin && userRole === 'viewer'
  const visibleItems = items.filter(i => {
    if (i.adminOnly && !isAdmin) return false
    if (i.hideForViewer && isViewer) return false
    return true
  })
  const groups = [...new Set(visibleItems.map(i => i.group))]
  return (
    <nav className="sb">
      <div className="sb-logo">
        <img src="/tpg-logo.png" alt="The People Group" className="sb-logo-img" />
        <div className="sb-logo-sub">Business Control</div>
      </div>
      {groups.map(g => (
        <div key={g} className="sb-group">
          <div className="sb-grp-lbl">{g}</div>
          {visibleItems.filter(i => i.group === g).map(i => (
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
                {isAdmin ? 'Beheerder'
                  : userRole === 'admin' ? 'Beheerder'
                  : userRole === 'approver' ? 'Controller'
                  : userRole === 'editor' ? 'Fin. administratie'
                  : 'Lezer'}
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
        {isAdmin && (
          <button
            className="btn sm ghost"
            style={{ fontSize: 10, width: '100%', justifyContent: 'center', marginBottom: 4, color: 'var(--t2)' }}
            onClick={() => onNav('backups')}
            title="Bekijk en herstel automatische snapshots (start-van-de-dag + na elke wijziging)"
          >
            ↺ Backup herstellen
          </button>
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
