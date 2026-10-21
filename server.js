/* ============================================================
   FreelanceFlow payment server (Paiflow guide steps 06–11)

   Responsibilities:
     - Serve the static invoice app
     - Keep the developer API token server-side (never in the browser)
     - Discover + bind the configured Paiflow deployment (step 08)
     - POST /api/checkout/prepare  (step 09) — idempotent preparation
     - POST /api/checkout/submit   (step 10) — verified submission
     - GET  /api/checkout/status/:invoiceId (step 11) — recovery/check

   The order store is in-memory for this walkthrough. Replace with a
   durable database before any real use (see README).
   ============================================================ */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Paiflow } from '@paiflow/sdk';
import { TransactionBuilder, FeeBumpTransaction } from '@stellar/stellar-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PAIFLOW_BASE_URL = process.env.PAIFLOW_BASE_URL;
const PAIFLOW_API_TOKEN = process.env.PAIFLOW_API_TOKEN;
const PAIFLOW_DEPLOYMENT_ID = process.env.PAIFLOW_DEPLOYMENT_ID;
const FREELANCER_ADDRESS = process.env.FREELANCER_ADDRESS || '';
const COMMUNITY_ADDRESS = process.env.COMMUNITY_ADDRESS || '';
const PORT = Number(process.env.PORT || 3000);

if (!PAIFLOW_BASE_URL || !PAIFLOW_API_TOKEN || !PAIFLOW_DEPLOYMENT_ID) {
  console.error('Missing PAIFLOW_BASE_URL / PAIFLOW_API_TOKEN / PAIFLOW_DEPLOYMENT_ID in .env');
  process.exit(1);
}

// Stellar testnet only — never run this walkthrough against mainnet.
const NETWORK = 'testnet';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const STROOPS_PER_XLM = 10000000n;
const FREELANCER_BPS = 9000n; // 90%
const COMMUNITY_BPS = 1000n;  // 10%
const PREPARATION_TTL_SEC = 180;

// ---------- Amount helpers (integer stroop strings, never floats) ----------
function xlmToStroops(xlm) {
  const str = String(xlm).trim();
  if (!/^\d+(\.\d{1,7})?$/.test(str)) throw new Error('Invalid XLM amount');
  const [whole, fracRaw = ''] = str.split('.');
  const frac = (fracRaw + '0000000').slice(0, 7);
  return (BigInt(whole) * STROOPS_PER_XLM + BigInt(frac || '0')).toString();
}

function stroopsToXlm(stroops) {
  const s = BigInt(stroops);
  const whole = s / STROOPS_PER_XLM;
  const frac = (s % STROOPS_PER_XLM).toString().padStart(7, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

// A preparation lasts ~180s; report how much life the saved one has left.
function preparationTtlRemaining(order) {
  if (!order.preparedAt) return 0;
  return Math.max(0, PREPARATION_TTL_SEC - Math.floor((Date.now() - order.preparedAt) / 1000));
}

// ---------- Paiflow client + deployment binding (guide step 08) ----------
const client = new Paiflow({ baseUrl: PAIFLOW_BASE_URL, token: PAIFLOW_API_TOKEN });
let deployment = null;
let deploymentCapabilities = null;

async function connectDeployment() {
  // Discovery only confirms the token can see the deployment; it does not
  // grant access. The deployment id stays fixed in trusted configuration.
  let visible = false;
  for await (const page of client.deployments.pages({ limit: 20 }, { maxPages: 100 })) {
    if (page.data.items.some((item) => item.id === PAIFLOW_DEPLOYMENT_ID)) {
      visible = true;
      break;
    }
  }
  if (!visible) throw new Error('Configured deployment not visible — check deployment UUID and token grants');

  deployment = client.deployment(PAIFLOW_DEPLOYMENT_ID);
  const { data: capabilities } = await deployment.capabilities.get();
  if (capabilities.network !== NETWORK) throw new Error('This integration requires testnet');
  if (!capabilities.operations?.execute) throw new Error('Deployment does not expose execute');
  deploymentCapabilities = capabilities;
  return capabilities;
}

// ---------- Order store (replace with a real database in production) ----------
// Keyed by invoice id. Holds the original preparation so a repeated request
// returns the SAME preparation instead of creating a new payment, and the
// original signed envelope/hash for recovery (guide steps 09–11).
const orders = new Map();

// Durable stand-in for a real database (README production note): orders are
// persisted to orders.json on every mutation and reloaded at boot, so a
// server restart never loses in-flight payment records.
const ORDERS_FILE = path.join(__dirname, 'orders.json');
function loadOrders() {
  try {
    const raw = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
    for (const o of raw) orders.set(o.invoiceId, o);
    if (orders.size) console.log(`Restored ${orders.size} payment record(s) from ${ORDERS_FILE}`);
  } catch { /* no file yet — fresh start */ }
}
function persistOrders() {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify([...orders.values()], null, 2));
  } catch (err) {
    console.error('Could not persist orders:', err.message);
  }
}

