#!/usr/bin/env node
/**
 * Canton Charter — AI Agent Skill
 *
 * Provides two things:
 *
 * 1. Exported Charter tools for embedding into any Claude agent (OpenClaw etc):
 *      import { charterTools, runCharterTool } from './agent/index.js'
 *
 * 2. Standalone demo — Claude autonomously procures services for a Q3 mission:
 *      ANTHROPIC_API_KEY=sk-... node agent/index.js
 *
 * Onboard a brand-new agent first:
 *      node scripts/onboard.js openclaw
 *    Then run with its policy pinned:
 *      CHARTER_POLICY_ID=<id> ANTHROPIC_API_KEY=sk-... node agent/index.js
 */

import Anthropic from '@anthropic-ai/sdk'

// ---------------------------------------------------------------------------
// Config — all values can be overridden per-agent via environment variables
// (printed by scripts/onboard.js after creating a new SpendingPolicy)
// ---------------------------------------------------------------------------

const LEDGER_URL    = process.env.CHARTER_LEDGER_URL    ?? 'https://ledger-api.validator.devnet.sandbox.fivenorth.io'
const AUTH_URL      = process.env.CHARTER_AUTH_URL      ?? 'https://auth.sandbox.fivenorth.io/application/o/token/'
const CLIENT_ID     = process.env.CHARTER_CLIENT_ID     ?? 'validator-devnet-m2m'
const CLIENT_SECRET = process.env.CHARTER_CLIENT_SECRET ?? 'r69FQmevLRwEgMB8NnKaSDHPewTOSx7Yy5jucsqAlmsAaJc3DlggedCz4tyyonl4W2WoOVzkUIjy8dHTlc16AOJQzx02QzJylAUG56oLTCoVCJUUK40vRv9CqQEY3fjn'
const AUDIENCE      = process.env.CHARTER_AUDIENCE      ?? 'validator-devnet-m2m'
const PARTY         = process.env.CHARTER_PARTY         ?? '14::1220a14ca128063b8dc9d1ebb0bd22633be9f2168500f4dbc1ecaeb1855b14e5acf8'
const PKG           = process.env.CHARTER_PKG           ?? '7609a6c39916b5002ba39f9e487018070a6b0135ab768322d2c9dac0df973fde'
// When set (by scripts/onboard.js), requests target this specific policy.
const PINNED_POLICY = process.env.CHARTER_POLICY_ID     ?? null

// ---------------------------------------------------------------------------
// Canton helpers
// ---------------------------------------------------------------------------

let _token = null
let _tokenExpiresAt = 0
let _cmdSeq = 0

async function getToken() {
  if (_token && Date.now() < _tokenExpiresAt) return _token
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
  if (!data.access_token) throw new Error('Canton auth failed: ' + JSON.stringify(data))
  _token = data.access_token
  _tokenExpiresAt = Date.now() + 7 * 60 * 60 * 1000
  return _token
}

async function canton(path, body) {
  const token = await getToken()
  const res = await fetch(LEDGER_URL + path, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.cause ?? json.errors?.[0] ?? `Canton error ${res.status}`)
  return json
}

function cmdId(label) { return `charter-${label}-${Date.now()}-${++_cmdSeq}` }

async function queryACS(templateShortId) {
  const { offset } = await canton('/v2/state/ledger-end')
  const data = await canton('/v2/state/active-contracts', {
    filter: {
      filtersByParty: {
        [PARTY]: {
          inclusive: {
            templateFilters: [{ templateId: `${PKG}:${templateShortId}` }],
          },
        },
      },
    },
    verbose: true,
    activeAtOffset: offset,
  })
  const tid = `${PKG}:${templateShortId}`
  return (Array.isArray(data) ? data : [])
    .filter(item => item?.contractEntry?.JsActiveContract)
    .map(item => {
      const ev = item.contractEntry.JsActiveContract.createdEvent
      return { contractId: ev.contractId, templateId: ev.templateId, payload: ev.createArgument ?? ev.createArguments }
    })
    .filter(c => c.templateId === tid)
}

async function getActivePolicies() {
  const all = await queryACS('Charter:SpendingPolicy')
  return all.filter(c => c.payload?.active)
}

