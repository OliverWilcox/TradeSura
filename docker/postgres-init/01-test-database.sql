-- Runs once, when the volume is first created. Integration tests use their
-- own database, so they never touch the demo data in `tradesura`.
CREATE DATABASE tradesura_test OWNER tradesura;
