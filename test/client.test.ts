import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MbsClient, MbsApiError, SANDBOX_URL } from '../src/client.ts';
import { fetchSnapshot } from '../src/resources.ts';
import { buildInvoice } from '../src/build.ts';
import type { Party } from '../src/types.ts';

const party: Party = { party_name: 'S', tin: '1', postal_address: { street_name: 'a', city_name: 'b', lga: 'NG-FC-AML', state: 'NG-FC', country: 'NG' } };

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const { status, body } = handler(String(input), init ?? {});
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

test('sends the two auth headers and JSON bodies to the documented paths', async () => {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const client = new MbsClient({
    apiKey: 'k',
    apiSecret: 's',
    fetch: fakeFetch((url, init) => {
      calls.push({ url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/confirm/A1-94ND90NR-20261031')) return { status: 200, body: { entry_status: 'NEW_ENTRY' } };
      return { status: url.endsWith('/sign') ? 201 : 200, body: { data: { ok: true } } };
    }),
  });
  const inv = buildInvoice({ businessId: 'bid', serviceId: '94ND90NR', invoiceNumber: 'A1', issueDate: '2026-10-31', kind: 'B2C', typeCode: '381', supplier: party, lines: [{ kind: 'goods', code: '1006.30', category: 'x', name: 'x', quantity: 1, unitPrice: 1 }] });
  const result = await client.clear(inv);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].url, `${SANDBOX_URL}/api/v1/invoice/irn/validate`);
  assert.deepEqual(calls[0].body, { business_id: 'bid', invoice_reference: 'A1', irn: 'A1-94ND90NR-20261031' });
  assert.equal(calls[1].url, `${SANDBOX_URL}/api/v1/invoice/validate`);
  assert.equal(calls[2].url, `${SANDBOX_URL}/api/v1/invoice/sign`);
  assert.equal(calls[3].url, `${SANDBOX_URL}/api/v1/invoice/confirm/A1-94ND90NR-20261031`);
  assert.equal(calls[0].headers['x-api-key'], 'k');
  assert.equal(calls[0].headers['x-api-secret'], 's');
  assert.equal(result.sign.status, 201);
  assert.deepEqual(result.confirm.body, { entry_status: 'NEW_ENTRY' });
});

test('non-2xx responses become MbsApiError with the body attached', async () => {
  const client = new MbsClient({ apiKey: 'k', apiSecret: 's', fetch: fakeFetch(() => ({ status: 400, body: { error: 'tin invalid' } })) });
  await assert.rejects(client.confirm('X'), (err: unknown) => {
    assert.ok(err instanceof MbsApiError);
    assert.equal(err.status, 400);
    assert.deepEqual(err.body, { error: 'tin invalid' });
    return true;
  });
});

test('fetchSnapshot unwraps {code, data} envelopes into snapshot keys', async () => {
  const client = new MbsClient({
    apiKey: 'k',
    apiSecret: 's',
    fetch: fakeFetch((url) => {
      if (url.endsWith('/resources/states')) return { status: 200, body: { code: 200, data: [{ code: 'NG-LA', name: 'Lagos' }] } };
      return { status: 200, body: [] };
    }),
  });
  const snap = await fetchSnapshot(client, ['states', 'currencies']);
  assert.deepEqual(snap.states, [{ code: 'NG-LA', name: 'Lagos' }]);
  assert.deepEqual(snap.currencies, []);
  assert.equal(snap.base_url, SANDBOX_URL);
});

test('requires credentials', () => {
  assert.throws(() => new MbsClient({ apiKey: '', apiSecret: 's' }), /apiKey and apiSecret/);
});
