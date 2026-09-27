# MediAssist

A local, single-user educational health assistant. Express serves the HTML/JavaScript interface and SQLite-backed API. Google Gemini handles AI replies and report interpretation.

## Start on Windows

1. Run `Start-MediAssist.cmd` in the parent folder, or run `npm start` here.
2. Open http://localhost:3000 (or the PORT configured in .env).
3. Keep the server running while using the app.

Node.js 22.13 or newer is required; Node 24 LTS is recommended. Dependencies are installed. For a fresh copy run `npm ci`.

## Enable AI

Edit `.env` in this folder locally and put your Gemini API key after `GEMINI_API_KEY=`. Obtain a key from https://aistudio.google.com/app/apikey. Never post it in chat or commit it. Restart the server after editing. `GEMINI_MODEL` defaults to `gemini-3.1-flash-lite`; model access and quota depend on your Google account. The page shows a setup notice when no key is present. Trackers remain usable without AI.

## Working features

- Separate, persistent conversations for all four modes. The most recent 200 messages per mode are displayed; the most recent 20 are used as AI context.
- Explicit medication, appointment, mood, vital and journal forms. Records appear after a successful server save.
- Medication checklist status can be toggled and records removed. This is a manual checklist, not a dose scheduler; it does not automatically reset or send reminders.
- Appointments store the selected local time as UTC and display it in your local timezone.
- Partial vital updates preserve the latest reading for each measurement. Hover over a value for its timestamp. These values may have been recorded at different times.
- PDF, PNG and JPG uploads up to 5 MB and TXT up to 100 KB send actual contents to Gemini. File type, size and basic signatures are validated. Parsing/interpretation depends on the provider.
- Uploaded bytes are used for the current request only, not persisted. Saved conversation history includes the filename and AI explanation. Reattach the report if a follow-up requires reviewing its original contents.
- The handwritten 30-condition dataset is illustrative, not clinically validated. Negated input bypasses keyword suggestions conservatively.

## Privacy and access

The server binds only to 127.0.0.1. Host/origin checks, a per-start session token, CSP, output escaping and sanitization protect browser access. There are no remote accounts or multiple-user support. Other programs/users with access to this Windows account may access the local app or its files. Do not expose this server through a public tunnel.

Records are stored unencrypted in `mediassist.db` on this computer. Back up the database while the server is stopped. AI messages, recent same-mode history and attachments are sent to Google Gemini when you press Send. Tracker records are not automatically sent to the AI. There is no automatic clinical record extraction from AI replies.

## Checks and maintenance

- `npm test`: isolated in-memory database and mocked Gemini requests; API and DOM integration regressions. No patient data or live API calls.
- `npm run seed`: creates tables and seeds only an empty reference table; preserves existing health data.
- `npm audit`: dependency vulnerability check.
- `work/original-backup/`: original core files retained before the update, including the old standalone HTML. This folder is not served.

If the port is occupied, change PORT in .env and restart. If Gemini reports quota/key/model problems, verify those settings in your Google account. Failed AI calls do not save incomplete conversation pairs. A save error is shown in the form; it never becomes a success notice.

## GitHub and Render deployment

The repository root contains `render.yaml`, a root `.gitignore`, and a GitHub Actions workflow. Push the root folder, rather than only this backend folder, so Render can find the Blueprint.

For a hosted Render service, the app uses PostgreSQL when `DATABASE_URL` is set and SQLite when it is not. Set these Render environment variables in the dashboard:

- `GEMINI_API_KEY`: required for chat and report analysis.
- `DATABASE_URL`: required for persistent records. Use a pooled PostgreSQL URL.
- `APP_PASSWORD`: required for hosted mode; use a unique value of at least 16 characters.
- `APP_USERNAME`: optional; defaults to `owner`.

Render injects `RENDER_EXTERNAL_URL`; no `APP_ORIGIN` is needed unless you attach a custom HTTPS domain. Hosted mode requires authentication before health records or chat are accessible. The public `/healthz` endpoint exists only for Render's deployment health check.

Render's free web-service filesystem is temporary, so SQLite records disappear when the service restarts or redeploys. The app fails closed in hosted mode unless a `DATABASE_URL` is present. `ALLOW_EPHEMERAL_STORAGE=true` exists only for disposable demonstrations and must never be used for real health records. Render's free Postgres instances expire after 30 days, so use an external PostgreSQL provider for any ongoing demo.

This remains an educational prototype, not a validated diagnostic or treatment system. Medical AI output and the reference dataset require professional interpretation.

Implementation references: https://ai.google.dev/api/generate-content and https://ai.google.dev/gemini-api/docs/generate-content/document-processing. Node SQLite: https://nodejs.org/api/sqlite.html.
