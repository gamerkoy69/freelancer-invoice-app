/* ============================================================
   FreelanceFlow - app.js
   All data is stored in the browser using localStorage.
   Think of localStorage as a tiny database that survives
   page refreshes. Data is stored as JSON strings.
   ============================================================ */

// ---------- DATA LAYER ----------
// Load saved data from localStorage, or start empty if none exists.
// JSON.parse turns the stored text back into real arrays/objects.
let clients = JSON.parse(localStorage.getItem('clients')) || [];
let invoices = JSON.parse(localStorage.getItem('invoices')) || [];
let nextInvoiceNumber = parseInt(localStorage.getItem('nextInvoiceNumber')) || 1;

// Save current data back into localStorage as JSON text.
function saveData() {
  localStorage.setItem('clients', JSON.stringify(clients));
  localStorage.setItem('invoices', JSON.stringify(invoices));
  localStorage.setItem('nextInvoiceNumber', nextInvoiceNumber);
}

// ---------- HELPERS ----------
// Format a number as dollars, e.g. 1500 -> "$1,500.00"
function money(amount) {
  return '$' + Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// Today's date as 'YYYY-MM-DD' (matches what <input type="date"> uses)
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Work out the status of an invoice based on date and payment.
function getInvoiceStatus(invoice) {
  if (invoice.paid) return 'paid';
  // Payment activity exists but no terminal outcome yet (submitted/pending/verifying).
  const rec = getPaymentRecord(invoice.id);
  if (rec && !['verified', 'failed', 'expired'].includes(rec.status)) return 'paying';
  if (invoice.dueDate < todayStr()) return 'overdue';
  return 'sent';
}

// Total of an invoice = sum of (qty x price) across all line items.
function invoiceTotal(invoice) {
  return invoice.items.reduce((sum, item) => sum + item.qty * item.price, 0);
}

// ---------- NAVIGATION ----------
// Clicking a nav button hides all screens and shows the chosen one.
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('screen-' + btn.dataset.screen).classList.add('active');
  });
});

// ---------- CLIENTS ----------
const clientForm = document.getElementById('client-form');

clientForm.addEventListener('submit', e => {
  e.preventDefault(); // stop the page from reloading on submit

  const client = {
    id: Date.now(), // simple unique id: current timestamp
    name: document.getElementById('client-name').value.trim(),
    email: document.getElementById('client-email').value.trim(),
    rate: parseFloat(document.getElementById('client-rate').value) || 0
  };

  if (!client.name) return; // name is required

  clients.push(client);
  saveData();
  clientForm.reset(); // clear the form
  renderAll();
});

function deleteClient(id) {
  // Stop if this client still has invoices (would leave orphan data).
  const hasInvoices = invoices.some(inv => inv.clientId === id);
  if (hasInvoices) {
    alert('This client has invoices. Delete their invoices first.');
    return;
  }
  if (!confirm('Delete this client?')) return;
  clients = clients.filter(c => c.id !== id);
  saveData();
  renderAll();
}

function renderClients() {
  const tbody = document.querySelector('#clients-table tbody');
  tbody.innerHTML = '';

  if (clients.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-msg">No clients yet — add your first one above.</td></tr>';
  }

  clients.forEach(c => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${c.name}</td>
      <td>${c.email || '—'}</td>
      <td>${c.rate ? money(c.rate) : '—'}</td>
      <td><button class="btn-delete" onclick="deleteClient(${c.id})">Delete</button></td>
    `;
    tbody.appendChild(row);
  });

  // Keep the invoice form's client dropdown in sync with the client list.
  const select = document.getElementById('invoice-client');
  select.innerHTML = '<option value="">-- Select client * --</option>';
  clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    select.appendChild(opt);
  });
}

// ---------- INVOICES ----------
const invoiceForm = document.getElementById('invoice-form');
const itemsList = document.getElementById('items-list');

// Due date automation: default to net-14 from today (local time, not UTC).
function defaultDueDate(offsetDays = 14) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
document.getElementById('invoice-due').value = defaultDueDate();

// Client rate becomes useful: picking a client prefills empty unit prices.
document.getElementById('invoice-client').addEventListener('change', e => {
  const client = clients.find(c => c.id === parseInt(e.target.value));
  if (!client || !client.rate) return;
  itemsList.querySelectorAll('.item-price').forEach(input => {
    if (!input.value) input.value = client.rate;
  });
});

// "+ Add line item" button: clones a blank row into the form.
document.getElementById('add-item-btn').addEventListener('click', () => {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <input type="text" class="item-desc" placeholder="Description" required>
    <input type="number" class="item-qty" placeholder="Qty" min="1" value="1" required>
    <input type="number" class="item-price" placeholder="Unit price ($)" min="0" step="0.01" required>
    <button type="button" class="btn-remove-item">✕</button>
  `;
  itemsList.appendChild(row);
});

