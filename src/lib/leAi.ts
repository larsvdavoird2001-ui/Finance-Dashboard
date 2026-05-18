// AI-overlay voor de LE-leerlus. Stuurt een gestructureerd variance-pakket
// naar Claude (via /api/chat — dezelfde backend als AiChat.tsx) en parsed het
// JSON-antwoord terug naar twee bruikbare brokken:
//
//   1. Per-vraag scope-suggestie (one-off of structural + confidence),
//      zodat de gebruiker een AI-aangedragen classificatie kan accepteren of
//      overschrijven.
//   2. CFO-commentary — 2-3 zinnen die de maand duiden in normale taal,
//      onder de variance-tabel.
//
// Antwoorden worden gecachet in useLeAiStore zodat we niet bij elke render
// een nieuwe API-call doen. Refresh-knop in de UI hercallt expliciet.

import type { ReflectionContext, AiQuestion, VarianceMetric } from './leReflection'
import type { ReflectionAnswer } from '../store/useReflectionStore'

export interface LeAiSuggestion {
  questionId: string
  /** Geadviseerde scope voor deze afwijking. */
  suggestedScope: 'one-off' | 'structural' | 'unknown'
  /** 0..1 — hoe zeker Claude is. <0.5 wordt in de UI als 'twijfel' getoond. */
  confidence: number
  /** Korte motivering — 1 zin. */
  reasoning: string
}

export interface LeAiResult {
  /** Per-vraag scope-suggesties. */
  suggestions: LeAiSuggestion[]
  /** 2-3 zinnen CFO-commentary over de maand. */
  commentary: string
  /** ISO-timestamp wanneer het antwoord werd opgehaald. */
  retrievedAt: string
}

const SYSTEM_PROMPT = `Je bent een senior FP&A-analist bij een Nederlands consultancy-bedrijf. Je krijgt de variance-analyse van een net afgesloten maand: actual vs Latest Estimate per P&L-regel, plus de operationele drivers (FTE-bezetting, declarability, vakantie) en eventueel al ingevulde reflecties van de gebruiker.

Je taak heeft TWEE delen:

1. Voor elke geleverde "question" geef je een geadviseerde scope-classificatie. Twee opties:
   - "one-off": de afwijking is eenmalig en mag NIET doorwerken in de Latest Estimate voor toekomstige maanden. Voorbeelden: settlement, restitutie, eenmalige boeking, project-afsluiting, tijdelijke uitval, eenmalige hire-kost.
   - "structural": de afwijking is het nieuwe normaal en moet WEL doorwerken. Voorbeelden: tariefverhoging die blijft, FTE-uitbreiding die productief blijft, huur-indexatie, contract-aanpassing.
   - "unknown": als de data het echt niet uitwijst.
   Geef een confidence van 0 tot 1 en een korte (1 zin) motivering.

2. Schrijf een commentary van 2-3 zinnen in correct, zakelijk Nederlands die de maand duidt voor de CFO. Concreet, geen jargon, geen disclaimers. Begin direct met de belangrijkste bevinding.

ANTWOORD UITSLUITEND IN GELDIG JSON, exact volgens dit schema (geen extra tekst eromheen, geen markdown-code-fences):

{
  "suggestions": [
    { "questionId": "<id>", "suggestedScope": "one-off"|"structural"|"unknown", "confidence": 0.0-1.0, "reasoning": "<1 zin>" }
  ],
  "commentary": "<2-3 zinnen>"
}`

/** Compacte JSON-representatie van een ReflectionContext voor de prompt. */
function buildContextPayload(ctx: ReflectionContext, questions: AiQuestion[], userReflections: ReflectionAnswer[]) {
  const varianceSlim = (v: VarianceMetric) => ({
    key: v.key,
    label: v.label,
    actual: Math.round(v.actual),
    preCloseLe: Math.round(v.preCloseLe),
    budget: Math.round(v.budget),
    deltaLE: Math.round(v.vsLe),
    deltaLEPct: Number(v.vsLePct.toFixed(1)),
    deltaBudget: Math.round(v.vsBudget),
  })
  return {
    bv: ctx.bv,
    month: ctx.month,
    variances: ctx.variances.map(varianceSlim),
    drivers: {
      fteCurrent: ctx.fteCurrent,
      ftePrev: ctx.ftePrev,
      fteBudget: ctx.fteBudget,
      fteVsBudget: ctx.fteVsBudget,
      declarability: Number(ctx.declarability.toFixed(1)),
      declarabilityPrevAvg: Number(ctx.declarabilityPrevAvg.toFixed(1)),
      vakantie: ctx.vakantie,
      ziekte: ctx.ziekte,
    },
    questions: questions.map(q => ({ id: q.id, question: q.question, category: q.category })),
    userReflections: userReflections.map(a => ({
      questionId: a.questionId,
      scope: a.scope,
      answer: a.answer.slice(0, 200),
    })),
  }
}

/** Roep Claude aan via /api/chat met een gestructureerd variance-pakket. */
export async function requestLeAiSuggestions(
  ctx: ReflectionContext,
  questions: AiQuestion[],
  userReflections: ReflectionAnswer[],
  signal?: AbortSignal,
): Promise<LeAiResult> {
  const payload = buildContextPayload(ctx, questions, userReflections)
  const userMessage = `Variance-analyse en drivers:\n\n${JSON.stringify(payload, null, 2)}\n\nGeef het JSON-antwoord nu.`

  const resp = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      max_tokens: 1024,
    }),
    signal,
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`AI-overlay API-fout (${resp.status}): ${text.slice(0, 200)}`)
  }
  const data = await resp.json()
  if (data?.error) throw new Error(data.error?.message ?? JSON.stringify(data.error))
  if (!Array.isArray(data?.content)) throw new Error('Onverwacht response-formaat van Claude')

  const text = data.content
    .filter((b: { type?: string }) => b?.type === 'text')
    .map((b: { text?: string }) => b.text ?? '')
    .join('')
    .trim()

  return parseLeAiResponse(text)
}

/** Tolerante JSON-parser: pakt het eerste blok dat op JSON lijkt, ook als
 *  Claude per ongeluk markdown-fences of een korte intro voor de JSON zet. */
export function parseLeAiResponse(text: string): LeAiResult {
  // Strip eventuele code-fences
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  }
  // Zoek het eerste { ... } blok (greedy tot de laatste matching })
  const first = cleaned.indexOf('{')
  const last  = cleaned.lastIndexOf('}')
  if (first < 0 || last <= first) {
    throw new Error('Geen JSON gevonden in AI-antwoord')
  }
  const json = cleaned.slice(first, last + 1)
  const parsed = JSON.parse(json) as { suggestions?: unknown; commentary?: unknown }

  const suggestions: LeAiSuggestion[] = Array.isArray(parsed.suggestions)
    ? parsed.suggestions
        .filter((s: unknown): s is Record<string, unknown> => typeof s === 'object' && s != null)
        .map(s => ({
          questionId: String(s.questionId ?? ''),
          suggestedScope:
            s.suggestedScope === 'one-off' || s.suggestedScope === 'structural'
              ? s.suggestedScope
              : 'unknown',
          confidence: typeof s.confidence === 'number' ? Math.max(0, Math.min(1, s.confidence)) : 0,
          reasoning: String(s.reasoning ?? ''),
        }))
        .filter(s => s.questionId.length > 0)
    : []

  const commentary = typeof parsed.commentary === 'string' ? parsed.commentary.trim() : ''
  return { suggestions, commentary, retrievedAt: new Date().toISOString() }
}
