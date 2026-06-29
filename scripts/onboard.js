#!/usr/bin/env node
// Onboards a new AI agent to Canton Charter.
// Creates a SpendingPolicy on-chain and prints the agent's runtime config.
//
// Usage:
//   node scripts/onboard.js <agent-name>
//   node scripts/onboard.js openclaw --max-per-tx 50 --daily-limit 300 --approval-above 25 --categories api,compute,data

const LEDGER_URL    = 'https://ledger-api.validator.devnet.sandbox.fivenorth.io'
const AUTH_URL      = 'https://auth.sandbox.fivenorth.io/application/o/token/'
const CLIENT_ID     = 'validator-devnet-m2m'
const CLIENT_SECRET = 'r69FQmevLRwEgMB8NnKaSDHPewTOSx7Yy5jucsqAlmsAaJc3DlggedCz4tyyonl4W2WoOVzkUIjy8dHTlc16AOJQzx02QzJylAUG56oLTCoVCJUUK40vRv9CqQEY3fjn'
const AUDIENCE      = 'validator-devnet-m2m'
const PKG           = '7609a6c39916b5002ba39f9e487018070a6b0135ab768322d2c9dac0df973fde'

// ----------------------------------------------------------------------------
// Argument parsing
// ----------------------------------------------------------------------------

const args = process.argv.slice(2)
if (!args[0] || args[0].startsWith('--')) {
  console.error('Usage: node scripts/onboard.js <agent-name> [--max-per-tx N] [--daily-limit N] [--approval-above N] [--categories a,b,c]')
  process.exit(1)
}

const agentName = args[0]

function flag(name, def) {
  const idx = args.indexOf(`--${name}`)
  return idx !== -1 ? args[idx + 1] : def
}

const maxPerTx      = flag('max-per-tx', '100.00')
const dailyLimit    = flag('daily-limit', '500.00')
const approvalAbove = flag('approval-above', '50.00')
const categories    = flag('categories', 'api,compute,data').split(',').map(s => s.trim())

// ----------------------------------------------------------------------------
// Canton helpers
// ----------------------------------------------------------------------------

let seq = 0
function commandId() { return `onboard-${agentName}-${Date.now()}-${++seq}` }

async function getToken() {
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      audience: AUDIENCE,
      scope: 'daml_ledger_api',
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Auth failed: ' + JSON.stringify(data))
  return data.access_token
}

async function ledger(token, path, body) {
  const res = await fetch(LEDGER_URL + path, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.cause ?? json.errors?.[0] ?? JSON.stringify(json))
  return json
}

// Discover the primary party associated with the m2m token.
// Falls back to the known devnet party if the endpoint isn't available.
async function discoverParty(token) {
  try {
    const data = await ledger(token, '/v2/users/self')
    const party = data.user?.primaryParty ?? data.primaryParty
    if (party) return party
  } catch { /* endpoint may not exist on all Canton versions */ }

  // Known Seaport devnet party for validator-devnet-m2m
  return '14::1220a14ca128063b8dc9d1ebb0bd22633be9f2168500f4dbc1ecaeb1855b14e5acf8'
}

async function createPolicy(token, party) {
  const result = await ledger(token, '/v2/commands/submit-and-wait-for-transaction', {
    commands: {
      commandId: commandId(),
      actAs: [party],
      commands: [{
        CreateCommand: {
          templateId: `${PKG}:Charter:SpendingPolicy`,
          createArguments: {
            enterprise:           party,
            agent:                party,
            approver:             party,
            maxPerTx,
            dailyLimit,
            allowedCategories:    categories,
            requireApprovalAbove: approvalAbove,
            active:               true,
          },
        },
      }],
    },
  })

  const contractId = result?.transaction?.events?.[0]?.CreatedEvent?.contractId
                  ?? result?.transaction?.events?.[0]?.created?.contractId
  if (!contractId) throw new Error('No contractId in response: ' + JSON.stringify(result))
  return contractId
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  console.log(`\nCanton Charter — Onboarding "${agentName}"\n`)

  console.log('  Authenticating...')
  const token = await getToken()
  console.log('  ✓ Token acquired')

  console.log('  Discovering party...')
  const party = await discoverParty(token)
  console.log(`  ✓ Party: ${party}`)

  console.log('  Creating SpendingPolicy on-chain...')
  const contractId = await createPolicy(token, party)
  console.log(`  ✓ Policy created: ${contractId.slice(0, 24)}...`)

  const connectUrl = `http://localhost:3000/agent?connect=${encodeURIComponent(contractId)}`

  console.log('\n' + '─'.repeat(60))
  console.log(`  Agent "${agentName}" is onboarded to Canton Charter`)
  console.log('─'.repeat(60))
  console.log(`
  Policy limits
    Max per transaction : $${maxPerTx}
    Daily limit         : $${dailyLimit}
    Approval above      : $${approvalAbove}
    Allowed categories  : ${categories.join(', ')}

  Connect the dashboard to this agent:
    ${connectUrl}

  Runtime config  (set these as env vars for your agent)

    CHARTER_LEDGER_URL="${LEDGER_URL}"
    CHARTER_AUTH_URL="${AUTH_URL}"
    CHARTER_CLIENT_ID="${CLIENT_ID}"
    CHARTER_CLIENT_SECRET="${CLIENT_SECRET}"
    CHARTER_AUDIENCE="${AUDIENCE}"
    CHARTER_PARTY="${party}"
    CHARTER_PKG="${PKG}"
    CHARTER_POLICY_ID="${contractId}"

  To simulate this agent:
    CHARTER_POLICY_ID="${contractId}" node scripts/agent-sim.js
`)
}

main().catch(e => { console.error('\n  ✗', e.message); process.exit(1) })
