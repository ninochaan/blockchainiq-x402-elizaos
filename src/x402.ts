/**
 * Minimal x402 v2 client core for the Blockchain IQ data API.
 *
 * Implements the "exact" payment scheme on EVM (Base, eip155:8453) with
 * USDC paid via an EIP-3009 `transferWithAuthorization` signature:
 *
 * 1. GET a paid resource with no payment header.
 * 2. The server answers HTTP 402 with a base64 `PAYMENT-REQUIRED` header
 *    naming the scheme, network, amount, asset, payTo address and the
 *    EIP-712 domain fields (`extra.name` / `extra.version`) of the token.
 * 3. This module parses those requirements, builds an EIP-3009
 *    authorization, signs it with the key from the `X402_PRIVATE_KEY`
 *    environment variable and retries with a base64 `PAYMENT-SIGNATURE`
 *    header.
 * 4. The server settles gaslessly and returns the JSON data plus a
 *    `PAYMENT-RESPONSE` header carrying the settlement proof (tx hash).
 *
 * The private key is read from the environment at runtime only; it is
 * never stored, logged or committed. Signing is offline (viem); nothing
 * is broadcast by this module — the server's facilitator submits the
 * authorization.
 */
import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

export const BASE_URL = "https://www.blockchainiq.co/api/x402/v1";
export const EVM_NETWORK = "eip155:8453"; // Base mainnet
export const PRIVATE_KEY_ENV = "X402_PRIVATE_KEY";
const USDC_DECIMALS = 6;

/** The two resources a Blockchain IQ build-bounty claim may call. */
export const QUALIFYING_RESOURCES: Record<string, { path: string; priceUsd: number }> = {
  brief: { path: "/brief", priceUsd: 0.01 },
  "event-risk": { path: "/event-risk", priceUsd: 0.05 },
};

export interface PaymentRequirement {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, string>;
}

export interface PaymentRequired {
  x402Version: number;
  error?: string;
  resource?: Record<string, unknown>;
  accepts: PaymentRequirement[];
}

export interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  resource?: Record<string, unknown>;
  accepted: PaymentRequirement;
  payload: { signature: Hex; authorization: Authorization };
}

export interface FetchResult {
  status: number;
  data: unknown;
  paid: boolean;
  amountUsd?: number;
  settlement?: unknown;
  paymentPayload?: PaymentPayload;
}

export class X402Error extends Error {}

export function decodePaymentRequired(headerValue: string): PaymentRequired {
  return JSON.parse(Buffer.from(headerValue, "base64").toString("utf8")) as PaymentRequired;
}

export function selectEvmRequirement(
  paymentRequired: PaymentRequired,
  network: string = EVM_NETWORK,
): PaymentRequirement {
  const req = paymentRequired.accepts.find(
    (r) => r.scheme === "exact" && r.network === network,
  );
  if (!req) {
    throw new X402Error(
      `No 'exact' requirement for network ${network}; got: ${paymentRequired.accepts
        .map((r) => r.network)
        .join(", ")}`,
    );
  }
  return req;
}

/** EIP-712 domain of the payment token, taken from the 402 requirement. */
export function eip712Domain(req: PaymentRequirement) {
  return {
    name: req.extra?.name,
    version: req.extra?.version,
    chainId: Number(req.network.split(":").pop()),
    verifyingContract: req.asset as Address,
  } as const;
}

export function requirementAmountUsd(req: PaymentRequirement): number {
  return Number(req.amount) / 10 ** USDC_DECIMALS;
}

export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export function buildAuthorization(
  req: PaymentRequirement,
  fromAddress: string,
  now?: number,
  nonce?: Hex,
): Authorization {
  const nowSec = now ?? Math.floor(Date.now() / 1000);
  return {
    from: fromAddress,
    to: req.payTo,
    value: String(req.amount),
    validAfter: String(Math.max(0, nowSec - 600)),
    validBefore: String(nowSec + (req.maxTimeoutSeconds ?? 300)),
    nonce: nonce ?? (`0x${randomBytes(32).toString("hex")}` as Hex),
  };
}

