// LE-reflectie: per (maand, BV, vraag-id) bewaren we de uitleg van de
// gebruiker over een variantie tussen actual, budget en pre-close LE. Deze
// antwoorden zijn de leerinput voor de Latest-Estimate-engine — de app
// vertrouwt erop dat de gebruiker hier eerlijk aangeeft of een afwijking
// eenmalig of structureel is, zodat toekomstige forecasts daarmee rekening
// houden.
//
// Persistentie: Supabase (tabel `closing_reflections`) + localStorage als
// cache, zodat de reflecties gedeeld zijn met alle gebruikers.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ClosingBv } from '../data/types'
import { fetchReflections, upsertReflections } from '../lib/db'

export interface ReflectionAnswer {
  /** Stable id zoals 'fte-up' — komt uit de question generator. */
  questionId: string
  /** De volledige vraag zoals getoond op het moment van invullen (snapshot). */
  question: string
  /** Het antwoord van de gebruiker. Vrije tekst. */
  answer: string
  /** Was de afwijking eenmalig (one-off) of structureel? Bepaalt of de LE
   *  formule deze ervaring zou moeten doorzetten naar volgende maanden. */
  scope?: 'one-off' | 'structural' | 'unknown'
  /** ISO-timestamp wanneer het antwoord is opgeslagen. */
  savedAt: string
  /** Wie het antwoord heeft ingevuld (email). */
  savedBy?: string
}

export interface ReflectionRecord {
  /** Maand waarop de reflectie betrekking heeft, bv. 'Mar-26'. */
  month: string
  /** Optionele BV-scope. Sommige vragen gaan over 1 BV, sommige over alle. */
  bv?: ClosingBv | 'all'
  answers: ReflectionAnswer[]
}

interface ReflectionStore {
  records: ReflectionRecord[]
  loaded: boolean
  /** Laad uit Supabase + merge met lokale state (DB wint per maand/BV). */
  loadFromDb: () => Promise<void>
  /** Bewaar of update een antwoord voor (maand, bv, vraag-id). */
  saveAnswer: (
    month: string,
    bv: ClosingBv | 'all',
    questionId: string,
    question: string,
    answer: string,
    scope?: ReflectionAnswer['scope'],
    savedBy?: string,
  ) => void
  /** Verwijder één antwoord. */
  removeAnswer: (month: string, bv: ClosingBv | 'all', questionId: string) => void
  /** Alle antwoorden voor (maand, bv). */
  getAnswers: (month: string, bv: ClosingBv | 'all') => ReflectionAnswer[]
  /** Snel één antwoord ophalen — voor pre-fill van inputs. */
  getAnswer: (month: string, bv: ClosingBv | 'all', questionId: string) => ReflectionAnswer | undefined
}

function recordKey(r: ReflectionRecord): string {
  return `${r.month}::${r.bv ?? 'all'}`
}

export const useReflectionStore = create<ReflectionStore>()(
  persist(
    (set, get) => ({
      records: [],
      loaded: false,

      loadFromDb: async () => {
        let dbRows: ReflectionRecord[] = []
        try {
          dbRows = await fetchReflections()
        } catch (e) {
          console.warn('[useReflectionStore] fetch failed — keeping local state:', e)
          set({ loaded: true })
          return
        }
        const local = get().records
        const byKey = new Map(local.map(r => [recordKey(r), r]))
        for (const r of dbRows) byKey.set(recordKey(r), r)   // Supabase wint
        set({ records: Array.from(byKey.values()), loaded: true })
        const dbKeys = new Set(dbRows.map(recordKey))
        const localOnly = local.filter(r => !dbKeys.has(recordKey(r)))
        if (localOnly.length > 0) upsertReflections(localOnly)
      },

      saveAnswer: (month, bv, questionId, question, answer, scope, savedBy) => {
        const key = `${month}::${bv}`
        const now = new Date().toISOString()
        set(s => {
          const existing = s.records.find(r => recordKey(r) === key)
          if (!existing) {
            const fresh: ReflectionRecord = {
              month,
              bv,
              answers: [{ questionId, question, answer, scope, savedAt: now, savedBy }],
            }
            return { records: [...s.records, fresh] }
          }
          // Vraag al beantwoord? overschrijven; anders toevoegen.
          const next: ReflectionAnswer[] = existing.answers.some(a => a.questionId === questionId)
            ? existing.answers.map(a => a.questionId === questionId
              ? { ...a, question, answer, scope, savedAt: now, savedBy }
              : a)
            : [...existing.answers, { questionId, question, answer, scope, savedAt: now, savedBy }]
          return {
            records: s.records.map(r => recordKey(r) === key ? { ...r, answers: next } : r),
          }
        })
        const rec = get().records.find(r => recordKey(r) === key)
        if (rec) upsertReflections([rec])
      },

      removeAnswer: (month, bv, questionId) => {
        const key = `${month}::${bv}`
        set(s => ({
          records: s.records.map(r =>
            recordKey(r) === key
              ? { ...r, answers: r.answers.filter(a => a.questionId !== questionId) }
              : r,
          ),
        }))
        const rec = get().records.find(r => recordKey(r) === key)
        if (rec) upsertReflections([rec])
      },

      getAnswers: (month, bv) => {
        const key = `${month}::${bv}`
        return get().records.find(r => recordKey(r) === key)?.answers ?? []
      },

      getAnswer: (month, bv, questionId) => {
        const key = `${month}::${bv}`
        return get().records
          .find(r => recordKey(r) === key)
          ?.answers.find(a => a.questionId === questionId)
      },
    }),
    {
      name: 'tpg-le-reflections',
      partialize: (s) => ({ records: s.records }) as unknown as ReflectionStore,
    },
  ),
)
