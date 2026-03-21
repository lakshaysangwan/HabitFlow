# HabitFlow — Deployment Guide

This guide walks you through deploying HabitFlow to Cloudflare Pages with D1 database from zero to live. Everything runs on Cloudflare's **free tier** — no credit card required for hobby use.

---

## Prerequisites

1. A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)
2. A GitHub account with this repo pushed to it
3. Node.js 20+ installed locally
4. Wrangler CLI:
   ```bash
   npm install -g wrangler
   wrangler login
   # Opens browser → click "Allow"
   ```

---

## Step 1 — Create D1 Databases

You need two databases: one for production, one for preview (staging) environments.

```bash
# Production
wrangler d1 create habitflow-db
```

Output will look like:
```
✅ Successfully created DB 'habitflow-db'
[[d1_databases]]
binding = "DB"
database_name = "habitflow-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   ← copy this
```

```bash
# Preview (staging)
wrangler d1 create habitflow-db-preview
```

**Update `wrangler.toml`** with both IDs:
```toml
[[d1_databases]]
binding = "DB"
database_name = "habitflow-db"
database_id = "YOUR_PROD_ID_HERE"    ← replace

[env.preview]
[[env.preview.d1_databases]]
binding = "DB"
database_name = "habitflow-db-preview"
database_id = "YOUR_PREVIEW_ID_HERE"  ← replace
```

---

## Step 2 — Apply Migrations

```bash
# Production
wrangler d1 migrations apply habitflow-db --remote

# Preview
wrangler d1 migrations apply habitflow-db-preview --remote --env preview
```

Verify:
```bash
wrangler d1 execute habitflow-db --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```

---

## Step 3 — Connect GitHub → Cloudflare Pages

1. Push your code to GitHub (ensure `.dev.vars` is NOT committed)
2. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
3. Authorize Cloudflare to access your GitHub → select the HabitFlow repo
4. Build settings:

   | Setting | Value |
   |---------|-------|
   | Framework preset | None |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory | `/` |

5. Click **Save and Deploy** (first deploy may fail because secrets aren't set yet — that's okay)

Your Pages project name determines your URL: `https://habitflow-xxx.pages.dev`

---

## Step 4 — Set Secrets (Environment Variables)

Go to **Pages** → your project → **Settings** → **Environment Variables**.

Add these as **encrypted** variables for both **Production** and **Preview** environments:

| Variable | Value | Notes |
|----------|-------|-------|
| `JWT_SECRET` | `<64-char random string>` | Generate: `openssl rand -base64 48` |
| `ALLOWED_ORIGIN` | `https://your-project.pages.dev` | Update after Step 3 |

> **Important:** `JWT_SECRET` must be at least 32 characters. Use `openssl rand -base64 48` to generate a strong one. Never put it in code or `wrangler.toml`.

After adding variables, click **Save and Deploy** to trigger a new build with the secrets applied.

---

## Step 5 — Update CORS Origin

After the first successful deploy, your URL is known (e.g. `https://habitflow-abc.pages.dev`):

1. Update `ALLOWED_ORIGIN` in Pages → Settings → Environment Variables to match exactly
2. If you add a custom domain later (e.g. `https://habitflow.app`), update `ALLOWED_ORIGIN` to that

Also update `wrangler.toml`:
```toml
[vars]
ALLOWED_ORIGIN = "https://habitflow-abc.pages.dev"   ← your actual URL
```

---

## Step 6 — Seed First Admin User

After deploy succeeds, create an invite code and register the first user.

**Create invite code:**
```bash
wrangler d1 execute habitflow-db --remote --command \
  "INSERT INTO invite_codes (id, code, max_uses, current_uses, created_by, created_at) \
   VALUES ('seed-admin-1', 'HABITFLOW-ADMIN-2026', 1, 0, NULL, datetime('now'))"
```

**Register via the app:**
- Visit `https://your-project.pages.dev`
- Enter your desired username and password (≥8 chars)
- Click "Need an invite code?" and enter `HABITFLOW-ADMIN-2026`

**Elevate to god mode:**
```bash
wrangler d1 execute habitflow-db --remote --command \
  "UPDATE users SET is_god=1 WHERE username='YOUR_USERNAME'"
```

**Verify:**
```bash
wrangler d1 execute habitflow-db --remote --command \
  "SELECT username, is_god FROM users"
```

---

## Step 7 — Verify the Deployment

```bash
# Smoke test auth
curl -s -X POST https://your-project.pages.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"YOUR_USERNAME","password":"YOUR_PASSWORD"}' | jq .

# Check security headers (target: A+ rating)
# Visit: https://securityheaders.com/?q=https://your-project.pages.dev

# IDOR test: sign in as two different users, try to access each others resources
# Task A from User A with User B's cookie should return 404
```

---

## Ongoing Maintenance

### Schema changes

After adding a new migration file:
```bash
# Apply to preview first, then production
wrangler d1 migrations apply habitflow-db-preview --remote --env preview
wrangler d1 migrations apply habitflow-db --remote
```

### Viewing logs

```bash
# Stream Pages Function logs
wrangler pages deployment tail --project-name habitflow
```

### Database queries

```bash
# Production
wrangler d1 execute habitflow-db --remote --command "SELECT COUNT(*) FROM users"

# Preview
wrangler d1 execute habitflow-db-preview --remote --command "SELECT COUNT(*) FROM users" --env preview
```

### Invite code management

Log in as god user and use the Admin panel, or via CLI:
```bash
wrangler d1 execute habitflow-db --remote --command \
  "INSERT INTO invite_codes (id, code, max_uses, current_uses, created_at) \
   VALUES (lower(hex(randomblob(16))), 'MYCODE-2026', 5, 0, datetime('now'))"
```

---

## Local Development

See the Local Development section in the plan, or:

```bash
# 1. Copy example vars
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your local JWT_SECRET

# 2. Apply migrations locally
npm run db:migrate:local

# 3. Seed local DB
wrangler d1 execute habitflow-db --local --command \
  "INSERT INTO invite_codes (id, code, max_uses, current_uses, created_at) \
   VALUES ('local-seed', 'DEV-INVITE-2026', 10, 0, datetime('now'))"

# 4. Run (two terminals)
npm run dev          # Terminal 1: Vite frontend on :5173
npm run worker:dev   # Terminal 2: Wrangler Pages on :8788
```

---

## Running Tests

```bash
npm test           # Run all tests once
npm run test:watch # Watch mode
```

Tests use an in-memory D1 instance (via Miniflare) — no cloud resources needed. GitHub Actions runs tests automatically on every push.

---

## Free Tier Limits (Cloudflare)

| Resource | Free Limit | HabitFlow Usage |
|----------|-----------|-----------------|
| Pages builds | 500/month | ~1 per push |
| Pages Functions requests | 100,000/day | ~500/day for personal use |
| D1 storage | 5 GB | <10 MB for personal use |
| D1 row reads | 5 million/day | ~10,000/day |
| D1 row writes | 100,000/day | ~1,000/day |
| Bandwidth | Unlimited | N/A |

You'd need thousands of daily active users before approaching any limit.
