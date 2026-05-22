-- IC Tarieven 2026 datamigratie
-- Bron: TPG IC Tarieven 2026 - POWERBI.xlsx
-- Voer dit eenmalig uit in de Supabase SQL-editor.

BEGIN;

ALTER TABLE tariff_entries ADD COLUMN IF NOT EXISTS tarief_2025 numeric;
ALTER TABLE tariff_entries ADD COLUMN IF NOT EXISTS vertical text DEFAULT '';

DELETE FROM tariff_entries WHERE id = 'new-1777535040070';
DELETE FROM tariff_entries WHERE id = '99907';

UPDATE tariff_entries SET tarief = 75, tarief_2025 = 54 WHERE id = 'new-1778673890262';
UPDATE tariff_entries SET tarief = 79, tarief_2025 = 80 WHERE id = '10216';
UPDATE tariff_entries SET tarief = 66, tarief_2025 = 75 WHERE id = '10299';
UPDATE tariff_entries SET tarief = 56, tarief_2025 = 75 WHERE id = '10677';
UPDATE tariff_entries SET tarief = 64, tarief_2025 = 75 WHERE id = '10004';
UPDATE tariff_entries SET tarief = 62, tarief_2025 = 75 WHERE id = '11112';
UPDATE tariff_entries SET tarief = 75, tarief_2025 = 75 WHERE id = '10070';
UPDATE tariff_entries SET tarief = 58, tarief_2025 = 75 WHERE id = '10005';
UPDATE tariff_entries SET tarief = 75, tarief_2025 = 75 WHERE id = '10957';
UPDATE tariff_entries SET tarief = 52, tarief_2025 = 69 WHERE id = '10167';
UPDATE tariff_entries SET tarief = 56, tarief_2025 = 69 WHERE id = '10002';
UPDATE tariff_entries SET tarief = 48, tarief_2025 = 69 WHERE id = '10381';
UPDATE tariff_entries SET tarief = 47, tarief_2025 = 69 WHERE id = '10580';
UPDATE tariff_entries SET tarief = 52, tarief_2025 = 69 WHERE id = '10096';
UPDATE tariff_entries SET tarief = 55, tarief_2025 = 69 WHERE id = '10469';
UPDATE tariff_entries SET tarief = 39.2, tarief_2025 = 39.2 WHERE id = '10573';
UPDATE tariff_entries SET tarief = 44, tarief_2025 = 42 WHERE id = '10794';
UPDATE tariff_entries SET tarief = 64, tarief_2025 = 42.3 WHERE id = '10750';
UPDATE tariff_entries SET tarief = 46, tarief_2025 = 46 WHERE id = '10661';
UPDATE tariff_entries SET tarief = 47, tarief_2025 = 47 WHERE id = '10702';
UPDATE tariff_entries SET tarief = 47, tarief_2025 = 47 WHERE id = '10703';
UPDATE tariff_entries SET tarief = 48, tarief_2025 = 48.1 WHERE id = '10684';
UPDATE tariff_entries SET tarief = 43, tarief_2025 = 48.6 WHERE id = '10543';
UPDATE tariff_entries SET tarief = 64, tarief_2025 = 80 WHERE id = '10120';
UPDATE tariff_entries SET tarief = 74, tarief_2025 = 80 WHERE id = '10024';
UPDATE tariff_entries SET tarief = 66, tarief_2025 = 75 WHERE id = '11096';
UPDATE tariff_entries SET tarief = 69, tarief_2025 = 69 WHERE id = '10960';
UPDATE tariff_entries SET tarief = 86, tarief_2025 = 69 WHERE id = '10045';
UPDATE tariff_entries SET tarief = 44, tarief_2025 = 69 WHERE id = '10238';
UPDATE tariff_entries SET tarief = 64, tarief_2025 = 69 WHERE id = '10943';
UPDATE tariff_entries SET tarief = 51, tarief_2025 = 69 WHERE id = '10155';
UPDATE tariff_entries SET tarief = 51, tarief_2025 = 69 WHERE id = '10250';
UPDATE tariff_entries SET tarief = 34, tarief_2025 = 49.8 WHERE id = '10955';
UPDATE tariff_entries SET tarief = 49.8, tarief_2025 = 49.8 WHERE id = '10166';
UPDATE tariff_entries SET tarief = 48, tarief_2025 = 50.8 WHERE id = '10474';
UPDATE tariff_entries SET tarief = 50.9, tarief_2025 = 50.9 WHERE id = '10190';
UPDATE tariff_entries SET tarief = 46, tarief_2025 = 51.2 WHERE id = '10755';
UPDATE tariff_entries SET tarief = 74, tarief_2025 = 91 WHERE id = '10924';
UPDATE tariff_entries SET tarief = 59, tarief_2025 = 91 WHERE id = '10159';
UPDATE tariff_entries SET tarief = 76, tarief_2025 = 80 WHERE id = '10845';
UPDATE tariff_entries SET tarief = 52, tarief_2025 = 51.7 WHERE id = '11098';
UPDATE tariff_entries SET tarief = 52.1, tarief_2025 = 52.1 WHERE id = '10488';
UPDATE tariff_entries SET tarief = 53, tarief_2025 = 52.2 WHERE id = '10067';
UPDATE tariff_entries SET tarief = 50, tarief_2025 = 52.3 WHERE id = '11082';
UPDATE tariff_entries SET tarief = 46, tarief_2025 = 52.3 WHERE id = '10522';
UPDATE tariff_entries SET tarief = 60, tarief_2025 = 54.3 WHERE id = '10922';
UPDATE tariff_entries SET tarief = 64, tarief_2025 = 54.6 WHERE id = '10106';
UPDATE tariff_entries SET tarief = 59, tarief_2025 = 55.1 WHERE id = '10385';
UPDATE tariff_entries SET tarief = 64, tarief_2025 = 55.2 WHERE id = '10175';
UPDATE tariff_entries SET tarief = 49, tarief_2025 = 56 WHERE id = '10719';
UPDATE tariff_entries SET tarief = 106, tarief_2025 = 104 WHERE id = '10723';
UPDATE tariff_entries SET tarief = 110, tarief_2025 = 104 WHERE id = '10956';
UPDATE tariff_entries SET tarief = 55, tarief_2025 = 56.3 WHERE id = '10087';
UPDATE tariff_entries SET tarief = 51, tarief_2025 = 56.4 WHERE id = '10621';
UPDATE tariff_entries SET tarief = 56, tarief_2025 = 56.5 WHERE id = '10436';
UPDATE tariff_entries SET tarief = 57, tarief_2025 = 57.3 WHERE id = '10630';
UPDATE tariff_entries SET tarief = 61, tarief_2025 = 57.6 WHERE id = '10699';
UPDATE tariff_entries SET tarief = 59, tarief_2025 = 58.3 WHERE id = '10188';
UPDATE tariff_entries SET tarief = 52, tarief_2025 = 58.5 WHERE id = '10836';
UPDATE tariff_entries SET tarief = 61, tarief_2025 = 59 WHERE id = '10795';
UPDATE tariff_entries SET tarief = 44, tarief_2025 = 59.6 WHERE id = '10150';
UPDATE tariff_entries SET tarief = 51, tarief_2025 = 59.6 WHERE id = '10101';
UPDATE tariff_entries SET tarief = 59.7, tarief_2025 = 59.7 WHERE id = '10951';
UPDATE tariff_entries SET tarief = 59, tarief_2025 = 69 WHERE id = '10055';
UPDATE tariff_entries SET tarief = 60, tarief_2025 = 69 WHERE id = '10531';
UPDATE tariff_entries SET tarief = 52, tarief_2025 = 69 WHERE id = '10437';
UPDATE tariff_entries SET tarief = 68, tarief_2025 = 69 WHERE id = '10050';
UPDATE tariff_entries SET tarief = 72, tarief_2025 = 69 WHERE id = '10140';
UPDATE tariff_entries SET tarief = 51, tarief_2025 = 69 WHERE id = '10433';
UPDATE tariff_entries SET tarief = 46, tarief_2025 = 69 WHERE id = '11114';
UPDATE tariff_entries SET tarief = 64, tarief_2025 = 69 WHERE id = '10428';
UPDATE tariff_entries SET tarief = 63, tarief_2025 = 69 WHERE id = '10214';
UPDATE tariff_entries SET tarief = 56, tarief_2025 = 64 WHERE id = '10184';
UPDATE tariff_entries SET tarief = 46, tarief_2025 = 64 WHERE id = '10471';
UPDATE tariff_entries SET tarief = 52, tarief_2025 = 64 WHERE id = '10258';
UPDATE tariff_entries SET tarief = 64, tarief_2025 = 64 WHERE id = '10961';
UPDATE tariff_entries SET tarief = 51, tarief_2025 = 64 WHERE id = '10638';
UPDATE tariff_entries SET tarief = 47, tarief_2025 = 64 WHERE id = '10867';
UPDATE tariff_entries SET tarief = 51, tarief_2025 = 64 WHERE id = '10934';
UPDATE tariff_entries SET tarief = 66, tarief_2025 = 69 WHERE id = '10930';
UPDATE tariff_entries SET tarief = 79, tarief_2025 = 69 WHERE id = '10021';
UPDATE tariff_entries SET tarief = 56, tarief_2025 = 69 WHERE id = '10776';
UPDATE tariff_entries SET tarief = 58, tarief_2025 = 69 WHERE id = '10384';
UPDATE tariff_entries SET tarief = 55, tarief_2025 = 69 WHERE id = '10098';
UPDATE tariff_entries SET tarief = 56, tarief_2025 = 69 WHERE id = '10059';
UPDATE tariff_entries SET tarief = 64, tarief_2025 = 69 WHERE id = '10051';
UPDATE tariff_entries SET tarief = 47, tarief_2025 = 69 WHERE id = '10114';
UPDATE tariff_entries SET tarief = 54, tarief_2025 = 69 WHERE id = '10193';
UPDATE tariff_entries SET tarief = 54, tarief_2025 = 69 WHERE id = '10889';
UPDATE tariff_entries SET tarief = 56, tarief_2025 = 69 WHERE id = '10856';
UPDATE tariff_entries SET tarief = 55, tarief_2025 = 69 WHERE id = '10173';
UPDATE tariff_entries SET tarief = 61, tarief_2025 = 60.6 WHERE id = '10732';
UPDATE tariff_entries SET tarief = 56, tarief_2025 = 61.1 WHERE id = '10038';
UPDATE tariff_entries SET tarief = 64, tarief_2025 = 62.3 WHERE id = '10658';
UPDATE tariff_entries SET tarief = 59, tarief_2025 = 62.7 WHERE id = '10642';
UPDATE tariff_entries SET tarief = 66, tarief_2025 = 62.8 WHERE id = '10662';
UPDATE tariff_entries SET tarief = 60, tarief_2025 = 62.9 WHERE id = '10757';
UPDATE tariff_entries SET tarief = 65, tarief_2025 = 63.4 WHERE id = '10138';
UPDATE tariff_entries SET tarief = 55, tarief_2025 = 63.7 WHERE id = '10827';
UPDATE tariff_entries SET tarief = 60, tarief_2025 = 64.1 WHERE id = '10860';
UPDATE tariff_entries SET tarief = 66, tarief_2025 = 64.7 WHERE id = '10074';
UPDATE tariff_entries SET tarief = 64.8, tarief_2025 = 64.8 WHERE id = '10404';
UPDATE tariff_entries SET tarief = 65, tarief_2025 = 65 WHERE id = '10835';
UPDATE tariff_entries SET tarief = 64, tarief_2025 = 65.2 WHERE id = '10567';
UPDATE tariff_entries SET tarief = 68, tarief_2025 = 66.3 WHERE id = '10740';
UPDATE tariff_entries SET tarief = 62, tarief_2025 = 66.8 WHERE id = '10027';
UPDATE tariff_entries SET tarief = 67.3, tarief_2025 = 67.3 WHERE id = '10952';
UPDATE tariff_entries SET tarief = 53, tarief_2025 = 67.9 WHERE id = '11094';
UPDATE tariff_entries SET tarief = 67.9, tarief_2025 = 67.9 WHERE id = '99908';
UPDATE tariff_entries SET tarief = 72, tarief_2025 = 67.9 WHERE id = '10334';
UPDATE tariff_entries SET tarief = 67.9, tarief_2025 = 67.9 WHERE id = '99903';
UPDATE tariff_entries SET tarief = 69, tarief_2025 = 68.5 WHERE id = '10743';
UPDATE tariff_entries SET tarief = 60, tarief_2025 = 68.8 WHERE id = '10768';
UPDATE tariff_entries SET tarief = 64, tarief_2025 = 70 WHERE id = '10832';
UPDATE tariff_entries SET tarief = 62, tarief_2025 = 70 WHERE id = '10839';
UPDATE tariff_entries SET tarief = 70, tarief_2025 = 70 WHERE id = '11090';
UPDATE tariff_entries SET tarief = 64, tarief_2025 = 70.1 WHERE id = '10057';
UPDATE tariff_entries SET tarief = 57, tarief_2025 = 71.1 WHERE id = '10963';
UPDATE tariff_entries SET tarief = 71.1, tarief_2025 = 71.1 WHERE id = '10053';
UPDATE tariff_entries SET tarief = 62, tarief_2025 = 71.7 WHERE id = '10773';
UPDATE tariff_entries SET tarief = 65, tarief_2025 = 72.1 WHERE id = '10023';
UPDATE tariff_entries SET tarief = 69, tarief_2025 = 72.1 WHERE id = '10831';
UPDATE tariff_entries SET tarief = 65, tarief_2025 = 72.1 WHERE id = '10841';
UPDATE tariff_entries SET tarief = 73.2, tarief_2025 = 73.2 WHERE id = '10432';
UPDATE tariff_entries SET tarief = 64, tarief_2025 = 73.2 WHERE id = '10966';
UPDATE tariff_entries SET tarief = 74, tarief_2025 = 73.8 WHERE id = '10470';
UPDATE tariff_entries SET tarief = 74.2, tarief_2025 = 74.2 WHERE id = '10252';
UPDATE tariff_entries SET tarief = 65, tarief_2025 = 74.4 WHERE id = '10805';
UPDATE tariff_entries SET tarief = 69, tarief_2025 = 74.7 WHERE id = '10411';
UPDATE tariff_entries SET tarief = 75.2, tarief_2025 = 75.2 WHERE id = '10783';
UPDATE tariff_entries SET tarief = 82, tarief_2025 = 75.2 WHERE id = '10069';
UPDATE tariff_entries SET tarief = 70, tarief_2025 = 75.8 WHERE id = '10042';
UPDATE tariff_entries SET tarief = 76, tarief_2025 = 76 WHERE id = '10161';
UPDATE tariff_entries SET tarief = 74, tarief_2025 = 76.2 WHERE id = '10842';
UPDATE tariff_entries SET tarief = 73, tarief_2025 = 76.4 WHERE id = '10817';
UPDATE tariff_entries SET tarief = 77.6, tarief_2025 = 77.6 WHERE id = '10466';
UPDATE tariff_entries SET tarief = 73, tarief_2025 = 79.4 WHERE id = '10333';
UPDATE tariff_entries SET tarief = 68, tarief_2025 = 81.5 WHERE id = '10958';
UPDATE tariff_entries SET tarief = 59, tarief_2025 = 82 WHERE id = '10738';
UPDATE tariff_entries SET tarief = 78, tarief_2025 = 82.7 WHERE id = '10825';
UPDATE tariff_entries SET tarief = 66, tarief_2025 = 80 WHERE id = '10230';
UPDATE tariff_entries SET tarief = 48, tarief_2025 = 80 WHERE id = '10142';
UPDATE tariff_entries SET tarief = 82.7, tarief_2025 = 82.7 WHERE id = '10838';
UPDATE tariff_entries SET tarief = 83.6, tarief_2025 = 83.6 WHERE id = '10405';
UPDATE tariff_entries SET tarief = 68, tarief_2025 = 84.9 WHERE id = '11092';
UPDATE tariff_entries SET tarief = 70, tarief_2025 = 86.9 WHERE id = '10657';
UPDATE tariff_entries SET tarief = 77, tarief_2025 = 88.8 WHERE id = '10618';
UPDATE tariff_entries SET tarief = 109, tarief_2025 = 117 WHERE id = '10798';
UPDATE tariff_entries SET tarief = 86, tarief_2025 = 96 WHERE id = '10513';
UPDATE tariff_entries SET tarief = 89.9, tarief_2025 = 89.9 WHERE id = '10426';
UPDATE tariff_entries SET tarief = 73, tarief_2025 = 92.4 WHERE id = '10097';
UPDATE tariff_entries SET tarief = 92.4, tarief_2025 = 92.4 WHERE id = '10712';
UPDATE tariff_entries SET tarief = 86, tarief_2025 = 93 WHERE id = '10280';
UPDATE tariff_entries SET tarief = 94, tarief_2025 = 96.4 WHERE id = '10296';
UPDATE tariff_entries SET tarief = 99, tarief_2025 = 79 WHERE id = '10446';
UPDATE tariff_entries SET tarief = 91, tarief_2025 = 98.6 WHERE id = '10673';
UPDATE tariff_entries SET tarief = 84, tarief_2025 = 87 WHERE id = '10208';
UPDATE tariff_entries SET tarief = 101, tarief_2025 = 96 WHERE id = '10910';
UPDATE tariff_entries SET tarief = 66, tarief_2025 = 69 WHERE id = '10396';
UPDATE tariff_entries SET tarief = 95, tarief_2025 = 99.4 WHERE id = '10309';
UPDATE tariff_entries SET tarief = 89, tarief_2025 = 98 WHERE id = '10499';
UPDATE tariff_entries SET tarief = 69, tarief_2025 = 74 WHERE id = '10079';
UPDATE tariff_entries SET tarief = 109, tarief_2025 = 113 WHERE id = '10639';
UPDATE tariff_entries SET tarief = 94, tarief_2025 = 100 WHERE id = '10850';
UPDATE tariff_entries SET tarief = 101, tarief_2025 = 69 WHERE id = '10020';
UPDATE tariff_entries SET tarief = 109, tarief_2025 = 108.7 WHERE id = '10688';
UPDATE tariff_entries SET tarief = 111, tarief_2025 = 129 WHERE id = '10247';
UPDATE tariff_entries SET tarief = 80, tarief_2025 = 80 WHERE id = '10039';
UPDATE tariff_entries SET tarief = 109.7, tarief_2025 = 109.7 WHERE id = '10443';
UPDATE tariff_entries SET tarief = 105, tarief_2025 = 113.7 WHERE id = '10701';
UPDATE tariff_entries SET tarief = 84, tarief_2025 = 89 WHERE id = '10627';
UPDATE tariff_entries SET tarief = 73, tarief_2025 = 77 WHERE id = '10570';
UPDATE tariff_entries SET tarief = 111, tarief_2025 = 117 WHERE id = '10542';
UPDATE tariff_entries SET tarief = 117, tarief_2025 = 114.1 WHERE id = '10255';
UPDATE tariff_entries SET tarief = 72, tarief_2025 = 81 WHERE id = '10959';
UPDATE tariff_entries SET tarief = 90, tarief_2025 = 90 WHERE id = '10147';
UPDATE tariff_entries SET tarief = 92.5, tarief_2025 = 122.1 WHERE id = '10546';
UPDATE tariff_entries SET tarief = 129.6, tarief_2025 = 129.6 WHERE id = '10512';

