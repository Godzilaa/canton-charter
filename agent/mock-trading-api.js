#!/usr/bin/env node
/**
 * Mock Trading API — x402-gated market data and signal endpoints.
 *
 * Every endpoint requires upfront payment via the x402 protocol.
 * Without a payment token → HTTP 402 with machine-readable payment spec.
 * With a valid X-Payment-Token header → data + X-Receipt-Token for on-chain settlement.
 *
 * Endpoints:
 *   GET /v1/quotes/:symbol   — real-time quote  ($1.00 per call)
 *   GET /v1/signals/:symbol  — AI trade signal  ($5.00 per call)
 *
 * Standalone: node agent/mock-trading-api.js
 * Importable: import { startMockTradingApi } from './mock-trading-api.js'
 */

import http   from 'http'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const PORT = 4402

// ─── Mock market data ────────────────────────────────────────────────────────

const QUOTES = {
  BTCUSD: { price: 107_234.50, change24h: +2.31, volume24h: 48_920.5,  bid: 107_229.00, ask: 107_240.00 },
  ETHUSD: { price:   3_891.20, change24h: -0.81, volume24h: 221_043.2, bid:   3_890.00, ask:   3_892.50 },
  SOLUSD: { price:     189.45, change24h: +5.14, volume24h: 890_234.1, bid:     189.30, ask:     189.60 },
  AAPL:   { price:     214.70, change24h: +0.35, volume24h: 56_010_000, bid:    214.68, ask:    214.72 },
}

const SIGNALS = {
  BTCUSD: { signal: 'BUY',  confidence: 0.82, strength: 'STRONG',   horizon: '4h', reason: 'Momentum breakout + on-chain inflow surge' },
  ETHUSD: { signal: 'HOLD', confidence: 0.61, strength: 'WEAK',     horizon: '1d', reason: 'Range-bound, low volatility, mixed on-chain signals' },
  SOLUSD: { signal: 'BUY',  confidence: 0.78, strength: 'STRONG',   horizon: '4h', reason: 'Volume spike + validator stake increase' },
  AAPL:   { signal: 'SELL', confidence: 0.70, strength: 'MODERATE', horizon: '1d', reason: 'RSI overbought, earnings risk premium' },
}

// x402 pricing per endpoint type
const ENDPOINT_PRICING = {
  quotes:  { amount: '1.00', description: 'Real-time market quote (per symbol)' },
  signals: { amount: '5.00', description: 'AI trading signal generation (per symbol)' },
}

// ─── Receipt registry ────────────────────────────────────────────────────────
// In production this would verify the Canton PaymentAuthorization contract on-chain.
// Here we trust any non-empty token and issue a receipt the agent uses to settle.

function issueReceipt(symbol, endpoint) {
  return `rcpt_${endpoint}_${symbol}_${crypto.randomBytes(6).toString('hex')}`
}

// ─── Response helpers ────────────────────────────────────────────────────────

function send402(res, pathname, endpointType) {
  const pricing = ENDPOINT_PRICING[endpointType]
  res.writeHead(402, {
    'Content-Type': 'application/json',
    'X-Payment-Required': 'x402',
  })
  res.end(JSON.stringify({
    version: '0.1.0',
    error:   'Payment Required',
    accepts: [
      {
        scheme:      'x402',
        network:     'canton-devnet',
        payTo:       'canton://charter/SpendingPolicy',
        amount:      pricing.amount,
        currency:    'USD',
        category:    'data',
        vendor:      'MockTradingAPI/v1',
        resource:    pathname,
        description: pricing.description,
      },
    ],
  }))
}

function sendData(res, symbol, endpointType, paymentToken, payload) {
  const receipt = issueReceipt(symbol, endpointType)
  res.writeHead(200, {
    'Content-Type':       'application/json',
    'X-Receipt-Token':    receipt,
    'X-Payment-Verified': 'canton-charter',
  })
  res.end(JSON.stringify({
    symbol,
    ...payload,
    timestamp:       new Date().toISOString(),
    paidVia:         'canton-charter',
    receipt,
    authorizationId: paymentToken,
  }))
}

// ─── Route handlers ──────────────────────────────────────────────────────────

function handleQuote(req, res, symbol) {
  const token = req.headers['x-payment-token']
  if (!token) return send402(res, req.url, 'quotes')

  const data = QUOTES[symbol]
  if (!data) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: `Symbol ${symbol} not found` }))
  }
  sendData(res, symbol, 'quotes', token, { ...data, currency: 'USD' })
}

function handleSignal(req, res, symbol) {
  const token = req.headers['x-payment-token']
  if (!token) return send402(res, req.url, 'signals')

  const sig = SIGNALS[symbol]
  if (!sig) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: `No signal for ${symbol}` }))
  }
  sendData(res, symbol, 'signals', token, { ...sig, model: 'charter-signal-v2' })
}

// ─── Server ──────────────────────────────────────────────────────────────────

export function startMockTradingApi(port = PORT) {
  const server = http.createServer((req, res) => {
    const url   = new URL(req.url, `http://localhost:${port}`)
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/')

    // Expect: /v1/<endpoint>/<symbol>
    if (parts.length < 3 || parts[0] !== 'v1') {
      res.writeHead(404); return res.end()
    }
    const [, endpoint, symbol] = parts

    if      (endpoint === 'quotes')  handleQuote(req, res, symbol.toUpperCase())
    else if (endpoint === 'signals') handleSignal(req, res, symbol.toUpperCase())
    else { res.writeHead(404); res.end() }
  })

  server.listen(port, () => {
    console.log(`Mock Trading API  →  http://localhost:${port}`)
    console.log('  GET /v1/quotes/:symbol    $1.00 per call')
    console.log('  GET /v1/signals/:symbol   $5.00 per call')
    console.log()
  })

  return server
}

// Standalone entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startMockTradingApi()
  console.log('Press Ctrl+C to stop.')
}
