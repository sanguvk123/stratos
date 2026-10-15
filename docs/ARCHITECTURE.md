# Abyssal — Architecture Document

> **Status:** Draft v1.0 — Pre-implementation  
> **Author:** Lead Architect (AI)  
> **Date:** 2026-10-15  
> **Scope:** Full-stack architecture for the Abyssal live rare-answer trivia game.  
> **Audience:** Implementation agents and human engineers.

---

## Table of Contents

1. [Project Overview and Brand](#1-project-overview-and-brand)
2. [Technology Stack](#2-technology-stack)
3. [Repository Structure](#3-repository-structure)
4. [Game State Machine](#4-game-state-machine)
5. [Database Schema](#5-database-schema)
6. [Answer Normalization Pipeline](#6-answer-normalization-pipeline)
7. [Scoring Algorithm](#7-scoring-algorithm)
8. [Real-Time Event Contracts](#8-real-time-event-contracts)
9. [API Surface](#9-api-surface)
10. [Security Boundaries](#10-security-boundaries)
11. [Scoring Exploit Mitigations](#11-scoring-exploit-mitigations)
12. [Implementation Phases and Task Breakdown](#12-implementation-phases-and-task-breakdown)
13. [Open Questions and Defaults](#13-open-questions-and-defaults)
14. [Known Limitations (MVP)](#14-known-limitations-mvp)
15. [ADR 0001: Architecture Decisions (supersedes conflicting sections above)](#15-adr-0001-architecture-decisions)
16. [Rolling-Cohort Scoring Plan and Gap List](#16-rolling-cohort-scoring-plan-and-gap-list)
17. [Krillion Research Notes](#17-krillion-research-notes)
18. [Pre-Implementation Gap Resolutions (amends §15–§16)](#18-pre-implementation-gap-resolutions)

> **Precedence rule.** Section 18 amends 15 and 16. Sections 15 and 16 amend sections 4, 5.11–5.15, 7, 8 and 11. Where they conflict, the higher-numbered section wins until sections 4–11 are patched. Section 17 is research input, and all its claims are unverified.

---

## 1. Project Overview and Brand

### 1.1 Working Name

**Abyssal** — a browser-based live trivia game where the depth of your knowledge determines how deep you dive.

### 1.2 Product Description

Abyssal is a real-time, browser-based trivia game in which players type free-text answers to open-ended questions and are rewarded not for being correct, but for being *rare*. Each game session ("dive") consists of seven questions. Players have 60 seconds per question to submit a single answer. The server evaluates every submitted answer against a canonical answer set, normalizes it, and assigns a rarity tier based on how many other players gave the same answer — blended with a historical prior to handle small-sample conditions. The rarer the answer, the deeper the dive and the higher the score. Players see a live provisional tier while the timer runs; final scores are locked server-side when the window closes. Two modes are supported: a Daily Challenge (one fixed question set per UTC day) and Unlimited Practice.

### 1.3 Core Differentiator vs. Krillion

Abyssal is an original brand and product. While the rare-answer trivia genre was popularized by Krillion, Abyssal differentiates on three axes:

1. **Hybrid scoring model** — Abyssal blends the live answer frequency of earlier players with a reviewed, versioned prior (`p = (C_prior + 1 + α × p_prior) / (N_prior + 1 + α)`, §7.1), so scores stay meaningful and stable from the very first player.
2. **Depth metaphor** — Scoring is expressed as ocean depth (total points × 10 metres), creating a visceral, shareable metric ("I dove 4,200 m today").
3. **Transparent tier system** — Six named tiers with fixed point values give players a clear mental model of rarity, rather than opaque percentile ranks.

---

## 2. Technology Stack

| Layer | Technology | Version Constraint | Rationale |
|---|---|---|---|
| Framework | Next.js (App Router) | `^14.2.0` | Server Components, Server Actions, built-in API routes, edge-ready |
| Language | TypeScript | `^5.4.0` | End-to-end type safety; shared types between client and server |
| Styling | Tailwind CSS | `^3.4.0` | Utility-first; no runtime CSS-in-JS overhead |
| Database | PostgreSQL | `>=15.0` (via Supabase) | JSONB, row-level security, full-text search, mature ecosystem |
| BaaS / Realtime | Supabase | `^2.x` JS client | Realtime channels, Auth, RLS, Storage — managed Postgres |
| Supabase JS | `@supabase/supabase-js` | `^2.43.0` | Official client; supports SSR cookie-based auth |
| Supabase SSR | `@supabase/ssr` | `^0.3.0` | Next.js App Router server-side auth helpers |
| Validation | Zod | `^3.23.0` | Runtime schema validation; infer TypeScript types from schemas |
| ORM / Query | Supabase PostgREST + raw SQL | — | PostgREST for simple CRUD; raw SQL via `supabase.rpc()` for complex queries |
| Unit Testing | Vitest | `^1.6.0` | Fast, ESM-native; compatible with Jest API |
| E2E Testing | Playwright | `^1.44.0` | Cross-browser; network interception for Realtime testing |
| Linting | ESLint | `^8.57.0` | `eslint-config-next` + `@typescript-eslint` |
| Formatting | Prettier | `^3.3.0` | Consistent code style |
| CI | GitHub Actions | — | Lint, type-check, unit tests, e2e on PR |
| Deployment | Vercel | — | Native Next.js 14 support; edge functions for latency-sensitive routes |
| Secrets | Vercel Environment Variables | — | `SUPABASE_SERVICE_ROLE_KEY` never exposed to client |

### 2.1 Key Dependency Decisions

- **No Prisma** — Supabase's PostgREST + typed RPC calls provide sufficient query ergonomics without the migration complexity of a separate ORM layer on top of Supabase.
- **No Redux / Zustand** — React Server Components + Supabase Realtime subscriptions handle all shared state. Client state is minimal (UI-only).
- **Vitest over Jest** — Faster cold starts; native ESM; identical API surface for migration if needed.

---

## 3. Repository Structure

```
abyssal/
├── .github/
│   └── workflows/
│       ├── ci.yml                  # Lint, typecheck, unit tests
│       └── e2e.yml                 # Playwright on PR
├── docs/
│   └── ARCHITECTURE.md             # This document
├── plans/                          # Implementation task plans
├── public/
│   └── fonts/
├── src/
│   ├── app/                        # Next.js App Router
│   │   ├── layout.tsx              # Root layout (font, providers)
│   │   ├── page.tsx                # Landing / home
│   │   ├── (game)/
│   │   │   ├── daily/
│   │   │   │   └── page.tsx        # Daily Challenge entry
│   │   │   ├── practice/
│   │   │   │   └── page.tsx        # Unlimited Practice entry
│   │   │   ├── session/
│   │   │   │   └── [sessionId]/
│   │   │   │       ├── page.tsx    # Active game screen (question + timer)
│   │   │   │       └── result/
│   │   │   │           └── page.tsx # Post-dive results
│   │   │   └── leaderboard/
│   │   │       └── page.tsx        # Global / daily leaderboard
│   │   ├── (auth)/
│   │   │   ├── login/
│   │   │   │   └── page.tsx
│   │   │   └── register/
│   │   │       └── page.tsx
│   │   ├── admin/
│   │   │   ├── layout.tsx          # Admin auth guard
│   │   │   ├── questions/
│   │   │   │   ├── page.tsx        # Question list
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx    # Question editor
│   │   │   └── challenges/
│   │   │       └── page.tsx        # Challenge management
│   │   └── api/
│   │       ├── session/
│   │       │   ├── route.ts        # POST /api/session (start/resume)
│   │       │   └── [sessionId]/
│   │       │       └── route.ts    # GET /api/session/:id
│   │       ├── challenge/
│   │       │   └── [challengeId]/
│   │       │       └── route.ts    # GET /api/challenge/:id
│   │       ├── question/
│   │       │   └── [roundId]/
│   │       │       └── route.ts    # GET /api/question/:roundId
│   │       ├── answer/
│   │       │   └── route.ts        # POST /api/answer (submit)
│   │       ├── score/
│   │       │   └── [roundId]/
│   │       │       └── route.ts    # GET /api/score/:roundId (provisional)
│   │       ├── finalize/
│   │       │   └── [roundId]/
│   │       │       └── route.ts    # POST /api/finalize/:roundId (internal/cron)
│   │       ├── result/
│   │       │   ├── round/
│   │       │   │   └── [roundId]/
│   │       │   │       └── route.ts
│   │       │   └── challenge/
│   │       │       └── [challengeId]/
│   │       │           └── route.ts
│   │       ├── leaderboard/
│   │       │   └── route.ts
│   │       ├── history/
│   │       │   └── route.ts
│   │       └── admin/
│   │           ├── questions/
│   │           │   └── route.ts
│   │           └── challenges/
│   │               └── route.ts
│   ├── components/
│   │   ├── ui/                     # Primitive UI (Button, Input, Badge, etc.)
│   │   ├── game/
│   │   │   ├── QuestionCard.tsx
│   │   │   ├── AnswerInput.tsx
│   │   │   ├── CountdownTimer.tsx
│   │   │   ├── TierBadge.tsx
│   │   │   ├── DepthMeter.tsx
│   │   │   ├── RevealCard.tsx
│   │   │   └── Leaderboard.tsx
│   │   ├── layout/
│   │   │   ├── Header.tsx
│   │   │   └── Footer.tsx
│   │   └── admin/
│   │       ├── QuestionForm.tsx
│   │       └── AliasManager.tsx
│   ├── domain/                     # Pure domain logic — no I/O, no DB
│   │   ├── scoring/
│   │   │   ├── engine.ts           # p_estimated formula, tier assignment
│   │   │   ├── tiers.ts            # Tier definitions and thresholds
│   │   │   └── depth.ts            # Depth conversion
│   │   ├── normalization/
│   │   │   ├── pipeline.ts         # Full normalization pipeline
│   │   │   ├── unicode.ts          # NFC normalization
│   │   │   ├── punctuation.ts      # Punctuation/spacing rules
│   │   │   └── typo.ts             # Levenshtein typo correction
│   │   └── statemachine/
│   │       ├── transitions.ts      # Legal state transitions
│   │       └── types.ts            # GameState enum and types
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts           # Browser Supabase client (anon key)
│   │   │   ├── server.ts           # Server Supabase client (service role)
│   │   │   └── middleware.ts       # Auth session refresh middleware
│   │   ├── realtime/
│   │   │   ├── channels.ts         # Channel name builders
│   │   │   └── hooks.ts            # useRealtimeChannel React hook
│   │   ├── zod/
│   │   │   └── schemas.ts          # Shared Zod schemas
│   │   └── utils.ts                # General utilities
│   ├── services/                   # Server-side game services (DB access)
│   │   ├── session.service.ts      # Create/resume game sessions
│   │   ├── challenge.service.ts    # Fetch/validate challenges
│   │   ├── submission.service.ts   # Accept, normalize, store answers
│   │   ├── scoring.service.ts      # Compute and persist scores
│   │   ├── finalization.service.ts # Lock round, publish results
│   │   ├── leaderboard.service.ts  # Leaderboard queries
│   │   └── admin.service.ts        # Admin CRUD operations
│   └── types/
│       ├── database.ts             # Supabase-generated DB types
│       ├── events.ts               # Realtime event payload types
│       └── api.ts                  # API request/response types
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   ├── 0001_initial_schema.sql
│   │   ├── 0002_rls_policies.sql
│   │   ├── 0003_scoring_config.sql
│   │   └── 0004_seed_questions.sql
│   └── seed/
│       ├── questions.sql
│       └── scoring_config.sql
├── tests/
│   ├── unit/
│   │   ├── scoring/
│   │   │   └── engine.test.ts
│   │   ├── normalization/
│   │   │   └── pipeline.test.ts
│   │   └── statemachine/
│   │       └── transitions.test.ts
│   ├── integration/
│   │   ├── submission.test.ts
│   │   ├── finalization.test.ts
│   │   └── leaderboard.test.ts
│   └── e2e/
│       ├── daily-challenge.spec.ts
│       ├── practice.spec.ts
│       └── admin.spec.ts
├── .env.local.example
├── .eslintrc.json
├── .prettierrc
├── next.config.ts
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── vitest.config.ts
```

---

## 4. Game State Machine

### 4.1 States

| State | Description | Lives In |
|---|---|---|
| `lobby` | Session created; waiting for challenge to begin | `game_sessions.state` |
| `question_active` | A question is live; timer running; submissions accepted | `question_rounds.state` |
| `question_closing` | Timer expired; submissions rejected; finalization in progress | `question_rounds.state` |
| `reveal` | Round finalized; the owning player's result is published (never other players' answers) | `question_rounds.state` |
| `challenge_complete` | All 7 questions done; final scores locked | `game_sessions.state` |

**State lives exclusively in the server database.** Clients receive state via Realtime events and API responses. No client-side state is authoritative.

### 4.2 Legal Transitions

```
lobby
  └─► question_active          (trigger: the player starts, i.e. the round-issuance transaction commits, §4.6)

question_active
  └─► question_closing         (trigger: now() >= closes_at; lazy on any touch or by the finalizer worker)

question_closing
  └─► reveal                   (trigger: finalization commits; it may wait for earlier cohort rounds, §11.6)

reveal
  ├─► question_active          (trigger: the player requests the next question, if question_index < 7)
  └─► challenge_complete       (trigger: question_index == 7, all rounds finalized)

any non-terminal session state
  └─► abandoned                (trigger: session idle past abandon_after_s, §4.6; terminal)
```

### 4.3 Illegal Transitions (Rejected)

| Attempted Transition | Rejection Reason |
|---|---|
| `lobby → reveal` | Must pass through `question_active` and `question_closing` |
| `question_active → challenge_complete` | Cannot skip finalization |
| `question_closing → question_active` | Cannot re-open a closing round |
| `reveal → lobby` | Sessions are not restarted |
| `challenge_complete → any` | Terminal state; immutable |
| Any backward transition | State machine is strictly forward-only |

### 4.4 Transition Enforcement

All state transitions are enforced in `src/domain/statemachine/transitions.ts` as a pure function:

```typescript
function assertTransition(from: GameState, to: GameState): void
```

This function throws a `InvalidStateTransitionError` if the transition is illegal. It is called by every service method that mutates state before any DB write. The DB also enforces state via a `CHECK` constraint on the `state` column using a PostgreSQL enum type.

### 4.5 Timer Authority

- `served_at` is the DB clock at the commit of the round-issuance transaction. `closes_at = served_at + 60 s`. Both are written once and never updated, with no exceptions (§4.6.4).
- **Closing is lazy plus backstopped.** Any request touching a round past `closes_at` moves it to `question_closing` and attempts finalization. A scheduled worker (Supabase `pg_cron` or an Edge Function, interval `finalizer_interval_s`, default 5) does the same for rounds nobody touches. The worker runs a bounded retry with logging, and an alert fires for any round still unfinalized `finalize_alert_after_s` (default 120) past its deadline. Vercel free-tier cron (60 s minimum) is not sufficient on its own.
- `finalize_grace_ms` (default 250) is added to `closes_at` before a round may finalize, so an in-flight write that took the row lock just before the deadline commits first.
- The client countdown is display-only. It is initialized from the server `closes_at` and corrected with a server-clock offset taken from every API response, and it controls no game logic.

### 4.6 Round issuance and the clock-start contract

**Definition.** The clock starts at the **commit of the round-issuance transaction**. That is the only event the server can observe, because it cannot know whether a browser received or rendered the response.

1. **Issue.** `POST /api/session/:id/round` runs, in one transaction: lock the session row, return the existing round for the next `question_index` if one exists (same `round_id`, `served_at` and `closes_at`), otherwise insert with `served_at = clock_timestamp()` and `closes_at = served_at + 60 s`. Retries and multiple tabs therefore get the same round and the same deadline.
2. **Reconnect.** `GET /api/session/:id/state` returns the current round with the original `closes_at`. A reconnect never restarts or extends the timer.
3. **Server-side failure.** If the transaction rolls back, no round exists and no clock runs. The client retries safely, because issuance is idempotent.
4. **Lost response (the hard case).** The server cannot know whether a browser received or rendered a committed response, so it never infers "not delivered". Policy: **idempotent retrieval only. A round is never re-issued, rewritten or reset.** (An earlier draft proposed an in-place re-issue. It was withdrawn on review because a client cannot prove it never saw a response.)
   - Issuance and `GET /api/session/:id/state` always return the existing round with its original `round_id`, `served_at` and `closes_at`. The client retries automatically after a lost response, and a successful fetch with a lost acknowledgement looks the same as any other retry.
   - A client-side "I never saw it" claim is never evidence. `first_fetched_at` records the first read for **diagnostics and monitoring only**. It never affects eligibility, scoring or ordering.
   - If the player never retrieves the round, it finalizes normally as unanswered: 0 points and no cohort vote. **Accepted cost: that question is lost.**
   - Because nothing is rewritten, retrieval cannot change the order of already-finalized rounds, create a second candidate or cohort position, or reset a deadline. Every retrieval is authorized against the owning session identity, and issuance runs under the session row lock.
   - A state-based recovery (for example a documented server-side failure window) may be added later, but only with a written reason and tests.
   - **Required tests (before Task G is accepted):** a lost response after commit (retry returns the same round and deadline); a successful fetch with a lost acknowledgement; duplicate concurrent issuance requests; retrieval after the deadline (returns the closed round, never a new one); retrieval racing finalization; a second user cannot retrieve someone else's round.
5. **Why the cohort order cannot be violated.** Rounds are ordered by `(closes_at, id)`, and `closes_at = served_at + 60 s`, where `served_at` is the DB clock at commit. A round is created only at issuance and is never rewritten (point 4), so a new round's `closes_at` is always later than `now()`, and therefore later than any round that has already passed its own deadline and could be finalizing. A round can therefore never appear **before** one that has already been finalized. A round with an earlier `closes_at` that is still open simply blocks later rounds until it is finalized (§7.6). The invariant depends on a monotonic DB clock, so Task F must confirm that `clock_timestamp()` is read from a single primary, and a test must assert that no `final_answers.cohort_sequence` is ever out of `closes_at` order.
6. **Between questions.** After `reveal`, the next question is available after `reveal_window_s` (default 10, OQ-1). A player may take longer, but a session idle for more than `abandon_after_s` (default 300) is marked `abandoned`: the unserved questions score 0 and the result is stored as incomplete, shown on neither the ranked leaderboard nor in priors. Unserved questions have no round row, so an abandoned session can never block a cohort.

---

## 5. Database Schema

All tables use `UUID` primary keys generated by `gen_random_uuid()`. All timestamps are `TIMESTAMPTZ` stored in UTC. Soft deletes use `deleted_at TIMESTAMPTZ NULL`.

### 5.1 `users`

Managed by Supabase Auth. Extended via `player_profiles`.

```sql
-- Supabase auth.users (managed, not custom)
-- Referenced by player_profiles.user_id
```

### 5.2 `player_profiles`

```sql
CREATE TABLE player_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name    TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 32),
  is_guest        BOOLEAN NOT NULL DEFAULT false,
  -- Guests are Supabase anonymous users (user_id is set); there is no client-generated guest token (§11.4)
  total_dives     INTEGER NOT NULL DEFAULT 0,
  total_depth_m   INTEGER NOT NULL DEFAULT 0,     -- cumulative depth in metres
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_player_profiles_user_id ON player_profiles(user_id);
```

**Constraints:**
- `user_id` is `NOT NULL`: every player, guest or registered, is an `auth.users` row (anonymous sign-in for guests).
- `display_name` is unique per non-guest user (enforced at application layer; guests get auto-generated names).

### 5.3 `questions`

```sql
CREATE TABLE questions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL,           -- human-readable identifier
  current_version INTEGER NOT NULL DEFAULT 1,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
```

### 5.4 `question_versions`

```sql
CREATE TABLE question_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id     UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  prompt_text     TEXT NOT NULL CHECK (char_length(prompt_text) BETWEEN 10 AND 500),
  hint_text       TEXT,
  category        TEXT NOT NULL,
  difficulty      TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (question_id, version)
);

CREATE INDEX idx_question_versions_question_id ON question_versions(question_id);
CREATE INDEX idx_question_versions_active ON question_versions(question_id) WHERE is_active = true;
```

### 5.5 `canonical_answers`

```sql
CREATE TABLE canonical_answers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id     UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  canonical_text  TEXT NOT NULL,                  -- normalized form
  display_text    TEXT NOT NULL,                  -- human-readable form for reveal
  is_primary      BOOLEAN NOT NULL DEFAULT false, -- one primary per question
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (question_id, canonical_text)
);

CREATE INDEX idx_canonical_answers_question_id ON canonical_answers(question_id);
```

### 5.6 `answer_aliases`

```sql
CREATE TABLE answer_aliases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_answer_id UUID NOT NULL REFERENCES canonical_answers(id) ON DELETE CASCADE,
  alias_text      TEXT NOT NULL,                  -- normalized alias
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (canonical_answer_id, alias_text)
);

CREATE INDEX idx_answer_aliases_canonical_answer_id ON answer_aliases(canonical_answer_id);
-- Lookup index: given a normalized alias, find the canonical answer
CREATE INDEX idx_answer_aliases_alias_text ON answer_aliases(alias_text);
```

### 5.7 `prior_snapshots` and `prior_snapshot_values`

The mutable `answer_priors` table is replaced by **immutable snapshots**, so a score can always be explained after priors change (§18.6).

```sql
CREATE TABLE prior_snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_version_id UUID NOT NULL REFERENCES question_versions(id),
  source              TEXT NOT NULL CHECK (source IN ('editorial', 'computed')),
  observation_count   BIGINT NOT NULL DEFAULT 0,   -- N used for a 'computed' snapshot
  created_by          UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE prior_snapshot_values (
  prior_snapshot_id   UUID NOT NULL REFERENCES prior_snapshots(id),
  canonical_answer_id UUID NOT NULL REFERENCES canonical_answers(id),
  prior_ppm           INTEGER NOT NULL CHECK (prior_ppm >= 500),   -- parts per million; integer, never float
  PRIMARY KEY (prior_snapshot_id, canonical_answer_id)
);

CREATE INDEX idx_prior_snapshots_qv ON prior_snapshots(question_version_id, created_at DESC);
```

- A snapshot is **immutable** (trigger, §5.20). A new nightly or editorial prior creates a new snapshot. A challenge pins one snapshot per question at publication (`challenge_questions.prior_snapshot_id`).
- **Publication check:** for each snapshot used by a question, `SUM(prior_ppm) = 1,000,000` exactly, and every canonical answer of the question version has a row. A question that fails this cannot be published.
- A `computed` snapshot is built from earlier `final_answers` with `in_cohort`, excluding guests unless `priors_include_guests` is set (§7.2).

### 5.8 `challenges`

```sql
CREATE TYPE challenge_mode AS ENUM ('daily', 'practice');

CREATE TABLE challenges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode            challenge_mode NOT NULL,
  challenge_date  DATE,                           -- NULL for practice
  starts_at       TIMESTAMPTZ,                    -- NULL for practice (player-initiated)
  is_published    BOOLEAN NOT NULL DEFAULT false,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mode, challenge_date)                   -- one daily per UTC date
);

CREATE INDEX idx_challenges_mode_date ON challenges(mode, challenge_date);
CREATE INDEX idx_challenges_published ON challenges(is_published) WHERE is_published = true;
```

### 5.9 `challenge_questions`

```sql
CREATE TABLE challenge_questions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id    UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  question_id     UUID NOT NULL REFERENCES questions(id),
  question_version INTEGER NOT NULL,
  question_index  SMALLINT NOT NULL CHECK (question_index BETWEEN 1 AND 7),
  UNIQUE (challenge_id, question_index)
);

CREATE INDEX idx_challenge_questions_challenge_id ON challenge_questions(challenge_id);
```

### 5.10 `game_sessions`

```sql
CREATE TYPE session_state AS ENUM ('lobby', 'active', 'challenge_complete');

CREATE TABLE game_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_profile_id   UUID NOT NULL REFERENCES player_profiles(id),
  challenge_id        UUID NOT NULL REFERENCES challenges(id),
  state               session_state NOT NULL DEFAULT 'lobby',
  current_question_index SMALLINT NOT NULL DEFAULT 0,
  total_points        INTEGER NOT NULL DEFAULT 0,
  total_depth_m       INTEGER NOT NULL DEFAULT 0,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_profile_id, challenge_id)        -- one session per player per challenge
);

CREATE INDEX idx_game_sessions_player ON game_sessions(player_profile_id);
CREATE INDEX idx_game_sessions_challenge ON game_sessions(challenge_id);
CREATE INDEX idx_game_sessions_state ON game_sessions(state);
```

### 5.11 `question_rounds`

```sql
CREATE TYPE round_state AS ENUM ('question_active', 'question_closing', 'reveal');

-- A row exists only for a question the player has actually been issued (§4.6).
CREATE TABLE question_rounds (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_session_id       UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  challenge_question_id UUID NOT NULL REFERENCES challenge_questions(id),
  question_index        SMALLINT NOT NULL,
  is_ranked             BOOLEAN NOT NULL,
  state                 round_state NOT NULL DEFAULT 'question_active',
  served_at             TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),  -- DB clock at issuance commit
  closes_at             TIMESTAMPTZ NOT NULL,
  first_fetched_at      TIMESTAMPTZ,                  -- diagnostics only; never affects eligibility, scoring or ordering (§4.6.4)
  voided_reason         TEXT CHECK (voided_reason IN ('MODERATION')),
  finalized_at          TIMESTAMPTZ,
  UNIQUE (game_session_id, question_index),
  CHECK (closes_at = served_at + INTERVAL '60 seconds')
);

-- served_at and closes_at are written once and never updated (a BEFORE UPDATE trigger enforces it).
-- A round is never re-issued or rewritten (§4.6.4).
-- Cohort order and the finalizer's pending scan:
CREATE INDEX idx_question_rounds_cohort ON question_rounds(challenge_question_id, closes_at, id)
  WHERE is_ranked;
CREATE INDEX idx_question_rounds_pending ON question_rounds(closes_at)
  WHERE state <> 'reveal';
CREATE INDEX idx_question_rounds_session ON question_rounds(game_session_id);
```

### 5.12 `answer_submissions`

```sql
-- APPEND-ONLY history of every attempt, accepted or rejected. It is never updated.
CREATE TABLE answer_submissions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_round_id     UUID NOT NULL REFERENCES question_rounds(id) ON DELETE CASCADE,
  game_session_id       UUID NOT NULL REFERENCES game_sessions(id),
  request_id            UUID NOT NULL,              -- client-generated; unique within the session (§18.5)
  payload_hash          BYTEA NOT NULL,             -- sha256(round_id || raw_text || expected_candidate_version)
  raw_text              TEXT CHECK (char_length(raw_text) <= 200),  -- exactly as typed; nulled by retention (§5.20)
  normalized_text       TEXT,
  canonical_answer_id   UUID REFERENCES canonical_answers(id),
  normalization_version INTEGER NOT NULL,
  matched_via           TEXT CHECK (matched_via IN ('alias','canonical','typo_correction')),
  rejection_reason      TEXT,                       -- NULL if accepted
  candidate_version_after INTEGER,                  -- set only when accepted
  submitted_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (game_session_id, request_id)
);

CREATE INDEX idx_answer_submissions_round ON answer_submissions(question_round_id, submitted_at);

-- EXACTLY ONE current candidate per round. This is the only table the scoring paths read.
-- A rejected (invalid) guess never touches it, so it does not consume the attempt.
CREATE TABLE round_candidates (
  question_round_id     UUID PRIMARY KEY REFERENCES question_rounds(id) ON DELETE CASCADE,
  canonical_answer_id   UUID NOT NULL REFERENCES canonical_answers(id),
  normalization_version INTEGER NOT NULL,
  candidate_version     INTEGER NOT NULL,           -- optimistic concurrency token (§18.5)
  revision_count        SMALLINT NOT NULL DEFAULT 1,
  source_submission_id  UUID NOT NULL REFERENCES answer_submissions(id),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
```

### 5.13 `final_answers`

```sql
-- Immutable snapshot of the accepted answer after round closes
CREATE TABLE final_answers (
  question_round_id     UUID PRIMARY KEY REFERENCES question_rounds(id),
  challenge_question_id UUID NOT NULL REFERENCES challenge_questions(id),
  player_profile_id     UUID NOT NULL REFERENCES player_profiles(id),
  canonical_answer_id   UUID REFERENCES canonical_answers(id),     -- NULL = unanswered
  normalization_version INTEGER,                                    -- copied from the candidate, never recomputed
  cohort_sequence       BIGINT NOT NULL,                            -- assigned under the cohort lock, in (closes_at, id) order
  in_cohort             BOOLEAN NOT NULL,                           -- ranked AND not voided AND not excluded by config or moderation
  closes_at             TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (challenge_question_id, cohort_sequence),
  UNIQUE (challenge_question_id, player_profile_id)
);

-- Cohort query: C_prior and N_prior for sequence S (current round excluded by `< S`)
--   SELECT canonical_answer_id, count(*) FROM final_answers
--   WHERE challenge_question_id = $1 AND cohort_sequence < $S
--     AND in_cohort AND canonical_answer_id IS NOT NULL
--   GROUP BY canonical_answer_id;
CREATE INDEX idx_final_answers_cohort
  ON final_answers(challenge_question_id, cohort_sequence)
  WHERE in_cohort AND canonical_answer_id IS NOT NULL;
```

### 5.14 `question_cohorts`, `provisional_counts`, `provisional_display_state`

The old `scoring_snapshots` table is removed. Its role is split in two. The **final** path owns `question_cohorts` plus the immutable `final_answers` and `player_question_scores`. The **provisional** path owns the mutable cache tables below. The final path never reads the cache, and the provisional path never writes a final score (§7.8).

```sql
-- One row per challenge question. It is the serialization point for finalization (§11.6) and
-- hands out cohort_sequence numbers. Created in the transaction that publishes the challenge.
CREATE TABLE question_cohorts (
  challenge_question_id UUID PRIMARY KEY REFERENCES challenge_questions(id),
  next_sequence         BIGINT NOT NULL DEFAULT 1,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- PROVISIONAL ONLY. Mutable cache of current candidates, maintained in the same transaction
-- as each candidate write. A revision decrements the old answer and increments the new one.
CREATE TABLE provisional_counts (
  challenge_question_id UUID NOT NULL REFERENCES challenge_questions(id),
  canonical_answer_id   UUID NOT NULL REFERENCES canonical_answers(id),
  answer_count          INTEGER NOT NULL CHECK (answer_count >= 0),
  PRIMARY KEY (challenge_question_id, canonical_answer_id)
);

-- PROVISIONAL ONLY. Deterministic display hysteresis state (§7.8).
CREATE TABLE provisional_display_state (
  question_round_id     UUID PRIMARY KEY REFERENCES question_rounds(id) ON DELETE CASCADE,
  displayed_tier        SMALLINT CHECK (displayed_tier BETWEEN 1 AND 6),
  pending_tier          SMALLINT CHECK (pending_tier BETWEEN 1 AND 6),
  pending_count         SMALLINT NOT NULL DEFAULT 0,
  last_emitted_at       TIMESTAMPTZ
);
```

`provisional_counts` can be rebuilt at any time from `round_candidates`, so drift is repairable. Counts of voided or moderation-excluded rounds are decremented when the round is voided or flagged.

### 5.15 `player_question_scores`

```sql
-- Final, locked score per player per question round
CREATE TABLE player_question_scores (
  question_round_id       UUID PRIMARY KEY REFERENCES question_rounds(id),
  game_session_id         UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  player_profile_id       UUID NOT NULL REFERENCES player_profiles(id),
  challenge_question_id   UUID NOT NULL REFERENCES challenge_questions(id),
  -- Provenance (§18.6): everything needed to recompute this score byte-for-byte.
  question_version_id     UUID NOT NULL REFERENCES question_versions(id),
  scoring_config_version  INTEGER NOT NULL REFERENCES scoring_config_versions(version),
  prior_snapshot_id       UUID NOT NULL REFERENCES prior_snapshots(id),
  cohort_sequence         BIGINT NOT NULL,
  canonical_answer_id     UUID REFERENCES canonical_answers(id),        -- NULL = unanswered or invalid
  alpha                   INTEGER NOT NULL,
  prior_ppm               INTEGER,
  population_size         BIGINT NOT NULL CHECK (population_size >= 0), -- N_prior
  matching_answer_count   BIGINT NOT NULL CHECK (matching_answer_count >= 0), -- C_prior
  p_numerator             NUMERIC(40,0),
  p_denominator           NUMERIC(40,0),
  p_display               NUMERIC(12,9),                                -- display only, never decides a tier
  tier                    SMALLINT CHECK (tier BETWEEN 1 AND 6),
  points                  SMALLINT NOT NULL CHECK (points IN (0,10,15,30,60,85,100)),
  depth_m                 INTEGER NOT NULL,
  popularity_kind         TEXT NOT NULL CHECK (popularity_kind IN ('shown','under_one_percent','none_earlier','suppressed')),
  popularity_percent      SMALLINT CHECK (popularity_percent BETWEEN 1 AND 100),  -- set only when kind = 'shown' (§7.9)
  finalized_at            TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (depth_m = points * 10),
  CHECK ((canonical_answer_id IS NULL) = (tier IS NULL)),
  CHECK ((tier IS NULL) = (points = 0)),
  UNIQUE (game_session_id, challenge_question_id)
);

CREATE INDEX idx_player_question_scores_session ON player_question_scores(game_session_id);
CREATE INDEX idx_player_question_scores_cq ON player_question_scores(challenge_question_id);
```

### 5.16 `player_challenge_results`

```sql
-- Aggregated final result per player per challenge
CREATE TABLE player_challenge_results (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_session_id     UUID NOT NULL UNIQUE REFERENCES game_sessions(id),
  player_profile_id   UUID NOT NULL REFERENCES player_profiles(id),
  challenge_id        UUID NOT NULL REFERENCES challenges(id),
  total_points        INTEGER NOT NULL DEFAULT 0,
  total_depth_m       INTEGER NOT NULL DEFAULT 0,
  rank                INTEGER,                    -- computed post-finalization
  completed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_profile_id, challenge_id)
);

CREATE INDEX idx_player_challenge_results_challenge ON player_challenge_results(challenge_id);
CREATE INDEX idx_player_challenge_results_player ON player_challenge_results(player_profile_id);
-- Leaderboard index
CREATE INDEX idx_player_challenge_results_leaderboard
  ON player_challenge_results(challenge_id, total_depth_m DESC);
```

### 5.17 `scoring_config_versions`

```sql
CREATE TABLE scoring_config_versions (
  version                       INTEGER PRIMARY KEY,
  alpha                         INTEGER NOT NULL CHECK (alpha > 0),
  threshold_ppm                 INTEGER[] NOT NULL,                       -- 6 lower bounds, tier 1..6, strictly descending, last = 0
  points                        SMALLINT[] NOT NULL DEFAULT '{10,15,30,60,85,100}',
  popularity_min_sample         INTEGER NOT NULL DEFAULT 30,
  provisional_hold_evaluations  SMALLINT NOT NULL DEFAULT 2,
  provisional_min_interval_ms   INTEGER NOT NULL DEFAULT 1000,
  max_candidate_revisions       SMALLINT NOT NULL DEFAULT 5,
  cohort_include_guests         BOOLEAN NOT NULL DEFAULT true,
  priors_include_guests         BOOLEAN NOT NULL DEFAULT false,
  validation_status             TEXT NOT NULL DEFAULT 'draft'
                                CHECK (validation_status IN ('draft','validated_simulated_only')),
  frozen_at                     TIMESTAMPTZ,                              -- once set, the row is immutable
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (array_length(threshold_ppm, 1) = 6 AND array_length(points, 1) = 6),
  CHECK (threshold_ppm[6] = 0)
);
```

A config can be pinned by a challenge only after `frozen_at` is set, and `frozen_at` can be set only when `validation_status = 'validated_simulated_only'`, i.e. after the §7.11 gate and review gate 1. Point values are fixed in code and checked against this column. Changing a threshold means a new version, never an edit.

**Example `threshold_ppm` (the PLACEHOLDER values of §7.3, not validated):** `{300000, 150000, 50000, 10000, 1000, 0}`.

### 5.18 `audit_events`

```sql
CREATE TABLE audit_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      TEXT NOT NULL,
  actor_id        UUID,                           -- user or service
  target_table    TEXT,
  target_id       UUID,
  payload         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_events_type ON audit_events(event_type);
CREATE INDEX idx_audit_events_target ON audit_events(target_table, target_id);
CREATE INDEX idx_audit_events_created ON audit_events(created_at DESC);
```

### 5.19 `challenge_participants`

```sql
CREATE TABLE challenge_participants (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id        UUID NOT NULL REFERENCES challenges(id),
  player_profile_id   UUID NOT NULL REFERENCES player_profiles(id),
  joined_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (challenge_id, player_profile_id)
);

CREATE INDEX idx_challenge_participants_challenge ON challenge_participants(challenge_id);
```

### 5.20 Schema amendments and additional tables

These amend the tables above to match §15–§18 and the patched §4, §7, §8 and §11. Task F writes them into the real migrations.

**Amendments to existing tables**

| Table | Change |
|---|---|
| `canonical_answers`, `answer_aliases` | Add `question_version_id` (FK to `question_versions`) and move uniqueness to `(question_version_id, ...)`. Rows are **immutable once the version is published**. Editing creates a new version. Required so a finalized score stays explainable after an editorial change. |
| `question_versions` | Add `status` (`draft` / `reviewed` / `published` / `retired`) and `answer_set_policy` (`closed` for the MVP). Publishing runs the validation of §18.7: priors sum to exactly 1,000,000 ppm and no unresolved ambiguous alias. |
| `challenges` | Add `scoring_config_version` (FK, pinned at publication), `challenge_version`, `timezone` (default `UTC`). A published daily is never mutated. |
| `challenge_questions` | Add `question_version_id` and `prior_snapshot_id` (both `NOT NULL`, pinned at publication). Add `is_ranked`, copied from the challenge mode. |
| `game_sessions` | Add `event_version BIGINT NOT NULL DEFAULT 0` (§8.1), `last_activity_at`, `is_ranked`. Extend `session_state` with `abandoned`. |
| `player_challenge_results` | Written only for **completed ranked** sessions. Abandoned and practice sessions never appear on a ranked leaderboard. Rank is shared: `1 + count(strictly higher total_points)` (§7.5). |
| `player_profiles` | `guest_token` is **removed**. Guests are Supabase anonymous sign-ins (§11.4). |
| `moderation_events` | `challenge_question_id`, `question_round_id`, `kind`, `detail JSONB`, `created_at`. Admin-only. |

**Immutability.** `prior_snapshots`, `prior_snapshot_values`, `final_answers`, `player_question_scores` and any frozen `scoring_config_versions` row are protected by `BEFORE UPDATE OR DELETE` triggers that raise an exception. Corrections are written as a new row plus an `audit_events` entry, never as an edit.

**Practice reference population (§18.9)**

```sql
-- Frozen when a daily challenge's last round finalizes. Practice reads these, never live data.
CREATE TABLE practice_reference_snapshots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_version_id   UUID NOT NULL REFERENCES question_versions(id),
  prior_snapshot_id     UUID NOT NULL REFERENCES prior_snapshots(id),
  source_challenge_id   UUID REFERENCES challenges(id),   -- NULL = first-day fallback (reviewed prior only)
  population_size       BIGINT NOT NULL CHECK (population_size >= 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (question_version_id, source_challenge_id)
);

CREATE TABLE practice_reference_counts (
  snapshot_id           UUID NOT NULL REFERENCES practice_reference_snapshots(id),
  canonical_answer_id   UUID NOT NULL REFERENCES canonical_answers(id),
  answer_count          BIGINT NOT NULL CHECK (answer_count >= 0),
  PRIMARY KEY (snapshot_id, canonical_answer_id)
);
```

A practice score uses `C_prior` and `N_prior` from the snapshot, adds the player's answer once, and runs the same pure function (§7.1, §7.10). With no snapshot (the first day) the counts are zero and the reviewed prior carries the score. Practice rows go in `practice_scores`, a table separate from `player_question_scores`, so they can never enter a ranked cohort, a leaderboard or a prior.

**Guest recovery and admin access**

```sql
CREATE TABLE guest_recovery_codes (
  player_profile_id UUID PRIMARY KEY REFERENCES player_profiles(id) ON DELETE CASCADE,
  code_hash         BYTEA NOT NULL,           -- hash only; the plaintext is shown once
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at           TIMESTAMPTZ
);

CREATE TABLE admin_roles (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('editor','publisher','scoring_admin')),
  granted_by UUID REFERENCES auth.users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role)
);
```

Publishing questions needs `publisher`. Editing priors or scoring config needs `scoring_admin`. Every admin write appends to `audit_events`.

**Retention.** `answer_submissions.raw_text` is nulled by a scheduled job after `raw_text_retention_days` (default 30). Everything needed to reproduce a score (canonical answer, normalization version, counts, priors, config) lives in `final_answers` and `player_question_scores` and is kept. Moderation events are kept 180 days. Guest profiles with no completed ranked result are deleted after 90 days of inactivity.

---

## 6. Answer Normalization Pipeline

The pipeline is a pure, deterministic function: `matchAnswer(rawText, index)` in `src/domain/normalization/pipeline.ts`. It returns either a `canonicalAnswerId` or a structured rejection reason. **No I/O, clock, randomness or LLM is involved.** The closed answer set for a question version is supplied as a pre-built `AnswerIndex` (`src/domain/normalization/answer-index.ts`).

**Implemented and tested (Task D).** Where the numbered steps below differ from the code, the code and its tests are authoritative. The differences are deliberate refinements:

- **Typographic and invisible characters.** All apostrophes and quotation marks (straight and typographic) are removed anywhere in the text. All dash variants become a space. Zero-width characters, soft hyphens and the BOM are removed. Unpaired surrogates are dropped from the normalized form.
- **Idempotence.** `normalizeAnswerText` is applied until it stops changing, so `normalize(normalize(x)) = normalize(x)`. The same function normalizes player input and every canonical answer and alias when the index is built, so two texts match exactly when they normalize to the same string. Any change to its output bumps `NORMALIZATION_VERSION`, and accepted candidates store the version (§7.10).
- **Length.** The 200 limit counts Unicode code points, not UTF-16 units, and an enormous input is rejected without counting it.
- **Ambiguity is caught at publication, not play.** `analyzeAnswerSet` reports every problem at once: `NO_ANSWERS`, `DUPLICATE_ANSWER_ID`, `EMPTY_TEXT`, `TEXT_TOO_LONG`, `DUPLICATE_CANONICAL_TEXT`, `AMBIGUOUS_ALIAS` (an alias claimed by two answers, or equal to another answer's canonical text). `buildAnswerIndex` refuses an unsafe set, so ambiguous aliases cannot reach ranked play.
- **Typo correction (step 7) is stricter than first drafted.** Reachability by one edit counts insertions and deletions, and counts aliases of other answers too, but it can only ever **block** a correction. A correction is accepted only if exactly one answer is reachable, it is reached through its **canonical** text (never through an alias), the edit is a substitution or an adjacent transposition, and both the input and the target have at least 6 code points. Two reachable answers give `AMBIGUOUS_TYPO`.

### 6.1 Pipeline Steps

```
Input: raw_text (string), question_id (UUID)
       lookup_maps: { aliases: Map<string, UUID>, canonicals: Map<string, UUID> }

Step 1: Trim whitespace
  - raw_text.trim()
  - Reject if result is empty string → { reason: 'EMPTY_INPUT' }
  - Reject if length > 200 characters → { reason: 'TOO_LONG' }

Step 2: Unicode normalization (NFC)
  - Apply String.prototype.normalize('NFC')
  - Ensures composed character forms (e.g., é as single codepoint)

Step 3: Lowercase
  - Apply .toLowerCase() (locale-insensitive; use 'en-US' locale for consistency)

Step 4: Punctuation and spacing normalization
  - Replace all runs of whitespace (\s+) with a single space
  - Remove leading/trailing apostrophes and quotation marks
  - Remove periods at end of string (trailing punctuation)
  - Collapse hyphens: "new-york" → "new york"
  - Remove possessive apostrophes: "world's" → "worlds"
  - Do NOT remove internal punctuation that changes meaning (e.g., "st. louis" → "st louis" is acceptable)

Step 5: Alias lookup
  - Query aliases map: aliases.get(normalized_text)
  - If found → return { canonical_answer_id: UUID, matched_via: 'alias' }

Step 6: Canonical answer lookup
  - Query canonicals map: canonicals.get(normalized_text)
  - If found → return { canonical_answer_id: UUID, matched_via: 'canonical' }

Step 7: Narrow typo correction
  - Only applied if:
      a) normalized_text.length >= 6 characters
      b) No exact match found in steps 5-6
  - Compute Levenshtein distance between normalized_text and each canonical answer text
    for the given question_id
  - Accept ONLY if:
      a) Exactly ONE canonical answer has distance == 1
      b) That canonical answer's text length >= 6 characters
      c) The edit is not a prefix/suffix truncation (must be substitution or transposition)
  - If multiple candidates at distance 1 → reject (ambiguous) → { reason: 'AMBIGUOUS_TYPO' }
  - If one candidate at distance 1 → return { canonical_answer_id: UUID, matched_via: 'typo_correction' }

Step 8: Rejection
  - If no match found after all steps → { reason: 'NO_MATCH' }

Output (success): { canonical_answer_id: UUID, matched_via: 'alias' | 'canonical' | 'typo_correction' }
Output (failure): { reason: 'EMPTY_INPUT' | 'TOO_LONG' | 'NO_MATCH' | 'AMBIGUOUS_TYPO' }
```

### 6.2 Typo Correction Scope

"Narrow typo correction" is intentionally conservative:

| Rule | Value | Rationale |
|---|---|---|
| Minimum answer length | 6 characters | Prevents false positives on short answers (e.g., "cat" → "bat") |
| Maximum Levenshtein distance | 1 | One insertion, deletion, or substitution only |
| Ambiguity rejection | Yes | If two canonicals are both at distance 1, reject both |
| Prefix/suffix truncation | Rejected | "jupiter" should not match "jupiters" |
| Transpositions | Accepted | "recieve" → "receive" (distance 1 via Damerau-Levenshtein) |

**Implementation note:** the code does not compute a distance. It classifies a single edit exactly (`classifySingleEdit` in `src/domain/normalization/typo.ts`), which is cheaper and cannot be fooled by a transposition that is really two substitutions.

### 6.3 Answer Index Loading

The `AnswerIndex` is built from the **published, immutable** question version (§5.20), so it can be cached per `question_version_id` without any invalidation logic: a published version never changes. Task G builds it on first use and keeps it in a bounded in-memory cache. The index is rebuilt rather than invalidated if a new version is published.

---

## 7. Scoring Algorithm

### 7.1 Formula

**Counting convention (see §18.3).** The current player's own valid answer is added exactly once, explicitly. Cohort queries must exclude the current round, so the player can never be counted twice.

```
p_estimated = (C_prior + 1 + α × p_prior) / (N_prior + 1 + α)
```

- **C_prior** = valid answers matching this canonical answer in the player's frozen cohort (earlier-closing ranked rounds on the same `challenge_question_id`, §16.2), **excluding the current player**.
- **N_prior** = all valid answers in that cohort, **excluding the current player**.
- **α** = prior strength in equivalent observations. A positive **integer**, default `20`, versioned in `scoring_config_versions`.
- **p_prior** = reviewed prior probability of this canonical answer for this question version. Stored as an **integer in parts per million** (`prior_ppm`) in an immutable `prior_snapshots` row (§5.17).
- An unanswered or invalid response scores 0, has no tier and adds no vote.

This is the **final** formula. Provisional scoring uses the same pure function on a different population (§7.8).

### 7.2 Parameter Defaults

| Parameter | Default | Configurable | Rationale |
|---|---|---|---|
| α (alpha) | `20` (positive integer) | Yes, by new config version | Placeholder; Task C chooses it by simulation (§7.11) |
| `prior_ppm` | **Required for every canonical answer** | Per question version | Reviewed editorial estimate in ppm. There is **no silent default**: a closed-set question with a missing prior cannot be published |
| `prior_ppm` minimum | `500` (0.05%) | Yes | No answer may have a zero prior |
| Prior sum | Exactly `1,000,000` ppm across a question's canonical answers | No | Checked at **publication time**, never during gameplay (§18.7) |
| Prior source | `editorial` for launch; `computed` later | Per snapshot | A computed prior comes from earlier finals, **excluding guests** (`priors_include_guests = false`). A new snapshot is created for future challenges. A snapshot referenced by any score is never edited |

### 7.3 Tier Threshold Table

> **PLACEHOLDER thresholds.** These values are **not validated**. Do not freeze scoring config v1 until the §7.11 calibration gate has passed and review gate 1 (§18.13) has signed off.

| Tier id | Proposed label (§8.2) | Lower bound (ppm, inclusive) | Points | Depth added |
|---|---|---|---|---|
| 1 | Common | 300,000 | 10 | 100 m |
| 2 | Uncommon | 150,000 | 15 | 150 m |
| 3 | Rare | 50,000 | 30 | 300 m |
| 4 | Deep Cut | 10,000 | 60 | 600 m |
| 5 | Abyssal | 1,000 | 85 | 850 m |
| 6 | Legendary | 0 | 100 | 1,000 m |

**Boundary rule:** a tier's lower bound is inclusive and its upper bound is exclusive, and the comparison is **exact integer arithmetic** (§7.10), not floating point. A value exactly on 150,000 ppm is tier 2.

Tiers are purely statistical. There is no behavioural "deceptively popular" tier (§18.8). Point values are fixed. Thresholds are configurable and versioned.

**Maximum depth per dive:** 7 questions × 1,000 m = 7,000 m (all tier 6).

### 7.4 Small-Sample Behavior with α = 20

Worked examples under the §7.1 convention, with α = 20, `prior_ppm` = 50,000 (p_prior = 0.05) and the placeholder thresholds. `C_prior = 0` means nobody earlier gave this answer.

| N_prior | C_prior | Exact fraction | ≈ p | Tier |
|---|---|---|---|---|
| 0 | 0 | 2/21 | 0.0952 | 3 |
| 10 | 0 | 2/31 | 0.0645 | 3 |
| 100 | 0 | 2/121 | 0.0165 | 4 |
| 1,000 | 0 | 2/1,021 | 0.00196 | 5 |
| 10,000 | 0 | 2/10,021 | 0.00020 | 6 |
| 100 | 40 | 42/121 | 0.347 | 1 |

**Finding the calibration must address.** The player's own vote always counts, so `p_estimated ≥ 1 / (N_prior + 1 + α)` even for an answer nobody else gave. Under these placeholders:

- With a near-zero prior, tier 5 needs about N_prior ≥ 80 and tier 6 about N_prior ≥ 980.
- With p_prior = 0.05, tier 5 needs about N_prior ≥ 180 and tier 6 about N_prior ≥ 1,980.
- So the top tiers are unreachable in a small cohort, and early players can only reach the middle tiers. Whether that is acceptable depends on the expected daily population. Task C must output a **reachability table** (N_prior at which each tier first becomes reachable, for each α and prior) and either accept it or change α or the thresholds.

### 7.5 Tie-Breaking

Two players who give the same canonical answer do **not** necessarily receive the same score, because under the rolling cohort each has a different frozen population. Within one player's cohort there is nothing to tie-break: the score is a pure function of the stored inputs.

**Leaderboard:** ranks are **shared** for equal totals, as `rank = 1 + count(players with strictly higher total_points)`. For presentation only, rows with equal totals are ordered by `completed_at ASC`, then `player_profile_id ASC`. That order never changes a rank.

### 7.6 Finalization Idempotency

Finalization is idempotent and **ordered** (§11.6, §18.3). In one transaction:

1. Lock the cohort row: `SELECT ... FROM question_cohorts WHERE challenge_question_id = $1 FOR UPDATE`.
2. If the round is already finalized, return the stored result (no-op).
3. Check the predecessor invariant: this round must be the first unfinalized, non-voided round in `(closes_at, round_id)` order, and `now() >= closes_at + finalize_grace`. Otherwise exit and retry later.
4. Read the **stored** `canonical_answer_id` of the player's last accepted candidate as of `closes_at`. Final scoring never re-runs normalization (§7.10).
5. Compute `C_prior` and `N_prior` from `final_answers` of earlier cohort members, excluding this round.
6. Call the pure scoring function (§7.10) and write `final_answers`, `player_question_scores` (with full provenance, §18.6) and the new cohort watermark.
7. Set the round to `reveal`, update the session totals and commit.

If any step fails, nothing is committed and the retry produces the identical result. A second concurrent run blocks on the lock and then takes step 2.

### 7.7 Depth Conversion

```
depth_m = total_points × 10
```

Applied per question: `player_question_scores.depth_m = points × 10`.  
Aggregated per session: `game_sessions.total_depth_m = SUM(player_question_scores.depth_m)`.

### 7.8 Provisional scoring (a separate path)

Provisional scoring shows the player an estimate while they type. It **never** feeds a final score, and the final path never reads its tables.

- **Population:** a mutable cache, `provisional_counts(challenge_question_id, canonical_answer_id, count)`, covering finalized valid answers plus other players' currently open candidates. It is maintained in the same transaction as each candidate write: on a revision, the old answer's count is decremented and the new one's incremented.
- **Computation:** the viewer's own candidate is subtracted from the counts, giving `C_live` and `N_live`. The same pure function then runs with the viewer's candidate added once, as in §7.1.
- **Updates:** batched and rate-limited, at most one `provisional_score_updated` per player per `provisional_min_interval_ms` (default 1,000).
- **Display hysteresis (default rule).** When the player submits a new candidate, its tier is shown immediately. For later recomputations on the same candidate, the displayed tier changes only after the new raw tier has been observed on `provisional_hold_evaluations` consecutive evaluations (default 2). The state (`displayed_tier`, `pending_tier`, `pending_count`) is stored per round, so the rule is deterministic given the evaluation sequence. Task C may replace it with a margin-based rule, but it must stay deterministic.
- **Hysteresis never touches the final score.** It exists for display stability only.
- **Activity indicator:** `low`, `medium` or `high` from the number of candidate writes for the question in the last 60 s, using configurable cut-offs. It carries no counts.
- **Honesty in the UI:** copy must say the tier is an estimate and that the final tier is fixed when the timer ends.

### 7.9 Popularity statistic on the reveal

The only aggregate shown after a round closes. It answers exactly one question: *of the earlier valid answers in your cohort, what share matched yours?* It is a descriptive statistic. It is **not** the smoothed estimate used for the tier (§7.1), so the two can differ, and the copy must never present it as the reason for the tier.

- **Definition:** `share = C_prior / N_prior`, over the same frozen cohort as the score, **excluding the player's own answer from both terms**. (An earlier draft used `(C_prior + 1) / (N_prior + 1)`, which gave the first player 100%. That form is withdrawn.)
- **Label:** "X% of earlier valid answers matched yours". It does not say "players", because players who gave no valid answer are not in `N_prior`.
- **Minimum sample:** `N_prior ≥ popularity_min_sample` (default 30), where `N_prior` is the count of valid, in-cohort answers from earlier rounds. One session gives one answer per question, so this equals 30 distinct earlier players with an accepted answer, not 30 total submissions. It is a disclosure guardrail and **not** a statistical guarantee.
- **Fallback:** below the minimum, return `{ kind: 'suppressed' }`. The UI shows "Too few earlier answers for a popularity figure yet" and no number.
- **Rounding:** `percent = floor((200 × C_prior + N_prior) / (2 × N_prior))`, i.e. round-half-up in integer arithmetic. The result is one of:
  - `C_prior = 0` → `{ kind: 'none_earlier' }`: "no earlier answer matched yours".
  - `C_prior > 0` and `percent = 0` → `{ kind: 'under_one_percent' }`.
  - otherwise → `{ kind: 'shown', percent_of_earlier_answers }` with a value from 1 to 100.
- **Practice mode:** the same statistic, computed from the frozen reference snapshot (§5.20).
- **Never exposed:** another player's raw answer, the frequency distribution, `N_prior`, `p_estimated`, or the prior.

### 7.10 Numeric representation and order of operations

All scoring arithmetic is exact integer arithmetic. There is **one implementation**, in TypeScript (`src/domain/scoring`), using `BigInt`. Postgres only counts rows and stores the results, so there is no second implementation to disagree with it.

1. Inputs are integers: `C_prior`, `N_prior`, `alpha`, `prior_ppm`, and the six `threshold_ppm` values.
2. `numerator = (C_prior + 1) × 1,000,000 + alpha × prior_ppm`
3. `denominator = (N_prior + 1 + alpha) × 1,000,000`
4. The tier is the **smallest** tier index `t` (tier 1 = most common) such that `numerator × 1,000,000 ≥ threshold_ppm[t] × denominator`. Tier 6 has a threshold of 0, so a tier always matches. Exact comparison, no rounding.
5. `p_display = floor(numerator × 10^9 / denominator) / 10^9`, for display and diagnostics only. It never decides a tier.
6. Storage: `p_numerator` and `p_denominator` as `NUMERIC(40,0)`, plus `p_display NUMERIC(12,9)`. A score is reproducible from the stored integers alone.

**Normalization is frozen at acceptance.** A candidate stores its `canonical_answer_id` and `normalization_version` when it is accepted. Finalization reads that stored id and never re-normalizes the raw text, so a later change to the normalizer cannot alter a finalized or in-flight result.

### 7.11 Calibration gate (pass criteria)

Task C must meet **all** of these before config v1 is frozen. The numbers are initial proposals. Review gate 1 may change them, but only with a recorded rationale. Simulations are seeded and reproducible.

| # | Evaluation | Measure | Pass criterion |
|---|---|---|---|
| 1 | Monotonicity | Exhaustive grid over `C_prior`, `N_prior`, `prior_ppm` | Points never increase as `C_prior` or `prior_ppm` increase; 0 violations |
| 2 | Cold start | Tier at `N_prior = 0` with a correct prior, versus the tier of the answer's long-run share | At least 70% of answers within 1 tier. The remainder is reported, not hidden |
| 3 | Sparse to large | The same measure at `N_prior = 10, 100, 1000` | At least 90% within 1 tier at `N_prior ≥ 100` |
| 4 | Popular answers | Answers with a true share of at least 30% | Tier 1 in at least 99% of draws at `N_prior ≥ 100` |
| 5 | Rare answers and reachability | Table of the `N_prior` at which each tier first becomes reachable, per α and prior | Table published. Tier 5 reachable by `N_prior` ≤ 200, tier 6 by `N_prior` ≤ 2,000, **or** the thresholds are changed with a recorded reason |
| 6 | Prior misspecification | Priors scaled ×2, ×0.5, ×5 and ×0.2, and swapped between two answers | Median absolute tier error ≤ 1 at `N_prior ≥ 100`. The error at `N_prior = 0` is reported and explicitly accepted |
| 7 | Provisional stability | Simulated 60 s rounds with Poisson candidate arrivals, at about 100 and 1,000 concurrent players | Displayed tier changes per player per round: ≤ 3 in 95% of rounds |
| 8 | Population growth | Stationary distribution, expected points at `N_prior` = 1,000 versus 10,000 | Difference ≤ 1 tier |
| 9 | Distribution shift | Move 50% of the mass to a previously rare answer, or swap the top two answers | Within 1 tier of the oracle by `N_prior` = 200 |
| 10 | Repeatability | 10,000 randomized datasets, run twice and with shuffled input order | 0 differing bytes, and a golden-file match against the stored fixtures |

**Limits of this evidence.** A passing simulation shows behaviour under its own assumptions. It does not show that real players choose answers the way the synthetic distributions do, and the 60 s window may shift answer distributions compared with a 20 s game. Config v1 is therefore recorded as `validated: simulated-only`. After launch, a shadow job compares predicted and observed tier distributions on real data, and recalibration is a tracked follow-up.

### 7.11.1 Required Task C outputs (playability, not only pass/fail)

Task C publishes these tables for every candidate `(α, threshold table)`, with a correct prior and with priors scaled ×0.5 and ×2:

1. **Reachability:** the minimum eligible population (`N_prior`) at which each tier first becomes reachable, per α and prior.
2. **Frequency needed:** the answer frequency required to land in each tier at `N_prior` = 10, 100, 1,000 and 10,000.
3. **Prior error:** tier error from underestimating and overestimating priors, by `N_prior`.
4. **Tier mix:** the share of valid answers expected in each tier under several plausible distributions (for example Zipf exponents 0.8, 1.0 and 1.3, a long tail and a flat one) and under daily populations of 50, 500 and 5,000 players, aggregated over the whole cohort order so that early and late players are both counted.
5. **Alternatives:** a side-by-side comparison of at least three α values and two threshold tables.

**Playability test.** For each daily population, report whether a genuinely rare answer can reach tiers 5 and 6. If the reward curve depends more on traffic than on answer quality, document it and either change the thresholds or accept it explicitly at review gate 1. **Do not lower α only to make the top tiers reachable.** A smaller α makes early scores more sensitive to small samples, so the trade-off must be recorded alongside the choice.

### 7.11.2 Task C results (DRAFT, simulated-only, config v1 NOT frozen)

Reproduce with `npm run calibrate` (gate summary) and `npm run calibrate -- A:50` (detail tables for threshold table A, alpha 50). Everything is seeded and calls the real scoring engine. Table A is the §7.3 placeholder. Table B compresses the upper tiers (`300000/150000/50000/15000/4000/0`). Alphas tried: 5, 10, 20, 50. The exact analysis is checked against brute force and the Monte Carlo against the exact analysis (`tests/unit/scoring/calibration.test.ts`).

**Gate summary, rows as written in §7.11:**

| Candidate | Rows passed | Failing rows |
|---|---|---|
| A, alpha 5 / 10 / 20 | 8 of 10 | 2 (cold start), 4 (popular answers) |
| A, alpha 50 | 9 of 10 | 4 (popular answers) |
| B, alpha 5 / 10 / 20 / 50 | 8 of 10 | 2, 4 |

A pass is necessary, not sufficient. Review gate 1 is the owner's decision, and nothing here freezes a config.

**Findings the owner needs before gate 1:**

1. **Row 4 is unsatisfiable as written.** An answer whose true share is exactly 30% sits on the tier-1 boundary, so about half of its draws land just below it (measured: tier 1 in 53.8% of draws). No config with a 300,000 ppm tier-1 bound can reach 99%. *Proposed amendment (not applied):* "an answer with a true share of at least 45% reaches tier 1 in at least 99% of draws, and one at exactly 30% reaches tier 1 or 2 in at least 99%". Both hold for every candidate (100%).
2. **Cold start (row 2) fails for alpha of 20 or less, because the player's own vote is a large share of a tiny sample.** At `N_prior = 0` the estimate is at least `1 / (1 + alpha)`: 16.7% at alpha 5, 4.8% at alpha 20. A flat 50-answer question (every answer truly 2%) scores 0% within one tier at alpha 5. Only alpha 50 passes (89.9% worst case). Early players are therefore scored mostly from the editorial prior, as §16.2 already warned.
3. **Tier 6 (100 points) is essentially unreachable on a small daily.** In a whole-day population of 500 players the share of players earning tier 6 is **0% for every distribution tried**. At 5,000 it is 0.0% to 5.2% (0.0% for the flat 50-answer question, 5.2% for zipf 1.0 and 1.3). A unique answer first reaches tier 6 at about 975 earlier players with the most favourable prior and about 3,450 with a 5% prior (A, alpha 50). Tier 5 first appears at about 52 to 300 earlier players. If the expected daily population is under about 1,000, the 100-point tier will almost never be awarded, and the product should know that.
4. **Row 5 passes only on its most favourable reading.** The pass flag uses a 500 ppm prior. With a 50,000 ppm prior the same thresholds need about 300 earlier players for tier 5 and 3,450 for tier 6. The criterion did not say which prior, so both are printed. This is a decision, not a pass.
5. **Early and late players are scored differently, and no gate row measures it.** At a population of 500, mean points for the first quarter of arrivals versus the last quarter: 60.8 vs 70.8 (zipf 0.8) and 52.7 vs 60.3 (zipf 1.0), about 13 to 14% less for early players. At 50 players the gap is small only because almost everyone sits in the middle tiers. *Proposed new row 11 (not applied):* report this gap and set a maximum the owner accepts.
6. **A higher alpha helps rare answers and hurts typical ones.** Raising alpha from 5 to 50 makes a rare-prior answer reach tier 5 sooner (about 95 down to 52 earlier players, measured) but a 5%-prior answer later (300 earlier players at alpha 50, measured; 120 at alpha 5, worked out by hand from the formula and not run through the harness). Do not read "alpha 50 passes more rows" as "alpha 50 is better": it moves the reachability problem rather than removing it.
7. **Wrong priors matter mainly at the start.** Median tier error is at most 1 at `N_prior >= 100` for priors off by 5x either way, for every candidate tried (the worst case is zipf 0.8 with priors 2x or 5x too high, at N=100). It reaches 2 to 3 at `N_prior = 0`, which the gate only asks us to report.
8. **Provisional display is stable, with a thin margin.** With a hold of 2 evaluations, 95.1% to 98.3% of player-rounds had at most 3 display changes at 100 and 1,000 concurrent players, across all eight candidates. The gate asks for 95%. The lowest value (95.1%) is 1,000 players with table B at alpha 5 or 10.

**What this does NOT show.** All distributions are synthetic. Nothing here says real players choose answers this way, and the 60-second window may shift them. The harness also treats every question as having 50 to 300 answers and every player as choosing independently. Config v1 may be recorded only as `validated_simulated_only`, and only after the owner has reviewed items 1 to 6.

**Recommendation (a proposal, not a decision):** keep alpha 50 with table A as the working candidate, amend row 4 as above, add the early-versus-late row, and decide explicitly whether a 100-point tier that cannot appear below roughly 1,000 players is acceptable. If it is not, the options are lower thresholds for tiers 5 and 6, a smaller tier-6 bound only once a daily has enough players, or fewer than six reachable tiers for small dailies. None of these changes the fixed point values.

### 7.12 Scoring invariants (written as executable tests in Task B)

1. A valid answer adds exactly one observation, and the cohort query never includes the current round.
2. An unanswered or invalid response gives 0 points, tier null, and changes no counts.
3. Total score is the sum of the seven question scores, and `depth_m = points × 10`.
4. The same stored inputs always yield the same `(numerator, denominator, tier, points)`.
5. Shuffling the order of the cohort rows does not change the result.
6. A revision decrements the old answer and increments the new one in `provisional_counts`, and the total never changes by more than one.
7. Provisional and final code paths share only the pure function, never an aggregate.
8. Exact threshold values land in the higher tier, tested at all five boundaries.

---

## 8. Real-Time Event Contracts

All Realtime events use Supabase Broadcast channels. Events are published server-side via the service-role client. Clients subscribe using the anon-key client with RLS-enforced channel access.

### 8.1 Channel Naming Convention

```
session:{session_id}                  -- per-player events (private): everything about that player's rounds and scores
leaderboard:{challenge_id}            -- public leaderboard updates (finalized results only)
```

There is **no shared per-round channel**. Under the rolling-cohort model (§16.2) each player has their own round, and a shared channel would leak other players' activity. Provisional updates go only to the owning player's `session:` channel.

**Events are notifications, not proof.** Every payload carries `event_version`, a monotonic integer per session. Clients drop any event with a version at or below the last one applied, and on a gap or a reconnect they call the resync endpoint (§9) instead of trusting the stream. Duplicates and out-of-order delivery are therefore harmless.

### 8.2 TypeScript Event Interfaces

```typescript
// src/types/events.ts

export type GameEventType =
  | 'question_started'
  | 'submission_accepted'
  | 'provisional_score_updated'
  | 'question_closed'
  | 'round_result_published'
  | 'challenge_completed'
  | 'leaderboard_updated';

export interface BaseEvent {
  event: GameEventType;
  timestamp: string;      // ISO 8601 UTC
  event_version: number;  // monotonic per session; duplicates and stale versions are dropped by the client
}

// Tier ids are ordinal and stable: 1 = most common ... 6 = rarest.
// Display labels are copy (see TIER_LABELS), never stored, so renaming a tier needs no migration.
export type TierId = 1 | 2 | 3 | 4 | 5 | 6;

export interface QuestionStartedEvent extends BaseEvent {
  event: 'question_started';
  payload: {
    question_round_id: string;
    question_index: number;       // 1-7
    closes_at: string;            // ISO 8601 UTC — client uses for countdown
    prompt_text: string;
    hint_text: string | null;
  };
}

export interface SubmissionAcceptedEvent extends BaseEvent {
  event: 'submission_accepted';
  payload: {
    question_round_id: string;
    request_id: string;           // echoes client's idempotency key
    candidate_version: number;    // the client must send this back on its next revision
    matched_via: 'alias' | 'canonical' | 'typo_correction';
    // The player's own accepted answer text is echoed back; it goes only on the private session channel.
  };
}

export interface ProvisionalScoreUpdatedEvent extends BaseEvent {
  event: 'provisional_score_updated';
  payload: {
    question_round_id: string;
    candidate_version: number;    // which candidate this estimate belongs to
    tier: TierId;
    points: number;               // provisional, NOT final
    activity: 'low' | 'medium' | 'high'; // coarse, non-specific activity indicator
    // NEVER sent: C, N, p_estimated, percentages, other players' answers, or scoring internals.
  };
}

export interface QuestionClosedEvent extends BaseEvent {
  event: 'question_closed';
  payload: {
    question_round_id: string;
    closed_at: string;            // actual server close time
  };
}

export interface RoundResultPublishedEvent extends BaseEvent {
  event: 'round_result_published';
  payload: {
    question_round_id: string;
    question_index: number;
    // The player's OWN result only. No distribution of other players' answers is ever published.
    answer_display_text: string | null;   // null when the player gave no accepted answer
    tier: TierId | null;                  // null when unanswered (0 points)
    points: number;
    popularity: PopularityStat;           // the approved aggregate statistic (§7.9)
    next_question_available_at: string | null; // null if challenge_complete; see §4.6
  };
}

export type PopularityStat =
  | { kind: 'shown'; percent_of_earlier_answers: number } // integer 1..100, rounded per §7.9
  | { kind: 'under_one_percent' }                          // C_prior > 0 but rounds to 0
  | { kind: 'none_earlier' }                               // C_prior = 0
  | { kind: 'suppressed' };                                // N_prior below popularity_min_sample

export interface ChallengeCompletedEvent extends BaseEvent {
  event: 'challenge_completed';
  payload: {
    challenge_id: string;
    session_id: string;
    total_points: number;
    total_depth_m: number;
    rank: number | null;          // null until leaderboard computed
  };
}

export interface LeaderboardUpdatedEvent extends BaseEvent {
  event: 'leaderboard_updated';
  payload: {
    challenge_id: string;
    top_entries: Array<{
      rank: number;
      display_name: string;
      total_depth_m: number;
    }>;
    total_participants: number;
  };
}

// PROPOSED display labels, pending owner approval. These are original and frequency-oriented.
// They live in copy only; the database and the events use TierId.
// NOTE for the owner: "Rare" and "Deep Cut" also appear in Krillion's published tier names (§17, K6).
// Rename those two if the goal is a fully original vocabulary. Nothing but this copy table changes.
// UI copy must say that rarity is an estimate and depends on the scoring population.
export const TIER_LABELS: Record<TierId, string> = {
  1: 'Common',    // 10 pts
  2: 'Uncommon',  // 15 pts
  3: 'Rare',      // 30 pts
  4: 'Deep Cut',  // 60 pts
  5: 'Abyssal',   // 85 pts
  6: 'Legendary', // 100 pts
};
```

### 8.3 RLS Policies for Realtime Channels

| Channel Pattern | Who Can Subscribe | Policy |
|---|---|---|
| `session:{id}` | Only the owning player | A private channel authorized in `realtime.messages` RLS: the topic's session id must belong to a `game_sessions` row whose `player_profile_id` maps to `auth.uid()` |
| `leaderboard:{id}` | Public read | Carries finalized results only; no answers and no provisional data |

**A session id is not a credential.** Knowing a topic name must never grant access. Channels are created `private: true`, and subscription is authorized by the RLS policy above. The same ownership check is repeated in every API route, and a test must prove that a second player cannot subscribe to, or fetch the state of, someone else's session. Service-role publishes bypass RLS and are server-only.

---

## 9. API Surface

All routes are Next.js App Router route handlers (`src/app/api/`). Authentication is via Supabase session cookies (SSR). A guest is a **server-issued Supabase anonymous user**, so there is no client-generated guest token (§11.4). Every owner-scoped route checks that the caller owns the session, so knowing an id grants nothing.

Responses are built from typed DTOs (§18.10). Internal database rows are never serialized to the client.

### 9.1 Route Table

#### Session Management

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/session` | Optional (guest OK) | Start or resume a game session |
| `GET` | `/api/session/:sessionId` | Required (owner) | Fetch session state |

**POST /api/session — Request:**
```typescript
{
  challenge_id: string;       // UUID. The caller's identity comes from the Supabase session cookie
}
```
If the caller has no session, the server creates an anonymous user and sets the auth cookie.

**POST /api/session — Response:**
```typescript
{
  session_id: string;
  state: 'lobby' | 'active' | 'challenge_complete' | 'abandoned';
  current_question_index: number;
  challenge: { id: string; mode: 'daily' | 'practice'; is_ranked: boolean; };
  recovery_code?: string;     // returned ONCE for a new guest's first ranked session (§11.4); only a hash is stored
}
```
Starting a ranked daily that the caller already has returns that same session (resume). It never creates a second one.

**Error codes:** `400` (invalid challenge_id), `409` (ranked session already complete), `429` (rate limited)

---

#### Challenge

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/challenge/:challengeId` | Optional | Fetch challenge metadata and question list (no answers) |

**Response:**
```typescript
{
  id: string;
  mode: 'daily' | 'practice';
  challenge_date: string | null;
  question_count: number;       // always 7
  is_published: boolean;
}
```

---

#### Round issuance, resync and question state

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/session/:sessionId/round` | Required (owner) | Issue the next question. Idempotent, and starts the 60 s clock at commit (§4.6) |
| `GET` | `/api/session/:sessionId/state` | Required (owner) | Authoritative resync after a reconnect or an event gap |
| `GET` | `/api/question/:roundId` | Required (owner) | Fetch one round's question state |

**Round issuance** returns the same round and the same deadline on every retry:
```typescript
{
  round_id: string;
  question_index: number;               // 1..7
  prompt_text: string;
  hint_text: string | null;
  served_at: string;                    // DB clock at issuance commit
  closes_at: string;                    // served_at + 60 s, immutable
  server_now: string;                   // lets the client correct its clock offset for the display
}
```
**Resync** (`GET /api/session/:id/state`) returns the session state, the current round (original `closes_at`), the current `candidate_version`, the active-round provisional DTO if the round is open, the last finalized result if the round is in reveal, and `event_version`. A reconnect never restarts or extends the timer.

**Question state:**
```typescript
{
  round_id: string;
  question_index: number;
  state: 'question_active' | 'question_closing' | 'reveal';
  prompt_text: string;
  hint_text: string | null;
  served_at: string;
  closes_at: string;
  server_now: string;
}
```

---

#### Answer Submission

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/answer` | Required (participant) | Submit an answer for the active round |

**Request:**
```typescript
{
  question_round_id: string;
  raw_text: string;                     // max 200 chars
  request_id: string;                   // UUID v4, unique within the session
  expected_candidate_version: number;   // 0 if the client has no accepted candidate yet
}
```
**Response (accepted):**
```typescript
{
  accepted: true;
  candidate_version: number;            // send this back as expected_candidate_version next time
  matched_via: 'alias' | 'canonical' | 'typo_correction';
  answer_display_text: string;          // the owner's own accepted answer
  provisional_tier: TierId;
  provisional_points: number;           // an estimate, not final
}
```
**Response (rejected):**
```typescript
{
  accepted: false;
  reason: 'NO_MATCH' | 'EMPTY_INPUT' | 'TOO_LONG' | 'AMBIGUOUS_TYPO' | 'ROUND_CLOSED' | 'TOO_MANY_ATTEMPTS';
}
```
A rejected guess **does not consume the attempt** and does not touch `round_candidates`, so the player can try again while time remains. `ROUND_CLOSED` is decided by the DB clock under the round row lock (§11.2), not by the browser countdown.

**Idempotency:** a repeat of the same `request_id` with the same payload returns the original response. A repeat with a different payload returns `409 REQUEST_ID_CONFLICT`. A request carrying an outdated `expected_candidate_version` returns `409 STALE_VERSION` together with the current version, and the client resyncs.

**Error codes:** `400` (validation), `403` (not the session owner), `409` (`REQUEST_ID_CONFLICT`, `STALE_VERSION`), `429` (rate limited)

---

#### Provisional Score

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/score/:roundId` | Required (owner) | Fetch the current provisional estimate for the owner's candidate |

**Response (the active-round contract, §18.10):**
```typescript
{
  question_round_id: string;
  candidate_version: number | null;     // null if no accepted candidate yet
  tier: TierId | null;
  points: number;                       // provisional; 0 with tier null if no candidate
  activity: 'low' | 'medium' | 'high';
  is_final: false;                      // always false here; final scores come from /api/result/*
}
```
It never returns C, N, `p_estimated`, percentages or another player's answer, and it reads only the provisional cache (§7.8).

---

#### Finalization (Internal / Worker)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/internal/finalize/:roundId` | Service-role only | Attempt to finalize one round |

**Auth:** `Authorization: Bearer {CRON_SECRET}` header, not accessible to clients. The player-facing endpoints call the same service function lazily (§4.5); the scheduled worker is the guaranteed path.

**Response:**
```typescript
{
  status: 'finalized' | 'already_finalized' | 'waiting_for_predecessor' | 'not_yet_closed';
}
```
`waiting_for_predecessor` and `not_yet_closed` are normal outcomes. The worker retries with bounded backoff (§4.5). Calling this endpoint twice is always safe (§7.6).

---

#### Results

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/result/round/:roundId` | Required (owner) | Fetch the owner's final round result |
| `GET` | `/api/result/challenge/:challengeId` | Required (owner) | Fetch the owner's final challenge result |

**Round result response (the finalized-round contract, §18.10).** It returns the owner's own result only. There is no distribution of other players' answers and no per-answer player count.
```typescript
{
  question_round_id: string;
  question_index: number;
  answer_display_text: string | null;   // null if unanswered
  tier: TierId | null;                  // null if unanswered (0 points)
  points: number;
  depth_m: number;
  popularity: PopularityStat;           // §7.9; { kind: 'suppressed' } below the minimum sample
  scoring_config_version: number;
}
```
`GET` on a round that is not yet finalized returns `409 NOT_FINALIZED`, never a provisional score labeled as final.

---

#### Leaderboard

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/leaderboard` | Public | Fetch leaderboard for a challenge |

**Query params:** `challenge_id`, `limit` (default 50), `offset` (default 0)

**Response:**
```typescript
{
  challenge_id: string;
  entries: Array<{
    rank: number;
    display_name: string;
    total_depth_m: number;
    total_points: number;
  }>;
  total_participants: number;
}
```

---

#### History

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/history` | Required | Fetch player's past challenge results |

**Query params:** `limit` (default 20), `offset` (default 0)

---

#### Admin

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/admin/questions` | Admin role | List all questions |
| `POST` | `/api/admin/questions` | Admin role | Create a question |
| `GET` | `/api/admin/questions/:id` | Admin role | Fetch question with all versions |
| `PUT` | `/api/admin/questions/:id` | Admin role | Update question (creates new version) |
| `DELETE` | `/api/admin/questions/:id` | Admin role | Soft-delete question |
| `POST` | `/api/admin/questions/:id/aliases` | Admin role | Add alias to canonical answer |
| `GET` | `/api/admin/challenges` | Admin role | List challenges |
| `POST` | `/api/admin/challenges` | Admin role | Create challenge |
| `PUT` | `/api/admin/challenges/:id` | Admin role | Update challenge |

**Admin auth:** the caller's `auth.uid()` must hold the required row in `admin_roles` (§5.20), checked server-side on every request, never taken from a client-supplied claim. `editor` may draft and edit, `publisher` may publish question versions and challenges, `scoring_admin` may edit priors and scoring config. Every admin write appends to `audit_events`. Published versions are immutable, so `PUT` creates a new version and `DELETE` retires a question rather than erasing it.

---

## 10. Security Boundaries

### 10.1 Server-Only Operations

The following operations **must never execute on the client**:

| Operation | Reason |
|---|---|
| Score computation | Prevents client-side score manipulation |
| Round finalization | Prevents premature or duplicate finalization |
| Answer count queries | Prevents frequency inference attacks |
| Cohort counts and `p_estimated` | Raw counts and estimates must never reach the client, except the approved popularity statistic after finalization (§7.9) |
| Service-role DB access | Service-role key must stay server-side |
| Admin operations | Prevents unauthorized data mutation |
| Timer authority | `closes_at` is set server-side; client countdown is display-only |

### 10.2 Supabase RLS Policies Summary

Every game table has RLS enabled. A table with no policy is service-role only. Guests are Supabase anonymous users, so `auth.uid()` identifies them too.

```sql
-- player_profiles: users and guests can read their own profile. Writes go through the server.
ALTER TABLE player_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_profile" ON player_profiles
  FOR SELECT USING (user_id = auth.uid());

-- game_sessions: players can only see their own sessions
ALTER TABLE game_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_sessions" ON game_sessions
  FOR SELECT USING (
    player_profile_id IN (SELECT id FROM player_profiles WHERE user_id = auth.uid())
  );

-- answer_submissions: NO client access. The client only ever receives the typed DTOs of §18.10,
-- so the history stays server-side (it also holds raw text subject to retention).
ALTER TABLE answer_submissions ENABLE ROW LEVEL SECURITY;

-- round_candidates, final_answers, player_question_scores, question_cohorts, provisional_counts,
-- provisional_display_state, prior_snapshots, prior_snapshot_values, practice_reference_*,
-- scoring_config_versions, moderation_events, audit_events, guest_recovery_codes, admin_roles:
-- RLS enabled, NO client policy (service-role only). Scoring internals never reach a client.
ALTER TABLE round_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE final_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_question_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE provisional_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE prior_snapshots ENABLE ROW LEVEL SECURITY;

-- player_challenge_results: readable by owner; leaderboard fields readable by all
ALTER TABLE player_challenge_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_results" ON player_challenge_results
  FOR SELECT USING (
    player_profile_id IN (SELECT id FROM player_profiles WHERE user_id = auth.uid())
  );

-- questions, canonical_answers: public read (needed for game)
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_questions" ON questions FOR SELECT USING (deleted_at IS NULL);

-- challenges: public read for published challenges
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_challenges" ON challenges FOR SELECT USING (is_published = true);
```

### 10.3 Service-Role Key Protection

- `SUPABASE_SERVICE_ROLE_KEY` is stored only in Vercel environment variables (server-side).
- Never referenced in any `src/app/` client component or `src/lib/supabase/client.ts`.
- Only imported in `src/lib/supabase/server.ts`, which is a server-only module (enforced by `'use server'` directive and Next.js module boundary).
- Vercel's build system prevents server-only modules from being bundled into client chunks.

### 10.4 Rate Limiting Strategy

All limits are configuration, not constants. The numbers below are defaults. Excess requests return `429` and change no state.

| Endpoint | Key | Default limit | Window | Notes |
|---|---|---|---|---|
| `POST /api/answer` | session | 20 | 60 s | Legitimate revisions must not be blocked (§11.1) |
| `POST /api/answer` | IP | 60 | 60 s | Higher, because networks are shared. An IP is not a person |
| `POST /api/session` (guest creation) | IP | 10 | 60 s | Plus a soft daily cap per IP that triggers a challenge instead of a block (§11.4) |
| `POST /api/session/:id/round` | session | 10 | 60 s | Issuance is idempotent, so retries are cheap |
| `GET /api/session/:id/state` | session | 30 | 60 s | Resync endpoint |
| `GET /api/leaderboard` | IP | 60 | 60 s | |
| Admin endpoints | user | 100 | 60 s | |

Enforcement uses `@upstash/ratelimit` (Redis) because edge middleware alone cannot key by session. Failure mode: if the limiter is unavailable, fail **open** for reads and **closed** for guest creation.

### 10.5 Anti-Exploit Measures

| Exploit Vector | Mitigation |
|---|---|
| Duplicate votes | `round_candidates` has `PRIMARY KEY (question_round_id)`, so one current candidate per round. Revisions replace it and `provisional_counts` is corrected in the same transaction (§7.8, §11.1) |
| Multi-tab play | `UNIQUE (player_profile_id, challenge_id)` on `game_sessions` and `UNIQUE (game_session_id, question_index)` on `question_rounds`; tabs share one round and one deadline (§4.6, §11.3) |
| Late submissions | Rejected at write time under the round row lock, using the DB clock (§11.2) |
| Clock manipulation | Server `clock_timestamp()` for all deadlines; the client clock only drives the display |
| Answer frequency inference | Scoring tables have no client RLS policy; only the DTOs of §18.10 are returned, and probing is bounded by `max_candidate_revisions` (§11.5) |
| Replay and stale writes | `UNIQUE (game_session_id, request_id)` with a payload hash, plus the `candidate_version` check (§18.5) |
| Out-of-order finalization | Per-question cohort lock plus the predecessor invariant (§11.6, §18.3) |
| Cohort manipulation | Server-issued guest identity, one ranked session per identity, burst detection and documented Sybil limits (§11.4, §18.10) |

---

## 11. Scoring Exploit Mitigations

### 11.1 Repeated Submission Spam

**Threat:** Player submits the same or different answers repeatedly to game the scoring system.

**Mitigation:**
1. Revisions are legitimate, so spam is bounded by rate limits and version checks, not by a one-answer rule. `answer_submissions` is an append-only history. `round_candidates` (§5.12) holds exactly one current candidate per round (`PRIMARY KEY (question_round_id)`), so spam can never create extra votes.
2. `request_id` is unique within a session: `UNIQUE (game_session_id, request_id)`. A repeat with the same payload hash returns the original result. A repeat with a **different** payload hash returns `409 REQUEST_ID_CONFLICT`.
3. Configurable rate limits. Defaults: 20 `/api/answer` requests per 60 s per session and 60 per 60 s per IP (shared networks exist). Excess requests return `429` and change nothing.
4. A per-round cap on stored attempts (default 50) and on accepted revisions (`max_candidate_revisions`, default 5). Extra attempts are rejected with `TOO_MANY_ATTEMPTS`.

### 11.2 Post-Deadline Answer Injection

**Threat:** Player manipulates client clock or delays network request to submit after the 60-second window.

**Mitigation:**
1. `served_at` and `closes_at` are stamped with the DB clock inside the round-issuance transaction (§4.6) and are never updated.
2. The submission transaction locks the round row (`FOR UPDATE`), reads `clock_timestamp()`, and rejects with `ROUND_CLOSED` if it is `>= closes_at`. The authoritative lateness check happens **at write time**, not in the finalizer.
3. The finalizer additionally ignores any candidate whose `updated_at >= closes_at` (belt and braces).
4. The client countdown is display-only and never gates submission logic.

### 11.3 Multi-Tab Exploitation

**Threat:** Player opens multiple browser tabs to submit different answers and keep the best score.

**Mitigation:**
1. `UNIQUE (player_profile_id, challenge_id)` on `game_sessions`: all tabs share the same session and the same round.
2. Round issuance is idempotent via `UNIQUE (game_session_id, question_index)`, so two tabs cannot start two clocks.
3. The last accepted write wins, ordered by `candidate_version`. A write carrying a stale version is rejected with `STALE_VERSION`, and the client resyncs from the backend.

### 11.4 Sybil Attacks

**Threat:** Player creates multiple accounts to inflate or deflate answer frequencies.

**Mitigations (they raise the cost of manipulation; they do not prevent it):**
1. **Server-issued guest identity.** A guest is a Supabase anonymous sign-in, so it has an `auth.users` row and an `auth.uid()`. It is mapped to `player_profiles.user_id` and carried in an httpOnly cookie. A client-generated identifier is never trusted.
2. **One ranked session per identity,** enforced by `UNIQUE (player_profile_id, challenge_id)` on `game_sessions`, not by client code.
3. **Recovery if the identity is lost.** At the first ranked start the player may be shown a one-time recovery code (stored only as a hash), or may upgrade to an email account. Without either, clearing cookies creates a **new identity that can start another ranked session**. This is the unavoidable gap in a guest-first game.
4. Rate limits on guest creation (default 10 per 60 s per IP) and a soft daily cap per IP. Hitting the cap triggers a challenge (CAPTCHA) rather than a block, because IPs are not people and networks are shared.
5. **Burst detection.** Many fresh guests from one network submitting identical answers within seconds writes a `moderation_events` row. A flagged round is excluded from the cohort only if it is flagged **before its own finalization**: eligibility is frozen when the round itself finalizes, so already-finalized scores are never rescored. Later findings are recorded and annotated on the leaderboard, not applied retroactively.
6. Guests count in the ranked cohort (`cohort_include_guests`, default `true`) but not in historical priors (`priors_include_guests`, default `false`).

**Documented limitation:** full Sybil resistance needs stronger identity (CAPTCHA, phone or account verification) and is out of scope for the MVP. Guests can still shift the live ranked cohort.

### 11.5 Answer Frequency Manipulation

**Threat:** Player attempts to infer or manipulate answer counts to game the rarity system.

**Mitigation:**
1. Scoring tables (`round_candidates`, `final_answers`, `player_question_scores`, `practice_reference_snapshots`) have no client-readable RLS policy. Players read their own results only through the typed DTOs of §18.10.
2. **Active-round responses** carry provisional tier, provisional points and a non-specific activity indicator. They never carry C, N, `p_estimated`, percentages or another player's answer.
3. **Finalized-round responses** add only the player's own answer, final tier, points and the approved popularity statistic (§7.9).
4. All count computations happen server-side in `src/services/scoring.service.ts`.
5. **Known property, accepted:** revising a candidate reveals the provisional tier of each candidate tried, so a player can probe a few answers. This is the intended "live rarity" experience. It is bounded by `max_candidate_revisions` (default 5) and by tier-level granularity. Practice scores use a frozen reference snapshot (§5.20), so practice cannot be used to probe the live ranked population.

### 11.6 Finalization Race Conditions

**Threat:** Two finalization jobs run concurrently for the same round, producing duplicate scores.

**Mitigation:**
1. Every finalization path locks the same row first: `SELECT ... FROM question_cohorts WHERE challenge_question_id = $1 FOR UPDATE` (§5.14). This is the single serialization point.
2. Under that lock the round must be the **first unfinalized, non-voided round** in `(closes_at, id)` order and `now() >= closes_at + grace` (§4.5). Otherwise the job exits and is retried. A later round never scores against a population that omits an earlier one.
3. One transaction writes `final_answers`, `player_question_scores`, the cohort row (`next_sequence`), the round state `reveal` and the session totals. If any step fails, nothing is committed.
4. A retry finds the round already finalized and returns the stored result. `ON CONFLICT DO NOTHING` plus the state check make a double run a no-op.
5. The races to test are listed in §18.12.

---

## 12. Implementation Phases and Task Breakdown

> **SUPERSEDED ORDER.** The execution order is now **§16.4 (Tasks A–M) as amended by §18.15**. The phase and task list below is the original draft, kept as **per-task detail only** (acceptance criteria, file lists). Where a task below conflicts with §4–§11 as patched, or with §15–§18, the patched sections win.
>
> | Original task | Status under the new plan |
> |---|---|
> | 1.1, 1.2 | Task A, unchanged |
> | 2.1 | Task B. Use the §7.1 counting convention, §7.10 integer arithmetic, `TierId` and the §7.12 invariants. Drop the `TIERS` names |
> | 2.2 | Task E. Add `abandoned` and the §4.6 issuance rules |
> | 3.1–3.3 | Task F. The schema is §5 as amended by §5.20. Seed priors as `prior_ppm` snapshots that sum to 1,000,000 |
> | 4.1 | Task D, unchanged in intent. Candidates store `canonical_answer_id` and `normalization_version` (§7.10) |
> | 5.1 | Part of Task G. Add the idempotent round issuance of §4.6 |
> | 5.2 | Task G. Replace "ALREADY_SUBMITTED" with the §9 and §18.5 contract (`request_id` conflict, `STALE_VERSION`) |
> | 5.3 | Task B plus Task I. It must **not** write snapshot rows. Provisional scoring is the cache path of §7.8 |
> | 5.4 | Task H. Use the cohort lock and predecessor invariant of §7.6 and §11.6 |
> | 6.1, 6.2 | Task I plus the worker of §4.5. Channels are the two in §8.1 |
> | 7.x, 8.x, 9.x | Task J, built against the §18.10 response contracts |
> | 10.1 | Task L, with `admin_roles` (§5.20) |
> | 11.x | Spread across the Tasks, plus the §18.12 race tests |
> | 12.1, 12.2 | Task M. Rate limits are in §10.4 |
> | 12.3 | The nightly job now creates a **new immutable `prior_snapshots` row**. It never updates one, and it excludes guests by default (§7.2) |
>
> Review gates (§18.13) sit after Task C, after Task H and after Task M. Task C does **not** freeze scoring config v1 until the §7.11 gate has passed.

### Phase 1: Project Scaffold and Tooling

#### Task 1.1: Initialize Next.js 14 App Router project

**Description:** Scaffold a new Next.js 14 project with TypeScript, Tailwind CSS, ESLint, and Prettier. Configure `tsconfig.json` with strict mode and path aliases. Set up Vitest and Playwright.

**Acceptance criteria:**
- [ ] `npx create-next-app@14` with App Router, TypeScript, Tailwind
- [ ] `tsconfig.json` has `"strict": true` and `"paths": { "@/*": ["./src/*"] }`
- [ ] `vitest.config.ts` configured with `@vitejs/plugin-react`
- [ ] `playwright.config.ts` configured for localhost:3000
- [ ] `npm run dev`, `npm run build`, `npm test`, `npm run e2e` all succeed

**Files touched:** `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `tailwind.config.ts`, `.eslintrc.json`, `.prettierrc`

**Size:** S | **Dependencies:** None

---

#### Task 1.2: Configure Supabase local development

**Description:** Initialize Supabase CLI, configure `supabase/config.toml`, and set up environment variable templates.

**Acceptance criteria:**
- [ ] `supabase init` completed; `supabase/config.toml` present
- [ ] `.env.local.example` documents all required env vars
- [ ] `supabase start` runs local Postgres and Studio
- [ ] `src/lib/supabase/client.ts` and `src/lib/supabase/server.ts` created with correct key usage

**Files touched:** `supabase/config.toml`, `.env.local.example`, `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`

**Size:** S | **Dependencies:** Task 1.1

---

### Phase 2: Scoring Engine (Pure Domain, No DB)

#### Task 2.1: Implement tier definitions and scoring formula

**Description:** Implement the `p_estimated` formula, tier threshold lookup, and depth conversion as pure TypeScript functions with no side effects.

**Acceptance criteria:**
- [ ] `src/domain/scoring/tiers.ts` exports `TIERS` constant matching the 6-tier table
- [ ] `src/domain/scoring/engine.ts` exports `computePEstimated(C, N, alpha, pPrior)` and `assignTier(pEstimated)`
- [ ] `src/domain/scoring/depth.ts` exports `toDepthMetres(points)`
- [ ] All functions are pure (no I/O, no imports from `src/services/` or `src/lib/`)
- [ ] Unit tests cover: cold start (N=0), small N, large N, all 6 tier boundaries, tie-breaking

**Files touched:** `src/domain/scoring/tiers.ts`, `src/domain/scoring/engine.ts`, `src/domain/scoring/depth.ts`, `tests/unit/scoring/engine.test.ts`

**Size:** S | **Dependencies:** Task 1.1

---

#### Task 2.2: Implement game state machine

**Description:** Implement the state transition validator as a pure function.

**Acceptance criteria:**
- [ ] `src/domain/statemachine/types.ts` exports `GameState` and `RoundState` enums
- [ ] `src/domain/statemachine/transitions.ts` exports `assertTransition(from, to)` that throws `InvalidStateTransitionError` for illegal transitions
- [ ] All legal transitions pass; all illegal transitions throw
- [ ] Unit tests cover all legal and illegal transitions

**Files touched:** `src/domain/statemachine/types.ts`, `src/domain/statemachine/transitions.ts`, `tests/unit/statemachine/transitions.test.ts`

**Size:** S | **Dependencies:** Task 1.1

---

### Phase 3: Database Schema and Migrations

#### Task 3.1: Write initial schema migration

**Description:** Write the full PostgreSQL schema as a Supabase migration file covering all tables defined in Section 5.

**Acceptance criteria:**
- [ ] `supabase/migrations/0001_initial_schema.sql` creates all tables with correct types, constraints, and indexes
- [ ] `supabase db reset` applies migration cleanly
- [ ] All foreign key relationships are correct
- [ ] PostgreSQL enum types (`challenge_mode`, `session_state`, `round_state`) are created

**Files touched:** `supabase/migrations/0001_initial_schema.sql`

**Size:** M | **Dependencies:** Task 1.2

---

#### Task 3.2: Write RLS policies migration

**Description:** Write all Row Level Security policies as defined in Section 10.2.

**Acceptance criteria:**
- [ ] `supabase/migrations/0002_rls_policies.sql` enables RLS on all tables and creates all policies
- [ ] Anon client cannot read `scoring_snapshots`
- [ ] Players can only read their own `game_sessions` and `answer_submissions`
- [ ] `questions` and `challenges` are publicly readable (with filters)

**Files touched:** `supabase/migrations/0002_rls_policies.sql`

**Size:** S | **Dependencies:** Task 3.1

---

#### Task 3.3: Seed scoring config and test questions

**Description:** Insert default `scoring_config_versions` row and a set of 10 test questions with canonical answers and aliases.

**Acceptance criteria:**
- [ ] `supabase/migrations/0003_scoring_config.sql` inserts default config with α=20, p_prior=0.05
- [ ] `supabase/migrations/0004_seed_questions.sql` inserts ≥10 questions with ≥3 canonical answers each
- [ ] `supabase db reset` produces a usable dev database

**Files touched:** `supabase/migrations/0003_scoring_config.sql`, `supabase/migrations/0004_seed_questions.sql`

**Size:** M | **Dependencies:** Task 3.1

---

### Phase 4: Answer Normalization Pipeline

#### Task 4.1: Implement normalization pipeline

**Description:** Implement all 8 steps of the normalization pipeline as pure functions.

**Acceptance criteria:**
- [ ] `src/domain/normalization/pipeline.ts` exports `normalizePipeline(rawText, lookupMaps)` returning `NormalizationResult`
- [ ] Each step is implemented in its own module (`unicode.ts`, `punctuation.ts`, `typo.ts`)
- [ ] Damerau-Levenshtein distance function implemented and tested
- [ ] Typo correction rejects ambiguous matches (two candidates at distance 1)
- [ ] Unit tests cover: empty input, too-long input, exact match, alias match, typo match, ambiguous typo, no match

**Files touched:** `src/domain/normalization/pipeline.ts`, `src/domain/normalization/unicode.ts`, `src/domain/normalization/punctuation.ts`, `src/domain/normalization/typo.ts`, `tests/unit/normalization/pipeline.test.ts`

**Size:** M | **Dependencies:** Task 1.1

---

### Phase 5: Backend Game Services

#### Task 5.1: Implement session service

**Description:** Implement `session.service.ts` to create and resume game sessions, enforcing the one-session-per-player-per-challenge constraint.

**Acceptance criteria:**
- [ ] `createOrResumeSession(playerId, challengeId)` returns existing session if one exists
- [ ] Creates `challenge_participants` row on first join
- [ ] Returns correct session state
- [ ] Integration test covers: new session, resume session, completed session rejection

**Files touched:** `src/services/session.service.ts`, `tests/integration/submission.test.ts`

**Size:** S | **Dependencies:** Tasks 3.1, 3.2

---

#### Task 5.2: Implement submission service

**Description:** Implement `submission.service.ts` to accept, normalize, and store answers with idempotency.

**Acceptance criteria:**
- [ ] Loads alias and canonical lookup maps from DB for the question
- [ ] Runs normalization pipeline
- [ ] Stores `answer_submissions` row with `request_id` idempotency
- [ ] Returns `ALREADY_SUBMITTED` for duplicate `request_id`
- [ ] Returns `ROUND_CLOSED` if round state is not `question_active`
- [ ] Publishes `submission_accepted` Realtime event on success
- [ ] Integration test covers all acceptance/rejection paths

**Files touched:** `src/services/submission.service.ts`, `tests/integration/submission.test.ts`

**Size:** M | **Dependencies:** Tasks 4.1, 5.1

---

#### Task 5.3: Implement scoring service

**Description:** Implement `scoring.service.ts` to compute `p_estimated` for all answers in a round and publish provisional scores.

**Acceptance criteria:**
- [ ] `computeProvisionalScores(roundId)` queries live counts and priors, computes `p_estimated` for each canonical answer
- [ ] Writes `scoring_snapshots` rows
- [ ] Publishes `provisional_score_updated` Realtime events (per-player, not broadcast)
- [ ] Never sends raw counts to client
- [ ] Unit test covers formula correctness; integration test covers DB interaction

**Files touched:** `src/services/scoring.service.ts`, `tests/integration/submission.test.ts`

**Size:** M | **Dependencies:** Tasks 2.1, 5.2

---

#### Task 5.4: Implement finalization service

**Description:** Implement `finalization.service.ts` to lock rounds, compute final scores, and transition state.

**Acceptance criteria:**
- [ ] `finalizeRound(roundId)` is idempotent (safe to call twice)
- [ ] Uses optimistic locking (`WHERE state = 'question_closing'`)
- [ ] Creates `final_answers` from `answer_submissions`
- [ ] Creates `player_question_scores` with `ON CONFLICT DO NOTHING`
- [ ] Transitions round to `reveal` state
- [ ] Publishes `round_result_published` Realtime event
- [ ] If last question, transitions session to `challenge_complete` and publishes `challenge_completed`
- [ ] Integration test covers: normal finalization, idempotent double-call, last question

**Files touched:** `src/services/finalization.service.ts`, `tests/integration/finalization.test.ts`

**Size:** L | **Dependencies:** Tasks 5.3, 2.2

---

### Phase 6: Real-Time Integration

#### Task 6.1: Implement Realtime channel utilities

**Description:** Implement channel name builders and the `useRealtimeChannel` React hook.

**Acceptance criteria:**
- [ ] `src/lib/realtime/channels.ts` exports `challengeChannel(id)`, `sessionChannel(id)`, `roundChannel(id)`, `leaderboardChannel(id)`
- [ ] `src/lib/realtime/hooks.ts` exports `useRealtimeChannel(channelName, eventHandlers)` hook
- [ ] Hook subscribes on mount, unsubscribes on unmount
- [ ] Hook handles reconnection gracefully

**Files touched:** `src/lib/realtime/channels.ts`, `src/lib/realtime/hooks.ts`

**Size:** S | **Dependencies:** Tasks 1.2, 2.1

---

#### Task 6.2: Implement finalization cron endpoint

**Description:** Implement the `/api/finalize/:roundId` route handler and configure Vercel Cron to poll for expired rounds.

**Acceptance criteria:**
- [ ] Route handler validates `CRON_SECRET` bearer token
- [ ] Calls `finalization.service.finalizeRound(roundId)`
- [ ] Vercel cron job configured to run every 5 seconds (or minimum interval)
- [ ] Cron job queries for rounds where `closes_at <= NOW()` and `state = 'question_active'`

**Files touched:** `src/app/api/finalize/[roundId]/route.ts`, `vercel.json`

**Size:** S | **Dependencies:** Task 5.4

---

### Phase 7: Frontend — Landing and Lobby

#### Task 7.1: Implement landing page and navigation

**Description:** Build the home page with Daily Challenge and Practice mode entry points.

**Acceptance criteria:**
- [ ] `/` page renders with game title, description, and two CTAs
- [ ] Daily Challenge CTA links to `/daily`
- [ ] Practice CTA links to `/practice`
- [ ] Responsive layout with Tailwind
- [ ] Guest play requires no login (session created on entry)

**Files touched:** `src/app/page.tsx`, `src/app/(game)/daily/page.tsx`, `src/app/(game)/practice/page.tsx`, `src/components/layout/Header.tsx`

**Size:** S | **Dependencies:** Tasks 1.1, 5.1

---

#### Task 7.2: Implement session creation and lobby screen

**Description:** Build the lobby screen that creates a session and waits for the challenge to start.

**Acceptance criteria:**
- [ ] Calls `POST /api/session` on page load
- [ ] Shows challenge metadata and player count
- [ ] Subscribes to `challenge:{id}` Realtime channel
- [ ] Transitions to question screen when `question_started` event received
- [ ] Handles guest token persistence in cookie

**Files touched:** `src/app/(game)/session/[sessionId]/page.tsx`, `src/components/game/DepthMeter.tsx`

**Size:** M | **Dependencies:** Tasks 6.1, 7.1

---

### Phase 8: Frontend — Active Question Screen

#### Task 8.1: Implement question card and answer input

**Description:** Build the active question UI with countdown timer and answer submission.

**Acceptance criteria:**
- [ ] Displays `prompt_text` and optional `hint_text`
- [ ] Countdown timer initialized from `closes_at` server timestamp
- [ ] Answer input disabled after submission or timer expiry
- [ ] Submits to `POST /api/answer` with client-generated `request_id`
- [ ] Shows provisional tier badge after submission accepted
- [ ] Updates tier badge when `provisional_score_updated` event received
- [ ] Shows `question_closed` state when timer expires

**Files touched:** `src/components/game/QuestionCard.tsx`, `src/components/game/AnswerInput.tsx`, `src/components/game/CountdownTimer.tsx`, `src/components/game/TierBadge.tsx`

**Size:** M | **Dependencies:** Tasks 6.1, 7.2

---

### Phase 9: Frontend — Reveal, Results, and Leaderboard

#### Task 9.1: Implement round reveal screen

**Description:** Build the reveal screen showing all answers and their tiers after a round closes.

**Acceptance criteria:**
- [ ] Triggered by `round_result_published` Realtime event
- [ ] Shows all canonical answers with tier, points, and player count
- [ ] Highlights the player's own answer
- [ ] Shows running total depth meter
- [ ] Auto-advances to next question when `question_started` received

**Files touched:** `src/components/game/RevealCard.tsx`, `src/components/game/DepthMeter.tsx`

**Size:** M | **Dependencies:** Task 8.1

---

#### Task 9.2: Implement challenge complete and leaderboard screens

**Description:** Build the end-of-dive results screen and leaderboard.

**Acceptance criteria:**
- [ ] Triggered by `challenge_completed` Realtime event
- [ ] Shows total depth, total points, and rank
- [ ] Leaderboard shows top 50 players with depth
- [ ] Subscribes to `leaderboard:{id}` for live updates
- [ ] Share button generates shareable depth result

**Files touched:** `src/app/(game)/session/[sessionId]/result/page.tsx`, `src/components/game/Leaderboard.tsx`, `src/app/(game)/leaderboard/page.tsx`

**Size:** M | **Dependencies:** Task 9.1

---

### Phase 10: Admin Question Management

#### Task 10.1: Implement admin question CRUD

**Description:** Build the admin interface for creating and managing questions, canonical answers, and aliases.

**Acceptance criteria:**
- [ ] Admin layout enforces `role: 'admin'` JWT claim
- [ ] Question list page with search and filter
- [ ] Question editor with version history
- [ ] Alias manager for adding/removing aliases
- [ ] All admin API routes protected server-side

**Files touched:** `src/app/admin/`, `src/components/admin/`, `src/app/api/admin/`, `src/services/admin.service.ts`

**Size:** L | **Dependencies:** Tasks 3.1, 5.1

---

### Phase 11: Test Suite

#### Task 11.1: Complete unit test coverage

**Description:** Ensure ≥90% coverage on all `src/domain/` modules.

**Acceptance criteria:**
- [ ] `tests/unit/scoring/engine.test.ts` covers all tier boundaries and edge cases
- [ ] `tests/unit/normalization/pipeline.test.ts` covers all 8 pipeline steps
- [ ] `tests/unit/statemachine/transitions.test.ts` covers all legal and illegal transitions
- [ ] `vitest --coverage` reports ≥90% on `src/domain/`

**Files touched:** `tests/unit/`

**Size:** M | **Dependencies:** Tasks 2.1, 2.2, 4.1

---

#### Task 11.2: Integration tests for submission and finalization

**Description:** Write integration tests against a local Supabase instance.

**Acceptance criteria:**
- [ ] `tests/integration/submission.test.ts` covers: accept, reject, idempotency, round-closed
- [ ] `tests/integration/finalization.test.ts` covers: normal, idempotent, last-question
- [ ] `tests/integration/leaderboard.test.ts` covers: ranking, tie-breaking

**Files touched:** `tests/integration/`

**Size:** M | **Dependencies:** Tasks 5.2, 5.4

---

#### Task 11.3: E2E tests for core game flows

**Description:** Write Playwright tests for the full daily challenge and practice flows.

**Acceptance criteria:**
- [ ] `tests/e2e/daily-challenge.spec.ts`: guest plays full 7-question daily challenge
- [ ] `tests/e2e/practice.spec.ts`: guest plays practice session
- [ ] `tests/e2e/admin.spec.ts`: admin creates question and publishes challenge
- [ ] All tests pass against local dev environment

**Files touched:** `tests/e2e/`

**Size:** L | **Dependencies:** Tasks 7.1–9.2, 10.1

---

### Phase 12: Hardening and Deployment Config

#### Task 12.1: Configure Vercel deployment

**Description:** Set up Vercel project, environment variables, and cron jobs.

**Acceptance criteria:**
- [ ] `vercel.json` configures cron for finalization poller (every 60 seconds minimum on free tier)
- [ ] All environment variables documented in `.env.local.example`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` confirmed server-only (not in client bundle)
- [ ] Production build succeeds with `npm run build`

**Files touched:** `vercel.json`, `.env.local.example`

**Size:** S | **Dependencies:** Task 6.2

---

#### Task 12.2: Implement rate limiting middleware

**Description:** Add Vercel Edge Middleware for rate limiting on sensitive endpoints.

**Acceptance criteria:**
- [ ] `src/middleware.ts` applies rate limits per Section 10.4
- [ ] Rate limit headers returned on 429 responses
- [ ] Tested with load simulation

**Files touched:** `src/middleware.ts`

**Size:** S | **Dependencies:** Task 12.1

---

#### Task 12.3: Prior computation scheduled job

**Description:** Implement the nightly job that recomputes `answer_priors` from historical data.

**Acceptance criteria:**
- [ ] Supabase Edge Function or Vercel Cron computes `p_prior` for each `canonical_answer_id` per `question_id`
- [ ] Uses only `final_answers` from completed sessions (not guest sessions, configurable)
- [ ] Updates `answer_priors` table atomically
- [ ] Runs nightly at 00:05 UTC

**Files touched:** `supabase/functions/compute-priors/index.ts` or `src/app/api/admin/compute-priors/route.ts`

**Size:** M | **Dependencies:** Tasks 5.4, 12.1

---

### Checkpoints

```
After Phase 2: Scoring engine and state machine unit tests pass (no DB required)
After Phase 3: supabase db reset succeeds; schema matches ERD
After Phase 5: Integration tests for submission and finalization pass
After Phase 9: Full game flow playable in browser against local Supabase
After Phase 11: All tests pass; coverage ≥90% on domain layer
After Phase 12: Production build deploys to Vercel; cron jobs active
```

---

## 13. Open Questions and Defaults

| # | Question | Recommended Default | Decision Needed By |
|---|---|---|---|
| OQ-1 | What is the inter-question delay between `reveal` and the next `question_started`? | 10 seconds | Before Phase 6 |
| OQ-2 | Should practice mode use the same question pool as daily, or a separate pool? | Separate pool (daily questions embargoed until after their day). Practice scoring reads the frozen reference snapshot of §5.20 | Before Phase 3 |
| OQ-3 | Should guest sessions contribute to prior computation? | No: `priors_include_guests = false` (§7.2). Guests still count in the live ranked cohort | **Decided** |
| OQ-4 | What is the minimum Vercel plan needed for sub-60-second cron jobs? | Vercel Pro (60s minimum on free tier; use Supabase Edge Function for 5s polling instead) | Before Phase 6 |
| OQ-5 | Should `display_name` be required at session start, or auto-generated for guests? | Auto-generated (e.g., "DeepDiver#4821") with optional rename | Before Phase 7 |
| OQ-6 | Is there a maximum number of participants per daily challenge? | No cap for MVP | Before Phase 5 |
| OQ-7 | Should the leaderboard be paginated or infinite-scroll? | Paginated (50 per page) | Before Phase 9 |
| OQ-8 | What happens if a question has zero canonical answers (misconfigured)? | Reject at challenge publish time; admin validation required | Before Phase 10 |
| OQ-9 | Should priors be seeded manually for launch, or start from scratch? | Seed editorial `prior_snapshots` (integer ppm, summing to 1,000,000). No flat default (§7.2) | **Decided** |
| OQ-10 | Is there a social sharing feature (e.g., "I dove 4,200 m today")? | Yes — static share card with depth and tier breakdown | Before Phase 9 |

---

## 14. Known Limitations (MVP)

| # | Limitation | Future Mitigation |
|---|---|---|
| L-1 | No real-time multiplayer synchronization of question start times — daily challenge starts are fixed by `challenges.starts_at`, not coordinated across players | Implement a synchronized lobby countdown in v2 |
| L-2 | Typo correction uses in-memory Damerau-Levenshtein over all canonical answers per question — may be slow for questions with >100 canonical answers | Pre-compute edit distance index or use pg_trgm for fuzzy matching |
| L-3 | No CAPTCHA or phone verification — Sybil attacks are rate-limited but not fully prevented | Add CAPTCHA on account creation in v2 |
| L-4 | Vercel free tier cron minimum is 60 seconds — finalization may lag up to 60 seconds after timer expiry | Use Supabase Edge Function with Postgres `pg_cron` for 5-second polling, or upgrade to Vercel Pro |
| L-5 | No answer moderation — offensive or inappropriate answers are stored as-is | Add content moderation pipeline (e.g., OpenAI Moderation API) in v2 |
| L-6 | No persistent account features beyond display name — no profile page, no achievement system | Implement player profiles and achievements in v2 |
| L-7 | Leaderboard rank is computed post-finalization, not real-time during the challenge | Implement real-time rank updates via `leaderboard_updated` events in v2 |

---

## 15. ADR 0001: Architecture Decisions

Status: Proposed, pending owner approval. Supersedes the conflicting parts of §4, §5.11–5.15, §7, §8 and §11.

### D1. Stack

Next.js 14 App Router, TypeScript strict mode, Tailwind, Supabase (Postgres, Realtime, Auth), Zod, Vitest, Playwright, deployed on Vercel.

- It was already chosen in §2, so there is no reason to re-litigate it.
- Supabase avoids building WebSocket infrastructure.
- All game logic lives in pure `src/domain/*` modules with no I/O, so it can be tested without a database.
- Consequence: scoring correctness depends on Postgres transactions and locks, not on the framework.

### D2. Server owns time and scoring

The browser clock is display-only. Deadlines are written with the DB clock. Late-submission checks happen inside the same transaction that writes the answer, under a row lock.

### D3. Population model: rolling cohort

Each player has their own 60s deadline, and their score is frozen at that deadline. The eligible population is every valid answer from earlier-closing ranked rounds on the same challenge question, plus the player's own.

- Accepted trade-off: early players are scored on small samples and lean on the prior.
- Rejected alternatives: synchronized live windows (they limit when you can play), and recomputing everything at the daily cutoff (scores would stay provisional for hours).

### D4. Scoring formula and tiers

`p = (C + α·p_prior) / (N + α)`, mapped to six fixed point values (10, 15, 30, 60, 85, 100) through a **versioned, configurable** threshold table. Each stored score records the config version.

Not yet decided, to be settled by simulation (§16, Task C):
- the value of α
- the threshold values
- whether the provisional display applies hysteresis

The thresholds in §7.3 are placeholders only. Do not treat them as final.

### D5. Priors

Every launch question needs reviewed editorial priors, including a residual mass for other valid answers. The flat 0.05 fallback is a last resort and must be logged when used.

### D6. What the player sees

During the round: provisional tier and points only, never counts or percentages. After the deadline: the final tier plus an aggregate popularity figure on the reveal screen.

Open: whether the reveal shows a percentage is checked against Krillion's behavior in Q8 (§17.4), but the Abyssal decision is the owner's.

### D7. Revisions

An append-only submission history plus one current candidate per player per round. Counts are derived from candidates, so a revision cannot double-count.

### D8. Finalization

Idempotent. It runs lazily on any read or write after `closes_at`, with cron as the backstop. It uses an optimistic state change and `ON CONFLICT DO NOTHING`.

### D9. Identity and modes

Guest-first. Only Daily is ranked. Practice reuses the frozen ranked counts but never feeds back into them.

### D10. Validation is deterministic

No LLM in the scoring path. Ambiguous aliases are rejected. Typo correction is allowed only when it produces exactly one match.

### Risks carried forward

- Sybil attacks are only mitigated, not prevented.
- Early-player noise depends on prior quality.
- Krillion's claimed behavior (K1–K12) is unverified, so no Abyssal decision should rely on it until the Q-table in §17.4 is filled in.

---

## 16. Rolling-Cohort Scoring Plan and Gap List

### 16.1 Locked decisions

| Topic | Decision |
|---|---|
| Rarity model | Hybrid: live popularity smoothed with a historical prior, `p = (C + α·p_prior) / (N + α)` |
| Population model | **Rolling cohort.** Each player gets their own 60s deadline. The score is frozen at that deadline. |
| In-round display | Provisional tier and points only. No counts and no percentages. A subtle activity indicator is allowed. |
| Final score | Computed and locked by the server at the player's own deadline. Never computed by the client. |
| Identity | Instant guest play. Optional accounts later. |
| Scope | Daily Dive plus Unlimited Practice. Private rooms are only structurally supported. |

### 16.2 Rolling-cohort definition

§4 and §5 give each player their own `question_rounds`, tied to `game_sessions`. The scoring tables key on `question_round_id`, and the Realtime channel is `round:{id}`. Those cannot express a population shared across players. The fix is to key population data on `challenge_question_id`.

**Eligible population for player P's final score on question Q:**

- All `final_answers` for the same `challenge_question_id` that satisfy all of these:
  - They are valid, meaning they resolved to a canonical answer.
  - Their round's `closes_at < P.closes_at`, with ties broken by `question_round_id`.
  - They are from ranked (daily) sessions only.
- P's own final answer is included in both C and N.

This definition is a total order on rounds. Replaying finalization over the same data gives the same result. That is the determinism guarantee.

**Provisional score while P is typing:** use the same formula over every currently accepted candidate answer for `challenge_question_id`, including other players' still-open rounds. P's own current candidate is counted once.

**Known fairness property, documented and not hidden:** early players are scored on small samples, so their scores lean on the prior. Late players are scored against a richer population. The prior is therefore the main fairness lever, and every launch question needs reviewed priors.

**Practice mode:**
- Scored with the same formula.
- C and N come from the frozen ranked counts for that question.
- Practice answers never feed back into priors or ranked populations.
- Practice results never appear on ranked leaderboards.

### 16.3 Gaps in §4–§11, with required fixes

| # | Gap | Where | Fix |
|---|---|---|---|
| G1 | Population is not shared across players. `scoring_snapshots` and Realtime `round:{id}` are per-session. | §5.14, §8 | Key counts on `challenge_question_id`. Make scoring snapshots immutable and per-player-per-question. Drop the shared `round:` channel in favor of private `session:{id}` events. |
| G2 | The spec allows revisions until the deadline, and invalid guesses must not consume the attempt. The doc's `UNIQUE(question_round_id, player_profile_id)` and "first accepted answer locks" contradict this. | §5.12, §11.1, §11.3 | Split into an append-only `answer_submissions` history plus a `round_candidates` row, upserted per player per round, holding the current accepted canonical answer. Keep a per-round `candidate_version` for optimistic concurrency. |
| G3 | Revision frequency correction is not specified. | §7 | Counts are derived from `round_candidates` (or a transactionally maintained counter table). They are never incremented blindly. |
| G4 | The rate limit of 5 requests per 60s breaks legitimate revision. | §11.1 | Use a configurable limit, for example 20 per minute per session and per IP. Dedupe by `request_id`. |
| G5 | The cold-start default of `p_prior = 0.05` makes every unseen answer a Schooler. Priors do not sum to 1. | §7.2 | Require per-question editorial priors. Include an explicit residual "other valid answers" mass. Document the fallback. |
| G6 | Tier assignment uses fixed thresholds with no uncertainty handling. | §7.3 | Use a versioned, configurable threshold table. Apply hysteresis to the provisional display so the tier does not flicker. The final tier uses the raw estimate. Calibrate by simulation. |
| G7 | Finalization depends on a cron poll (60s minimum on Vercel free tier). | §4.5, L-4 | Add lazy finalization. Any read or write touching a round past `closes_at` runs the idempotent finalizer. Cron is only a backstop. |
| G8 | The late-submission check is only in the finalizer. | §11.2 | Reject at write time using the DB clock inside the same transaction as the candidate upsert. Lock the round row (`FOR UPDATE`). |
| G9 | `scoring_config_versions` is not referenced by final scores. | §5.15 | Add `scoring_config_version` to `player_question_scores`. Store the population size and the frozen C and N used. |
| G10 | The Sybil section is partly overstated. | §11.4 | State plainly that the controls are mitigations only. |
| G11 | Practice and ranked are not separated in the model. | §5.8, §5.16 | `challenges.mode` already exists. Add `is_ranked` to the population query and an index on it. Exclude practice from the leaderboard. |
| G12 | Admin RBAC and retention are underspecified. | §10 | Add an `admin_roles` check and a retention policy for `answer_submissions.raw_text`. |

### 16.4 Revised task order (vertical slices, high-risk first)

This supersedes the phase order in §12. Task IDs are A–M so they do not clash with §12's numbering.

1. **Task A: Scaffold.** Next.js 14, TypeScript strict mode, Tailwind, Vitest, Playwright, ESLint, Prettier. Verify with `npm run build` and `npm test`.
2. **Task B: Scoring engine (pure).**
   - Implement `computePEstimated`, `assignTier`, hysteresis, and `toDepthMetres`, versioned by a scoring config.
   - Test every tier boundary, N=0/1/3/10/100/1000, ties, and reproducibility.
   - **Checkpoint:** engine tests pass with no DB.
3. **Task C: Calibration simulation.** Add a seeded simulation harness (skewed answer distributions, revisions, bursts). Output a threshold-rationale doc, `docs/SCORING.md`. Freeze config v1.
4. **Task D: Normalization pipeline (pure).**
   - Unicode normalization, punctuation and spacing rules, alias lookup, and canonical lookup.
   - Typo correction only when unambiguous.
   - Ambiguous-alias rejection.
5. **Task E: State machine (pure).** Cover the legal and illegal transitions for the per-player round lifecycle.
6. **Task F: Schema and migrations.**
   - Include the G1, G2, G9, and G11 fixes.
   - Add RLS.
   - Seed at least 20 original questions with aliases and priors.
   - Verify `supabase db reset` on a clean database.
7. **Task G: Submission and candidate service.** Submit and revise, idempotent by `request_id`, with deadline check under row lock. Integration tests for revision, invalid guesses, late submissions, and duplicate requests.
8. **Task H: Finalization service.** Freeze the cohort at the deadline, write the immutable snapshot and `player_question_scores` idempotently, and add lazy finalization plus a cron backstop. Tests for double finalization and a deadline race.
   - **Checkpoint:** integration and concurrency tests pass (1, 3, 10, and 100 players, 1,000 submissions).
9. **Task I: Realtime.** Private `session:{id}` provisional events carrying a monotonic version, a resync endpoint, and rate-limited or batched fan-out. Verify duplicate and out-of-order handling.
10. **Task J: Daily flow UI.** Landing, lobby, active question, reveal, and results. This is the first full vertical slice and covers keyboard use and reduced motion.
11. **Task K: Practice mode, leaderboard, and history.** Includes shared ranks with deterministic tie-breaking.
12. **Task L: Admin workflow.** RBAC-protected question CRUD, alias review, publish immutable versions, and a calibration view.
13. **Task M: Hardening and delivery.** Playwright e2e, accessibility pass, security review, and README with env vars, deploy steps, and known limitations. Report actual test results.

### 16.5 Acceptance additions

- Score determinism: running finalization twice on the same data gives byte-identical `player_question_scores`.
- A revision decrements the old answer's count and increments the new one's, verified by test.
- No API response contains `C`, `N`, `p_estimated`, or another player's raw answer.
- A submission at `closes_at + ε` is rejected even if the client timer has not hit zero.
- Practice answers do not change ranked populations or priors.

### 16.6 Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Early-player scoring noise | Medium | Strong editorial priors, α tuned by simulation, documented behavior |
| Cron lag on free hosting | Medium | Lazy finalization on read and write |
| Small-population manipulation | Medium | Rate limits, guest exclusion from priors, documented as a limitation |
| Alias ambiguity | High | Reject ambiguous matches, admin review queue, deterministic tests |

---

## 17. Krillion Research Notes

> **Provenance warning.** The author of this section (an AI planning agent) had **no web access and did not play the game**. Everything under 17.1 comes from the product owner's own research summary, which cites krillion.io and krillion.io/faq. None of it has been independently verified. Section 17.4 lists what must be confirmed by a human playing the game.
>
> Abyssal is an original product. This section records *mechanics* only. Do not copy Krillion's name, logo, art, layout, copy or question content.

### 17.1 Claimed facts (owner-supplied, unverified)

| ID | Claim | Source cited | Confidence |
|---|---|---|---|
| K1 | Open-ended questions, no multiple choice; the player types one answer | krillion.io | Medium |
| K2 | The same daily questions go to all players | krillion.io | Medium |
| K3 | Seven questions per dive | krillion.io | Medium |
| K4 | 20-second answer window per question | krillion.io | Medium |
| K5 | Six rarity tiers worth 10, 15, 30, 60, 85 and 100 points | krillion.io | Medium |
| K6 | Tier names and descriptions: Plankton (extremely common), Too Clever (popular supposedly obscure picks), Schooler (fairly common), Rare, Deep Cut, One in a Krillion (exceptionally rare) | krillion.io | Medium |
| K7 | Accepted answers and aliases exist per question | FAQ | Medium |
| K8 | Rarity is determined using curated answer sets, familiarity data and editorial judgment, **not necessarily recalculated from the live answers of everyone currently playing** | FAQ | Medium; this is the most important claim |
| K9 | Aliases can accidentally match unrelated answers, even after human review | FAQ | Medium |
| K10 | Underwater depth progression is a core visual mechanic | krillion.io | Low |
| K11 | Daily play and a practice mode exist | krillion.io | Low |
| K12 | Friends and competitive play exist | krillion.io | Low |

### 17.2 Implications for Abyssal

- **K8 is why Abyssal differs.** Krillion's rarity is, per the FAQ, closer to curated than live. Abyssal uses live population plus a prior, so it is not a clone of Krillion's scoring. We cannot assume Krillion has validated any of our live-scoring behavior.
- **K9 means validation and rarity are separate problems.** Abyssal must decide whether an answer is *valid* before it scores its rarity.
- **K4 versus Abyssal's 60 seconds.** This is a deliberate deviation. It changes the typing and thinking dynamics, and tier calibration may not transfer.
- **K6, "Too Clever", is not a pure frequency tier.** Its description implies answers that look obscure but are actually popular. A purely frequency-based mapping at roughly 15–30% popularity is a different thing. See Q3 in 17.4.

### 17.3 Inconsistency found in the owner's worked example

The owner's illustration used 1,000 players, with Forth at 1 player and 100 points.

| Answer | Count | Raw p | Tier in the example | Tier under the §7.3 thresholds |
|---|---|---|---|---|
| Python | 360 | 0.360 | Plankton | Plankton |
| JavaScript | 220 | 0.220 | Too Clever | Too Clever |
| Rust | 90 | 0.090 | Schooler | Schooler |
| Elixir | 18 | 0.018 | Rare | Rare |
| OCaml | 5 | 0.005 | Deep Cut | Deep Cut |
| Forth | 1 | 0.001 | One in a Krillion | **Deep Cut**: the lower bound is inclusive, so p = 0.001 falls in Deep Cut |

With smoothing (α=20, p_prior=0.05), Forth gets about (1+1)/(1020) ≈ 0.002, which is Deep Cut as well. The example is illustrative only, but the thresholds must be calibrated by simulation (§16.4, Task C), not taken from this table.

### 17.4 Open questions that need hands-on play

Play at least three daily dives, plus practice, and record answers here. Do not guess.

| # | Question | How to find out | Answer (fill in) |
|---|---|---|---|
| Q1 | Is the 20s timer a hard lock? Can you revise an answer before it ends? | Type, edit and resubmit | |
| Q2 | What happens on an invalid or unrecognized answer? Is there a retry, or is it zero? | Enter nonsense, then a valid answer | |
| Q3 | Does "Too Clever" behave like a frequency band or a special rule? | Compare tiers for popular answers | |
| Q4 | Is the tier shown *before* the round ends, or only at reveal? | Observe during a question | |
| Q5 | Does the same answer always get the same tier on replay or across days? (curated vs live) | Repeat an answer in practice | |
| Q6 | Is the score tied to the player population at all, or fully fixed per answer? | Compare with the FAQ wording | |
| Q7 | Is the daily dive playable only once? Are guests allowed? | Reload and try again | |
| Q8 | How does a reveal explain the tier? Does it show percentages? | Screenshot the reveal screen | |
| Q9 | What are the aliasing and typo-tolerance behaviors (e.g. "JS" vs "JavaScript", a one-letter typo)? | Test variants | |
| Q10 | How is depth displayed, and how does it map to points? | Observe the progress UI | |
| Q11 | What does the results and share screen contain? Is it spoiler-free? | Finish a dive | |
| Q12 | Are there ranks or percentiles, and at what population size do they appear? | Check the leaderboard | |

### 17.5 Rules for using this section

- Do not turn a Q-row answer into a requirement without a dated note saying who verified it.
- If play-testing contradicts K1–K12, update the claim table and note the date.
- Product decisions that deviate from Krillion belong in §15, not here.

---

## 18. Pre-Implementation Gap Resolutions

Status: **Recommended, pending owner approval.** These come from an external review of §15–§17. Priority 0 (P0) means resolve before the relevant scoring or database subsystem is built. Priority 1 (P1) means resolve before launch. Items marked "Owner decision" have a recommended default but need your confirmation.

### 18.1 Three separated concerns

| Concern | Owns | Must not leak into |
|---|---|---|
| Product rules | What is a valid answer, how points are earned, what players are told | Scoring math |
| Scoring mathematics | Priors, populations, thresholds, tier mapping | Transaction code |
| Distributed-systems correctness | Submissions, deadlines, revisions, finalization under concurrency | Product copy |

Passing unit tests in one layer does not prove the other two agree. Each layer gets its own review gate (§18.9).

### 18.0 Decisions closed

The four open decisions are **closed**, following the owner's recommendations. They are now baseline requirements, not proposals.

| Decision | Resolution |
|---|---|
| Clock start | The commit of the server's round-issuance transaction (§4.6). `served_at` and `closes_at` are stored durably, retries and reconnects return the same deadline, and the lost-response recovery is §4.6.4 |
| Practice reference | The immutable final snapshot of the last completed Daily for that question. On the first day, or with no snapshot, a reviewed prior snapshot is used (§5.20) |
| Tier names | Direction approved: labels are copy only (§8.2 `TIER_LABELS`) and the ids are ordinal, so renaming is a copy change. The proposed set is Common, Uncommon, Rare, Deep Cut, Abyssal, Legendary. Two of those also appear in Krillion's list, so they are flagged for the owner |
| Answer sets | Closed, reviewed canonical sets for the MVP (§18.7) |

Still **open, and needing the owner**: the final tier labels (see the overlap note on `TIER_LABELS`). The lost-response policy is now **idempotent retrieval only** (§4.6.4). The earlier in-place re-issue proposal was withdrawn on review.

**Review verdict (recorded):** Tasks A–E are authorized. Task F onward waits for a database-correctness-contract review. Scoring config v1 stays unfrozen until the §7.11 gate passes. The architecture document must be proofread end to end and made internally consistent before Task F, so that the precedence rule above can be retired.

### 18.2 Priority table

| Pri | Gap | Resolution section |
|---|---|---|
| P0 | Rolling-cohort finalization ordering | 18.3 |
| P0 | Provisional versus final populations | 18.4 |
| P0 | Scoring and prior versioning, reproducibility | 18.6 |
| P0 | Deadline and finalization transaction semantics | 18.5 |
| P0 | Threshold calibration, no placeholder thresholds shipped | 18.8 |
| P1 | Cold-start and sparse-population fairness | 18.7, 18.8 |
| P1 | Answer validity and editorial quality | 18.7 |
| P1 | Abuse, privacy, operational recovery | 18.5, 18.10, 18.11 |

### 18.3 Rolling-cohort contract (P0)

**Counting convention (replaces the ambiguous "own answer included in C and N" wording in §16.2).**

- `C_prior`: valid answers matching canonical answer `a` from earlier eligible rounds, **excluding the current player**.
- `N_prior`: all valid answers from earlier eligible rounds, excluding the current player.
- For a valid answer: `p_final = (C_prior + 1 + α·p_prior) / (N_prior + 1 + α)`.
- For an unanswered or invalid response: 0 points, no canonical vote, and no change to the population.
- The SQL that computes `C_prior` and `N_prior` must filter out the current round, so the player is never counted twice. A test must catch a double count.

**Total order.** Rounds on one `challenge_question_id` are ordered by `(closes_at, question_round_id)`.

**Predecessor invariant.** A round may finalize only after **every** earlier round in that order is finalized, or has been explicitly resolved as having no eligible answer. A worker for a later round that runs first must wait or retry, never score against a population missing an earlier round.

**Serialization.** Use a per-`challenge_question_id` mechanism that every finalization path shares. Options are a transaction-level advisory lock or a dedicated cohort-state row, with a `cohort_sequence` watermark. Pick one in Task F and use it everywhere.

**Unfinished rounds.** Rounds that never submit are finalized as unanswered at `closes_at`. Abandoned sessions expire under an explicit policy (§18.5) so they never block the cohort.

### 18.4 Provisional versus final scoring (P0)

Two separate calculation paths with different membership rules:

| | Provisional | Final |
|---|---|---|
| Population | Currently accepted candidates for the question, including other players' still-open rounds | Predecessor-finalized rounds only, per §18.3 |
| Stored | Not authoritative, may be cached | Immutable `player_question_scores` row with provenance |
| Reuse | Never reused to produce a final score | Never derived from provisional aggregates |
| Display hysteresis | Allowed, based on previous displayed tier plus a deterministic rule (decided in Task C) | **Never** applies |

### 18.5 Transaction and deadline contract (P0)

One atomic contract for accept, revise, close and finalize:

1. **Accept or revise.** Lock the round row, read the DB clock, reject if `now() >= closes_at`, check the candidate version, then upsert the candidate and append to the submission history, all in one transaction.
2. **Idempotency.** A `request_id` is unique within a session. Reusing it with a **different payload returns a conflict**. Reusing it with the same payload returns the original result.
3. **Stale revisions.** A request carrying an outdated `candidate_version` is rejected, so it cannot overwrite a newer answer.
4. **Finalize.** In one transaction, persist the final answer, the score with provenance, and the completed state. A retry returns the existing result.
5. **Revision versus deadline race.** The row lock decides. Whichever transaction takes the lock first wins, and the other sees the committed state.
6. **Clock start.** The 60s clock starts **when the question is served** (recommended, owner decision), not on first interaction. This removes the incentive to delay.
7. **Transitions.** A short fixed window between questions. Players cannot pause indefinitely. A session that misses a window finalizes that question as unanswered.
8. **Lazy finalization is not the only path.** The API may trigger it, but the authoritative path is a durable, retryable job with a scheduled backstop, bounded retries, logging, and an alert for any round unfinalized past its deadline.

### 18.6 Immutable scoring provenance (P0)

Every `player_question_scores` row stores the exact inputs used:

- `challenge_question_id`, `question_version_id`
- `scoring_config_version`, `prior_version_id`
- `cohort_sequence` (the ordering watermark)
- `population_size` (`N_prior`), `matching_answer_count` (`C_prior`)
- `canonical_answer_id`
- `p_estimated` at sufficient precision
- `final_tier`, `points`, `finalized_at`

A config version alone is not enough, because prior data can change. The prior snapshot must be immutable once referenced.

**Test:** rerunning the calculation from stored inputs yields a byte-identical result.

### 18.7 Answer universe, priors and validity (P1)

- **Policy per question: closed or open answer set.** MVP uses **closed sets** wherever exhaustive validation is practical. Open sets are allowed only for questions with a well-defined, testable answer domain.
- **Residual mass is a statistical bucket, not an acceptance rule.** It must never make an arbitrary answer valid. If a question is closed, an answer outside the bank is rejected as invalid, not scored as "other".
- **Priors must sum to 1** across the modeled categories, including any residual. Validate at **publication time**, not during gameplay.
- **Ambiguity.** A question with unresolved ambiguity cannot be published.
- **Editorial rules** are required for qualifiers, synonyms, spelling variants and incorrect-but-plausible responses.

### 18.8 Rarity tiers and calibration (P0 and P1)

**Tiers.** Use **six purely statistical tiers.** "Too Clever" is dropped as a behavioral category. A "deceptively popular" mechanic may be added later as a documented, separate editorial tag, not embedded in the thresholds.

**Naming.** Do not ship Krillion-specific tier names, including "One in a Krillion". Create original names, descriptions and visual treatments for all six. Point values stay 10, 15, 30, 60, 85, 100. *(Owner decision: the names are still to be chosen. The names in §7.3 are placeholders.)*

**Thresholds.** The values in §7.3 are placeholders. Freeze config v1 only after Task C passes the acceptance table below.

| Evaluation | What to measure |
|---|---|
| Cold start | How heavily scores depend on priors when N is small |
| Popular answers | Common answers reliably get lower tiers |
| Rare answers | Genuinely uncommon answers can reach higher tiers |
| Prior misspecification | Sensitivity to inaccurate editorial estimates (deliberately wrong priors) |
| Tier stability | Frequency of provisional tier changes |
| Population growth | How scores change as the cohort grows |
| Distribution shift | Whether a new player population invalidates the priors |
| Repeatability | Identical inputs give identical final results |

**Caveats.**
- Simulation shows behavior under its assumptions only. Do not claim the thresholds are empirically validated until real player data exists.
- A calibration that works only when the prior is right is not robust.
- The 60s window may shift answer distributions relative to a 20s game, so priors drawn from other games may not transfer.
- Two distinct stability properties: **final-score determinism** (identical data and config always give the same result) and **provisional stability** (the displayed tier does not flicker). Hysteresis serves only the second.

### 18.9 Practice reference population (P0, Gap 3)

Rolling-cohort scoring gives every ranked player a different population, so "frozen ranked counts" is undefined for practice. Recommended (owner decision):

- Practice uses the **immutable final population snapshot of the most recently completed daily challenge** for the same question.
- **First day, or a question with no snapshot:** use a reviewed prior snapshot, never today's unfinished ranked cohort.
- Practice scores are stable all day and cannot affect ranked results.
- Practice results are labeled as practice and excluded from ranked leaderboards and priors.

### 18.10 Cohort manipulation, abuse and privacy

**Strategic timing.** Waiting could yield a larger population, and extra guest sessions could shape the cohort. Excluding guests from priors does not stop guests from affecting the live ranked cohort. Controls to build and document:

- Clock starts when the question is served (§18.5).
- One ranked session per guest identity, with duplicates excluded from the cohort.
- Rate limits by session and IP, tuned so shared networks and legitimate revisions are not blocked. IP addresses are not treated as unique people.
- Suspicious bursts may trigger rate limits, a CAPTCHA, or exclusion from ranked scoring.
- **Limitation, documented:** Sybil attacks cannot be fully prevented in a guest-first game. The goal is to raise the cost, detect abuse and state the remaining risk.
- Question leakage: shared answers can shift the live population. This is partly inherent. It affects how long a daily stays active and whether questions are reused.

**Three response contracts** (separate typed DTOs, never serialize internal DB objects):

| Contract | Contains | Forbidden |
|---|---|---|
| Active round | Provisional tier, provisional points, non-specific activity indicator | Counts, percentages, others' answers, scoring internals |
| Finalized round | Player's answer, final tier, points, the approved aggregate popularity statistic | Others' raw answers, counts used in scoring |
| Admin analytics | Counts, estimates, priors, cohort diagnostics | Access by non-admins |

This reconciles §16.5 ("no API response contains C, N or p_estimated") with the reveal screen showing aggregate popularity. §16.5 applies to the active-round contract only.

**Access control.** A private channel named `session:{id}` is not a security mechanism. Authorize server-side and through Supabase policies. Knowing a session ID must never grant access to another player's data.

**Retention.** Define how long raw submitted text is kept, and separate raw history from the minimal data needed to reproduce scores. Admin authorization is required to publish questions, edit priors and change scoring config. Guests use a recoverable session mechanism that does not expose reusable privileged tokens.

### 18.11 Product defaults still to confirm

| Decision | Recommended default |
|---|---|
| Daily reset | UTC, displayed to players |
| First-day practice baseline | Reviewed prior snapshot |
| Unanswered questions | 0 points, finalize normally |
| Question ambiguity | Block publication until resolved |
| Tied leaderboard scores | Shared rank; deterministic order only for presentation |
| Percentile display | Hidden until the sample is large enough to be meaningful |
| Challenge version changes | Never mutate an active challenge; publish a new version |
| Abandoned sessions | Expire under an explicit policy; never block the cohort |
| Scoring disputes | Keep enough versioned evidence to explain a score without exposing others' raw answers |

### 18.12 Additional concurrency tests (add to Tasks G and H)

For each, verify the eligible population, final score, persisted snapshot and leaderboard, not just that the request succeeded.

- A later-deadline finalization runs before an earlier one.
- Two rounds share the same `closes_at`.
- An earlier round has no valid answer.
- A transaction fails after computing a score but before commit.
- A retry races with a second finalization request.
- A revision races with the deadline.
- Realtime events arrive out of order.
- A session reconnects with an outdated candidate version.
- A reused `request_id` with a different payload returns a conflict.

### 18.13 Mandatory review gates

1. **Scoring design review**, before freezing config v1: formula, prior semantics, threshold calibration, provisional display behavior.
2. **Database correctness review**, before starting the UI: ordering, atomicity, idempotency, revision behavior.
3. **Release review:** clean database, multiple independent sessions, concurrency tests, security checks, acceptance criteria.

The implementer reports actual test commands and results, including failures. A claim that concurrency is safe is not accepted without tests that exercise the relevant races.

### 18.14 Research workflow

- K1–K12 stay unverified until someone records a dated observation.
- Record the game mode, date, question, action taken and observed result for each hands-on test.
- Separate facts verified from the website or FAQ from facts verified through play.
- Abyssal implementation must not depend on an unverified Krillion behavior.
- Krillion research informs understanding of the genre. It is not the authority for Abyssal's scoring semantics.

### 18.15 Updates to §16.4 task order

- **Task B:** use the §18.3 counting convention and add a double-count test.
- **Task C:** add the §18.8 acceptance table and the robustness checks. It ends at review gate 1.
- **Task F:** add the cohort serialization mechanism, the provenance columns (§18.6), the practice snapshot table (§18.9) and publication-time prior validation.
- **Tasks G and H:** add the §18.5 contract and the §18.12 tests. Task H ends at review gate 2.
- **Task J (UI):** build against the §18.10 response contracts.
- **Task M:** ends at review gate 3.

---

## 19. First playable build: status and deviations

Written after the first end-to-end build. It records what was built, what differs from §2 to §18, and what was verified. Where it conflicts with an earlier section, this section describes the code.

### 19.1 Deviations from the design

| Design | Build | Consequence |
|---|---|---|
| Postgres and Supabase (§2, §5) | Node's built-in SQLite (`node:sqlite`, Node 22.5 or newer), file at `.data/ascent.db` (was `abyssal.db` before §19.6) | Single server process only. `BEGIN IMMEDIATE` serializes writers and plays the role of the per-question cohort lock. Moving to Postgres means reimplementing `src/server/db.ts` and the SQL dialect, and has not been done or tested. |
| Supabase anonymous auth and RLS (§10, §11.4) | A server-issued random token in an httpOnly cookie, stored hashed | Same identity model, no RLS. Authorization is a check in every route. Clearing cookies creates a new identity (documented limit, no recovery code). |
| Supabase Realtime (§8) | Not built. With provisional scoring removed (§19.6) nothing is pushed or polled while a question is open | `event_version` and the private channel contract are unimplemented and now have nothing to carry. |
| Scheduled finalizer worker (§4.5) | Finalization runs lazily inside every request, plus `POST /api/internal/finalize` (needs `CRON_SECRET`) | A round nobody touches stays unfinalized until the next request or a sweep call. No monitoring or alerting. |
| Practice reads a frozen snapshot table (§5.20) | Practice reads the latest earlier day's `final_answers` on demand | A round finalizing after midnight can still change "yesterday". |
| Admin workflow, question editor, audit log (§10, Task L) | Not built | Questions live in `src/server/content/questions.ts`. |
| Abandon after 300 s (§4.6.6) | 2 hours (`GAME.abandonAfterMs`) | Abandonment only labels a session, so a long timeout costs nothing and a short one would cost a returning player their one daily attempt. Owner choice. |
| `CHECK` and trigger immutability (§5.20) | Not built. SQLite `CHECK` constraints exist for `closes_at BETWEEN served_at AND served_at + 60 s` (§19.6) and `depth_m = points * 10` | Final scores are not protected from direct database edits. |

### 19.2 Scoring configuration in use

Table A thresholds with alpha 50 (`src/server/config.ts`), the working candidate of §7.11.2. It is **not frozen and not validated beyond simulation**. Each stored score records the config version and alpha it used.

### 19.3 Question bank

23 original India-focused questions (version 2, §19.6) with closed answer sets and editorial priors (`src/server/content/questions.ts`). All were drafted by the build agent from general knowledge, are **unverified**, and need human review by someone who knows the subjects. Questions with no answer rarer than 2% are practice-only (`DAILY_POOL` versus `PRACTICE_POOL`), because a daily question that cannot pay a rare tier flattens the reward curve.

### 19.4 What was verified

- Unit and integration tests (run with `npm test`), including a real SQLite database, concurrent-style orderings, idempotency, deadline boundaries, finalization order, and a comparison of the SQL cohort counts against the domain function.
- Real HTTP against the running server: cookie issuance, access control (401 for no cookie, 404 for another player's session), the content-type check, idempotent round issuance, and (after §19.6) a full seven-question practice climb with `scripts/play-dive.mjs`: junk refused without locking, a misspelling corrected ("Bharatnatyam" read as Bharatanatyam), the final score returned by the locking request, a second answer refused, the four questions the script's guess list could not answer closing at 60 s with 0 points, and the active-round payload containing only `closesAt, question, questionIndex, roundId, servedAt, state`. That run scored 45 of 700, from three locked answers.

### 19.5 What was NOT verified

- **The browser UI.** No browser could be launched in the build environment, so the screens, the countdown, keyboard behaviour and accessibility have never been seen running. The Playwright tests are written but have never been run.
- Behaviour with more than one server process, and any real concurrent load. The 100-player and 1,000-submission simulations from §13 of the spec were not run against the HTTP stack.
- Multiple real browsers acting as different players at the same time.
- Anything visual after §19.6: the sky, the cloud and star layers, the cross-fade between spheres and the launch animation have been type-checked, linted and built, and the pages return 200, but **nobody has seen them render**. Their tuning (durations, how dark each layer is, rocket size and position) is a first guess.

### 19.6 Amendments from the feedback round (these override §4, §7.8, §8, §9, §11 where they conflict)

**Product decisions taken from the owner's five requests**

1. **The first answer the game can read locks the question.** The round ends at that instant. The same transaction scores it (§7.1 formula, unchanged) and returns the FINAL tier and points. Nothing is predicted, so the provisional path is deleted: no estimated tier, no "about N points", no activity indicator, no polling, no `GET .../provisional`, no `candidate`, no `expected_candidate_version`, no revisions (`maxAcceptedPerRound` is gone). An answer that cannot be read is refused and does **not** lock; the player may try again until the clock runs out, bounded by `maxAttemptsPerRound` and the per-minute request limit.
2. **Spelling auto-correction (normalization version 2).** Optimal-string-alignment distance (insert, delete, substitute, adjacent swap), counted on code points, against every canonical text and alias. Allowed edits depend on the shorter of the two lengths: under 4 characters none, 4 to 7 one, 8 to 11 two, 12 or more three. The nearest answer must be unique: a tie between two different answers is `AMBIGUOUS_TYPO` and is refused. Aliases of the SAME answer never create a tie. A corrected answer is the same vote as the correctly spelt one, is recorded `matched_via = typo_correction`, and the reveal says "We read your answer as". This **supersedes §6.2**, which allowed only one substitution or swap and at least 6 characters.
3. **No hints.** `example` is removed from the question, the DTO, the UI and the tests. A qualifier states scope only. A test fails the build if any prompt or qualifier contains an accepted answer.
4. **Ascent theme.** A climb starts on the surface of the Earth and goes up through Surface, Troposphere, Stratosphere, Mesosphere, Thermosphere, Exosphere and Space, one sphere per question (`src/lib/altitude.ts`). 1 point is 1 km (the old 10 m per point is kept only as the stored `depth_m`, which the score table's `CHECK` still enforces). Darkness is 60% from the sphere and 40% from the score, so the sky never lightens and a strong answer darkens it faster. `Sky.tsx` is pure CSS: cross-fading gradients, clouds that fall past, stars, an Earth that shrinks and turns from green to blue, and, when an answer locks, speed lines and a rocket whose duration and brightness scale with the points. Everything stops under `prefers-reduced-motion`.
5. **India-friendly questions.** The whole bank is India-focused (states, Union Territories, rivers, festivals, IPL, Hindi film, languages, food, cricket, hill stations, national parks, prime ministers, classical dance, instruments, freedom struggle, monuments, spices, Olympic sports, big cats, Mughal emperors, deities, breads, stadiums). Hindi and regional names are aliases.

**Consequences for the rolling cohort (this replaces the ordering in §16.2 and §18.3)**

- A round's `closes_at` is `served_at + 60 s` until an answer locks it, then it becomes the lock instant, and `answered_at` equals it (`CHECK (closes_at BETWEEN served_at AND served_at + 60000)`).
- **Cohort order is now commit order.** An answered round finalizes inside the transaction that accepts its answer, and `BEGIN IMMEDIATE` serializes writers, so `cohort_sequence` is the order in which answers were locked. Two answers cannot share an instant in any way that matters, because the second transaction sees the first one's `final_answers` row.
- The **predecessor invariant and `waiting_for_predecessor` are gone.** They existed because a player's score used to be frozen at a fixed deadline while earlier players were still typing. Now nobody waits: a player is scored against everyone who locked before them, and that set is complete the moment they lock.
- An **unanswered** round still closes lazily at `served_at + 60 s + grace`, casts no vote and changes nobody's score, so the moment it finalizes is irrelevant to correctness. It takes the next sequence number when it finalizes.
- Scoring and the §7.1 formula, the tiers and their thresholds, the popularity statistic, practice scoring and the leaderboard are **unchanged**.

**A consequence worth the owner's attention.** Because the answer locks instantly, a player who answers in the first second and one who answers in the 59th are treated the same, and speed is not rewarded. That is the request as written. The side effect is that the first few players of a day are scored mostly on the editorial prior (§7.4), exactly as before.

**Operational notes**

- The schema changed (`rounds.answered_at`; `candidates` is one locked row with `matched_via`; `display_tier`, `pending_*` and the revision counters are removed), so the default database file is now `.data/ascent.db`. The old `.data/abyssal.db` is left untouched and unread. There is no migration.
- The singleton in `runtime.ts` is keyed by `RUNTIME_VERSION`. A `globalThis` singleton survives hot reload, and a running dev server kept serving the old `Game` against the old database until this was added. Bump it whenever the schema or the lifecycle changes.
- `handle()` recognises a `GameError` by shape, not by `instanceof`, after Next.js was seen holding two copies of the module and turning a deliberate 409 or 429 into a 500.

### 19.7 Rename, tier labels and the order-sensitivity measurement

**Rename: Stratos.** The working name is now **Stratos**, tagline "Know the rare. Rise higher." Changed: page title and description, header, landing page, share text (`Stratos <date>` / `Stratos (practice)`), the guest-name word lists (sky words and birds instead of sea creatures), the cookie (`stratos_player`), the runtime key, `STRATOS_DB` (was `ABYSSAL_DB`) and the e2e test. **Not changed:** the repository folder and the npm package name (`abyssal`), because renaming them means regenerating the lockfile and moving the workspace, and the `abyss-950` Tailwind colour token. Existing guests lose their cookie on this release, which only matters for a dev database. The name has **not** been checked for trademark, domain or app-store availability.

**Tier labels (display copy only, `src/lib/tiers.ts`).** Familiar, Uncommon, Rare, Obscure, Exceptional, Singular, for tiers 1 to 6. They describe rarity and deliberately avoid the atmosphere layers, which describe altitude. No blurb claims an answer was literally unique ("Singular" reads "Close to the rarest answer anyone gave"), and the landing page and leaderboard say tiers are estimates. "Rare" is kept and still appears in Krillion's list; change it in one line if a fully original vocabulary is wanted. The numeric tier ids, the points and the thresholds are untouched.

**Order sensitivity, measured (`npm run order-effect`, `src/domain/scoring/calibration/order.ts`, seed 20261016, 7 questions).** One fixed set of answers per player is scored under two independent random arrival orders, and the two leaderboards are compared. Speed earns nothing, so any difference is the luck of arrival order. All players are identical here, so this isolates order from skill. Working config (table A, alpha 50). Ranges are across the answer-distribution families and populations of 50, 200 and 1,000:

| Measure | Range found | Reading |
|---|---|---|
| Mean change in a player's total (as a share of the mean total) | 1.1% to 7.3% | Modest per player. |
| Spearman rank correlation of the two leaderboards | 0.70 to 0.98 for Zipf and head-heavy answer sets; 0.03 to 0.23 for a flat 50-answer set | Mostly stable when answers are concentrated, close to noise when every answer is equally likely. |
| Top-decile players still in the top decile under the other order | 50% to 91% (lowest, 50%, at 200 players, Zipf s=0.8) | **The top of the board is the least stable part.** |
| Single answers given the same tier under both orders | 71% to 98% | A tier is a noisy label for any one answer. |
| Priors 2x too high, 2x too low, top two swapped (Zipf s=1) | Same band as correct priors | Wrong priors did not make order sensitivity worse in this simulation. |

The result is not monotone in population (200 players was worse than both 50 and 1,000 on rank correlation and top-decile overlap). It was not investigated, and the likely reason, tier boundaries being crossed during the day, is a guess.

**What this means for the owner.**
- Arrival order does change ranked results, enough that a top-10 finish on a day with a few hundred players has a large luck component. The leaderboard page now says players are scored against the players who locked before them.
- This is the rolling-cohort trade-off of §16.2, now measured. It is **not** fixed. Options if it is unacceptable, none implemented: score everyone against the final end-of-day population (a player then sees a score only after the day closes); grade on a coarser scale; or keep rolling scoring for the live reveal and rank the leaderboard on a recomputed end-of-day score. Each changes the product.
- A flat answer set (every answer about equally likely) gives rankings that are mostly order noise. Such questions should be practice-only, which the existing `DAILY_POOL` rule (smallest prior under 2%) already enforces for the shipped bank.
- Not measured: multiple guest identities from one person, question-timing exploits, and real answer distributions. All of the above is simulation on assumed shapes (§7.11, "Limits of this evidence").

**Still open for the owner:** scoring review gate 1 (§7.11.2); browser and visual QA (§19.5); an expert review of the India question bank, its aliases and priors; availability checks on the name.

### 19.8 Arcade redesign (frontend only)

A presentation-only change. **No** scoring, normalization, schema, API-shape or cohort-ordering change was made. The one behavioural change is that there is no pause between a result and the next question.

**Behaviour changed.** `GAME.revealWindowMs` is now `0` (it was 5 s). The "next question" control is a button with no countdown and is never disabled by a timer; the player moves on when ready. The next question's 60 s clock still starts when it is issued, so nothing is gained or lost by waiting on the result. `decideIssuance` and the `TOO_EARLY` refusal are unchanged (they now simply never fire in normal play), and issuing question N+1 while N is open is still refused (`PREVIOUS_NOT_FINALIZED`).

**Design system.**
- Tokens: Tailwind palette `stratos.*` (electric, cyan, violet, ultra, coral, orange, lime, navy, indigo) and CSS variables in `globals.css` for easing, durations and surfaces. Typography is a system rounded stack (`ui-rounded`, Arial Rounded, Nunito, Trebuchet) for display text, with the default sans for questions and inputs. **No web font is downloaded**, so it looks rounder on Apple devices than on Windows or Linux.
- Primitives: arcade buttons (`btn-primary` coral, `btn-lock` lime, secondary, ghost) with a pressed state, `card-arcade`, `chip`, `answer-input`.
- Components: `SkyScene` (replaces `Sky`), `Rocket` (SVG), `AtmosphereProgress`, `AltitudeCounter`, `CountdownTimer` (ring), `RarityBadge` (per-tier gradients from `TIER_COLORS`), `QuestionCard`, `RevealCard`, `ResultView`, plus the launchpad inside `Dive`. `AltitudeMeter`, `Ocean`, `DepthMeter` and `Sky` are deleted.
- Motion system: `src/lib/motion.ts` holds durations, curves, `countValue` (the count-up), `revealTimeline` and `prefersReducedMotion`. All animation is transform and opacity only, with no blur filter and no canvas.

**Keeping three ideas apart.** The layer follows the question number, altitude follows the accumulated points (1 point = 1 km), and the reveal intensity follows the points of the one answer (`revealLevel`: 10 to 15 small, 30 to 60 medium, 85 to 100 big).

**Reveal and server authority.** The reward sequence starts only after `submitAnswer` returns `accepted: true`, and every number on it (answer, tier, points) is the server's `result`. While the request is pending the card shows only "Locking…". The count-ups animate between server-confirmed totals; under reduced motion they snap to the confirmed value. A reload shows the last result without replaying any animation. The countdown reads the server deadline directly and is not held back by any animation.

**Reduced motion.** Clouds, stars, the rocket's idle bob and launch, flame flicker, shake and pulse are switched off; speed lines, sparks and the flash are removed; the rocket itself stays as a still image. Scores, tiers and the countdown are unaffected.

**Verified.** 349 unit and integration tests, `tsc --noEmit`, `next lint` and `next build` pass. A seven-question climb over real HTTP against the redesigned build locked answers, corrected "Maharastra" to Maharashtra, refused every second answer, and finished at 85 of 700 with the active-round payload still exposing only `closesAt, question, questionIndex, roundId, servedAt, state`. `npm run e2e` was attempted and **all 12 tests failed to launch** because Chromium cannot start in the sandbox (macOS Mach-port permission error); that is an environment failure, not a test result.

**Not verified.** Everything visual. No screenshot of any screen exists. In particular unchecked: how the sky, clouds, Earth and rocket actually look, the cross-fades between layers, the launch and reveal timing, the 360 px phone layout and keyboard behaviour, the contrast of white text over the brighter surface sky, hydration warnings in a real browser, and the e2e suite, which is written but has never executed. The sound-effects item from the brief was **not built** (no audio, so no sound controls). The lobby shows no streak, best climb or leaderboard preview, because the API exposes none of those and inventing them was ruled out. There is no settings screen. The design is the author's reading of a reference mockup that was not available as an asset.