function pickPolicy(policies) {
  if (PINNED_POLICY) return policies.find(p => p.contractId === PINNED_POLICY) ?? policies[0]
  return policies[0]
}

// ---------------------------------------------------------------------------
// Charter tool implementations (also used by the standalone demo below)
// ---------------------------------------------------------------------------

async function impl_onboard({ agentName, maxPerTx = '100.00', dailyLimit = '500.00', approvalAbove = '50.00', categories = ['api', 'compute', 'data'] }) {
  const result = await canton('/v2/commands/submit-and-wait-for-transaction', {
    commands: {
      commandId: cmdId('onboard'),
      actAs: [PARTY],
      commands: [{
        CreateCommand: {
          templateId: `${PKG}:Charter:SpendingPolicy`,
          createArguments: {
            enterprise:           PARTY,
            agent:                PARTY,
            approver:             PARTY,
            maxPerTx:             String(maxPerTx),
            dailyLimit:           String(dailyLimit),
            allowedCategories:    categories,
            requireApprovalAbove: String(approvalAbove),
            active:               true,
          },
        },
      }],
    },
  })
  const contractId = result?.transaction?.events?.[0]?.CreatedEvent?.contractId
                  ?? result?.transaction?.events?.[0]?.created?.contractId
  if (!contractId) throw new Error('Policy creation returned no contractId')
  return {
    success: true,
    agentName,
    policyId: contractId,
    party: PARTY,
    limits: { maxPerTx, dailyLimit, approvalAbove, categories },
    message: `"${agentName}" onboarded to Canton Charter. Policy ID: ${contractId}`,
  }
}

async function impl_requestPayment({ policyId, amount, vendor, category, purpose }) {
  const policies = await getActivePolicies()
  const policy = policyId
    ? policies.find(p => p.contractId === policyId)
    : pickPolicy(policies)

  if (!policy) throw new Error(
    policyId
      ? `Policy ${policyId} not found or inactive`
      : 'No active SpendingPolicy — call charter_onboard first or run: node scripts/onboard.js <name>'
  )

  const result = await canton('/v2/commands/submit-and-wait-for-transaction', {
    commands: {
      commandId: cmdId('request'),
      actAs: [PARTY],
      commands: [{
        ExerciseCommand: {
          templateId: `${PKG}:Charter:SpendingPolicy`,
          contractId: policy.contractId,
          choice: 'RequestAuthorization',
          choiceArgument: {
            amount: String(amount),
            vendor,
            category,
            purpose,
            requestedAt: new Date().toISOString(),
          },
        },
      }],
    },
  })

  const ev = result?.transaction?.events?.find(e => e.CreatedEvent)?.CreatedEvent
          ?? result?.transaction?.events?.[0]?.CreatedEvent
  const statusObj = ev?.createArgument?.status ?? {}
  const status = typeof statusObj === 'object' ? Object.keys(statusObj)[0] : statusObj
  const authId = ev?.contractId

  return {
    success: true,
    status,
    authorizationId: authId,
    amount,
    vendor,
    category,
    message: status === 'Approved'
      ? `$${amount} to ${vendor} APPROVED on-chain. Auth: ${authId}`
      : `$${amount} to ${vendor} PENDING CFO approval. Auth: ${authId}`,
  }
}

async function impl_getPolicyStatus({ policyId } = {}) {
  const policies = await getActivePolicies()
  const target = policyId
    ? policies.find(p => p.contractId === policyId)
    : pickPolicy(policies)

  if (!target) return { found: false, message: 'No active SpendingPolicy found. Run: node scripts/onboard.js <name>' }

  const p = target.payload
  return {
    found: true,
    policyId: target.contractId,
    active: p.active,
    maxPerTx: p.maxPerTx,
    dailyLimit: p.dailyLimit,
    approvalThreshold: p.requireApprovalAbove ?? 'none',
    allowedCategories: p.allowedCategories,
    totalPolicies: policies.length,
  }
}