/** Build and sign the full x402 v2 payment payload. Fully offline. */
export async function buildPaymentPayload(
  paymentRequired: PaymentRequired,
  privateKey: Hex,
  now?: number,
  nonce?: Hex,
): Promise<PaymentPayload> {
  const req = selectEvmRequirement(paymentRequired);
  const account = privateKeyToAccount(privateKey);
  const authorization = buildAuthorization(req, account.address, now, nonce);
  const signature = await account.signTypedData({
    domain: eip712Domain(req),
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from as Address,
      to: authorization.to as Address,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });
  return {
    x402Version: paymentRequired.x402Version ?? 2,
    scheme: req.scheme,
    network: req.network,
    resource: paymentRequired.resource,
    accepted: req,
    payload: { signature, authorization },
  };
}

export function encodePaymentHeader(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function resourceUrl(resource: string): string {
  if (resource.startsWith("http://") || resource.startsWith("https://")) return resource;
  if (resource in QUALIFYING_RESOURCES) return BASE_URL + QUALIFYING_RESOURCES[resource].path;
  return BASE_URL + (resource.startsWith("/") ? resource : `/${resource}`);
}

/** Unpaid probe: fetch a URL and decode any PAYMENT-REQUIRED header. */
export async function getPaymentRequirements(
  url: string,
): Promise<{ status: number; paymentRequired: PaymentRequired | null }> {
  const res = await fetch(url);
  const header = res.headers.get("payment-required");
  return { status: res.status, paymentRequired: header ? decodePaymentRequired(header) : null };
}

/**
 * Fetch a Blockchain IQ resource, paying through x402 if it is paid.
 * The key defaults to the X402_PRIVATE_KEY environment variable;
 * `maxAmountUsd` is a spend guard.
 */
export async function fetchPaidResource(
  resource: string,
  opts: { privateKey?: Hex; maxAmountUsd?: number } = {},
): Promise<FetchResult> {
  const url = resourceUrl(resource);
  const first = await fetch(url);
  if (first.status === 200) {
    return { status: 200, data: await first.json(), paid: false };
  }
  if (first.status !== 402) {
    throw new X402Error(`Unexpected status ${first.status} from ${url}`);
  }
  const header = first.headers.get("payment-required");
  if (!header) throw new X402Error("HTTP 402 without a PAYMENT-REQUIRED header");
  const paymentRequired = decodePaymentRequired(header);
  const req = selectEvmRequirement(paymentRequired);
  const amountUsd = requirementAmountUsd(req);
  if (opts.maxAmountUsd !== undefined && amountUsd > opts.maxAmountUsd) {
    throw new X402Error(
      `Refusing to pay $${amountUsd.toFixed(2)} for ${url}: above the $${opts.maxAmountUsd.toFixed(2)} per-call cap`,
    );
  }
  const key = (opts.privateKey ?? process.env[PRIVATE_KEY_ENV]) as Hex | undefined;
  if (!key) {
    throw new X402Error(
      `No signing key: set the ${PRIVATE_KEY_ENV} environment variable (a dedicated wallet holding a little USDC on Base)`,
    );
  }
  const payload = await buildPaymentPayload(paymentRequired, key);
  const paidRes = await fetch(url, {
    headers: { "PAYMENT-SIGNATURE": encodePaymentHeader(payload) },
  });
  if (paidRes.status !== 200) {
    throw new X402Error(`Paid retry failed with status ${paidRes.status}`);
  }
  let settlement: unknown;
  const respHeader = paidRes.headers.get("payment-response");
  if (respHeader) {
    try {
      settlement = JSON.parse(Buffer.from(respHeader, "base64").toString("utf8"));
    } catch {
      settlement = { raw: respHeader };
    }
  }
  return {
    status: 200,
    data: await paidRes.json(),
    paid: true,
    amountUsd,
    settlement,
    paymentPayload: payload,
  };
}
