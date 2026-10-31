/**
 * Types for the NRS (formerly FIRS) Merchant Buyer Solution invoice JSON, v1.1.
 *
 * Field names follow the UBL-aligned JSON the NRS gateway accepts. Fields marked
 * optional appear in published examples but are not listed as mandatory by any
 * provider. When in doubt, run `validate()` and the sandbox `/validate` endpoint.
 */

export type InvoiceKind = 'B2B' | 'B2C' | 'B2G' | 'G2B';
export type PaymentStatus = 'PENDING' | 'PAID' | 'REJECTED';

export interface PostalAddress {
  street_name: string;
  city_name: string;
  postal_zone?: string;
  /** Local government area code, e.g. "NG-FC-AML". Must start with the state code. */
  lga: string;
  /** State code, e.g. "NG-FC". */
  state: string;
  /** Country code. Nigerian parties use "NG". */
  country: string;
}

export interface Party {
  party_name: string;
  /** Old TIN (NNNNNNNN-NNNN), RC number, or new Tax ID. */
  tin: string;
  email?: string;
  /** E.164 format, starts with "+". */
  telephone?: string;
  /** At least 5 characters when present. */
  business_description?: string;
  postal_address: PostalAddress;
}

export interface TaxCategory {
  /** Category id from the tax-categories resource, e.g. "STANDARD_VAT". */
  id: string;
  percent: number;
}

export interface TaxSubtotal {
  taxable_amount: number;
  tax_amount: number;
  tax_category: TaxCategory;
}

export interface TaxTotal {
  tax_amount: number;
  tax_subtotal: TaxSubtotal[];
}

export interface LegalMonetaryTotal {
  /** Sum of every line's line_extension_amount. */
  line_extension_amount: number;
  tax_exclusive_amount: number;
  tax_inclusive_amount: number;
  payable_amount: number;
  allowance_total_amount?: number;
  charge_total_amount?: number;
  prepaid_amount?: number;
}

export interface InvoiceLineItem {
  name: string;
  description?: string;
  sellers_item_identification?: string;
}

export interface InvoiceLinePrice {
  price_amount: number;
  base_quantity: number;
  /** Unit of measure. Published examples use "EA", "E48" and "NGN per 1". */
  price_unit: string;
}

export interface InvoiceLine {
  /** Goods line: HS code in NNNN.NN form, paired with product_category. */
  hsn_code?: string;
  product_category?: string;
  /** Service line: 4-digit ISIC code, paired with service_category. */
  isic_code?: string;
  service_category?: string;
  discount_rate?: number;
  discount_amount?: number;
  fee_rate?: number;
  fee_amount?: number;
  invoiced_quantity: number;
  /** Net amount for the line, before VAT. */
  line_extension_amount: number;
  item: InvoiceLineItem;
  price: InvoiceLinePrice;
}

export interface DocumentReference {
  irn: string;
  issue_date: string;
}

export interface DeliveryPeriod {
  start_date: string;
  end_date: string;
}

export interface PaymentMeans {
  /** Code from the payment-means resource, e.g. "30" for credit transfer. */
  payment_means_code: string;
  payment_due_date?: string;
}

export interface AllowanceCharge {
  /** true = charge, false = allowance (discount). */
  charge_indicator: boolean;
  amount: number;
}

export interface Invoice {
  /** Supplier's NRS business id (uuid) from the NRS dashboard. */
  business_id: string;
  /** "{InvoiceNumber}-{ServiceID}-{YYYYMMDD}" */
  irn: string;
  /** YYYY-MM-DD */
  issue_date: string;
  /** HH:MM:SS */
  issue_time: string;
  due_date?: string;
  /** Code from the invoice-types resource. See README on the 380/381 discrepancy. */
  invoice_type_code: string;
  invoice_kind: InvoiceKind;
  payment_status?: PaymentStatus;
  note?: string;
  tax_point_date?: string;
  document_currency_code: string;
  tax_currency_code?: string;
  accounting_cost?: string;
  buyer_reference?: string;
  invoice_delivery_period?: DeliveryPeriod;
  order_reference?: string;
  /** Required for credit and debit notes: the original invoice. */
  billing_reference?: DocumentReference[];
  dispatch_document_reference?: DocumentReference;
  receipt_document_reference?: DocumentReference;
  originator_document_reference?: DocumentReference;
  contract_document_reference?: DocumentReference;
  additional_document_reference?: DocumentReference[];
  accounting_supplier_party: Party;
  /** Required for B2B, B2G and G2B. Omit for B2C. */
  accounting_customer_party?: Party;
  actual_delivery_date?: string;
  payment_means?: PaymentMeans[];
  payment_terms_note?: string;
  allowance_charge?: AllowanceCharge[];
  tax_total: TaxTotal[];
  legal_monetary_total: LegalMonetaryTotal;
  invoice_line: InvoiceLine[];
}

/** One problem found by the validator. */
export interface Issue {
  /** Stable machine code, e.g. "line.classification". */
  code: string;
  /** JSON path to the offending field, e.g. "invoice_line[1].hsn_code". */
  path: string;
  /** Plain-English explanation and what to do. */
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
}