function getOrder(invoiceId) {
  return orders.get(String(invoiceId));
}

function publicReview(order) {
  return {
    network: NETWORK,
    deploymentId: PAIFLOW_DEPLOYMENT_ID,
    customerAddress: order.customerAddress,
    freelancerAddress: FREELANCER_ADDRESS,
    communityAddress: COMMUNITY_ADDRESS,
    amountXlm: stroopsToXlm(order.amountStroops),
    amountStroops: order.amountStroops,
    freelancerXlm: stroopsToXlm(expectedPayouts(order.amountStroops).freelancer),
    communityXlm: stroopsToXlm(expectedPayouts(order.amountStroops).community),
    preparationTtlRemaining: preparationTtlRemaining(order)
  };
}

// ---------- Envelope verification (guide step 09, assertOriginalEnvelope) ----------
function envelopeBodyHash(xdr, passphrase) {
  const parsed = TransactionBuilder.fromXDR(xdr, passphrase);
  if (parsed instanceof FeeBumpTransaction) {
    throw new Error('Fee-bump envelopes are not accepted');
  }
  return parsed.hash().toString('hex');
}

function assertOriginalEnvelope(signedXdr, originalXdr, passphrase) {
  const originalHash = envelopeBodyHash(originalXdr, passphrase);
  const signedHash = envelopeBodyHash(signedXdr, passphrase);
  if (signedHash !== originalHash) {
    throw new Error('Signed transaction body differs from the original preparation');
  }
  // Added signatures are allowed — only the body must match.
}

// ---------- Payout expectations and verification (guide step 10) ----------
function expectedPayouts(amountStroops) {
  const total = BigInt(amountStroops);
  const freelancer = (total * FREELANCER_BPS) / 10000n;
  return { freelancer: freelancer.toString(), community: (total - freelancer).toString() };
}

// Events schema is deployment-specific. This deployment emits:
//   RECEIVE: { kind:"RECEIVE", data:{ from, asset:"XLM", amount:<stroops> } }
//   PAYOUT:  { kind:"PAYOUT",  data:{ from, recipients:[{ address, bps, amount }] } }
// The PAYOUT per-recipient `amount` is currently unpopulated ("0"), so the
// share is verified by recipient address + basis points, and the total by
// the RECEIVE amount. If a schema carries real amounts, they are checked too.
function findPayout(events, address, expectedStroops, expectedBps) {
  if (!address) return false;
  const expected = BigInt(expectedStroops);
  for (const ev of events) {
    const recipients = ev?.data?.recipients;
    if (Array.isArray(recipients)) {
      const hit = recipients.find((r) => r && r.address === address);
      if (!hit) continue;
      if (BigInt(hit.bps) !== BigInt(expectedBps)) continue;
      const hasAmount = hit.amount != null && hit.amount !== '';
      if (!hasAmount) return true; // schema omits amounts; bps + RECEIVE anchor it
      const amt = BigInt(String(hit.amount));
      if (amt === 0n) return true;
      const diff = amt > expected ? amt - expected : expected - amt;
      if (diff <= 1n) return true;
      continue;
    }
    // Fallback: any event blob that mentions the address and an integer
    // amount equal to the expected payout (±1 stroop).
    const blob = JSON.stringify(ev);
    if (!blob.includes(address)) continue;
    const values = [];
    const walk = (node) => {
      if (node == null) return;
      if (typeof node === 'number' || typeof node === 'string') {
        if (/^\d+$/.test(String(node))) values.push(BigInt(String(node)));
        return;
      }
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node === 'object') Object.values(node).forEach(walk);
    };
    walk(ev);
    if (values.some((v) => v >= expected - 1n && v <= expected + 1n)) return true;
  }
  return false;
}

