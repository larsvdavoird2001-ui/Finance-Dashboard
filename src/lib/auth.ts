import { useEffect, useState } from 'react'
import { supabase, supabaseEnabled } from './supabase'
import {
  fetchUserProfiles,
  upsertUserProfile,
  deleteUserProfile,
  touchUserSignIn,
  type UserProfile,
} from './db'
import type { Session, User } from '@supabase/supabase-js'

/** Hard-coded hoofd-admin: dit account heeft altijd admin-rechten en wordt
 *  bij eerste inlog automatisch aangemaakt in user_profiles. Andere admins
 *  kunnen toegevoegd worden via de Gebruikers-tab (rol = 'admin'). */
export const ADMIN_EMAIL = 'lvanderavoird@thepeoplegroup.nl'

/** True als deze gebruiker hoofd-admin is óf via user_profiles als admin
 *  is gemarkeerd. */
export function isAdminUser(
  email: string | undefined | null,
  profiles: UserProfile[],
): boolean {
  if (!email) return false
  const norm = email.trim().toLowerCase()
  if (norm === ADMIN_EMAIL.toLowerCase()) return true
  const p = profiles.find(p => p.email.toLowerCase() === norm)
  return !!p && p.active && p.role === 'admin'
}

/** True als deze user al een wachtwoord heeft ingesteld (via updateUser).
 *  We zetten user_metadata.password_set = true zodra de gebruiker
 *  succesvol een wachtwoord heeft ingesteld na een magic-link login. */
export function userHasPassword(user: User | null): boolean {
  if (!user) return false
  const md = (user.user_metadata ?? {}) as Record<string, unknown>
  return md.password_set === true
}

export interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  /** Supabase niet geconfigureerd → auth overgeslagen (dev/demo mode) */
  disabled: boolean
  error: string | null
  profiles: UserProfile[]
}

