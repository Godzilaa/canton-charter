'use client'
import { useState, useEffect, useCallback } from 'react'
import { queryContracts } from '@/lib/ledger'
import type { X402Receipt } from '@/lib/types'
import Toast from '@/components/Toast'

type ToastState = { msg: string; type: 'success' | 'error' } | null

function ReceiptCard({ r }: { r: X402Receipt }) {
  const p = r.payload
  return (
    <div className="receipt-card">
      <div className="receipt-header">
        <div className="receipt-endpoint">{p.apiEndpoint}</div>
        <span className="badge" style={{ border: '1px solid #fff', color: '#fff', fontSize: 9, padding: '2px 8px', whiteSpace: 'nowrap' }}>
          {p.network}
        </span>
      </div>
      <div className="receipt-body">
        <div className="receipt-row">
          <span className="receipt-key">Amount</span>
          <span className="receipt-val big">${p.amount}</span>
        </div>
        <div className="receipt-row">
          <span className="receipt-key">Currency</span>
          <span className="receipt-val"><span className="badge badge-usdc">{p.currency}</span></span>
        </div>
        <div className="receipt-row">
          <span className="receipt-key">Payment Token</span>
          <span className="receipt-val mono">{p.paymentToken.slice(0, 32)}...</span>
        </div>
        <div className="receipt-row">
          <span className="receipt-key">Agent</span>
          <span className="receipt-val mono">{p.agent.slice(0, 24)}...</span>
        </div>
        <div className="receipt-row">
          <span className="receipt-key">Record ID</span>
          <span className="receipt-val mono">{p.recordId.slice(0, 20)}...</span>
        </div>
        <div className="receipt-row">
          <span className="receipt-key">Received At</span>
          <span className="receipt-val mono">{new Date(p.receivedAt).toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<X402Receipt[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<ToastState>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await queryContracts<X402Receipt>('X402Adapter:X402Receipt')
      setReceipts(data.sort((a, b) => b.payload.receivedAt.localeCompare(a.payload.receivedAt)))
    } catch (e: any) {
      setToast({ msg: e.message, type: 'error' })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const totalUSDC = receipts.filter(r => r.payload.currency === 'USDC')
    .reduce((sum, r) => sum + parseFloat(r.payload.amount), 0)

  return (
    <div className="page">
      <div className="header-row">
        <div>
          <div className="page-title">X402 RECEIPTS</div>
          <div className="page-sub">On-chain HTTP 402 payment provenance · Canton</div>
        </div>
        <button className="btn" onClick={load}>↺ Refresh</button>
      </div>

      <div className="stats-bar cols-3" style={{ marginBottom: 32 }}>
        <div className="stat">
          <div className="stat-num">{receipts.length}</div>
          <div className="stat-label">Total Receipts</div>
        </div>
        <div className="stat">
          <div className="stat-num">${totalUSDC.toFixed(2)}</div>
          <div className="stat-label">USDC Settled</div>
        </div>
        <div className="stat">
          <div className="stat-num">{new Set(receipts.map(r => r.payload.network)).size}</div>
          <div className="stat-label">Networks</div>
        </div>
      </div>

      {loading
        ? <div className="loading">Loading X402 receipts...</div>
        : receipts.length === 0
        ? (
          <div className="empty-state">
            <div className="empty-icon">◌</div>
            <div className="empty-msg">No X402 receipts on-chain yet</div>
          </div>
        )
        : (
          <div className="receipt-grid">
            {receipts.map(r => <ReceiptCard key={r.contractId} r={r} />)}
          </div>
        )
      }

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
