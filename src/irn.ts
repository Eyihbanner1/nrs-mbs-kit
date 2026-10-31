/**
 * Invoice Reference Number helpers.
 *
 * IRN = {InvoiceNumber}-{ServiceID}-{YYYYMMDD}
 *  - InvoiceNumber: letters and digits only, from your own numbering.
 *  - ServiceID: exactly 8 letters/digits, assigned by NRS when the business is enabled.
 *  - YYYYMMDD: the invoice issue date, digits only.
 */

export interface IrnParts {
  invoiceNumber: string;
  serviceId: string;
  /** YYYYMMDD */
  dateStamp: string;
}

const INVOICE_NUMBER = /^[A-Za-z0-9]+$/;
const SERVICE_ID = /^[A-Za-z0-9]{8}$/;
const DATE_STAMP = /^\d{8}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Accepts "2026-10-31" or "20261031" and returns "20261031". */
export function toDateStamp(date: string): string {
  const iso = ISO_DATE.exec(date);
  if (iso) return `${iso[1]}${iso[2]}${iso[3]}`;
  if (DATE_STAMP.test(date)) return date;
  throw new Error(`Issue date must be YYYY-MM-DD or YYYYMMDD, got "${date}".`);
}

export function isRealDateStamp(stamp: string): boolean {
  if (!DATE_STAMP.test(stamp)) return false;
  const y = Number(stamp.slice(0, 4));
  const m = Number(stamp.slice(4, 6));
  const d = Number(stamp.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function buildIrn(input: { invoiceNumber: string; serviceId: string; issueDate: string }): string {
  const { invoiceNumber, serviceId, issueDate } = input;
  if (!INVOICE_NUMBER.test(invoiceNumber)) {
    throw new Error(
      `Invoice number "${invoiceNumber}" must contain only letters and digits. Remove spaces, slashes and dashes (for example INV/2026/001 becomes INV2026001).`,
    );
  }
  if (!SERVICE_ID.test(serviceId)) {
    throw new Error(
      `Service ID "${serviceId}" must be exactly 8 letters or digits. It is the id NRS assigned when the business was enabled for e-invoicing.`,
    );
  }
  const stamp = toDateStamp(issueDate);
  if (!isRealDateStamp(stamp)) throw new Error(`Issue date "${issueDate}" is not a real calendar date.`);
  return `${invoiceNumber}-${serviceId}-${stamp}`;
}

/** Splits an IRN into its parts, or returns null if the shape is wrong. */
export function parseIrn(irn: string): IrnParts | null {
  if (typeof irn !== 'string') return null;
  const parts = irn.split('-');
  if (parts.length !== 3) return null;
  const [invoiceNumber, serviceId, dateStamp] = parts;
  if (!INVOICE_NUMBER.test(invoiceNumber) || !SERVICE_ID.test(serviceId) || !isRealDateStamp(dateStamp)) return null;
  return { invoiceNumber, serviceId, dateStamp };
}

/** Returns a plain-English problem, or null when the IRN is well formed. */
export function explainIrn(irn: string): string | null {
  if (typeof irn !== 'string' || irn.length === 0) return 'The IRN is missing.';
  const parts = irn.split('-');
  if (parts.length !== 3) {
    return `An IRN has three parts joined by hyphens: invoice number, 8-character service id, date as YYYYMMDD. Got ${parts.length} part(s) in "${irn}".`;
  }
  const [invoiceNumber, serviceId, dateStamp] = parts;
  if (!INVOICE_NUMBER.test(invoiceNumber)) return `The invoice number part "${invoiceNumber}" may only contain letters and digits.`;
  if (!SERVICE_ID.test(serviceId)) return `The service id part "${serviceId}" must be exactly 8 letters or digits.`;
  if (!DATE_STAMP.test(dateStamp)) return `The date part "${dateStamp}" must be 8 digits in YYYYMMDD form.`;
  if (!isRealDateStamp(dateStamp)) return `The date part "${dateStamp}" is not a real calendar date.`;
  return null;
}

/** True when the IRN's date part matches the invoice's issue_date. */
export function irnMatchesIssueDate(irn: string, issueDate: string): boolean {
  const parts = parseIrn(irn);
  if (!parts) return false;
  try {
    return parts.dateStamp === toDateStamp(issueDate);
  } catch {
    return false;
  }
}
