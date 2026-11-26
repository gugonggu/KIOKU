# AGENTS.md — KIOKU Working Agreement

## Project mission

KIOKU is a Korean-first Japan travel planner / travel journal for real small-group use and a Wishket portfolio. This repository must remain a **simple, maintainable, secure mobile-first Next.js + Supabase app**, not a startup-scale platform.

## Source of truth

The current product scope is [docs/PRODUCT_SCOPE.md](docs/PRODUCT_SCOPE.md). Its 2026-11-26 decision supersedes older planning guidance on expense features.

At the start of a session, read the repository README, recent Git history, current worktree changes, and the affected code. When the private planning notes are available locally, read them in this order:
1. `docs/01_PRODUCT_BASELINE_v1.0.md`
2. `docs/02_ARCHITECTURE_DATA_SECURITY_v1.0.md`
3. `docs/03_ROUTES_AND_SCREEN_CONTRACT_v1.0.md`
4. `docs/04_IMPLEMENTATION_ROADMAP_AND_QA_v1.0.md`
5. `docs/05_DECISION_LOG_AND_OPEN_ITEMS_v1.0.md`
6. `reference/` older screen notes only for examples. New v1.0 documents win if conflicting.

Fresh clones use the tracked README, migration notes and code for implementation context. Ask the project owner for the relevant requirement if a task depends on private planning notes that are unavailable.

## Team boundaries

- User is project owner and approves major changes, deployments, outside account connections and any costs.
- ChatGPT designs and audits product requirements. Codex and Claude Code implement and test against the same GitHub repository on each PC. Each installation uses its own authentication and conversation history.
- **Do not autonomously expand scope.** Only implement the current requested milestone.
- No remote push, PR creation/merge, deployment, or destructive operation without explicit authorization.

## Architectural rules

- Next.js App Router, TypeScript, Tailwind, shadcn/ui as a practical baseline; Supabase Auth/PostgreSQL RLS; one repo and no unnecessary backend services.
- Trip ownership and token-share access are distinct authorization paths. Never grant `anon` broad SELECT on private trip data. A share DTO must be a server-side whitelist of fields.
- Never put reservation references/PNR, traveler names, passport data, payments, private notes, tokens or private storage paths in public APIs, demo fixtures, image metadata, logs or screenshots.
- Japan trip local dates use `Asia/Tokyo`; flight segment departures and arrivals retain each airport's local timezone and may be unknown.
- Itinerary FIXED/PERIOD/UNSCHEDULED are independent from booking confirmation status; dates may be unset.
- External map/photo services may fail; fallback to manual place entry, text address and default cover. API keys must remain server-only.
- Location permission must be explicit; never persist GPS travel history on the server.
- Offline snapshot (P1) is opt-in, read-only, privacy-filtered and cannot be remotely revoked once saved.

## Engineering & QA

- Use latest stable compatible dependencies and consult official docs before choosing versions; report the pinned versions in the resulting code.
- Add or update tests for each behavior. Prefer deterministic tests and clean error handling over speculative refactors.
- Never describe an unexecuted command/test as passed. Provide command/output or a clear blocker.
- Migrations need reversible/forward-repair notes and RLS checks; secrets belong in `.env.local`, never committed.
- Responsive and accessible: mobile safe-area, 44px touch target, keyboard behavior, loading/empty/error states.
- Before completing a task, produce: changed-file summary, run instructions, tests actually run, known blockers and next-step recommendation.
- Record completed work, actual verification and remaining work in the existing development notes. Keep cross-PC handoff details in the tracked README or relevant tracked documentation and use Git history to resume work.
- Keep environment variable names and roles consistent through `.env.example`. Keep actual values out of AI reports and commits. Use the documented vault workflow for the local configuration and leave cloud sync to the project owner.

## Current assignment

Follow the current user request and implement only its authorized scope.
