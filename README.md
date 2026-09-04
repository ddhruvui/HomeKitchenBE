# Home Kitchen — backend

Weekly meal planning and shopping for a household. The spec is [../PLANNING.md](../PLANNING.md); the clickable design is linked from its §13. This repo is the backend only — the web app lives in `../HomeKitchenFE`, the phone app in `../HomeKitchenMobile`.

```
shared/   types, unit conversion, list generation, the Today view — pure TypeScript, no I/O
api/      Express app on Mongo Atlas, deployable to Vercel as one function
```

## Run

```bash
npm install
npm test            # shared unit tests, then API tests against the HomeKitchenTest database
npm run dev         # API on http://localhost:3000
```

The API reads `api/.env` (copy from `api/.env.example`). `USE_TEST_DB` defaults to **true**, which means `HomeKitchenTest`; set it to `false` to point at the production database named by `DB_NAME`.

A daily Vercel cron calls `GET /api/cron/cleanup`, which deletes planned days more than three weeks old; `CRON_SECRET` (when set) has to arrive as `Authorization: Bearer $CRON_SECRET`. To run it by hand:

```bash
curl http://localhost:3000/api/cron/cleanup
```
