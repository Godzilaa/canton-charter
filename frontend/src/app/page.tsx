'use client'
import { useState, useEffect, useCallback } from 'react'
import { exerciseChoice, queryContracts } from '@/lib/ledger'
import type { SpendingPolicy } from '@/lib/types'
import Toast from '@/components/Toast'

type ToastState = { msg: string; type: 'success' | 'error' } | null

function PolicyCard({ policy, onAction }: { policy: SpendingPolicy; onAction: () => void }) {
  const p = policy.payload
  const [busy, setBusy] = useState(false)

  async function toggle(choice: 'Deactivate' | 'Reactivate') {
    setBusy(true)
    try {
      await exerciseChoice('Charter:SpendingPolicy', policy.contractId, choice, {})
      onAction()
    } finally { setBusy(false) }
  }

  return (
    <div className="policy-card">
      <div className="policy-card-header">
        <div className="policy-card-name">AI Agent</div>
        <span className={`badge ${p.active ? 'badge-active' : 'badge-inactive'}`}>
          {p.active ? '● ACTIVE' : '○ INACTIVE'}
        </span>
      </div>
      <div className="policy-card-limits">
        Max / Tx: <strong>${p.maxPerTx}</strong><br />
        Daily: <strong>${p.dailyLimit}</strong><br />
        {p.requireApprovalAbove != null && <>Approval above: <strong>${p.requireApprovalAbove}</strong><br /></>}
        Categories: <strong>{p.allowedCategories.join(', ')}</strong>
      </div>
      <div className="policy-card-limits" style={{ marginTop: 8, fontSize: 10, color: '#999', wordBreak: 'break-all' }}>
        {policy.contractId.slice(0, 32)}...
      </div>
      <div className="policy-card-actions">
        {p.active
          ? <button className="btn btn-warn btn-sm" onClick={() => toggle('Deactivate')} disabled={busy}>⚠ Deactivate</button>
          : <button className="btn btn-sm" onClick={() => toggle('Reactivate')} disabled={busy}>↺ Reactivate</button>
        }
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [policies, setPolicies] = useState<SpendingPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<ToastState>(null)

  const loadPolicies = useCallback(async () => {
    setLoading(true)
    try {
      const data = await queryContracts<SpendingPolicy>('Charter:SpendingPolicy')
      setPolicies(data)
    } catch (e: any) {
      setToast({ msg: e.message, type: 'error' })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadPolicies() }, [loadPolicies])

  return (
    <div className="main-content" style={{ maxWidth: 720 }}>
      <div className="page-header">
        <div className="page-title">SPENDING POLICIES</div>
        <div className="page-sub">On-chain guardrails for your AI agents</div>
        <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={loadPolicies} disabled={loading}>
          ↺ Refresh
        </button>
      </div>

      {loading
        ? <div className="loading">Loading...</div>
        : policies.length === 0
        ? (
          <div className="empty-state">
            <div className="empty-msg">No policies on-chain</div>
            <div className="hint" style={{ marginTop: 8 }}>
              Run <code>node scripts/onboard.js &lt;agent-name&gt;</code> to create one.
            </div>
          </div>
        )
        : policies.map(p => <PolicyCard key={p.contractId} policy={p} onAction={loadPolicies} />)
      }

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
