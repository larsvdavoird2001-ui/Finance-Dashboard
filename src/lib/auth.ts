import { useEffect, useState } from 'react'
import { supabase, supabaseEnabled } from './supabase'
import type { Session, User } from '@supabase/supabase-js'

/** ALLEEN dit e-mailadres kan inloggen. Past bij de TPG Finance admin
 *  account. Pas aan als er meerdere admins toegevoegd worden. */
export const ADMIN_EMAIL = 'finance@thepeoplegroup.nl'

export interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  /** Supabase niet geconfigureerd → auth overgeslagen (dev/demo mode) */
  disabled: boolean
  error: string | null
}

/** Hook die de huidige auth-status van Supabase volgt. */
export function useAuth(): AuthState & {
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  signUp: (email: string, password: string) => Promise<{ error: string | null }>
} {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
    disabled: !supabaseEnabled,
    error: null,
  })

  useEffect(() => {
    if (!supabaseEnabled) {
      setState(s => ({ ...s, loading: false }))
      return
    }

    // Initial session check
    supabase.auth.getSession().then(({ data: { session } }) => {
      setState(s => ({
        ...s,
        session,
        user: session?.user ?? null,
        loading: false,
      }))
    }).catch(err => {
      console.warn('[auth] getSession failed:', err)
      setState(s => ({ ...s, loading: false, error: String(err) }))
    })

    // Subscribe to auth changes
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(s => ({
        ...s,
        session,
        user: session?.user ?? null,
        loading: false,
      }))
    })

    return () => { listener.subscription.unsubscribe() }
  }, [])

  const signIn = async (email: string, password: string) => {
    if (!supabaseEnabled) return { error: 'Supabase niet geconfigureerd' }
    if (email.trim().toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      return { error: `Alleen ${ADMIN_EMAIL} kan inloggen` }
    }
    setState(s => ({ ...s, loading: true, error: null }))
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) {
      setState(s => ({ ...s, loading: false, error: error.message }))
      return { error: error.message }
    }
    return { error: null }
  }

  const signUp = async (email: string, password: string) => {
    if (!supabaseEnabled) return { error: 'Supabase niet geconfigureerd' }
    if (email.trim().toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      return { error: `Alleen ${ADMIN_EMAIL} mag worden aangemaakt als admin` }
    }
    setState(s => ({ ...s, loading: true, error: null }))
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    })
    if (error) {
      setState(s => ({ ...s, loading: false, error: error.message }))
      return { error: error.message }
    }
    setState(s => ({ ...s, loading: false, error: null }))
    return { error: null }
  }

  const signOut = async () => {
    if (!supabaseEnabled) return
    await supabase.auth.signOut()
  }

  return { ...state, signIn, signOut, signUp }
}
