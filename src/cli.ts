#!/usr/bin/env node
/**
 * nrs-mbs command line.
 *
 *   nrs-mbs validate <invoice.json> [--resources snapshot.json] [--json]
 *   nrs-mbs irn <invoiceNumber> <serviceId> <issueDate>
 *   nrs-mbs qr --irn <IRN> --keys <nrs-key-file.json> [--timestamp N] [--png out.png]
 *   nrs-mbs resources fetch --out snapshot.json      (needs NRS_API_KEY, NRS_API_SECRET, optional NRS_BASE_URL)
 *   nrs-mbs example                                   (prints a sample invoice JSON)
 */
import { readFileSync } from 'node:fs';
import { validate, formatResult } from './validate.ts';
import { buildIrn } from './irn.ts';
import { buildQrPayload, qrPng } from './qr.ts';
import { fetchSnapshot, loadSnapshot, saveSnapshot } from './resources.ts';
import { MbsClient } from './client.ts';
import { buildInvoice } from './build.ts';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
function has(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}
function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const USAGE = `nrs-mbs — Nigeria NRS e-invoicing kit

  nrs-mbs validate <invoice.json> [--resources snapshot.json] [--json]
  nrs-mbs irn <invoiceNumber> <serviceId> <issueDate YYYY-MM-DD>
  nrs-mbs qr --irn <IRN> --keys <key-file.json> [--timestamp N] [--png out.png]
  nrs-mbs resources fetch --out snapshot.json
      reads NRS_API_KEY, NRS_API_SECRET and optional NRS_BASE_URL from the environment
  nrs-mbs example > invoice.json
`;

async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'validate': {
      const file = rest[0];
      if (!file || file.startsWith('--')) fail('Usage: nrs-mbs validate <invoice.json> [--resources snapshot.json] [--json]');
      const invoice = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      const resPath = flag(rest, 'resources');
      const resources = resPath ? loadSnapshot(resPath) : undefined;
      const result = validate(invoice, { resources });
      if (has(rest, 'json')) console.log(JSON.stringify(result, null, 2));
      else console.log(formatResult(result));
      process.exit(result.ok ? 0 : 1);
      break;
    }
    case 'irn': {
      const [invoiceNumber, serviceId, issueDate] = rest;
      if (!invoiceNumber || !serviceId || !issueDate) fail('Usage: nrs-mbs irn <invoiceNumber> <serviceId> <issueDate>');
      console.log(buildIrn({ invoiceNumber, serviceId, issueDate }));
      break;
    }
    case 'qr': {
      const irn = flag(rest, 'irn');
      const keysFile = flag(rest, 'keys');
      if (!irn || !keysFile) fail('Usage: nrs-mbs qr --irn <IRN> --keys <key-file.json> [--timestamp N] [--png out.png]');
      const keys = JSON.parse(readFileSync(keysFile, 'utf8')) as { public_key: string; certificate: string };
      const tsRaw = flag(rest, 'timestamp');
      const timestamp = tsRaw ? Number(tsRaw) : undefined;
      const out = buildQrPayload({ irn, keys, timestamp });
      const png = flag(rest, 'png');
      if (png) {
        await qrPng(out.payload, png);
        console.log(`Wrote ${png}`);
      } else {
        console.log(out.payload);
      }
      break;
    }
    case 'resources': {
      if (rest[0] !== 'fetch') fail('Usage: nrs-mbs resources fetch --out snapshot.json');
      const out = flag(rest, 'out') ?? 'nrs-resources.snapshot.json';
      const apiKey = process.env.NRS_API_KEY;
      const apiSecret = process.env.NRS_API_SECRET;
      if (!apiKey || !apiSecret) fail('Set NRS_API_KEY and NRS_API_SECRET in the environment. They come from the taxpayer dashboard on the NRS e-invoicing portal.');
      const client = new MbsClient({ apiKey, apiSecret, baseUrl: process.env.NRS_BASE_URL });
      const snap = await fetchSnapshot(client);
      saveSnapshot(out, snap);
      console.log(`Saved ${out} from ${client.baseUrl}`);
      break;
    }
    case 'example': {
      const invoice = buildInvoice({
        businessId: '00000000-0000-4000-8000-000000000000',
        serviceId: '94ND90NR',
        invoiceNumber: 'INV2026001',
        issueDate: '2026-10-31',
        issueTime: '10:00:00',
        kind: 'B2B',
        typeCode: '381',
        supplier: {
          party_name: 'Example Supplies Ltd',
          tin: '12345678-0001',
          email: 'accounts@example-supplies.ng',
          telephone: '+2348012345678',
          business_description: 'Office equipment and IT services',
          postal_address: { street_name: '17 Harper Crescent, Wuse', city_name: 'Abuja', postal_zone: '900288', lga: 'NG-FC-AML', state: 'NG-FC', country: 'NG' },
        },
        customer: {
          party_name: 'Example Buyer Ltd',
          tin: '87654321-0001',
          email: 'ap@example-buyer.ng',
          telephone: '+2348098765432',
          business_description: 'Manufacturing',
          postal_address: { street_name: '10 Industrial Avenue', city_name: 'Isheri', postal_zone: '110001', lga: 'NG-OG-IFO', state: 'NG-OG', country: 'NG' },
        },
        lines: [
          { kind: 'goods', code: '8471.50', category: 'Automatic data processing units', name: 'Desktop computer', quantity: 2, unitPrice: 450000 },
          { kind: 'service', code: '6201', category: 'Computer programming activities', name: 'Setup and configuration', quantity: 1, unitPrice: 150000 },
        ],
      });
      console.log(JSON.stringify(invoice, null, 2));
      break;
    }
    default:
      console.log(USAGE);
      process.exit(cmd ? 1 : 0);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