// Remove a line item row (works for rows added now or earlier).
itemsList.addEventListener('click', e => {
  if (e.target.classList.contains('btn-remove-item')) {
    if (itemsList.querySelectorAll('.item-row').length > 1) {
      e.target.closest('.item-row').remove();
    }
  }
});

invoiceForm.addEventListener('submit', e => {
  e.preventDefault();

  const clientId = parseInt(document.getElementById('invoice-client').value);
  const dueDate = document.getElementById('invoice-due').value;
  if (!clientId || !dueDate) return;

  // Collect all line items from the form rows.
  const items = [];
  itemsList.querySelectorAll('.item-row').forEach(row => {
    const desc = row.querySelector('.item-desc').value.trim();
    const qty = parseFloat(row.querySelector('.item-qty').value);
    const price = parseFloat(row.querySelector('.item-price').value);
    if (desc && qty > 0 && price >= 0) {
      items.push({ desc, qty, price });
    }
  });

  if (items.length === 0) {
    alert('Add at least one valid line item.');
    return;
  }

  const invoice = {
    id: Date.now(),
    number: nextInvoiceNumber++,
    clientId,
    dueDate,
    items,
    paid: false,
    createdAt: todayStr()
  };

  invoices.push(invoice);
  saveData();
  invoiceForm.reset();
  itemsList.querySelectorAll('.item-row').forEach((row, i) => { if (i > 0) row.remove(); });
  document.getElementById('invoice-due').value = defaultDueDate(); // reset to net-14
  renderAll();
});

function markPaid(id) {
  const invoice = invoices.find(inv => inv.id === id);
  if (invoice) {
    invoice.paid = true;
    saveData();
    renderAll();
  }
}

// ---------- INVOICE DETAIL VIEW ----------
const viewModal = document.getElementById('view-modal');
const viewModalBody = document.getElementById('view-modal-body');

function closeViewModal() {
  viewModal.hidden = true;
}
document.getElementById('view-modal-close').addEventListener('click', closeViewModal);
viewModal.addEventListener('click', e => { if (e.target === viewModal) closeViewModal(); });

function viewInvoice(id) {
  const inv = invoices.find(i => i.id === id);
  if (!inv) return;
  const client = clients.find(c => c.id === inv.clientId);
  const status = getInvoiceStatus(inv);

  document.getElementById('view-modal-title').textContent = `Invoice #${inv.number}`;
  viewModalBody.innerHTML = `
    <div class="pay-review">
      <div class="row"><span>Client</span><span>${client ? client.name : '(deleted client)'}</span></div>
      <div class="row"><span>Email</span><span>${client?.email || '—'}</span></div>
      <div class="row"><span>Created</span><span>${inv.createdAt}</span></div>
      <div class="row"><span>Due date</span><span>${inv.dueDate}</span></div>
      <div class="row"><span>Status</span><span><span class="badge ${status}">${status}</span></span></div>
    </div>
    <table class="detail-table">
      <thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Line total</th></tr></thead>
      <tbody>
        ${inv.items.map(item => `
          <tr>
            <td>${item.desc}</td>
            <td>${item.qty}</td>
            <td>${money(item.price)}</td>
            <td>${money(item.qty * item.price)}</td>
          </tr>`).join('')}
        <tr class="detail-total-row"><td colspan="3">Invoice total</td><td>${money(invoiceTotal(inv))}</td></tr>
      </tbody>
    </table>
    <p class="pay-note">Invoice totals are treated as XLM amounts — paying this invoice sends ${invoiceTotal(inv).toFixed(2)} XLM through the 90/10 split.</p>
    <div class="modal-actions"><button class="btn-cancel" onclick="closeViewModal()">Close</button></div>`;
  viewModal.hidden = false;
}

