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

Open `http://localhost:5500`. The frontend talks to the backend at the URL set in `BACKEND_URL` near the top of `index.html`'s `<script>` block — defaults to `http://localhost:3001`, matching the backend's `ALLOWED_ORIGIN=http://localhost:5500` default.

## Deployment

**Backend (Railway):**
1. Push the `backend/` folder to a GitHub repo.
2. Create a new Railway project from that repo.
3. Add all variables from `.env.example` in the Railway dashboard (set your real `GROQ_API_KEY`, and `ALLOWED_ORIGIN` to your deployed frontend URL).

**Frontend (Netlify):**
1. Before deploying, update in `frontend/index.html`:
   - `BACKEND_URL` constant → your Railway backend URL.
   - The CSP `<meta>` tag's `connect-src` → the same backend URL.
2. Drag-and-drop the `frontend/` folder onto Netlify, or connect the repo.

After deploying both, update the backend's `ALLOWED_ORIGIN` env var to the live Netlify URL and redeploy the backend so CORS allows it.

## Notes

- EMI/amortization math lives in `backend/utils/emiCalculations.js` and is mirrored in `frontend/index.html`'s `<script>` block (no bundler, so it's duplicated on purpose).
- Sessions and per-IP rate limits are stored in memory — they reset on backend restart. Swap for Redis/a database for real production scale.
- The chat tab supports Hinglish/English/Hindi replies and always grounds its numeric answers in the real calculation engine rather than estimating them.
