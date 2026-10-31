import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, formatResult } from '../src/validate.ts';
import { buildInvoice } from '../src/build.ts';
import { loadExampleSnapshot } from '../src/resources.ts';
import type { Invoice, Party } from '../src/types.ts';

const supplier: Party = {
  party_name: 'Example Supplies Ltd',
  tin: '12345678-0001',
  email: 'accounts@example-supplies.ng',
  telephone: '+2348012345678',
  business_description: 'Office equipment',
  postal_address: { street_name: '1 Marina', city_name: 'Abuja', postal_zone: '900288', lga: 'NG-FC-AML', state: 'NG-FC', country: 'NG' },
};
const customer: Party = {
  party_name: 'Example Buyer Ltd',
  tin: '87654321-0001',
  email: 'ap@example-buyer.ng',
  telephone: '+2348098765432',
  business_description: 'Manufacturing',
  postal_address: { street_name: '10 Industrial Avenue', city_name: 'Isheri', postal_zone: '110001', lga: 'NG-OG-IFO', state: 'NG-OG', country: 'NG' },
};

function good(): Invoice {
  return buildInvoice({
    businessId: '00000000-0000-4000-8000-000000000000',
    serviceId: '94ND90NR',
    invoiceNumber: 'INV2026001',
    issueDate: '2026-10-31',
    issueTime: '10:00:00',
    kind: 'B2B',
    typeCode: '381',
    supplier,
    customer,
    lines: [
      { kind: 'goods', code: '8471.50', category: 'Automatic data processing units', name: 'Desktop computer', quantity: 2, unitPrice: 450000 },
      { kind: 'service', code: '6201', category: 'Computer programming activities', name: 'Setup', quantity: 1, unitPrice: 150000 },
    ],
  });
}

const codes = (r: ReturnType<typeof validate>) => r.errors.map((e) => e.code);
const snap = loadExampleSnapshot();

test('a well-formed invoice passes with and without resources', () => {
  const r1 = validate(good());
  assert.equal(r1.ok, true, formatResult(r1));
  assert.ok(r1.warnings.some((w) => w.code === 'invoice_type.unchecked'));
  const r2 = validate(good(), { resources: snap });
  assert.equal(r2.ok, true, formatResult(r2));
  assert.equal(r2.warnings.length, 0, formatResult(r2));
});

test('rejects something that is not an object', () => {
  assert.equal(validate('nope').ok, false);
  assert.equal(validate(null).ok, false);
});

test('missing required fields are named individually', () => {
  const inv = good() as Partial<Invoice>;
  delete inv.business_id;
  delete inv.document_currency_code;
  const r = validate(inv);
  const paths = r.errors.filter((e) => e.code === 'field.required').map((e) => e.path);
  assert.deepEqual(paths.sort(), ['business_id', 'document_currency_code']);
});

test('IRN must match the issue date', () => {
  const inv = good();
  inv.issue_date = '2026-10-30';
  const r = validate(inv);
  assert.ok(codes(r).includes('irn.date'), formatResult(r));
});

test('bad IRN shape is explained', () => {
  const inv = good();
  inv.irn = 'INV/001-94ND90NR-20261031';
  const r = validate(inv);
  assert.ok(codes(r).includes('irn.format'));
  assert.match(r.errors.find((e) => e.code === 'irn.format')!.message, /letters and digits/);
});

test('B2B needs a customer, B2C must not have one', () => {
  const inv = good();
  delete inv.accounting_customer_party;
  assert.ok(codes(validate(inv)).includes('party.required'));
  const b2c = good();
  b2c.invoice_kind = 'B2C';
  const r = validate(b2c);
  assert.equal(r.ok, true, formatResult(r));
  assert.ok(r.warnings.some((w) => w.code === 'party.b2c_customer'));
});

test('a line cannot be both goods and service, and codes have a shape', () => {
  const inv = good();
  inv.invoice_line[0].isic_code = '6201';
  assert.ok(codes(validate(inv)).includes('line.classification'));
  const inv2 = good();
  inv2.invoice_line[0].hsn_code = '847150';
  assert.ok(codes(validate(inv2)).includes('line.hs_code'));
  const inv3 = good();
  inv3.invoice_line[1].isic_code = '62';
  assert.ok(codes(validate(inv3)).includes('line.isic_code'));
});

test('unknown codes are caught only when a snapshot is given', () => {
  const inv = good();
  inv.invoice_line[0].hsn_code = '9999.99';
  assert.equal(validate(inv).ok, true);
  assert.ok(codes(validate(inv, { resources: snap })).includes('line.hs_code.unknown'));
});

test('LGA must belong to the state and Nigerian addresses use NG', () => {
  const inv = good();
  inv.accounting_supplier_party.postal_address.lga = 'NG-OG-IFO';
  assert.ok(codes(validate(inv)).includes('address.lga'));
  const inv2 = good();
  inv2.accounting_customer_party!.postal_address.country = 'GH';
  assert.ok(codes(validate(inv2)).includes('address.country'));
});

test('telephone must be E.164', () => {
  const inv = good();
  inv.accounting_supplier_party.telephone = '08012345678';
  const r = validate(inv);
  assert.ok(codes(r).includes('party.telephone'));
  assert.match(r.errors.find((e) => e.code === 'party.telephone')!.message, /\+2348012345678/);
});

test('VAT arithmetic is checked', () => {
  const inv = good();
  inv.tax_total[0].tax_subtotal[0].tax_amount = 1;
  const r = validate(inv);
  assert.ok(codes(r).includes('tax.arithmetic'));
  assert.ok(codes(r).includes('tax.sum'));
});

test('VAT rate is checked against the snapshot', () => {
  const inv = good();
  inv.tax_total[0].tax_subtotal[0].tax_category.percent = 5;
  inv.tax_total[0].tax_subtotal[0].tax_amount = 52500;
  inv.tax_total[0].tax_amount = 52500;
  inv.legal_monetary_total.tax_inclusive_amount = 1102500;
  inv.legal_monetary_total.payable_amount = 1102500;
  assert.equal(validate(inv).ok, true);
  assert.ok(codes(validate(inv, { resources: snap })).includes('tax_category.rate'));
});

test('totals must add up', () => {
  const inv = good();
  inv.legal_monetary_total.payable_amount += 10;
  assert.ok(codes(validate(inv)).includes('totals.payable'));
  const inv2 = good();
  inv2.legal_monetary_total.line_extension_amount += 1;
  const r2 = validate(inv2);
  assert.ok(codes(r2).includes('totals.lines'));
});

test('credit notes need a billing reference when the snapshot says the code is a credit note', () => {
  const inv = good();
  inv.invoice_type_code = '380';
  const r = validate(inv, { resources: snap });
  assert.ok(codes(r).includes('billing_reference.required'), formatResult(r));
  inv.billing_reference = [{ irn: 'INV2026000-94ND90NR-20261001', issue_date: '2026-10-01' }];
  assert.equal(validate(inv, { resources: snap }).ok, true);
});

test('due date cannot precede issue date', () => {
  const inv = good();
  inv.due_date = '2026-10-01';
  assert.ok(codes(validate(inv)).includes('date.order'));
});

test('formatResult is readable', () => {
  const inv = good();
  inv.irn = 'bad';
  const text = formatResult(validate(inv));
  assert.match(text, /error\(s\)/);
  assert.match(text, /ERROR\s+irn:/);
});
