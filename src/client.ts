/**
 * Thin client for the NRS e-invoicing gateway.
 *
 * Status: written from published provider documentation, not yet exercised
 * against the sandbox with real credentials. Treat every path as "best known"
 * until you have run `clear()` end to end. Please open an issue with what the
 * gateway actually returned.
 *
 * Credentials (API key, API secret, public key, certificate, business id,
 * service id) come from the taxpayer's own NRS dashboard. This client cannot
 * obtain them for you.
 */
import type { Invoice, PaymentStatus } from './types.ts';
import type { ResourceName } from './resources.ts';

export const SANDBOX_URL = 'https://eivc-k6z6d.ondigitalocean.app';
export const PRODUCTION_URL = 'https://einvoice1.firs.gov.ng';

export interface MbsClientOptions {
  /** Defaults to the sandbox. */
  baseUrl?: string;
  apiKey: string;
  apiSecret: string;
  /** Inject for tests. Defaults to global fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

export class MbsApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly path: string;
  constructor(path: string, status: number, body: unknown) {
    super(`${path} returned HTTP ${status}: ${summarise(body)}`);
    this.name = 'MbsApiError';
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

function summarise(body: unknown): string {
  if (typeof body === 'string') return body.slice(0, 300);
  try {
    return JSON.stringify(body).slice(0, 300);
  } catch {
    return String(body);
  }
}

export interface IrnValidateRequest {
  business_id: string;
  invoice_reference: string;
  irn: string;
}

export interface ClearanceResult {
  irnValidation: ApiResponse;
  validation: ApiResponse;
  sign: ApiResponse;
  confirm: ApiResponse;
}

export class MbsClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: MbsClientOptions) {
    if (!opts.apiKey || !opts.apiSecret) throw new Error('apiKey and apiSecret are required. They are issued on the NRS dashboard.');
    this.baseUrl = (opts.baseUrl ?? SANDBOX_URL).replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.apiSecret = opts.apiSecret;
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async request<T = unknown>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<ApiResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'x-api-key': this.apiKey,
          'x-api-secret': this.apiSecret,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = text.length ? JSON.parse(text) : null;
      } catch {
        /* keep raw text */
      }
      if (!res.ok) throw new MbsApiError(path, res.status, parsed);
      return { status: res.status, body: parsed as T };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Step 1. Checks the IRN is well formed and unused for this business. */
  validateIrn(req: IrnValidateRequest): Promise<ApiResponse> {
    return this.request('POST', '/api/v1/invoice/irn/validate', req);
  }

  /** Step 2. Schema and business-rule validation on the gateway. */
  validateInvoice(invoice: Invoice): Promise<ApiResponse> {
    return this.request('POST', '/api/v1/invoice/validate', invoice);
  }

  /** Step 3. Clearance. The gateway signs and registers the invoice. */
  signInvoice(invoice: Invoice): Promise<ApiResponse> {
    return this.request('POST', '/api/v1/invoice/sign', invoice);
  }

  /** Step 4. Transmission and delivery status for a cleared invoice. */
  confirm(irn: string): Promise<ApiResponse> {
    return this.request('GET', `/api/v1/invoice/confirm/${encodeURIComponent(irn)}`);
  }

  download(irn: string): Promise<ApiResponse> {
    return this.request('GET', `/api/v1/invoice/download/${encodeURIComponent(irn)}`);
  }

  updatePaymentStatus(irn: string, payment_status: PaymentStatus): Promise<ApiResponse> {
    return this.request('PATCH', `/api/v1/invoice/update/${encodeURIComponent(irn)}`, { payment_status });
  }

  resource(name: ResourceName): Promise<unknown> {
    return this.request('GET', `/api/v1/invoice/resources/${name}`).then((r) => r.body);
  }

  /** Runs the four-step flow in order and stops at the first failure. */
  async clear(invoice: Invoice): Promise<ClearanceResult> {
    const invoiceNumber = invoice.irn.split('-')[0];
    const irnValidation = await this.validateIrn({ business_id: invoice.business_id, invoice_reference: invoiceNumber, irn: invoice.irn });
    const validation = await this.validateInvoice(invoice);
    const sign = await this.signInvoice(invoice);
    const confirm = await this.confirm(invoice.irn);
    return { irnValidation, validation, sign, confirm };
  }
}
