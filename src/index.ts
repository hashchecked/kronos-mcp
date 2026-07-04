#!/usr/bin/env -S npx tsx
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { z } from "zod";

// Base URL of the LIVE Kronos product. Override with BASE_URL env if needed.
const BASE_URL = (process.env.BASE_URL ?? "https://kronossignals.com").replace(
  /\/+$/,
  ""
);
// Base MAINNET. USDC 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (6 decimals).
const NETWORK = (process.env.NETWORK ?? "eip155:8453") as `${string}:${string}`;

const ASSET = z
  .enum([
    "btc", "eth", "sol", "bnb", "xrp", "doge", "ada", "avax",
    "link", "dot", "ltc", "trx", "bch", "atom", "near", "apt",
  ])
  .describe(
    "Asset symbol: btc, eth, sol, bnb, xrp, doge, ada, avax, link, dot, ltc, trx, bch, atom, near, or apt"
  );

const ASSET_BTC_ETH = z
  .enum(["btc", "eth"])
  .describe("Asset symbol: btc or eth (only BTC and ETH are supported by this endpoint)");

const ASSET_FORECAST = z
  .enum(["btc", "eth", "sol", "doge", "xrp", "bnb"])
  .describe(
    "Asset symbol for forecasts. Full Kronos ML ($0.01): btc, eth, sol. Beta composite ($0.001): doge, xrp, bnb. Other assets have no forecast endpoint."
  );

// ---------------------------------------------------------------------------
// Lazy paid client — constructed only when a paid tool is actually invoked.
// Server boots and serves tools/list without any env vars set.
// ---------------------------------------------------------------------------

type PaidClient = {
  fetchWithPayment: typeof fetch;
  walletAddress: string;
};

let _paidClient: PaidClient | null | undefined; // undefined = not yet initialised

function getPaidClient(): PaidClient | null {
  if (_paidClient !== undefined) return _paidClient;
  const rawKey = process.env.BUYER_PRIVATE_KEY;
  if (!rawKey || rawKey.trim() === "") {
    _paidClient = null;
    return null;
  }
  try {
    const key = (rawKey.startsWith("0x") ? rawKey : "0x" + rawKey) as `0x${string}`;
    const account = privateKeyToAccount(key);
    const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [
        {
          network: NETWORK,
          client: new ExactEvmScheme(account),
        },
      ],
    });
    _paidClient = { fetchWithPayment, walletAddress: account.address };
  } catch {
    _paidClient = null;
  }
  return _paidClient;
}

const NO_KEY_ERROR = {
  content: [
    {
      type: "text" as const,
      text: "Payment required — BUYER_PRIVATE_KEY is not set. Set this env var with a funded wallet's private key (USDC on Base mainnet) to use paid tools.",
    },
  ],
  isError: true,
};

function paymentFailedError(walletAddress?: string): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  const suffix = walletAddress
    ? ` Fund the wallet at ${walletAddress} with USDC on Base to use paid tools.`
    : "";
  return {
    content: [
      {
        type: "text" as const,
        text: `Payment failed — the configured wallet has insufficient USDC on Base mainnet, or BUYER_PRIVATE_KEY is missing/invalid.${suffix}`,
      },
    ],
    isError: true,
  };
}

// Shared helper: x402 paid GET → full JSON + settlement tx.
async function paidGet(url: string, label: string) {
  const client = getPaidClient();
  if (!client) return NO_KEY_ERROR;

  try {
    const response = await client.fetchWithPayment(url, { method: "GET" });

    if (!response.ok) {
      if (response.status === 402) {
        return paymentFailedError(client.walletAddress);
      }
      const body = await response.text();
      return {
        content: [{ type: "text" as const, text: `HTTP ${response.status}: ${body}` }],
        isError: true,
      };
    }

    const parsedBody = await response.json();

    let txHash: string | null = null;
    const paymentResponseHeader = response.headers.get("PAYMENT-RESPONSE");
    if (paymentResponseHeader) {
      try {
        const decoded = JSON.parse(
          Buffer.from(paymentResponseHeader, "base64").toString("utf-8")
        );
        txHash = decoded?.transaction ?? decoded?.txHash ?? decoded?.tx ?? null;
      } catch {
        // ignore decode errors
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ [label]: parsedBody, settlementTxHash: txHash }, null, 2),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: `Error: ${message}` }],
      isError: true,
    };
  }
}

