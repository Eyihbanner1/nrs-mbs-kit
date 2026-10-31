import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoice } from '../src/build.ts';
import { validate } from '../src/validate.ts';
import type { Party } from '../src/types.ts';

const supplier: Party = {
  party_name: 'S',
  tin: '12345678-0001',
  postal_address: { street_name: 'a', city_name: 'b', lga: 'NG-FC-AML', state: 'NG-FC', country: 'NG' },
};
const customer: Party = {
  party_name: 'C',
  tin: '87654321-0001',
  postal_address: { street_name: 'a', city_name: 'b', lga: 'NG-OG-IFO', state: 'NG-OG', country: 'NG' },
};

test('computes nets, VAT and totals to two decimals', () => {
  const inv = buildInvoice({
    businessId: 'b',
    serviceId: '94ND90NR',
    invoiceNumber: 'A1',
    issueDate: '2026-10-31',
    kind: 'B2B',
    typeCode: '381',
    supplier,
    customer,
    lines: [
      { kind: 'goods', code: '1006.30', category: 'Rice', name: 'Rice', quantity: 3, unitPrice: 333.33 },
      { kind: 'service', code: '6201', category: 'Programming', name: 'Work', quantity: 1, unitPrice: 1000, discountAmount: 100 },
    ],
  });
  assert.equal(inv.irn, 'A1-94ND90NR-20261031');
  assert.equal(inv.invoice_line[0].line_extension_amount, 999.99);
  assert.equal(inv.invoice_line[1].line_extension_amount, 900);
  assert.equal(inv.legal_monetary_total.line_extension_amount, 1899.99);
  assert.equal(inv.tax_total[0].tax_amount, 142.5);
  assert.equal(inv.legal_monetary_total.payable_amount, 2042.49);
  assert.equal(validate(inv).ok, true);
});

test('B2C omits the customer; other kinds require one', () => {
  const b2c = buildInvoice({ businessId: 'b', serviceId: '94ND90NR', invoiceNumber: 'A1', issueDate: '2026-10-31', kind: 'B2C', typeCode: '381', supplier, lines: [{ kind: 'goods', code: '1006.30', category: 'Rice', name: 'Rice', quantity: 1, unitPrice: 10 }] });
  assert.equal(b2c.accounting_customer_party, undefined);
  assert.throws(() => buildInvoice({ businessId: 'b', serviceId: '94ND90NR', invoiceNumber: 'A1', issueDate: '2026-10-31', kind: 'B2B', typeCode: '381', supplier, lines: [] }), /customer/);
});

test('zero-rated invoices carry a zero tax total', () => {
  const inv = buildInvoice({ businessId: 'b', serviceId: '94ND90NR', invoiceNumber: 'A1', issueDate: '2026-10-31', kind: 'B2B', typeCode: '381', supplier, customer, taxCategoryId: 'ZERO_VAT', vatPercent: 0, lines: [{ kind: 'goods', code: '1006.30', category: 'Rice', name: 'Rice', quantity: 1, unitPrice: 10 }] });
  assert.equal(inv.tax_total[0].tax_amount, 0);
  assert.equal(inv.legal_monetary_total.payable_amount, 10);
  assert.equal(validate(inv).ok, true);
});
