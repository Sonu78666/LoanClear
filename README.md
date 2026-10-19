# LoanNiti

Full-stack EMI calculator with an AI chat assistant, built with vanilla JS and a Node.js/Express backend.

**Live:** [loanniti-app.netlify.app](https://loanniti-app.netlify.app) (frontend) · [loanniti-backend-production.up.railway.app](https://loanniti-backend-production.up.railway.app) (backend API)

## Structure

```
backend/     Express API — /api/chat (Groq-powered) and /health
frontend/    index.html — single-file frontend (EMI calculator, early closure planner, AI chat)
```

## Running locally

### Backend

```bash
cd backend
npm install
cp .env.example .env
# edit .env and set GROQ_API_KEY (free key from console.groq.com)
npm start
```

The server listens on `http://localhost:3001` by default (`/health` should return `{"status":"ok", ...}`).

### Frontend

Serve `frontend/index.html` with any static server, e.g.:

```bash
npx serve frontend -l 5500
```

Open `http://localhost:5500`. `BACKEND_URL` in `index.html` auto-detects `localhost`/`127.0.0.1` and points at `http://localhost:3001` automatically — no manual editing needed for local dev.

**Test everything locally before deploying** — every deploy to the frontend host counts against its (often limited) free-tier deploy quota, so don't burn it on iteration. Run the local backend + `npx serve frontend` loop above, confirm the change works, *then* deploy once.

## Deployment

**Backend (Railway):** push `backend/` to a GitHub repo, create a Railway project from it, and add the variables from `.env.example` — set your real `GROQ_API_KEY`, and `ALLOWED_ORIGIN` to a comma-separated list of every frontend origin that should be allowed (e.g. `https://yourdomain.netlify.app,http://localhost:5500`). CORS reflects whichever of those origins actually made the request and rejects anything else with a 403 — no redeploy needed just to add `localhost` to the list later.

**Frontend (Netlify or similar):** `BACKEND_URL` and the CSP `connect-src` only need editing in `index.html` if your production backend URL changes — otherwise they're already pointed at the live Railway URL. Drag-and-drop the `frontend/` folder onto your host, or connect the repo.

## Notes

- EMI/amortization math lives in `backend/utils/emiCalculations.js` and is mirrored in `frontend/index.html`'s `<script>` block (no bundler, so it's duplicated on purpose).
- Sessions and per-IP rate limits are stored in memory — they reset on backend restart. Swap for Redis/a database for real production scale.
- The chat tab supports Hinglish/English/Hindi replies and always grounds its numeric answers in the real calculation engine rather than estimating them.
