# Aangan Studio — inbound enquiry system

The back half of the enquiry pipeline. The voice agent lives on Vaani and answers
the phone; everything it hands off lives here.

~200 enquiries a month arrive against two front-desk staff covering 10am–7pm.
About 48% got no response inside 48 hours and about a third arrived when nobody
was at the desk. An enquiry answered within the hour converts at roughly four
times the rate of one answered the next day, against a project worth ₹8–14 lakh.
**The money leaks out through silence, not competition.** Everything below exists
to close that gap and to prove, afterwards, whether it closed.

---

## What this is

| Piece | Where |
|---|---|
| `leads` + `alert_log` schema | `supabase/migrations/0001_init.sql` |
| Webhook from Vaani | `POST /api/vaani/webhook` |
| Service-area gate | `src/lib/service-area.ts` + `src/config/service-area.json` |
| Five-criterion rubric, re-derived in code | `src/lib/qualification.ts` + `src/config/qualification.json` |
| Independent pricing-leak detection | `src/lib/pricing-leak.ts` |
| Email handoff with Claim links | `src/lib/handoff-card.ts`, `src/lib/notify.ts` |
| Claim / Can't-take-it | `GET /api/claim/<signed token>` |
| 30-minute sweep + 15-minute escalation watchdog | `GET /api/cron/sweep` |
| Daily digest | `GET /api/cron/digest` |
| Dashboard | `/dashboard` |
| Seed (~120 leads over 60 days) | `scripts/seed.mjs` |
| Vaani replay harness | `scripts/replay-vaani.mjs` |

Not here, by design: the voice agent, its prompt and its knowledge base — those
live on Vaani. WhatsApp and the web form are out of scope, but `leads.channel`
is already an enum of `phone | whatsapp | web_form` so they attach later without
a migration.

---

## The six rules, and where each one is actually enforced

**1. Record before notify.** `src/app/api/vaani/webhook/route.ts` writes the row
and only then calls `notifyForLead`. Notification failures are caught, logged and
returned in the response body — never raised. If Resend is down the lead still
exists. A storage failure is the one case that returns 500, because that is the
one case where a Vaani retry is what we want.

**2. Idempotent on `vaani_call_id`.** Unique index in the database, upsert with
`onConflict: 'vaani_call_id'` in the route. A retry costs nothing. It also does
not re-notify: the route checks `handoff_sent_at` before sending, and every alert
is additionally guarded by `alert_log`. Only the columns the webhook maps are
written on conflict, so a retry cannot unclaim a lead a designer already took.

**3. The caller's phone number is never in a shared message.** Enforced, not
remembered: `assertNoPhoneNumber()` runs over the rendered subject, text body and
HTML body of every card and throws if anything resembling a number survived —
including a number the agent transcribed into a scope note or a referral name.
The number lives on `/dashboard/leads/<id>`, behind the dashboard password.

**4. Service area is resolved in code, from a config file.** `service-area.json`
is the only place a human edits. No model is consulted at request time. OUT is
evaluated before IN, matching is exact on word boundaries, and an unrecognised
locality returns `unknown` and flags the lead. **It never defaults to in-area.**

**5. `pricing_leaked` is an incident, not a metric.** It fires to the founder the
moment it is written, independently of where the lead is routed. The dashboard
shows it in red with "this must read zero". The seed sets it false on every row.

It is also not taken on trust. Relying on Vaani's own "Price revealed by agent"
field is the agent grading its own homework, so `src/lib/pricing-leak.ts` scans
the transcript for the figures and phrasings in `docs/pricing-guide.md` and can
raise a leak the agent reported as clean. It can never lower one. Attribution
matters more than detection here: a caller saying "my budget is 1.5 lakh" is the
budget field working as designed, and counting it would turn the one number that
must read zero into noise. Only the agent's own turns count, and a figure with
no speaker attached reports `unattributed`, which sets `needs_review` rather
than declaring an incident.

