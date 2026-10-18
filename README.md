# LoanClear

Full-stack EMI calculator with an AI chat assistant, built with vanilla JS and a Node.js/Express backend.

**Live:** [loanclear-app.netlify.app](https://loanclear-app.netlify.app) (frontend) · [loanclear-backend-production.up.railway.app](https://loanclear-backend-production.up.railway.app) (backend API)

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

- All EMI/amortization/prepayment math is pure JS, duplicated intentionally between `backend/utils/emiCalculations.js` (used for system-prompt formatting) and the `<script>` block in `frontend/index.html` (used for all on-page calculations) since there's no bundler.
- Sessions and per-IP daily counts are stored in memory (`Map`s) — they reset on backend restart. For production scale, swap these for Redis or a database.
- The chat model is `openai/gpt-oss-20b` on Groq, called with `reasoning_effort: 'medium'`. (`llama-3.1-8b-instant`, named in the original spec, has since been retired from Groq's catalog.) It's a reasoning model — the SDK response includes a `reasoning` field alongside `content`; `server.js` only forwards `content` to the client. `reasoning_effort: 'low'` was tried first but ignored the language instruction (see below) roughly half the time; `'medium'` fixed that in testing but uses more tokens, hence `MAX_TOKENS_PER_REPLY=900`. If Groq retires this model too, swap it in the one `model:` line in `backend/server.js` and check `groq.models.list()` for current options.
- The chat tab has a "Reply in" selector (Hinglish / English / Hindi). The choice is sent as `language` in the `/api/chat` request body, validated server-side, and passed into `buildSystemPrompt(loanContext, language)` in `backend/systemPrompt.js`, which steers the model's reply language on every turn.
- The model never does loan math itself. `backend/loanTool.js` exposes a `calculate_loan_scenario` function tool (Groq/OpenAI tool-calling); the system prompt requires the model to call it for any EMI/interest/payoff number instead of estimating in its own reasoning, which was unreliable (wrong figures, or empty/truncated replies on harder multi-year prepayment math). `server.js` runs the tool loop: on `tool_calls`, it executes the real `simulateWithPrepayment` math from `backend/utils/emiCalculations.js` and feeds the exact result back before the model writes its final answer. `simulateWithPrepayment` also gained an `annualLumpSum` option (a recurring once-a-year extra payment, e.g. "₹3 lakh every year"), distinct from the one-time `lumpSum`.
