#!/usr/bin/env node
// Simulates an AI agent making autonomous payment requests against active SpendingPolicies.

const LEDGER_URL    = process.env.CHARTER_LEDGER_URL    ?? 'https://ledger-api.validator.devnet.sandbox.fivenorth.io'
const AUTH_URL      = process.env.CHARTER_AUTH_URL      ?? 'https://auth.sandbox.fivenorth.io/application/o/token/'
const CLIENT_ID     = process.env.CHARTER_CLIENT_ID     ?? 'validator-devnet-m2m'
const CLIENT_SECRET = process.env.CHARTER_CLIENT_SECRET ?? 'r69FQmevLRwEgMB8NnKaSDHPewTOSx7Yy5jucsqAlmsAaJc3DlggedCz4tyyonl4W2WoOVzkUIjy8dHTlc16AOJQzx02QzJylAUG56oLTCoVCJUUK40vRv9CqQEY3fjn'
const AUDIENCE      = process.env.CHARTER_AUDIENCE      ?? 'validator-devnet-m2m'
const PARTY         = process.env.CHARTER_PARTY         ?? '14::1220a14ca128063b8dc9d1ebb0bd22633be9f2168500f4dbc1ecaeb1855b14e5acf8'
const PKG           = process.env.CHARTER_PKG           ?? '7609a6c39916b5002ba39f9e487018070a6b0135ab768322d2c9dac0df973fde'
// When set, the sim uses this specific policy instead of scanning the ACS.
const PINNED_POLICY = process.env.CHARTER_POLICY_ID     ?? null

const REQUESTS = [
  { amount: '25.00', vendor: 'OpenAI', category: 'api',     purpose: 'LLM inference for procurement analysis' },
  { amount: '80.00', vendor: 'AWS',    category: 'compute', purpose: 'Batch inference job — nightly embeddings' },
  { amount: '15.00', vendor: 'Pinecone', category: 'data',  purpose: 'Vector DB query — supplier risk scoring' },
  { amount: '42.00', vendor: 'Cohere', category: 'api',     purpose: 'Reranking pass for contract review' },
  { amount: '99.00', vendor: 'Databricks', category: 'compute', purpose: 'Spark job — invoice anomaly detection' },
  { amount: '10.00', vendor: 'WeatherAPI', category: 'api', purpose: 'Real-time data for logistics routing agent' },
]

async function getToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    audience: AUDIENCE,
  })
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Failed to get token: ' + JSON.stringify(data))
  return data.access_token
}

async function api(token, path, body) {
  const res = await fetch(LEDGER_URL + path, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.cause ?? json.errors?.[0] ?? 'Ledger error')
  return json
}

let seq = 0
function cmdId() { return `agent-sim-${Date.now()}-${++seq}` }

async function main() {
  console.log('Agent Simulator — Canton Charter\n')

  const token = await getToken()
  console.log('✓ Token acquired\n')

  const { offset } = await api(token, '/v2/state/ledger-end')
  const acsData = await api(token, '/v2/state/active-contracts', {
    filter: { filtersByParty: { [PARTY]: {} } },
    verbose: true,
    activeAtOffset: offset,
  })

  const policies = acsData
    .filter(item => item?.contractEntry?.JsActiveContract)
    .map(item => {
      const ev = item.contractEntry.JsActiveContract.createdEvent
      return { contractId: ev.contractId, templateId: ev.templateId, payload: ev.createArgument }
    })
    .filter(c => c.templateId === `${PKG}:Charter:SpendingPolicy` && c.payload.active)

  if (policies.length === 0) {
    console.error('No active SpendingPolicies found. Run: node scripts/onboard.js <agent-name>')
    process.exit(1)
  }

  const policy = PINNED_POLICY
    ? policies.find(p => p.contractId === PINNED_POLICY) ?? policies[0]
    : policies[0]
  console.log(`Using policy: ${policy.contractId.slice(0, 20)}...`)
  console.log(`  Max/tx: $${policy.payload.maxPerTx}  Daily: $${policy.payload.dailyLimit}`)
  console.log(`  Categories: ${(policy.payload.allowedCategories || []).join(', ')}`)
  console.log(`  Approval above: $${policy.payload.requireApprovalAbove ?? 'none'}\n`)

  const allowed = policy.payload.allowedCategories || []
  const eligible = REQUESTS.filter(r =>
    allowed.includes(r.category) &&
    parseFloat(r.amount) <= parseFloat(policy.payload.maxPerTx)
  )

  if (eligible.length === 0) {
    console.error('No eligible requests match the policy categories/limits.')
    process.exit(1)
  }

  console.log(`Submitting ${eligible.length} payment authorization requests...\n`)

  for (const req of eligible) {
    const now = new Date().toISOString()
    try {
      const result = await api(token, '/v2/commands/submit-and-wait-for-transaction', {
        commands: {
          commandId: cmdId(),
          actAs: [PARTY],
          commands: [{
            ExerciseCommand: {
              templateId: `${PKG}:Charter:SpendingPolicy`,
              contractId: policy.contractId,
              choice: 'RequestAuthorization',
              choiceArgument: {
                amount: req.amount,
                vendor: req.vendor,
                category: req.category,
                purpose: req.purpose,
                requestedAt: now,
              },
            },
          }],
        },
      })
      const ev = result?.transaction?.events?.[0]?.CreatedEvent
      const status = ev?.createArgument?.status ?? 'unknown'
      const tag = typeof status === 'object' ? Object.keys(status)[0] : status
      const icon = tag === 'Approved' ? '✓' : tag === 'PendingApproval' ? '⏳' : '✗'
      console.log(`${icon} $${req.amount.padStart(6)} ${req.vendor.padEnd(15)} [${req.category}]  → ${tag}`)
    } catch (e) {
      console.log(`✗ $${req.amount.padStart(6)} ${req.vendor.padEnd(15)} [${req.category}]  → ERROR: ${e.message}`)
    }
    await new Promise(r => setTimeout(r, 300))
  }

  console.log('\nDone. Check the Agent Feed in the dashboard.')
}

main().catch(e => { console.error(e.message); process.exit(1) })