/** Hook die de huidige auth-status van Supabase volgt + user_profiles cached. */
export function useAuth(): AuthState & {
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  /** Magic-link login (geen wachtwoord nodig). Werkt voor bestaande +
   *  uitgenodigde users. */
  sendMagicLink: (email: string) => Promise<{ error: string | null }>
  /** Wachtwoord-reset link sturen naar bestaand account. */
  sendPasswordReset: (email: string) => Promise<{ error: string | null }>
  /** Wachtwoord instellen voor de huidige (al ingelogde) gebruiker. */
  setPassword: (newPassword: string) => Promise<{ error: string | null }>
  /** Admin: gebruiker uitnodigen via magic-link + record in user_profiles. */
  inviteUser: (email: string, role: 'admin' | 'user') => Promise<{ error: string | null }>
  /** Admin: deactiveer/reactiveer een user_profiles entry. */
  setUserActive: (email: string, active: boolean) => Promise<{ error: string | null }>
  /** Admin: verander rol. */
  setUserRole: (email: string, role: 'admin' | 'user') => Promise<{ error: string | null }>
  /** Admin: verwijder user_profiles entry (de auth.users row blijft staan). */
  removeUser: (email: string) => Promise<{ error: string | null }>
  /** Refresh user_profiles uit DB. */
  refreshProfiles: () => Promise<void>
  /** Computed: huidige user is admin? */
  isAdmin: boolean
} {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
    disabled: !supabaseEnabled,
    error: null,
    profiles: [],
  })

  const refreshProfiles = async () => {
    if (!supabaseEnabled) return
    const profiles = await fetchUserProfiles()
    setState(s => ({ ...s, profiles }))
  }

  useEffect(() => {
    if (!supabaseEnabled) {
      setState(s => ({ ...s, loading: false }))
      return
    }

    // Initial session check + profiles fetch
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const profiles = await fetchUserProfiles()
      setState(s => ({
        ...s,
        session,
        user: session?.user ?? null,
        profiles,
        loading: false,
      }))
      // Touch last-sign-in op startup
      if (session?.user?.email) {
        touchUserSignIn(session.user.email)
      }
    }).catch(err => {
      console.warn('[auth] getSession failed:', err)
      setState(s => ({ ...s, loading: false, error: String(err) }))
    })

    // Subscribe to auth changes
    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      setState(s => ({
        ...s,
        session,
        user: session?.user ?? null,
        loading: false,
      }))
      if (event === 'SIGNED_IN' && session?.user?.email) {
        // Hoofd-admin: zorg dat de profiles-rij altijd bestaat.
        if (session.user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
          await upsertUserProfile({
            email: ADMIN_EMAIL,
            role: 'admin',
            active: true,
            invitedBy: 'system',
          })
        }
        await touchUserSignIn(session.user.email)
        const profiles = await fetchUserProfiles()
        setState(s => ({ ...s, profiles }))
      }
    })

    return () => { listener.subscription.unsubscribe() }
  }, [])

  const signIn = async (email: string, password: string) => {
    if (!supabaseEnabled) return { error: 'Supabase niet geconfigureerd' }
    const norm = email.trim().toLowerCase()
    setState(s => ({ ...s, loading: true, error: null }))
    const { error } = await supabase.auth.signInWithPassword({
      email: norm,
      password,
    })
    if (error) {
      setState(s => ({ ...s, loading: false, error: error.message }))
      return { error: error.message }
    }
    return { error: null }
  }

  const sendMagicLink = async (email: string) => {
    if (!supabaseEnabled) return { error: 'Supabase niet geconfigureerd' }
    const norm = email.trim().toLowerCase()
    const { error } = await supabase.auth.signInWithOtp({
      email: norm,
      options: {
        // Sta toe dat een nieuwe Supabase auth-user wordt aangemaakt op het
        // moment dat de uitnodiging-link aangeklikt wordt.
        shouldCreateUser: true,
        emailRedirectTo: window.location.origin,
      },
    })
    if (error) return { error: error.message }
    return { error: null }
  }

  const sendPasswordReset = async (email: string) => {
    if (!supabaseEnabled) return { error: 'Supabase niet geconfigureerd' }
    const norm = email.trim().toLowerCase()
    const { error } = await supabase.auth.resetPasswordForEmail(norm, {
      redirectTo: window.location.origin,
    })
    if (error) return { error: error.message }
    return { error: null }
  }

  const setPassword = async (newPassword: string) => {
    if (!supabaseEnabled) return { error: 'Supabase niet geconfigureerd' }
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
      data: { password_set: true },
    })
    if (error) return { error: error.message }
    if (data?.user) setState(s => ({ ...s, user: data.user }))
    return { error: null }
  }

  const inviteUser = async (email: string, role: 'admin' | 'user') => {
    if (!supabaseEnabled) return { error: 'Supabase niet geconfigureerd' }
    const norm = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(norm)) {
      return { error: 'Ongeldig e-mailadres' }
    }
    const inviter = state.user?.email ?? 'admin'
    // 1. Profiel aanmaken / activeren
    const up = await upsertUserProfile({
      email: norm,
      role,
      active: true,
      invitedBy: inviter,
    })
    if (up.error) return { error: up.error }
    // 2. Magic-link verzenden zodat de user zichzelf kan inloggen +
    //    daarna een wachtwoord kan instellen.
    const { error } = await supabase.auth.signInWithOtp({
      email: norm,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: window.location.origin,
      },
    })
    if (error) return { error: error.message }
    // Refresh profielenlijst
    const profiles = await fetchUserProfiles()
    setState(s => ({ ...s, profiles }))
    return { error: null }
  }

  const setUserActive = async (email: string, active: boolean) => {
    const r = await upsertUserProfile({ email, active })
    if (r.error) return { error: r.error }
    await refreshProfiles()
    return { error: null }
  }

  const setUserRole = async (email: string, role: 'admin' | 'user') => {
    const r = await upsertUserProfile({ email, role })
    if (r.error) return { error: r.error }
    await refreshProfiles()
    return { error: null }
  }

  const removeUser = async (email: string) => {
    if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      return { error: 'De hoofd-admin kan niet verwijderd worden' }
    }
    const r = await deleteUserProfile(email)
    if (r.error) return { error: r.error }
    await refreshProfiles()
    return { error: null }
  }

  const signOut = async () => {
    if (!supabaseEnabled) return
    await supabase.auth.signOut()
  }

  const isAdmin = isAdminUser(state.user?.email, state.profiles)

  return {
    ...state,
    signIn,
    signOut,
    sendMagicLink,
    sendPasswordReset,
    setPassword,
    inviteUser,
    setUserActive,
    setUserRole,
    removeUser,
    refreshProfiles,
    isAdmin,
  }
}
