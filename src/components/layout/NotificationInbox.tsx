// Berichteninbox voor de Topbar — toont een bel-icoon met ongelezen-badge.
// Klik opent een dropdown met meldingen die voor de huidige rol zichtbaar
// zijn (audience filter), klik op een notificatie navigeert naar de juiste
// tab/maand en markeert hem als gelezen.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNotificationStore, type Notification } from '../../store/useNotificationStore'
import { useNavStore } from '../../store/useNavStore'
import { usePermissions } from '../../lib/permissions'

const CAT_LABEL: Record<Notification['category'], string> = {
  'import-pending':    'Import wacht op goedkeuring',
  'tariff-pending':    'IC-tarieven controleren',
  'maand-start':       'Maandafsluiting starten',
  'maand-finalized':   'Maand afgesloten',
  'reflection-needed': 'LE-leerlus',
  'general':           'Algemeen',
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMin = Math.round((now.getTime() - d.getTime()) / 60000)
    if (diffMin < 1) return 'zojuist'
    if (diffMin < 60) return `${diffMin} min geleden`
    const diffH = Math.round(diffMin / 60)
    if (diffH < 24) return `${diffH} uur geleden`
    const diffD = Math.round(diffH / 24)
    if (diffD < 7) return `${diffD} dag${diffD === 1 ? '' : 'en'} geleden`
    return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })
  } catch { return iso }
}

interface Props {
  userEmail: string | null
}

export function NotificationInbox({ userEmail }: Props) {
  const { role } = usePermissions()
  // BELANGRIJK: select de raw `notifications`-array (stabiele referentie via
  // zustand) en bereken de gefilterde lijsten in useMemo. Een `s.visibleFor()`
  // selector zou bij elke render een nieuwe array teruggeven → "getSnapshot
  // should be cached" infinite-loop in React 18.
  const notifications = useNotificationStore(s => s.notifications)
  const markRead = useNotificationStore(s => s.markRead)
  const markAllRead = useNotificationStore(s => s.markAllRead)
  const remove = useNotificationStore(s => s.remove)
  const navigateTo = useNavStore(s => s.navigateTo)

  const visible = useMemo(() => {
    if (!role) return [] as Notification[]
    return notifications
      .filter(n => n.audience.includes(role))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [notifications, role])
  const unread = useMemo(() => {
    const norm = (userEmail ?? '').trim().toLowerCase()
    return visible.filter(n => !n.readBy.includes(norm))
  }, [visible, userEmail])

  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Klik buiten dropdown → sluiten.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  // Geen role → niets tonen (uitgelogd of viewer-only inbox is leeg).
  if (!role) return null

  const handleClick = (n: Notification) => {
    if (userEmail) markRead(n.id, userEmail)
    if (n.link) {
      // Alleen tabs die useNavStore ondersteunt deeplinken; rest negeren we.
      const t = n.link.tab
      if (t === 'maand' || t === 'ohw' || t === 'budget') {
        navigateTo({ tab: t, month: n.link.month })
      }
    }
    setOpen(false)
  }

  const handleMarkAll = () => {
    if (!userEmail) return
    markAllRead(userEmail, role)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title={`${unread.length} nieuwe ${unread.length === 1 ? 'melding' : 'meldingen'}`}
        style={{
          position: 'relative',
          width: 28, height: 28, borderRadius: 6,
          background: open ? 'var(--bg4)' : 'transparent',
          border: '1px solid', borderColor: open ? 'var(--bd3)' : 'var(--bd2)',
          color: 'var(--t2)', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14,
          fontFamily: 'var(--font)',
        }}
      >
        🔔
        {unread.length > 0 && (
          <span
            aria-label={`${unread.length} ongelezen`}
            style={{
              position: 'absolute', top: -4, right: -4,
              minWidth: 16, height: 16, padding: '0 4px',
              borderRadius: 999,
              background: 'var(--red)', color: '#fff',
              fontSize: 9, fontWeight: 800,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: '1.5px solid var(--bg2)',
            }}
          >
            {unread.length > 99 ? '99+' : unread.length}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0,
            width: 360, maxHeight: 480, overflowY: 'auto',
            background: 'var(--bg2)', border: '1px solid var(--bd2)',
            borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,.50), 0 4px 12px rgba(0,169,224,.14)',
            zIndex: 100,
          }}
        >
          <div style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--bd2)',
            display: 'flex', alignItems: 'center', gap: 8,
            position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 2,
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)' }}>
              📬 Berichteninbox
            </span>
            <span style={{ fontSize: 10, color: 'var(--t3)' }}>
              {visible.length} totaal · {unread.length} ongelezen
            </span>
            {unread.length > 0 && (
              <button
                onClick={handleMarkAll}
                className="btn sm ghost"
                style={{ marginLeft: 'auto', fontSize: 10 }}
              >
                ✓ Alles gelezen
              </button>
            )}
          </div>

          {visible.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--t3)', fontSize: 11 }}>
              Geen meldingen op dit moment.
            </div>
          ) : (
            <div>
              {visible.map(n => {
                const isUnread = !n.readBy.includes((userEmail ?? '').toLowerCase())
                return (
                  <div
                    key={n.id}
                    onClick={() => handleClick(n)}
                    style={{
                      padding: '10px 14px',
                      borderBottom: '1px solid var(--bd2)',
                      cursor: 'pointer',
                      background: isUnread ? 'rgba(0,169,224,.06)' : 'transparent',
                      display: 'flex', flexDirection: 'column', gap: 3,
                      position: 'relative',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = isUnread ? 'rgba(0,169,224,.10)' : 'var(--bg3)')}
                    onMouseLeave={e => (e.currentTarget.style.background = isUnread ? 'rgba(0,169,224,.06)' : 'transparent')}
                  >
                    {isUnread && (
                      <span style={{
                        position: 'absolute', top: 14, right: 14,
                        width: 7, height: 7, borderRadius: '50%',
                        background: 'var(--blue)',
                      }} />
                    )}
                    <div style={{ fontSize: 9, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>
                      {CAT_LABEL[n.category]} · {fmtTime(n.createdAt)}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--t1)', fontWeight: isUnread ? 700 : 500, lineHeight: 1.4 }}>
                      {n.title}
                    </div>
                    {n.body && (
                      <div style={{ fontSize: 10.5, color: 'var(--t2)', lineHeight: 1.45, marginTop: 2 }}>
                        {n.body}
                      </div>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); remove(n.id) }}
                      title="Verwijderen"
                      style={{
                        position: 'absolute', top: 6, right: 6,
                        width: 18, height: 18, padding: 0,
                        background: 'transparent', border: 'none',
                        color: 'var(--t3)', cursor: 'pointer',
                        fontSize: 12, lineHeight: 1,
                        opacity: 0,
                        transition: 'opacity .12s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
