import { useState } from 'react'

interface Props {
  email: string
  onSetPassword: (newPassword: string) => Promise<{ error: string | null }>
  onSkip: () => void
  logoUrl?: string
}

/** Toont na een magic-link login een prompt om een wachtwoord in te stellen.
 *  Hierna kan de user voortaan met email+password inloggen. */
export function SetPasswordPage({ email, onSetPassword, onSkip, logoUrl = '/tpg-logo.png' }: Props) {
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setInfo(null)
    if (pw1.length < 8) { setError('Wachtwoord moet minimaal 8 tekens zijn'); return }
    if (pw1 !== pw2)    { setError('Wachtwoorden komen niet overeen'); return }
    setSubmitting(true)
    try {
      const { error } = await onSetPassword(pw1)
      if (error) setError(error)
      else setInfo('Wachtwoord ingesteld! Je gaat naar het dashboard...')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      height: '100vh', width: '100vw',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, var(--bg0) 0%, #0a1530 50%, var(--bg0) 100%)',
      padding: 20,
    }}>
      <div style={{
        width: '100%', maxWidth: 460,
        background: 'var(--bg1)',
        border: '1px solid var(--bd2)',
        borderRadius: 14,
        boxShadow: '0 20px 60px rgba(0,0,0,.5)',
        padding: '36px 32px',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <img src={logoUrl} alt="TPG" style={{ maxWidth: 200, maxHeight: 56, objectFit: 'contain' }} />
          <div style={{ marginTop: 14, fontSize: 13, color: 'var(--t3)', fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase' }}>
            Finance · CFO Dashboard
          </div>
        </div>

        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--t1)', marginBottom: 4 }}>
          Welkom! Stel je wachtwoord in
        </div>
        <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 18 }}>
          Je bent ingelogd als <strong style={{ color: 'var(--blue)' }}>{email}</strong>.
          Kies een wachtwoord zodat je voortaan direct kunt inloggen zonder magic-link.
        </div>

        <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
              Nieuw wachtwoord
            </label>
            <input
              type="password"
              value={pw1}
              onChange={e => setPw1(e.target.value)}
              autoFocus
              autoComplete="new-password"
              minLength={8}
              style={{
                width: '100%', background: 'var(--bg3)',
                border: '1px solid var(--bd3)', borderRadius: 7,
                color: 'var(--t1)', fontSize: 13, padding: '9px 12px',
                fontFamily: 'var(--font)', outline: 'none', marginTop: 6,
              }}
              disabled={submitting}
            />
            <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 4 }}>
              Minimaal 8 tekens.
            </div>
          </div>

          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
              Bevestig wachtwoord
            </label>
            <input
              type="password"
              value={pw2}
              onChange={e => setPw2(e.target.value)}
              autoComplete="new-password"
              style={{
                width: '100%', background: 'var(--bg3)',
                border: '1px solid var(--bd3)', borderRadius: 7,
                color: 'var(--t1)', fontSize: 13, padding: '9px 12px',
                fontFamily: 'var(--font)', outline: 'none', marginTop: 6,
              }}
              disabled={submitting}
            />
          </div>

          {error && (
            <div style={{ padding: '8px 12px', borderRadius: 6, background: 'var(--bd-red)', border: '1px solid var(--red)', color: 'var(--red)', fontSize: 11 }}>
              ⚠ {error}
            </div>
          )}
          {info && (
            <div style={{ padding: '8px 12px', borderRadius: 6, background: 'var(--bd-green)', border: '1px solid var(--green)', color: 'var(--green)', fontSize: 11 }}>
              ✓ {info}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="btn primary"
            style={{ padding: '11px 14px', fontSize: 13, fontWeight: 600, justifyContent: 'center', marginTop: 4 }}
          >
            {submitting ? '⏳ Bezig...' : '🔐 Wachtwoord opslaan'}
          </button>

          <button
            type="button"
            onClick={onSkip}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--t3)', fontSize: 11, marginTop: 2,
              fontFamily: 'var(--font)', textAlign: 'center',
            }}
          >
            Sla over (later instellen)
          </button>
        </form>
      </div>
    </div>
  )
}
