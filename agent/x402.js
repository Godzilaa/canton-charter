/**
 * x402 fetch layer — intercepts HTTP 402 and pays via Canton Charter.
 *
 * What actually happens on each call to x402Fetch():
 *
 *   Step 1  Regular HTTP request hits the trading API.
 *
 *   Step 2  API returns HTTP 402 with a JSON body:
 *           { accepts: [{ scheme:'x402', amount:'1.00', currency:'USD', ... }] }
 *           This is the x402 payment specification — machine-readable price tag.
 *
 *   Step 3  x402 layer calls RequestAuthorization on the Canton SpendingPolicy
 *           smart contract (DAML choice). The ledger enforces:
 *             - amount ≤ maxPerTx
 *             - category in allowedCategories
 *             - policy.active === true
 *           Returns a PaymentAuthorization contract with status Approved or PendingApproval.
 *
 *   Step 4  The PaymentAuthorization contractId becomes the X-Payment-Token header.
 *           The API request is retried. The trading server trusts any non-empty token
 *           (production would verify on-chain) and responds 200 + X-Receipt-Token.
 *
 *   Step 5  x402 layer calls Execute on the PaymentAuthorization contract.
 *           This is the settlement step:
 *             - Consumes the PaymentAuthorization contract
 *             - Creates an immutable PaymentRecord on Canton with:
 *                 x402Token = <receipt from the API server>
 *                 txRef     = receipt ID
 *             - The PaymentRecord is the permanent on-chain audit entry.
 *
 *   Result  { data, status, onChain: { authorizationId, paymentRecordId, ... } }
 *
 * The Agent Feed (/agent) shows PaymentAuthorization contracts (Step 3).
 * PaymentRecord contracts are the settled, final accounting entries (Step 5).
 */

import { runCharterTool } from './index.js'

// Canton connection (same credentials as the agent)
const LEDGER_URL    = 'https://ledger-api.validator.devnet.sandbox.fivenorth.io'
const AUTH_URL      = 'https://auth.sandbox.fivenorth.io/application/o/token/'
const CLIENT_ID     = 'validator-devnet-m2m'
const CLIENT_SECRET = 'r69FQmevLRwEgMB8NnKaSDHPewTOSx7Yy5jucsqAlmsAaJc3DlggedCz4tyyonl4W2WoOVzkUIjy8dHTlc16AOJQzx02QzJylAUG56oLTCoVCJUUK40vRv9CqQEY3fjn'
const AUDIENCE      = 'validator-devnet-m2m'
const PARTY         = '14::1220a14ca128063b8dc9d1ebb0bd22633be9f2168500f4dbc1ecaeb1855b14e5acf8'
const PKG           = '7609a6c39916b5002ba39f9e487018070a6b0135ab768322d2c9dac0df973fde'

let _tok = null
let _tokExpires = 0
let _seq = 0

async function getToken() {
  if (_tok && Date.now() < _tokExpires) return _tok
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      audience:      AUDIENCE,
    }),
  })
  const d = await res.json()
  if (!d.access_token) throw new Error('Canton auth failed: ' + JSON.stringify(d))
  _tok = d.access_token
  _tokExpires = Date.now() + 7 * 60 * 60 * 1000
  return _tok
}

async function canton(path, body) {
  const tok = await getToken()
  const res = await fetch(LEDGER_URL + path, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.cause ?? json.errors?.[0] ?? `Canton ${res.status}`)
  return json
}

/**
 * Execute an approved PaymentAuthorization on Canton.
 * This is the settlement step — creates an immutable PaymentRecord.
 *
 * @param {string} authContractId  - PaymentAuthorization contract ID
 * @param {string|null} x402Token  - receipt token returned by the API server
 * @param {string} txRef           - external reference (receipt ID)
 * @returns {string|null}          - PaymentRecord contract ID
 */
async function settleOnChain(authContractId, x402Token, txRef) {
  const result = await canton('/v2/commands/submit-and-wait-for-transaction', {
    commands: {
      commandId: `x402-settle-${Date.now()}-${++_seq}`,
      actAs: [PARTY],
      commands: [{
        ExerciseCommand: {
          templateId: `${PKG}:Charter:PaymentAuthorization`,
          contractId: authContractId,
          choice: 'Execute',
          choiceArgument: {
            settledAt: new Date().toISOString(),
            x402Token: x402Token ?? null,
            txRef:     txRef ?? '',
          },
        },
      }],
    },
  })
  const ev = result?.transaction?.events?.find(e => e.CreatedEvent)?.CreatedEvent
  return ev?.contractId ?? null
}

