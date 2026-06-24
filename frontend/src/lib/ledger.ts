'use client'

const BASE = '/api/ledger'

async function req<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok || json.status >= 400) {
    throw new Error(json.errors?.[0] ?? json.error ?? 'Ledger API error')
  }
  return json.result ?? json
}

export async function queryContracts<T>(templateId: string): Promise<T[]> {
  const data = await req<{ result: T[] }>('/v1/query', { templateIds: [templateId] })
  return (data as any).result ?? []
}

export async function createContract(templateId: string, payload: unknown) {
  return req('/v1/create', { templateId, payload })
}

export async function exerciseChoice(
  templateId: string,
  contractId: string,
  choice: string,
  argument: unknown = {}
) {
  return req('/v1/exercise', { templateId, contractId, choice, argument })
}
