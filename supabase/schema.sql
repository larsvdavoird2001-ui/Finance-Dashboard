-- ============================================================================
-- TPG Finance Dashboard — Supabase Schema
-- Voer dit uit in de Supabase SQL Editor (https://supabase.com/dashboard)
-- ============================================================================

-- 1. Maandafsluiting per BV per maand
CREATE TABLE IF NOT EXISTS closing_entries (
  id text PRIMARY KEY,
  bv text NOT NULL CHECK (bv IN ('Consultancy', 'Projects', 'Software')),
  month text NOT NULL,
  factuurvolume numeric DEFAULT 0,
  debiteuren numeric DEFAULT 0,
  ohw_mutatie numeric DEFAULT 0,
  kostencorrectie numeric DEFAULT 0,
  accruals numeric DEFAULT 0,
  handmatige_correctie numeric DEFAULT 0,
  operationele_kosten numeric DEFAULT 0,
  amortisatie_afschrijvingen numeric DEFAULT 0,
  kosten_overrides jsonb DEFAULT '{}',
  remark text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(bv, month)
);

-- 2. FTE & headcount per BV per maand
CREATE TABLE IF NOT EXISTS fte_entries (
  id text PRIMARY KEY,
  bv text NOT NULL CHECK (bv IN ('Consultancy', 'Projects', 'Software')),
  month text NOT NULL,
  fte numeric DEFAULT 0,
  headcount integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(bv, month)
);

-- 3. Import records — bestandsimport tracking
CREATE TABLE IF NOT EXISTS import_records (
  id text PRIMARY KEY,
  slot_id text NOT NULL,
  slot_label text NOT NULL,
  month text NOT NULL,
  file_name text NOT NULL,
  uploaded_at text NOT NULL,
  per_bv jsonb DEFAULT '{}',
  total_amount numeric DEFAULT 0,
  row_count integer DEFAULT 0,
  parsed_count integer DEFAULT 0,
  skipped_count integer DEFAULT 0,
  detected_amount_col text DEFAULT '',
  detected_bv_col text DEFAULT '',
  headers jsonb DEFAULT '[]',
  preview jsonb DEFAULT '[]',
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason text,
  created_at timestamptz DEFAULT now()
);

-- 4. Ruwe importdata — rijen uit geüploade bestanden (voor onderbouwing)
CREATE TABLE IF NOT EXISTS import_raw_data (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id text NOT NULL REFERENCES import_records(id) ON DELETE CASCADE,
  slot_id text NOT NULL,
  slot_label text NOT NULL,
  month text NOT NULL,
  file_name text NOT NULL,
  uploaded_at text NOT NULL,
  rows jsonb DEFAULT '[]',
  amount_col text DEFAULT '',
  bv_col text DEFAULT '',
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

-- 5. OHW entiteiten — volledige entity data als JSON document (per jaar per BV)
--    Slaat de complete OhwEntityData op inclusief onderhanden, IC, budget, etc.
CREATE TABLE IF NOT EXISTS ohw_entities (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  year text NOT NULL CHECK (year IN ('2025', '2026')),
  entity text NOT NULL CHECK (entity IN ('Consultancy', 'Projects', 'Software')),
  data jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz DEFAULT now(),
  UNIQUE(year, entity)
);

-- 6. Budget overrides — per BV per maand per P&L-key, voor Budgetten tab
CREATE TABLE IF NOT EXISTS budget_overrides (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity text NOT NULL CHECK (entity IN ('Consultancy', 'Projects', 'Software', 'Holdings')),
  month text NOT NULL,
  pl_key text NOT NULL,
  value numeric NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(entity, month, pl_key)
);

-- 7. Closing archives — snapshots van afgeronde maandafsluitingen
--    Elke archive bevat een JSON-document met de volledige staat op moment
--    van afsluiten: ClosingEntry, OHW data, goedgekeurde imports, metadata.
--    Gebruikt voor ZIP-export + PowerPoint rapportage.
CREATE TABLE IF NOT EXISTS closing_archives (
  id text PRIMARY KEY,            -- bijv. "2026-03"
  month text NOT NULL UNIQUE,     -- "Mar-26"
  year text NOT NULL,             -- "2026"
  closed_at timestamptz DEFAULT now(),
  closed_by text,                 -- optioneel: email/naam van de gebruiker
  snapshot jsonb NOT NULL DEFAULT '{}',  -- volledige maand-staat
  summary_metrics jsonb DEFAULT '{}',    -- KPIs: omzet per BV, marge, EBITDA, OHW
  remark text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 8. OHW-bijlages — uploaded onderbouwings-bestanden gekoppeld aan een
--    OHW-rij (voor audit-trail van saldi en handmatige correcties).
--    file_data bevat de base64-encoded inhoud; limit ~ 10MB per bestand.
CREATE TABLE IF NOT EXISTS ohw_evidence (
  id text PRIMARY KEY,
  month text NOT NULL,
  entity text NOT NULL CHECK (entity IN ('Consultancy', 'Projects', 'Software', 'Holdings')),
  ohw_row_id text NOT NULL,
  file_name text NOT NULL,
  mime_type text DEFAULT 'application/octet-stream',
  file_size integer DEFAULT 0,
  file_data text NOT NULL DEFAULT '',   -- base64 encoded
  description text DEFAULT '',
  uploaded_at text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 9b. User profiles — administratie van uitgenodigde gebruikers + rol
--     Wordt gebruikt door de admin om gebruikers toe te voegen aan de app.
--     De daadwerkelijke wachtwoorden worden door Supabase Auth beheerd
--     (auth.users); deze tabel houdt alleen email, rol en uitnodiging-status bij.
CREATE TABLE IF NOT EXISTS user_profiles (
  email text PRIMARY KEY,
  -- 4-niveau rol-systeem (zie src/lib/permissions.ts):
  --   viewer   = alleen-lezen
  --   editor   = financiële administratie (invullen, geen goedkeuring)
  --   approver = controller / CFO (goedkeuren + definitief afsluiten)
  --   admin    = beheer + alle approver-rechten
  -- Legacy 'user' wordt door de app gemapt naar 'viewer' bij read.
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer','editor','approver','admin','user')),
  active boolean NOT NULL DEFAULT true,
  -- True voor net-uitgenodigde users die nog hun wachtwoord moeten instellen.
  -- App toont alleen aan deze users de SetPasswordPage. Wordt false gezet zodra
  -- de user een wachtwoord opslaat.
  needs_password boolean NOT NULL DEFAULT false,
  invited_by text DEFAULT '',
  invited_at timestamptz DEFAULT now(),
  last_sign_in timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
-- Migratie voor bestaande projecten: voeg de kolom toe als die ontbreekt.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS needs_password boolean NOT NULL DEFAULT false;
-- BV-toewijzing per gebruiker. NULL = geen restrictie (admin/algemeen).
-- Een ingestelde BV beperkt de gebruiker tot data van die BV (Consultancy /
-- Projects / Software / Holdings). De filter wordt afgedwongen in de UI.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS bv text
  CHECK (bv IS NULL OR bv IN ('Consultancy','Projects','Software','Holdings'));

-- Migratie voor bestaande databases: het oude CHECK kende alleen 'admin'/'user'.
-- We gooien hem opnieuw zodat de 4-niveau-rollen geaccepteerd worden. Bestaande
-- 'user'-rijen blijven geldig (we accepteren 'user' als legacy-alias).
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('viewer','editor','approver','admin','user'));

-- 9. IC Tarieven — uurtarieven per medewerker (voor missing hours berekening)
CREATE TABLE IF NOT EXISTS tariff_entries (
  id text PRIMARY KEY,                -- werknemer ID
  bedrijf text DEFAULT '',
  naam text DEFAULT '',
  powerbi_naam text DEFAULT '',
  stroming text DEFAULT '',
  tarief numeric DEFAULT 0,           -- actueel uurtarief (2026)
  tarief_2025 numeric,                -- vorig uurtarief (2025), null = onbekend
  fte numeric,
  functie text DEFAULT '',
  leiding_gevende text DEFAULT '',
  manager text DEFAULT '',
  powerbi_naam2 text DEFAULT '',
  team text DEFAULT '',
  vertical text DEFAULT '',           -- handmatige vertical-override
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
-- Migratie voor bestaande databases (kolommen toegevoegd 2026-05):
ALTER TABLE tariff_entries ADD COLUMN IF NOT EXISTS tarief_2025 numeric;
ALTER TABLE tariff_entries ADD COLUMN IF NOT EXISTS vertical text DEFAULT '';

-- ============================================================================
-- Row Level Security (RLS) — open voor anonieme toegang (intern dashboard)
-- ============================================================================
ALTER TABLE closing_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE fte_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_raw_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE ohw_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariff_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE closing_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE ohw_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Policies: volledige lees/schrijf-toegang voor iedereen (aanpassen als auth nodig is)
CREATE POLICY "Allow all on closing_entries" ON closing_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on fte_entries" ON fte_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on import_records" ON import_records FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on import_raw_data" ON import_raw_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on ohw_entities" ON ohw_entities FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on tariff_entries" ON tariff_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on budget_overrides" ON budget_overrides FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on closing_archives" ON closing_archives FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on ohw_evidence" ON ohw_evidence FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on user_profiles" ON user_profiles FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- Indexes voor snelle queries
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_closing_bv_month ON closing_entries(bv, month);
CREATE INDEX IF NOT EXISTS idx_fte_bv_month ON fte_entries(bv, month);
CREATE INDEX IF NOT EXISTS idx_import_month ON import_records(month);
CREATE INDEX IF NOT EXISTS idx_import_status ON import_records(status);
CREATE INDEX IF NOT EXISTS idx_raw_record ON import_raw_data(record_id);
CREATE INDEX IF NOT EXISTS idx_ohw_year_entity ON ohw_entities(year, entity);
CREATE INDEX IF NOT EXISTS idx_tariff_bedrijf ON tariff_entries(bedrijf);
CREATE INDEX IF NOT EXISTS idx_budget_entity_month ON budget_overrides(entity, month);
CREATE INDEX IF NOT EXISTS idx_closing_archive_month ON closing_archives(month);
CREATE INDEX IF NOT EXISTS idx_ohw_evidence_row ON ohw_evidence(entity, ohw_row_id);
CREATE INDEX IF NOT EXISTS idx_ohw_evidence_month ON ohw_evidence(month);

-- ============================================================================
-- updated_at trigger — automatisch bijwerken bij UPDATE
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_closing_updated
  BEFORE UPDATE ON closing_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_fte_updated
  BEFORE UPDATE ON fte_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_ohw_updated
  BEFORE UPDATE ON ohw_entities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_tariff_updated
  BEFORE UPDATE ON tariff_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_budget_overrides_updated
  BEFORE UPDATE ON budget_overrides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_closing_archives_updated
  BEFORE UPDATE ON closing_archives
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_user_profiles_updated
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- Cascade-delete naar auth.users
-- Wanneer een rij wordt verwijderd uit public.user_profiles ruimen we ook de
-- bijbehorende auth.users-row op zodat de gebruiker niet meer kan inloggen
-- en het account volledig is verwijderd. SECURITY DEFINER omdat alleen de
-- postgres-rol DELETE-rechten op auth.users heeft.
-- ============================================================================
CREATE OR REPLACE FUNCTION delete_auth_user_on_profile_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Best-effort: het kan zijn dat de auth.users rij al niet (meer) bestaat,
  -- dan willen we de profile-delete sowieso laten slagen.
  BEGIN
    DELETE FROM auth.users WHERE lower(email) = lower(OLD.email);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Kon auth.users niet verwijderen voor %: %', OLD.email, SQLERRM;
  END;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_delete_auth_user_on_profile_delete ON public.user_profiles;
CREATE TRIGGER trg_delete_auth_user_on_profile_delete
  AFTER DELETE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION delete_auth_user_on_profile_delete();

-- ============================================================================
-- Maandafsluiting finalisatie — registreert per maand wanneer de Maandafsluiting
-- definitief is afgesloten. ALLEEN als een maand hier staat, behandelen de
-- LE-trendlijnen in de Executive Overview die maand als 'actual'. Anders blijft
-- het LE-forecast (zelfs als de kalender al gepasseerd is).
-- ============================================================================
CREATE TABLE IF NOT EXISTS closing_finalized (
  month text PRIMARY KEY,                -- bv. 'Mar-26'
  finalized_at timestamptz DEFAULT now(),
  finalized_by text DEFAULT '',
  checklist jsonb DEFAULT '{}'::jsonb,    -- snapshot van afgevinkte items
  le_snapshot jsonb,                      -- LE-forecast per BV op finalize-moment
                                          -- ({Consultancy:{netto_omzet,brutomarge,ebitda},...})
                                          -- voor LE-vs-Actuals accuraatheids-rapport
  created_at timestamptz DEFAULT now()
);
-- Idempotente migratie voor bestaande installaties zonder le_snapshot kolom.
ALTER TABLE closing_finalized ADD COLUMN IF NOT EXISTS le_snapshot jsonb;

-- RLS: zelfde "open"-policy als de andere tabellen (intern dashboard, geen
-- multi-tenant). Zonder policy zou een Supabase-project met RLS aan-by-default
-- alle reads blokkeren — waardoor fetchFinalizedMonths leeg terugkomt en de
-- net-afgesloten Maandafsluiting weer als 'open' zou tonen na een realtime
-- refetch.
ALTER TABLE closing_finalized ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on closing_finalized" ON closing_finalized;
CREATE POLICY "Allow all on closing_finalized" ON closing_finalized FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- FTE-uitbreiding (mei-2026): Holdings als FTE-BV + vertical-breakdown.
-- ----------------------------------------------------------------------------
-- 1) De BV-CHECK constraint moet ook 'Holdings' toelaten zodat Holding B.V.
--    en Ingenieurs en Specialisten B.V. (samen → Holdings) FTE/headcount-
--    rijen kunnen krijgen.
-- 2) Een vertical-kolom (Telecom/Public/Energy/Civiel/Industry/Overig of NULL)
--    splitst de productie-BVs in sub-buckets. NULL = BV-totaal-rij (legacy
--    gedrag — bestaande rijen blijven valide).
-- 3) De UNIQUE(bv, month)-constraint moet eraf, want we slaan nu meerdere
--    rijen per (bv, month) op (één totaal + n verticals). Identiteit wordt
--    gegarandeerd door de PK (id).
-- ============================================================================
ALTER TABLE fte_entries ADD COLUMN IF NOT EXISTS vertical text;

-- Drop de oude BV-CHECK; voeg de nieuwe toe (met Holdings).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'fte_entries' AND constraint_name = 'fte_entries_bv_check'
  ) THEN
    EXECUTE 'ALTER TABLE fte_entries DROP CONSTRAINT fte_entries_bv_check';
  END IF;
END$$;
ALTER TABLE fte_entries
  ADD CONSTRAINT fte_entries_bv_check
  CHECK (bv IN ('Consultancy', 'Projects', 'Software', 'Holdings'));

-- Drop de UNIQUE(bv, month)-constraint zodat per (bv, month) zowel een
-- totaal-rij (vertical IS NULL) als meerdere vertical-rijen kunnen bestaan.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fte_entries_bv_month_key'
  ) THEN
    EXECUTE 'ALTER TABLE fte_entries DROP CONSTRAINT fte_entries_bv_month_key';
  END IF;
