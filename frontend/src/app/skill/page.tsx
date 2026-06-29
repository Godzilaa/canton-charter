'use client'
import { useState, useEffect } from 'react'

export default function SkillPage() {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/skill')
      .then(r => r.text())
      .then(t => { setCode(t); setLoading(false) })
      .catch(() => { setCode('// Failed to load skill file'); setLoading(false) })
  }, [])

  async function copy() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="main-content" style={{ maxWidth: 900 }}>
      <div className="page-header">
        <div className="page-title">CHARTER SKILL</div>
        <div className="page-sub">
          Drop this file into your agent to give it Canton Charter payment capabilities.
        </div>
      </div>

      <div className="form-card" style={{ marginBottom: 24 }}>
        <div className="form-section-title" style={{ marginBottom: 8 }}>How to use</div>
        <div style={{ fontSize: 12, lineHeight: 1.8, color: '#444' }}>
          <strong>1.</strong> Copy the file below and save it as <code>charter-skill.js</code> in your agent project.<br />
          <strong>2.</strong> Run <code>node scripts/onboard.js &lt;your-agent-name&gt;</code> to create your spending policy and get your env vars.<br />
          <strong>3.</strong> Add the Charter tools to your agent:
        </div>
        <pre style={{ marginTop: 12, background: '#f5f5f5', padding: '12px 16px', fontSize: 11, borderRadius: 2, overflowX: 'auto', border: '1px solid #e0e0e0' }}>{`import { charterTools, runCharterTool, isCharterTool } from './charter-skill.js'

// Add to your messages.create() call:
tools: [...yourTools, ...charterTools]

// In your tool_use loop:
if (isCharterTool(block.name)) {
  const result = await runCharterTool(block.name, block.input)
}`}</pre>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 3, color: '#777' }}>
          agent/index.js
        </div>
        <button className="btn btn-sm" onClick={copy} disabled={loading}>
          {copied ? '✓ Copied' : 'Copy file'}
        </button>
      </div>

      <div style={{ position: 'relative' }}>
        {loading
          ? <div className="loading">Loading...</div>
          : (
            <pre style={{
              background: '#111',
              color: '#e8e8e8',
              padding: '20px 24px',
              fontSize: 11,
              lineHeight: 1.6,
              overflowX: 'auto',
              overflowY: 'auto',
              maxHeight: '70vh',
              border: '1px solid #333',
              borderRadius: 2,
              margin: 0,
            }}>
              {code}
            </pre>
          )
        }
      </div>
    </div>
  )
}
