'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/',          label: 'Dashboard' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/agent',     label: 'Agent Feed' },
  { href: '/audit',     label: 'Audit Log' },
  { href: '/receipts',  label: 'X402 Receipts' },
  { href: '/skill',     label: 'Skill' },
]

export default function Nav() {
  const path = usePathname()
  return (
    <nav className="nav">
      <Link href="/" className="nav-logo">CHARTER</Link>
      <div className="nav-links">
        {links.map(l => (
          <Link
            key={l.href}
            href={l.href}
            className={`nav-link${path === l.href ? ' active' : ''}`}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
