export type Optional<T> = { tag: 'Some'; value: T } | { tag: 'None' }

export type AuthStatus =
  | { tag: 'PendingApproval' }
  | { tag: 'Approved' }
  | { tag: 'Rejected' }

export interface SpendingPolicyPayload {
  enterprise: string
  agent: string
  approver: string
  maxPerTx: string
  dailyLimit: string
  allowedCategories: string[]
  requireApprovalAbove: Optional<string>
  active: boolean
}

export interface PaymentAuthPayload {
  policyId: string
  enterprise: string
  agent: string
  approver: string
  amount: string
  vendor: string
  category: string
  purpose: string
  requestedAt: string
  status: AuthStatus
}

export interface PaymentRecordPayload {
  policyId: string
  enterprise: string
  agent: string
  approver: string
  amount: string
  vendor: string
  category: string
  purpose: string
  requestedAt: string
  settledAt: string
  outcome: string
  x402Token: Optional<string>
  txRef: string
}

export interface X402ReceiptPayload {
  enterprise: string
  agent: string
  recordId: string
  apiEndpoint: string
  paymentToken: string
  amount: string
  currency: string
  network: string
  receivedAt: string
}

export interface Contract<T> {
  contractId: string
  templateId: string
  payload: T
}

export type SpendingPolicy = Contract<SpendingPolicyPayload>
export type PaymentAuth = Contract<PaymentAuthPayload>
export type PaymentRecord = Contract<PaymentRecordPayload>
export type X402Receipt = Contract<X402ReceiptPayload>
