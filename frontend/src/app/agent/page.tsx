'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { queryContracts, exerciseChoice } from '@/lib/ledger'
import type { PaymentAuth, SpendingPolicy } from '@/lib/types'
import Toast from '@/components/Toast'

const STORAGE_KEY = 'charter_connected_policy'

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
  const router = useRouter()
  const searchParams = useSearchParams()

  const [connectedPolicy, setConnectedPolicy] = useState<string | null>(null)
  const [auths, setAuths] = useState<PaymentAuth[]>([])
  const [policies, setPolicies] = useState<SpendingPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<ToastState>(null)
  const [killing, setKilling] = useState(false)

  // Handshake: ?connect=<policyId> in the URL saves the policy and cleans the URL
  useEffect(() => {
    const incoming = searchParams.get('connect')
    if (incoming) {
      localStorage.setItem(STORAGE_KEY, incoming)
      setConnectedPolicy(incoming)
      router.replace('/agent')
      return
    }
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) setConnectedPolicy(saved)
  }, [searchParams, router])

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

  function disconnect() {
    localStorage.removeItem(STORAGE_KEY)
    setConnectedPolicy(null)
  }

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

  // Filter to connected agent's authorizations, or show all if disconnected
  const visibleAuths = connectedPolicy
    ? auths.filter(a => a.payload.policyId === connectedPolicy)
    : auths

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
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn" onClick={load}>↺ Refresh</button>
          {hasActive && (
            <button className="btn btn-kill" onClick={killAll} disabled={killing}>
              {killing ? 'Killing...' : '■ KILL SWITCH'}
            </button>
          )}
        </div>
      </div>

      {/* Connection status */}
      {connectedPolicy ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '10px 14px', background: '#f0faf0', border: '1px solid #b3ddb3', fontSize: 11 }}>
          <span style={{ color: '#2a7a2a', fontWeight: 700, letterSpacing: 1 }}>● CONNECTED</span>
          <span style={{ fontFamily: 'monospace', color: '#444', flex: 1 }}>
            {connectedPolicy.slice(0, 36)}...
          </span>
          <button className="btn btn-sm" onClick={disconnect} style={{ fontSize: 10 }}>Disconnect</button>
        </div>
      ) : (
        <div style={{ marginBottom: 20, padding: '10px 14px', background: '#fafafa', border: '1px solid #e0e0e0', fontSize: 11, color: '#777' }}>
          ○ No agent connected — showing all activity.{' '}
          Run <code>node scripts/onboard.js &lt;name&gt;</code> and open the connect URL to filter to your agent.
        </div>
      )}

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
        : visibleAuths.length === 0
        ? (
          <div className="empty-state">
            <div className="empty-icon">◌</div>
            <div className="empty-msg">
              {connectedPolicy ? 'No activity from this agent yet' : 'No agent activity yet'}
            </div>
          </div>
        )
        : (
          <div className="feed">
            {visibleAuths.map(a => (
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
