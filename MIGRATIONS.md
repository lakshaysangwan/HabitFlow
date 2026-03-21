# Database Migrations

## Apply migrations to local (development)

Run this command to apply all pending migrations to your local D1 database:

```sh
npx wrangler d1 migrations apply habitflow-db --local
```

To verify migrations applied correctly:

```sh
npx wrangler d1 execute habitflow-db --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

---

## Apply migrations to production

> ⚠️ This affects the live database. Double-check before running.

```sh
npx wrangler d1 migrations apply habitflow-db
```

---

## Apply migrations to preview environment

```sh
npx wrangler d1 migrations apply habitflow-db-preview --env preview
```

---

## Migration history

| File | Description |
|------|-------------|
| `0000_init.sql` | Initial schema: users, invite_codes, tasks, completions, audit_log, rate_limits |
| `0001_indexes.sql` | Performance indexes |
| `0002_v4_timers.sql` | v4.0: `tracking_mode` + `timer_target_seconds` on tasks, `duration_seconds` on completions, `active_timers` table |

---

## Check which migrations have already been applied

```sh
npx wrangler d1 migrations list habitflow-db --local
```
