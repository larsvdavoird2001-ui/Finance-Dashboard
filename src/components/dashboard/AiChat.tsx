import { useState, useRef, useEffect } from 'react'
import { useAdjustedActuals } from '../../hooks/useAdjustedActuals'
import { useOhwStore } from '../../store/useOhwStore'
import { useRawDataStore } from '../../store/useRawDataStore'
import { monthlyBudget2026, ytdBudget2026 } from '../../data/plData'
import type { EntityName } from '../../data/plData'
import { fmt } from '../../lib/format'
import { parseDutchNumber, detectBvFromValue } from '../../lib/parseImport'
import type { BvId } from '../../data/types'
import type { RawRow } from '../../store/useRawDataStore'

const BVS: BvId[] = ['Consultancy', 'Projects', 'Software']
const ACTUAL_MONTHS = ['Jan-26', 'Feb-26', 'Mar-26']

// Maand-aliassen voor herkenning in vrije tekst
const MONTH_ALIASES: Record<string, string> = {
  jan: 'Jan-26', januari: 'Jan-26', january: 'Jan-26',
  feb: 'Feb-26', februari: 'Feb-26', february: 'Feb-26',
  mrt: 'Mar-26', mar: 'Mar-26', maart: 'Mar-26', march: 'Mar-26',
}

interface Message { role: 'user' | 'assistant'; text: string }

const SUGGESTED = [
  'Omzettrend Q1 2026',
  'Marge analyse per BV',
  'Budget vs actuals',
  'Facturen overzicht Mar-26',
  'Top klanten Mar-26',
  'OHW overzicht',
]

interface FinCtx {
  monthly: Record<BvId, Record<string, Record<string, number>>>
  ytd:     Record<BvId, Record<string, number>>
  budM:    Record<BvId, Record<string, Record<string, number>>>
  ytdBud:  Record<BvId, Record<string, number>>
  wip:     Record<string, number>
}

function buildCtx(
  getMonthly: (bv: BvId, m: string) => Record<string, number>,
  getYtd:    (bv: BvId, m: string[]) => Record<string, number>,
  ohw: ReturnType<typeof useOhwStore.getState>['data2026'],
): FinCtx {
  const monthly: FinCtx['monthly'] = {} as FinCtx['monthly']
  const ytd:     FinCtx['ytd']     = {} as FinCtx['ytd']
  const budM:    FinCtx['budM']    = {} as FinCtx['budM']
  const ytdBud:  FinCtx['ytdBud'] = {} as FinCtx['ytdBud']
  for (const bv of BVS) {
    monthly[bv] = {}; budM[bv] = {}
    for (const m of ACTUAL_MONTHS) {
      monthly[bv][m] = getMonthly(bv, m)
      budM[bv][m]    = monthlyBudget2026[bv as EntityName]?.[m] ?? {}
    }
    ytd[bv]    = getYtd(bv, ACTUAL_MONTHS)
    ytdBud[bv] = ytdBudget2026[bv as EntityName] ?? {}
  }
  const wip: Record<string, number> = {}
  for (const m of ohw.allMonths) {
    wip[m] = ohw.entities.reduce((s, e) => s + (e.totaalOnderhanden[m] ?? 0), 0)
  }
  return { monthly, ytd, budM, ytdBud, wip }
}

function p(n: number, base: number) { return base !== 0 ? (n / base * 100).toFixed(1) + '%' : '—' }
function d(n: number) { return n >= 0 ? `+${fmt(n)}` : fmt(n) }

// ── Hulpfuncties voor raw-data queries ──────────────────────────────────────

