#!/usr/bin/env node
/**
 * Canton Charter × x402 — Trading API demo
 *
 * Runs the complete machine-to-machine payment flow:
 *   Agent → 402 → Canton RequestAuthorization → retry → Execute → PaymentRecord
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node agent/trading-demo.js
 *
 * (ANTHROPIC_API_KEY is only needed if you run the full AI agent via index.js.
 *  This demo exercises Canton directly, so the key is not required here.)
 */

import { startMockTradingApi } from './mock-trading-api.js'
import { x402Fetch } from './x402.js'

const API = 'http://localhost:4402'

async function fetchAndPrint(label, url) {
  console.log(`\n┌─ ${label}`)
  console.log(`│  GET ${url.replace(API, '')}`)
  const { data, onChain } = await x402Fetch(url)

  // Print data fields
  const keys = Object.keys(data).filter(k => !['timestamp', 'paidVia', 'receipt', 'authorizationId', 'model', 'currency'].includes(k))
  for (const k of keys) {
    console.log(`│  ${k}: ${JSON.stringify(data[k])}`)
  }

  if (onChain) {
    console.log(`│`)
    console.log(`│  ─ On-chain settlement ─`)
    console.log(`│  PaymentAuth : ${onChain.authorizationId?.slice(0, 32)}... [${onChain.authStatus}]`)
    console.log(`│  PaymentRec  : ${onChain.paymentRecordId?.slice(0, 32) ?? '(pending CFO approval)'}${onChain.paymentRecordId ? '...' : ''}`)
    console.log(`│  API receipt : ${onChain.receiptToken}`)
  }
  console.log('└─')
  return { data, onChain }
}

async function main() {
  console.log('Canton Charter × x402  ─  Trading API Payment Demo')
  console.log('═'.repeat(55))
  console.log()
  console.log('What you are about to see:')
  console.log('  1. Agent requests market data / signals from a paywall API')
  console.log('  2. API returns HTTP 402 with an x402 payment spec')
  console.log('  3. x402 layer calls RequestAuthorization on Canton')
  console.log('     SpendingPolicy — DAML enforces limits on-chain')
  console.log('  4. Authorization ID sent as X-Payment-Token → API unlocks')
  console.log('  5. Execute choice called → PaymentRecord created on Canton')
  console.log('     (immutable audit log with the API receipt embedded)')
  console.log()

  const server = startMockTradingApi()
  await new Promise(r => setTimeout(r, 80))  // let server bind

  // ── Round 1: BTCUSD ──────────────────────────────────────────────────────
  console.log('Round 1 — BTCUSD\n' + '─'.repeat(55))
  const btcQuote  = await fetchAndPrint('Quote   $1.00', `${API}/v1/quotes/BTCUSD`)
  const btcSignal = await fetchAndPrint('Signal  $5.00', `${API}/v1/signals/BTCUSD`)

  // ── Round 2: ETHUSD ──────────────────────────────────────────────────────
  console.log('\nRound 2 — ETHUSD\n' + '─'.repeat(55))
  const ethQuote  = await fetchAndPrint('Quote   $1.00', `${API}/v1/quotes/ETHUSD`)
  const ethSignal = await fetchAndPrint('Signal  $5.00', `${API}/v1/signals/ETHUSD`)

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(55))
  console.log('Session summary')
  console.log('─'.repeat(55))

  const results = [
    ['BTCUSD quote',  btcQuote],
    ['BTCUSD signal', btcSignal],
    ['ETHUSD quote',  ethQuote],
    ['ETHUSD signal', ethSignal],
  ]

  let total = 0
  for (const [label, r] of results) {
    const amt = parseFloat(r.onChain?.amount ?? 0)
    total += amt
    const settled = r.onChain?.paymentRecordId ? '✓ settled' : '⏳ pending'
    console.log(`  $${String(amt.toFixed(2)).padStart(5)}  ${label.padEnd(20)}  ${settled}`)
  }
  console.log(`  ${'─'.repeat(5)}`)
  console.log(`  $${total.toFixed(2).padStart(5)}  total`)

  console.log()
  console.log('View all on-chain:')
  console.log('  PaymentAuthorizations → http://localhost:3000/agent')
  console.log('  Dashboard             → http://localhost:3000')

  server.close()
}

main().catch(e => { console.error('\nFatal:', e.message, '\n', e.stack); process.exit(1) })
