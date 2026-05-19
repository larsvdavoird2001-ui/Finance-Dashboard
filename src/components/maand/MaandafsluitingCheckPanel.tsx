import { useMemo, useState } from 'react'
import { useFinStore } from '../../store/useFinStore'
import { useOhwStore } from '../../store/useOhwStore'
import { MAANDAFSLUITING_ACTUALS, type MaandafsluitingActual } from '../../data/maandafsluitingActuals'
import { fmt } from '../../lib/format'
import type { ClosingBv } from '../../data/types'

const BVS: ClosingBv[] = ['Consultancy', 'Projects', 'Software', 'Holdings']
const TOLERANCE = 1 // |Δ| > 1 EUR telt als afwijking (suppress floating-point noise)

interface Row {
  month: string
  bv: ClosingBv
  app: {
    factuurvolume: number | null
    mutatieOhw: number | null
    totaalIC: number | null
    mutatieVooruitgef: number | null
    totaal: number | null
  }
  excel: MaandafsluitingActual
  delta: {
    factuurvolume: number
    mutatieOhw: number
    totaalIC: number
    mutatieVooruitgef: number
    totaal: number
  }
  hasMismatch: boolean
  sourceFile: string
}

function deltaCellColor(delta: number): string {
  const abs = Math.abs(delta)
  if (abs <= TOLERANCE) return 'var(--t3)'
  if (abs < 100) return 'var(--amber)'
  return 'var(--red)'
}

function DeltaCell({ app, excel, na = false }: { app: number | null; excel: number | null; na?: boolean }) {
  if (na) return <td className="mono r" style={{ color: 'var(--t3)', fontSize: 11 }}>n/a</td>
  if (excel == null) return <td className="mono r" style={{ color: 'var(--t3)', fontSize: 11 }}>—</td>
  const a = app ?? 0
  const e = excel
  const d = a - e
  const color = deltaCellColor(d)
  const isMismatch = Math.abs(d) > TOLERANCE
  return (
    <td
      className="mono r"
      style={{
        color,
        fontSize: 11,
        fontWeight: isMismatch ? 600 : 400,
        background: isMismatch ? 'rgba(255,193,7,0.04)' : undefined,
      }}
      title={`App: ${fmt(a)}\nExcel: ${fmt(e)}\nΔ (app − excel): ${d >= 0 ? '+' : ''}${fmt(d)}`}
    >
      {d >= 0 ? '+' : ''}{fmt(d)}
    </td>
  )
}

interface Props {
  /** Optioneel: highlight de currently-selected maand */
  currentMonth?: string
  /** Optioneel: scroll naar (en filter op) deze maand wanneer panel geopend wordt */
  defaultExpanded?: boolean
}