function extractMonth(q: string): string | undefined {
  const lq = q.toLowerCase()
  for (const [alias, month] of Object.entries(MONTH_ALIASES)) {
    if (lq.includes(alias)) return month
  }
  // "Mar-26" of "Jan-26" formaat direct
  const m = lq.match(/\b(jan|feb|mar|mrt|apr|mei|jun|jul|aug|sep|okt|oct|nov|dec)[- ]?'?(\d{2})\b/)
  if (m) {
    const map: Record<string, string> = {
      jan: 'Jan', feb: 'Feb', mar: 'Mar', mrt: 'Mar',
      apr: 'Apr', mei: 'May', jun: 'Jun', jul: 'Jul',
      aug: 'Aug', sep: 'Sep', okt: 'Oct', oct: 'Oct', nov: 'Nov', dec: 'Dec',
    }
    return `${map[m[1]] ?? m[1].charAt(0).toUpperCase() + m[1].slice(1)}-${m[2]}`
  }
  return undefined
}

function extractBv(q: string): BvId | undefined {
  const lq = q.toLowerCase()
  if (lq.includes('consultancy') || lq.includes('consult')) return 'Consultancy'
  if (lq.includes('projects') || lq.includes('project')) return 'Projects'
  if (lq.includes('software')) return 'Software'
  return undefined
}

/** Haal het bedrag uit een rij op basis van de bekende bedrag-kolom */
function getRowAmount(row: RawRow, amountCol: string): number {
  if (!amountCol) {
    // Fallback: zoek het grootste getal in de rij
    let max = 0
    for (const v of Object.values(row)) {
      const n = parseDutchNumber(v)
      if (n !== null && Math.abs(n) > Math.abs(max)) max = n
    }
    return Math.abs(max)
  }
  const n = parseDutchNumber(row[amountCol])
  return n !== null ? Math.abs(n) : 0
}

/** Haal de BV-naam uit een rij op basis van de bekende BV-kolom */
function getRowBv(row: RawRow, bvCol: string): BvId | null {
  if (bvCol) {
    const bv = detectBvFromValue(row[bvCol])
    if (bv) return bv
  }
  // Fallback: scan alle waarden
  for (const v of Object.values(row)) {
    const bv = detectBvFromValue(v)
    if (bv) return bv
  }
  return null
}

/** Zoek een kolom die waarschijnlijk de klantnaam bevat */
function guessNameColumn(headers: string[]): string {
  const candidates = ['klantnaam', 'klant', 'debiteur', 'naam', 'omschrijving', 'customer', 'client', 'name', 'company', 'debtor']
  for (const kw of candidates) {
    const h = headers.find(h => h.toLowerCase().includes(kw))
    if (h) return h
  }
  return ''
}

/** Zoek een kolom die waarschijnlijk het factuurnummer bevat */
function guessInvoiceColumn(headers: string[]): string {
  const candidates = ['factuurnummer', 'factuur nr', 'invoice', 'faktuurnummer', 'document', 'nr', 'number', 'num']
  for (const kw of candidates) {
    const h = headers.find(h => h.toLowerCase().includes(kw))
    if (h) return h
  }
  return ''
}

// ── Antwoord-engine ──────────────────────────────────────────────────────────

function respond(msg: string, ctx: FinCtx): string {
  const q = msg.toLowerCase()
  const rawStore = useRawDataStore.getState()

  // ── Facturen: aantallen / overzicht ───────────────────────────────────────
  if (q.match(/facturen|invoice|factuur|stuks|aantal facturen/)) {
    const month = extractMonth(q)
    const bvFilter = extractBv(q)

    const entries = rawStore.getApproved('factuurvolume', month)
    if (entries.length === 0) {
      return `Geen goedgekeurde factuurdata gevonden${month ? ` voor ${month}` : ''}. Upload en keur een factuurvolume-bestand goed in de Maandafsluiting.`
    }

    // Samenvoegen van alle rijen
    const allRows = entries.flatMap(e => e.rows.map(r => ({ row: r, amountCol: e.amountCol, bvCol: e.bvCol })))

    // Filter op BV indien gevraagd
    const filtered = bvFilter
      ? allRows.filter(({ row, bvCol }) => getRowBv(row, bvCol) === bvFilter)
      : allRows

    const totalAmt = filtered.reduce((s, { row, amountCol }) => s + getRowAmount(row, amountCol), 0)
    const count = filtered.filter(({ row, amountCol }) => getRowAmount(row, amountCol) > 0).length

    // Per-BV verdeling
    const perBv: Record<BvId, { count: number; total: number }> = {
      Consultancy: { count: 0, total: 0 },
      Projects:    { count: 0, total: 0 },
      Software:    { count: 0, total: 0 },
    }
    for (const { row, amountCol, bvCol } of allRows) {
      const amt = getRowAmount(row, amountCol)
      if (amt === 0) continue
      const bv = getRowBv(row, bvCol)
      if (bv) { perBv[bv].count++; perBv[bv].total += amt }
    }

    const bvRows = BVS
      .filter(bv => perBv[bv].count > 0)
      .map(bv => `  **${bv}**: ${perBv[bv].count} facturen — ${fmt(perBv[bv].total)}`)

    const header = bvFilter
      ? `**Facturen ${bvFilter}${month ? ` — ${month}` : ''}**`
      : `**Factuuroverzicht${month ? ` — ${month}` : ' — alle maanden'}**`

    return `${header}\n\nAantal verwerkte factuurregels: **${count}**\nTotaal: **${fmt(totalAmt)}**${bvRows.length ? `\n\n**Per BV:**\n${bvRows.join('\n')}` : ''}`
  }

  // ── Top klanten / grootste facturen ───────────────────────────────────────
  if (q.match(/top|klant|klanten|customer|debiteur|grootste|hoogste/)) {
    const month = extractMonth(q)
    const bvFilter = extractBv(q)
    const n = parseInt(q.match(/top\s*(\d+)/)?.[1] ?? '10')

    const entries = rawStore.getApproved('factuurvolume', month)
    if (entries.length === 0) {
      return `Geen goedgekeurde factuurdata gevonden${month ? ` voor ${month}` : ''}. Upload eerst een factuurvolume-bestand.`
    }

    // Zoek klantnaam-kolom in eerste entry
    const headers = entries[0]?.rows[0] ? Object.keys(entries[0].rows[0]) : []
    const nameCol = guessNameColumn(headers)
    const invoiceCol = guessInvoiceColumn(headers)

    // Groepeer per klantnaam
    const byClient: Record<string, { total: number; count: number; bvs: Set<string> }> = {}

    for (const entry of entries) {
      for (const row of entry.rows) {
        const amt = getRowAmount(row, entry.amountCol)
        if (amt === 0) continue
        const bv = getRowBv(row, entry.bvCol)
        if (bvFilter && bv !== bvFilter) continue

        const clientKey = nameCol ? String(row[nameCol] ?? '').trim() : (invoiceCol ? String(row[invoiceCol] ?? '') : '—')
        if (!clientKey) continue

        if (!byClient[clientKey]) byClient[clientKey] = { total: 0, count: 0, bvs: new Set() }
        byClient[clientKey].total += amt
        byClient[clientKey].count++
        if (bv) byClient[clientKey].bvs.add(bv)
      }
    }

    const ranked = Object.entries(byClient)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, Math.min(n, 15))

    if (ranked.length === 0) {
      return `Geen klantdata gevonden. Controleer of het bestand een klantnaam-kolom bevat.`
    }

    const colLabel = nameCol ? `(kolom: ${nameCol})` : invoiceCol ? `(op factuurnummer)` : ''
    const rows = ranked.map(([name, { total, count, bvs }], i) =>
      `${i + 1}. **${name || '—'}** — ${fmt(total)} (${count}×${bvs.size > 0 ? ' · ' + [...bvs].join(', ') : ''})`
    )

    return `**Top ${ranked.length} klanten${bvFilter ? ` ${bvFilter}` : ''}${month ? ` — ${month}` : ''}** ${colLabel}\n\n${rows.join('\n')}`
  }

  // ── Specifiek factuurnummer / zoeken in data ───────────────────────────────
  if (q.match(/zoek|find|factuurnummer|invoice number|zoeken naar/)) {
    const entries = rawStore.getApproved('factuurvolume')
    if (entries.length === 0) return 'Geen factuurdata beschikbaar om in te zoeken.'

    // Zoekterm: alles wat tussen aanhalingstekens staat of na "zoek"/"find"
    const termMatch = msg.match(/["']([^"']+)["']/) ?? msg.match(/(?:zoek|find|zoeken naar)\s+(.+)/i)
    const term = termMatch?.[1]?.trim().toLowerCase()
    if (!term) return 'Geef een zoekterm op, bijv: _zoek "klantnaam"_ of _zoek "FV2026-001"_'

    const hits: string[] = []
    for (const entry of entries) {
      for (const row of entry.rows) {
        const matchingCol = Object.entries(row).find(([, v]) =>
          String(v ?? '').toLowerCase().includes(term)
        )
        if (matchingCol) {
          const amt = getRowAmount(row, entry.amountCol)
          const bv = getRowBv(row, entry.bvCol)
          const invoiceCol = guessInvoiceColumn(Object.keys(row))
          const nameCol = guessNameColumn(Object.keys(row))
          const inv = invoiceCol ? String(row[invoiceCol] ?? '') : ''
          const name = nameCol ? String(row[nameCol] ?? '') : ''
          hits.push(`**${inv || name || String(row[matchingCol[0]] ?? '')}** — ${fmt(amt)}${bv ? ` (${bv})` : ''} — ${entry.month}`)
          if (hits.length >= 10) break
        }
      }
      if (hits.length >= 10) break
    }

    if (hits.length === 0) return `Geen resultaten gevonden voor "${term}".`
    return `**Zoekresultaten voor "${term}"** (max 10):\n\n${hits.join('\n')}${hits.length === 10 ? '\n\n_Meer resultaten mogelijk — verfijn je zoekopdracht._' : ''}`
  }

  // ── Financiële analyses (bestaande logica) ────────────────────────────────

  if (q.match(/trend|omzet|revenue|kwartaal/)) {
    const rows = ACTUAL_MONTHS.map(m => {
      const r = BVS.reduce((s, bv) => s + (ctx.monthly[bv][m]['netto_omzet'] ?? 0), 0)
      const b = BVS.reduce((s, bv) => s + (ctx.budM[bv][m]['netto_omzet'] ?? 0), 0)
      return `**${m}**: ${fmt(r)} — vs budget ${d(r - b)}`
    })
    const janR = BVS.reduce((s, bv) => s + (ctx.monthly[bv]['Jan-26']['netto_omzet'] ?? 0), 0)
    const marR = BVS.reduce((s, bv) => s + (ctx.monthly[bv]['Mar-26']['netto_omzet'] ?? 0), 0)
    return `**Omzettrend Q1 2026**\n\n${rows.join('\n')}\n\nGroei Jan→Mar: ${p(marR - janR, janR)}`
  }

  if (q.match(/marge|margin/)) {
    const rows = BVS.map(bv => {
      const r  = ctx.ytd[bv]['netto_omzet'] ?? 0
      const gm = ctx.ytd[bv]['brutomarge'] ?? 0
      const bud = ctx.ytdBud[bv]['brutomarge'] ?? 0
      return `**${bv}**: ${fmt(gm)} (${p(gm, r)}) — Δ budget ${d(gm - bud)}`
    })
    const totR  = BVS.reduce((s, bv) => s + (ctx.ytd[bv]['netto_omzet'] ?? 0), 0)
    const totGm = BVS.reduce((s, bv) => s + (ctx.ytd[bv]['brutomarge'] ?? 0), 0)
    const lowest = [...BVS].sort((a, b) => {
      const rA = ctx.ytd[a]['netto_omzet'] ?? 0; const rB = ctx.ytd[b]['netto_omzet'] ?? 0
      return (rA > 0 ? (ctx.ytd[a]['brutomarge'] ?? 0) / rA : 0) -
             (rB > 0 ? (ctx.ytd[b]['brutomarge'] ?? 0) / rB : 0)
    })[0]
    return `**Brutomarge YTD 2026**\n\n${rows.join('\n')}\n\n**Totaal**: ${fmt(totGm)} (${p(totGm, totR)})\nLaagste marge: **${lowest}** — controleer directe kosten of bezetting.`
  }

  if (q.match(/groei|growth|best|hoogste/)) {
    const ranked = [...BVS].map(bv => {
      const r = ctx.ytd[bv]['netto_omzet'] ?? 0
      const b = ctx.ytdBud[bv]['netto_omzet'] ?? 0
      return { bv, r, b, pct: b > 0 ? ((r - b) / b * 100) : 0 }
    }).sort((a, b) => b.pct - a.pct)
    const medals = ['🥇', '🥈', '🥉']
    const rows = ranked.map((g, i) => `${medals[i]} **${g.bv}**: ${fmt(g.r)} (${g.pct >= 0 ? '+' : ''}${g.pct.toFixed(1)}% vs budget)`)
    return `**BV Groei ranking — YTD 2026**\n\n${rows.join('\n')}\n\nBeste performer: **${ranked[0].bv}** met ${d(ranked[0].r - ranked[0].b)} boven budget.`
  }

  if (q.match(/budget|actuals|vergelijk/)) {
    const rows = BVS.map(bv => {
      const r   = ctx.ytd[bv]['netto_omzet'] ?? 0
      const b   = ctx.ytdBud[bv]['netto_omzet'] ?? 0
      const gm  = ctx.ytd[bv]['brutomarge'] ?? 0
      const bgm = ctx.ytdBud[bv]['brutomarge'] ?? 0
      return `**${bv}** — Omzet: ${d(r - b)} | Marge: ${d(gm - bgm)}`
    })
    const totR = BVS.reduce((s, bv) => s + (ctx.ytd[bv]['netto_omzet'] ?? 0), 0)
    const totB = BVS.reduce((s, bv) => s + (ctx.ytdBud[bv]['netto_omzet'] ?? 0), 0)
    return `**Budget vs Actuals — YTD 2026**\n\n${rows.join('\n')}\n\n**Totaal omzet delta**: ${d(totR - totB)} (${p(totR - totB, totB)})`
  }

  if (q.match(/ohw|onderhanden|wip/)) {
    const wipRows = ACTUAL_MONTHS.map(m => `**${m}**: ${fmt(ctx.wip[m] ?? 0)}`)
    const delta = (ctx.wip['Mar-26'] ?? 0) - (ctx.wip['Feb-26'] ?? 0)
    return `**OHW Stand — Q1 2026**\n\n${wipRows.join('\n')}\n\nMutatie Feb→Mar: ${d(delta)}`
  }

  // ── Beschikbare data tonen ────────────────────────────────────────────────
  if (q.match(/beschikbaar|data|gegevens|geladen|upload|bestanden/)) {
    const entries = rawStore.getApproved()
    if (entries.length === 0) {
      return 'Geen goedgekeurde importbestanden beschikbaar. Upload bestanden via **Maandafsluiting → Bestanden importeren**.'
    }
    const lines = entries.map(e =>
      `• **${e.slotLabel}** — ${e.month} — ${e.rows.length} rijen (${e.fileName})`
    )
    return `**Beschikbare importdata (${entries.length} bestanden)**\n\n${lines.join('\n')}\n\nVraag bijv: _"facturen overzicht Mar-26"_ of _"top klanten Projects"_`
  }

  // ── Default samenvatting ──────────────────────────────────────────────────
  const totR  = BVS.reduce((s, bv) => s + (ctx.ytd[bv]['netto_omzet'] ?? 0), 0)
  const totGm = BVS.reduce((s, bv) => s + (ctx.ytd[bv]['brutomarge']  ?? 0), 0)
  const totB  = BVS.reduce((s, bv) => s + (ctx.ytdBud[bv]['netto_omzet'] ?? 0), 0)
  const wip   = ctx.wip['Mar-26'] ?? 0
  const hasRaw = rawStore.getApproved().length > 0
  return `**Executive samenvatting — YTD Q1 2026**\n\nOmzet: **${fmt(totR)}** (${d(totR - totB)} vs budget)\nBrutomarge: **${fmt(totGm)}** (${p(totGm, totR)})\nOHW stand: **${fmt(wip)}**\n\n${hasRaw ? 'Factuurdata beschikbaar — vraag bijv: _"facturen overzicht Mar-26"_ of _"top klanten"_' : 'Gebruik de suggesties voor specifieke analyses.'}`
}