**6. No hard deletes.** `deleted_at` only. Every read filters on
`deleted_at is null`. The seed script is the single exception and it can only
remove rows whose `vaani_call_id` starts with `seed-`.

---

## The five criteria, decided twice

`docs/qualification-rubric.md` is Nikhil's rubric, and `docs/services.md` is what
the studio does and does not take on. Both are encoded in
`src/config/qualification.json` and applied by `src/lib/qualification.ts`, which
decides every lead a second time:

1. **A real project** - design and execution, not advice. Also catches the scope
   exclusions: architecture, standalone furniture sourcing, Vastu-only,
   restaurants, hotels, retail, gyms, and commercial work outside 500-3,000 sq ft.
2. **In the service area** - the gate above.
3. **A realistic timeline** - nothing can be ready in under six weeks.
4. **The right budget band** - only ever acts on a number the caller volunteered.
5. **The decision-maker on the call**, or properly represented.

And the three boundary rules, which matter more than the criteria themselves:
unclear on 1, 2 or 3 asks a question rather than declining; unclear on 4 or 5
treats the lead as qualified and notes it; two failures decline.

The agent on Vaani has already decided by the time the webhook fires. This runs
anyway, and when the two disagree the lead is flagged `rubric_disagrees` and a
human reads it. That is the brief's requirement that a model's opinion never
silently override a rule, and it is the cheapest early warning the studio has
that the agent's rubric has drifted. It is not treated as the agent being wrong:
the agent heard the call and this only sees extracted fields.

The tests for this run against the real September enquiries in
`data/september-2026-enquiries.txt` rather than invented ones, so each assertion
is checked against the outcome the front desk actually reached.

---

## Deployed at

| | |
|---|---|
| Dashboard | https://aangan-enquiry-system-noreply6.vercel.app/dashboard |
| Webhook | https://aangan-enquiry-system-noreply6.vercel.app/api/vaani/webhook |
| Components map | `docs/components-map.html` — open it, or print to A3 landscape |

Verified on production rather than assumed: the dashboard returns 401 without
the password and 200 with it, an unsigned POST to the webhook returns 401, and
`/api/cron/sweep` refuses without its bearer token and runs with it.

Vercel Deployment Protection is **off** on this project, deliberately. With it
on, Vaani's webhook POSTs are bounced to a Vercel login and the system can never
receive a call. The app carries its own auth instead: HMAC on the webhook, a
bearer token on the cron routes, signed tokens on the claim links, and basic
auth on the dashboard.

To redeploy: `bash scripts/deploy.sh`, or push to `main` once the project is
linked to the repo.

## Setup

Requires Node 20.9+.

```bash
npm install
cp .env.example .env.local     # then fill it in
npm test                       # 280 tests, no database needed
npm run dev
```

### Environment

| Variable | Needed for | If unset |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | everything | requests fail at runtime, build still succeeds |
| `SUPABASE_SERVICE_ROLE_KEY` | everything | same |
| `VAANI_WEBHOOK_SECRET` | webhook | every webhook is rejected with 401 |
| `RESEND_API_KEY` | email | dry-run: renders and logs the card, sends nothing |
| `EMAIL_FROM`, `HANDOFF_TO`, `ESCALATION_TO`, `FOUNDER_TO` | email | no recipients, send is skipped |
| `APP_BASE_URL` | links in email | falls back to the Vercel URL, then localhost |
| `CLAIM_LINK_SECRET` | claim links | cards send without Claim buttons rather than not at all |
| `CRON_SECRET` | the sweeps | the endpoints refuse to run (they will not run open) |
| `DASHBOARD_PASSWORD` | the dashboard | **the dashboard is public — set this before the first real call** |

The Supabase client is constructed lazily (`src/lib/supabase.ts`). Next's build
step imports every route module to collect page data, so a client built at import
time would turn a missing environment variable into a build failure instead of a
request-time one. `npm run build` succeeds with no environment at all — that is
the test.

