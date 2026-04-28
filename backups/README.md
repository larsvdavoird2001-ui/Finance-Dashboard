# Supabase backups

Deze map wordt automatisch gevuld door de GitHub Action
[`backup-supabase.yml`](../.github/workflows/backup-supabase.yml).

## Structuur

```
backups/
  LATEST.json                          # wijst altijd naar de meest recente
  YYYY-MM-DD/
    YYYY-MM-DD-HH-MM-SS.json          # één snapshot per run
```

Elke snapshot bevat alle Supabase-tabellen als JSON:

```json
{
  "exportedAt": "2026-04-28T12:00:00.000Z",
  "totalRows": 532,
  "tables": {
    "closing_entries":  [...],
    "fte_entries":      [...],
    "ohw_entities":     [...],
    "budget_overrides": [...],
    "import_records":   [...],
    ...
  }
}
```

## Wanneer wordt er een nieuwe versie gemaakt?

- **Automatisch** elke 6 uur (cron `0 */6 * * *` UTC)
- **Handmatig** via GitHub → Actions tab → "Supabase data backup" → "Run workflow"
- **Bij code-wijzigingen** aan het backup-script of de workflow zelf

Een commit wordt alleen gemaakt als er daadwerkelijk wijzigingen in de data
zijn — geen lege commits.

## Een specifieke backup terugzetten

1. Vind de gewenste backup in `backups/<datum>/`
2. Open in de TPG Finance app het **`💾 Backups`** paneel
3. Klik **`↑ Import .json`** en kies het bestand uit deze map (na lokaal
   downloaden via GitHub UI)

Of direct via SQL — bv. één tabel terugzetten:

```sql
-- Voorbeeld: alle budget_overrides terugzetten naar 28-04-2026 12:00
TRUNCATE budget_overrides;
-- Daarna zelf INSERT genereren uit de JSON
```

## Setup (eenmalig)

In GitHub → Settings → Secrets and variables → Actions → New repository secret:

| Secret naam            | Waarde                                                     |
|------------------------|------------------------------------------------------------|
| `SUPABASE_URL`         | `https://<jouw-project>.supabase.co`                       |
| `SUPABASE_SERVICE_ROLE`| `eyJ...` (Project Settings → API → service_role key)       |

⚠ **De service-role key bypasses RLS** — bewaar 'm alleen als GitHub Secret,
nooit in code of frontend.

Daarna éénmaal handmatig triggeren via "Run workflow" om te testen.