// Shared helper: paid GET that returns only keys matching a keyword list.
async function paidGetFiltered(url: string, label: string, keywords: string[]) {
  const client = getPaidClient();
  if (!client) return NO_KEY_ERROR;

  try {
    const response = await client.fetchWithPayment(url, { method: "GET" });

    if (!response.ok) {
      if (response.status === 402) {
        return paymentFailedError(client.walletAddress);
      }
      const body = await response.text();
      return {
        content: [{ type: "text" as const, text: `HTTP ${response.status}: ${body}` }],
        isError: true,
      };
    }

    const data = (await response.json()) as Record<string, unknown>;

    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      const lower = k.toLowerCase();
      if (keywords.some((kw) => lower.includes(kw))) {
        filtered[k] = v;
      }
    }

    // Fallback: if filtering produced nothing, return everything.
    const payload = Object.keys(filtered).length > 0 ? filtered : data;

    let txHash: string | null = null;
    const paymentResponseHeader = response.headers.get("PAYMENT-RESPONSE");
    if (paymentResponseHeader) {
      try {
        const decoded = JSON.parse(
          Buffer.from(paymentResponseHeader, "base64").toString("utf-8")
        );
        txHash = decoded?.transaction ?? decoded?.txHash ?? decoded?.tx ?? null;
      } catch {
        // ignore decode errors
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ [label]: payload, settlementTxHash: txHash }, null, 2),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
  }
}

