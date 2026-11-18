/**
 * ElizaOS action: fetch Blockchain IQ data, paying per call over x402.
 */
import type {
  Action,
  ActionResult,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import { fetchPaidResource, type FetchResult } from "../x402.js";

/** Read this action's own fields out of the framework's HandlerOptions. */
function readOptions(options?: HandlerOptions): { resource: string; maxUsdc: number } {
  const raw = (options ?? {}) as unknown as Record<string, unknown>;
  return {
    resource: typeof raw.resource === "string" ? raw.resource : "brief",
    maxUsdc: typeof raw.maxUsdc === "number" ? raw.maxUsdc : 0.1,
  };
}

export const fetchBlockchainIqAction: Action = {
  name: "FETCH_BLOCKCHAINIQ_RESOURCE",
  similes: ["GET_BLOCKCHAINIQ_DATA", "BUY_BLOCKCHAINIQ_DATA", "FETCH_MARKET_BRIEF"],
  description:
    "Fetch crypto market data from Blockchain IQ, paying per call in USDC " +
    "on Base through the x402 protocol when the resource is paid. Use " +
    "'brief' for a $0.01 market brief (BTC/ETH/SOL/XRP prices, 48h events, " +
    "risk flags) or 'event-risk' for $0.05 scheduled market-moving events. " +
    "Pass {resource, maxUsdc} in the handler options. The payment signing " +
    "key comes from the X402_PRIVATE_KEY environment variable.",
  validate: async (_runtime: IAgentRuntime, _message: Memory): Promise<boolean> => true,
  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    const { resource, maxUsdc } = readOptions(options);
    let result: FetchResult;
    try {
      result = await fetchPaidResource(resource, { maxAmountUsd: maxUsdc });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (callback) {
        await callback({
          text: `Blockchain IQ fetch failed: ${message}`,
          source: "blockchainiq-x402",
        });
      }
      return { success: false, error: message };
    }
    const text = JSON.stringify({
      resource,
      paid: result.paid,
      amount_usd: result.amountUsd,
      settlement: result.settlement,
      data: result.data,
    });
    if (callback) {
      await callback({ text, source: "blockchainiq-x402" });
    }
    return { success: true, text, data: { result: result.data } };
  },
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Get me the Blockchain IQ market brief before I trade." },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Buying the $0.01 brief through x402 now.",
          action: "FETCH_BLOCKCHAINIQ_RESOURCE",
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "What market-moving events are coming up this week?" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Fetching event-risk ($0.05) from Blockchain IQ.",
          action: "FETCH_BLOCKCHAINIQ_RESOURCE",
        },
      },
    ],
  ],
};
