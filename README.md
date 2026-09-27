# MediAssist

MediAssist is a private, educational health-information companion with symptom guidance, medication and appointment tracking, mood and vital logs, report analysis, and Gemini-powered chat.

## Run locally

1. Open `mediassist-backend/.env` and set `GEMINI_API_KEY`.
2. Run `Start-MediAssist.cmd`, or run `npm start` from `mediassist-backend`.
3. Open http://localhost:3000.

The full application, source layout, privacy notes, and commands are documented in [mediassist-backend/README.md](mediassist-backend/README.md).

## Deploy on Render

This repository includes [render.yaml](render.yaml). Render's free web-service filesystem is temporary, so a hosted app must use external PostgreSQL for records that need to persist. A free Neon PostgreSQL project is a suitable option.

1. Create a private GitHub repository and push this folder. The included `.gitignore` excludes `.env`, local SQLite health data, backups, and dependencies.
2. Create a PostgreSQL database and copy its pooled `DATABASE_URL`.
3. In Render, choose **New → Blueprint**, connect the GitHub repository, and select this repository. Render detects `render.yaml`.
4. Set these secret environment variables in Render:
   - `GEMINI_API_KEY`: your Gemini key.
   - `DATABASE_URL`: the PostgreSQL connection URL.
   - `APP_PASSWORD`: a unique password with at least 16 characters.
   - Optionally set `APP_USERNAME`; it defaults to `owner`.
5. Deploy. Render supplies `RENDER_EXTERNAL_URL` automatically. The app checks `/healthz` during deployment.
6. Visit the Render URL and sign in with the owner username and password.

Never commit `.env`, a Gemini key, a database URL, or a health-record database. Do not choose the disposable-storage option for real records: Render's free web-service filesystem is erased when the service restarts or redeploys. Render's own free Postgres plan also expires after 30 days; use it only for short demonstrations.

## Repository layout

| Path | Purpose |
| --- | --- |
| `mediassist-backend/server.js` | Express server, security headers, local/hosted startup |
| `mediassist-backend/routes/` | Chat, tracker, and symptom API endpoints |
| `mediassist-backend/db/` | SQLite local storage and PostgreSQL hosted-storage adapter |
| `mediassist-backend/public/` | Browser interface |
| `mediassist-backend/tests/` | SQLite, PostgreSQL-compatible, hosted-security, and UI tests |
| `render.yaml` | Render Blueprint configuration |
| `.github/workflows/test.yml` | GitHub Actions verification |

## Verify before pushing

```powershell
cd mediassist-backend
npm ci
npm test
npm audit --omit=dev
```
