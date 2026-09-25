// Leest de ingevulde "Ontbrekende tarieven invullijst.xlsx" (sheet Invullijst) en schrijft
// scripts/tarieven-aanvulling.json: per medewerker die niet in het HC-tarievenbestand staat
// het te gebruiken uurtarief + de bron ervan. gen-margin-data.mjs leest die JSON.
//
// Regels (afspraak Lars 25-09-2026):
//   - kolom I ingevuld            → dat tarief, bron 'ingevuld'
//   - bedrijf = S.L. (Spanje)     → €35/uur voor iedereen, bron 'spanje'
//   - anders                      → tarief null = schatting (mediaan van het bedrijf), bron 'geschat'
import xlsx from 'xlsx'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const XLS = process.argv[2] ?? path.join(ROOT, 'Ontbrekende tarieven invullijst.xlsx')
const SPANJE_TARIEF = 35
const DATUM = '25-09-2026'

const rows = xlsx.utils.sheet_to_json(xlsx.readFile(XLS).Sheets['Invullijst'], { header: 1, raw: true, defval: null })
const out = []
for (const r of rows.slice(1)) {
  if (typeof r?.[1] !== 'number' || String(r[0]).startsWith('VOORBEELD')) continue
  const [groep, id, naam, bedrijf, urenProd, , projecten, mediaan, ingevuld, opm] = r
  const spanje = /Spanje/i.test(String(bedrijf))
  let tarief, bron
  if (typeof ingevuld === 'number') { tarief = ingevuld; bron = 'ingevuld' }
  else if (spanje) { tarief = SPANJE_TARIEF; bron = 'spanje' }
  else { tarief = null; bron = 'geschat' }
  out.push({ id, naam, bedrijf, groep: groep.startsWith('A.') ? 'inhuur' : 'eigen', urenProductief: urenProd, projecten, tarief, bron, mediaanBedrijf: mediaan, opmerking: opm ?? undefined })
}
const json = {
  toelichting: [
    `Aanvulling op het HC-tarievenbestand (kostprijs+AK per uur) voor medewerkers die daar niet in staan; ingevuld door Lars op ${DATUM}.`,
    `bron 'ingevuld'  = tarief uit de invullijst (inhuur: inkooptarief; eigen: kostprijs+AK).`,
    `bron 'spanje'    = regel Lars ${DATUM}: alle S.L. (Spanje)-medewerkers €${SPANJE_TARIEF}/uur.`,
    `bron 'geschat'   = niet ingevuld; het model gebruikt de mediaan kostprijs+AK van het bedrijf (tarief null hier, zie MARGE_META.medianKostprijs).`,
    'Opnieuw genereren: node scripts/import-tarieven-invullijst.mjs [pad naar xlsx]',
  ],
  datum: DATUM, spanjeTarief: SPANJE_TARIEF, bronBestand: path.basename(XLS),
  medewerkers: out,
}
fs.writeFileSync(path.join(__dirname, 'tarieven-aanvulling.json'), JSON.stringify(json, null, 1))
const tel = {}; for (const m of out) tel[m.bron] = (tel[m.bron] ?? 0) + 1
console.log(`${out.length} medewerkers → scripts/tarieven-aanvulling.json`, tel)
