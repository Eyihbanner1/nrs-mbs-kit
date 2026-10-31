/**
 * Builds a complete NRS invoice JSON from the few things a business actually
 * knows: who sold what to whom, at what price. Totals, VAT and the IRN are
 * computed for you.
 */
import type { Invoice, InvoiceKind, InvoiceLine, Party, PaymentStatus } from './types.ts';
import { buildIrn } from './irn.ts';

export interface BuildLine {
  kind: 'goods' | 'service';
  /** HS code (NNNN.NN) for goods, ISIC 4-digit code for services. */
  code: string;
  /** product_category or service_category text. */
  category: string;
  name: string;
  description?: string;
  sellerItemId?: string;
  quantity: number;
  /** Price per base quantity, before VAT. */
  unitPrice: number;
  baseQuantity?: number;
  /** Unit of measure text. Defaults to "EA". */
  unit?: string;
  discountAmount?: number;
  feeAmount?: number;
}

export interface BuildInput {
  businessId: string;
  serviceId: string;
  invoiceNumber: string;
  /** YYYY-MM-DD */
  issueDate: string;
  /** HH:MM:SS. Defaults to the current UTC time. */
  issueTime?: string;
  dueDate?: string;
  kind: InvoiceKind;
  /** Invoice type code from the invoice-types list, e.g. "381". */
  typeCode: string;
  currency?: string;
  paymentStatus?: PaymentStatus;
  supplier: Party;
  /** Required unless kind is B2C. */
  customer?: Party;
  lines: BuildLine[];
  /** Tax category id from the tax-categories list. Defaults to STANDARD_VAT. */
  taxCategoryId?: string;
  /** VAT rate in percent. Defaults to 7.5. */
  vatPercent?: number;
  note?: string;
  orderReference?: string;
  /** For credit and debit notes: the original invoice. */
  billingReference?: { irn: string; issue_date: string }[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function nowTime(): string {
  return new Date().toISOString().slice(11, 19);
}

export function buildInvoice(input: BuildInput): Invoice {
  if (input.kind !== 'B2C' && !input.customer) throw new Error(`A ${input.kind} invoice needs a customer. Only B2C invoices omit the buyer.`);
  if (!input.lines.length) throw new Error('At least one line is required.');

  const irn = buildIrn({ invoiceNumber: input.invoiceNumber, serviceId: input.serviceId, issueDate: input.issueDate });
  const vatPercent = input.vatPercent ?? 7.5;
  const currency = input.currency ?? 'NGN';

  const invoice_line: InvoiceLine[] = input.lines.map((l, i) => {
    if (l.quantity <= 0) throw new Error(`Line ${i + 1}: quantity must be greater than zero.`);
    const baseQuantity = l.baseQuantity ?? 1;
    const discount = l.discountAmount ?? 0;
    const fee = l.feeAmount ?? 0;
    const net = round2((l.quantity * l.unitPrice) / baseQuantity - discount + fee);
    const line: InvoiceLine = {
      invoiced_quantity: l.quantity,
      line_extension_amount: net,
      item: { name: l.name, ...(l.description ? { description: l.description } : {}), ...(l.sellerItemId ? { sellers_item_identification: l.sellerItemId } : {}) },
      price: { price_amount: l.unitPrice, base_quantity: baseQuantity, price_unit: l.unit ?? 'EA' },
    };
    if (discount) line.discount_amount = discount;
    if (fee) line.fee_amount = fee;
    if (l.kind === 'goods') {
      line.hsn_code = l.code;
      line.product_category = l.category;
    } else {
      line.isic_code = l.code;
      line.service_category = l.category;
    }
    return line;
  });

  const net = round2(invoice_line.reduce((s, l) => s + l.line_extension_amount, 0));
  const tax = round2((net * vatPercent) / 100);
  const gross = round2(net + tax);

  const invoice: Invoice = {
    business_id: input.businessId,
    irn,
    issue_date: input.issueDate,
    issue_time: input.issueTime ?? nowTime(),
    ...(input.dueDate ? { due_date: input.dueDate } : {}),
    invoice_type_code: input.typeCode,
    invoice_kind: input.kind,
    payment_status: input.paymentStatus ?? 'PENDING',
    ...(input.note ? { note: input.note } : {}),
    document_currency_code: currency,
    tax_currency_code: currency,
    ...(input.orderReference ? { order_reference: input.orderReference } : {}),
    ...(input.billingReference ? { billing_reference: input.billingReference } : {}),
    accounting_supplier_party: structuredClone(input.supplier),
    ...(input.customer ? { accounting_customer_party: structuredClone(input.customer) } : {}),
    tax_total: [
      {
        tax_amount: tax,
        tax_subtotal: [{ taxable_amount: net, tax_amount: tax, tax_category: { id: input.taxCategoryId ?? 'STANDARD_VAT', percent: vatPercent } }],
      },
    ],
    legal_monetary_total: {
      line_extension_amount: net,
      tax_exclusive_amount: net,
      tax_inclusive_amount: gross,
      payable_amount: gross,
    },
    invoice_line,
  };
  return invoice;
}