// Total deposited, per the RECEIVE event (stroops). Null if not found.
function findReceiveAmount(events) {
  for (const ev of events) {
    if (ev?.kind === 'RECEIVE' && ev?.data?.amount != null) {
      try { return BigInt(String(ev.data.amount)); } catch { /* keep looking */ }
    }
  }
  return null;
}

function withinOneStroop(a, b) {
  const x = BigInt(a), y = BigInt(b);
  const d = x > y ? x - y : y - x;
  return d <= 1n;
}

// Full payout evidence for a successful tx: deposit matches the invoice and
// both configured recipients appear in the PAYOUT with the expected shares.
function verifyPayoutEvidence(events, amountStroops) {
  const payouts = expectedPayouts(amountStroops);
  const deposit = findReceiveAmount(events);
  const depositMatches = deposit !== null && withinOneStroop(deposit, amountStroops);
  return {
    depositMatches,
    verified: depositMatches
      && findPayout(events, FREELANCER_ADDRESS, payouts.freelancer, FREELANCER_BPS)
      && findPayout(events, COMMUNITY_ADDRESS, payouts.community, COMMUNITY_BPS),
    payouts
  };
}

function extractTxHash(submitted, signedXdr) {
  const data = submitted?.data ?? submitted ?? {};
  const hash = data.hash ?? data.txHash ?? data.transactionHash;
  if (hash) return hash;
  return envelopeBodyHash(signedXdr, NETWORK_PASSPHRASE);
}

function safeError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