export function MaandafsluitingCheckPanel({ currentMonth, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [filter, setFilter] = useState<'all' | 'mismatch' | 'current'>('mismatch')
  const [bvFilter, setBvFilter] = useState<'all' | ClosingBv>('all')

  // Live stores
  const finEntries = useFinStore(s => s.entries)
  const ohwYear2025 = useOhwStore(s => s.data2025)
  const ohwYear2026 = useOhwStore(s => s.data2026)

  const rows: Row[] = useMemo(() => {
    return MAANDAFSLUITING_ACTUALS.map(excel => {
      const year = excel.month.endsWith('-25') ? '2025' : '2026'
      const ohwData = year === '2025' ? ohwYear2025 : ohwYear2026
      const ohwEntity = ohwData.entities.find(e => e.entity === excel.bv)

      // Factuurvolume: voor 2026 wint de closing entry (user-editable in
      // Maandafsluiting); voor 2025 vallen we terug op het static seed in
      // ohwData2025. Holdings heeft géén ohw-entity → alleen closing entry.
      const closing = finEntries.find(e => e.bv === excel.bv && e.month === excel.month)
      const factuurvolume: number | null = closing
        ? closing.factuurvolume
        : (ohwEntity?.factuurvolume?.[excel.month] ?? (excel.bv === 'Holdings' ? null : 0))

      const mutatieOhw: number | null = ohwEntity?.mutatieOhw?.[excel.month] ?? null
      const totaalIC: number | null = ohwEntity?.totaalIC?.[excel.month] ?? null
      const mutatieVooruitgef: number | null = excel.bv === 'Software'
        ? (ohwEntity?.mutatieVooruitgefactureerd?.[excel.month] ?? null)
        : null

      // Excel-totaal berekenen uit components (cell "Netto-omzet" zelf is in
      // sommige bestanden corrupt — literal "15"). App-totaal = som van de
      // 4 components zoals MaandTab.netRevenue ze gebruikt.
      const excelTotal =
        (excel.nettoOmzetExtern ?? 0) +
        (excel.nettoOmzetIc ?? 0) +
        (excel.nogTeFactExtern ?? 0) +
        (excel.vooruitgefactureerd ?? 0)
      const appTotal =
        (factuurvolume ?? 0) +
        (mutatieOhw ?? 0) +
        (totaalIC ?? 0) +
        (excel.bv === 'Software' ? (mutatieVooruitgef ?? 0) : 0)

      const dFv = (factuurvolume ?? 0) - (excel.nettoOmzetExtern ?? 0)
      const dMo = (mutatieOhw ?? 0) - (excel.nogTeFactExtern ?? 0)
      const dIc = (totaalIC ?? 0) - (excel.nettoOmzetIc ?? 0)
      const dVf = excel.bv === 'Software'
        ? (mutatieVooruitgef ?? 0) - (excel.vooruitgefactureerd ?? 0)
        : 0
      const dTot = appTotal - excelTotal

      // Holdings: alleen factuurvolume telt; mutatie/IC/vooruitgef zijn n/a
      // (geen OHW-entity). Mismatch check beperkt zich tot beschikbare velden.
      const hasMismatch = excel.bv === 'Holdings'
        ? Math.abs(dFv) > TOLERANCE
        : (Math.abs(dFv) > TOLERANCE || Math.abs(dMo) > TOLERANCE ||
           Math.abs(dIc) > TOLERANCE || Math.abs(dVf) > TOLERANCE)

      return {
        month: excel.month,
        bv: excel.bv,
        app: { factuurvolume, mutatieOhw, totaalIC, mutatieVooruitgef, totaal: appTotal },
        excel,
        delta: { factuurvolume: dFv, mutatieOhw: dMo, totaalIC: dIc, mutatieVooruitgef: dVf, totaal: dTot },
        hasMismatch,
        sourceFile: excel.sourceFile,
      }
    })
  }, [finEntries, ohwYear2025, ohwYear2026])

  const filtered = useMemo(() => {
    let r = rows
    if (filter === 'mismatch') r = r.filter(x => x.hasMismatch)
    if (filter === 'current' && currentMonth) r = r.filter(x => x.month === currentMonth)
    if (bvFilter !== 'all') r = r.filter(x => x.bv === bvFilter)
    return r
  }, [rows, filter, bvFilter, currentMonth])

  const mismatchCount = rows.filter(r => r.hasMismatch).length
  const totalCount = rows.length

  return (
    <div className="card">
      <div
        className="card-hdr"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setExpanded(o => !o)}
      >
        <span style={{ fontSize: 10, marginRight: 6, display: 'inline-block', transition: 'transform .2s', transform: expanded ? 'rotate(90deg)' : 'none' }}>▶</span>
        <span className="card-title">🔍 Controle vs Excel maandafsluiting</span>
        <span style={{ marginLeft: 12, fontSize: 11, color: mismatchCount > 0 ? 'var(--amber)' : 'var(--green)' }}>
          {mismatchCount > 0
            ? <><strong>{mismatchCount}</strong> afwijkingen van {totalCount} (maand × BV)</>
            : <>✓ Alle {totalCount} maand × BV combinaties matchen</>}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--t3)' }}>
          {expanded ? 'Klap in' : 'Klap uit voor detail'}
        </span>
      </div>

      {expanded && (
        <div style={{ padding: '10px 14px' }}>
          <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 10, lineHeight: 1.5 }}>
            <strong>Bron:</strong> kolom B (Actuals) van tabbladen "{`<BV>`} M new" in
            elke maandafsluiting-Excel in <code>Maandafsluitingen/</code>.
            <br />
            <strong>Δ = App − Excel.</strong> Een mismatch (|Δ| &gt; €{TOLERANCE}) betekent
            dat de app-waarde afwijkt; de Excel is leidend.
            Klik op een cel voor exacte waarden.
            <br />
            <strong>Mapping:</strong> Factuurvolume ↔ "Netto-omzet extern" ·
            Mutatie OHW ↔ "Nog te factureren omzet extern" ·
            Totaal IC ↔ "Netto-omzet IC" ·
            Mutatie Vooruitgef. ↔ "Vooruitgefactureerde omzet" (alleen Software).
            <br />
            <strong>Holdings:</strong> alleen factuurvolume wordt vergeleken (geen OHW-entity).
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 600 }}>FILTER:</span>
            <button
              className={`btn sm${filter === 'mismatch' ? ' primary' : ' ghost'}`}
              onClick={() => setFilter('mismatch')}
            >Alleen afwijkingen ({mismatchCount})</button>
            <button
              className={`btn sm${filter === 'all' ? ' primary' : ' ghost'}`}
              onClick={() => setFilter('all')}
            >Alle ({totalCount})</button>
            {currentMonth && (
              <button
                className={`btn sm${filter === 'current' ? ' primary' : ' ghost'}`}
                onClick={() => setFilter('current')}
              >Huidige maand ({currentMonth})</button>
            )}
            <span style={{ marginLeft: 16, fontSize: 10, color: 'var(--t3)', fontWeight: 600 }}>BV:</span>
            <button
              className={`btn sm${bvFilter === 'all' ? ' primary' : ' ghost'}`}
              onClick={() => setBvFilter('all')}
            >Alle</button>
            {BVS.map(bv => (
              <button
                key={bv}
                className={`btn sm${bvFilter === bv ? ' primary' : ' ghost'}`}
                onClick={() => setBvFilter(bv)}
              >{bv}</button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--t3)', padding: '20px 0', textAlign: 'center' }}>
              {filter === 'mismatch'
                ? '✓ Geen afwijkingen binnen huidige filter.'
                : 'Geen records binnen huidige filter.'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl" style={{ minWidth: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 70, fontSize: 11 }}>Maand</th>
                    <th style={{ minWidth: 95, fontSize: 11 }}>BV</th>
                    <th className="r" style={{ fontSize: 11 }} title="Factuurvolume vs Netto-omzet extern">Δ Factuurvol.</th>
                    <th className="r" style={{ fontSize: 11 }} title="Mutatie OHW vs Nog te factureren omzet extern">Δ Mutatie OHW</th>
                    <th className="r" style={{ fontSize: 11 }} title="Totaal IC vs Netto-omzet IC">Δ Totaal IC</th>
                    <th className="r" style={{ fontSize: 11 }} title="Mutatie Vooruitgefactureerd vs Vooruitgefactureerde omzet — alleen Software">Δ Vooruitgef.</th>
                    <th className="r" style={{ fontSize: 11, borderLeft: '1px solid var(--bd2)' }} title="Som van de 4 components: App-totaal vs Excel-totaal">Δ Totaal</th>
                    <th style={{ fontSize: 11, minWidth: 60 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => {
                    const isCurrent = currentMonth === r.month
                    return (
                      <tr
                        key={`${r.month}-${r.bv}`}
                        style={{
                          background: isCurrent ? 'rgba(0,169,224,0.06)' : undefined,
                          outline: isCurrent ? '1px solid var(--blue)' : undefined,
                          outlineOffset: -1,
                        }}
                      >
                        <td style={{ fontSize: 11, fontWeight: isCurrent ? 600 : 400 }}>{r.month}</td>
                        <td style={{ fontSize: 11 }}>{r.bv}</td>
                        <DeltaCell app={r.app.factuurvolume} excel={r.excel.nettoOmzetExtern} />
                        <DeltaCell app={r.app.mutatieOhw} excel={r.excel.nogTeFactExtern} na={r.bv === 'Holdings'} />
                        <DeltaCell app={r.app.totaalIC} excel={r.excel.nettoOmzetIc} na={r.bv === 'Holdings'} />
                        <DeltaCell app={r.app.mutatieVooruitgef} excel={r.excel.vooruitgefactureerd} na={r.bv !== 'Software'} />
                        <td
                          className="mono r"
                          style={{
                            color: deltaCellColor(r.delta.totaal),
                            fontSize: 11,
                            fontWeight: 600,
                            borderLeft: '1px solid var(--bd2)',
                            background: Math.abs(r.delta.totaal) > TOLERANCE ? 'rgba(255,193,7,0.04)' : undefined,
                          }}
                          title={`App-totaal: ${fmt(r.app.totaal ?? 0)}\nExcel-totaal (som): ${fmt(
                            (r.excel.nettoOmzetExtern ?? 0) +
                            (r.excel.nettoOmzetIc ?? 0) +
                            (r.excel.nogTeFactExtern ?? 0) +
                            (r.excel.vooruitgefactureerd ?? 0)
                          )}\nΔ: ${r.delta.totaal >= 0 ? '+' : ''}${fmt(r.delta.totaal)}`}
                        >
                          {r.delta.totaal >= 0 ? '+' : ''}{fmt(r.delta.totaal)}
                        </td>
                        <td style={{ fontSize: 11, textAlign: 'center' }}>
                          {r.hasMismatch ? (
                            <span title={`Bron: ${r.sourceFile}`} style={{ color: 'var(--amber)', cursor: 'help' }}>⚠</span>
                          ) : (
                            <span style={{ color: 'var(--green)' }}>✓</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 12, fontSize: 10, color: 'var(--t3)', lineHeight: 1.5 }}>
            <strong>Hint:</strong> Δ Factuurvolume corrigeer je in deze Maandafsluiting-invoer
            (Factuurvolume-veld). Δ Mutatie OHW, Δ Totaal IC en Δ Vooruitgefactureerd staan in
            de OHW Overzicht-tab (resp. Onderhanden-rijen, IC verrekening, Vooruitgefactureerd-rijen).
          </div>
        </div>
      )}
    </div>
  )
}