### Database

Apply `supabase/migrations/0001_init.sql`. There are **no RLS policies**, which is
deliberate: RLS is on, policies are absent, so every role except `service_role` is
denied. All access is server-side with the service key. A policy granting `anon`
SELECT would publish every caller's phone number to anyone holding the publishable
key, which the browser already has.

### Seed

```bash
npm run seed                   # writes to Supabase
node scripts/seed.mjs --sql    # prints SQL instead, for the Supabase SQL editor
```

120 leads across 60 days, in two periods, because the comparison is the point.

**Before** is September 2026: the 40 real enquiries from the studio's own
anonymised log, transcribed into `scripts/september-2026.mjs`. Twenty phone
calls, ten WhatsApp threads, ten web form submissions, with the failures intact
- the 10:47pm call nobody answered, the enquiry that sat two days before anyone
replied, the WhatsApp thread that went four days and lost the lead's trust, the
Saturday message that was gone by Monday.

**After** is October, generated, with the agent answering.

Measured on the result:

| | before | after |
|---|---|---|
| median first response | 19 min | 17s |
| p90 first response | 50h | 14 min |
| answered within 5 min | 46% | 88% |
| never answered at all | 1 | 0 |

About a third of all enquiries arrive outside office hours, decline reasons
cluster on scope and service area, some callers pushed hard on price and booked
anyway, and `pricing_leaked` is false on all 120 rows.

One discrepancy, recorded rather than smoothed over: the studio quotes ~48% of
enquiries getting no response inside 48 hours across a full month of ~200. This
40-enquiry log is the studio's own curated sample and is kinder than that -
about an eighth went past two days. The tests assert what the log actually
supports, because a seed that lies about one figure makes every other figure on
the dashboard suspect.

The seed is deterministic, and it can only ever delete rows whose
`vaani_call_id` begins `seed-`.

---

## Wiring Vaani

The agent is live at **app.vaanivoice.ai**, agent ID
`42022c05-bc4f-4caa-87c9-b277292f4435`. Its prompt and knowledge base live
there, not here - `docs/services.md`, `docs/qualification-rubric.md` and
`docs/pricing-guide.md` are kept in this repo only because the code reads them:
the rubric drives the re-derivation, and the pricing figures drive leak
detection.

In the Vaani console, point the post-call webhook at:

```
POST https://<your-app>/api/vaani/webhook
```

Set the signing secret to the same value as `VAANI_WEBHOOK_SECRET`. Vaani must
sign the **raw request body** with HMAC-SHA256 and send the hex digest in
`X-Vaani-Signature` (`X-Signature` and `X-Hub-Signature-256` are also accepted,
with or without a `sha256=` prefix).

The extracted fields must keep these exact names — the mapper also accepts
snake_case equivalents and looks inside `extracted`, `extracted_fields`, `fields`,
`data`, `call`, `analysis` and a few other containers:

```
Caller name · Callback number · Locality · Property type and area ·
Scope of work · Current state of site · Timeline · Decision maker ·
How they found Aangan · Budget if volunteered · Consultation booked ·
Times price was asked · Price revealed by agent · Call outcome
```

Plus call metadata: `call_id`, `received_at` (**the ring, not the answer**),
`answered_at`, `duration_sec`, `recording_url`, `language`,
`telephony_cost_inr`, `voice_agent_cost_inr`.

Verify the whole chain without waiting for a phone to ring:

```bash
node --env-file=.env.local scripts/replay-vaani.mjs --url https://<your-app>
```

That posts a clean qualified call, a Talegaon call, an unrecognised locality, an
escalation, a pricing leak, a payload of pure junk, a near-empty payload, the same
call twice, and one forged signature — and prints what each one did.

---

## Deployment (Vercel)

Pin Next to **15.5.27 or later**. Vercel hard-blocks the build on vulnerable
versions and 15.5.4 is one of them.

