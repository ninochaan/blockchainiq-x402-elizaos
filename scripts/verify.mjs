#!/usr/bin/env node
/**
 * Local verification for the Blockchain IQ x402 ElizaOS plugin.
 *
 * Proves, WITHOUT spending real funds and without broadcasting anything:
 * (a) an unpaid call to the real Blockchain IQ endpoint returns HTTP 402
 *     and the client parses the payment requirements correctly (amount,
 *     asset, network, payTo, EIP-712 domain fields);
 * (b) the payment payload built from those requirements is a well-formed
 *     EIP-3009 authorization, signed OFFLINE with the public Hardhat/Anvil
 *     test account #0 key (well-known, never funded) — the signature is
 *     verified against the test account address; the payload is never sent;
 * (c) the ElizaOS plugin exports load in Node: the plugin object, its
 *     action and its provider are all present and shaped correctly.
 *
 * Run `npm run build` first. Exit code 0 means every check passed.
 */
import { verifyTypedData } from "viem";
import blockchainIqPlugin, {
  blockchainIqCatalogueProvider,
  fetchBlockchainIqAction,
  BASE_URL,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  buildPaymentPayload,
  eip712Domain,
  encodePaymentHeader,
  getPaymentRequirements,
  requirementAmountUsd,
  selectEvmRequirement,
} from "../dist/index.js";

// Public Hardhat/Anvil test account #0 — test-only, never funded.
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const EXPECTED = {
  amount: "10000",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  network: "eip155:8453",
  payTo: "0x617dA9383fbA67e86137BC4924b8b7E400fB7C9e",
  domainName: "USD Coin",
  domainVersion: "2",
  chainId: 8453,
};

const failures = [];
function check(label, ok, detail = "") {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

console.log("== (a) Live unpaid probe of the real endpoint ==");
const { status, paymentRequired } = await getPaymentRequirements(`${BASE_URL}/brief`);
check("unpaid GET /brief returns HTTP 402", status === 402, `status=${status}`);
if (!paymentRequired) {
  check("PAYMENT-REQUIRED header present", false);
  process.exit(1);
}
check("x402Version is 2", paymentRequired.x402Version === 2);
const req = selectEvmRequirement(paymentRequired);
check("scheme is 'exact'", req.scheme === "exact");
check("network is eip155:8453 (Base)", req.network === EXPECTED.network, req.network);
check("amount is 10000 atomic USDC ($0.01)", req.amount === EXPECTED.amount, req.amount);
check("amount in USD is 0.01", Math.abs(requirementAmountUsd(req) - 0.01) < 1e-12);
check("asset is USDC on Base", req.asset === EXPECTED.asset, req.asset);
check("payTo matches the catalogue rail", req.payTo === EXPECTED.payTo, req.payTo);
const domain = eip712Domain(req);
check("EIP-712 domain name is 'USD Coin'", domain.name === EXPECTED.domainName, domain.name);
check("EIP-712 domain version is '2'", domain.version === EXPECTED.domainVersion, domain.version);
check("EIP-712 chainId is 8453", domain.chainId === EXPECTED.chainId, String(domain.chainId));
check("EIP-712 verifyingContract is the USDC contract", domain.verifyingContract === EXPECTED.asset, domain.verifyingContract);

console.log("\n== (b) Offline payment-payload construction (test key, never sent) ==");
const FIXED_NONCE = `0x${"11".repeat(32)}`;
const payload = await buildPaymentPayload(paymentRequired, TEST_KEY, 1_800_000_000, FIXED_NONCE);
check("payload x402Version is 2", payload.x402Version === 2);
check("payload scheme is 'exact'", payload.scheme === "exact");
check("payload network is eip155:8453", payload.network === EXPECTED.network);
const auth = payload.payload.authorization;
const sig = payload.payload.signature;
check("authorization.from is the test account", auth.from === TEST_ADDRESS, auth.from);
check("authorization.to is payTo", auth.to === EXPECTED.payTo);
check("authorization.value is 10000", auth.value === "10000");
check("validity window is sane", Number(auth.validAfter) < 1_800_000_000 && 1_800_000_000 < Number(auth.validBefore), `${auth.validAfter} < now < ${auth.validBefore}`);
check("signature is 65 bytes hex", (sig.length - 2) / 2 === 65);
const valid = await verifyTypedData({
  address: TEST_ADDRESS,
  domain,
  types: TRANSFER_WITH_AUTHORIZATION_TYPES,
  primaryType: "TransferWithAuthorization",
  message: {
    from: auth.from,
    to: auth.to,
    value: BigInt(auth.value),
    validAfter: BigInt(auth.validAfter),
    validBefore: BigInt(auth.validBefore),
    nonce: auth.nonce,
  },
  signature: sig,
});
check("signature verifies for the test account (viem verifyTypedData)", valid === true);
const roundtrip = JSON.parse(Buffer.from(encodePaymentHeader(payload), "base64").toString("utf8"));
check("PAYMENT-SIGNATURE header base64 round-trips", JSON.stringify(roundtrip) === JSON.stringify(payload));
console.log("\nPayment payload built offline (signature belongs to the public test key):");
console.log(JSON.stringify(payload, null, 2));

console.log("\n== (c) ElizaOS plugin wiring ==");
check("plugin default-exports", typeof blockchainIqPlugin === "object" && blockchainIqPlugin !== null);
check("plugin name is 'blockchainiq-x402'", blockchainIqPlugin.name === "blockchainiq-x402", blockchainIqPlugin.name);
check("plugin registers exactly one action", Array.isArray(blockchainIqPlugin.actions) && blockchainIqPlugin.actions.length === 1);
check("action name is FETCH_BLOCKCHAINIQ_RESOURCE", fetchBlockchainIqAction.name === "FETCH_BLOCKCHAINIQ_RESOURCE", fetchBlockchainIqAction.name);
check("action has a handler function", typeof fetchBlockchainIqAction.handler === "function");
check("action has a validate function", typeof fetchBlockchainIqAction.validate === "function");
check("validate() returns true", (await fetchBlockchainIqAction.validate(null, null)) === true);
check("plugin registers the catalogue provider", blockchainIqPlugin.providers?.includes(blockchainIqCatalogueProvider) === true);
const providerOut = await blockchainIqCatalogueProvider.get(null, null, null);
check("provider returns the catalogue text", typeof providerOut.text === "string" && providerOut.text.includes("brief"));

console.log();
if (failures.length) {
  console.log(`RESULT: FAIL (${failures.length} check(s) failed)`);
  process.exit(1);
}
console.log("RESULT: PASS (all checks)");
