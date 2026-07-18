# Deploying CheckedBy

The app is a single Node process with zero native dependencies. Anything that runs Node >= 22.5 can host it.

## Option A0 — Vercel (used for the live demo)

`api/index.js` + `vercel.json` wrap the Express app as a serverless function. Push the repo to GitHub and import it in Vercel — no configuration needed. Note: on Vercel the SQLite database lives in `/tmp`, which is per-instance and ephemeral — demo data reseeds on cold starts. For durable data use Option A/B with a persistent disk, or swap in Turso/libSQL.

## Option A — Render (one click, free tier)

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, point at the repo. `render.yaml` configures everything (free plan, `SESSION_SECRET` auto-generated, Node 22).
3. Done. Note: free-tier instances sleep after inactivity and have an ephemeral disk — the database reseeds demo data if wiped. For persistence, attach a disk and set `DATA_DIR` to its mount path.

## Option B — Any Docker host (Fly.io, Railway, VPS)

```bash
docker build -t checkedby .
docker run -p 3000:3000 -e SESSION_SECRET=$(openssl rand -hex 32) -v checkedby-data:/app/data checkedby
```

## Option C — Bare Node

```bash
npm install --omit=dev
SESSION_SECRET=$(openssl rand -hex 32) PORT=3000 npm start
```

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | Listen port |
| `SESSION_SECRET` | dev value | **Set in production** — signs session cookies |
| `DATA_DIR` | `./data` | Where `checkedby.db` lives; point at a persistent volume |
| `BASE_URL` | derived from request | Absolute URL used in badge embed snippets |

## Post-deploy check

```bash
BASE=https://your-url npm run smoke   # runs the 15-test end-to-end suite against the live site
```