UPDATE tariff_entries SET id = '11068', bedrijf = 'Consultancy', tarief = 52, tarief_2025 = 54.81 WHERE id = 'icf-1778661960268-yefnn';
UPDATE tariff_entries SET id = '11134', tarief = 69, tarief_2025 = 68 WHERE id = 'new-1777535040771';
UPDATE tariff_entries SET id = '11177', tarief = 73, tarief_2025 = 54 WHERE id = 'new-1778673880254';
UPDATE tariff_entries SET id = '11164', tarief = 96, tarief_2025 = 60 WHERE id = 'new-1777535041412';
UPDATE tariff_entries SET id = '11140', tarief = 86, tarief_2025 = 104 WHERE id = '11078';
UPDATE tariff_entries SET id = '11179', tarief = 70, tarief_2025 = 56.6 WHERE id = '10882';
UPDATE tariff_entries SET id = '11130', tarief = 64, tarief_2025 = 67.9 WHERE id = '99906';
UPDATE tariff_entries SET id = '11122', tarief = 55, tarief_2025 = 67.9 WHERE id = '99902';
UPDATE tariff_entries SET id = '11136', tarief = 60, tarief_2025 = 67.9 WHERE id = '99905';
UPDATE tariff_entries SET id = '11126', tarief = 66, tarief_2025 = 67.9 WHERE id = '99904';
UPDATE tariff_entries SET id = '11107', tarief = 74, tarief_2025 = 67.9 WHERE id = '99901';
UPDATE tariff_entries SET id = '11076', tarief = 70, tarief_2025 = 73.2 WHERE id = '10964';

