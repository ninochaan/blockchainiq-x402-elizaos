# Blockchain IQ for ElizaOS — pay-per-call crypto data over x402

An ElizaOS **plugin** that buys crypto market data from
[Blockchain IQ](https://www.blockchainiq.co/agents) one call at a time,
paying in USDC on Base through the open **x402** protocol (HTTP 402 +
EIP-3009). No account, no API key — a wallet is the only credential.

**Bounty:** this repository is an entry for the
[Blockchain IQ x402 build bounties](https://www.blockchainiq.co/blog/x402-build-bounties),
**ElizaOS slot** ("a plugin"). It qualifies with a working paid call to one
of the two bounty resources:

| Resource | Path | Price |
| --- | --- | --- |
| Market brief | `GET /api/x402/v1/brief` | **$0.01** |
| Event risk | `GET /api/x402/v1/event-risk` | **$0.05** |

## What the plugin registers

- **Action `FETCH_BLOCKCHAINIQ_RESOURCE`** — fetches a Blockchain IQ
  resource, paying through x402 when it is paid. Handler options:
  `resource` (catalogue name `brief` / `event-risk`, a path such as
  `/macro`, or a full URL; default `brief`) and `maxUsdc` (spend guard,
  default $0.10). The action result and callback carry a JSON string:
  `{resource, paid, amount_usd, settlement, data}`, where `settlement` is
  the decoded `PAYMENT-RESPONSE` header (it carries the settlement
  transaction hash — the proof a bounty claim needs).
- **Provider `BLOCKCHAINIQ_CATALOGUE`** — lists the qualifying resources
  and the free catalogue URL.

## How the x402 flow works here

`src/x402.ts` is a small self-contained x402 v2 client built on viem:

1. **Unpaid call.** `GET` the resource with no payment header.
2. **HTTP 402.** The server replies `402 Payment Required` with a base64
   `PAYMENT-REQUIRED` header: `{x402Version: 2, accepts: [...]}`. The Base
   entry is `scheme: "exact"`, `network: "eip155:8453"`, `amount: "10000"`
   (atomic USDC — $0.01 for `brief`), `asset: 0x833589fC…2913` (USDC on
   Base), `payTo: 0x617dA938…7C9e`, and `extra: {name: "USD Coin",
   version: "2"}` — the token's EIP-712 domain fields.
3. **Sign.** The client builds an EIP-3009 `TransferWithAuthorization`
   (from = your wallet, to = `payTo`, value = amount, validity window from
   `maxTimeoutSeconds`, random 32-byte nonce) and signs it as EIP-712 typed
   data with domain `{name: "USD Coin", version: "2", chainId: 8453,
   verifyingContract: <USDC>}` via viem's `signTypedData`. Signing is
   offline; nothing is broadcast.
4. **Paid retry.** The request is repeated with the base64 payment payload
   in the `PAYMENT-SIGNATURE` header. A facilitator submits the
   authorization on-chain (gasless for the payer) and the server returns
   `200` with the JSON data and a `PAYMENT-RESPONSE` settlement header.

## Install

```bash
npm install
npm run build
```

Add the plugin to your ElizaOS character/agent in the usual way (the
default export of `dist/index.js` is the plugin object).

> **Toolchain note:** `@elizaos/core` 1.7.x's published type barrels use
> extensionless directory re-exports that TypeScript's `NodeNext`
> resolution cannot follow; this repo compiles with
> `moduleResolution: "bundler"` (the resolution ElizaOS's own toolchain
> uses) and explicit `.js` import suffixes, so the emitted ESM still runs
> under plain Node.

## Configure

The signing key comes **only** from the environment:

```bash
export X402_PRIVATE_KEY=0x...   # dedicated wallet, a little USDC on Base
```

Use a dedicated wallet with a small balance, never a main wallet. The key
is never hardcoded, logged or committed; `.env` is git-ignored (see
`.env.example`).

## Run the demo

```bash
npm run build
node dist/demo.js            # buys the market brief ($0.01)
node dist/demo.js event-risk # buys event risk ($0.05)
```

The demo drives the plugin's action handler directly with a stub message —
no full ElizaOS runtime needed.

## Verify locally (no funds, nothing broadcast)

```bash
npm run build
node scripts/verify.mjs
```

Checks (see `VERIFICATION.md` for recorded output):

- **(a)** the unpaid call to the real endpoint returns 402 and the payment
  requirements parse to the expected amount / asset / network / payTo /
  EIP-712 domain;
- **(b)** a payment payload built from those requirements is a well-formed
  EIP-3009 authorization, signed offline with the public Hardhat test key,
  and the signature verifies for the test account (viem `verifyTypedData`)
  — the payload is never sent;
- **(c)** the plugin's exports load in Node: plugin object, action and
  provider are present and shaped correctly.

## Claiming the bounty

Make one real paid call with a funded wallet (the demo above), then email
**partnerships@blockchainiq.co** with this repository's link and the
settlement transaction hash from the `PAYMENT-RESPONSE` header. Claims are
checked in email-arrival order; the round closes 31 Dec 2026, 11:59 PM
Central. First passing claim overall is paid $150, the next three $125
each, in USDC on Base.

## License

MIT
