import type { Metadata } from 'next'
import Nav from '@/components/Nav'
import './globals.css'

export const metadata: Metadata = {
  title: 'Charter — Agentic Payments on Canton',
  description: 'On-chain spending policy enforcement and x402 payment receipts',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  )
}
