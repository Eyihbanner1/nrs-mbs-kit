/**
 * Reference data ("resources") from the NRS gateway: invoice types, tax
 * categories, currencies, states, LGAs, HS codes, ISIC service codes, and so on.
 *
 * The lists are large and need a taxpayer API key to fetch, so this module does
 * not ship them. It ships a loader, a snapshot format you can commit to your own
 * repo, and a small example snapshot with the handful of codes seen in public
 * documentation. Fetch a real snapshot once and pass it to `validate()`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { MbsClient } from './client.ts';

export interface InvoiceTypeEntry {
  code: string;
  value: string;
}
export interface TaxCategoryEntry {
  code: string;
  value?: string;
  /** Number, or a string such as "7.5" or "Not Available" as the gateway returns it. */
  percent?: number | string;
}
export interface CurrencyEntry {
  code: string;
  name?: string;
  decimal_digits?: number;
}
export interface PaymentMeansEntry {
  code: string;
  value: string;
}
export interface StateEntry {
  code: string;
  name: string;
}
export interface LgaEntry {
  code: string;
  name: string;
  state_code: string;
}
export interface HsCodeEntry {
  hscode: string;
  description?: string;
}
export interface ServiceCodeEntry {
  code: string;
  description?: string;
}

export interface ResourceSnapshot {
  fetched_at?: string;
  base_url?: string;
  /** Free text. The example snapshot uses it to say it is incomplete. */
  note?: string;
  invoice_types?: InvoiceTypeEntry[];
  tax_categories?: TaxCategoryEntry[];
  currencies?: CurrencyEntry[];
  payment_means?: PaymentMeansEntry[];
  states?: StateEntry[];
  lgas?: LgaEntry[];
  hs_codes?: HsCodeEntry[];
  service_codes?: ServiceCodeEntry[];
  vat_exemptions?: unknown[];
  countries?: unknown[];
}

/** Resource path segments under /api/v1/invoice/resources/ and the snapshot key each fills. */
export const RESOURCE_MAP = {
  'invoice-types': 'invoice_types',
  'tax-categories': 'tax_categories',
  currencies: 'currencies',
  'payment-means': 'payment_means',
  states: 'states',
  lgas: 'lgas',
  'hs-codes': 'hs_codes',
  'services-codes': 'service_codes',
  'vat-exemptions': 'vat_exemptions',
  countries: 'countries',
} as const;

export type ResourceName = keyof typeof RESOURCE_MAP;

function unwrap(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data)) {
    return (body as { data: unknown[] }).data;
  }
  return [];
}

/** Fetches every resource list from the gateway. Needs a client with real credentials. */
export async function fetchSnapshot(client: MbsClient, names: ResourceName[] = Object.keys(RESOURCE_MAP) as ResourceName[]): Promise<ResourceSnapshot> {
  const snap: ResourceSnapshot = { fetched_at: new Date().toISOString(), base_url: client.baseUrl };
  for (const name of names) {
    const body = await client.resource(name);
    (snap as Record<string, unknown>)[RESOURCE_MAP[name]] = unwrap(body);
  }
  return snap;
}

export function loadSnapshot(path: string): ResourceSnapshot {
  return JSON.parse(readFileSync(path, 'utf8')) as ResourceSnapshot;
}

export function saveSnapshot(path: string, snapshot: ResourceSnapshot): void {
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + '\n');
}

/** The bundled example subset. Good for tests and demos, not for real invoices. */
export function loadExampleSnapshot(): ResourceSnapshot {
  const url = new URL('../data/examples.snapshot.json', import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as ResourceSnapshot;
}

/** Lookup helpers. Each returns undefined when the snapshot has no list for it. */

export function hasInvoiceType(snap: ResourceSnapshot, code: string): boolean | undefined {
  return snap.invoice_types ? snap.invoice_types.some((t) => t.code === code) : undefined;
}

export type InvoiceTypeMeaning = 'invoice' | 'credit-note' | 'debit-note' | 'other';

/**
 * Reads the meaning of an invoice type from the snapshot's own description text.
 * Published documents disagree on which code is "Commercial Invoice" and which
 * is "Credit Note", so the number alone is never trusted.
 */
export function invoiceTypeMeaning(snap: ResourceSnapshot, code: string): InvoiceTypeMeaning | undefined {
  const entry = snap.invoice_types?.find((t) => t.code === code);
  if (!entry) return undefined;
  const v = entry.value.toLowerCase();
  if (v.includes('credit')) return 'credit-note';
  if (v.includes('debit')) return 'debit-note';
  if (v.includes('invoice')) return 'invoice';
  return 'other';
}

export function taxCategoryRate(snap: ResourceSnapshot, id: string): number | undefined {
  const entry = snap.tax_categories?.find((t) => t.code === id);
  if (!entry) return undefined;
  const n = typeof entry.percent === 'number' ? entry.percent : Number(entry.percent);
  return Number.isFinite(n) ? n : undefined;
}

export function hasTaxCategory(snap: ResourceSnapshot, id: string): boolean | undefined {
  return snap.tax_categories ? snap.tax_categories.some((t) => t.code === id) : undefined;
}

export function hasCurrency(snap: ResourceSnapshot, code: string): boolean | undefined {
  return snap.currencies ? snap.currencies.some((c) => c.code === code) : undefined;
}

export function hasPaymentMeans(snap: ResourceSnapshot, code: string): boolean | undefined {
  return snap.payment_means ? snap.payment_means.some((p) => p.code === code) : undefined;
}

export function hasState(snap: ResourceSnapshot, code: string): boolean | undefined {
  return snap.states ? snap.states.some((s) => s.code === code) : undefined;
}

export function hasLga(snap: ResourceSnapshot, code: string): boolean | undefined {
  return snap.lgas ? snap.lgas.some((l) => l.code === code) : undefined;
}

export function hasHsCode(snap: ResourceSnapshot, code: string): boolean | undefined {
  return snap.hs_codes ? snap.hs_codes.some((h) => h.hscode === code) : undefined;
}

export function hasServiceCode(snap: ResourceSnapshot, code: string): boolean | undefined {
  return snap.service_codes ? snap.service_codes.some((s) => s.code === code) : undefined;
}
