import { useEffect, useMemo, useState } from 'react'
import { useFinStore } from '../../store/useFinStore'
import { useFteStore } from '../../store/useFteStore'
import { useImportStore } from '../../store/useImportStore'
import { useOhwStore } from '../../store/useOhwStore'
import { useCostBreakdownStore } from '../../store/useCostBreakdownStore'
import type { ClosingBv } from '../../data/types'

interface ChecklistItem {
  key: string
  label: string
  description: string
  icon: string
  /** Auto-detect uit de stores. true=klaar, false=nog niet, null=geen auto-
   *  detect (handmatig vinkje vereist). De gebruiker mag een auto-detected
   *  item ook handmatig overrulen via de checkbox. */
  auto: boolean | null
  /** Voor import-items: het bestemmings-getal staat er wél (bv. handmatig
   *  ingevuld in OHW of closing-entry), maar het bron-bestand is niet
   *  geüpload. In dat geval mag de check groen, maar tonen we een soft-
   *  warning ("geen onderbouwing") i.p.v. de hard-warning ("data lijkt
   *  niet ingevuld"). */
  manualOnly?: boolean
  /** Required = blokkeert "definitief afsluiten" tot dit item klaar is. */
  required: boolean
  /** In welk stappen-groep hoort het — bepaalt de section-header en volgorde. */
  group: GroupId
}

type GroupId = 'omzet' | 'missing_ic' | 'ohw_manual' | 'ic_verrekening' | 'kosten' | 'fte' | 'extra'

interface GroupDef {
  id: GroupId
  step: number | null   // null = optionele groep zonder stapnummer
  title: string
  subtitle: string
  /** Tellen items in deze groep mee als verplicht voor finaliseren? */
  countsForFinalize: boolean
}

const GROUPS: GroupDef[] = [
  { id: 'omzet',          step: 1,    title: 'Omzet importeren',         subtitle: 'Factuurvolume, NTF Uren, D-Lijst, Conceptfacturen, OHW Excel — vult de OHW-regels en factuurvolume per BV', countsForFinalize: true },
  { id: 'missing_ic',     step: 2,    title: 'Missing Hours + IC Tarieven', subtitle: 'Missing Hours import (Consultancy) + verificatie van IC-tarieven die ervoor gebruikt worden', countsForFinalize: true },
  { id: 'ohw_manual',     step: 3,    title: 'OHW Overzicht aanvullen',  subtitle: 'Niet-vergrendelde rijen handmatig invullen waar nodig (accruals, openstaande posten)', countsForFinalize: true },
  { id: 'ic_verrekening', step: 4,    title: 'IC verrekeningen',         subtitle: 'IC-verrekeningsrijen in OHW Overzicht voor deze maand invullen', countsForFinalize: true },
  { id: 'kosten',         step: 5,    title: 'Kostenposten invullen',    subtitle: 'Directe kosten / operationele kosten / amortisatie — via overrides of kosten-specificaties', countsForFinalize: true },
  { id: 'fte',            step: 6,    title: 'FTE & Headcount',          subtitle: 'Aantallen per BV in de FTE-tab — basis voor capaciteits- en LE-forecast', countsForFinalize: true },
  { id: 'extra',          step: null, title: 'Extra inzicht (optioneel)', subtitle: 'Niet vereist voor de Maandafsluiting — geeft wel meer detail in het Uren Dashboard', countsForFinalize: false },
]

interface Props {
  month: string
  /** Email van de huidige user (voor finalized_by registratie). */
  currentUserEmail: string | null
  /** Callback om een toast te tonen. */
  showToast: (msg: string, type?: 'g' | 'r') => void
}

const BVS: ClosingBv[] = ['Consultancy', 'Projects', 'Software', 'Holdings']