function deleteInvoice(id) {
  if (!confirm('Delete this invoice?')) return;
  invoices = invoices.filter(inv => inv.id !== id);
  saveData();
  renderAll();
}

function renderInvoices() {
  const tbody = document.querySelector('#invoices-table tbody');
  tbody.innerHTML = '';

  if (invoices.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">No invoices yet — create your first one above.</td></tr>';
  }

  // Show newest first.
  [...invoices].reverse().forEach(inv => {
    const client = clients.find(c => c.id === inv.clientId);
    const status = getInvoiceStatus(inv);
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>#${inv.number}</td>
      <td>${client ? client.name : '(deleted client)'}</td>
      <td>${money(invoiceTotal(inv))}</td>
      <td>${inv.dueDate}</td>
      <td><span class="badge ${status}">${status}</span></td>
      <td>
        <button class="btn-view" onclick="viewInvoice(${inv.id})">View</button>
        ${!inv.paid ? `<button class="btn-pay-xlm" onclick="openPayModal(${inv.id})">Pay with XLM</button>` : ''}
        ${!inv.paid && getPaymentRecord(inv.id) ? `<button class="btn-check-pay" onclick="checkPayment(${inv.id}, true)">Check payment</button>` : ''}
        ${!inv.paid ? `<button class="btn-pay" onclick="markPaid(${inv.id})">Mark paid</button>` : ''}
        <button class="btn-delete" onclick="deleteInvoice(${inv.id})">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

// ---------- DASHBOARD ----------
function renderDashboard() {
  let earned = 0, pending = 0, overdue = 0;

  invoices.forEach(inv => {
    const total = invoiceTotal(inv);
    const status = getInvoiceStatus(inv);
    if (status === 'paid') earned += total;
    else if (status === 'overdue') overdue += total;
    else pending += total;
  });

  document.getElementById('stat-earned').textContent = money(earned);
  document.getElementById('stat-pending').textContent = money(pending);
  document.getElementById('stat-overdue').textContent = money(overdue);
}

// ---------- MASTER RENDER ----------
// Re-render every screen from the saved data.
// We call this after any change so the UI always matches the data.
function renderAll() {
  renderClients();
  renderInvoices();
  renderDashboard();
}

renderAll(); // initial paint on page load

// Auto-resolve payments left pending in a previous session: if the original
// transaction now verifies on-chain, markPaid fires automatically — the
// invoice flips to "paid" with no manual "Check payment" click.
(async function autoResolvePendingPayments() {
  const pending = invoices.filter(inv => {
    if (inv.paid) return false;
    const rec = getPaymentRecord(inv.id);
    return rec && !['verified', 'failed', 'expired'].includes(rec.status);
  });
  for (const inv of pending) {
    try { await checkPayment(inv.id, false); } catch { /* record kept; retried next load */ }
  }
})();

/* ============================================================
   XLM PAYMENT MODULE (Paiflow guide steps 09–11)

   Flow per invoice:
     1. Connect Freighter and read the customer's public address.
     2. Show an explicit review: TESTNET, amount, 90/10 recipients, fee.
     3. Server prepares the transaction (SDK stays server-side).
     4. Freighter signs the ORIGINAL XDR with the testnet passphrase.
     5. Browser sends the signed envelope to the server's submit route,
        which verifies the body hash before submission.
     6. Server verifies the receipt + payout events; only then is the
        invoice marked paid. The saved hash powers recovery ("Check payment").
   ============================================================ */

// ---------- Payment records (survive reloads so recovery never loses state) ----------
function getPaymentRecords() {
  return JSON.parse(localStorage.getItem('xlmPayments')) || {};
}
function getPaymentRecord(invoiceId) {
  return getPaymentRecords()[String(invoiceId)] || null;
}
function savePaymentRecord(invoiceId, patch) {
  const all = getPaymentRecords();
  all[String(invoiceId)] = { ...(all[String(invoiceId)] || {}), ...patch };
  localStorage.setItem('xlmPayments', JSON.stringify(all));
}
function clearPaymentRecord(invoiceId) {
  const all = getPaymentRecords();
  delete all[String(invoiceId)];
  localStorage.setItem('xlmPayments', JSON.stringify(all));
}

// ---------- Modal scaffolding ----------
const payModal = document.getElementById('pay-modal');
const payModalBody = document.getElementById('pay-modal-body');
let payTimer = null; // polling timer, cleared when the modal closes

function closePayModal() {
  payModal.hidden = true;
  if (payTimer) { clearInterval(payTimer); payTimer = null; }
}
document.getElementById('pay-modal-close').addEventListener('click', closePayModal);
payModal.addEventListener('click', e => { if (e.target === payModal) closePayModal(); });

function shortAddr(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '—';
}

// ---------- Server API helpers (the API token never reaches the browser) ----------
async function apiPost(path, body) {
  const resp = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(data?.error?.message || `Request failed (${resp.status})`);
    err.code = data?.error?.code;
    err.status = resp.status;
    throw err;
  }
  return data;
}

// ---------- Step 1: open the modal and connect Freighter ----------
async function openPayModal(invoiceId) {
  const invoice = invoices.find(inv => inv.id === invoiceId);
  if (!invoice) return;

  payModal.hidden = false;
  payModalBody.innerHTML = `<div class="pay-status pending">Connecting to Freighter…</div>`;

  if (!window.freighterConnect || !window.freighterConnect.isAvailable()) {
    payModalBody.innerHTML = `<div class="pay-status error">Freighter bridge not loaded. Check vendor/freighter-api.min.js, then reload.</div>`;
    return;
  }

  let customerAddress;
  try {
    const api = window.freighterApi;
    const connected = api && typeof api.isConnected === 'function'
      ? await api.isConnected()
      : true; // legacy bridges have no isConnected; getAddress will prompt
    if (!connected) throw new Error('Freighter is not connected');
    // Connector unwraps v6 {address}, legacy {publicKey}, or plain string.
    customerAddress = await window.freighterConnect.getAddress();
  } catch (err) {
    payModalBody.innerHTML = `
      <div class="pay-status error">Could not reach Freighter: ${err.message}</div>
      <p class="pay-note">Unlock Freighter, approve this app's origin (http://localhost:PORT), and make sure Freighter is set to Stellar Testnet.</p>
      <div class="modal-actions"><button class="btn-cancel" onclick="closePayModal()">Close</button></div>`;
    return;
  }

  showReview(invoice, customerAddress);
}

// ---------- Step 2: explicit payment review ----------
async function showReview(invoice, customerAddress) {
  const amountXlm = invoiceTotal(invoice).toFixed(2);
  let config;
  try {
    config = await (await fetch('/api/config')).json();
  } catch {
    payModalBody.innerHTML = `<div class="pay-status error">Payment server unreachable. Start it with <b>npm start</b> and reload.</div>`;
    return;
  }

  payModalBody.innerHTML = `
    <div class="pay-review">
      <div class="row"><span>Network</span><span>${config.network.toUpperCase()}</span></div>
      <div class="row"><span>Invoice</span><span>#${invoice.number}</span></div>
      <div class="row"><span>Payer wallet</span><span>${shortAddr(customerAddress)}</span></div>
      <div class="row split-freelancer"><span>Freelancer (90%)</span><span>${(amountXlm * 0.9).toFixed(2)} XLM → ${shortAddr(config.freelancerAddress)}</span></div>
      <div class="row split-community"><span>Community fund (10%)</span><span>${(amountXlm * 0.1).toFixed(2)} XLM → ${shortAddr(config.communityAddress)}</span></div>
      <div class="row total"><span>Total payment</span><span>${amountXlm} XLM</span></div>
      <div class="row"><span>Network fee</span><span>Small XLM fee, shown by Freighter</span></div>
    </div>
    <p class="pay-note">Review the network, amount, recipients and fee in Freighter before approving. Testnet funds have no real value. Invoice totals are treated as XLM amounts for this exercise.</p>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closePayModal()">Cancel</button>
      <button class="btn-sign" id="btn-approve-pay">Approve &amp; prepare payment</button>
    </div>
    <div id="pay-status-slot"></div>`;

  document.getElementById('btn-approve-pay').addEventListener('click', () =>
    prepareAndSign(invoice, customerAddress, amountXlm)
  );
}

// ---------- Step 3–4: server prepares; Freighter signs the original XDR ----------
async function prepareAndSign(invoice, customerAddress, amountXlm) {
  const btn = document.getElementById('btn-approve-pay');
  const slot = document.getElementById('pay-status-slot');
  btn.disabled = true;
  slot.innerHTML = `<div class="pay-status pending">Preparing transaction (server)…</div>`;

  let prep;
  try {
    prep = await apiPost('/api/checkout/prepare', {
      invoiceId: invoice.id,
      amountXlm,
      customerAddress
    });
  } catch (err) {
    if (err.code === 'PREPARATION_EXPIRED') {
      // Retain the record; do not silently prepare a replacement.
      slot.innerHTML = `<div class="pay-status error">The previous preparation expired. Use <b>Check payment</b> on the invoice, or contact support with the invoice number — do not pay again blindly.</div>`;
    } else {
      slot.innerHTML = `<div class="pay-status error">Preparation failed: ${err.message}</div>`;
    }
    btn.disabled = false;
    return;
  }

  slot.innerHTML = `<div class="pay-status pending">Confirm the transaction in Freighter…</div>`;

  let signedXdr;
  try {
    // Sign the ORIGINAL unsigned XDR with the preparation's passphrase.
    signedXdr = await window.freighterConnect.signTransaction(prep.unsignedXdr, {
      networkPassphrase: prep.networkPassphrase
    });
  } catch (err) {
    slot.innerHTML = `<div class="pay-status error">Signing was cancelled or failed (${err.message}). The preparation is saved — use <b>Check payment</b> to recover instead of starting over.</div>`;
    btn.disabled = false;
    return;
  }

  slot.innerHTML = `<div class="pay-status pending">Submitting signed transaction…</div>`;

  // ---------- Step 5: submit through the server ----------
  let submitted;
  try {
    submitted = await apiPost('/api/checkout/submit', { invoiceId: invoice.id, signedXdr });
  } catch (err) {
    if (err.code === 'SUBMIT_UNCERTAIN' || err.code === 'ENVELOPE_MISMATCH') {
      slot.innerHTML = `<div class="pay-status error">${err.message}. The original record is retained — use <b>Check payment</b> before trying anything else.</div>`;
    } else {
      slot.innerHTML = `<div class="pay-status error">Submission failed: ${err.message}. Use <b>Check payment</b> to recover the original transaction.</div>`;
    }
    btn.disabled = false;
    return;
  }

  savePaymentRecord(invoice.id, { txHash: submitted.txHash, status: 'submitted', checkedAt: new Date().toISOString() });
  renderAll();
  showPending(invoice, submitted.txHash);
}

// ---------- Step 6: wait for verification before marking paid ----------
function showPending(invoice, txHash) {
  const expertUrl = `https://stellar.expert/explorer/testnet/tx/${txHash}`;
  payModalBody.innerHTML = `
    <div class="pay-status pending">
      Payment submitted.<br>Transaction: <a href="${expertUrl}" target="_blank" rel="noopener">${shortAddr(txHash)}</a><br>
      Waiting for on-chain confirmation and payout verification…
    </div>
    <div id="pay-status-slot"></div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closePayModal()">Close (auto-check continues in background)</button>
      <button class="btn-sign" onclick="checkPayment(${invoice.id}, true)">Check payment now</button>
    </div>`;

  // Poll until a terminal state (paid / failed / expired) or ~5 minutes.
  // Stellar event feeds can lag well past the first confirmation.
  let attempts = 0;
  if (payTimer) clearInterval(payTimer);
  payTimer = setInterval(async () => {
    attempts++;
    const done = await checkPayment(invoice.id, false); // marks paid automatically when verified
    if (done || attempts >= 60) {
      clearInterval(payTimer); payTimer = null;
      if (!done && !invoices.find(i => i.id === invoice.id)?.paid) {
        // Out of polling budget without a terminal state — leave the record
        // pending; the next page load's auto-resolve sweep will pick it up.
        renderAll();
      }
    }
  }, 5000);
}

// ---------- Step 11: check / recover the ORIGINAL transaction ----------
async function checkPayment(invoiceId, showInModal) {
  const invoice = invoices.find(inv => inv.id === invoiceId);
  if (!invoice) return true;

  if (showInModal) {
    payModal.hidden = false;
    payModalBody.innerHTML = `<div class="pay-status pending">Checking the original transaction…</div>`;
    if (payTimer) { clearInterval(payTimer); payTimer = null; }
  }

  let status;
  try {
    status = await (await fetch(`/api/checkout/status/${invoiceId}`)).json();
    // The server's order store predates this payment (e.g. before persistent
    // storage) — fall back to verifying by the original hash the browser kept.
    if (status?.error?.code === 'ORDER_NOT_FOUND') {
      const rec = getPaymentRecord(invoiceId);
      if (rec?.txHash) {
        const vt = await (await fetch('/api/checkout/verify-tx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txHash: rec.txHash, amountXlm: invoiceTotal(invoice).toFixed(2) })
        })).json();
        if (vt?.state === 'submitted') status = vt;
      }
    }
  } catch {
    status = { state: 'error', detail: 'Payment server unreachable' };
  }

  const slot = document.getElementById('pay-status-slot');
  const render = html => {
    if (showInModal) {
      payModalBody.innerHTML = html;
    } else if (slot) {
      slot.innerHTML = html;
    }
  };

  // Recovery table from guide step 11:
  switch (status.state) {
    case 'created':
    case 'prepared':
      render(`<div class="pay-status pending">A preparation exists but no signed transaction was submitted yet.
        Return to the invoice and finish the payment before it expires (${status.review?.preparationTtlRemaining ?? '?'}s left).</div>
        <div class="modal-actions"><button class="btn-cancel" onclick="closePayModal()">Close</button></div>`);
      return false;

    case 'preparation_expired':
      render(`<div class="pay-status error">The preparation expired. Do NOT start a new payment blindly — an error never proves nothing was sent. Contact support with the invoice number and deployment UUID.</div>
        <div class="modal-actions"><button class="btn-cancel" onclick="closePayModal()">Close</button></div>`);
      return true;

    case 'submitted':
      if (status.verified) {
        savePaymentRecord(invoiceId, { txHash: status.txHash, status: 'verified', checkedAt: new Date().toISOString() });
        if (!invoice.paid) markPaid(invoice.id); // only now is the invoice fulfilled
        render(`<div class="pay-status success">✅ Payment confirmed and verified on testnet:<br>
          ${status.expectedPayouts.freelancerXlm} XLM → freelancer, ${status.expectedPayouts.communityXlm} XLM → community fund.<br>
          <a href="https://stellar.expert/explorer/testnet/tx/${status.txHash}" target="_blank" rel="noopener">View transaction</a></div>
          <div class="modal-actions"><button class="btn-sign" onclick="closePayModal()">Done</button></div>`);
        return true;
      }
      if (status.status === 'SUCCESS') {
        // On chain but payout evidence incomplete — check again, do not re-pay.
        savePaymentRecord(invoiceId, { txHash: status.txHash, status: 'verifying', checkedAt: new Date().toISOString() });
        render(`<div class="pay-status pending">Transaction succeeded (${status.status}) but payout evidence is still incomplete (events seen: ${status.eventsSeen}). Indexed feeds can lag — auto-check continues in the background. Do not create another payment.</div>
          <div class="modal-actions"><button class="btn-sign" onclick="checkPayment(${invoiceId}, true)">Check again</button></div>`);
        return false;
      }
      if (status.status === 'FAILED') {
        savePaymentRecord(invoiceId, { txHash: status.txHash, status: 'failed', checkedAt: new Date().toISOString() });
        render(`<div class="pay-status error">Transaction <a href="https://stellar.expert/explorer/testnet/tx/${status.txHash}" target="_blank" rel="noopener">${shortAddr(status.txHash)}</a> FAILED. Keep this record and fix the cause before a deliberate new attempt — never auto-retry.</div>
          <div class="modal-actions"><button class="btn-cancel" onclick="closePayModal()">Close</button></div>`);
        return true;
      }
      // PENDING / UNKNOWN / etc.
      savePaymentRecord(invoiceId, { txHash: status.txHash, status: 'pending', checkedAt: new Date().toISOString() });
      render(`<div class="pay-status pending">Transaction ${status.txHash ? `<a href="https://stellar.expert/explorer/testnet/tx/${status.txHash}" target="_blank" rel="noopener">${shortAddr(status.txHash)}</a>` : ''} is ${status.status ?? 'PENDING'}. An error or pending state never proves nothing was broadcast — keep the original record and check again.</div>
        <div class="modal-actions"><button class="btn-sign" onclick="checkPayment(${invoiceId}, true)">Check again</button></div>`);
      return false;

    case 'unknown':
    default:
      render(`<div class="pay-status error">Finality could not be established${status.detail ? `: ${status.detail}` : ''}. The original payment record is retained — do not reset the order or pay again. Contact support with the deployment UUID and transaction hash.</div>
        <div class="modal-actions"><button class="btn-sign" onclick="checkPayment(${invoiceId}, true)">Check again</button></div>`);
      return false;
  }
}

/* ============================================================
   IMPACT DASHBOARD + ACTIVITY FEED
   Live "follow the money" totals and a payments feed, both
   refreshed automatically every 10 seconds (matching the demo
   storefront pattern; feeds can lag behind the ledger).
   ============================================================ */
function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

async function refreshImpact() {
  try {
    const data = await (await fetch('/api/impact')).json();
    if (!data || data.error) return;

    document.getElementById('impact-freelancer-total').textContent = data.freelancer.totalXlm;
    document.getElementById('impact-community-total').textContent = data.community.totalXlm;
    document.getElementById('impact-combined').textContent = data.combinedXlm;
    document.getElementById('impact-freelancer-addr').textContent = shortAddr(data.freelancer.address);
    document.getElementById('impact-community-addr').textContent = shortAddr(data.community.address);
    document.getElementById('impact-freelancer-bar').style.width = `${data.freelancer.milestone.pct}%`;
    document.getElementById('impact-community-bar').style.width = `${data.community.milestone.pct}%`;
    document.getElementById('impact-freelancer-milestone').textContent =
      `Next milestone: ${data.freelancer.milestone.xlm} XLM`;
    document.getElementById('impact-community-milestone').textContent =
      `Next milestone: ${data.community.milestone.xlm} XLM`;
    document.getElementById('impact-updated').textContent = `last update ${timeAgo(data.updatedAt)}`;
  } catch { /* keep previous values on transient errors */ }
}

async function refreshActivity() {
  const feed = document.getElementById('activity-feed');
  try {
    const data = await (await fetch('/api/activity')).json();
    const items = data?.items ?? [];
    if (items.length === 0) {
      feed.innerHTML = '<div class="feed-item"><span class="feed-detail">No payments recorded yet — pay an invoice with XLM to see it here.</span></div>';
      return;
    }
    feed.innerHTML = items.map(it => `
      <div class="feed-item">
        <span class="feed-amount">${it.amountXlm} XLM</span>
        <span class="feed-detail">
          Invoice ${it.invoiceId}
          ${it.txHash
            ? `· <a href="https://stellar.expert/explorer/testnet/tx/${it.txHash}" target="_blank" rel="noopener">${shortAddr(it.txHash)}</a>`
            : '· preparation only'}
          ${it.payouts
            ? `<span class="feed-split f">${it.payouts.freelancerXlm} → freelancer</span><span class="feed-split c">${it.payouts.communityXlm} → community</span>`
            : ''}
        </span>
        <span class="feed-time">${timeAgo(it.at)}</span>
      </div>`).join('');
  } catch {
    // Leave the last good render in place; the next 10s tick retries.
  }
}

refreshImpact();
refreshActivity();
setInterval(() => { refreshImpact(); refreshActivity(); }, 10_000);