// ---------- Express app ----------
const app = express();
app.use(express.json({ limit: '2mb' }));
// No-cache so browsers always pick up edited JS/HTML during development.
app.use(express.static(__dirname, { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') })); // serves index.html, app.js, style.css, vendor/

// Public, token-free config for the payment review UI (step 09, item 3).
app.get('/api/config', (req, res) => {
  res.json({
    network: NETWORK,
    deploymentId: PAIFLOW_DEPLOYMENT_ID,
    freelancerAddress: FREELANCER_ADDRESS,
    communityAddress: COMMUNITY_ADDRESS,
    freelancerShare: 0.9,
    communityShare: 0.1
  });
});

// ---- Step 09: prepare (idempotent per invoice) ----
app.post('/api/checkout/prepare', async (req, res) => {
  try {
    const { invoiceId, amountXlm, customerAddress } = req.body ?? {};
    if (!invoiceId || !amountXlm || !customerAddress) {
      return safeError(res, 422, 'VALIDATION', 'invoiceId, amountXlm and customerAddress are required');
    }
    if (typeof customerAddress !== 'string' || !customerAddress.startsWith('G')) {
      return safeError(res, 422, 'VALIDATION', 'customerAddress must be a public G... address');
    }

    let order = getOrder(invoiceId);

    // Bind the invoice to its first-supplied amount and wallet; reject drift.
    if (order) {
      if (order.amountXlmSource !== String(amountXlm) || order.customerAddress !== customerAddress) {
        return safeError(res, 409, 'ORDER_CONFLICT', 'Invoice already bound to a different amount or wallet');
      }
      // Idempotency: a repeated prepare returns the ORIGINAL preparation (step 09, item 1).
      if (order.prepared) {
        if (preparationTtlRemaining(order) <= 0) {
          // Expired preparations are retained for recovery — never silently replaced.
          return safeError(res, 409, 'PREPARATION_EXPIRED', 'Preparation expired; contact support to recover the original payment');
        }
        return res.json({
          unsignedXdr: order.prepared.data.xdr,
          networkPassphrase: order.prepared.data.networkPassphrase ?? NETWORK_PASSPHRASE,
          review: publicReview(order),
          reused: true
        });
      }
    }

    const amountStroops = xlmToStroops(amountXlm);
    if (BigInt(amountStroops) <= 0n) return safeError(res, 422, 'VALIDATION', 'Amount must be positive');

    const prepared = await deployment.execute.prepare({
      from: customerAddress,
      amount: amountStroops
    });
    // SDK shape: ApiResponse<{ network, expiresAt, xdr, networkPassphrase }>.
    // Fail loudly if the envelope is missing — never serve "undefined" XDR.
    if (!prepared?.data?.xdr) {
      throw new Error('Paiflow prepare returned no XDR envelope');
    }

    if (!order) {
      order = {
        invoiceId: String(invoiceId),
        amountXlmSource: String(amountXlm),
        amountStroops,
        customerAddress,
        deploymentId: PAIFLOW_DEPLOYMENT_ID,
        network: NETWORK,
        prepared: null,
        preparedAt: 0,
        signedXdr: null,
        txHash: null,
        submittedAt: 0
      };
      orders.set(order.invoiceId, order);
      persistOrders();
    }

    // Save the ORIGINAL preparation before asking the wallet to sign.
    order.prepared = prepared;
    order.preparedAt = Date.now();
    persistOrders();

    res.json({
      unsignedXdr: prepared.data.xdr,
      networkPassphrase: prepared.data.networkPassphrase ?? NETWORK_PASSPHRASE,
      review: publicReview(order),
      reused: false
    });
  } catch (err) {
    console.error('prepare failed:', err.message);
    return safeError(res, 502, 'PREPARE_FAILED', err.message);
  }
});

// ---- Step 10: submit (verify original envelope, never replace a submission) ----
app.post('/api/checkout/submit', async (req, res) => {
  try {
    const { invoiceId, signedXdr } = req.body ?? {};
    if (!invoiceId || !signedXdr) return safeError(res, 422, 'VALIDATION', 'invoiceId and signedXdr are required');

    const order = getOrder(invoiceId);
    if (!order) return safeError(res, 404, 'ORDER_NOT_FOUND', 'No preparation for this invoice');
    if (!order.prepared) return safeError(res, 409, 'NOT_PREPARED', 'Invoice has no saved preparation');
    if (order.deploymentId !== PAIFLOW_DEPLOYMENT_ID || order.network !== NETWORK) {
      return safeError(res, 409, 'DEPLOYMENT_MISMATCH', 'Order is bound to another deployment/network');
    }

    // Reject a changed body or fee-bump wrapper before any SDK submission.
    try {
      assertOriginalEnvelope(signedXdr, order.prepared.data.xdr, NETWORK_PASSPHRASE);
    } catch (verifyErr) {
      return safeError(res, 422, 'ENVELOPE_MISMATCH', verifyErr.message);
    }

    // For the same order, never replace an already saved submission.
    if (order.signedXdr && order.txHash) {
      return res.json({ txHash: order.txHash, reused: true });
    }

    // Persist the original signed envelope + hash before sending (step 10).
    order.signedXdr = signedXdr;
    order.txHash = envelopeBodyHash(signedXdr, NETWORK_PASSPHRASE);

    let submitted;
    try {
      submitted = await deployment.execute.submit(
        { signedXdr: order.signedXdr },
        {
          wait: false,
          preparationRequestId: order.prepared.metadata?.historyRequestId
        }
      );
    } catch (submitErr) {
      // An error does not prove nothing was broadcast — keep the record.
      console.error('submit error (original hash retained):', submitErr.message);
      return safeError(res, 502, 'SUBMIT_UNCERTAIN', `Submission error; check original hash ${order.txHash}`);
    }

    const txHash = extractTxHash(submitted, order.signedXdr);
    order.txHash = txHash;
    order.submittedAt = Date.now();
    persistOrders();
    res.json({ txHash, reused: false });
  } catch (err) {
    console.error('submit failed:', err.message);
    return safeError(res, 502, 'SUBMIT_FAILED', err.message);
  }
});

// ---- Step 11: check / recover ----
app.get('/api/checkout/status/:invoiceId', async (req, res) => {
  try {
    const order = getOrder(req.params.invoiceId);
    if (!order) return safeError(res, 404, 'ORDER_NOT_FOUND', 'No payment record for this invoice');

    if (!order.prepared) return res.json({ state: 'created', review: publicReview(order) });
    if (!order.signedXdr) {
      return res.json({
        state: preparationTtlRemaining(order) > 0 ? 'prepared' : 'preparation_expired',
        review: publicReview(order)
      });
    }

    // Query the ORIGINAL hash explicitly — HTTP 200 / PENDING is not finality.
    let receipt, events = [];
    try {
      const receiptResp = await deployment.transactions.get(order.txHash);
      receipt = receiptResp.data ?? receiptResp;
    } catch (e) {
      return res.json({ state: 'unknown', txHash: order.txHash, detail: e.message });
    }
    try {
      const eventsResp = await deployment.events.list({ txHash: order.txHash, limit: 100 });
      const data = eventsResp.data ?? eventsResp;
      events = data?.items ?? data ?? [];
    } catch (e) {
      // Missing/delayed events do not authorise another payment.
    }

    const status = receipt?.status ?? 'UNKNOWN';
    const evidence = verifyPayoutEvidence(events, order.amountStroops);
    const verified = status === 'SUCCESS' && evidence.verified;

    res.json({
      state: 'submitted',
      txHash: order.txHash,
      status,
      verified,
      expectedPayouts: {
        freelancerXlm: stroopsToXlm(evidence.payouts.freelancer),
        communityXlm: stroopsToXlm(evidence.payouts.community)
      },
      eventsSeen: events.length,
      receipt
    });
  } catch (err) {
    console.error('status failed:', err.message);
    return safeError(res, 502, 'STATUS_FAILED', err.message);
  }
});

// ---- Live impact: cumulative payouts per recipient, straight from the ledger ----
// Horizon sums every native credit to each recipient, so totals include ALL
// payments through the deployment (app, hosted page, manual tests).
const HORIZON_TESTNET = 'https://horizon-testnet.stellar.org';
let impactCache = { at: 0, payload: null };
const MILESTONE_XLM = 50n * STROOPS_PER_XLM; // progress bar target steps

async function sumNativeCredits(address, maxPages = 5) {
  let url = `${HORIZON_TESTNET}/accounts/${address}/effects?order=desc&limit=200`;
  let stroops = 0n;
  for (let page = 0; page < maxPages && url; page++) {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) break;
    const data = await resp.json();
    for (const eff of data._embedded?.records ?? []) {
      if (eff.type === 'account_credited' && (eff.asset_type === 'native' || !eff.asset_type)) {
        stroops += BigInt(Math.round(parseFloat(eff.amount) * 1e7));
      }
    }
    url = null;
    const next = data?._links?.next?.href;
    const records = data?._embedded?.records ?? [];
    if (next && records.length === 200) url = next;
  }
  return stroops.toString();
}

app.get('/api/impact', async (req, res) => {
  try {
    if (impactCache.payload && Date.now() - impactCache.at < 10_000) {
      return res.json(impactCache.payload);
    }
    const [freelancer, community] = await Promise.all([
      sumNativeCredits(FREELANCER_ADDRESS),
      sumNativeCredits(COMMUNITY_ADDRESS)
    ]);
    const f = BigInt(freelancer), c = BigInt(community);
    const milestone = (v) => {
      const target = ((v / MILESTONE_XLM) + 1n) * MILESTONE_XLM;
      const prev = target - MILESTONE_XLM;
      const pct = Number(((v - prev) * 100n) / MILESTONE_XLM);
      return { xlm: stroopsToXlm(target), pct };
    };
    impactCache = {
      at: Date.now(),
      payload: {
        freelancer: { address: FREELANCER_ADDRESS, totalXlm: stroopsToXlm(f), share: 0.9, milestone: milestone(f) },
        community: { address: COMMUNITY_ADDRESS, totalXlm: stroopsToXlm(c), share: 0.1, milestone: milestone(c) },
        combinedXlm: stroopsToXlm(f + c),
        updatedAt: new Date().toISOString()
      }
    };
    res.json(impactCache.payload);
  } catch (err) {
    return safeError(res, 502, 'IMPACT_FAILED', err.message);
  }
});

// ---- Activity feed: payments recorded by this app ----
app.get('/api/activity', (req, res) => {
  const items = [...orders.values()]
    .filter(o => o.txHash || o.prepared)
    .map(o => ({
      invoiceId: o.invoiceId,
      amountXlm: stroopsToXlm(o.amountStroops),
      customerAddress: o.customerAddress,
      txHash: o.txHash,
      state: o.txHash ? 'submitted' : 'prepared',
      at: new Date(o.submittedAt || o.preparedAt || Date.now()).toISOString(),
      payouts: expectedPayouts(o.amountStroops)
        ? { freelancerXlm: stroopsToXlm(expectedPayouts(o.amountStroops).freelancer), communityXlm: stroopsToXlm(expectedPayouts(o.amountStroops).community) }
        : null
    }))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 20);
  res.json({ items, updatedAt: new Date().toISOString() });
});

// ---- Recovery without a live order: verify by original tx hash alone ----
// The browser keeps the original hash in localStorage; if the server's
// in-memory order is gone (restart), "Check payment" falls back to this.
app.post('/api/checkout/verify-tx', async (req, res) => {
  try {
    const { txHash, amountXlm } = req.body ?? {};
    if (!txHash || !amountXlm) return safeError(res, 422, 'VALIDATION', 'txHash and amountXlm are required');
    const amountStroops = xlmToStroops(amountXlm);

    let receipt;
    try {
      const receiptResp = await deployment.transactions.get(String(txHash));
      receipt = receiptResp.data ?? receiptResp;
    } catch (e) {
      return res.json({ state: 'unknown', txHash, detail: e.message });
    }
    let events = [];
    try {
      const eventsResp = await deployment.events.list({ txHash: String(txHash), limit: 100 });
      const data = eventsResp.data ?? eventsResp;
      events = data?.items ?? data ?? [];
    } catch { /* missing events never authorise another payment */ }

    const status = receipt?.status ?? 'UNKNOWN';
    const evidence = verifyPayoutEvidence(events, amountStroops);
    const verified = status === 'SUCCESS' && evidence.verified;

    res.json({
      state: 'submitted',
      txHash,
      status,
      verified,
      expectedPayouts: {
        freelancerXlm: stroopsToXlm(evidence.payouts.freelancer),
        communityXlm: stroopsToXlm(evidence.payouts.community)
      },
      eventsSeen: events.length
    });
  } catch (err) {
    console.error('verify-tx failed:', err.message);
    return safeError(res, 502, 'VERIFY_FAILED', err.message);
  }
});

// ---- TEMPORARY debug aids (remove before any real deployment) ----
app.get('/api/debug/orders', (req, res) => {
  res.json([...orders.values()].map(o => ({
    invoiceId: o.invoiceId,
    amountStroops: o.amountStroops,
    customerAddress: o.customerAddress,
    txHash: o.txHash,
    submittedAt: o.submittedAt
  })));
});

app.get('/api/debug/events/:invoiceId', async (req, res) => {
  // Accepts an order invoiceId, or ?txHash= directly (orders are in-memory).
  const order = getOrder(req.params.invoiceId);
  const txHash = req.query.txHash || order?.txHash;
  if (!txHash) return safeError(res, 404, 'ORDER_NOT_FOUND', 'No payment record for this invoice');
  try {
    const eventsResp = await deployment.events.list({ txHash, limit: 100 });
    const data = eventsResp.data ?? eventsResp;
    res.json({ txHash, events: data?.items ?? data ?? [] });
  } catch (e) {
    res.json({ txHash, fetchError: e.message });
  }
});

// ---------- Boot ----------
loadOrders();
try {
  const capabilities = await connectDeployment();
  console.log(`Paiflow deployment bound: ${PAIFLOW_DEPLOYMENT_ID}`);
  console.log(`Network: ${capabilities.network}, execute: ${!!capabilities.operations?.execute}`);
  app.listen(PORT, () => {
    console.log(`FreelanceFlow running at http://localhost:${PORT}`);
    console.log('Keep the developer token server-side; Freighter signs in the browser.');
  });
} catch (err) {
  console.error('Deployment connection failed:', err.message);
  process.exit(1);
}
