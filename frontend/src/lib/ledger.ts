'use client'

const BASE = '/api/ledger'
const PKG  = '7609a6c39916b5002ba39f9e487018070a6b0135ab768322d2c9dac0df973fde'

function templateId(shortId: string) {
  // shortId: "Charter:SpendingPolicy" or "X402Adapter:X402Receipt"
  return `${PKG}:${shortId}`
}

async function req<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: body !== undefined ? method : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(json.cause ?? json.errors?.[0] ?? json.error ?? 'Ledger API error')
  }
  return json
}

function actingParty(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('party_enterprise') ?? ''
}

let cmdSeq = 0
function commandId() {
  return `charter-cmd-${Date.now()}-${++cmdSeq}`
}

export async function queryContracts<T>(shortTemplateId: string): Promise<T[]> {
  const body = {
    filter: {
      filtersForAnyParty: {
        inclusive: {
          templateFilters: [{ templateId: templateId(shortTemplateId) }],
        },
      },
    },
    verbose: true,
  }
  const data = await req<unknown[]>('/v2/state/active-contracts', body)
  return (Array.isArray(data) ? data : []).map((item: any) => ({
    contractId: item.contractId ?? item.ContractId,
    templateId: item.templateId ?? item.TemplateId,
    payload: item.createArgument ?? item.createArguments ?? item.payload,
  })) as T[]
}

export async function createContract(shortTemplateId: string, payload: unknown) {
  const party = actingParty()
  return req('/v2/commands/submit-and-wait-for-transaction', {
    commands: {
      commandId: commandId(),
      actAs: [party],
      commands: [{
        CreateCommand: {
          templateId: templateId(shortTemplateId),
          createArguments: payload,
        },
      }],
    },
  })
}

export async function exerciseChoice(
  shortTemplateId: string,
  contractId: string,
  choice: string,
  argument: unknown = {}
) {
  const party = actingParty()
  return req('/v2/commands/submit-and-wait-for-transaction', {
    commands: {
      commandId: commandId(),
      actAs: [party],
      commands: [{
        ExerciseCommand: {
          templateId: templateId(shortTemplateId),
          contractId,
          choice,
          choiceArgument: argument,
        },
      }],
    },
  })
}
