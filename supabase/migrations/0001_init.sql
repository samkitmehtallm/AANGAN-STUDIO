-- Aangan Studio — inbound enquiry system
--
-- One row per enquiry, never hard-deleted. The shape follows the brief:
-- the call, the caller and project, the decision, response and handoff, the
-- pricing guardrail, per-call cost, and human review.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums
-- channel exists so WhatsApp and the web form attach later without a
-- migration. Nothing but 'phone' is written today.
create type lead_channel as enum ('phone', 'whatsapp', 'web_form');

create type lead_language as enum ('english', 'hindi', 'marathi', 'mixed');

-- 'unknown' is a first-class value, not an absence. The gate must be able to
-- say "I could not place this" without that being mistaken for in-area.
create type lead_area as enum ('in_area', 'out_of_area', 'unknown');

create type lead_state as enum
  ('bare_shell', 'builder_handover', 'lived_in', 'under_renovation', 'unknown');

create type lead_decider as enum
  ('caller', 'caller_and_partner', 'represented', 'researching_for_others', 'unknown');

create type lead_result as enum ('qualified', 'declined', 'escalated', 'incomplete');

create type lead_push_outcome as enum ('booked', 'lost', 'undecided');

create type lead_review as enum
  ('agree', 'disagree_should_have_qualified', 'disagree_should_have_declined');

-- ---------------------------------------------------------------- leads
create table leads (
  lead_id uuid primary key default gen_random_uuid(),

  -- the call -----------------------------------------------------------
  -- vaani_call_id is UNIQUE: it is what makes a webhook retry free.
  vaani_call_id text not null unique,
  -- received_at is the RING, not the answer. Measuring from the answer would
  -- report a first response of zero and hide the delay this system exists to
  -- close.
  received_at timestamptz not null,
  answered_at timestamptz,
  channel lead_channel not null default 'phone',
  duration_sec integer,
  recording_url text,
  transcript_url text,
  transcript text,
  language lead_language,

  -- the caller and the project ------------------------------------------
  name text,
  phone text,
  locality text,
  -- Resolved in code from a config file, never inferred at request time.
  service_area lead_area not null default 'unknown',
  property_type text,
  carpet_area_sqft integer,
  scope text,
  current_state lead_state default 'unknown',
  timeline_target text,
  site_available_from text,
  decision_maker lead_decider default 'unknown',
  referral_source text,
  referral_name text,
  -- NULL is the normal value here. The agent never asks for a budget; this is
  -- only populated when a caller volunteers one.
  budget_volunteered text,

  -- the decision ---------------------------------------------------------
  result lead_result not null default 'incomplete',
  criteria_failed text[] not null default '{}',
  criteria_unclear text[] not null default '{}',
  decline_reason text,
  escalation_reason text,
  agent_confidence text,

  -- response and handoff --------------------------------------------------
  -- Generated, so it can never drift from the two timestamps it is derived
  -- from, and so nobody can write a flattering value into it.
  first_response_sec integer generated always as (
    case when answered_at is null then null
         else greatest(0, extract(epoch from (answered_at - received_at))::integer)
    end
  ) stored,
  handoff_sent_at timestamptz,
  claimed_by text,
  claimed_at timestamptz,
  passed_by text[] not null default '{}',
  consultation_booked boolean not null default false,
  consultation_at timestamptz,
  consultation_type text,
  -- The live agent sends "Consultation booked" as prose, not a boolean, so the
  -- agreed slot is kept verbatim for the handoff card.
  consultation_note text,
  -- Tri-state on purpose: null means "not known yet", not "no".
  became_project boolean,

  -- the pricing guardrail --------------------------------------------------
  pricing_asked_count integer not null default 0,
  -- Rule 5: this is an incident, not a metric. It must read zero.
  pricing_leaked boolean not null default false,
  outcome_after_push lead_push_outcome,

  -- cost -------------------------------------------------------------------
  telephony_cost_inr numeric(10,2) not null default 0,
  voice_agent_cost_inr numeric(10,2) not null default 0,
  total_cost_inr numeric(10,2) generated always as
    (telephony_cost_inr + voice_agent_cost_inr) stored,

  -- human review ------------------------------------------------------------
  reviewed_by text,
  reviewed_at timestamptz,
  review_verdict lead_review,
  review_note text,
  needs_review boolean not null default false,

  -- the payload exactly as it arrived, for everything we could not parse
  raw_payload jsonb,

  -- Rule 6: no hard deletes. Removal is a timestamp.
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_received_at_idx on leads (received_at desc);
create index leads_result_idx on leads (result);
create index leads_claimed_at_idx on leads (claimed_at);
-- Serves the 30-minute sweep directly: handed off and never claimed.
create index leads_unclaimed_idx on leads (handoff_sent_at) where claimed_at is null;
-- Partial, because the healthy state of this column is an empty set.
create index leads_pricing_leaked_idx on leads (pricing_leaked) where pricing_leaked = true;

comment on table leads is
  'One row per inbound enquiry. Never hard-deleted - use deleted_at. No RLS policies by design: reachable only via the service-role key from the server.';

-- ------------------------------------------------------------- alert_log
-- Exists so no alert fires twice.
create table alert_log (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(lead_id) on delete restrict,
  kind text not null,
  sent_at timestamptz not null default now(),
  detail jsonb
);

-- The dedup guard. NULLS NOT DISTINCT matters: the daily digest has no
-- lead_id, and under default NULL-distinct semantics every digest row would
-- be unique and the digest could fire repeatedly.
create unique index alert_log_lead_kind_key
  on alert_log (lead_id, kind) nulls not distinct;

comment on index alert_log_lead_kind_key is
  'Dedup guard: one alert of a given kind per lead, ever. Reposts encode their sequence number in kind.';

-- ------------------------------------------------------------------- RLS
-- Enabled with zero policies: deny by default for every role. The webhook,
-- the dashboard and the sweeps all run server-side with the service-role key,
-- which bypasses RLS. Granting anon SELECT here would publish every caller's
-- phone number to anyone holding the publishable key.
alter table leads enable row level security;
alter table alert_log enable row level security;
