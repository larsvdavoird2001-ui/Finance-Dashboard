import { useEffect } from 'react'
import { supabase, supabaseEnabled } from '../lib/supabase'
import { ADMIN_EMAIL } from '../lib/auth'
import { fetchUserProfiles } from '../lib/db'

/** Bewaak of de huidige gebruiker nog mag inloggen. Twee mechanismen:
 *  1. Realtime: bij wijziging in user_profiles checken of mijn rij nog
 *     active is en niet verwijderd. Zo niet → signOut.
 *  2. Polling-fallback: elke 30s opnieuw checken (voor het geval realtime
 *     niet geactiveerd is op de tabel). */
export function useUserProfileGuard(opts: {
  email: string | null
  enabled: boolean
  onRevoked: (reason: string) => void
}) {
  const { email, enabled, onRevoked } = opts

  useEffect(() => {
    if (!supabaseEnabled || !enabled || !email) return
    const norm = email.trim().toLowerCase()
    // Hoofd-admin wordt nooit geblokkeerd
    if (norm === ADMIN_EMAIL.toLowerCase()) return

    let cancelled = false

    const verify = async () => {
      try {
        const profiles = await fetchUserProfiles()
        if (cancelled) return
        const me = profiles.find(p => p.email.toLowerCase() === norm)
        if (!me) {
          onRevoked('Je account is verwijderd door de admin.')
        } else if (!me.active) {
          onRevoked('Je account is gedeactiveerd door de admin.')
        }
      } catch (e) {
        console.warn('[guard] verify failed:', e)
      }
    }

    // Eerste check direct
    verify()

    // Polling-fallback elke 30s
    const interval = setInterval(verify, 30_000)

    // Realtime channel op user_profiles voor ZIJN eigen email
    const ch = supabase
      .channel(`user-profile-${norm}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_profiles', filter: `email=eq.${norm}` },
        verify,
      )
      .subscribe()

    return () => {
      cancelled = true
      clearInterval(interval)
      supabase.removeChannel(ch)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, enabled])
}