// ── Markdown renderer ─────────────────────────────────────────────────────────
function Md({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
      {text.split('\n').map((line, i) => {
        const parts: React.ReactNode[] = []
        let rest = line; let idx = 0
        while (rest.length > 0) {
          // Bold: **tekst**
          const bs = rest.indexOf('**')
          // Italic via _: _tekst_
          const is = rest.indexOf('_')
          const first = bs !== -1 && (is === -1 || bs <= is) ? 'bold' : is !== -1 ? 'italic' : null
          if (!first) { parts.push(<span key={idx++}>{rest}</span>); break }
          if (first === 'bold') {
            if (bs > 0) parts.push(<span key={idx++}>{rest.slice(0, bs)}</span>)
            const e = rest.indexOf('**', bs + 2)
            if (e === -1) { parts.push(<span key={idx++}>{rest.slice(bs)}</span>); break }
            parts.push(<strong key={idx++}>{rest.slice(bs + 2, e)}</strong>)
            rest = rest.slice(e + 2)
          } else {
            if (is > 0) parts.push(<span key={idx++}>{rest.slice(0, is)}</span>)
            const e = rest.indexOf('_', is + 1)
            if (e === -1) { parts.push(<span key={idx++}>{rest.slice(is)}</span>); break }
            parts.push(<em key={idx++} style={{ color: 'var(--t2)' }}>{rest.slice(is + 1, e)}</em>)
            rest = rest.slice(e + 1)
          }
        }
        return <div key={i}>{parts}</div>
      })}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────
export function AiChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLInputElement>(null)

  const { getMonthly, getYtd } = useAdjustedActuals()
  const ohwData2026 = useOhwStore(s => s.data2026)
  const ctx = buildCtx(getMonthly, getYtd, ohwData2026)

  // Toon badge als er goedgekeurde importdata is
  const hasData = useRawDataStore(s => s.entries.some(e => e.status === 'approved'))

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 100) }, [open])

  const send = (text: string) => {
    if (!text.trim() || loading) return
    setMessages(p => [...p, { role: 'user', text }])
    setInput('')
    setLoading(true)
    setTimeout(() => {
      setMessages(p => [...p, { role: 'assistant', text: respond(text, ctx) }])
      setLoading(false)
    }, 350)
  }

  return (
    <>
      {/* Floating trigger */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 200,
            width: 48, height: 48, borderRadius: '50%',
            background: 'var(--blue)', border: 'none',
            color: '#fff', fontSize: 20, cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0,169,224,.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'transform .15s',
          }}
          title="AI Financieel Assistent"
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.1)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          🤖
          {hasData && (
            <span style={{
              position: 'absolute', top: 2, right: 2,
              width: 10, height: 10, borderRadius: '50%',
              background: 'var(--green)', border: '2px solid var(--blue)',
            }} />
          )}
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 16, right: 16, zIndex: 200,
          width: 380, height: 560,
          background: 'var(--bg2)', border: '1px solid var(--bd)',
          borderRadius: 12, display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,.45)',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 14px', borderBottom: '1px solid var(--bd)',
            background: 'var(--bg3)',
          }}>
            <span style={{ fontSize: 16 }}>🤖</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)' }}>AI Financieel Assistent</div>
              <div style={{ fontSize: 10, color: hasData ? 'var(--green)' : 'var(--t3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: hasData ? 'var(--green)' : 'var(--t3)', display: 'inline-block' }} />
                {hasData ? 'Factuurdata geladen' : 'Live P&L data'}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {messages.length > 0 && (
                <button
                  onClick={() => setMessages([])}
                  style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', fontSize: 11, padding: '2px 6px' }}
                  title="Wis gesprek"
                >Wis</button>
              )}
              <button
                onClick={() => setOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', fontSize: 16, padding: '0 4px', lineHeight: 1 }}
              >×</button>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 4px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', paddingTop: 24, color: 'var(--t3)' }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>💬</div>
                <div style={{ fontSize: 11, marginBottom: 8 }}>Stel een vraag over de financiële data</div>
                {hasData && (
                  <div style={{ fontSize: 10, color: 'var(--green)', background: 'rgba(38,201,151,.08)', border: '1px solid rgba(38,201,151,.2)', borderRadius: 6, padding: '5px 10px', display: 'inline-block' }}>
                    Factuurdata beschikbaar — vraag naar klanten, aantallen of specifieke facturen
                  </div>
                )}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '90%',
                background: m.role === 'user' ? 'var(--blue)' : 'var(--bg3)',
                color: m.role === 'user' ? '#fff' : 'var(--t1)',
                borderRadius: m.role === 'user' ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
                padding: '8px 12px',
                border: m.role === 'assistant' ? '1px solid var(--bd)' : 'none',
              }}>
                {m.role === 'assistant' ? <Md text={m.text} /> : <span style={{ fontSize: 12 }}>{m.text}</span>}
              </div>
            ))}
            {loading && (
              <div style={{
                alignSelf: 'flex-start', background: 'var(--bg3)', border: '1px solid var(--bd)',
                borderRadius: '10px 10px 10px 2px', padding: '10px 14px',
              }}>
                <span style={{ color: 'var(--t3)', fontSize: 18, letterSpacing: 3 }}>···</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Suggested prompts */}
          <div style={{ padding: '6px 10px', borderTop: '1px solid var(--bd)', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {SUGGESTED.map(s => (
              <button
                key={s}
                onClick={() => send(s)}
                disabled={loading}
                style={{
                  fontSize: 10, padding: '2px 7px', borderRadius: 10, cursor: 'pointer',
                  border: '1px solid var(--bd2)', background: 'var(--bg3)',
                  color: 'var(--t2)', fontFamily: 'var(--font)',
                  opacity: loading ? 0.5 : 1,
                }}
              >{s}</button>
            ))}
          </div>

          {/* Input */}
          <div style={{ padding: '8px 10px 10px', display: 'flex', gap: 6, borderTop: '1px solid var(--bd)' }}>
            <input
              ref={inputRef}
              style={{
                flex: 1, background: 'var(--bg3)', border: '1px solid var(--bd2)',
                borderRadius: 8, color: 'var(--t1)', fontSize: 12,
                padding: '7px 10px', fontFamily: 'var(--font)', outline: 'none',
              }}
              placeholder="Vraag iets over facturen, klanten, omzet…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send(input)}
              disabled={loading}
            />
            <button
              className="btn sm primary"
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
              style={{ minWidth: 52, padding: '0 10px' }}
            >
              {loading ? '…' : '↑'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
