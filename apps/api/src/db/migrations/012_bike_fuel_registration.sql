-- Two more ruhsat fields worth tracking per vehicle:
--   fuel_type               — (P.3) Yakıt Türü (Benzin, Dizel, LPG, Elektrik…)
--   first_registration_date — (B) İlk Tescil Tarihi, stored ISO (YYYY-MM-DD)
ALTER TABLE bike ADD COLUMN fuel_type TEXT;
ALTER TABLE bike ADD COLUMN first_registration_date TEXT;