async function main() {
  process.stderr.write(
    `[kronos-mcp] v0.6.0 | 22 tools | base=${BASE_URL}, network=${NETWORK} | wallet-optional boot enabled | waiting on stdio\n`
  );

  const server = new McpServer({
    name: "Kronos Crypto Data",
    version: "0.6.0",
  });

  // ---- 1. get_derivatives: full real-time derivatives snapshot ---------------
  server.tool(
    "get_derivatives",
    "Full real-time derivatives snapshot for an asset: funding rate, annualized funding, open interest, 1h OI change, basis, funding trend, and plain-English market read. Supports all 16 assets. $0.02 per call via x402.",
    { asset: ASSET },
    async ({ asset }) => {
      return paidGet(`${BASE_URL}/api/v1/signals/${asset}`, "derivatives");
    }
  );

  // ---- 2. get_funding_rate: funding-focused view ----------------------------
  server.tool(
    "get_funding_rate",
    "Real-time perpetual funding rate and annualized funding rate for an asset. Positive = longs pay shorts (bullish lean); negative = shorts pay longs (bearish lean). Supports all 16 assets. $0.02 per call via x402.",
    { asset: ASSET },
    async ({ asset }) => {
      return paidGetFiltered(`${BASE_URL}/api/v1/signals/${asset}`, "funding_rate", [
        "funding",
        "rate",
        "annualized",
        "trend",
      ]);
    }
  );

  // ---- 3. get_open_interest: OI-focused view ---------------------------------
  server.tool(
    "get_open_interest",
    "Real-time open interest and 1-hour OI change for a perpetual futures market. Rising OI + rising price = strong trend. Supports all 16 assets. $0.02 per call via x402.",
    { asset: ASSET },
    async ({ asset }) => {
      return paidGetFiltered(`${BASE_URL}/api/v1/signals/${asset}`, "open_interest", [
        "open_interest",
        "oi",
        "delta",
        "change",
      ]);
    }
  );

  // ---- 4. get_market_regime: regime classification -------------------------
  server.tool(
    "get_market_regime",
    "Current market regime classification: squeeze, breakout, funding-extreme, OI-surge, or normal. Use to detect high-volatility setups before trading. Supports all 16 assets. $0.02 per call via x402.",
    { asset: ASSET },
    async ({ asset }) => {
      return paidGet(`${BASE_URL}/api/v1/alerts/${asset}`, "market_regime");
    }
  );

  // ---- 5. get_forecast: Kronos ML price forecast ---------------------------
  server.tool(
    "get_forecast",
    "Kronos price forecast for an asset. Horizon: 1h, 4h, or 24h. Forecasts are available ONLY for: btc, eth, sol (full Kronos ML, $0.01 per call) and doge, xrp, bnb (beta composite model, $0.001 per call). Any other asset has no forecast endpoint. Premium predictive signal — not financial advice. Paid via x402.",
    {
      asset: ASSET_FORECAST,
      horizon: z
        .enum(["1h", "4h", "24h"])
        .optional()
        .describe("Forecast horizon (default: 1h)"),
    },
    async ({ asset, horizon }) => {
      const h = horizon ?? "1h";
      return paidGet(`${BASE_URL}/api/v1/forecast/${asset}?horizon=${h}`, "forecast");
    }
  );

  // ---- 6. get_sample: free teaser data (no payment) ------------------------
  server.tool(
    "get_sample",
    "Free sample data for an asset — no payment required. Use to explore the data format before committing to paid calls. Supports all 16 assets.",
    { asset: ASSET },
    async ({ asset }) => {
      try {
        const url = `${BASE_URL}/api/v1/sample/${asset}`;
        const response = await fetch(url, { method: "GET" });
        if (!response.ok) {
          const body = await response.text();
          return {
            content: [
              {
                type: "text" as const,
                text: `HTTP ${response.status}: ${body}`,
              },
            ],
            isError: true,
          };
        }
        const parsedBody = await response.json();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ sample: parsedBody }, null, 2),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // ---- 7. get_price: real-time spot price ----------------------------------
  server.tool(
    "get_price",
    "Get real-time spot price for a crypto asset. Supports btc/eth/sol/bnb/xrp/doge/ada/avax/link/dot/ltc/trx/bch/atom/near/apt. Cost: $0.001.",
    { asset: ASSET },
    async ({ asset }) => {
      return paidGet(`${BASE_URL}/api/v1/price/${asset}`, "price");
    }
  );

  // ---- 8. get_snapshot: comprehensive market snapshot ----------------------
  server.tool(
    "get_snapshot",
    "Get a comprehensive everything-in-one market snapshot for an asset: funding rate, open interest, basis, market regime, and (where available) forecast. Derivatives data covers all 16 assets; the forecast component is only included for btc, eth, sol, doge, xrp, and bnb. Cost: $0.04.",
    { asset: ASSET },
    async ({ asset }) => {
      return paidGet(`${BASE_URL}/api/v1/snapshot/${asset}`, "snapshot");
    }
  );

  // ---- 9. get_market_overview: all-assets overview -------------------------
  server.tool(
    "get_market_overview",
    "Get a funding rate and open interest snapshot across all 16 tracked crypto assets at once. Cost: $0.02.",
    {},
    async () => {
      return paidGet(`${BASE_URL}/api/v1/overview`, "market_overview");
    }
  );

  // ---- 10. get_funding_extremes: screener ----------------------------------
  server.tool(
    "get_funding_extremes",
    "Screener: returns assets with the most extreme funding rates right now — useful for spotting crowded longs/shorts. Cost: $0.003.",
    {},
    async () => {
      return paidGet(`${BASE_URL}/api/v1/funding-extremes`, "funding_extremes");
    }
  );

  // ---- 11. get_fear_greed: Fear & Greed index ------------------------------
  server.tool(
    "get_fear_greed",
    "Get the current crypto Fear & Greed index score and classification. Cost: $0.001.",
    {},
    async () => {
      return paidGet(`${BASE_URL}/api/v1/fear-greed`, "fear_greed");
    }
  );

  // ---- 12. get_ohlc: OHLCV candlestick data --------------------------------
  server.tool(
    "get_ohlc",
    "Get recent OHLCV candlestick data for an asset. Optional params: interval (e.g. '1h','4h','1d'), limit (number of candles). Supports all 16 assets. Cost: $0.001.",
    {
      asset: ASSET,
      interval: z
        .string()
        .optional()
        .describe("Candle interval, e.g. '1h', '4h', '1d'"),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Number of candles to return"),
    },
    async ({ asset, interval, limit }) => {
      const params = new URLSearchParams();
      if (interval) params.set("interval", interval);
      if (limit !== undefined) params.set("limit", String(limit));
      const qs = params.toString() ? `?${params.toString()}` : "";
      return paidGet(`${BASE_URL}/api/v1/ohlc/${asset}${qs}`, "ohlc");
    }
  );

  // ---- 13. get_volatility: realized volatility metrics ---------------------
  server.tool(
    "get_volatility",
    "Get realized volatility metrics for an asset. Supports all 16 assets. Cost: $0.01.",
    { asset: ASSET },
    async ({ asset }) => {
      return paidGet(`${BASE_URL}/api/v1/volatility/${asset}`, "volatility");
    }
  );

  // ---- 14. get_alerts: regime alerts per asset -----------------------------
  server.tool(
    "get_alerts",
    "Regime alerts for an asset: squeeze, breakout, funding-extreme, OI-surge, or normal. Returns current alert state with supporting data. Supports all 16 assets. $0.02 per call via x402.",
    { asset: ASSET },
    async ({ asset }) => {
      return paidGet(`${BASE_URL}/api/v1/alerts/${asset}`, "alerts");
    }
  );

  // ---- 15. get_market_scan: market-wide 16-asset screen --------------------
  server.tool(
    "get_market_scan",
    "Market-wide screen across up to 16 assets: ranks by signal strength, funding extremes, and regime state. Optional comma-separated `assets` filter. $0.04 per call via x402.",
    {
      assets: z
        .string()
        .optional()
        .describe("Comma-separated asset symbols to filter, e.g. 'btc,eth,sol'. Omit for all 16."),
    },
    async ({ assets }) => {
      const params = new URLSearchParams();
      if (assets) params.set("assets", assets);
      const qs = params.toString() ? `?${params.toString()}` : "";
      return paidGet(`${BASE_URL}/api/v1/scan${qs}`, "market_scan");
    }
  );

  // ---- 16. get_macro: TradFi macro indicators + BTC correlations ----------
  server.tool(
    "get_macro",
    "TradFi macro snapshot: VIX, DXY, 10Y yield, SPX, and gold — plus BTC correlations to each indicator. No params. $0.001 per call via x402.",
    {},
    async () => {
      return paidGet(`${BASE_URL}/api/v1/macro`, "macro");
    }
  );

  // ---- 17. get_digest: structured market narrative -------------------------
  server.tool(
    "get_digest",
    "Structured market narrative for an asset: machine-readable digest of funding, OI, regime, and (where available) forecast signals. Derivatives data covers all 16 assets; forecast signals are only included for btc, eth, sol, doge, xrp, and bnb. $0.02 per call via x402.",
    { asset: ASSET },
    async ({ asset }) => {
      return paidGet(`${BASE_URL}/api/v1/digest/${asset}`, "digest");
    }
  );

  // ---- 18. get_liquidations: liquidation cluster-map + OKX prints ----------
  server.tool(
    "get_liquidations",
    "Liquidation cluster-map and recent OKX liquidation prints for an asset. Identifies price levels with high liquidation density. Supports all 16 assets. $0.003 per call via x402.",
    { asset: ASSET },
    async ({ asset }) => {
      return paidGet(`${BASE_URL}/api/v1/liquidations/${asset}`, "liquidations");
    }
  );

  // ---- 19. get_options_iv: implied volatility + skew + term-structure ------
  server.tool(
    "get_options_iv",
    "Options implied volatility, skew, and term-structure for an asset. Supported assets: BTC and ETH only — other assets are not available on this endpoint. $0.03 per call via x402.",
    { asset: ASSET_BTC_ETH },
    async ({ asset }) => {
      return paidGet(`${BASE_URL}/api/v1/options-iv/${asset}`, "options_iv");
    }
  );

  // ---- 20. get_gex: gamma exposure + max-pain ------------------------------
  server.tool(
    "get_gex",
    "Gamma exposure (GEX) and max-pain price for an asset. Supported assets: BTC and ETH only — other assets are not available on this endpoint. $0.04 per call via x402.",
    { asset: ASSET_BTC_ETH },
    async ({ asset }) => {
      return paidGet(`${BASE_URL}/api/v1/gex/${asset}`, "gex");
    }
  );

  // ---- 21. get_cex_premium: Coinbase premium -------------------------------
  server.tool(
    "get_cex_premium",
    "Coinbase premium for an asset: spot price difference between Coinbase and the global aggregated price. Positive = US buyers paying up. Supports all 16 assets. $0.02 per call via x402.",
    { asset: ASSET },
    async ({ asset }) => {
      return paidGet(`${BASE_URL}/api/v1/cex-premium/${asset}`, "cex_premium");
    }
  );

  // ---- 22. get_forecast_ledger: resolved-forecast accuracy history ---------
  server.tool(
    "get_forecast_ledger",
    "Machine-readable resolved-forecast accuracy history. Optional filters: asset, horizon (1h/4h/24h), limit (number of records). $0.001 per call via x402.",
    {
      asset: z.string().optional().describe("Asset symbol to filter, e.g. 'btc'"),
      horizon: z.string().optional().describe("Forecast horizon to filter, e.g. '1h', '4h', '24h'"),
      limit: z.number().int().positive().optional().describe("Number of records to return"),
    },
    async ({ asset, horizon, limit }) => {
      const params = new URLSearchParams();
      if (asset) params.set("asset", asset);
      if (horizon) params.set("horizon", horizon);
      if (limit !== undefined) params.set("limit", String(limit));
      const qs = params.toString() ? `?${params.toString()}` : "";
      return paidGet(`${BASE_URL}/api/v1/forecast-ledger${qs}`, "forecast_ledger");
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