**Vercel Hobby allows cron once per day.** A `*/10` schedule fails the build
outright. So `vercel.json` contains only the daily digest:

```json
{ "crons": [{ "path": "/api/cron/digest", "schedule": "0 3 * * *" }] }
```

The 30-minute unclaimed sweep needs an external scheduler. Point cron-job.org,
GitHub Actions, or any uptime pinger at:

```
GET https://<your-app>/api/cron/sweep
Authorization: Bearer <CRON_SECRET>
```

every 10 minutes. The endpoint is idempotent — every send is guarded by
`alert_log` — so calling it more often than necessary is harmless.

On Pro, move the sweep into `vercel.json` as `*/10 * * * *` and drop the external
scheduler.

---

## Tests

```bash
npm test
```

No database, no network, no mail server.

| File | Covers |
|---|---|
| `service-area.test.ts` | in, out, unknown, case and whitespace, "Talegaon near Pune", and the pairs that get misheard on a phone line |
| `vaani-mapper.test.ts` | valid, missing, null and junk for every field; the ring-vs-answer distinction |
| `webhook.test.ts` | valid, malformed, missing fields, duplicate id, bad signature, record-before-notify, routing, pricing incidents |
| `handoff-card.test.ts` | the card contents, escalations without Claim, reposts — and that no card can contain a phone number |
| `claim-race.test.ts` | two and five designers claiming at once; link signing and forgery |
| `routing-and-sweep.test.ts` | routing, the 30-minute repost timer, the 15-minute escalation watchdog, office hours in IST |
| `metrics.test.ts` | every number on the dashboard |
| `seed.test.ts` | the seed's distributions, and that `pricing_leaked` is false on all 120 rows |

---

## Where the brief was ambiguous, and what was chosen

The instruction was to fail safe — a lead preserved, a notification duplicated, a
number withheld. Each of these took that side.

**Handoff is email, not Telegram.** Asked for mid-build. Email cannot carry POST
buttons, so Claim and Can't-take-it are HMAC-signed one-click links. The
designer's identity is inside the signature, so a forwarded email cannot claim a
lead as someone else. The race is still settled by one conditional
`UPDATE ... WHERE claimed_at IS NULL`. Rule 3 is unchanged and now reads: the
number is never in the notification, whatever the channel.

**A decline on an unknown locality is escalated, not dropped.** The gate said "I
cannot place this". Treating "I don't know" as "no" is how a Kothrud project gets
turned away because the line was bad.

**An out-of-area word beats an in-area word in the same string.** "Mumbai client,
site in Baner" resolves out-of-area — and sets `needs_review`, because that one is
genuinely worth a second look. Driving to Lonavala costs more than a second look.

**An unreadable answer to "did you reveal a price" is treated as a leak.** Rule 5
says a leak is an incident; an incident we cannot rule out is one we look at.

**A webhook retry does not reset a human's work.** The upsert writes only the
columns the mapper produces, so `claimed_at`, `claimed_by` and the review fields
survive.

**Reposts stop after four.** Unbounded nagging gets filtered as noise, which is
worse than stopping.

**The repost waits for office hours; the escalation watchdog does not.** A lead
that arrives at 2am keeps ageing all night and reposts at 10am carrying its true
eight-hour age. An escalation is already the exception and wakes someone at any
hour.

**No fuzzy matching between localities.** Wakad and Warje are one phoneme apart on
a phone line, as are Pimple Saudagar and Pimple Nilakh. A matcher loose enough to
bridge that is loose enough to file a lead under the wrong locality silently.
Known misspellings are listed explicitly in the config; anything else is
`unknown`.

**A missing budget is never flagged.** The agent never asks. Null is the normal
value, not a defect.

**`became_project` is tri-state.** Null means "not known yet", not "no" — the
answer often arrives months later.

**A payload with no call id is still stored**, under a synthetic id and flagged
`missing_call_id`. Idempotency is lost for that one row. Losing the enquiry would
be worse.
