# Architecture

## Design goals

1. **Deploy anywhere, instantly.** Node.js only, zero native modules (uses Node 22's built-in `node:sqlite`), no build step, one process. Runs on any free-tier host or the included Dockerfile.
2. **Trust primitives first.** The certificate — content hash, named reviewer, checklist evidence, timestamps — is the core product object; everything else is marketplace plumbing around it.
3. **Small, auditable surface.** ~600 lines of application code; every route readable in one sitting.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js >= 22.5 | Built-in SQLite removes the classic native-dependency deploy failure |
| Web | Express 5 + EJS (server-rendered) | SEO-friendly marketing + app pages, no client build pipeline |
| Data | SQLite (WAL) via `node:sqlite` | Single-file DB; `DATA_DIR` env var points at a persistent disk in production |
| Sessions | HMAC-signed cookie (`scrypt` password hashing, `timingSafeEqual` comparisons) | No session store needed; stateless verification |
| Styling | Hand-rolled design system, single CSS file | Self-contained, no CDN dependency |

## Data model

```
users         identity + wallet (balance_cents) + reviewer reputation (reviews_done, rating_sum/count)
jobs          the unit of work: content_text + sha256 content_hash, category, bounty_cents,
              status: open → claimed → submitted → completed
reviews       checklist_json (per-category checks with pass/note), comments, edited_content,
              verdict: verified | verified_with_edits | rejected, requester rating
certificates  public code (CB-XXXX-XXXX) → job + review; issued only for non-rejected verdicts
transactions  append-only ledger: signup_credit, escrow (negative), payout, refund
```

## Marketplace mechanics

- **Escrow:** posting a job debits the requester's wallet immediately; the ledger records it. Funds release only on explicit acceptance.
- **Fee:** reviewer receives 85% of bounty; 15% platform fee is the entire business model (no subscriptions).
- **Checklist gate:** a `verified` / `verified_with_edits` verdict is *rejected by the server* unless every category checklist item is checked — the certificate can never show unchecked boxes behind a verified verdict.
- **Conflict rule:** you cannot claim your own job.
- **Interchangeability:** there are no "business accounts" vs "reviewer accounts" — one identity, one wallet, both sides.

## Trust & integrity

- **Content fingerprint:** SHA-256 of the exact submitted content is stored at post time and printed on the certificate. Any later edit to the deliverable is detectable by rehashing.
- **Certificate codes:** 8 chars from a 31-character unambiguous alphabet via `crypto.randomBytes` (~5×10^11 space) — unguessable at demo scale.
- **Public verification:** `/verify` + `/cert/:code` + `/badge/:code.svg` need no login, so third parties (clients, publishers, regulators) can check claims.
- **Article 50 alignment:** the certificate records human review with a named person exercising editorial control — the exemption condition in EU AI Act Art. 50(4).

## Known simplifications (deliberate for MVP)

- Payments are simulated credits (Stripe Connect is the obvious production path; the `transactions` ledger is already shaped for it).
- No CSRF tokens (SameSite=Lax cookies mitigate; add tokens before real money).
- Claim expiry / dispute flow / reviewer vetting (ID + credential checks) are roadmap items; the schema supports them without migration drama.
- SQLite on a free tier without a persistent disk resets on redeploy — acceptable for a demo, solved with a $1 persistent disk or Turso/libSQL in production.
