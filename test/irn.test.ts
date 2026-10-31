import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIrn, parseIrn, explainIrn, irnMatchesIssueDate, toDateStamp } from '../src/irn.ts';

test('builds an IRN from number, service id and ISO date', () => {
  assert.equal(buildIrn({ invoiceNumber: 'INV001', serviceId: '94ND90NR', issueDate: '2026-10-31' }), 'INV001-94ND90NR-20261031');
});

test('accepts a compact date too', () => {
  assert.equal(buildIrn({ invoiceNumber: 'INV001', serviceId: '94ND90NR', issueDate: '20261031' }), 'INV001-94ND90NR-20261031');
});

test('rejects invoice numbers with slashes or spaces', () => {
  assert.throws(() => buildIrn({ invoiceNumber: 'INV/2026/001', serviceId: '94ND90NR', issueDate: '2026-10-31' }), /letters and digits/);
  assert.throws(() => buildIrn({ invoiceNumber: 'INV 001', serviceId: '94ND90NR', issueDate: '2026-10-31' }), /letters and digits/);
});

test('rejects a service id that is not 8 characters', () => {
  assert.throws(() => buildIrn({ invoiceNumber: 'INV001', serviceId: '94ND90N', issueDate: '2026-10-31' }), /exactly 8/);
});

test('rejects impossible dates', () => {
  assert.throws(() => buildIrn({ invoiceNumber: 'INV001', serviceId: '94ND90NR', issueDate: '2026-02-30' }), /not a real calendar date/);
  assert.throws(() => toDateStamp('31/10/2026'), /YYYY-MM-DD/);
});

test('parses and explains', () => {
  assert.deepEqual(parseIrn('INV001-94ND90NR-20261031'), { invoiceNumber: 'INV001', serviceId: '94ND90NR', dateStamp: '20261031' });
  assert.equal(parseIrn('INV001-94ND90NR'), null);
  assert.equal(explainIrn('INV001-94ND90NR-20261031'), null);
  assert.match(explainIrn('INV001-94ND90NR') ?? '', /three parts/);
  assert.match(explainIrn('INV001-94ND90N-20261031') ?? '', /exactly 8/);
  assert.match(explainIrn('INV001-94ND90NR-2026103') ?? '', /8 digits/);
});

test('matches the IRN date against issue_date', () => {
  assert.equal(irnMatchesIssueDate('INV001-94ND90NR-20261031', '2026-10-31'), true);
  assert.equal(irnMatchesIssueDate('INV001-94ND90NR-20261031', '2026-10-30'), false);
});
