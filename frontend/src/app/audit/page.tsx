'use client'
import { useState, useEffect, useCallback } from 'react'
import { queryContracts } from '@/lib/ledger'
import type { PaymentRecord } from '@/lib/types'
import Toast from '@/components/Toast'

type ToastState = { msg: string; type: 'success' | 'error' } | null

export default function AuditPage() {
  const [records, setRecords] = useState<PaymentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [toast, setToast] = useState<ToastState>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await queryContracts<PaymentRecord>('Charter:PaymentRecord')
      setRecords(data.sort((a, b) => b.payload.settledAt.localeCompare(a.payload.settledAt)))
    } catch (e: any) {
      setToast({ msg: e.message, type: 'error' })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const succeeded = records.filter(r => r.payload.outcome === 'succeeded')
  const rejected  = records.filter(r => r.payload.outcome !== 'succeeded')
  const total     = succeeded.reduce((sum, r) => sum + parseFloat(r.payload.amount), 0)

  const categories = [...new Set(records.map(r => r.payload.category))]
  const filters = ['all', 'succeeded', 'rejected', ...categories]

  const visible = records.filter(r => {
    if (filter === 'all')       return true
    if (filter === 'succeeded') return r.payload.outcome === 'succeeded'
    if (filter === 'rejected')  return r.payload.outcome !== 'succeeded'
    return r.payload.category === filter
  })

  return (
    <div className="page">
      <div className="header-row">
        <div>
          <div className="page-title">AUDIT LOG</div>
          <div className="page-sub">Immutable payment records · On-chain</div>
        </div>
        <button className="btn" onClick={load}>↺ Refresh</button>
      </div>

      <div className="stats-bar cols-4">
        <div className="stat">
          <div className="stat-num">{records.length}</div>
          <div className="stat-label">Total Payments</div>
        </div>
        <div className="stat">
          <div className="stat-num" style={{ color: 'var(--green)' }}>{succeeded.length}</div>
          <div className="stat-label">Succeeded</div>
        </div>
        <div className="stat">
          <div className="stat-num" style={{ color: 'var(--red)' }}>{rejected.length}</div>
          <div className="stat-label">Rejected</div>
        </div>
        <div className="stat">
          <div className="stat-num">${total.toFixed(2)}</div>
          <div className="stat-label">Total Settled</div>
        </div>
      </div>

      <div className="filter-bar">
        {filters.map(f => (
          <button key={f} className={`filter-btn${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
            {f.toUpperCase()}
          </button>
        ))}
      </div>

      {loading
        ? <div className="loading">Loading audit log...</div>
        : visible.length === 0
        ? <div className="empty-state"><div className="empty-msg">No records found</div></div>
        : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Amount</th>
                <th>Category</th>
                <th>Purpose</th>
                <th>Settled At</th>
                <th>Outcome</th>
                <th>Tx Ref</th>
                <th>X402 Token</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={r.contractId}>
                  <td>{r.payload.vendor}</td>
                  <td className="amount">${r.payload.amount}</td>
                  <td><span className="badge badge-cat">{r.payload.category.toUpperCase()}</span></td>
                  <td>{r.payload.purpose}</td>
                  <td className="mono">{new Date(r.payload.settledAt).toLocaleString()}</td>
                  <td>
                    {r.payload.outcome === 'succeeded'
                      ? <span className="badge badge-approved">SUCCEEDED</span>
                      : <span className="badge badge-rejected">{r.payload.outcome.toUpperCase()}</span>
                    }
                  </td>
                  <td className="mono">{r.payload.txRef || '—'}</td>
                  <td className="mono">
                    {r.payload.x402Token.tag === 'Some' ? r.payload.x402Token.value.slice(0, 16) + '...' : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
