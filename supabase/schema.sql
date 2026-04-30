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
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
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

-- 9. IC Tarieven — uurtarieven per medewerker (voor missing hours berekening)
CREATE TABLE IF NOT EXISTS tariff_entries (
  id text PRIMARY KEY,                -- werknemer ID
  bedrijf text DEFAULT '',
  naam text DEFAULT '',
  powerbi_naam text DEFAULT '',
  stroming text DEFAULT '',
  tarief numeric DEFAULT 0,
  fte numeric,
  functie text DEFAULT '',
  leiding_gevende text DEFAULT '',
  manager text DEFAULT '',
  powerbi_naam2 text DEFAULT '',
  team text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

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
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- Bootstrap: zorg dat de TPG Finance hoofd-admin altijd aanwezig is.
-- Pas dit aan als jouw admin-email anders is.
-- ============================================================================
INSERT INTO user_profiles (email, role, active, needs_password, invited_by, invited_at)
VALUES ('lvanderavoird@thepeoplegroup.nl', 'admin', true, false, 'system', now())
ON CONFLICT (email) DO UPDATE SET role = 'admin', active = true, needs_password = false;
