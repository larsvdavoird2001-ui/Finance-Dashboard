import { useState } from 'react'
import type { UserProfile } from '../../lib/db'
import type { ClosingBv } from '../../data/types'
import { ADMIN_EMAIL } from '../../lib/auth'

const BV_OPTIONS: ClosingBv[] = ['Consultancy', 'Projects', 'Software', 'Holdings']
const BV_COLORS: Record<ClosingBv, string> = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
  Holdings:    '#8fa3c0',
}

interface Props {
  currentEmail: string | null
  profiles: UserProfile[]
  isAdmin: boolean
  inviteUser: (email: string, role: 'admin' | 'user', bv?: ClosingBv | null) => Promise<{ error: string | null }>
  setUserActive: (email: string, active: boolean) => Promise<{ error: string | null }>
  setUserRole: (email: string, role: 'admin' | 'user') => Promise<{ error: string | null }>
  setUserBv: (email: string, bv: ClosingBv | null) => Promise<{ error: string | null }>
  removeUser: (email: string) => Promise<{ error: string | null }>
  refreshProfiles: () => Promise<void>
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('nl-NL', { year: 'numeric', month: '2-digit', day: '2-digit' }) +
      ' ' + d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

export function UsersTab({
  currentEmail,
  profiles,
  isAdmin,
  inviteUser,
  setUserActive,
  setUserRole,
  setUserBv,
  removeUser,
  refreshProfiles,
}: Props) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'user'>('user')
  const [bv, setBv] = useState<ClosingBv | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!isAdmin) {
    return (
      <div className="page">
        <div className="card" style={{ padding: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--amber)', marginBottom: 8 }}>
            ⚠ Geen toegang
          </div>
          <div style={{ fontSize: 12, color: 'var(--t2)' }}>
            Alleen admins kunnen gebruikersbeheer openen.
          </div>
        </div>
      </div>
    )
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setInfo(null)
    if (!email.trim()) { setError('Vul een e-mailadres in'); return }
    setSubmitting(true)
    try {
      const bvArg: ClosingBv | null = role === 'admin' ? null : (bv === '' ? null : bv)
      const { error } = await inviteUser(email, role, bvArg)
      if (error) setError(error)
      else {
        const bvLabel = bvArg ? ` (alleen ${bvArg})` : ''
        setInfo(`✉ Uitnodiging verzonden naar ${email}${bvLabel}. De gebruiker ontvangt een magic-link en kan daarna een wachtwoord instellen.`)
        setEmail('')
        setRole('user')
        setBv('')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const onToggleActive = async (p: UserProfile) => {
    setError(null); setInfo(null)
    const { error } = await setUserActive(p.email, !p.active)
    if (error) setError(error)
  }

  const onChangeRole = async (p: UserProfile, newRole: 'admin' | 'user') => {
    setError(null); setInfo(null)
    const { error } = await setUserRole(p.email, newRole)
    if (error) setError(error)
  }

  const onChangeBv = async (p: UserProfile, newBv: ClosingBv | '') => {
    setError(null); setInfo(null)
    const { error } = await setUserBv(p.email, newBv === '' ? null : newBv)
    if (error) setError(error)
  }

  const onRemove = async (p: UserProfile) => {
    setError(null); setInfo(null)
    if (!confirm(
      `Definitief verwijderen: ${p.email}\n\n` +
      `• Profiel uit user_profiles wordt verwijderd\n` +
      `• Auth-account uit Supabase wordt opgeruimd (via DB-trigger)\n` +
      `• Eventuele actieve sessie wordt direct uitgelogd\n\n` +
      `Doorgaan?`
    )) return
    const { error } = await removeUser(p.email)
    if (error) setError(error)
    else setInfo(`Gebruiker ${p.email} is volledig verwijderd (profiel + auth-account).`)
  }

  const onResend = async (p: UserProfile) => {
    setError(null); setInfo(null)
    setSubmitting(true)
    try {
      const { error } = await inviteUser(p.email, p.role)
      if (error) setError(error)
      else setInfo(`✉ Nieuwe magic-link verzonden naar ${p.email}.`)
    } finally {
      setSubmitting(false)
    }
  }

  const sortedProfiles = [...profiles].sort((a, b) => {
    // Hoofd-admin altijd bovenaan, daarna alfabetisch
    if (a.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return -1
    if (b.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return 1
    return a.email.localeCompare(b.email)
  })

  return (
    <div className="page">
      <div className="card">
        <div className="card-hdr">
          <span className="card-title">👥 Gebruikersbeheer</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)' }}>
            {profiles.filter(p => p.active).length} actief · {profiles.length} totaal
          </span>
        </div>
        <div style={{ padding: 16 }}>
          <form onSubmit={handleInvite} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                E-mailadres nieuwe gebruiker
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="naam@thepeoplegroup.nl"
                style={{
                  width: '100%', background: 'var(--bg3)',
                  border: '1px solid var(--bd2)', borderRadius: 7,
                  color: 'var(--t1)', fontSize: 13, padding: '9px 12px',
                  fontFamily: 'var(--font)', outline: 'none', marginTop: 6,
                }}
                disabled={submitting}
              />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                Rol
              </label>
              <select
                value={role}
                onChange={e => {
                  const r = e.target.value as 'admin' | 'user'
                  setRole(r)
                  if (r === 'admin') setBv('')  // admins zien altijd alles
                }}
                style={{
                  background: 'var(--bg3)', border: '1px solid var(--bd2)',
                  borderRadius: 7, color: 'var(--t1)', fontSize: 13,
                  padding: '9px 12px', fontFamily: 'var(--font)', outline: 'none',
                  marginTop: 6, height: 36,
                }}
              >
                <option value="user">Gebruiker</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                BV-toegang
              </label>
              <select
                value={bv}
                onChange={e => setBv(e.target.value as ClosingBv | '')}
                disabled={role === 'admin'}
                title={role === 'admin' ? 'Admins zien alle BVs' : 'Beperk deze gebruiker tot één BV (laat leeg voor alle BVs)'}
                style={{
                  background: 'var(--bg3)', border: '1px solid var(--bd2)',
                  borderRadius: 7, color: role === 'admin' ? 'var(--t3)' : 'var(--t1)', fontSize: 13,
                  padding: '9px 12px', fontFamily: 'var(--font)', outline: 'none',
                  marginTop: 6, height: 36,
                  opacity: role === 'admin' ? 0.5 : 1,
                }}
              >
                <option value="">Alle BVs</option>
                {BV_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <button type="submit" className="btn primary" disabled={submitting} style={{ height: 36 }}>
              {submitting ? '⏳ Bezig...' : '✉ Uitnodigen'}
            </button>
          </form>

          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 10, lineHeight: 1.55 }}>
            De ontvanger krijgt een e-mail met een eenmalige login-link. Bij eerste login kan de gebruiker zelf een wachtwoord kiezen.
            Selecteer een BV om deze gebruiker te beperken tot data van die business unit.
          </div>

          {error && (
            <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, background: 'var(--bd-red)', border: '1px solid var(--red)', color: 'var(--red)', fontSize: 11 }}>
              ⚠ {error}
            </div>
          )}
          {info && (
            <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 6, background: 'var(--bd-green)', border: '1px solid var(--green)', color: 'var(--green)', fontSize: 11 }}>
              {info}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-hdr">
          <span className="card-title">Toegelaten gebruikers</span>
          <button className="btn sm ghost" onClick={() => refreshProfiles()} style={{ marginLeft: 'auto' }}>
            ↻ Vernieuwen
          </button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ minWidth: 220 }}>E-mail</th>
                <th>Rol</th>
                <th>BV-toegang</th>
                <th>Status</th>
                <th>Uitgenodigd door</th>
                <th>Uitgenodigd op</th>
                <th>Laatste login</th>
                <th className="r">Acties</th>
              </tr>
            </thead>
            <tbody>
              {sortedProfiles.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--t3)', padding: 18 }}>
                    Geen gebruikers gevonden. Nodig je eerste teamlid uit hierboven.
                  </td>
                </tr>
              )}
              {sortedProfiles.map(p => {
                const isMain = p.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()
                const isMe   = currentEmail && p.email.toLowerCase() === currentEmail.toLowerCase()
                return (
                  <tr key={p.email}>
                    <td>
                      <strong style={{ color: 'var(--t1)' }}>{p.email}</strong>
                      {isMain && <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--blue)', background: 'var(--bd-blue)', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>HOOFD-ADMIN</span>}
                      {isMe && !isMain && <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--green)', background: 'var(--bd-green)', padding: '1px 6px', borderRadius: 3, fontWeight: 700 }}>JIJ</span>}
                    </td>
                    <td>
                      {isMain ? (
                        <span style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 600 }}>Admin</span>
                      ) : (
                        <select
                          value={p.role}
                          onChange={e => onChangeRole(p, e.target.value as 'admin' | 'user')}
                          style={{ background: 'var(--bg3)', border: '1px solid var(--bd2)', borderRadius: 5, color: 'var(--t1)', fontSize: 11, padding: '3px 6px', fontFamily: 'var(--font)' }}
                        >
                          <option value="user">Gebruiker</option>
                          <option value="admin">Admin</option>
                        </select>
                      )}
                    </td>
                    <td>
                      {isMain || p.role === 'admin' ? (
                        <span style={{ fontSize: 11, color: 'var(--t3)' }} title="Admins zien altijd alle BVs">Alle BVs</span>
                      ) : (
                        <select
                          value={p.bv ?? ''}
                          onChange={e => onChangeBv(p, e.target.value as ClosingBv | '')}
                          style={{
                            background: 'var(--bg3)', border: '1px solid var(--bd2)', borderRadius: 5,
                            color: p.bv ? BV_COLORS[p.bv] : 'var(--t1)',
                            fontSize: 11, padding: '3px 6px', fontFamily: 'var(--font)',
                            fontWeight: p.bv ? 600 : 400,
                          }}
                        >
                          <option value="">Alle BVs</option>
                          {BV_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      )}
                    </td>
                    <td>
                      {p.active ? (
                        <span style={{ fontSize: 11, color: 'var(--green)' }}>● Actief</span>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--t3)' }}>○ Inactief</span>
                      )}
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--t2)' }}>{p.invitedBy || '—'}</td>
                    <td style={{ fontSize: 11, color: 'var(--t2)' }}>{fmtDate(p.invitedAt)}</td>
                    <td style={{ fontSize: 11, color: 'var(--t2)' }}>{fmtDate(p.lastSignIn)}</td>
                    <td className="r" style={{ whiteSpace: 'nowrap' }}>
                      {!isMain && (
                        <>
                          <button
                            className="btn sm ghost"
                            style={{ fontSize: 10, marginRight: 4 }}
                            onClick={() => onResend(p)}
                            title="Nieuwe magic-link sturen"
                          >
                            ✉ Hersturen
                          </button>
                          <button
                            className="btn sm ghost"
                            style={{ fontSize: 10, marginRight: 4 }}
                            onClick={() => onToggleActive(p)}
                          >
                            {p.active ? '⛔ Pauze' : '✓ Activeer'}
                          </button>
                          <button
                            className="btn sm ghost"
                            style={{ fontSize: 10, color: 'var(--red)' }}
                            onClick={() => onRemove(p)}
                          >
                            ✕ Verwijder
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
