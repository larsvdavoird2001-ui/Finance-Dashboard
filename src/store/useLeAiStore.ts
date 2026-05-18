// Cache + state-management voor de AI-overlay van de LE-leerlus.
// Per (bv, maand) bewaren we het laatste AI-antwoord (suggesties + commentary)
// plus loading/error-state. Hierdoor verschijnt de AI-duiding direct uit de
// cache wanneer de gebruiker terugkeert naar dezelfde maand, en kostten we
// niet onnodig tokens.
//
// Een refresh-knop in de UI roept `fetchSuggestions(force=true)` aan om de
// cache te omzeilen en een nieuw antwoord op te halen.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ClosingBv } from '../data/types'
import type { LeAiResult } from '../lib/leAi'
import type { ReflectionContext, AiQuestion } from '../lib/leReflection'
import type { ReflectionAnswer } from './useReflectionStore'
import { requestLeAiSuggestions } from '../lib/leAi'

type Status = 'idle' | 'loading' | 'success' | 'error'

interface CacheEntry {
  status: Status
  result: LeAiResult | null
  error: string | null
}

interface LeAiStore {
  /** Map van `${month}::${bv}` → cache entry. */
  cache: Record<string, CacheEntry>
  /** Hint of de gebruiker de feature globaal heeft uitgeschakeld (bv. om
   *  tokens te besparen tijdens demo's). */
  disabled: boolean
  setDisabled: (v: boolean) => void
  /** Pak een entry (idle als nog niet opgehaald). */
  get: (month: string, bv: ClosingBv) => CacheEntry
  /** Trigger een AI-call. force=true negeert de cache. */
  fetchSuggestions: (
    month: string,
    bv: ClosingBv,
    ctx: ReflectionContext,
    questions: AiQuestion[],
    userReflections: ReflectionAnswer[],
    force?: boolean,
  ) => Promise<void>
  /** Reset entry naar idle (voor refresh-flows). */
  reset: (month: string, bv: ClosingBv) => void
}

const IDLE: CacheEntry = { status: 'idle', result: null, error: null }
const KEY = (month: string, bv: ClosingBv) => `${month}::${bv}`

export const useLeAiStore = create<LeAiStore>()(
  persist(
    (set, get) => ({
      cache: {},
      disabled: false,

      setDisabled: (v) => set({ disabled: v }),

      get: (month, bv) => get().cache[KEY(month, bv)] ?? IDLE,

      fetchSuggestions: async (month, bv, ctx, questions, userReflections, force = false) => {
        if (get().disabled) return
        const key = KEY(month, bv)
        const current = get().cache[key]
        // Skip als al loading of een vers success in cache zit (en niet geforceerd)
        if (!force && current) {
          if (current.status === 'loading') return
          if (current.status === 'success' && current.result) return
        }
        set(s => ({ cache: { ...s.cache, [key]: { status: 'loading', result: null, error: null } } }))
        try {
          const result = await requestLeAiSuggestions(ctx, questions, userReflections)
          set(s => ({ cache: { ...s.cache, [key]: { status: 'success', result, error: null } } }))
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          // 404 of network-fout: /api/chat is in dev (vite) niet beschikbaar
          // omdat het een Vercel Edge function is. Geen reden om de gebruiker
          // een rode banner te tonen — gewoon stilletjes de feature uitzetten.
          // In productie (Vercel) bestaat de endpoint en werkt het wel.
          const isAvailabilityError =
            msg.includes('(404)') ||
            msg.includes('(405)') ||
            msg.includes('Failed to fetch') ||
            msg.includes('NetworkError') ||
            msg.includes('TypeError') ||
            msg.includes('Load failed')
          if (isAvailabilityError) {
            set({ disabled: true })
            // Clear de loading-state voor deze key zodat de UI niet vast blijft
            // hangen op "AI analyseert…".
            set(s => {
              const next = { ...s.cache }
              delete next[key]
              return { cache: next }
            })
            return
          }
          set(s => ({ cache: { ...s.cache, [key]: { status: 'error', result: null, error: msg } } }))
        }
      },

      reset: (month, bv) => {
        const key = KEY(month, bv)
        set(s => {
          const next = { ...s.cache }
          delete next[key]
          return { cache: next }
        })
      },
    }),
    {
      name: 'tpg-le-ai-cache',
      // Persisteer alleen success-resultaten — loading/error houden we niet
      // over een refresh heen omdat ze stale zouden zijn.
      partialize: (s) => ({
        cache: Object.fromEntries(
          Object.entries(s.cache).filter(([, v]) => v.status === 'success'),
        ),
        disabled: s.disabled,
      }) as unknown as LeAiStore,
    },
  ),
)
