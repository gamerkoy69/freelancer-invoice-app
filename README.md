# FreelanceFlow — Invoices with XLM payments via Paiflow

A freelancer invoice manager where **clients pay invoices in testnet XLM** through a
[Paiflow](https://beta.app.paiflow.xyz) `Receive → Split` deployment. Every payment is
split automatically:

- **90% → the freelancer**
- **10% → a community fund**

It mirrors the official *Paiflow Guide* end-to-end: build and test the flow in Paiflow
(Part 1), then connect this app through the `@paiflow/sdk` with Freighter signing,
original-transaction verification and recovery (Part 2).

> Testnet only. Never use mainnet funds or real customer data for this exercise.

---

## How the pieces map

| Paiflow Guide | This app |
|---|---|
| Shop | Freelancer (`FREELANCER_ADDRESS`) |
| Community fund | Community fund (`COMMUNITY_ADDRESS`) |
| Customer | Client paying the invoice (their Freighter wallet) |
| Hosted page payment | Optional manual test (Part 1, step 5) |
| SDK prepare / sign / submit | `POST /api/checkout/prepare` → Freighter → `POST /api/checkout/submit` |
| Receipt + event verification | `GET /api/checkout/status/:invoiceId` |
| Interrupted payment recovery | **Check payment** button on each invoice |

## Files

```
freelancer-invoice-app/
├── index.html                  # App screens + payment modal
├── app.js                      # Invoice logic + XLM payment module (browser)
├── style.css
├── server.js                   # Node 22 server: Paiflow SDK, verify, recover
├── package.json                # ESM ("type": "module"), Node >=22.22.2 <23
├── .env.example                # Copy to .env and fill in
├── .env                        # Your real values (git-ignored)
├── vendor/freighter-api.min.js # Freighter bridge for the browser (no build step)
└── README.md                   # This tutorial
```

---

# Part 1 — Build and test your payment flow (in Paiflow)

## 1. Prepare your testnet wallets

1. Install the **Freighter** browser extension. Complete setup and select **Stellar Testnet**.
2. Create three dedicated testnet accounts and label them:

| Wallet role | What it does | Fees / signing |
|---|---|---|
| **Deployer** | Signs the flow deployment (can be the Freelancer account) | Pays deployment fees |
| **Client** | Pays each invoice (e.g. 1 XLM test payment) | Pays the payment + transaction fee |
| **Freelancer** | Receives 90% (0.9 XLM per 1 XLM) | No payout signature needed |
| **Community fund** | Receives 10% (0.1 XLM per 1 XLM) | No payout signature needed |

3. Fund each account with Friendbot in Freighter. Keep enough XLM for fees/reserves
   plus the test payments. Copy each public `G...` address into your labelled notes.

Keep secrets in Freighter. **Never** paste a secret key into Paiflow, this app, a repo
or an AI prompt.

## 2. Sign in to Paiflow

1. Open Paiflow → **Continue with Google** (the account you want to own the flow).
2. On first signup, enter the access code from your organiser and choose a username.
3. Confirm you are signed in before continuing.

## 3. Build a Receive → Split flow

1. Create a flow with **On Receive** as trigger and **Split** as action; connect them.
2. Select **native XLM** as the asset; remove unrelated blocks/placeholder recipients.
3. Add two percentage recipients using your real funded addresses — **shares must total 100%**:

| Recipient | Percentage | Share of 1 XLM |
|---|---|---|
| Freelancer | 90% | 0.9 XLM |
| Community fund | 10% | 0.1 XLM |

## 4. Review and deploy

1. Read the English deployment preview; confirm it describes receiving XLM and paying
   your two recipients at the intended percentages.
2. Connect the funded deployer wallet (Freighter on **Testnet**), review the operations
   and fee in Freighter, confirm.
3. Wait for **CONFIRMED**, open the deployment page and copy the **deployment UUID**
   (not the flow ID, not the `C...` contract address).

## 5. Prove it with a hosted-page payment (recommended first)

1. Open `https://beta.app.paiflow.xyz/trigger/YOUR_DEPLOYMENT_UUID`.
2. Connect the **Client** wallet, enter **1 XLM**, review and approve in Freighter.
3. Verify the payout evidence: **0.9 XLM → freelancer, 0.1 XLM → community fund**
   (check the transaction hash on Stellar Expert Testnet — a slow live feed is not
   proof of failure).

**Checkpoint:** confirmed deployment UUID + a verified hosted-page payment hash.

---

# Part 2 — Connect this app with the SDK

## 6. Create your developer token

1. In Paiflow, sign in as the deployment owner → **Developer API**.
2. **Create developer token** → permission **Read and operate** (Read only cannot
   prepare or submit payments). Select your confirmed deployment.
3. Copy the one-time token (starts with `pfd_`) **before** leaving the page.
4. Keep it server-side only: no browser code, no `NEXT_PUBLIC_` variables, no
   screenshots. If exposed, revoke and reissue.

## 7. Install and configure

Requires **Node ≥22.22.2 <23** (check with `node --version`).

```bash
cd freelancer-invoice-app
npm install
```

Copy the example environment file and fill it in:

```bash
cp .env.example .env   # on Windows: copy .env.example .env
```

```ini
PAIFLOW_BASE_URL=https://beta.app.paiflow.xyz
PAIFLOW_DEPLOYMENT_ID=your_confirmed_deployment_uuid
PAIFLOW_API_TOKEN=pfd_your_real_token
FREELANCER_ADDRESS=G..._freelancer_wallet
COMMUNITY_ADDRESS=G..._community_fund_wallet
PORT=3000
```

`.env` is git-ignored. **Never** send the token to the browser. Restart the server
after any change to `.env`.

## 8–10. Run, connect, pay

```bash
npm start
```

On boot the server (guide step 08):
- discovers the deployment through `client.deployments.pages(...)` and verifies your
  configured UUID is visible with this token,
- checks `capabilities.network === "testnet"` and that `execute` is exposed,
- then serves the app at **http://localhost:3000**.

### Pay an invoice

1. In the app, create a client and an invoice with line items. (For this exercise the
   invoice total is treated as the XLM amount — a 1.00 invoice = 1 XLM payment.)
2. On the invoice row click **Pay with XLM**.
3. Freighter opens: unlock it and approve the `http://localhost:3000` origin. Confirm
   the connected wallet is the intended **Client** wallet.
4. Review the payment screen: **TESTNET** badge, amount, 90/10 recipients, fee note —
   then **Approve & prepare payment**.
   - The server calls `deployment.execute.prepare({ from, amount })` and saves the
     original preparation (a repeated prepare for the same invoice returns the same
     one — never a new payment).
5. Confirm the transaction in Freighter (it signs the **original XDR** with the
   testnet passphrase).
6. The server verifies the signed body hash matches the saved original (fee-bump
   wrappers and changed bodies are rejected), then submits with `wait: false`.
7. The app polls `GET /api/checkout/status/:invoiceId`, which reads the receipt and
   events for the **original hash** and checks both payouts (90%/10% in stroops).
8. Only after verified `SUCCESS` is the invoice marked **paid**. A `200 OK` or
   `PENDING` alone never marks it paid.

**Checkpoint:** one SDK-driven payment with independently verified 0.9/0.1 payouts.

## 11. Recover an interrupted payment

Every invoice with payment activity gets a **Check payment** button. It re-queries the
*original* transaction (server-side) and follows the guide's recovery table:

| Observed | App behaviour |
|---|---|
| SUCCESS + matching payouts | Marks invoice paid; never re-sends |
| PENDING / UNKNOWN / errors | Keeps the original record; check the original hash again |
| Confirmed FAILED | Keeps the failed receipt; fix cause before a deliberate retry |
| Expired preparation / NOT_FOUND | Retains the record; asks you to contact support — no silent replacement |
| Missing/delayed events | Stays pending verification; no new payment is created |

A browser reload during signing loses nothing: the server holds the order,
preparation, envelope and hash. Never treat a reload (or an error) as permission to
pay again.

## 12–13. Customise and troubleshoot

- **Amounts** are integer stroop strings server-side (`1 XLM = "10000000"`), converted
  with `bigint` — no floating point. Graph shares are basis points: 90% = 9000, 10% = 1000.
- **USDC**: build a *separate* Receive USDC → Split deployment (add a USDC trustline,
  issuer `GBBD47IF6LWK7P7MDEVFL4NAT4AQH3ZLLFLA5`, to every wallet first), add it to the
  token's deployment selection, update `.env`, restart. Do not switch assets on the XLM deployment.
- **Troubleshooting quick list**:

| Symptom | Check |
|---|---|
| `Invalid API token` on boot | Token must be `pfd_` + 64 hex chars (or `pfk_...`) |
| `Deployment connection failed` | Deployment UUID, token not expired/revoked, deployment explicitly selected on the token |
| 403 on prepare/submit | Token permission must be **Read and operate** |
| Freighter not responding | Unlocked, app origin approved, correct account selected, Testnet |
| Insufficient funds / missing account | Fund client + recipients via Friendbot |
| 429 rate limit | Respect `Retry-After` |
| PENDING / timeout / reload | Use **Check payment** — never create a new preparation |

When asking for help, share the deployment UUID, transaction hash, safe error
message and request ID — **never** the token, secrets or signed envelopes.

## 14. Result checklist

- [ ] Confirmed XLM Receive → Split deployment with your two recipient addresses
- [ ] Hosted-page payment with matching 90/10 payouts (Part 1)
- [ ] SDK-driven app payment with independently verified payouts (Part 2)
- [ ] Developer token: **Read and operate**, deployment explicitly selected
- [ ] Deployment UUID, network, order records and hashes retained server-side
- [ ] Token server-only; signing wallet-only; no customer secret keys anywhere
- [ ] Clear success/pending/failure UI + **Check payment** recovery path

---

## Production notes (beyond this walkthrough)

The order store is in-memory and resets on restart — replace it with a durable
database. Add authentication/ownership checks on the checkout routes, rate limiting,
request validation, and a real receipt verifier tuned to your deployment's event
schema. The examples deliberately keep these minimal.
