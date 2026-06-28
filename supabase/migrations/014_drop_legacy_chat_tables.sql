-- ============================================================
-- 014_drop_legacy_chat_tables.sql
-- Phase 2 — DESTRUCTIVE cleanup. Drops the old client-facing chat-assistant
-- and ad-hoc analytics tables that have no role in the new stylist inbox app.
-- Run LAST, after the new inbox tables are verified working.
--
-- Dropped (all out of scope per DECISIONS.md / MIGRATION/INVENTORY.md):
--   consultation_logs  — old "questions clients asked" sensor (had 37 test rows)
--   provider_qa        — old provider-approved-answers KB (never existed live)
--   unsupported_rules  — old chat "not offered" rules
--   analytics_events   — old ad-hoc analytics sink (new analytics is Phase 5)
--   handoff_requests   — old "send to Shen" requests
--
-- NOTE: this is irreversible. git history + MIGRATION/DB_SNAPSHOT.md are the
-- record of what existed. blocked_times is intentionally KEPT (feeds the
-- duration-aware availability picker).
-- ============================================================

drop table if exists public.consultation_logs cascade;
drop table if exists public.provider_qa        cascade;
drop table if exists public.unsupported_rules  cascade;
drop table if exists public.analytics_events   cascade;
drop table if exists public.handoff_requests   cascade;
