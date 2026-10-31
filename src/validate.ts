/**
 * Offline validator for the NRS invoice JSON.
 *
 * Every check here is derived from published provider documentation and the
 * gateway's documented rules. It catches the mistakes that get invoices rejected
 * before you spend a sandbox call. It is not a substitute for the gateway's own
 * `/validate` endpoint, which is the final word.
 *
 * Pass a resources snapshot to also check codes (invoice type, tax category,
 * currency, state, LGA, HS, ISIC) against the gateway's lists.
 */
import type { Invoice, InvoiceLine, Issue, Party, ValidationResult } from './types.ts';
import { explainIrn, irnMatchesIssueDate } from './irn.ts';
import {
  hasCurrency,
  hasHsCode,
  hasInvoiceType,
  hasLga,
  hasPaymentMeans,
  hasServiceCode,
  hasState,
  hasTaxCategory,
  invoiceTypeMeaning,
  taxCategoryRate,
  type ResourceSnapshot,
} from './resources.ts';

export interface ValidateOptions {
  /** Reference lists from the gateway. Enables code checks. */
  resources?: ResourceSnapshot;
  /** Money comparisons allow this much difference. Default 0.01 (one kobo). */
  tolerance?: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{2}:\d{2}:\d{2}$/;
const E164 = /^\+[1-9]\d{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HS_CODE = /^\d{4}\.\d{2}$/;
const ISIC_CODE = /^\d{4}$/;
const STATE_NG = /^NG-[A-Z]{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
const KINDS = new Set(['B2B', 'B2C', 'B2G', 'G2B']);
const PAYMENT_STATUSES = new Set(['PENDING', 'PAID', 'REJECTED']);

type Rec = Record<string, unknown>;

function isObj(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}
function isMoney(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isRealIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function isRealIsoTime(s: string): boolean {
  if (!ISO_TIME.test(s)) return false;
  const [h, m, sec] = s.split(':').map(Number);
  return h < 24 && m < 60 && sec < 60;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

class Collector {
  readonly errors: Issue[] = [];
  readonly warnings: Issue[] = [];
  error(code: string, path: string, message: string): void {
    this.errors.push({ code, path, message, severity: 'error' });
  }
  warn(code: string, path: string, message: string): void {
    this.warnings.push({ code, path, message, severity: 'warning' });
  }
  result(): ValidationResult {
    return { ok: this.errors.length === 0, errors: this.errors, warnings: this.warnings };
  }
}

export function validate(input: unknown, opts: ValidateOptions = {}): ValidationResult {
  const c = new Collector();
  const tol = opts.tolerance ?? 0.01;
  const res = opts.resources;

  if (!isObj(input)) {
    c.error('invoice.shape', '', 'The invoice must be a JSON object with the fields listed in the README.');
    return c.result();
  }
  const inv = input as Partial<Invoice> & Rec;

  // Required scalar fields.
  const required: (keyof Invoice)[] = ['business_id', 'irn', 'issue_date', 'issue_time', 'invoice_type_code', 'invoice_kind', 'document_currency_code'];
  for (const f of required) {
    if (!isNonEmptyString(inv[f])) c.error('field.required', f, `"${f}" is required and must be a non-empty text value.`);
  }

  // Dates and times.
  if (isNonEmptyString(inv.issue_date) && !isRealIsoDate(inv.issue_date)) {
    c.error('date.format', 'issue_date', `issue_date must be a real date in YYYY-MM-DD form, for example 2026-10-31. Got "${inv.issue_date}".`);
  }
  if (isNonEmptyString(inv.issue_time) && !isRealIsoTime(inv.issue_time)) {
    c.error('time.format', 'issue_time', `issue_time must be HH:MM:SS using a 24-hour clock, for example 14:05:00. Got "${inv.issue_time}".`);
  }
  for (const f of ['due_date', 'tax_point_date', 'actual_delivery_date'] as const) {
    const v = inv[f];
    if (v !== undefined && (typeof v !== 'string' || !isRealIsoDate(v))) {
      c.error('date.format', f, `${f} must be a real date in YYYY-MM-DD form. Got "${String(v)}".`);
    }
  }
  if (typeof inv.due_date === 'string' && typeof inv.issue_date === 'string' && isRealIsoDate(inv.due_date) && isRealIsoDate(inv.issue_date) && inv.due_date < inv.issue_date) {
    c.error('date.order', 'due_date', `due_date (${inv.due_date}) is before issue_date (${inv.issue_date}). The due date must be on or after the issue date.`);
  }
  const period = inv.invoice_delivery_period;
  if (period !== undefined) {
    if (!isObj(period) || typeof period.start_date !== 'string' || typeof period.end_date !== 'string' || !isRealIsoDate(period.start_date) || !isRealIsoDate(period.end_date)) {
      c.error('date.format', 'invoice_delivery_period', 'invoice_delivery_period needs start_date and end_date, both YYYY-MM-DD.');
    } else if (period.end_date < period.start_date) {
      c.error('date.order', 'invoice_delivery_period.end_date', 'The delivery period ends before it starts.');
    }
  }

  // IRN.
  if (isNonEmptyString(inv.irn)) {
    const problem = explainIrn(inv.irn);
    if (problem) c.error('irn.format', 'irn', problem);
    else if (isNonEmptyString(inv.issue_date) && isRealIsoDate(inv.issue_date) && !irnMatchesIssueDate(inv.irn, inv.issue_date)) {
      c.error('irn.date', 'irn', `The date inside the IRN (${inv.irn.split('-')[2]}) does not match issue_date (${inv.issue_date}). Rebuild the IRN from the invoice's issue date.`);
    }
  }

  // Enumerations.
  if (isNonEmptyString(inv.invoice_kind) && !KINDS.has(inv.invoice_kind)) {
    c.error('kind.value', 'invoice_kind', `invoice_kind must be one of B2B, B2C, B2G or G2B in capitals. Got "${inv.invoice_kind}".`);
  }
  if (inv.payment_status !== undefined && (typeof inv.payment_status !== 'string' || !PAYMENT_STATUSES.has(inv.payment_status))) {
    c.error('payment_status.value', 'payment_status', `payment_status must be PENDING, PAID or REJECTED. Got "${String(inv.payment_status)}".`);
  }

  // Invoice type and credit/debit note references.
  if (isNonEmptyString(inv.invoice_type_code)) {
    if (!/^\d{3}$/.test(inv.invoice_type_code)) {
      c.error('invoice_type.format', 'invoice_type_code', `invoice_type_code must be a 3-digit code from the invoice-types list, for example "381". Got "${inv.invoice_type_code}".`);
    } else if (res) {
      const known = hasInvoiceType(res, inv.invoice_type_code);
      if (known === false) c.error('invoice_type.unknown', 'invoice_type_code', `"${inv.invoice_type_code}" is not in the invoice-types list of your resources snapshot.`);
      const meaning = invoiceTypeMeaning(res, inv.invoice_type_code);
      if ((meaning === 'credit-note' || meaning === 'debit-note') && !(Array.isArray(inv.billing_reference) && inv.billing_reference.length > 0)) {
        c.error('billing_reference.required', 'billing_reference', `A ${meaning.replace('-', ' ')} must carry billing_reference with the IRN and issue_date of the original invoice it corrects.`);
      }
    } else {
      c.warn('invoice_type.unchecked', 'invoice_type_code', 'No resources snapshot given, so the invoice type code was not checked. Note that published documents disagree on whether 380 or 381 is "Commercial Invoice"; fetch a snapshot from the gateway to be sure.');
    }
  }
  if (inv.billing_reference !== undefined) {
    if (!Array.isArray(inv.billing_reference)) c.error('billing_reference.shape', 'billing_reference', 'billing_reference must be a list of { irn, issue_date } objects.');
    else inv.billing_reference.forEach((ref, i) => checkDocRef(c, ref, `billing_reference[${i}]`));
  }
  for (const f of ['dispatch_document_reference', 'receipt_document_reference', 'originator_document_reference', 'contract_document_reference'] as const) {
    if (inv[f] !== undefined) checkDocRef(c, inv[f], f);
  }
  if (inv.additional_document_reference !== undefined) {
    if (!Array.isArray(inv.additional_document_reference)) c.error('document_reference.shape', 'additional_document_reference', 'additional_document_reference must be a list of { irn, issue_date } objects.');
    else inv.additional_document_reference.forEach((ref, i) => checkDocRef(c, ref, `additional_document_reference[${i}]`));
  }

  // Currencies.
  for (const f of ['document_currency_code', 'tax_currency_code'] as const) {
    const v = inv[f];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !CURRENCY.test(v)) {
      c.error('currency.format', f, `${f} must be a 3-letter ISO currency code in capitals such as NGN. Got "${String(v)}".`);
    } else if (res && hasCurrency(res, v) === false) {
      c.error('currency.unknown', f, `"${v}" is not in the currencies list of your resources snapshot.`);
    }
  }

  // Parties.
  if (!isObj(inv.accounting_supplier_party)) {
    c.error('party.required', 'accounting_supplier_party', 'accounting_supplier_party (the seller) is required.');
  } else {
    checkParty(c, inv.accounting_supplier_party as Partial<Party> & Rec, 'accounting_supplier_party', res);
  }
  const kind = typeof inv.invoice_kind === 'string' ? inv.invoice_kind : '';
  if (kind === 'B2C') {
    if (inv.accounting_customer_party !== undefined) {
      c.warn('party.b2c_customer', 'accounting_customer_party', 'B2C invoices are reported without accounting_customer_party. Published docs say to omit it for consumers; keep it only if the gateway accepts it for you.');
    }
  } else if (KINDS.has(kind)) {
    if (!isObj(inv.accounting_customer_party)) {
      c.error('party.required', 'accounting_customer_party', `accounting_customer_party (the buyer) is required for ${kind} invoices. Only B2C invoices omit it.`);
    } else {
      checkParty(c, inv.accounting_customer_party as Partial<Party> & Rec, 'accounting_customer_party', res);
    }
  }

  // Payment means and allowances.
  if (inv.payment_means !== undefined) {
    if (!Array.isArray(inv.payment_means)) c.error('payment_means.shape', 'payment_means', 'payment_means must be a list.');
    else {
      inv.payment_means.forEach((pm, i) => {
        if (!isObj(pm) || !isNonEmptyString(pm.payment_means_code)) {
          c.error('payment_means.code', `payment_means[${i}].payment_means_code`, 'Each payment_means entry needs a payment_means_code such as "30" (credit transfer).');
        } else if (res && hasPaymentMeans(res, pm.payment_means_code) === false) {
          c.error('payment_means.unknown', `payment_means[${i}].payment_means_code`, `"${pm.payment_means_code}" is not in the payment-means list of your resources snapshot.`);
        }
        if (isObj(pm) && pm.payment_due_date !== undefined && (typeof pm.payment_due_date !== 'string' || !isRealIsoDate(pm.payment_due_date))) {
          c.error('date.format', `payment_means[${i}].payment_due_date`, 'payment_due_date must be YYYY-MM-DD.');
        }
      });
    }
  }
  let allowances = 0;
  let charges = 0;
  if (inv.allowance_charge !== undefined) {
    if (!Array.isArray(inv.allowance_charge)) c.error('allowance_charge.shape', 'allowance_charge', 'allowance_charge must be a list of { charge_indicator, amount }.');
    else {
      inv.allowance_charge.forEach((ac, i) => {
        if (!isObj(ac) || typeof ac.charge_indicator !== 'boolean' || !isMoney(ac.amount) || ac.amount < 0) {
          c.error('allowance_charge.entry', `allowance_charge[${i}]`, 'Each entry needs charge_indicator (true = charge, false = discount) and a non-negative amount.');
          return;
        }
        if (ac.charge_indicator) charges += ac.amount;
        else allowances += ac.amount;
      });
    }
  }

  // Lines.
  let linesTotal = 0;
  if (!Array.isArray(inv.invoice_line) || inv.invoice_line.length === 0) {
    c.error('lines.required', 'invoice_line', 'invoice_line must contain at least one line.');
  } else {
    inv.invoice_line.forEach((line, i) => {
      linesTotal += checkLine(c, line as Partial<InvoiceLine> & Rec, `invoice_line[${i}]`, res, tol);
    });
  }

  // Tax totals.
  let taxSum = 0;
  let taxableSum = 0;
  if (!Array.isArray(inv.tax_total) || inv.tax_total.length === 0) {
    c.error('tax_total.required', 'tax_total', 'tax_total must contain at least one entry, even for zero-rated invoices.');
  } else {
    inv.tax_total.forEach((tt, i) => {
      const p = `tax_total[${i}]`;
      if (!isObj(tt) || !isMoney(tt.tax_amount) || !Array.isArray(tt.tax_subtotal) || tt.tax_subtotal.length === 0) {
        c.error('tax_total.shape', p, 'Each tax_total needs a numeric tax_amount and at least one tax_subtotal.');
        return;
      }
      let subSum = 0;
      (tt.tax_subtotal as unknown[]).forEach((st, j) => {
        const sp = `${p}.tax_subtotal[${j}]`;
        if (!isObj(st) || !isMoney(st.taxable_amount) || !isMoney(st.tax_amount) || !isObj(st.tax_category) || !isNonEmptyString(st.tax_category.id) || !isMoney(st.tax_category.percent)) {
          c.error('tax_subtotal.shape', sp, 'Each tax_subtotal needs taxable_amount, tax_amount and tax_category { id, percent }.');
          return;
        }
        const cat = st.tax_category as { id: string; percent: number };
        let percent = cat.percent;
        if (res) {
          if (hasTaxCategory(res, cat.id) === false) {
            c.error('tax_category.unknown', `${sp}.tax_category.id`, `"${cat.id}" is not in the tax-categories list of your resources snapshot. Common ids are STANDARD_VAT, ZERO_VAT and EXEMPTED, but check your snapshot.`);
          }
          const rate = taxCategoryRate(res, cat.id);
          if (rate !== undefined && Math.abs(rate - cat.percent) > 1e-9) {
            c.error('tax_category.rate', `${sp}.tax_category.percent`, `Category ${cat.id} is ${rate}% in your resources snapshot but the invoice says ${cat.percent}%.`);
            percent = rate;
          }
        }
        const expected = round2((st.taxable_amount * percent) / 100);
        if (Math.abs(expected - st.tax_amount) > tol) {
          c.error('tax.arithmetic', `${sp}.tax_amount`, `tax_amount should be ${percent}% of taxable_amount ${st.taxable_amount}, which is ${expected.toFixed(2)}. Got ${st.tax_amount}.`);
        }
        subSum += st.tax_amount;
        taxableSum += st.taxable_amount;
      });
      if (Math.abs(subSum - tt.tax_amount) > tol) {
        c.error('tax.sum', `${p}.tax_amount`, `tax_amount ${tt.tax_amount} should equal the sum of its subtotals, ${round2(subSum).toFixed(2)}.`);
      }
      taxSum += tt.tax_amount;
    });
  }

  // Monetary totals.
  const lmt = inv.legal_monetary_total;
  if (!isObj(lmt)) {
    c.error('totals.required', 'legal_monetary_total', 'legal_monetary_total is required with line_extension_amount, tax_exclusive_amount, tax_inclusive_amount and payable_amount.');
  } else {
    for (const f of ['line_extension_amount', 'tax_exclusive_amount', 'tax_inclusive_amount', 'payable_amount'] as const) {
      if (!isMoney(lmt[f])) c.error('totals.field', `legal_monetary_total.${f}`, `legal_monetary_total.${f} must be a number.`);
    }
    if (isMoney(lmt.line_extension_amount) && Array.isArray(inv.invoice_line) && inv.invoice_line.length > 0 && Math.abs(lmt.line_extension_amount - linesTotal) > tol) {
      c.error('totals.lines', 'legal_monetary_total.line_extension_amount', `line_extension_amount ${lmt.line_extension_amount} should equal the sum of all line amounts, ${round2(linesTotal).toFixed(2)}.`);
    }
    if (isMoney(lmt.line_extension_amount) && isMoney(lmt.tax_exclusive_amount)) {
      const expectedExcl = round2(lmt.line_extension_amount - allowances + charges);
      if (Math.abs(expectedExcl - lmt.tax_exclusive_amount) > tol) {
        c.error('totals.exclusive', 'legal_monetary_total.tax_exclusive_amount', `tax_exclusive_amount should be line_extension_amount minus discounts plus charges, ${expectedExcl.toFixed(2)}. Got ${lmt.tax_exclusive_amount}.`);
      }
    }
    if (isMoney(lmt.tax_exclusive_amount) && isMoney(lmt.tax_inclusive_amount) && Array.isArray(inv.tax_total) && inv.tax_total.length > 0) {
      const expectedIncl = round2(lmt.tax_exclusive_amount + taxSum);
      if (Math.abs(expectedIncl - lmt.tax_inclusive_amount) > tol) {
        c.error('totals.inclusive', 'legal_monetary_total.tax_inclusive_amount', `tax_inclusive_amount should be tax_exclusive_amount plus total tax, ${expectedIncl.toFixed(2)}. Got ${lmt.tax_inclusive_amount}.`);
      }
    }
    if (isMoney(lmt.tax_inclusive_amount) && isMoney(lmt.payable_amount)) {
      const prepaid = isMoney(lmt.prepaid_amount) ? lmt.prepaid_amount : 0;
      const expectedPay = round2(lmt.tax_inclusive_amount - prepaid);
      if (Math.abs(expectedPay - lmt.payable_amount) > tol) {
        c.error('totals.payable', 'legal_monetary_total.payable_amount', `payable_amount should be tax_inclusive_amount minus any prepaid_amount, ${expectedPay.toFixed(2)}. Got ${lmt.payable_amount}.`);
      }
    }
    if (isMoney(lmt.tax_exclusive_amount) && Array.isArray(inv.tax_total) && inv.tax_total.length > 0 && Math.abs(taxableSum - lmt.tax_exclusive_amount) > tol) {
      c.warn('tax.taxable_vs_exclusive', 'tax_total', `The taxable amounts in tax_total add up to ${round2(taxableSum).toFixed(2)} but tax_exclusive_amount is ${lmt.tax_exclusive_amount}. They normally match unless part of the invoice is outside VAT.`);
    }
  }

  return c.result();
}

function checkDocRef(c: Collector, ref: unknown, path: string): void {
  if (!isObj(ref) || !isNonEmptyString(ref.irn) || !isNonEmptyString(ref.issue_date)) {
    c.error('document_reference.shape', path, `${path} needs { irn, issue_date }.`);
    return;
  }
  const problem = explainIrn(ref.irn);
  if (problem) c.error('document_reference.irn', `${path}.irn`, problem);
  if (!isRealIsoDate(ref.issue_date)) c.error('date.format', `${path}.issue_date`, 'issue_date must be YYYY-MM-DD.');
}

function checkParty(c: Collector, party: Partial<Party> & Rec, path: string, res?: ResourceSnapshot): void {
  if (!isNonEmptyString(party.party_name)) c.error('party.name', `${path}.party_name`, 'party_name is required.');
  if (!isNonEmptyString(party.tin)) {
    c.error('party.tin', `${path}.tin`, 'tin is required. Use the old TIN (eight digits, a hyphen, four digits), the RC number, or the new Tax ID.');
  } else if (/\s/.test(party.tin)) {
    c.error('party.tin', `${path}.tin`, `tin "${party.tin}" contains spaces. Remove them.`);
  }
  if (party.email !== undefined && (typeof party.email !== 'string' || !EMAIL.test(party.email))) {
    c.error('party.email', `${path}.email`, `email "${String(party.email)}" does not look like an email address.`);
  }
  if (party.telephone !== undefined && (typeof party.telephone !== 'string' || !E164.test(party.telephone))) {
    c.error('party.telephone', `${path}.telephone`, `telephone must be in international form starting with "+" and no spaces, for example +2348012345678. Got "${String(party.telephone)}".`);
  }
  if (party.business_description !== undefined && (typeof party.business_description !== 'string' || party.business_description.trim().length < 5)) {
    c.error('party.description', `${path}.business_description`, 'business_description must be at least 5 characters when present.');
  }
  const addr = party.postal_address;
  if (!isObj(addr)) {
    c.error('address.required', `${path}.postal_address`, 'postal_address is required with street_name, city_name, lga, state and country.');
    return;
  }
  for (const f of ['street_name', 'city_name', 'lga', 'state', 'country'] as const) {
    if (!isNonEmptyString(addr[f])) c.error('address.field', `${path}.postal_address.${f}`, `postal_address.${f} is required.`);
  }
  const state = typeof addr.state === 'string' ? addr.state : '';
  const lga = typeof addr.lga === 'string' ? addr.lga : '';
  const country = typeof addr.country === 'string' ? addr.country : '';
  if (country && country !== country.toUpperCase()) c.error('address.country', `${path}.postal_address.country`, 'country must be an upper-case 2-letter code such as NG.');
  if (state) {
    if (state.startsWith('NG-') && !STATE_NG.test(state)) {
      c.error('address.state', `${path}.postal_address.state`, `state "${state}" should look like NG-LA (NG, hyphen, two capital letters).`);
    }
    if (state.startsWith('NG-') && country && country !== 'NG') {
      c.error('address.country', `${path}.postal_address.country`, `state ${state} is a Nigerian state code but country is "${country}". Nigerian addresses use country NG.`);
    }
    if (res && hasState(res, state) === false) c.error('address.state.unknown', `${path}.postal_address.state`, `"${state}" is not in the states list of your resources snapshot.`);
  }
  if (lga && state && !lga.startsWith(`${state}-`)) {
    c.error('address.lga', `${path}.postal_address.lga`, `lga "${lga}" must begin with the state code "${state}-", for example ${state}-XXX. Pick the LGA from the lgas list for that state.`);
  }
  if (lga && res && hasLga(res, lga) === false) c.error('address.lga.unknown', `${path}.postal_address.lga`, `"${lga}" is not in the lgas list of your resources snapshot.`);
}

/** Returns the line's net amount (0 if unusable) after recording issues. */
function checkLine(c: Collector, line: Partial<InvoiceLine> & Rec, path: string, res: ResourceSnapshot | undefined, tol: number): number {
  if (!isObj(line)) {
    c.error('line.shape', path, 'Each invoice line must be an object.');
    return 0;
  }
  const hasGoods = line.hsn_code !== undefined || line.product_category !== undefined;
  const hasService = line.isic_code !== undefined || line.service_category !== undefined;
  if (hasGoods && hasService) {
    c.error('line.classification', path, 'A line is either goods (hsn_code + product_category) or a service (isic_code + service_category), never both.');
  } else if (!hasGoods && !hasService) {
    c.error('line.classification', path, 'Each line needs a classification: hsn_code + product_category for goods, or isic_code + service_category for services.');
  } else if (hasGoods) {
    if (!isNonEmptyString(line.hsn_code) || !HS_CODE.test(line.hsn_code)) {
      c.error('line.hs_code', `${path}.hsn_code`, `hsn_code must be an HS code in NNNN.NN form, for example 8471.50. Got "${String(line.hsn_code)}".`);
    } else if (res && hasHsCode(res, line.hsn_code) === false) {
      c.error('line.hs_code.unknown', `${path}.hsn_code`, `"${line.hsn_code}" is not in the hs-codes list of your resources snapshot.`);
    }
    if (!isNonEmptyString(line.product_category)) c.error('line.product_category', `${path}.product_category`, 'Goods lines need product_category, a short description of the goods class.');
  } else {
    if (!isNonEmptyString(line.isic_code) || !ISIC_CODE.test(line.isic_code)) {
      c.error('line.isic_code', `${path}.isic_code`, `isic_code must be a 4-digit ISIC service code, for example 6201. Got "${String(line.isic_code)}".`);
    } else if (res && hasServiceCode(res, line.isic_code) === false) {
      c.error('line.isic_code.unknown', `${path}.isic_code`, `"${line.isic_code}" is not in the services-codes list of your resources snapshot.`);
    }
    if (!isNonEmptyString(line.service_category)) c.error('line.service_category', `${path}.service_category`, 'Service lines need service_category, a short description of the service class.');
  }

  if (!isObj(line.item) || !isNonEmptyString(line.item.name)) c.error('line.item', `${path}.item.name`, 'Each line needs item.name.');
  if (!isMoney(line.invoiced_quantity) || line.invoiced_quantity <= 0) c.error('line.quantity', `${path}.invoiced_quantity`, 'invoiced_quantity must be a number greater than zero.');
  if (!isMoney(line.line_extension_amount) || line.line_extension_amount < 0) c.error('line.amount', `${path}.line_extension_amount`, 'line_extension_amount (the line net, before VAT) must be a number of zero or more.');

  const price = line.price;
  if (!isObj(price) || !isMoney(price.price_amount) || !isMoney(price.base_quantity) || price.base_quantity <= 0 || !isNonEmptyString(price.price_unit)) {
    c.error('line.price', `${path}.price`, 'price needs price_amount (a number), base_quantity (greater than zero) and price_unit (text such as "EA").');
  } else if (isMoney(line.invoiced_quantity) && isMoney(line.line_extension_amount)) {
    const discount = isMoney(line.discount_amount) ? line.discount_amount : 0;
    const fee = isMoney(line.fee_amount) ? line.fee_amount : 0;
    const expected = round2((line.invoiced_quantity * price.price_amount) / price.base_quantity - discount + fee);
    if (Math.abs(expected - line.line_extension_amount) > tol) {
      c.warn('line.arithmetic', `${path}.line_extension_amount`, `Quantity ${line.invoiced_quantity} at ${price.price_amount} per ${price.base_quantity}, minus discount ${discount}, plus fee ${fee}, is ${expected.toFixed(2)}, but line_extension_amount is ${line.line_extension_amount}.`);
    }
  }
  return isMoney(line.line_extension_amount) ? line.line_extension_amount : 0;
}

/** Renders a result as lines a person can read in a terminal or a log. */
export function formatResult(result: ValidationResult): string {
  const lines: string[] = [];
  if (result.ok && result.warnings.length === 0) return 'OK: no problems found.';
  lines.push(result.ok ? `OK with ${result.warnings.length} warning(s).` : `${result.errors.length} error(s), ${result.warnings.length} warning(s).`);
  for (const e of result.errors) lines.push(`  ERROR  ${e.path || '(invoice)'}: ${e.message}`);
  for (const w of result.warnings) lines.push(`  warn   ${w.path || '(invoice)'}: ${w.message}`);
  return lines.join('\n');
}
