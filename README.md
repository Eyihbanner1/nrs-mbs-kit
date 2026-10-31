# nrs-mbs-kit

Developer kit for Nigeria's NRS e-invoicing system, the Merchant Buyer Solution (MBS).

Every VAT-registered business in Nigeria is being moved onto this format in phases. Large taxpayers are already on it, medium taxpayers (₦1bn to ₦5bn turnover) went live in July 2026 with enforcement from January 2027, and every other business joins from 1 July 2027. Each invoice has to be sent to the tax office as a strict JSON document, get an Invoice Reference Number (IRN), and carry an encrypted QR code.

This kit does the fiddly parts so your accounting app, shop system or script does not have to work them out alone:

- **Build** a complete invoice JSON from the things you know: who sold what to whom, at what price. Totals, VAT and the IRN are computed for you.
- **Validate** an invoice offline, before you spend a sandbox call, with plain-English messages that say which field is wrong and what to do.
- **IRN** helpers: build, parse and explain `INV001-94ND90NR-20261031`.
- **QR** payload: the RSA-encrypted stamp the tax office expects, from the taxpayer's own key file.
- **Resources** loader: fetch and cache the official code lists (HS codes, service codes, states, LGAs, tax categories, invoice types) and validate against them.
- **Client** for the gateway's four-step flow: validate IRN, validate invoice, sign, confirm.

Zero runtime dependencies. Node 22.6 or newer. MIT licence.

## Status: alpha

Honest version of where this stands:

- The builder, validator, IRN and QR modules are tested offline and match the published format from the NRS, NIBSS, Pronalytics and Yona documentation.
- The gateway client is written from that documentation but **has not yet been run against the NRS sandbox with real credentials**. If you have sandbox keys, please run it and open an issue with what came back, good or bad.
- The bundled `data/examples.snapshot.json` holds only the handful of codes that appear in public docs. Fetch a real snapshot before validating real invoices.

## What this kit cannot do

It cannot get you an API key, a service ID, a business ID, a public key or a certificate. Those come from the taxpayer's own account on the NRS e-invoicing portal after the business is enabled. It also does not make you an accredited Access Point Provider or System Integrator. Whether a taxpayer may transmit directly with its own keys, or must go through an accredited provider, is something to confirm with NRS. The kit prepares correct documents either way.

## Install

```bash
npm install nrs-mbs-kit
```

Optional, for PNG QR codes:

```bash
npm install qrcode
```

## Quick start

```ts
import { buildInvoice, validate, formatResult, loadExampleSnapshot } from 'nrs-mbs-kit';

const invoice = buildInvoice({
  businessId: '<business id from the NRS dashboard>',
  serviceId: '94ND90NR',            // 8 characters, from the NRS dashboard
  invoiceNumber: 'INV2026001',      // letters and digits only
  issueDate: '2026-10-31',
  kind: 'B2B',
  typeCode: '381',                  // see "Two things the documents disagree on"
  supplier: {
    party_name: 'Example Supplies Ltd',
    tin: '12345678-0001',
    telephone: '+2348012345678',
    postal_address: { street_name: '1 Marina', city_name: 'Lagos', lga: 'NG-LA-LIS', state: 'NG-LA', country: 'NG' },
  },
  customer: {
    party_name: 'Example Buyer Ltd',
    tin: '87654321-0001',
    postal_address: { street_name: '10 Industrial Avenue', city_name: 'Isheri', lga: 'NG-OG-IFO', state: 'NG-OG', country: 'NG' },
  },
  lines: [
    { kind: 'goods', code: '8471.50', category: 'Automatic data processing units', name: 'Desktop computer', quantity: 2, unitPrice: 450000 },
    { kind: 'service', code: '6201', category: 'Computer programming activities', name: 'Setup', quantity: 1, unitPrice: 150000 },
  ],
});

const result = validate(invoice, { resources: loadExampleSnapshot() });
console.log(formatResult(result));
```

A failing invoice prints something like:

```
2 error(s), 0 warning(s).
  ERROR  accounting_supplier_party.telephone: telephone must be in international form starting with "+" and no spaces, for example +2348012345678. Got "08012345678".
  ERROR  invoice_line[0]: Each line needs a classification: hsn_code + product_category for goods, or isic_code + service_category for services.
```

## Command line

```bash
npx nrs-mbs example > invoice.json
npx nrs-mbs validate invoice.json
npx nrs-mbs validate invoice.json --resources my-snapshot.json --json
npx nrs-mbs irn INV2026001 94ND90NR 2026-10-31
npx nrs-mbs qr --irn INV2026001-94ND90NR-20261031 --keys nrs-keys.json --png qr.png

# Fetch the official code lists once you have sandbox credentials
NRS_API_KEY=... NRS_API_SECRET=... npx nrs-mbs resources fetch --out my-snapshot.json
```

`nrs-keys.json` is the file the NRS dashboard gives you under "Manage Cryptographic Keys". It contains `public_key` and `certificate` and no private key.

## Sending to the gateway

```ts
import { MbsClient, SANDBOX_URL } from 'nrs-mbs-kit';

const client = new MbsClient({ baseUrl: SANDBOX_URL, apiKey: process.env.NRS_API_KEY!, apiSecret: process.env.NRS_API_SECRET! });
const outcome = await client.clear(invoice);   // validate IRN -> validate -> sign -> confirm
console.log(outcome.confirm.body);
```

Documented base URLs: sandbox `https://eivc-k6z6d.ondigitalocean.app`, production `https://einvoice1.firs.gov.ng`. Authentication is two headers, `x-api-key` and `x-api-secret`.

## Two things the documents disagree on

The kit treats both of these as data from your resources snapshot, never as built-in constants. A live snapshot from the gateway is the only authority.

1. **Invoice type codes.** NIBSS documentation lists `380` as Commercial Invoice and `381` as Credit Note, which matches the UBL standard. Two live providers, Pronalytics and Yona, list `381` as Commercial Invoice and `380` as Credit Note. The validator reads the meaning from the description text in your snapshot and only then enforces that credit and debit notes carry `billing_reference`.
2. **Tax category ids.** NIBSS lists `STANDARD_GST`, `ZERO_RATED` and `EXEMPT`. Pronalytics and Yona list `STANDARD_VAT`, `REDUCED_VAT`, `ZERO_VAT` and `EXEMPTED`. The validator checks the id and the rate against whatever your snapshot says.

## What the validator checks

Required fields; real dates and times; IRN shape and its date matching `issue_date`; `invoice_kind` and `payment_status` values; a buyer present for B2B, B2G and G2B and absent for B2C; address codes (`lga` must start with `state`, Nigerian addresses use `NG`); E.164 telephones and email shapes; each line classified as goods or service with the right code shape; VAT arithmetic per subtotal; sums across subtotals; line totals, tax-exclusive, tax-inclusive and payable amounts; billing references on credit and debit notes. With a snapshot it also checks every code against the official lists.

## Contributing

Run the tests with one command:

```bash
npm test
```

The most valuable contribution right now is a report from a real sandbox run. Second most valuable is a committed resources snapshot with the full official lists.

## Sources

NRS MBS developer community and portal, NIBSS NInvoiceX documentation, Pronalytics SI reference (invoice schema and worked example), Yona Access Point docs, and the `firs-irn-qr` package for the QR signing steps.
