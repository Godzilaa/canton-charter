import { NextRequest, NextResponse } from 'next/server'

async function getToken(): Promise<string> {
  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  const res = await fetch(`${base}/api/token`)
  const data = await res.json()
  return data.token
}

async function proxy(req: NextRequest, params: { path: string[] }) {
  const token = await getToken()
  const path = '/' + params.path.join('/')
  const url = `${process.env.LEDGER_URL}${path}`

  const body = req.method !== 'GET' ? await req.text() : undefined

  const upstream = await fetch(url, {
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body,
  })

  const text = await upstream.text()
  let json: unknown
  try { json = JSON.parse(text) } catch { json = { raw: text } }

  return NextResponse.json(json, { status: upstream.status })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, await params)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, await params)
}
