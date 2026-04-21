import { useState } from 'react'
import { ADMIN_EMAIL } from '../../lib/auth'

interface Props {
  onSignIn: (email: string, password: string) => Promise<{ error: string | null }>
  onSignUp: (email: string, password: string) => Promise<{ error: string | null }>
  loading: boolean
  disabled: boolean
  logoUrl?: string
}

export function LoginPage({ onSignIn, onSignUp, loading, disabled, logoUrl = '/tpg-logo.png' }: Props) {
  const [email, setEmail] = useState(ADMIN_EMAIL)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setInfo(null)
    if (!email.trim() || !password) {
      setError('Vul e-mail en wachtwoord in')
      return
    }
    setSubmitting(true)
    try {
      const fn = mode === 'signin' ? onSignIn : onSignUp
      const { error } = await fn(email, password)
      if (error) setError(error)
      else if (mode === 'signup') {
        setInfo('Account aangemaakt! Check je mailbox voor een bevestigingslink; log daarna in.')
        setMode('signin')
      }
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
        width: '100%', maxWidth: 420,
        background: 'var(--bg1)',
        border: '1px solid var(--bd2)',
        borderRadius: 14,
        boxShadow: '0 20px 60px rgba(0,0,0,.5)',
        padding: '36px 32px',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img
            src={logoUrl}
            alt="The People Group"
            style={{ maxWidth: 220, height: 'auto', maxHeight: 56, objectFit: 'contain' }}
          />
          <div style={{
            marginTop: 14, fontSize: 13, color: 'var(--t3)',
            fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase',
          }}>
            Finance · CFO Dashboard
          </div>
        </div>

        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--t1)', marginBottom: 4 }}>
          {mode === 'signin' ? 'Welkom terug' : 'Account aanmaken'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 22 }}>
          {mode === 'signin'
            ? 'Log in met het admin-account om toegang te krijgen.'
            : 'Eerste keer gebruik: maak het admin-account aan.'}
        </div>

        {disabled && (
          <div style={{
            padding: '10px 12px', marginBottom: 14, borderRadius: 7,
            background: 'var(--bd-amber)', border: '1px solid var(--amber)',
            color: 'var(--amber)', fontSize: 11, lineHeight: 1.5,
          }}>
            ⚠ Supabase is niet geconfigureerd. Login werkt niet — gebruik de app lokaal zonder auth.
            Zet de <code>VITE_SUPABASE_URL</code> en <code>VITE_SUPABASE_ANON_KEY</code> variabelen in <code>.env</code> om auth te activeren.
          </div>
        )}

        <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
              E-mail
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              readOnly
              style={{
                width: '100%', background: 'var(--bg3)',
                border: '1px solid var(--bd2)', borderRadius: 7,
                color: 'var(--t2)', fontSize: 13, padding: '9px 12px',
                fontFamily: 'var(--font)', outline: 'none', marginTop: 6,
                cursor: 'not-allowed',
              }}
            />
            <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 4 }}>
              Alleen dit admin-account heeft toegang.
            </div>
          </div>

          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
              Wachtwoord
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              style={{
                width: '100%', background: 'var(--bg3)',
                border: `1px solid ${error ? 'var(--red)' : 'var(--bd3)'}`, borderRadius: 7,
                color: 'var(--t1)', fontSize: 13, padding: '9px 12px',
                fontFamily: 'var(--font)', outline: 'none', marginTop: 6,
              }}
              disabled={disabled || submitting}
            />
            {mode === 'signup' && (
              <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 4 }}>
                Minimaal 6 tekens.
              </div>
            )}
          </div>

          {error && (
            <div style={{
              padding: '8px 12px', borderRadius: 6,
              background: 'var(--bd-red)', border: '1px solid var(--red)',
              color: 'var(--red)', fontSize: 11,
            }}>
              ⚠ {error}
            </div>
          )}
          {info && (
            <div style={{
              padding: '8px 12px', borderRadius: 6,
              background: 'var(--bd-green)', border: '1px solid var(--green)',
              color: 'var(--green)', fontSize: 11,
            }}>
              ✓ {info}
            </div>
          )}

          <button
            type="submit"
            disabled={disabled || submitting || loading}
            className="btn primary"
            style={{
              padding: '11px 14px', fontSize: 13, fontWeight: 600,
              justifyContent: 'center', marginTop: 4,
              opacity: (disabled || submitting || loading) ? 0.6 : 1,
            }}
          >
            {submitting
              ? '⏳ Bezig...'
              : mode === 'signin' ? '→ Inloggen' : '+ Account aanmaken'}
          </button>

          <button
            type="button"
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setInfo(null) }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--blue)', fontSize: 11, marginTop: 2,
              fontFamily: 'var(--font)', textAlign: 'center',
            }}
          >
            {mode === 'signin'
              ? 'Admin account nog niet aangemaakt? Klik hier'
              : '← Terug naar inloggen'}
          </button>
        </form>

        <div style={{
          marginTop: 28, paddingTop: 18,
          borderTop: '1px solid var(--bd)',
          fontSize: 10, color: 'var(--t3)', textAlign: 'center',
        }}>
          TPG Finance Dashboard · {new Date().getFullYear()} The People Group
        </div>
      </div>
    </div>
  )
}
