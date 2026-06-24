import { NextResponse } from 'next/server'

let cache: { token: string; expiresAt: number } | null = null

export async function GET() {
  if (cache && Date.now() < cache.expiresAt) {
    return NextResponse.json({ token: cache.token })
  }

  const res = await fetch(process.env.AUTH_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.OIDC_CLIENT_ID!,
      client_secret: process.env.OIDC_CLIENT_SECRET!,
      audience: process.env.OIDC_AUDIENCE!,
      scope: 'daml_ledger_api',
    }),
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'Token fetch failed' }, { status: 502 })
  }

  const data = await res.json()
  // Cache for 7h (token expires in 8h)
  cache = { token: data.access_token, expiresAt: Date.now() + 7 * 60 * 60 * 1000 }
  return NextResponse.json({ token: cache.token })
}
