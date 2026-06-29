'use client'

const BASE  = '/api/ledger'
const PKG   = '7609a6c39916b5002ba39f9e487018070a6b0135ab768322d2c9dac0df973fde'
const PARTY = '14::1220a14ca128063b8dc9d1ebb0bd22633be9f2168500f4dbc1ecaeb1855b14e5acf8'

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
  if (typeof window === 'undefined') return PARTY
  return localStorage.getItem('party_enterprise') ?? PARTY
}

let cmdSeq = 0
function commandId() {
  return `charter-cmd-${Date.now()}-${++cmdSeq}`
}

export async function queryContracts<T>(shortTemplateId: string): Promise<T[]> {
  const party = actingParty()
  const { offset } = await req<{ offset: number }>('/v2/state/ledger-end', undefined, 'GET')
  const body = {
    filter: {
      filtersByParty: {
        [party]: {
          inclusive: {
            templateFilters: [{ templateId: templateId(shortTemplateId) }],
          },
        },
      },
    },
    verbose: true,
    activeAtOffset: offset,
  }
  const tid = templateId(shortTemplateId)
  const data = await req<unknown[]>('/v2/state/active-contracts', body)
  return (Array.isArray(data) ? data : [])
    .filter((item: any) => item?.contractEntry?.JsActiveContract)
    .map((item: any) => {
      const ev = item.contractEntry.JsActiveContract.createdEvent
      return {
        contractId: ev.contractId,
        templateId: ev.templateId,
        payload: ev.createArgument ?? ev.createArguments,
      }
    })
    .filter((item: any) => item.templateId === tid) as T[]
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