/**
 * x402-aware fetch. Transparently handles payment and on-chain settlement.
 *
 * @param {string}  url   - API endpoint URL
 * @param {object}  opts  - standard fetch options (method, headers, body, …)
 * @returns {{ data, status, onChain }}
 *   data     — parsed JSON from the API (after successful payment)
 *   status   — HTTP status code of the final response
 *   onChain  — Canton ledger record, or null if no payment was needed
 *     .authorizationId   — PaymentAuthorization contract ID (appears in Agent Feed)
 *     .authStatus        — 'Approved' | 'PendingApproval'
 *     .paymentRecordId   — PaymentRecord contract ID (settled, immutable)
 *     .amount            — dollar amount paid
 *     .vendor            — vendor name from the 402 spec
 *     .receiptToken      — X-Receipt-Token from the API server
 */
export async function x402Fetch(url, opts = {}) {
  // ── Step 1: initial request ───────────────────────────────────────────────
  const res1 = await fetch(url, opts)

  if (res1.status !== 402) {
    return { data: await res1.json(), status: res1.status, onChain: null }
  }

  // ── Step 2: parse 402 payment spec ───────────────────────────────────────
  const spec402 = await res1.json()
  const payment = spec402.accepts?.[0]
  if (!payment) throw new Error(`402 from ${url} has no accepts[] payment spec`)

  const { amount, currency = 'USD', category = 'data', vendor = 'TradingAPI', resource, description } = payment
  const purpose = `x402: ${description ?? resource} [${new URL(url).pathname}]`

  console.log(`  [x402] 402 ← ${new URL(url).pathname}`)
  console.log(`         spec: $${amount} ${currency} · ${category} · "${description}"`)

  // ── Step 3: authorize on Canton SpendingPolicy ───────────────────────────
  console.log(`  [x402] → RequestAuthorization on Canton SpendingPolicy`)
  const auth = await runCharterTool('charter_request_payment', {
    amount:   String(amount),
    vendor:   vendor ?? 'TradingAPI',
    category,
    purpose,
  })

  const icon = auth.status === 'Approved' ? '✓' : auth.status === 'PendingApproval' ? '⏳' : '✗'
  console.log(`  [x402] ${icon} PaymentAuthorization: ${auth.status}`)
  console.log(`         authId: ${auth.authorizationId?.slice(0, 28)}...`)

  if (auth.status === 'Rejected') {
    throw new Error(`Canton policy rejected payment: ${auth.message}`)
  }

  // ── Step 4: retry with authorizationId as payment proof ─────────────────
  const retryHeaders = { ...(opts.headers ?? {}), 'X-Payment-Token': auth.authorizationId }
  const res2 = await fetch(url, { ...opts, headers: retryHeaders })

  if (!res2.ok) {
    const body = await res2.text()
    throw new Error(`API ${res2.status} after payment: ${body}`)
  }

  const data         = await res2.json()
  const receiptToken = res2.headers.get('X-Receipt-Token') ?? data.receipt ?? null

  console.log(`  [x402] ✓ 200 ← API  receipt: ${receiptToken}`)

  // ── Step 5: settle — Execute choice creates PaymentRecord on Canton ──────
  let paymentRecordId = null
  if (auth.status === 'Approved' && auth.authorizationId) {
    console.log(`  [x402] → Execute (settle) on Canton PaymentAuthorization`)
    try {
      paymentRecordId = await settleOnChain(auth.authorizationId, receiptToken, data.receipt ?? receiptToken ?? '')
      console.log(`  [x402] ✓ PaymentRecord: ${paymentRecordId?.slice(0, 28)}...`)
    } catch (e) {
      // Non-fatal: settlement can be retried; PaymentAuthorization still on-chain
      console.log(`  [x402] ⚠ Execute failed (settlement pending): ${e.message}`)
    }
  } else {
    console.log(`  [x402] ⏳ PendingApproval — settlement will happen after CFO approves`)
  }

  return {
    data,
    status: res2.status,
    onChain: {
      authorizationId: auth.authorizationId,
      authStatus:      auth.status,
      paymentRecordId,
      amount:          String(amount),
      vendor:          vendor ?? 'TradingAPI',
      receiptToken,
    },
  }
}
