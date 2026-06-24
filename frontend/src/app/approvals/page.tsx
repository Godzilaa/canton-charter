'use client'
import { useState, useEffect, useCallback } from 'react'
import { queryContracts, exerciseChoice } from '@/lib/ledger'
import type { PaymentAuth } from '@/lib/types'
import Toast from '@/components/Toast'

type ToastState = { msg: string; type: 'success' | 'error' } | null

function ApprovalCard({
  auth,
  onAction,
  setToast,
}: {
  auth: PaymentAuth
  onAction: () => void
  setToast: (t: ToastState) => void
}) {
  const p = auth.payload
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)

  async function approve() {
    setBusy('approve')
    try {
      await exerciseChoice('Charter:PaymentAuthorization', auth.contractId, 'Approve', {})
      setToast({ msg: 'Payment approved', type: 'success' })
      onAction()
    } catch (e: any) {
      setToast({ msg: e.message, type: 'error' })
    } finally { setBusy(null) }
  }

  async function reject() {
    if (!reason.trim()) { setToast({ msg: 'Rejection reason required', type: 'error' }); return }
    setBusy('reject')
    try {
      await exerciseChoice('Charter:PaymentAuthorization', auth.contractId, 'Reject', { rejectionReason: reason })
      setToast({ msg: 'Payment rejected', type: 'success' })
      onAction()
    } catch (e: any) {
      setToast({ msg: e.message, type: 'error' })
    } finally { setBusy(null) }
  }

  return (
    <div className="approval-card">
      <div className="approval-card-header">
        <div className="approval-vendor">{p.vendor}</div>
        <div className="approval-amount">${p.amount}</div>
      </div>
      <div className="approval-body">
        <div>
          <div className="detail-label">Category</div>
          <div className="detail-value"><span className="badge badge-cat">{p.category.toUpperCase()}</span></div>
        </div>
        <div>
          <div className="detail-label">Purpose</div>
          <div className="detail-value">{p.purpose}</div>
        </div>
        <div>
          <div className="detail-label">Requested</div>
          <div className="detail-value mono">{new Date(p.requestedAt).toLocaleString()}</div>
        </div>
        <div>
          <div className="detail-label">Agent</div>
          <div className="detail-value mono">{p.agent.slice(0, 24)}...</div>
        </div>
        <div>
          <div className="detail-label">Status</div>
          <div className="detail-value">
            <span className="badge badge-lg badge-pending">PENDING APPROVAL</span>
          </div>
        </div>
        <div>
          <div className="detail-label">Contract ID</div>
          <div className="detail-value mono">{auth.contractId.slice(0, 20)}...</div>
        </div>
      </div>
      <div className="approval-actions">
        <button className="btn btn-approve" onClick={approve} disabled={busy !== null}>
          {busy === 'approve' ? '...' : '✓ Approve'}
        </button>
        <input
          className="reject-reason"
          placeholder="Rejection reason (required to reject)..."
          value={reason}
          onChange={e => setReason(e.target.value)}
        />
        <button className="btn btn-reject" onClick={reject} disabled={busy !== null}>
          {busy === 'reject' ? '...' : '✗ Reject'}
        </button>
      </div>
    </div>
  )
}

export default function ApprovalsPage() {
  const [auths, setAuths] = useState<PaymentAuth[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<ToastState>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const all = await queryContracts<PaymentAuth>('Charter:PaymentAuthorization')
      setAuths(all.filter(a => a.payload.status.tag === 'PendingApproval'))
    } catch (e: any) {
      setToast({ msg: e.message, type: 'error' })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="page">
      <div className="header-row">
        <div>
          <div className="page-title">CFO APPROVALS</div>
          <div className="page-sub">Pending human sign-off · Live ledger</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {auths.length > 0 && (
            <div style={{ fontSize: 48, fontWeight: 900, color: 'var(--red)', border: '3px solid var(--red)', padding: '4px 20px' }}>
              {auths.length}
            </div>
          )}
          <button className="btn" onClick={load}>↺ Refresh</button>
        </div>
      </div>

      {loading
        ? <div className="loading">Loading pending approvals...</div>
        : auths.length === 0
        ? (
          <div className="empty-state">
            <div className="empty-icon">✓</div>
            <div className="empty-msg">No pending approvals</div>
          </div>
        )
        : auths.map(a => (
          <ApprovalCard key={a.contractId} auth={a} onAction={load} setToast={setToast} />
        ))
      }

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