END$$;

-- Optioneel: extra fteBudget/headcountBudget-kolommen (idempotent — bestaan
-- mogelijk al uit eerdere lokale migraties).
ALTER TABLE fte_entries ADD COLUMN IF NOT EXISTS fte_budget numeric;
ALTER TABLE fte_entries ADD COLUMN IF NOT EXISTS headcount_budget integer;

-- ============================================================================
-- 10. Cross-device sync voor uren, kosten-specificaties en LE-reflecties.
--     Deze stores waren voorheen alleen localStorage — nu gedeeld via Supabase
--     zodat elke gebruiker dezelfde data ziet (declarabiliteit, ziekte, etc.).
-- ============================================================================

-- 10a. Geüploade SAP-uren per BV per maand (declarabel/intern/verlof/ziekte).
CREATE TABLE IF NOT EXISTS hours_entries (
  id text PRIMARY KEY,                    -- `${bv}-${month}`
  bv text NOT NULL,
  month text NOT NULL,
  declarable numeric DEFAULT 0,
  internal numeric DEFAULT 0,
  vakantie numeric DEFAULT 0,
  ziekte numeric DEFAULT 0,
  overig_verlof numeric DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

-- 10b. Geüploade SAP-uren per BV per ISO-week.
CREATE TABLE IF NOT EXISTS hours_week_entries (
  id text PRIMARY KEY,                    -- `${bv}-${year}-W${week}`
  bv text NOT NULL,
  year integer NOT NULL,
  week integer NOT NULL,
  month text NOT NULL,
  week_start text DEFAULT '',
  week_end text DEFAULT '',
  declarable numeric DEFAULT 0,
  internal numeric DEFAULT 0,
  vakantie numeric DEFAULT 0,
  ziekte numeric DEFAULT 0,
  overig_verlof numeric DEFAULT 0,
  planned_work numeric DEFAULT 0,
  missing_hours_open numeric DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

-- 10c. Kosten-specificaties — handmatige uitsplitsing onder kosten-subregels.
CREATE TABLE IF NOT EXISTS cost_breakdowns (
  id text PRIMARY KEY,
  month text NOT NULL,
  category text NOT NULL,
  label text DEFAULT '',
  values jsonb NOT NULL DEFAULT '{}',     -- { Consultancy, Projects, Software, Holdings }
  updated_at timestamptz DEFAULT now()
);

-- 10d. LE-reflecties — antwoorden van de gebruiker over varianties per maand/BV.
CREATE TABLE IF NOT EXISTS closing_reflections (
  id text PRIMARY KEY,                    -- `${month}::${bv}`
  month text NOT NULL,
  bv text NOT NULL,
  answers jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz DEFAULT now()
);

-- 10e. Interne uren — gedetailleerde uitsplitsing van de niet-declarabele
--      uren per BV/maand/categorie (+ per werknemer).
CREATE TABLE IF NOT EXISTS internal_hours (
  id text PRIMARY KEY,                    -- `${bv}-${month}`
  bv text NOT NULL,
  month text NOT NULL,
  categories jsonb NOT NULL DEFAULT '{}', -- categorie-key → uren
  employees jsonb NOT NULL DEFAULT '[]',  -- [{ naam, totaal, leegloop }]
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE hours_entries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE hours_week_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_breakdowns      ENABLE ROW LEVEL SECURITY;
ALTER TABLE closing_reflections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_hours       ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on hours_entries" ON hours_entries;
CREATE POLICY "Allow all on hours_entries" ON hours_entries FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all on hours_week_entries" ON hours_week_entries;
CREATE POLICY "Allow all on hours_week_entries" ON hours_week_entries FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all on cost_breakdowns" ON cost_breakdowns;
CREATE POLICY "Allow all on cost_breakdowns" ON cost_breakdowns FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all on closing_reflections" ON closing_reflections;
CREATE POLICY "Allow all on closing_reflections" ON closing_reflections FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all on internal_hours" ON internal_hours;
CREATE POLICY "Allow all on internal_hours" ON internal_hours FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_hours_bv_month       ON hours_entries(bv, month);
CREATE INDEX IF NOT EXISTS idx_hours_week_bv        ON hours_week_entries(bv, year, week);
CREATE INDEX IF NOT EXISTS idx_cost_breakdowns_mc   ON cost_breakdowns(month, category);
CREATE INDEX IF NOT EXISTS idx_reflections_month_bv ON closing_reflections(month, bv);
CREATE INDEX IF NOT EXISTS idx_internal_hours_bv    ON internal_hours(bv, month);

CREATE OR REPLACE TRIGGER trg_hours_updated       BEFORE UPDATE ON hours_entries       FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_hours_week_updated  BEFORE UPDATE ON hours_week_entries  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_cost_breakdowns_upd BEFORE UPDATE ON cost_breakdowns     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_reflections_updated BEFORE UPDATE ON closing_reflections FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_internal_hours_upd  BEFORE UPDATE ON internal_hours      FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 11. Notificaties — gedeelde bell-inbox tussen editors/approvers/admins.
--     Triggers vanuit de app: import uploaded, IC-tarieven klaar, maand-start,
--     maand-finalized, LE-leerlus open. Zonder deze tabel staan notificaties
--     alleen in localStorage — dan ziet user B een melding niet wanneer user A
--     hem aanmaakt.
--     - audience is een jsonb array met role-strings (viewer/editor/approver/admin).
--     - read_by is een jsonb array van email-adressen die de melding al hebben
--       gezien; per-user gelezen-status blijft dus per user verschillend.
--     - dedupe_key voorkomt dat dezelfde melding (bv. "Mar-26 maand-start")
--       twee keer verschijnt; partial unique index dwingt dit DB-side af zodat
--       gelijktijdige inserts van twee clients niet alsnog duplicaten geven.
-- ============================================================================
CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY,
  category text NOT NULL,
  audience jsonb NOT NULL DEFAULT '[]',
  title text NOT NULL,
  body text,
  link_tab text,
  link_month text,
  dedupe_key text,
  read_by jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_dedupe
  ON notifications (dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on notifications" ON notifications;
CREATE POLICY "Allow all on notifications" ON notifications FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE TRIGGER trg_notifications_updated BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 12. Voorspelling huidige maand — partial-month upload-totalen + OHW-schatting.
--     Gescheiden van de Maandafsluiting-tabellen zodat een prognose-upload (bv.
--     factuurvolume YTD halverwege de maand) géén OHW-rijen of import_records
--     muteert. Pure prognose-input: de forecastEngine leest deze data, blendt
--     met de LE-forecast en levert een maandeind-voorspelling.
--     - id = `${month}::${slot}` voor BV-agnostische slots (factuurvolume,
--       geschreven_uren, interne_uren) en `${month}::${slot}::${bv}` voor
--       slots die per BV opgeslagen worden (ohw_estimate).
--     - payload bevat de gestandaardiseerde totalen (perBv map, hours-entries,
--       OHW row-mutatie) zoals geleverd door parseImportFile.
-- ============================================================================
CREATE TABLE IF NOT EXISTS forecast_inputs (
  id text PRIMARY KEY,
  month text NOT NULL,
  slot text NOT NULL,
  bv text,
  payload jsonb NOT NULL DEFAULT '{}',
  file_name text,
  uploaded_by text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_forecast_inputs_month ON forecast_inputs(month);
CREATE INDEX IF NOT EXISTS idx_forecast_inputs_slot  ON forecast_inputs(month, slot);

ALTER TABLE forecast_inputs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on forecast_inputs" ON forecast_inputs;
CREATE POLICY "Allow all on forecast_inputs" ON forecast_inputs FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE TRIGGER trg_forecast_inputs_updated BEFORE UPDATE ON forecast_inputs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- Realtime / live sync — CRUCIAAL voor "iedereen ziet meteen de laatste data".
-- ----------------------------------------------------------------------------
-- De app abonneert zich via Supabase Realtime op onderstaande tabellen
-- (zie src/hooks/useRealtimeSync.ts). Zonder dat de tabellen in de
-- `supabase_realtime` publication staan, komen er GEEN postgres_changes-events
-- binnen — dan zien gebruikers elkaars wijzigingen (bv. een afgesloten maand)
-- pas na een handmatige refresh.
--
-- Dit blok voegt elke tabel idempotent toe aan de publication: al-aanwezige
-- tabellen worden overgeslagen, dus het is veilig om de schema.sql opnieuw te
-- draaien. Voer dit één keer uit in de Supabase SQL Editor.
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'closing_entries', 'closing_finalized', 'fte_entries', 'import_records',
    'import_raw_data', 'ohw_entities', 'tariff_entries', 'budget_overrides',
    'ohw_evidence', 'hours_entries', 'hours_week_entries', 'cost_breakdowns',
    'closing_reflections', 'internal_hours', 'notifications', 'user_profiles',
    'forecast_inputs'
  ] LOOP
    -- to_regclass-check: sla tabellen over die (nog) niet bestaan, zodat het
    -- blok niet crasht op een database die nog niet volledig gemigreerd is.
    IF to_regclass('public.' || t) IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        RAISE NOTICE 'Realtime ingeschakeld voor tabel %', t;
      END IF;
      -- REPLICA IDENTITY FULL: zorgt dat UPDATE-events de volledige OLD-rij
      -- meesturen, niet alleen de PK-kolom. Belangrijk voor PostgREST/Supabase
      -- Realtime zodat de client bij elke wijziging genoeg context heeft om
      -- diffs lokaal toe te passen (anders verschijnt bv. een leeg payload bij
      -- UPDATE en moet de client volledig refetchen).
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    END IF;
  END LOOP;
END$$;

-- ============================================================================
-- Bootstrap: zorg dat de TPG Finance hoofd-admin altijd aanwezig is.
-- Pas dit aan als jouw admin-email anders is.
-- ============================================================================
INSERT INTO user_profiles (email, role, active, needs_password, invited_by, invited_at)
VALUES ('lvanderavoird@thepeoplegroup.nl', 'admin', true, false, 'system', now())
ON CONFLICT (email) DO UPDATE SET role = 'admin', active = true, needs_password = false;
