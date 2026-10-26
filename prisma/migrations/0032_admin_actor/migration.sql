-- Admin API (lib/admin-api): staff actions are recorded in Event with their own
-- actor type. Additive only; existing rows and code are unaffected.
ALTER TYPE "ActorType" ADD VALUE 'ADMIN';
