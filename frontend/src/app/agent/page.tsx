'use client'
import { useState, useEffect, useCallback } from 'react'
import { queryContracts, exerciseChoice } from '@/lib/ledger'
import type { PaymentAuth, SpendingPolicy } from '@/lib/types'
import Toast from '@/components/Toast'

type ToastState = { msg: string; type: 'success' | 'error' } | null

function statusClass(tag: string) {
  if (tag === 'PendingApproval') return 'pending'
  if (tag === 'Approved') return 'approved'
  return 'rejected'
}

function statusBadge(tag: string) {
  if (tag === 'PendingApproval') return <span className="badge badge-pending">PENDING</span>
  if (tag === 'Approved') return <span className="badge badge-approved">APPROVED</span>
  return <span className="badge badge-rejected">REJECTED</span>
}

export default function AgentFeedPage() {
  const [auths, setAuths] = useState<PaymentAuth[]>([])
  const [policies, setPolicies] = useState<SpendingPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<ToastState>(null)
  const [killing, setKilling] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [a, p] = await Promise.all([
        queryContracts<PaymentAuth>('Charter:PaymentAuthorization'),
        queryContracts<SpendingPolicy>('Charter:SpendingPolicy'),
      ])
      setAuths(a.sort((x, y) => y.payload.requestedAt.localeCompare(x.payload.requestedAt)))
      setPolicies(p)
    } catch (e: any) {
      setToast({ msg: e.message, type: 'error' })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 10000)
    return () => clearInterval(interval)
  }, [load])

  async function killAll() {
    const active = policies.filter(p => p.payload.active)
    if (active.length === 0) { setToast({ msg: 'No active policies to deactivate', type: 'error' }); return }
    setKilling(true)
    try {
      await Promise.all(
        active.map(p => exerciseChoice('Charter:SpendingPolicy', p.contractId, 'Deactivate', {}))
      )
      setToast({ msg: `${active.length} policy(ies) killed`, type: 'success' })
      load()
    } catch (e: any) {
      setToast({ msg: e.message, type: 'error' })
    } finally { setKilling(false) }
  }

  const hasActive = policies.some(p => p.payload.active)

  return (
    <div className="page">
      <div className="header-row">
        <div>
          <div className="page-title">AGENT FEED</div>
          <div className="page-sub">
            <span className="live-dot" />
            <span className="live-label">Auto-refresh every 10s · Canton ledger</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn" onClick={load}>↺ Refresh</button>
          {hasActive && (
            <button className="btn btn-kill" onClick={killAll} disabled={killing}>
              {killing ? 'Killing...' : '■ KILL SWITCH'}
            </button>
          )}
        </div>
      </div>

      {!hasActive && policies.length > 0 && (
        <div className="kill-banner">
          <p>■ All policies deactivated — agent is fully blocked</p>
          <button className="btn" style={{ borderColor: '#fff', color: '#fff', background: 'transparent' }}
            onClick={async () => {
              await Promise.all(policies.map(p => exerciseChoice('Charter:SpendingPolicy', p.contractId, 'Reactivate', {})))
              load()
            }}>
            Reactivate
          </button>
        </div>
      )}

      {loading
        ? <div className="loading">Loading agent activity...</div>
        : auths.length === 0
        ? (
          <div className="empty-state">
            <div className="empty-icon">◌</div>
            <div className="empty-msg">No agent activity yet</div>
          </div>
        )
        : (
          <div className="feed">
            {auths.map(a => (
              <div key={a.contractId} className={`feed-item ${statusClass(a.payload.status.tag)}`}>
                <div className="feed-time">
                  {new Date(a.payload.requestedAt).toLocaleTimeString()}<br />
                  {new Date(a.payload.requestedAt).toLocaleDateString()}
                </div>
                <div>
                  <div className="feed-vendor">{a.payload.vendor}</div>
                  <div className="feed-amount">${a.payload.amount}</div>
                </div>
                <div className="feed-meta">
                  <span className="badge badge-cat">{a.payload.category.toUpperCase()}</span><br />
                  {a.payload.purpose}
                </div>
                <div>{statusBadge(a.payload.status.tag)}</div>
                <div>
                  <span className={`x402-tag${a.payload.status.tag === 'Approved' ? ' confirmed' : ''}`}>
                    {a.payload.status.tag === 'Approved' ? 'X402 ✓' : 'X402 —'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )
      }

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