export function MaandChecklist({ month, currentUserEmail, showToast }: Props) {
  const importRecords = useImportStore(s => s.records)
  const fteEntries    = useFteStore(s => s.entries)
  const ohwData2026   = useOhwStore(s => s.data2026)
  const breakdowns    = useCostBreakdownStore(s => s.entries)
  const closingEntries = useFinStore(s => s.entries)
  const isMonthFinalized = useFinStore(s => s.isMonthFinalized)
  const getFinalized   = useFinStore(s => s.getFinalized)
  const finalizeMonth  = useFinStore(s => s.finalizeMonth)
  const unfinalizeMonth = useFinStore(s => s.unfinalizeMonth)

  const finalized = isMonthFinalized(month)
  const finalRecord = getFinalized(month)

  // Manuele override-state per item (wat de gebruiker zelf afgevinkt heeft).
  // Bij wisselen van maand resetten we naar finalRecord.checklist (snapshot
  // op moment van finaliseren) of leeg.
  const [manual, setManual] = useState<Record<string, boolean>>({})
  useEffect(() => {
    setManual(finalRecord?.checklist ?? {})
  }, [month, finalRecord?.month])

  // ── Auto-detectie per checklist-item ──────────────────────────────────
  const slotApproved = (slotId: string): boolean =>
    importRecords.some(r => r.month === month && r.slotId === slotId && r.status === 'approved')

  /** Voor elk import-slot: heeft de bestemmings-rij (in OHW of closing-entry)
   *  voor deze maand een handmatig ingevulde waarde? Wordt gebruikt om een
   *  "soft warning"-status te bepalen: bestand niet geüpload, maar getal staat
   *  er wel manueel in → check mag op groen, maar gebruiker krijgt melding
   *  dat de onderbouwing (= het bron-bestand) ontbreekt. */
  const hasManualValueForSlot = (slotId: string): boolean => {
    // Helper voor OHW-rij-lookup over alle entities.
    const ohwRowHasValue = (rowId: string, entity?: string): boolean => {
      for (const ent of ohwData2026.entities ?? []) {
        if (entity && ent.entity !== entity) continue
        for (const sec of ent.onderhanden ?? []) {
          const r = sec.rows.find(x => x.id === rowId)
          if (r && (r.values?.[month] ?? 0) !== 0) return true
        }
      }
      return false
    }
    switch (slotId) {
      case 'factuurvolume':
        return closingEntries.some(e => e.month === month && (e.factuurvolume ?? 0) !== 0)
      case 'uren_lijst':
        return ohwRowHasValue('c_ul', 'Consultancy') || ohwRowHasValue('p1', 'Projects') || ohwRowHasValue('s_ul', 'Software')
      case 'd_lijst':
        return ohwRowHasValue('c1', 'Consultancy')
      case 'conceptfacturen':
        return ohwRowHasValue('p4', 'Projects')
      case 'missing_hours':
        return ohwRowHasValue('c4', 'Consultancy')
      case 'ohw':
        return ohwRowHasValue('p10', 'Projects')
      case 'geschreven_uren':
      case 'uren_facturering_totaal':
        return false  // alleen via upload, geen handmatige bestemmings-rij
      default:
        return false
    }
  }

  const fteFilledCount = useMemo(() => {
    return BVS.filter(bv => bv !== 'Holdings').filter(bv => {
      const e = fteEntries.find(x => x.bv === bv && x.month === month)
      return !!e && (e.fte ?? 0) > 0 && (e.headcount ?? 0) > 0
    }).length
  }, [fteEntries, month])
  const fteRequired = 3  // Consultancy, Projects, Software (Holdings heeft geen FTE-flow)

  /** Heeft de OHW-tab handmatig ingevoerde (niet-locked) waarden voor deze
   *  maand? Detectie: zoek naar non-null waardes in editable rijen. */
  const ohwManualCount = useMemo(() => {
    let count = 0
    for (const ent of ohwData2026.entities ?? []) {
      for (const sec of ent.onderhanden ?? []) {
        for (const row of sec.rows) {
          if (row.locked) continue
          const v = row.values?.[month]
          if (v !== null && v !== undefined && v !== 0) count++
        }
      }
    }
    return count
  }, [ohwData2026, month])

  /** IC-verrekeningen ingevuld voor deze maand? */
  const icFilled = useMemo(() => {
    let any = false
    for (const ent of ohwData2026.entities ?? []) {
      for (const row of ent.icVerrekening ?? []) {
        const v = row.values?.[month]
        if (v !== null && v !== undefined && v !== 0) { any = true; break }
      }
      if (any) break
    }
    return any
  }, [ohwData2026, month])

  /** Kostenposten ingevuld? Closing-entry kostenOverrides óf cost-breakdowns. */
  const kostenFilled = useMemo(() => {
    const hasOverrides = closingEntries.some(e =>
      e.month === month && Object.keys(e.kostenOverrides ?? {}).length > 0
    )
    const hasBreakdowns = breakdowns.some(b => b.month === month)
    return hasOverrides || hasBreakdowns
  }, [closingEntries, breakdowns, month])

  /** Heeft deze maand een Missing Hours upload? (impliceert dat IC-tarieven
   *  relevant zijn — anders is de check niet van toepassing.) */
  const hasMissingHours = slotApproved('missing_hours')

  // ── Checklist-items in stap-volgorde ───────────────────────────────────
  const items: ChecklistItem[] = [
    // ── Stap 1: Omzet importeren ────────────────────────────────────────
    { key: 'imp_factuurvolume', group: 'omzet', label: 'Factuurvolume',                  icon: '🧾', description: 'SAP facturenlijst — gefactureerde omzet per BV', auto: slotApproved('factuurvolume'), manualOnly: !slotApproved('factuurvolume') && hasManualValueForSlot('factuurvolume'), required: true },
    { key: 'imp_ntf',           group: 'omzet', label: 'NTF Uren',                       icon: '📋', description: 'Nog Te Factureren netto waarde per BV → OHW (regel "U-Projecten met tarief")', auto: slotApproved('uren_lijst'), manualOnly: !slotApproved('uren_lijst') && hasManualValueForSlot('uren_lijst'), required: true },
    { key: 'imp_d_lijst',       group: 'omzet', label: 'D-Lijst (Consultancy)',          icon: '📊', description: 'Vult OHW-regel "D facturatie" voor Consultancy', auto: slotApproved('d_lijst'), manualOnly: !slotApproved('d_lijst') && hasManualValueForSlot('d_lijst'), required: true },
    { key: 'imp_concept',       group: 'omzet', label: 'Conceptfacturen (Projects)',     icon: '📄', description: 'Vult OHW-regel "E-Projecten conceptfacturen" voor Projects', auto: slotApproved('conceptfacturen'), manualOnly: !slotApproved('conceptfacturen') && hasManualValueForSlot('conceptfacturen'), required: true },
    { key: 'imp_ohw',           group: 'omzet', label: 'OHW Excel (Projects)',           icon: '🏗', description: 'Vult OHW-regel "Onderhanden projecten (OHW Excel)"', auto: slotApproved('ohw'), manualOnly: !slotApproved('ohw') && hasManualValueForSlot('ohw'), required: true },

    // ── Stap 2: Missing Hours + IC Tarieven ─────────────────────────────
    // De IC-tarieven worden gebruikt door de Missing Hours-berekening
    // (uren × tarief × 0,9). Daarom zit deze controle direct na de import.
    { key: 'imp_missing',       group: 'missing_ic', label: 'Missing Hours geïmporteerd (Consultancy)', icon: '⚠',  description: 'Berekent missing hours × tarief × 0,9 → OHW Consultancy', auto: hasMissingHours, manualOnly: !hasMissingHours && hasManualValueForSlot('missing_hours'), required: true },
    { key: 'ic_tarieven',       group: 'missing_ic', label: 'IC Tarieven gecontroleerd',                 icon: '💼', description: 'Loop de IC-tarieven (uurtarief × FTE) na in de IC Tarieven-tab — die zijn de basis voor de Missing Hours-berekening van zojuist', auto: null, required: hasMissingHours },

    // ── Stap 3: OHW Overzicht handmatig aanvullen ───────────────────────
    { key: 'ohw_handmatig',     group: 'ohw_manual', label: 'OHW Overzicht handmatig aangevuld', icon: '🏗', description: `Niet-vergrendelde rijen in het OHW Overzicht voor ${month} — accruals, openstaande posten, etc. (${ohwManualCount} cellen ingevuld)`, auto: ohwManualCount > 0, required: true },

    // ── Stap 4: IC verrekeningen ────────────────────────────────────────
    { key: 'ic_verrekening',    group: 'ic_verrekening', label: 'IC verrekeningen ingevuld', icon: '🔁', description: 'IC-verrekeningsrijen in het OHW Overzicht voor deze maand invullen — bepaalt netto-omzet per BV vóór en na IC', auto: icFilled, required: true },

    // ── Stap 5: Kostenposten ────────────────────────────────────────────
    { key: 'kostenposten',      group: 'kosten', label: 'Kostenposten ingevuld', icon: '💸', description: 'Directe kosten / operationele kosten / amortisatie via kosten-overrides óf kosten-specificaties', auto: kostenFilled, required: true },

    // ── Stap 6: FTE & Headcount ─────────────────────────────────────────
    { key: 'fte_headcount',     group: 'fte', label: `FTE & Headcount ingevuld (${fteFilledCount}/${fteRequired})`, icon: '👥', description: 'Consultancy, Projects en Software — alle drie BVs in de FTE & Headcount-tab. Wordt gebruikt voor LE-forecast (FTE-ramp).', auto: fteFilledCount >= fteRequired, required: true },

    // ── Optioneel: extra inzicht (niet vereist voor Maandafsluiting) ────
    { key: 'imp_geschreven',    group: 'extra', label: 'Geschreven uren YTD',                 icon: '⏱',  description: 'SAP urenregistratie YTD — declarabel/intern/verlof per BV. Geen onderdeel van de Maandafsluiting maar geeft wel inzicht in het Uren Dashboard.', auto: slotApproved('geschreven_uren'), required: false },
    { key: 'imp_uren_fact',     group: 'extra', label: 'Uren Facturering Totaal (Consultancy)', icon: '💶', description: 'Alleen Consultancy — TOTALE facturatiewaarde per maand → "Waarde Declarabel" in Uren Analyse. Geen onderdeel van de Maandafsluiting maar geeft wel extra detail in het Uren Dashboard.', auto: slotApproved('uren_facturering_totaal'), required: false },
  ]

  // Effective state per item: handmatig vink overruled auto-detect.
  const effectiveDone = (item: ChecklistItem): boolean => {
    if (manual[item.key] !== undefined) return manual[item.key]
    return item.auto === true
  }

  const requiredItems = items.filter(i => i.required)
  const requiredDone  = requiredItems.filter(effectiveDone).length
  const allRequiredOk = requiredDone === requiredItems.length
  const totalDone     = items.filter(effectiveDone).length

  // Helper-tekstjes voor de "data lijkt niet klaar"-waarschuwing per item.
  // Sluiten aan bij de auto-detect die false geeft, met concrete uitleg
  // wáár de gebruiker iets mist (geen import / geen ingevulde waarden).
  const getMissingDataReason = (item: ChecklistItem): string | null => {
    switch (item.key) {
      case 'imp_factuurvolume':
        return slotApproved('factuurvolume') ? null : 'Geen goedgekeurd factuurvolume-bestand voor deze maand gevonden — upload + keur het bestand goed in "Bestanden importeren".'
      case 'imp_ntf':
        return slotApproved('uren_lijst') ? null : 'Geen goedgekeurde NTF Uren-import voor deze maand gevonden.'
      case 'imp_d_lijst':
        return slotApproved('d_lijst') ? null : 'Geen goedgekeurde D-Lijst-import (Consultancy) voor deze maand gevonden.'
      case 'imp_concept':
        return slotApproved('conceptfacturen') ? null : 'Geen goedgekeurde Conceptfacturen-import (Projects) voor deze maand gevonden.'
      case 'imp_ohw':
        return slotApproved('ohw') ? null : 'Geen goedgekeurde OHW Excel-import (Projects) voor deze maand gevonden.'
      case 'imp_missing':
        return hasMissingHours ? null : 'Geen goedgekeurde Missing Hours-import (Consultancy) voor deze maand gevonden.'
      case 'imp_geschreven':
        return slotApproved('geschreven_uren') ? null : 'Geen Geschreven uren YTD-import voor deze maand gevonden — optioneel, alleen voor Uren Dashboard inzicht.'
      case 'imp_uren_fact':
        return slotApproved('uren_facturering_totaal') ? null : 'Geen Uren Facturering Totaal-import (Consultancy) voor deze maand gevonden — optioneel.'
      case 'fte_headcount':
        if (fteFilledCount >= fteRequired) return null
        return `FTE/Headcount nog niet voor alle BVs ingevuld (${fteFilledCount}/${fteRequired}). Vul de ontbrekende BVs in via de FTE & Headcount-tab.`
      case 'ohw_handmatig':
        return ohwManualCount > 0 ? null : `Geen handmatige cellen ingevuld in het OHW Overzicht voor ${month}.`
      case 'ic_verrekening':
        return icFilled ? null : 'Geen waarden ingevuld in de IC-verrekeningsrijen van het OHW Overzicht voor deze maand.'
      case 'kostenposten':
        return kostenFilled ? null : 'Geen kosten-overrides en geen kosten-specificaties voor deze maand — vul ze in op de Maandafsluiting-pagina of via de breakdown-knop.'
      // Manual-only items (auto=null) — geen data-check mogelijk.
      case 'ic_tarieven':
        return null
      default:
        return null
    }
  }

  // ── Acties ─────────────────────────────────────────────────────────────
  const toggleItem = (key: string) => {
    if (finalized) return
    const item = items.find(i => i.key === key)
    if (!item) return
    const cur  = manual[key] !== undefined ? manual[key] : item.auto === true
    const next = !cur

    // Waarschuwing bij handmatig afvinken zonder bestand.
    // Twee niveaus:
    //  - Soft: getal staat er wél manueel, maar er is geen bron-bestand
    //          geüpload (manualOnly=true). De check mag groen, maar we
    //          melden expliciet dat de onderbouwing ontbreekt.
    //  - Hard: noch een bestand, noch handmatige data. De check werkt
    //          (gebruiker kan altijd overrulen), maar de toast is rood.
    if (next && item.auto === false) {
      if (item.manualOnly) {
        showToast(
          `⚠ "${item.label}" afgevinkt zonder onderbouwing — getal staat wel manueel ingevuld, maar er is géén bron-bestand voor ${month} geüpload. Controleer of je nog een bestand moet toevoegen.`,
          'r',
        )
      } else {
        const reason = getMissingDataReason(item)
        showToast(
          `⚠ "${item.label}" — ${reason ?? 'auto-detect zegt dat dit nog niet klaar is. Controleer de onderliggende data.'}`,
          'r',
        )
      }
    }

    setManual(prev => ({ ...prev, [key]: next }))
  }

  const handleFinalize = async () => {
    if (!allRequiredOk) {
      showToast('Niet alle verplichte items zijn afgevinkt — controleer de checklist', 'r')
      return
    }

    // Bij definitief afsluiten: scheid soft-mismatch (data wel handmatig in,
    // bestand niet geüpload) van hard-mismatch (helemaal niets ingevuld).
    // Soft = "geen onderbouwing"-melding, hard = "data lijkt niet ingevuld".
    const softMismatched = items.filter(i =>
      i.required && effectiveDone(i) && i.auto === false && i.manualOnly === true
    )
    const hardMismatched = items.filter(i =>
      i.required && effectiveDone(i) && i.auto === false && !i.manualOnly
    )
    let confirmMsg =
      `Maandafsluiting ${month} definitief maken?\n\n` +
      `Vanaf nu wordt ${month} overal in de Executive Overview behandeld als ` +
      `'actual' i.p.v. Latest Estimate. Dit kun je later weer ongedaan maken ` +
      `via "Heropenen".`
    if (hardMismatched.length > 0) {
      confirmMsg += `\n\n⚠ ${hardMismatched.length} item${hardMismatched.length === 1 ? '' : 's'} ` +
        `handmatig afgevinkt zónder dat de onderliggende data lijkt klaar te zijn:\n` +
        hardMismatched.map(i => `  • ${i.label} — ${getMissingDataReason(i) ?? '(check de data)'}`).join('\n')
    }
    if (softMismatched.length > 0) {
      confirmMsg += `\n\nⓘ ${softMismatched.length} item${softMismatched.length === 1 ? '' : 's'} ` +
        `wél handmatig ingevuld maar zonder bron-bestand (geen onderbouwing):\n` +
        softMismatched.map(i => `  • ${i.label}`).join('\n')
    }
    if (hardMismatched.length > 0 || softMismatched.length > 0) {
      confirmMsg += `\n\nWeet je zeker dat je doorgaat?`
    }
    if (!confirm(confirmMsg)) return
    try {
      const snapshot: Record<string, boolean> = {}
      for (const it of items) snapshot[it.key] = effectiveDone(it)
      await finalizeMonth(month, currentUserEmail ?? 'unknown', snapshot)
      showToast(`✓ ${month} is definitief afgesloten`, 'g')
    } catch (e) {
      showToast(`Afsluiten mislukt: ${e instanceof Error ? e.message : String(e)}`, 'r')
    }
  }

  const handleUnfinalize = async () => {
    if (!confirm(
      `Maandafsluiting ${month} heropenen?\n\n` +
      `${month} verschijnt dan weer als Latest Estimate in de Executive ` +
      `Overview. De checklist-snapshot blijft bewaard zodat je niet alles ` +
      `opnieuw hoeft af te vinken.`,
    )) return
    try {
      await unfinalizeMonth(month)
      showToast(`${month} is heropend — staat nu weer als LE in trends`, 'g')
    } catch (e) {
      showToast(`Heropenen mislukt: ${e instanceof Error ? e.message : String(e)}`, 'r')
    }
  }

  // Compact-modus: hover/focus toont de description als tooltip i.p.v. eronder,
  // zodat een rij maar 1 regel hoog is. De "details" toggle laat alle
  // beschrijvingen tegelijk zien voor een eenmalige doorlees-check.
  const [showDetails, setShowDetails] = useState(false)
  const stillToDo = items.filter(i => i.required && !effectiveDone(i)).length

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="card-hdr" style={{ borderBottom: '1px solid var(--bd)', padding: '8px 12px' }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>📋 Checklist {month}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12, flex: 1, flexWrap: 'wrap' }}>
          {/* Mini progress bar */}
          <div style={{ flex: '0 0 90px', height: 4, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden', minWidth: 60 }}>
            <div style={{
              width: `${requiredItems.length > 0 ? (requiredDone / requiredItems.length) * 100 : 0}%`,
              height: '100%',
              background: allRequiredOk ? 'var(--green)' : 'var(--amber)',
              transition: 'width .2s',
            }} />
          </div>
          <span style={{ fontSize: 10, color: 'var(--t3)' }}>
            <strong style={{ color: allRequiredOk ? 'var(--green)' : 'var(--amber)' }}>{requiredDone}/{requiredItems.length}</strong> verplicht · {totalDone}/{items.length} totaal
          </span>
        </div>
        <button
          className="btn sm ghost"
          onClick={() => setShowDetails(s => !s)}
          style={{ fontSize: 10, padding: '2px 8px' }}
        >
          {showDetails ? '▾ Compact' : '▸ Details'}
        </button>
        {finalized && (
          <span style={{
            marginLeft: 6, fontSize: 9, fontWeight: 700, padding: '2px 6px',
            background: 'var(--bd-green)', color: 'var(--green)',
            borderRadius: 3, border: '1px solid var(--green)',
          }}>
            ✓ DEFINITIEF
          </span>
        )}
        {!finalized ? (
          <button
            className="btn sm primary"
            onClick={handleFinalize}
            disabled={!allRequiredOk}
            title={allRequiredOk
              ? `Definitief afsluiten ${month} — Executive Overview gebruikt vanaf nu actuals i.p.v. LE`
              : `Nog ${stillToDo} verplicht${stillToDo === 1 ? '' : 'e'} item${stillToDo === 1 ? '' : 's'} af te vinken`}
            style={{ marginLeft: 6, fontSize: 11 }}
          >
            ✅ Definitief afsluiten
          </button>
        ) : (
          <button
            className="btn sm ghost"
            onClick={handleUnfinalize}
            style={{ marginLeft: 6, fontSize: 10, color: 'var(--amber)', borderColor: 'var(--amber)' }}
            title={`Heropen ${month} — schakelt terug naar Latest Estimate in alle trends`}
          >
            ⟲ Heropenen
          </button>
        )}
      </div>

      {finalized && finalRecord && (
        <div style={{
          padding: '6px 12px', fontSize: 10,
          background: 'rgba(38,201,151,0.06)', borderBottom: '1px solid var(--bd2)',
          color: 'var(--green)',
        }}>
          Afgesloten {new Date(finalRecord.finalizedAt).toLocaleString('nl-NL')}
          {finalRecord.finalizedBy && ` door ${finalRecord.finalizedBy}`} — Executive Overview gebruikt vanaf nu de werkelijke actuals voor {month}.
        </div>
      )}

      {/* Stappen — per groep een rij met stap-nummer + items naast elkaar.
          Elke groep heeft een eigen status-indicator (alle items klaar?) en
          een korte sub-uitleg. Optionele groep ('Extra inzicht') is visueel
          gescheiden onderaan. */}
      <div style={{ padding: '6px 10px 8px' }}>
        {GROUPS.map(group => {
          const groupItems = items.filter(i => i.group === group.id)
          if (groupItems.length === 0) return null
          const groupRequired = groupItems.filter(i => i.required)
          const groupRequiredDone = groupRequired.filter(effectiveDone).length
          const groupAllDone = groupRequired.length === 0
            ? groupItems.every(effectiveDone)
            : groupRequiredDone === groupRequired.length
          const isOptional = !group.countsForFinalize

          return (
            <div key={group.id} style={{ marginTop: 8 }}>
              {/* Stap-header: nummer-bol + titel + status */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                marginBottom: 4,
                opacity: isOptional ? 0.85 : 1,
              }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: isOptional ? 'var(--bg3)' : (groupAllDone ? 'var(--green)' : 'var(--bg3)'),
                  color: isOptional ? 'var(--t3)' : (groupAllDone ? '#fff' : 'var(--t2)'),
                  border: `1px solid ${isOptional ? 'var(--bd2)' : (groupAllDone ? 'var(--green)' : 'var(--bd2)')}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, flexShrink: 0,
                }}>
                  {group.step != null ? (groupAllDone ? '✓' : group.step) : '∗'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {group.title}
                    {isOptional && (
                      <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--bg3)', color: 'var(--t3)', fontWeight: 600 }}>
                        optioneel
                      </span>
                    )}
                    {!isOptional && groupRequired.length > 0 && (
                      <span style={{ fontSize: 9, color: groupAllDone ? 'var(--green)' : 'var(--t3)', fontWeight: 500 }}>
                        {groupRequiredDone}/{groupRequired.length}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--t3)', lineHeight: 1.3 }}>
                    {group.subtitle}
                  </div>
                </div>
              </div>

              {/* Items in deze stap — compacte twee-kolom grid, ingesprongen */}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 4,
                marginLeft: 30,
              }}>
                {groupItems.map(item => {
                  const done = effectiveDone(item)
                  const isAuto = item.auto !== null
                  // Twee niveaus van mismatch wanneer de gebruiker handmatig
                  // afvinkt terwijl auto-detect het bron-bestand niet ziet:
                  //  - softMismatch: getal staat wél manueel ingevuld → oranje
                  //    rand + ⓘ-icoon. "Geen onderbouwing" warning.
                  //  - hardMismatch: noch bestand noch data → rode rand + ⚠.
                  //    "Data lijkt niet ingevuld" warning.
                  const softMismatch = done && item.auto === false && item.manualOnly === true
                  const hardMismatch = done && item.auto === false && !item.manualOnly
                  const mismatchReason = hardMismatch ? getMissingDataReason(item) : null
                  return (
                    <div
                      key={item.key}
                      role="button"
                      tabIndex={finalized ? -1 : 0}
                      onClick={() => toggleItem(item.key)}
                      onKeyDown={e => {
                        if (finalized) return
                        if (e.key === ' ' || e.key === 'Enter') {
                          e.preventDefault()
                          toggleItem(item.key)
                        }
                      }}
                      title={
                        hardMismatch ? `⚠ ${mismatchReason}\n\n${item.description}`
                        : softMismatch ? `ⓘ Geen onderbouwing — getal staat wel manueel ingevuld, maar het bron-bestand voor ${month} is niet geüpload.\n\n${item.description}`
                        : item.description
                      }
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '4px 8px', borderRadius: 5,
                        cursor: finalized ? 'default' : 'pointer',
                        background: hardMismatch
                          ? 'rgba(239,83,80,0.08)'
                          : softMismatch
                            ? 'rgba(245,166,35,0.08)'
                            : (done ? 'rgba(38,201,151,0.06)' : 'transparent'),
                        border: `1px solid ${
                          hardMismatch ? 'var(--red)'
                          : softMismatch ? 'var(--amber)'
                          : (done ? 'var(--green)' : 'var(--bd2)')
                        }`,
                        opacity: finalized ? 0.85 : 1,
                        transition: 'background .12s, border-color .12s',
                        minHeight: 26,
                        userSelect: 'none',
                        outline: 'none',
                      }}
                    >
                      {/* Custom checkbox-visual zodat klikken op de hele tegel
                          werkt (een echte <input> reageert anders alleen op
                          de checkbox zelf, en readOnly+disabled gedrag
                          verschilt per browser). */}
                      <span
                        aria-checked={done}
                        role="checkbox"
                        style={{
                          width: 14, height: 14, borderRadius: 3,
                          border: `1.5px solid ${done ? 'var(--green)' : 'var(--bd2)'}`,
                          background: done ? 'var(--green)' : 'transparent',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                          transition: 'background .12s, border-color .12s',
                        }}
                      >
                        {done && (
                          <span style={{ color: '#fff', fontSize: 10, fontWeight: 900, lineHeight: 1 }}>✓</span>
                        )}
                      </span>
                      <span style={{ fontSize: 13, flexShrink: 0 }}>{item.icon}</span>
                      <span style={{
                        fontSize: 11, fontWeight: 500,
                        color: hardMismatch ? 'var(--red)'
                          : softMismatch ? 'var(--amber)'
                          : (done ? 'var(--green)' : 'var(--t1)'),
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        flex: 1, minWidth: 0,
                      }}>{item.label}</span>
                      {hardMismatch && (
                        <span
                          title={mismatchReason ?? 'Auto-detect zegt dat deze stap nog niet klaar is — gecontroleerd met de onderliggende data.'}
                          style={{ fontSize: 11, color: 'var(--red)', flexShrink: 0, lineHeight: 1 }}
                        >
                          ⚠
                        </span>
                      )}
                      {softMismatch && (
                        <span
                          title={`Geen onderbouwing — getal staat wel manueel ingevuld, maar het bron-bestand voor ${month} is niet geüpload.`}
                          style={{ fontSize: 11, color: 'var(--amber)', flexShrink: 0, lineHeight: 1 }}
                        >
                          ⓘ
                        </span>
                      )}
                      {item.required && (
                        <span style={{ fontSize: 8, padding: '0 4px', borderRadius: 2, background: 'var(--bd-amber)', color: 'var(--amber)', fontWeight: 700, flexShrink: 0 }}>
                          !
                        </span>
                      )}
                      {isAuto && (
                        <span
                          title="Auto-detect — volgt de data automatisch, je mag handmatig overrulen"
                          style={{ fontSize: 8, padding: '0 4px', borderRadius: 2, background: 'var(--bd-blue)', color: 'var(--blue)', fontWeight: 700, flexShrink: 0 }}
                        >
                          auto
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {showDetails && (
        <div style={{ padding: '4px 12px 10px', fontSize: 10, color: 'var(--t3)', borderTop: '1px solid var(--bd2)' }}>
          {GROUPS.map(group => {
            const groupItems = items.filter(i => i.group === group.id)
            if (groupItems.length === 0) return null
            return (
              <div key={group.id} style={{ marginTop: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 2 }}>
                  {group.step != null ? `Stap ${group.step} — ` : ''}{group.title}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '2px 12px', marginLeft: 8 }}>
                  {groupItems.map(item => (
                    <div key={item.key} style={{ display: 'flex', gap: 6, lineHeight: 1.4 }}>
                      <span style={{ flexShrink: 0 }}>{item.icon}</span>
                      <span><strong style={{ color: 'var(--t2)' }}>{item.label}:</strong> {item.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
