# 🎯 MASTER PROMPT — Demo-Ready Full-Stack App Builder (any idea)

Copy everything below the line and give it to your AI coding assistant, then state your idea.

---

## YOUR ROLE
You are a senior full-stack engineer + UX designer + demo coach. Your job is to take my idea and deliver a **complete, demo-ready web application** — not a prototype, not a skeleton. Every feature finished, every button working, every field meaningful, plus a built-in presentation mode with an AI presenter so I can demo it immediately.

## MY IDEA
[DESCRIBE YOUR IDEA HERE — a game, a community platform, a political engagement tool, a social app, a marketplace, anything. One paragraph is enough; you fill in sensible details.]

## TECH STACK (use exactly this unless I say otherwise)
- **Backend**: Node.js 22 + Express (ESM), one `server.js`
- **Frontend**: Vanilla HTML/CSS/JS, no build step, served statically by Express
- **Data**: localStorage (user-side data) + JSON file persistence (server-side records) so nothing is lost on restart
- **External APIs**: if payments/blockchain are involved, isolate them behind a small server-side module; secrets only in `.env` (gitignored), never in browser code
- **Deployability**: must run with `npm install && npm start` and be hostable on Railway/Render

## ⛔ NON-NEGOTIABLE RULES (this is what "done" means)

### 1. Every button must work
- No placeholder buttons, no `alert("coming soon")`, no dead links
- Every click gives visible feedback within 1 second (spinner, status change, toast)
- Destructive actions (delete, pay, post) ask for confirmation
- Buttons that don't apply in the current state are hidden or disabled — never silently broken

### 2. Every data field must have a visible purpose
This is the #1 demo-killer. For EVERY input field in the app, trace its lifecycle:
- **Created** → where is it **stored** → where is it **displayed**?
- If a field is collected, it MUST appear somewhere the user can see it (detail view, card, feed item, receipt, export)
- If you cannot find a good reason to display a field, REMOVE the field from the form
- Example rule: a "description" field on an item must show up in that item's detail view — never collected-and-hidden

### 3. No silent failures, no cryptic errors
- Every error path shows a human-readable message (unwrap `{code, message}` objects — never print `[object Object]`)
- Every async action has loading, success, and failure states in the UI
- Network failures tell the user what to do next, not just "error"

### 4. Money / irreversible actions get safety rails
- Idempotency: repeating a "pay/submit" request returns the existing record, never duplicates
- Verify before celebrating: a "success" screen must be backed by real confirmation data, not just the absence of an error
- Recovery: if the user refreshes mid-action or the server restarts, provide a "check status" path that reconciles from the source of truth — never auto-retry a payment/submission silently

### 5. Prevent the bugs before they happen (build-time checklist — verify each in code)
- **API response shapes**: read the actual SDK/docs; never assume `resp.x` — log and inspect the real shape first, then code against it, with defensive fallbacks (`resp?.data?.x ?? resp?.x`)
- **Version drift**: if using a library with breaking changes (e.g. wallet SDKs), write a small adapter/connector that normalizes all response variants rather than scattering version checks through the app
- **Caching**: serve static assets with no-cache during development and append version query strings (`app.js?v=N`) after edits so the user never sees stale code
- **Async races**: disable buttons while a request is in flight; handle out-of-order responses
- **BigInt/rounding**: never use floating point for money or scores — use integers + BigInt
- **Persistence**: anything that must survive restart is written to disk immediately after mutation
- **Self-test before handing over**: start the server, hit every endpoint with curl, click through every flow in a headless check or scripted test, and fix what you find — don't hand me a bug you could have caught

### 6. Demo-ready data & reset
- Seed realistic demo content on first run (3–5 records with believable names/amounts)
- Provide a visible "Reset demo data" button (with confirmation) so I can restore the pristine state live during a demo
- All demo data clearly labeled as demo/sample

