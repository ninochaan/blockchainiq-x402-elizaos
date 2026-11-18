/**
 * ElizaOS plugin: Blockchain IQ over x402.
 *
 * Gives an ElizaOS agent one action (FETCH_BLOCKCHAINIQ_RESOURCE) and one
 * provider (the qualifying-resources catalogue) for buying crypto market
 * data from Blockchain IQ, paying per call in USDC on Base through the
 * x402 v2 protocol. The signing key comes only from the X402_PRIVATE_KEY
 * environment variable.
 *
 * Bounty: Blockchain IQ x402 build bounties, ElizaOS slot ("a plugin") —
 * a public repo with a working paid call to brief ($0.01) or event-risk
 * ($0.05).
 */
import type { Plugin, Provider } from "@elizaos/core";
import { fetchBlockchainIqAction } from "./actions/fetchBlockchainIq.js";
import { BASE_URL, QUALIFYING_RESOURCES } from "./x402.js";

export const blockchainIqCatalogueProvider: Provider = {
  name: "BLOCKCHAINIQ_CATALOGUE",
  description:
    "Lists the Blockchain IQ resources that qualify for a paid x402 call and the free catalogue URL.",
  dynamic: true,
  get: async () => {
    const lines = [
      `Blockchain IQ catalogue (free): ${BASE_URL}`,
      "Bounty-qualifying resources:",
      ...Object.entries(QUALIFYING_RESOURCES).map(
        ([name, info]) => `  - ${name}: ${info.path} ($${info.priceUsd.toFixed(2)} per call)`,
      ),
    ];
    return { text: lines.join("\n"), values: {}, data: {} };
  },
};

export const blockchainIqPlugin: Plugin = {
  name: "blockchainiq-x402",
  description:
    "Buy Blockchain IQ crypto market data per call over x402 (USDC on Base): market brief, event risk, macro, network activity and research.",
  actions: [fetchBlockchainIqAction],
  providers: [blockchainIqCatalogueProvider],
};

export default blockchainIqPlugin;
export { fetchBlockchainIqAction } from "./actions/fetchBlockchainIq.js";
export * from "./x402.js";
