/**
 * Demo: buy the Blockchain IQ market brief through x402 via the plugin's
 * action handler (no full ElizaOS runtime needed).
 *
 * Usage:
 *   export X402_PRIVATE_KEY=0x...   # dedicated wallet, a little USDC on Base
 *   npm run build && node dist/demo.js [resource]
 *
 * With no argument it fetches 'brief' ($0.01). 'event-risk' ($0.05) works too.
 */
import { fetchBlockchainIqAction } from "./actions/fetchBlockchainIq.js";

const resource = process.argv[2] ?? "brief";

const result = await fetchBlockchainIqAction.handler(
  undefined as never, // runtime: unused by this action
  { content: { text: `fetch ${resource}` } } as never, // message stub
  undefined,
  { resource, maxUsdc: 0.1 } as never, // this action's own option fields
  async (content) => {
    console.log(content.text);
    return [];
  },
);

const ok = Boolean(result && typeof result === "object" && "success" in result && result.success);
console.log(ok ? "Action completed." : "Action failed (see above).");
process.exit(ok ? 0 : 1);
