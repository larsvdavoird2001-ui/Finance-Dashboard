// Maandafsluiting → Latest Estimate-leerlus.
//
// Compacte AI-controle-vragen voor de maand en BVs die in de page-level
// filterbalk geselecteerd zijn (jaar / BV / periode). Geen eigen maand-
// tabs en geen variantie-tabel meer — die info zit al in de Budget vs
// Actuals tabel die direct hieronder verschijnt. Alleen de korte vragen
// per BV met inkapbare lijst, antwoord-input en scope (eenmalig /
// structureel) zodat de gebruiker de afwijkingen kan duiden.
//
// Voor YTD-keuzes pakt de host (BudgetTab) de laatst-afgesloten maand —
// reflecteren op meerdere maanden tegelijk werkt averechts in de UI.

import { useEffect, useMemo, useState } from 'react'
import type { EntityName } from '../../data/plData'
import type { ClosingBv, GlobalFilter } from '../../data/types'
import {
  buildReflectionContext, generateAiQuestions,
  type AiQuestion, type ReflectionContext,
} from '../../lib/leReflection'
import { useAdjustedActuals } from '../../hooks/useAdjustedActuals'
import { useFteStore } from '../../store/useFteStore'
import { useHoursStore } from '../../store/useHoursStore'
import { useBudgetStore } from '../../store/useBudgetStore'
import { useReflectionStore, type ReflectionAnswer } from '../../store/useReflectionStore'
import { useNavStore } from '../../store/useNavStore'
import { useCanApprove } from '../../lib/permissions'
import { derivePL } from '../../lib/plDerive'

const BV_COLORS: Record<ClosingBv, string> = {
  Consultancy: '#00a9e0',
  Projects:    '#26c997',
  Software:    '#8b5cf6',
  Holdings:    '#8fa3c0',
}

const CAT_ICON: Record<AiQuestion['category'], string> = {
  fte: '👥',
  declarability: '⏱',
  revenue: '💰',
  cost: '💸',
  margin: '📊',
  leave: '🌴',
  general: '🧭',
}

interface Props {
  filter: GlobalFilter
  /** De maand waarop we reflecteren — komt uit de page-level periode-filter
   *  (BudgetTab geeft een specifieke maand; bij YTD wordt dat de laatst-
   *  afgesloten maand). */
  targetMonth: string
  /** Email van de huidige user — voor 'savedBy' op antwoorden. */
  currentUserEmail?: string | null
}