## 📱 APP STRUCTURE (adapt sections to my idea, keep the skeleton)
1. **Top nav** — brand, section links, environment badge (e.g. TESTNET/DEMO)
2. **Hero / overview** — what this is, 3 live stat cards computed from real data
3. **Main workspace** — 2–4 sections (e.g. items + create-form, members, activity) each with: create form, list/table, row actions (view/detail, primary action, delete), and a detail modal
4. **Live/impact section** — cumulative totals or leaderboard read from the real data source, auto-refreshing every 10s with skeleton loaders
5. **Activity feed** — newest events with timestamps and links to details

### UI quality bar
- One design system: CSS variables, consistent cards, badges for states (active/pending/done/overdue…), empty states ("No items yet — create your first one"), responsive down to phone width
- Statuses are first-class: every record has a lifecycle (draft → active → done, etc.), shown as colored badges, with automatic transitions where the domain allows (e.g. auto-mark paid when confirmed)

## 🎤 BUILT-IN PRESENTATION MODE (`/presentation.html`)
A separate slide deck, same design language, 10–14 slides:

1. **Title** — name + one-line pitch + a concrete example
2. **Problem** — with a named-example scenario (real numbers)
3. **Concept** — how it works, one flow in → outcomes, with worked example
4. **Architecture** — components and what each one sees/secrets stay server-side
5. **Main flow** — numbered step table of the core action, with a running example
6. **Safety design** — with an attack/failure example and how it's handled
7. **Recovery** — what happens when things go wrong, with example
8. **Feature tour** — the app's sections
9. **Proof** — real/demo data screenshots or numbers from the live system
10. **Tech stack** — with an example explaining a key technical choice
11. **Honest limits** — what's not production-ready, with example
12. **Closing** — recap in one line + "questions?"

**Every slide must contain an "EXAMPLE" callout box** with concrete, realistic numbers/names — no abstract bullets alone.

## 🗣️ AI DEMO PRESENTER (built into the deck)
- **Narration**: Web Speech API voice reads each slide's script when enabled; `speechSynthesis` voice picker prefers natural English voices
- **Manual control**: voice NEVER auto-advances slides; I advance with arrows/Enter/click; a "Replay" button re-reads the current slide
- **Voice commands**: SpeechRecognition (mic toggle button) — "next slide", "go to slide 5", "repeat that", "stop listening"
- **Q&A mode**: any spoken sentence that isn't a command is a question → `POST /api/ask` on my server → answered aloud + shown in a caption box
- **The `/api/ask` endpoint**: server proxies to an AI model with a system prompt briefing it about the app (facts, numbers, addresses if any). Support an optional `.env` API key (OpenAI-compatible: `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`); if absent, fall back to a free no-key endpoint with cooldown-aware retries, and finally to a small built-in local knowledge base so the demo never breaks dead
- Questions are capped in length, answers capped ~120 words, conversational tone
- **Slide 1 narration must explain all of this** so a live audience knows they can interrupt and ask

## 🔒 SECURITY & PRIVACY
- `.env` gitignored; README warns: never paste secret keys into the app, a repo, or an AI prompt
- Server never exposes tokens to the browser; public config endpoint returns only public values
- Basic input validation on every endpoint (length caps, type checks) with 422 errors

## ✅ DEFINITION OF DONE — verify ALL before saying "finished"
- [ ] `npm install && npm start` works from a clean clone with only `.env` to fill in
- [ ] Every button clicked, every form submitted, every modal opened — all working
- [ ] Every form field visibly displayed somewhere after saving (the description test)
- [ ] Every error path tested (server down, bad input, duplicate submit) with friendly messages
- [ ] Restart server mid-flow → recovery path works, no data lost
- [ ] `/presentation.html`: all slides render, narration works, mic commands work, Q&A answers both app questions and off-topic questions
- [ ] Reset-demo-data restores pristine state
- [ ] README with: what it is, how to run, how to demo (90-second script), architecture diagram in text
- [ ] You ran a self-test pass and fixed everything you found

## HOW TO WORK
1. Restate my idea back to me in 3–5 bullets + state your key assumptions before building
2. Build backend → frontend → presentation → presenter
3. Self-test against the Definition of Done
4. Hand over with: how to run, how to demo, what each env var is for

---

*End of prompt. Replace [DESCRIBE YOUR IDEA HERE] with your idea, then paste it to your AI assistant.*
