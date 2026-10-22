# 🎤 FreelanceFlow — Simple Demo Script (~90 seconds)

Read this aloud while clicking through the app or the deck (`/presentation.html`).

---

## 0. Purpose, users & target consumers (15s)

**Purpose:** FreelanceFlow exists to make sure freelancers get paid **fairly, automatically,
and with proof** — while giving a small, fixed share back to the community that supports them.

**Who uses it:**
- **Freelancers** — the main users. They create invoices and receive their 90%.
- **Clients** — they pay the invoice once, from their own crypto wallet.

**Target consumers:** independent workers and small creative teams — designers, developers,
writers, stream-adjacent gig workers — anyone who invoices clients and wants payments that
don't depend on trust, a bank, or manual math. Also: communities and funds (co-ops, guilds,
open-source collectives) that receive the automatic 10% share.

*Say:* "FreelanceFlow is built for freelancers — designers, developers, creators — who
invoice clients and want to give a fixed share to a community fund, without doing any
manual math or trusting a middleman."

---

## 1. What is it? (15s)

"FreelanceFlow is a freelancer invoicing app. A freelancer sends an invoice,
the client pays it in XLM — a Stellar cryptocurrency — and the payment **splits itself**:
**90% goes to the freelancer, 10% goes to a community fund**. Automatically."

## 2. The problem (15s)

"Normally this is a hassle. After a client pays, the freelancer has to check the
blockchain explorer to make sure the money really arrived. Then they grab a
calculator to work out the 10%, and make a **second** transaction to send it.
Every invoice means manual checking and manual math."

## 3. How it works (20s)

"Here, the client pays **once**, from their wallet. A smart contract — built with
Paiflow on the Stellar testnet — receives the payment and splits it in the same
transaction.

Example: an invoice for **101 XLM**. The client pays 101… the contract sends
**90.9 to the freelancer** and **10.1 to the community fund**. Nobody does any math.
Nobody has to be trusted — the split is baked into the contract."

## 4. Proof, not promises (15s)

"The app doesn't take a 'success' screen as proof. It checks the blockchain:
it waits for the transaction receipt **and** verifies both payouts actually
happened on-chain. Only then does the invoice flip to **paid**."

## 5. What if something goes wrong? (15s)

"If the Wi-Fi drops mid-payment — don't pay again. There's a **Check payment**
button. It looks up the original transaction on the blockchain and confirms it.
So you can never double-pay, and you never lose track of money."

## 6. Close (10s)

"That's it: **invoice, get paid, split for good** — verified on the Stellar
testnet, where every claim is checkable on the public ledger. Questions?"

---

## 7. How to use the app (live walkthrough, ~2 min)

*Do these steps live in the app at http://localhost:3000 while narrating:*

1. **Create a client** — go to the Clients section, add a name (e.g. "Greenlight Studio").
2. **Create an invoice** — pick the client, add line items (e.g. "Landing page — 6 hrs × 15 XLM",
   "Revisions — 2 × 5 XLM"). Total: **101 XLM**. A due date (net-14) is set automatically.
3. **Pay with XLM** — open the invoice, click **"Pay with XLM"**. A review screen shows:
   TESTNET, 101 XLM, and the two recipients (90% freelancer / 10% community fund).
4. **Sign in Freighter** — the Freighter wallet popup shows the exact transaction; click approve.
   The button shows a spinner — the app is submitting and **verifying on-chain**.
5. **Watch it flip to "paid"** — only after the receipt and both payouts are verified does the
   invoice turn green. No verification, no "paid".
6. **Follow the money** — the impact dashboard shows cumulative XLM per recipient (auto-refreshes
   every 10s), and the activity feed lists the payment with its transaction link — click it to
   see the split on the public explorer.
7. **Try recovery** — if a payment ever looks stuck, click **"Check payment"** on the invoice.
   It re-checks the original transaction on the blockchain and confirms it — never pays twice.
8. **Reset the demo** — use the "Reset demo data" button (with confirmation) to restore the
   pristine state before the next demo.

*Requirement: the Freighter browser extension, connected to a funded Stellar **testnet** account
(testnet XLM is free from a faucet — it has no real value).*

---

### One-liner (if you only have 15 seconds)

"FreelanceFlow: clients pay one XLM invoice, and a smart contract automatically
sends 90% to the freelancer and 10% to a community fund — verified on-chain
before anyone says 'paid'."