interface QuestionRowProps {
  question: AiQuestion
  existing?: ReflectionAnswer
  onSave: (answer: string, scope: ReflectionAnswer['scope']) => void
}
function QuestionRow({ question, existing, onSave }: QuestionRowProps) {
  const [text, setText] = useState(existing?.answer ?? '')
  const [scope, setScope] = useState<ReflectionAnswer['scope']>(existing?.scope ?? 'unknown')
  const [dirty, setDirty] = useState(false)

  const handleSave = () => {
    if (!text.trim()) return
    onSave(text.trim(), scope)
    setDirty(false)
  }

  return (
    <div style={{
      padding: 8, borderRadius: 5,
      background: existing ? 'rgba(38,201,151,0.06)' : 'var(--bg2)',
      border: `1px solid ${existing ? 'var(--green)' : 'var(--bd2)'}`,
      display: 'flex', flexDirection: 'column', gap: 5,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <span style={{ fontSize: 13, lineHeight: 1.2 }}>{CAT_ICON[question.category]}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--t1)', fontWeight: 600, lineHeight: 1.4 }}>
            {question.question}
          </div>
          {question.hint && (
            <div style={{ fontSize: 9.5, color: 'var(--t3)', marginTop: 1, fontStyle: 'italic' }}>
              💡 {question.hint}
            </div>
          )}
        </div>
        {existing && (
          <span style={{ fontSize: 9, color: 'var(--green)', background: 'var(--bd-green)', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>
            ✓
          </span>
        )}
      </div>
      <textarea
        value={text}
        onChange={e => { setText(e.target.value); setDirty(true) }}
        placeholder="Korte uitleg — de LE-engine gebruikt dit voor toekomstige prognoses…"
        rows={2}
        style={{
          fontFamily: 'var(--font)', fontSize: 11,
          padding: '5px 7px', borderRadius: 4,
          border: '1px solid var(--bd2)', background: 'var(--bg1)', color: 'var(--t1)',
          resize: 'vertical', minHeight: 32,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9.5, color: 'var(--t3)' }}>Effect:</span>
        {(['one-off', 'structural', 'unknown'] as const).map(s => (
          <button
            key={s}
            onClick={() => { setScope(s); setDirty(true) }}
            style={{
              padding: '1px 7px', fontSize: 9.5, fontWeight: scope === s ? 700 : 500,
              borderRadius: 4, cursor: 'pointer',
              border: '1px solid', borderColor: scope === s ? 'var(--blue)' : 'var(--bd2)',
              background: scope === s ? 'rgba(0,169,224,.15)' : 'transparent',
              color: scope === s ? 'var(--blue)' : 'var(--t3)',
            }}
          >
            {s === 'one-off' ? 'Eenmalig' : s === 'structural' ? 'Structureel' : 'Onbekend'}
          </button>
        ))}
        <button
          onClick={handleSave}
          disabled={!text.trim() || (!dirty && !!existing)}
          className="btn sm primary"
          style={{ marginLeft: 'auto', fontSize: 10 }}
        >
          {existing && !dirty ? 'Opgeslagen' : 'Bewaar'}
        </button>
      </div>
    </div>
  )
}

interface BvBlockProps {
  ctx: ReflectionContext
  bv: ClosingBv
  month: string
  currentUserEmail?: string | null
}
function BvReflectionBlock({ ctx, bv, month, currentUserEmail }: BvBlockProps) {
  const questions = useMemo(() => generateAiQuestions(ctx), [ctx])
  const saveAnswer = useReflectionStore(s => s.saveAnswer)
  const getAnswer = useReflectionStore(s => s.getAnswer)
  // Subscribe op records voor live re-render bij saveAnswer.
  useReflectionStore(s => s.records)

  const unanswered = questions.filter(q => !getAnswer(month, bv, q.id)).length
  const allAnswered = questions.length > 0 && unanswered === 0
  // Default-state: open als er nog vragen openstaan, dicht als alles klaar is
  // — zo blijft het overzicht compact zodra de gebruiker klaar is.
  const [expanded, setExpanded] = useState<boolean>(unanswered > 0)
  useEffect(() => { setExpanded(unanswered > 0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, bv])

  // Geen vragen: BV-blok overslaan (anders krijg je een lege oranje-rand box).
  if (questions.length === 0) return null

  return (
    <div style={{
      padding: 8, borderRadius: 6,
      background: `${BV_COLORS[bv]}0E`,
      border: `1px solid ${BV_COLORS[bv]}55`,
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      {/* Compacte BV-header met inkap-toggle */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: 0, border: 'none', background: 'transparent',
          cursor: 'pointer', textAlign: 'left', width: '100%',
        }}
        aria-expanded={expanded}
      >
        <span style={{ fontSize: 11, color: 'var(--t3)', transform: expanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform .15s', display: 'inline-block', width: 10 }}>
          ▶
        </span>
        <span style={{
          display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
          background: BV_COLORS[bv],
        }} />
        <span style={{ fontSize: 10.5, fontWeight: 700, color: BV_COLORS[bv], textTransform: 'uppercase', letterSpacing: '.06em' }}>
          {bv}
        </span>
        {unanswered > 0 ? (
          <span style={{
            fontSize: 9.5, fontWeight: 700,
            padding: '2px 7px', borderRadius: 999,
            background: 'var(--amber)', color: '#000',
          }}>
            ⚠ {unanswered} {unanswered === 1 ? 'vraag' : 'vragen'} open
          </span>
        ) : allAnswered ? (
          <span style={{
            fontSize: 9.5, fontWeight: 700,
            padding: '2px 7px', borderRadius: 999,
            background: 'var(--bd-green)', color: 'var(--green)', border: '1px solid var(--green)',
          }}>
            ✓ alle {questions.length} beantwoord
          </span>
        ) : null}
        <span style={{ marginLeft: 'auto', fontSize: 9.5, color: 'var(--t3)' }}>
          {questions.length} {questions.length === 1 ? 'vraag' : 'vragen'} · {expanded ? 'klap dicht' : 'klap open'}
        </span>
      </button>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {questions.map(q => {
            const existing = getAnswer(month, bv, q.id)
            return (
              <QuestionRow
                key={q.id}
                question={q}
                existing={existing}
                onSave={(answer, scope) => saveAnswer(month, bv, q.id, q.question, answer, scope, currentUserEmail ?? undefined)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

export function LeReflectionPanel({ filter, targetMonth, currentUserEmail }: Props) {
  // De LE-leerlus is uitsluitend zichtbaar voor approvers (Controller / CFO)
  // en admins. Editors (financiële administratie) en viewers krijgen het
  // panel niet te zien — zij vullen actuals in maar de duiding van
  // afwijkingen is een approver-verantwoordelijkheid.
  const canApprove = useCanApprove()
  const { getMonthly } = useAdjustedActuals()
  const fteEntries = useFteStore(s => s.entries)
  const hoursEntries = useHoursStore(s => s.entries)
  const getBudgetMonth = useBudgetStore(s => s.getMonth)
  useBudgetStore(s => s.overrides)
  const getBudget = (bv: EntityName, m: string, key: string): number => {
    const raw = getBudgetMonth(bv, m)
    return derivePL(k => raw[k] ?? 0, key)
  }

  // Calendar-past + heeft data → maanden waarmee de pre-close LE gevoed wordt.
  // We hebben de hele lijst tot/met targetMonth nodig om de simulatie correct
  // te draaien (priorClosed = closedMonthsIncl filter < targetMonth).
  const closedMonthsIncl = useMemo(() => {
    const now = new Date()
    const MC = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const nowMi = now.getMonth(), nowY = now.getFullYear()
    const all = ['Jan-26','Feb-26','Mar-26','Apr-26','May-26','Jun-26','Jul-26','Aug-26','Sep-26','Oct-26','Nov-26','Dec-26']
    const past = (m: string): boolean => {
      const [mmm, yy] = m.split('-')
      const y = 2000 + Number(yy)
      const mi = MC.indexOf(mmm)
      if (y < nowY) return true
      if (y > nowY) return false
      return mi < nowMi
    }
    return all.filter(m => {
      if (!past(m)) return false
      const bvs: EntityName[] = ['Consultancy', 'Projects', 'Software', 'Holdings']
      return bvs.some(bv => {
        const d = getMonthly(bv, m)
        return (d['netto_omzet'] ?? 0) !== 0 ||
               (d['gefactureerde_omzet'] ?? 0) !== 0 ||
               (d['directe_kosten'] ?? 0) !== 0 ||
               (d['operationele_kosten'] ?? 0) !== 0
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fteEntries, getMonthly, hoursEntries])

  // Volg page-level BV-filter. 'all' → Cons/Proj/Soft (overhead-only Holdings
  // verbergen we hier; aparte BV-keuze toont uitsluitend die ene).
  const activeBvs: ClosingBv[] = filter.bv === 'all'
    ? ['Consultancy', 'Projects', 'Software']
    : filter.bv === 'Holdings'
      ? ['Holdings']
      : [filter.bv as ClosingBv]

  const contexts = useMemo(() => {
    return activeBvs.map(bv => ({
      bv,
      ctx: buildReflectionContext({
        bv: bv as EntityName,
        targetMonth,
        closedMonthsIncl,
        getMonthly: (e, m) => getMonthly(e, m),
        getBudget,
        fteEntries,
        hoursEntries,
      }),
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetMonth, JSON.stringify(activeBvs), fteEntries, hoursEntries, closedMonthsIncl.join('|')])

  // Tel onbeantwoorde vragen panel-breed.
  const reflectionRecords = useReflectionStore(s => s.records)
  const totalUnanswered = useMemo(() => {
    let count = 0
    for (const { bv, ctx } of contexts) {
      const qs = generateAiQuestions(ctx)
      const answers = reflectionRecords.find(r => r.month === targetMonth && r.bv === bv)?.answers ?? []
      for (const q of qs) {
        if (!answers.some(a => a.questionId === q.id)) count++
      }
    }
    return count
  }, [contexts, targetMonth, reflectionRecords])

  // Consume nav target — ook al sturen we hier niet meer een eigen month-tab,
  // we 'eten' wel de pending nav zodat hij niet bij volgende renders blijft
  // hangen.
  const navPending = useNavStore(s => s.pending)
  const consumeNav = useNavStore(s => s.consume)
  useEffect(() => {
    if (navPending?.tab === 'budget') consumeNav()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navPending])

  // Niets te tonen als geen calendar-past data óf geen vragen voor enige BV.
  const totalQuestions = contexts.reduce((s, { ctx }) => s + generateAiQuestions(ctx).length, 0)
  if (closedMonthsIncl.length === 0 || totalQuestions === 0) return null
  // Permission gate — alleen approver / admin krijgt de leerlus te zien.
  if (!canApprove) return null

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-hdr">
        <span className="card-title">🔁 Maandafsluiting → LE-leerlus</span>
        <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--t3)' }}>
          {targetMonth}
          {filter.bv !== 'all' ? ` · ${filter.bv}` : ''}
        </span>
        {totalUnanswered > 0 && (
          <span style={{
            marginLeft: 8, fontSize: 10, fontWeight: 700,
            padding: '3px 8px', borderRadius: 999,
            background: 'var(--amber)', color: '#000',
          }}>
            ⚠ {totalUnanswered} {totalUnanswered === 1 ? 'vraag' : 'vragen'} onbeantwoord
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>
          AI-vragen voor verbeterde forecast
        </span>
      </div>
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {contexts.map(({ bv, ctx }) => (
          <BvReflectionBlock
            key={bv}
            bv={bv}
            month={targetMonth}
            ctx={ctx}
            currentUserEmail={currentUserEmail}
          />
        ))}
      </div>
    </div>
  )
}
