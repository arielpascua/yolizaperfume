# Yoliza — wholesale perfumery

A B2B perfume site: a public catalogue with **no prices**, a **trade enquiry** form, and **one
open checkout at `/checkout`** where the trade prices are shown and orders are paid by card. Built on the same stack as the Taruuv
storefront it was copied from (Next.js 15 App Router, React 19, Tailwind 3, Vitest, Playwright),
with a new domain (fragrances, volumes, cases) and a new look (see [Design](#design)).

## Quick start

Requires Node 20.19 or newer (20.19+, 22.13+ or 24+; `package.json` `engines` says the same).

```bash
npm install
npm run dev
```

Open http://localhost:3000. Nothing else is needed to run locally:

- Enquiries and orders are written to `./.data/*.jsonl` (development only; see [Storage](#storage)).
- The checkout is at http://localhost:3000/checkout (invoice mode: no card is charged locally).

## How the site works

| Page | What it is |
|---|---|
| `/` | Home: hero, family index, four featured strips, how trade works. |
| `/collection` | All 15 fragrances. Filter by family, wear and strength; search notes. **No prices.** |
| `/fragrance/<slug>` | One fragrance: scent ladder (top, heart, base), story, volumes and case packs. **No prices.** |
| `/enquiry` | Trade enquiry: business details, optional fragrances and indicative cases, optional samples. |
| `/trade`, `/about`, `/legal/*` | How trade works, the house, privacy and trade terms. |
| `/checkout` | **The one checkout.** Open to everyone; the only page that shows prices. `noindex`. |

### The checkout: one open page at `/checkout`

There is exactly one checkout route, `app/checkout/page.tsx`, and it is **open to everyone**: no order link,
no token, no login. There is no `/checkout/<anything>` (those are 404), no cart, and the catalogue shows no
price: **`/checkout` is the only page that shows prices**, so they are always in one place. The header, the
footer and the home page lead to it. It is `noindex` (it is for buyers, not for search).

Because anyone can call it, everything that used to rest on a signed link now rests on the server:

- **Prices are server-side only.** The browser sends ids and case counts; any price it sends is ignored, and
  the server recomputes everything (`lib/pricing.ts`) before an order is filed or a payment created.
- **Order creation is capped**, per source (default 5 per 10 minutes) and globally (default 30 per 10
  minutes), configured with `CHECKOUT_IP_ORDERS_PER_10MIN` and `CHECKOUT_ORDERS_PER_10MIN`. The caps are spent
  only by a genuine order about to be filed (after the quote, the minimum and the phone checks), never by
  invalid requests. The per-source cap reads a forwarding header the client can influence, so it only raises
  the bar; the **global cap is the real backstop and cannot be spoofed**. The cost is accepted and real: a
  determined caller can use up the global allowance and pause ordering for up to ten minutes. That costs
  availability, never money or data. There is also a per-IP request limit and a honeypot field.
- **Unpaid orders cannot pile up unseen**: abandoned checkouts become pending rows that the sweeper keeps
  checking, with separate budgets and round-robin so they cannot starve real work (see Card payment).

`link_id` in `yz_orders` is kept for the table's shape: orders made while a signed link was required hold that
link's id, and every newer order holds `public`. The signed-link system (and `npm run link`) has been removed.

### Test mode: a PHP 10 test item only

Set `CHECKOUT_TEST_ITEM=1` (exactly `1`) and `/checkout` offers **only a single PHP 10 test item**: no other
fragrance can be ordered (the API refuses it), there is **no volume discount**, and the minimum order drops to
PHP 10. That lets you prove a live payment end to end for ten pesos. **It is a real payment: the card is
charged.** A banner on the page says so. Remove the variable and the real catalogue and the real minimum are
back, with no code change:

```bash
railway variables --service yoliza-web --set "CHECKOUT_TEST_ITEM=1"   # test mode on  (Railway redeploys)
railway variable delete CHECKOUT_TEST_ITEM --service yoliza-web       # back to the real catalogue
```

The test item exists only in `lib/pricing.ts`: it is not in the public catalogue and cannot be ordered unless
the variable is set. Turn test mode **off** before announcing the site.

### Orders and pricing

- Orders are placed in **whole cases**. A case is a fixed number of bottles of one fragrance in one
  volume (10 ml: 24, 30 ml: 12, 50 ml: 12, 100 ml: 6; `lib/catalog/data.ts`).
- **Prices live in one place**, `lib/pricing.ts`, and are server-side only. The browser sends ids and
  case counts; any price it sends is ignored. Only `/checkout` shows prices, and the public pages never
  import the price table (a test enforces it).
- A **volume discount** applies to the whole order by total cases (10: 5%, 25: 10%, 60: 15%) and a
  **minimum order** of ₱20,000 applies after the discount. Both are constants in `lib/pricing-math.ts`.
- Totals are **before freight and any applicable taxes**; the invoice states them.
- There are two ways to take money, chosen by `PAYMENT_PROVIDERS`: **invoice mode** (the default) and
  **card mode** (Hexacorp). See [Card payment](#card-payment-hexacorp-live-only).
- In invoice mode an order is filed `pending` and a person sends an invoice. Set `PAYMENT_INSTRUCTIONS`
  (server variable) to show bank details on the confirmation.

### Card payment (Hexacorp, live only)

Set `PAYMENT_PROVIDERS=hexacorp` and the checkout takes **credit cards through Hexacorp's hosted page**.
The integration is ported from the Veloure storefront, minus its consumer-fraud rules (card velocity, IP
caps, decline breaker, address book). `/checkout` is open to everyone, so it has its own creation caps
(see above).

> **Live only. There is no sandbox.** There is no test host, no mode switch and no simulated outcome in
> this codebase (a test fails if one appears). Every order placed in card mode is a REAL card charge.
> The unit tests stub `fetch` and never reach Hexacorp. Do a first, small, real payment yourself before
> opening the site to customers.

**The flow**

1. The buyer submits the order on `/checkout`. The server prices the basket from
   ids and case counts (any price in the request is ignored), files the order `pending`, then asks Hexacorp
   to create a card payment for the order total (a decimal-peso **string**, `"31680.00"`, never centavos).
2. The browser receives a `redirectUrl` and, **only if it is `https` on `hexacorp.xyz`**, does a full-page
   redirect to Hexacorp's hosted page. The poll token and the reference are kept in that
   browser's `sessionStorage`, nowhere else.
3. Hexacorp POSTs the result to `/api/webhooks/hexacorp?k=<HEXACORP_WEBHOOK_SECRET>`. **The webhook is
   treated as unsigned**: Hexacorp documents no signature. The secret in the URL is compared in constant
   time, and the delivered `status` and `amount` are **never read**. The delivery is only a signal to
   re-check.
4. Reconciliation (`lib/server/paymentReconcile.ts`, shared by the webhook and the sweeper) asks Hexacorp's
   **authenticated Transaction Inquiry**, keyed on the `reference_number` stored on the order, and marks the
   order `paid` only if the status is `success`, the reported amount **equals the order total** (a missing
   amount blocks too) and the record does not name a different order. Nothing else in the codebase can set
   `paid` (`test/payment-guard.test.ts`). Writes are idempotent: a `paid` order is never revisited.
5. **A sweeper** (`POST /api/admin/orders/reconcile`, `Authorization: Bearer <RECONCILE_SECRET>`, 16+
   characters) re-checks unpaid card orders, because a lost webhook must not leave a paid order unsettled.
   - **`failed` is not final.** A declined payer can retry on Hexacorp's page and succeed, so recently
     `failed` orders that hold a Hexacorp reference are re-checked for two days, and a `paid` result that
     loses a write race to a late decline is re-applied rather than dropped.
   - **It cannot be starved.** Abandoned checkouts stay `pending` for the whole window, so one oldest-first
     list could fill up and never reach newer orders. Pending and failed orders have **separate budgets**
     (40 and 20 per run) and each is **round-robin** (least recently checked first, `last_checked_at`, updated
     even when an order's reconcile throws), so every order is reached in turn. A run that fills a budget
     returns `truncated: true` and the job warns: a backlog that persists means too many abandoned checkouts.
   - **It is loud.** `.github/workflows/reconcile-payments.yml` runs every 30 minutes and **fails the run**
     whenever an order **needs attention**: a refused amount, a payment that names another order, a card
     order with no stored Hexacorp reference, a status it cannot map, or contradictory records. A real
     payment may be unsettled in each of those, and a red run is the alarm. A reconcile that throws (for
     example a Hexacorp answer it cannot read) is an error and fails the run too. Add the `RECONCILE_SECRET`
     repository secret and the `SITE_URL` variable (https).
   - **Not watched by the schedule:** a confirmed payment on an order a person has already cancelled,
     invoiced or shipped. The reconcile flags it as unresolved when asked about that order
     (`POST .../reconcile?ref=YZ-...` accepts any status, and the webhook logs it), but the scheduled sweep
     only lists open (`pending` and recently `failed`) orders. Close an order by hand with care.
6. `/payment/return` polls `GET /api/orders/<ref>?token=...` and shows a confirmation only when the **server**
   reports `paid`. A query parameter is never proof of anything.

**Failure behaviour.** Listed in `PAYMENT_PROVIDERS` but missing credentials, the webhook secret or
`NEXT_PUBLIC_SITE_URL` (always required in card mode, https, in every environment: the request's Host header
never decides where Hexacorp calls back): checkout answers **503 and files nothing**; it never falls back to
invoice mode. If Hexacorp rejects the create, the order is marked `failed` and the buyer is told nothing was
charged.

**The buyer is sent to pay only when the payment can be found again.** Inquiry is keyed on Hexacorp's
`reference_number` and nothing else (there is no fallback to our own reference). So the checkout hands out a
payer page only if Hexacorp returned a `reference_number`, the page is an https URL on `hexacorp.xyz` (checked
on the server as well as in the browser), **and storing that reference succeeded**. Otherwise the order is
failed and no payment page is shown. If a reference exists that the order could not store, the log carries
`ORPHANED PAYMENT RISK` with Hexacorp's reference so a person can match it by hand.

**Set up** (`.env.example` has each variable with comments): `PAYMENT_PROVIDERS=hexacorp`,
`HEXACORP_APP_UUID`, `HEXACORP_USERNAME`, `HEXACORP_SECRET`, `HEXACORP_WEBHOOK_SECRET` (16+ characters),
`RECONCILE_SECRET`, and `NEXT_PUBLIC_SITE_URL` (the https origin of this deployment; required, no fallback). Migration
`0002_yz_orders_card_payment.sql` is applied automatically at start. Hexacorp checks the callback URL for reachability when a
payment is created, so a `localhost` origin never works: test on a public deployment, or point `NEXT_PUBLIC_SITE_URL` at a public https tunnel.

**Things Hexacorp has not documented, to confirm on the first real payment**

- *Where the payer goes afterwards.* The create request has no return-URL field. `/payment/return` therefore
  works with or without a `ref` parameter (it falls back to the reference this browser stored). Nothing is at
  risk if the payer never returns: settlement depends only on the webhook and the sweeper.
- *Card limits.* Trade orders can be large. Ask Hexacorp for the maximum amount per card transaction.
- *Philippine mobile numbers only.* The payment requires `mobile_number` as `09XXXXXXXXX` or `639XXXXXXXXX`
  (`lib/phone.ts` normalises punctuation). An overseas buyer cannot pay by card this way.
- *Webhook signing and retry schedule.* Unknown, which is why the sweeper exists.
- *A create that times out.* Every Hexacorp call has a 15 second ceiling. If a CREATE times out, Hexacorp may still
  have made the transaction, and with no `reference_number` it cannot be looked up. That order is deliberately
  left **pending** (not failed), the buyer is told the payment could not be started, and the scheduled sweep
  reports it as `unreferenced`, which turns the run red. Check Hexacorp's records for that order reference: if
  nothing exists, mark the order cancelled by hand; if a transaction exists, record its reference number on the
  order. The same applies to the `ORPHANED PAYMENT RISK` log line.
- *Anyone can place an order.* `/checkout` is open, so each card order is a real payment attempt and an unpaid
  row to sweep, and nothing but the server protects them. Creation is capped per source and globally (see
  "The checkout"); the global cap is the backstop. Watch the `[order] order creation cap reached` log line: if you
  see it often, someone is hammering the page.
- Watch the logs for `[hexacorp] unmapped or conflicting transaction status`, `... returned no payer-facing URL`
  and `... transaction inquiry response shape`.

> **The owner must confirm every fragrance, note list, case pack, price, discount break and minimum
> in `lib/catalog/data.ts` and `lib/pricing*.ts` against real stock and terms before taking orders,
> and review the wording on `/legal/*`.** They are launch placeholders.

### Enquiries

`POST /api/enquiry` saves a trade enquiry (and its optional lines, as a name snapshot with **no price**).
The visitor is told it was sent **only when it was saved**; otherwise the form says it could not be sent
and keeps what they typed. Contact details are never written to the server log. Both endpoints are rate
limited per IP (in memory, per server instance), have a honeypot field and cap the body at 64 KB.

## Storage

Enquiries are saved by `lib/server/store.ts` and orders by `lib/server/orders.ts` (orders must be read back
and moved between states, so they have their own module). There are two backends:

1. **Postgres (Railway)**, when `DATABASE_URL` is set. This is production. One pooled connection
   (`lib/db/pool.ts`, server only), every query parameterised, and a header and its lines are written in
   **one transaction**, so a half-written order or enquiry cannot exist. On Railway `DATABASE_URL` is a
   reference to the Postgres service (`${{Postgres.DATABASE_URL}}`), which resolves to its **private**
   address: the database is not exposed to the internet.
2. **Local files** under `LOCAL_STORE_DIR` (`enquiries.jsonl`, and one `orders/<reference>.json` per order),
   for development and the e2e run. `npm run dev` defaults it to `./.data`. A production build refuses it unless
   `ALLOW_LOCAL_STORE=1` is also set (the e2e run does), so a stray variable can never send real orders to a
   folder on one server instance.
3. Neither: both endpoints answer **503** ("nothing has been sent"). A missing order is never silent. A
   database that is configured but unreachable is the same 503, and the log carries only an error code.

### Migrations

`db/migrations/*.sql` are applied by `scripts/migrate.mjs` (`npm run migrate`), each exactly once, in order,
tracked in a `schema_migrations` table, each in one transaction with its bookkeeping row, behind a Postgres
advisory lock. **`npm start` runs them automatically before the server starts** (`scripts/start.mjs`): the
schema always matches the code, with no step to forget. A failed migration exits non-zero and the server never
starts, so the previous deployment keeps serving. (Railway's pre-deploy hook and `railway.json` were found not
to be applied to this service, which is why this lives in the start command.) With no `DATABASE_URL`, `npm start`
skips migrating and warns in production.

### Reading orders and enquiries

There is no admin page, inbox or notification. Read the tables in Postgres: in Railway open the **Postgres**
service, then **Data**, and browse `yz_orders`, `yz_order_items`, `yz_enquiries`, `yz_enquiry_items`; or connect
any client with the service's credentials. Decide who looks, and how often. The integration tests are in
`lib/server/db.integration.test.ts` (see [Testing](#testing)).

## Deploying to Railway

The project is `yoliza-perfume`, with two services: **`yoliza-web`** (this app, built by Railpack) and
**`Postgres`**. From this folder:

```bash
railway status            # CHECK it says yoliza-perfume. A parent folder may be linked to another project.
railway up --ci --service yoliza-web
```

Variables on `yoliza-web` (names only; see `.env.example` for each):

| Variable | Value |
|---|---|
| `DATABASE_URL` | the reference `${{Postgres.DATABASE_URL}}` |
| `CHECKOUT_TEST_ITEM` | `1` for test mode (a PHP 10 test item only); **delete it to sell the real catalogue** |
| `NEXT_PUBLIC_SITE_URL` | the https origin of the site (**baked in at build time**: set it before deploying, and redeploy if it changes) |
| `HEXACORP_WEBHOOK_SECRET`, `RECONCILE_SECRET` | random; only used once card payment is switched on |
| `PAYMENT_PROVIDERS`, `HEXACORP_APP_UUID`, `HEXACORP_USERNAME`, `HEXACORP_SECRET` | **left unset**: invoice mode until you have Hexacorp credentials |

## Configuration

See `.env.example`. Nothing is required in development.

| Variable | Purpose |
|---|---|
| `CHECKOUT_TEST_ITEM` | `1`: test mode, only a PHP 10 test item is orderable. Unset: the real catalogue. |
| `CHECKOUT_IP_ORDERS_PER_10MIN` / `CHECKOUT_ORDERS_PER_10MIN` | Order creation caps, per source and global (defaults 5 and 30). |
| `CHECKOUT_RATE_LIMIT_PER_MIN` / `ENQUIRY_RATE_LIMIT_PER_MIN` | Per-IP limits (defaults 20 and 5). |
| `PAYMENT_PROVIDERS` | Blank: invoice mode. `hexacorp`: card mode (live only). |
| `HEXACORP_APP_UUID`, `HEXACORP_USERNAME`, `HEXACORP_SECRET` | Hexacorp credentials (server only). |
| `HEXACORP_WEBHOOK_SECRET`, `RECONCILE_SECRET` | Authenticate the webhook URL and the sweeper (server only). |
| `DATABASE_URL` | Postgres connection (Railway: `${{Postgres.DATABASE_URL}}`). Unset: no database. |
| `LOCAL_STORE_DIR` | Local file store (dev and e2e). |
| `PAYMENT_INSTRUCTIONS` | Shown on the order confirmation. |
| `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CONTACT_EMAIL` | Canonical URL; contact email (hidden when blank). |

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js. |
| `npm run typecheck` / `lint` / `test` | `tsc`, ESLint, Vitest (unit, component, route and source-guard tests). |
| `npm run test:e2e` | Playwright on desktop and a 360 px viewport (builds and serves on port 3100). |
| `npm run predeploy` | typecheck, lint, test and build. |

## Design

Nothing here is Taruuv's look. The house style is a perfumer's cabinet:

- **Palette:** aubergine-black *nuit*, warm *papier*, gold *or* (only on nuit) and *bordeaux* (only on
  papier). Every text pairing is contrast-tested in `lib/design/tokens.test.ts`.
- **Type:** Bodoni Moda (display, italic), Hanken Grotesk (text) and IBM Plex Mono for laboratory
  labels, all self-hosted through Fontsource (no font request leaves the site).
- **Signature pieces:** the **blotter strip** product card (a paper test strip, punched and torn),
  the **scent ladder** (top → heart → base), the **order matrix** and the **order docket** on the private
  checkout, and **inline-SVG bottles** drawn from a silhouette, a liquid colour and a cap finish. There are
  no photographs, so no image is ever a stand-in for a different product.

## Testing

`npm test` covers pricing (including test mode), the order creation caps, request
parsing (control and bidi characters, smuggled prices, honeypot), both API routes, filters, the
components, the Hexacorp client and the whole payment path (webhook, reconcile, sweeper, polling, return page,
redirect validation), and source guards:

- `test/b2b-guard.test.ts`: **public source shows no price**, **`/checkout` is the one open route and no order
  link exists**, and **the test item exists only in the pricing module**.
- `test/payment-guard.test.ts`: **there is no sandbox**, **only the reconcile path can set `paid`**, **the
  webhook never reads the delivered status or amount**, and **no gateway secret reaches the browser**.

No automated test reaches Hexacorp: `fetch` is stubbed, because there is no test environment to call.

**Real-database tests.** `lib/server/db.integration.test.ts` (15 tests: atomic rollback, the unique payment id,
concurrent writers, the sweep's ordering and budgets, SQL-injection safety, an unreachable database) runs against
a real Postgres, and is **skipped unless `TEST_DATABASE_URL` is set**, so `npm test` needs no database. It works
only inside a throwaway schema it creates and drops, so it can safely be pointed at a live database. The Railway
database has no public address, so run it inside the service's private network:

```bash
railway ssh --service yoliza-web -- "cd /app && TEST_DATABASE_URL=\$DATABASE_URL npx vitest run lib/server/db.integration.test.ts"
```
