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

-- 8. IC Tarieven — uurtarieven per medewerker (voor missing hours berekening)
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

-- Policies: volledige lees/schrijf-toegang voor iedereen (aanpassen als auth nodig is)
CREATE POLICY "Allow all on closing_entries" ON closing_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on fte_entries" ON fte_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on import_records" ON import_records FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on import_raw_data" ON import_raw_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on ohw_entities" ON ohw_entities FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on tariff_entries" ON tariff_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on budget_overrides" ON budget_overrides FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on closing_archives" ON closing_archives FOR ALL USING (true) WITH CHECK (true);

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
