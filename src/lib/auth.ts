import { useEffect, useState } from 'react'
import { supabase, supabaseEnabled } from './supabase'
import {
  fetchUserProfiles,
  upsertUserProfile,
  deleteUserProfile,
  touchUserSignIn,
  type UserProfile,
} from './db'
import type { ClosingBv } from '../data/types'
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

/** True als de user nog een wachtwoord moet instellen.
 *  Wordt aangestuurd via user_profiles.needs_password (server-side flag).
 *  Default false → bestaande users en hoofd-admin krijgen NOOIT de
 *  set-password prompt. Alleen via inviteUser() wordt deze flag op true
 *  gezet, en bij setPassword() weer op false. */
export function profileNeedsPassword(
  email: string | null | undefined,
  profiles: { email: string; needsPassword: boolean }[],
): boolean {
  if (!email) return false
  const norm = email.trim().toLowerCase()
  const p = profiles.find(p => p.email.toLowerCase() === norm)
  return !!p && p.needsPassword
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
  /** Admin: gebruiker uitnodigen via magic-link + record in user_profiles.
   *  bv: optioneel, beperkt deze user tot data van die BV. null/undefined =
   *  geen restrictie (alle BVs). */
  inviteUser: (email: string, role: 'admin' | 'user', bv?: ClosingBv | null) => Promise<{ error: string | null }>
  /** Admin: deactiveer/reactiveer een user_profiles entry. */
  setUserActive: (email: string, active: boolean) => Promise<{ error: string | null }>
  /** Admin: verander rol. */
  setUserRole: (email: string, role: 'admin' | 'user') => Promise<{ error: string | null }>
  /** Admin: verander/verwijder de BV-toewijzing van een gebruiker. null = wist
   *  de restrictie zodat de user alle BVs kan zien. */
  setUserBv: (email: string, bv: ClosingBv | null) => Promise<{ error: string | null }>
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

    // Stap 1: snel de session ophalen → loading=false zo snel mogelijk
    supabase.auth.getSession().then(({ data: { session } }) => {
      setState(s => ({
        ...s,
        session,
        user: session?.user ?? null,
        loading: false,
      }))
      // Stap 2 (background): profielen laden + last-sign-in touchen.
      // Dit blokkeert NOOIT de UI — bij fouten loggen we en gaan verder.
      if (session?.user?.email) {
        touchUserSignIn(session.user.email).catch(e => console.warn('[auth] touchUserSignIn:', e))
      }
      fetchUserProfiles()
        .then(profiles => setState(s => ({ ...s, profiles })))
        .catch(e => console.warn('[auth] fetchUserProfiles:', e))
    }).catch(err => {
      console.warn('[auth] getSession failed:', err)
      setState(s => ({ ...s, loading: false, error: String(err) }))
    })

    // Subscribe to auth changes
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setState(s => ({
        ...s,
        session,
        user: session?.user ?? null,
        loading: false,
      }))
      if (event === 'SIGNED_IN' && session?.user?.email) {
        // Background: hoofd-admin profile bootstrap + sign-in touch + refresh.
        // We awaiten niets om de UI niet te blokkeren.
        const email = session.user.email
        ;(async () => {
          try {
            if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
              await upsertUserProfile({
                email: ADMIN_EMAIL,
                role: 'admin',
                active: true,
                needsPassword: false,
                invitedBy: 'system',
              })
            }
            await touchUserSignIn(email)
            const profiles = await fetchUserProfiles()
            setState(s => ({ ...s, profiles }))
          } catch (e) {
            console.warn('[auth] background sign-in tasks failed:', e)
          }
        })()
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
    })
    if (error) {
      console.error('[auth] setPassword failed:', error)
      return { error: error.message }
    }
    // Markeer in user_profiles dat deze user géén set-password meer hoeft.
    const email = data?.user?.email ?? state.user?.email
    if (email) {
      const { error: dbErr } = await upsertUserProfile({
        email,
        needsPassword: false,
      })
      if (dbErr) {
        // Dit is een soft-error: het wachtwoord is gezet, alleen de flag
        // niet bijgewerkt. We retourneren wel een waarschuwing zodat de UI
        // niet kan re-rerenderen op de set-password flow blijft hangen.
        console.warn('[auth] needs_password flag bijwerken faalde:', dbErr)
      }
      // Refresh profielen-cache zodat de UI de nieuwe waarde gebruikt.
      const profiles = await fetchUserProfiles()
      setState(s => ({ ...s, profiles, user: data?.user ?? s.user }))
    } else if (data?.user) {
      setState(s => ({ ...s, user: data.user }))
    }
    return { error: null }
  }

  const inviteUser = async (email: string, role: 'admin' | 'user', bv?: ClosingBv | null) => {
    if (!supabaseEnabled) return { error: 'Supabase niet geconfigureerd' }
    const norm = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(norm)) {
      return { error: 'Ongeldig e-mailadres' }
    }
    const inviter = state.user?.email ?? 'admin'
    // 1. Profiel aanmaken / activeren — met needs_password flag zodat de user
    //    bij eerste login een wachtwoord moet kiezen.
    const up = await upsertUserProfile({
      email: norm,
      role,
      active: true,
      needsPassword: true,
      invitedBy: inviter,
      // Admins hebben nooit een BV-restrictie. Voor 'user' alleen zetten als
      // expliciet meegegeven; undefined laat de bestaande waarde staan
      // (bij hersturen van de uitnodiging).
      bv: role === 'admin' ? null : bv,
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
    // Promotie naar admin → BV-restrictie wegzetten (admins zien alles).
    const patch = role === 'admin' ? { email, role, bv: null as ClosingBv | null } : { email, role }
    const r = await upsertUserProfile(patch)
    if (r.error) return { error: r.error }
    await refreshProfiles()
    return { error: null }
  }

  const setUserBv = async (email: string, bv: ClosingBv | null) => {
    if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
      return { error: 'De hoofd-admin kan geen BV-restrictie hebben' }
    }
    const r = await upsertUserProfile({ email, bv })
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
    setUserBv,
    removeUser,
    refreshProfiles,
    isAdmin,
  }
}