INSERT INTO tariff_entries (id, bedrijf, naam, powerbi_naam, stroming, tarief, fte, functie, leiding_gevende, manager, powerbi_naam2, team) VALUES
  ('ic2026-001', 'Consultancy', 'Ahmet Turkucu', 'Turkucu, Ahmet', '', 62, NULL, '', '', '', 'ATURKUCU', ''),
  ('ic2026-002', 'Spanje', 'Alberto Corcoles', 'Corcoles, Alberto', '', 35, NULL, '', '', '', 'ACORCOLES', ''),
  ('ic2026-003', 'Consultancy', 'Ali Sarikus', 'Sarikus, Ali', '', 79.98, NULL, '', '', '', 'ASARIKUS', ''),
  ('ic2026-004', 'Consultancy', 'Alin Beliciu', 'Beliciu, Alin', '', 84, NULL, '', '', '', 'ABELICIU', ''),
  ('ic2026-005', 'Spanje', 'Ana María Olmos Carbonell', 'María Olmos Carbonell, Ana', '', 35, NULL, '', '', '', 'AMARÍAOLMOSCARBONELL', ''),
  ('ic2026-006', 'Consultancy', 'Anne van der Pas', 'van der Pas, Anne', '', 90.56, NULL, '', '', '', 'AVANDERPAS', ''),
  ('10072', 'Software', 'Anneliese Brouwer', 'Brouwer, Anneliese', '', 86, NULL, '', '', '', 'ABROUWER', ''),
  ('ic2026-007', 'Consultancy', 'Bart Kroeze', 'Kroeze, Bart', '', 84, NULL, '', '', '', 'BKROEZE', ''),
  ('ic2026-008', 'Consultancy', 'Benito Naarden', 'Naarden, Benito', '', 80, NULL, '', '', '', 'BNAARDEN', ''),
  ('11118', 'Software', 'Bin Wong', 'Wong, Bin', '', 60, NULL, '', '', '', 'BWONG', ''),
  ('ic2026-009', 'Spanje', 'Bryan Moreira', 'Moreira, Bryan', '', 35, NULL, '', '', '', 'BMOREIRA', ''),
  ('ic2026-010', 'Spanje', 'Carlos Gonzalez Sanchez', 'Gonzalez Sanchez, Carlos', '', 35, NULL, '', '', '', 'CGONZALEZSANCHEZ', ''),
  ('ic2026-011', 'Spanje', 'Carlos Micó Slaguero', 'Micó Slaguero, Carlos', '', 35, NULL, '', '', '', 'CMICÓSLAGUERO', ''),
  ('11066', 'Projects', 'Chris Evers', 'Evers, Chris', '', 52, NULL, '', '', '', 'CEVERS', ''),
  ('ic2026-012', 'Consultancy', 'Ciprian Liviu RUSU', 'Liviu RUSU, Ciprian', '', 129, NULL, '', '', '', 'CLIVIURUSU', ''),
  ('11166', 'Projects', 'Coen Hijmans', 'Hijmans, Coen', '', 99, NULL, '', '', '', 'CHIJMANS', ''),
  ('10152', 'Software', 'Corno Rense', 'Rense, Corno', '', 94, NULL, '', '', '', 'CRENSE', ''),
  ('ic2026-013', 'Software', 'Dennis de Kruijf', 'de Kruijf, Dennis', '', 100, NULL, '', '', '', 'DDEKRUIJF', ''),
  ('ic2026-014', 'Consultancy', 'Dennis Geurtsen', 'Geurtsen, Dennis', '', 85, NULL, '', '', '', 'DGEURTSEN', ''),
  ('10249', 'Software', 'Derk Nouwens', 'Nouwens, Derk', '', 84, NULL, '', '', '', 'DNOUWENS', ''),
  ('ic2026-015', 'Consultancy', 'Erhan Bayram', 'Bayram, Erhan', '', 74.65, NULL, '', '', '', 'EBAYRAM', ''),
  ('ic2026-016', 'Consultancy', 'Erik Porsius', 'Porsius, Erik', '', 52.5, NULL, '', '', '', 'EPORSIUS', ''),
  ('ic2026-017', 'Consultancy', 'Fouad Ararraz', 'Ararraz, Fouad', '', 52.5, NULL, '', '', '', 'FARARRAZ', ''),
  ('ic2026-018', 'Consultancy', 'Fikri Karabey', 'Karabey, Fikri', '', 62, NULL, '', '', '', 'FKARABEY', ''),
  ('ic2026-019', 'Consultancy', 'Hans Toonen', 'Toonen, Hans', '', 58, NULL, '', '', '', 'HTOONEN', ''),
  ('11162', 'Consultancy', 'Henk Baas', 'Baas, Henk', '', 64, NULL, '', '', '', 'HBAAS', ''),
  ('ic2026-020', 'Consultancy', 'Ibo Cam', 'Cam, Ibo', '', 77.25, NULL, '', '', '', 'ICAM', ''),
  ('10078', 'Software', 'Ingeborg Hoogenberg', 'Hoogenberg, Ingeborg', '', 76, NULL, '', '', '', 'IHOOGENBERG', ''),
  ('ic2026-021', 'Consultancy', 'Jaap de Vries', 'de Vries, Jaap', '', 47.5, NULL, '', '', '', 'JDEVRIES', ''),
  ('ic2026-022', 'Consultancy', 'Jan Tromp', 'Tromp, Jan', '', 62, NULL, '', '', '', 'JTROMP', ''),
  ('11168', 'Projects', 'Jelle Wassenberg', 'Wassenberg, Jelle', '', 47, NULL, '', '', '', 'JWASSENBERG', ''),
  ('ic2026-023', 'Spanje', 'Jorge Cristóbal Ascaso', 'Cristóbal Ascaso, Jorge', '', 35, NULL, '', '', '', 'JCRISTÓBALASCASO', ''),
  ('ic2026-024', 'Spanje', 'Jorge Gomez', 'Gomez, Jorge', '', 35, NULL, '', '', '', 'JGOMEZ', ''),
  ('ic2026-025', 'Spanje', 'López Yubero', 'Yubero, López', '', 35, NULL, '', '', '', 'LYUBERO', ''),
  ('ic2026-026', 'Spanje', 'Manuel Navarro Pérez', 'Navarro Pérez, Manuel', '', 35, NULL, '', '', '', 'MNAVARROPÉREZ', ''),
  ('ic2026-027', 'Consultancy', 'Marcel Menting', 'Menting, Marcel', '', 163.62, NULL, '', '', '', 'MMENTING', ''),
  ('ic2026-028', 'Spanje', 'Melchor Ballesta Honrubia', 'Ballesta Honrubia, Melchor', '', 35, NULL, '', '', '', 'MBALLESTAHONRUBIA', ''),
  ('11156', 'Projects', 'Milan van Opstal', 'van Opstal, Milan', '', 51, NULL, '', '', '', 'MVANOPSTAL', ''),
  ('ic2026-029', 'Consultancy', 'Muhammed Apaydin', 'Apaydin, Muhammed', '', 60, NULL, '', '', '', 'MAPAYDIN', ''),
  ('11132', 'Projects', 'Mustapha Aghbal', 'Aghbal, Mustapha', '', 46, NULL, '', '', '', 'MAGHBAL', ''),
  ('ic2026-030', 'Consultancy', 'Nikki Jansen', 'Jansen, Nikki', '', 62, NULL, '', '', '', 'NJANSEN', ''),
  ('ic2026-031', 'Consultancy', 'Nikolay Nikolov', 'Nikolov, Nikolay', '', 70, NULL, '', '', '', 'NNIKOLOV', ''),
  ('ic2026-032', 'Spanje', 'Óscar Planells', 'Planells, Óscar', '', 35, NULL, '', '', '', 'ÓPLANELLS', ''),
  ('ic2026-033', 'Consultancy', 'Pierre Driessen', 'Driessen, Pierre', '', 58, NULL, '', '', '', 'PDRIESSEN', ''),
  ('ic2026-034', 'Consultancy', 'Robert Stefan', 'Stefan, Robert', '', 45.9, NULL, '', '', '', 'RSTEFAN', ''),
  ('11138', 'Projects', 'Sam Ernst', 'Ernst, Sam', '', 46, NULL, '', '', '', 'SERNST', ''),
  ('ic2026-035', 'Consultancy', 'Stefan Lucian Vasilica', 'Lucian Vasilica, Stefan', '', 41, NULL, '', '', '', 'SLUCIANVASILICA', ''),
  ('11171', 'Projects', 'Walter van den Berg', 'van den Berg, Walter', 'Energy', 72, NULL, '', '', '', 'WVANDENBERG', ''),
  ('11143', 'Software', 'Willem Ploegstra', 'Ploegstra, Willem', '', 60, NULL, '', '', '', 'WPLOEGSTRA', ''),
  ('10215', 'Consultancy', 'Wouter Spaak', 'Spaak, Wouter', '', 101, NULL, '', '', '', 'WSPAAK', ''),
  ('ic2026-036', 'Consultancy', 'Zaman Mohammed', 'Mohammed, Zaman', '', 52, NULL, '', '', '', 'ZMOHAMMED', '');

COMMIT;