async function impl_listAuthorizations({ status } = {}) {
  const auths = await queryACS('Charter:PaymentAuthorization')
  const filtered = status
    ? auths.filter(a => {
        const s = a.payload.status
        return (typeof s === 'object' ? Object.keys(s)[0] : s) === status
      })
    : auths

  return {
    total: filtered.length,
    authorizations: filtered.map(a => {
      const s = a.payload.status
      return {
        id: a.contractId,
        status: typeof s === 'object' ? Object.keys(s)[0] : s,
        amount: a.payload.amount,
        vendor: a.payload.vendor,
        category: a.payload.category,
        purpose: a.payload.purpose,
        requestedAt: a.payload.requestedAt,
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// Exported skill: drop these into any Claude agent (OpenClaw, etc.)
//
//   import { charterTools, runCharterTool } from './agent/index.js'
//
//   const response = await anthropic.messages.create({
//     tools: [...yourTools, ...charterTools],
//     ...
//   })
//   // in your tool_use loop:
//   if (isCharterTool(block.name)) result = await runCharterTool(block.name, block.input)
// ---------------------------------------------------------------------------

export const charterTools = [
  {
    name: 'charter_onboard',
    description: 'Onboard this AI agent to Canton Charter by creating a SpendingPolicy on-chain. Call once at startup when no policy exists. Returns a policyId that uniquely identifies this agent on the ledger.',
    input_schema: {
      type: 'object',
      properties: {
        agentName:     { type: 'string', description: 'Name of the agent, e.g. "openclaw"' },
        maxPerTx:      { type: 'string', description: 'Max USD per transaction (default "100.00")' },
        dailyLimit:    { type: 'string', description: 'Daily USD spending cap (default "500.00")' },
        approvalAbove: { type: 'string', description: 'Require CFO approval above this USD amount (default "50.00")' },
        categories:    { type: 'array', items: { type: 'string' }, description: 'Allowed spend categories, e.g. ["api","compute","data"]' },
      },
      required: ['agentName'],
    },
  },
  {
    name: 'charter_request_payment',
    description: 'Request authorization to make a payment. The Canton Charter smart contract enforces spending limits and routes large payments for CFO approval. Returns "Approved" or "PendingApproval".',
    input_schema: {
      type: 'object',
      properties: {
        policyId: { type: 'string', description: 'SpendingPolicy contract ID from charter_onboard. Omit to use the first active policy.' },
        amount:   { type: 'string', description: 'USD amount as decimal string, e.g. "42.00"' },
        vendor:   { type: 'string', description: 'Vendor name, e.g. "OpenAI"' },
        category: { type: 'string', description: 'Spend category — must be in policy allowedCategories' },
        purpose:  { type: 'string', description: 'Reason for this payment' },
      },
      required: ['amount', 'vendor', 'category', 'purpose'],
    },
  },
  {
    name: 'charter_get_policy_status',
    description: 'Check the current SpendingPolicy — limits, allowed categories, approval threshold, and active state.',
    input_schema: {
      type: 'object',
      properties: {
        policyId: { type: 'string', description: 'Specific policy contract ID. Omit to check the first active policy.' },
      },
    },
  },
  {
    name: 'charter_list_authorizations',
    description: 'List payment authorization requests on the Canton ledger, optionally filtered by status.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['Approved', 'PendingApproval', 'Rejected'], description: 'Filter by status. Omit for all.' },
      },
    },
  },
]

export function isCharterTool(name) {
  return name.startsWith('charter_')
}

export async function runCharterTool(name, input) {
  switch (name) {
    case 'charter_onboard':             return impl_onboard(input)
    case 'charter_request_payment':     return impl_requestPayment(input)
    case 'charter_get_policy_status':   return impl_getPolicyStatus(input)
    case 'charter_list_authorizations': return impl_listAuthorizations(input)
    default: throw new Error(`Unknown Charter tool: ${name}`)
  }
}

// ---------------------------------------------------------------------------
// Standalone demo — Claude runs a Q3 supply chain procurement mission
// ---------------------------------------------------------------------------

async function main() {
  console.log('Canton Charter — AI Agent\n')

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable not set.')
    process.exit(1)
  }

  // Resolve SpendingPolicy (auto-onboard if none exists)
  let policies = await getActivePolicies()
  if (policies.length === 0) {
    console.log('No active SpendingPolicy found — onboarding this agent automatically...')
    const ob = await impl_onboard({ agentName: 'charter-agent' })
    console.log(`✓ Onboarded. Policy: ${ob.policyId.slice(0, 28)}...\n`)
    policies = await getActivePolicies()
  }

  const policy = pickPolicy(policies)
  const p = policy.payload

  console.log('✓ Canton ledger authenticated')
  console.log(`✓ SpendingPolicy: ${policy.contractId.slice(0, 28)}...`)
  console.log(`  Max/tx: $${p.maxPerTx}  |  Daily: $${p.dailyLimit}`)
  console.log(`  Categories: ${(p.allowedCategories ?? []).join(', ')}`)
  if (p.requireApprovalAbove != null) console.log(`  CFO approval above: $${p.requireApprovalAbove}`)
  console.log()

  // Tool available to Claude in the demo uses the resolved policy contract
  const requestTool = {
    name: 'request_payment',
    description: `Submit a payment authorization to Canton Charter.
Policy limits — Max/tx: $${p.maxPerTx} | Categories: ${(p.allowedCategories ?? []).join(', ')}${p.requireApprovalAbove != null ? ` | CFO approval ≥ $${p.requireApprovalAbove}` : ''}`,
    input_schema: {
      type: 'object',
      properties: {
        amount:   { type: 'string', description: 'Dollar amount, e.g. "49.99"' },
        vendor:   { type: 'string', description: 'Vendor name' },
        category: { type: 'string', enum: p.allowedCategories ?? [], description: 'Expense category' },
        purpose:  { type: 'string', description: 'Why the agent needs this service' },
      },
      required: ['amount', 'vendor', 'category', 'purpose'],
    },
  }

  const anthropic = new Anthropic()

  const messages = [{
    role: 'user',
    content: 'Your procurement budget is active and the SpendingPolicy is live on-chain. Acquire the services needed for the Q3 supply chain analysis mission.',
  }]

  console.log('Starting Claude agentic loop...\n' + '─'.repeat(60))

  while (true) {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 8096,
      thinking: { type: 'adaptive' },
      system: `You are an autonomous AI procurement agent inside a Canton blockchain-governed enterprise.

Mission: Procure data feeds, compute, and API services for a Q3 2026 supply chain risk analysis.

Rules:
- Every payment must go through request_payment — no exceptions.
- Make 4–6 targeted purchases with realistic vendors and amounts.
- Stay within allowed categories and per-transaction cap.
- After all purchases, summarize your procurement rationale.`,
      tools: [requestTool],
      messages,
    })

    messages.push({ role: 'assistant', content: response.content })

    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) console.log('\nAgent:', block.text.trim())
    }

    if (response.stop_reason === 'end_turn') {
      console.log('\n' + '─'.repeat(60) + '\nAgent session complete.')
      break
    }
    if (response.stop_reason !== 'tool_use') {
      console.log(`\nUnexpected stop: ${response.stop_reason}`)
      break
    }

    const toolResults = []
    for (const block of response.content) {
      if (block.type !== 'tool_use' || block.name !== 'request_payment') continue
      const { amount, vendor, category, purpose } = block.input
      console.log(`\n→ REQUEST: $${amount} → ${vendor} [${category}]\n  ${purpose}`)
      try {
        const r = await impl_requestPayment({ policyId: policy.contractId, amount, vendor, category, purpose })
        const icon = r.status === 'Approved' ? '✓' : r.status === 'PendingApproval' ? '⏳' : '✗'
        console.log(`  ${icon} ${r.status}  (${(r.authorizationId ?? '').slice(0, 20)}...)`)
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: r.message })
      } catch (e) {
        console.log(`  ✗ ${e.message}`)
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Failed: ${e.message}`, is_error: true })
      }
    }

    if (toolResults.length > 0) messages.push({ role: 'user', content: toolResults })
  }

  console.log('\n✓ All payment requests recorded on-chain.')
  console.log('  View them in the Agent Feed: http://localhost:3000/agent\n')
}

// Only run the demo when this file is the entry point, not when imported as a module.
import { fileURLToPath } from 'url'
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('\nFatal:', e.message); process.exit(1) })
}
