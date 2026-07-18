# CheckedBy

**AI does the work. Real humans make it trustworthy.**

CheckedBy is a peer-to-peer marketplace where businesses post AI-generated work (marketing copy, reports, code, legal drafts, translations) and vetted human experts review it, correct it, and publicly sign off on it — earning money per review. Every completed review issues a public, tamper-evident **Certificate of Human Verification** with an embeddable badge.

Built July 2026 as a complete, research-validated SaaS product. See [`docs/VALIDATION.md`](docs/VALIDATION.md) for the market evidence and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for technical design.

## Why this, why now (the 30-second pitch)

1. **Generation is cheap; trust is the bottleneck.** Businesses are publicly fighting "AI slop," and unverified AI output costs deals and reputations.
2. **Regulation arrived August 2, 2026.** EU AI Act Article 50 requires published AI-generated text on matters of public interest to be disclosed as AI-made — *unless it underwent human review with someone taking editorial responsibility*. CheckedBy certificates record exactly that review.
3. **Research says disclosure alone backfires.** Peer-reviewed studies show labeling content "AI-generated" *erodes* trust; demonstrated human oversight restores it. So businesses don't need a disclosure tool — they need provable human verification.
4. **The open market supplies the reviewers.** Record numbers of skilled professionals entered independent work after the 2025–26 layoff wave. On CheckedBy every account can both buy and sell reviews — consumer and producer are interchangeable, Uber-style.

## Business model

Free to post, free to browse. Reviewers keep **85%** of each bounty; the platform takes **15%** on completed jobs only. No subscriptions, no seats.

## Quick start

Requires Node.js >= 22.5 (uses the built-in `node:sqlite` — zero native dependencies).

```bash
npm install
npm start          # http://localhost:3000  (seeds demo data on first boot)
npm run smoke      # end-to-end tests against a running server
```

Demo login: `elena@demo.checkedby.app` / `demo1234` (all seeded accounts use `demo1234`). New accounts receive $100 in simulated credits — **no real payments are processed in this deployment.**

## Deploy

One-click on Render via `render.yaml`, or any Docker host via the included `Dockerfile`. See [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Core flows

| Role | Flow |
|---|---|
| Business | Post work → bounty held in escrow → accept the review → certificate issued |
| Expert | Browse marketplace → claim a job → complete the category checklist → sign off under your own name → get paid 85% on acceptance |
| Anyone | `/verify` — confirm a certificate code; each certificate stores the SHA-256 fingerprint of the exact content reviewed |

## Repository layout

```
src/app.js        Express app: routes, sessions, marketplace logic
src/db.js         node:sqlite schema, queries, checklists, crypto helpers
src/seed.js       Demo data seeded on first boot
views/            EJS templates (landing, marketplace, review flow, certificates)
public/style.css  Design system
scripts/smoke.js  15 end-to-end HTTP tests
docs/             Validation research, architecture, deploy guide
```

MIT licensed.
