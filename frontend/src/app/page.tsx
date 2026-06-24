'use client'
import { useState, useEffect, useCallback } from 'react'
import { createContract, exerciseChoice, queryContracts } from '@/lib/ledger'
import type { SpendingPolicy } from '@/lib/types'
import Toast from '@/components/Toast'

type ToastState = { msg: string; type: 'success' | 'error' } | null

function useParties() {
  const [parties, setParties] = useState({ enterprise: '', agent: '', approver: '' })
  useEffect(() => {
    setParties({
      enterprise: localStorage.getItem('party_enterprise') ?? '',
      agent: localStorage.getItem('party_agent') ?? '',
      approver: localStorage.getItem('party_approver') ?? '',
    })
  }, [])
  const save = (k: string, v: string) => {
    localStorage.setItem(`party_${k}`, v)
    setParties(p => ({ ...p, [k]: v }))
  }
  return { parties, save }
}

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
        {p.requireApprovalAbove.tag === 'Some' && <>Approval above: <strong>${p.requireApprovalAbove.value}</strong><br /></>}
        Categories: <strong>{p.allowedCategories.join(', ')}</strong>
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
  const { parties, save } = useParties()
  const [policies, setPolicies] = useState<SpendingPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<ToastState>(null)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    maxPerTx: '100.00',
    dailyLimit: '500.00',
    approvalThreshold: '50.00',
    requireApproval: true,
    active: true,
  })
  const [categories, setCategories] = useState(['api', 'compute', 'data'])
  const [catInput, setCatInput] = useState('')

  const loadPolicies = useCallback(async () => {
    try {
      const data = await queryContracts<SpendingPolicy>('Charter:SpendingPolicy')
      setPolicies(data)
    } catch (e: any) {
      setToast({ msg: e.message, type: 'error' })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadPolicies() }, [loadPolicies])

  function addCat(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && catInput.trim()) {
      setCategories(c => [...c, catInput.trim().toLowerCase()])
      setCatInput('')
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!parties.enterprise || !parties.agent || !parties.approver) {
      setToast({ msg: 'Configure all party IDs first', type: 'error' }); return
    }
    setSubmitting(true)
    try {
      await createContract('Charter:SpendingPolicy', {
        enterprise: parties.enterprise,
        agent: parties.agent,
        approver: parties.approver,
        maxPerTx: form.maxPerTx,
        dailyLimit: form.dailyLimit,
        allowedCategories: categories,
        requireApprovalAbove: form.requireApproval
          ? { tag: 'Some', value: form.approvalThreshold }
          : { tag: 'None' },
        active: form.active,
      })
      setToast({ msg: 'Policy created on-chain', type: 'success' })
      loadPolicies()
    } catch (e: any) {
      setToast({ msg: e.message, type: 'error' })
    } finally { setSubmitting(false) }
  }

  const needsSetup = !parties.enterprise || !parties.agent || !parties.approver

  return (
    <div className="two-col">
      {/* SIDEBAR */}
      <div className="sidebar">
        <div className="sidebar-title">Active Policies</div>
        {loading
          ? <div className="loading">Loading...</div>
          : policies.length === 0
          ? <div className="empty-state"><div className="empty-msg">No policies yet</div></div>
          : policies.map(p => <PolicyCard key={p.contractId} policy={p} onAction={loadPolicies} />)
        }
      </div>

      {/* MAIN */}
      <div className="main-content">
        <div className="page-header">
          <div className="page-title">SPENDING POLICY</div>
          <div className="page-sub">Create on-chain guardrails for your AI agent</div>
        </div>

        {/* Party Setup */}
        {needsSetup && (
          <div className="setup-banner">
            <p>⚠ Configure party IDs below to interact with the ledger</p>
          </div>
        )}

        <div className="form-card" style={{ marginBottom: 32 }}>
          <div className="form-section-title" style={{ marginBottom: 16, fontSize: 9, textTransform: 'uppercase', letterSpacing: 3, color: '#777', borderBottom: '1px solid #e0e0e0', paddingBottom: 6 }}>
            Party Configuration
          </div>
          <div className="row-2">
            <div className="field">
              <label>Enterprise Party ID</label>
              <input value={parties.enterprise} onChange={e => save('enterprise', e.target.value)} placeholder="5nsandbox-devnet-2::1220..." />
            </div>
            <div className="field">
              <label>Agent Party ID</label>
              <input value={parties.agent} onChange={e => save('agent', e.target.value)} placeholder="AIAgent::1220..." />
            </div>
          </div>
          <div className="field" style={{ maxWidth: '50%' }}>
            <label>Approver (CFO) Party ID</label>
            <input value={parties.approver} onChange={e => save('approver', e.target.value)} placeholder="CFO::1220..." />
          </div>
        </div>

        {/* Policy Form */}
        <form className="form-card" onSubmit={handleCreate}>
          <div className="form-section">
            <div className="form-section-title">Limits</div>
            <div className="row-2">
              <div className="field">
                <label>Max Per Transaction ($)</label>
                <input type="number" step="0.01" min="0.01" value={form.maxPerTx}
                  onChange={e => setForm(f => ({ ...f, maxPerTx: e.target.value }))} />
              </div>
              <div className="field">
                <label>Daily Limit ($)</label>
                <input type="number" step="0.01" min="0.01" value={form.dailyLimit}
                  onChange={e => setForm(f => ({ ...f, dailyLimit: e.target.value }))} />
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">Allowed Categories</div>
            <div className="field">
              <label>Categories</label>
              <div className="tag-input">
                {categories.map(c => (
                  <span key={c} className="tag">
                    {c.toUpperCase()}
                    <span className="tag-remove" onClick={() => setCategories(cats => cats.filter(x => x !== c))}>×</span>
                  </span>
                ))}
                <input value={catInput} onChange={e => setCatInput(e.target.value)} onKeyDown={addCat} placeholder="Add + Enter" />
              </div>
              <div className="hint">Enter to add a new category</div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">Human Approval</div>
            <div className="field">
              <div className="toggle-row">
                <div className={`toggle${form.requireApproval ? ' on' : ''}`}
                  onClick={() => setForm(f => ({ ...f, requireApproval: !f.requireApproval }))} />
                <span className="toggle-label">Require CFO approval above threshold</span>
              </div>
            </div>
            {form.requireApproval && (
              <div className="field" style={{ maxWidth: '50%' }}>
                <label>Approval Threshold ($)</label>
                <input type="number" step="0.01" min="0" value={form.approvalThreshold}
                  onChange={e => setForm(f => ({ ...f, approvalThreshold: e.target.value }))} />
                <div className="hint">CFO must approve payments at or above this amount</div>
              </div>
            )}
            <div className="field" style={{ marginTop: 12 }}>
              <div className="toggle-row">
                <div className={`toggle${form.active ? ' on' : ''}`}
                  onClick={() => setForm(f => ({ ...f, active: !f.active }))} />
                <span className="toggle-label">Policy Active</span>
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Creating...' : '↗ Create Policy On-Chain'}
            </button>
            <button type="button" className="btn"
              onClick={() => { setForm({ maxPerTx: '100.00', dailyLimit: '500.00', approvalThreshold: '50.00', requireApproval: true, active: true }); setCategories(['api', 'compute', 'data']) }}>
              Reset
            </button>
          </div>
        </form>
      </div>

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
