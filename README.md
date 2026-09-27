# Kronos Crypto Data MCP Server

**Real-time crypto market data for AI agents** — derivatives (funding / OI / basis), liquidations, options IV, GEX, CEX premium, multi-source price, realized volatility, market-regime detection, and TradFi macro across up to **17 assets**. An optional **ML price forecast** is available as a premium add-on.

**x402-native: no API key, no signup.** An autonomous agent discovers this server and pays per call in **USDC on Base** via the [x402](https://www.x402.org/) micropayment protocol. There is no dashboard, no account, no API-key provisioning — just point a funded wallet at it and call. That is the one thing incumbent crypto-data MCPs (CoinGecko / CoinMarketCap / CoinGlass) cannot do.

- **Data-first.** 19 paid data tools covering derivatives, liquidations, options, macro, and screeners.
- **Pay-per-call.** Prices from **$0.02** per call, settled on-chain in USDC — you pay only for what you use.
- **Wallet-optional boot.** The free `get_sample` tool works with **no wallet at all**.

## Wallet-optional boot

The server boots and responds to `initialize` + `tools/list` **without any environment variables set**. Free tools (like `get_sample`) work without a wallet. Paid tools return a clear error if `BUYER_PRIVATE_KEY` is missing or the wallet has insufficient USDC — they never crash the server.

## Quick start

Add the server to your MCP client config. For paid tools, set `BUYER_PRIVATE_KEY` to a wallet funded with USDC on Base. Omit the `env` block entirely to run only the free `get_sample` tool.

```json
{
  "mcpServers": {
    "kronos-crypto-data": {
      "command": "npx",
      "args": ["crypto-derivatives-mcp"],
      "env": {
        "BUYER_PRIVATE_KEY": "0x<your-funded-wallet-private-key>"
      }
    }
  }
}
```

That's it — no signup, no API key. The first paid call triggers an on-chain USDC micropayment and returns both the data and the settlement tx hash.

## Tools

### Data & derivatives

| Tool | Description | Cost |
|------|-------------|------|
| `get_derivatives` | Full derivatives snapshot: funding rate, annualized funding, OI, 1h OI change, basis, funding trend, plain-English read | $0.02 |
| `get_funding_rate` | Perpetual funding rate + annualized rate. Positive = bullish lean, negative = bearish lean | $0.02 |
| `get_open_interest` | Open interest and 1-hour OI change. Rising OI + rising price = strong trend | $0.02 |
| `get_market_regime` | Market regime: squeeze / breakout / funding-extreme / OI-surge / normal | $0.02 |
| `get_price` | Real-time spot price for an asset | $0.02 |
| `get_snapshot` | Everything-in-one snapshot: funding, OI, basis, regime, and the ML forecast (`btc`/`eth`/`sol` only) | $0.08 |
| `get_market_overview` | Funding rate + OI snapshot across all 17 assets at once | $0.02 |
| `get_funding_extremes` | Screener: assets with the most extreme funding rates right now | $0.02 |
| `get_fear_greed` | Current crypto Fear & Greed index score and classification | $0.03 |
| `get_ohlc` | OHLCV candlestick data. Optional: interval (`1h`,`4h`,`1d`) and limit | $0.02 |
| `get_volatility` | Realized volatility metrics for an asset | $0.02 |
| `get_alerts` | Regime alerts for an asset: squeeze, breakout, funding-extreme, OI-surge, or normal | $0.02 |
| `get_market_scan` | Market-wide screen across up to 17 assets ranked by signal strength and regime state. Optional `assets` filter | $0.04 |
| `get_macro` | TradFi macro snapshot: VIX, DXY, 10Y yield, SPX, gold — plus BTC correlations | $0.02 |
| `get_digest` | Structured market narrative: machine-readable digest of funding, OI, regime, and the ML forecast (`btc`/`eth`/`sol` only) | $0.02 |
| `get_liquidations` | Liquidation cluster-map and recent OKX liquidation prints. Identifies high-density price levels | $0.02 |
| `get_options_iv` | Options implied volatility, skew, and term-structure. **BTC and ETH only** | $0.03 |
| `get_gex` | Gamma exposure (GEX) and max-pain price. **BTC and ETH only** | $0.04 |
| `get_cex_premium` | Coinbase premium: spot price difference between Coinbase and global aggregated price | $0.02 |

### Forecast (premium add-on)

An optional add-on on top of the data — **not financial advice.** Live per-asset accuracy is free at [kronossignals.com/api/stats](https://kronossignals.com/api/stats); check it before buying.

| Tool | Description | Cost |
|------|-------------|------|
| `get_forecast` | Kronos price forecast at 1h, 4h, or 24h horizon. Kronos ML model for `btc`/`eth`/`sol`; `doge`/`bnb`/`near`/`ada` run it hourly, with a heuristic in between; `xrp` uses a composite model that has shown no directional edge | $0.05 |
| `get_forecast_ledger` | Machine-readable resolved-forecast accuracy history. Optional: asset, horizon, limit | $0.02 |

### Free

| Tool | Description | Cost |
|------|-------------|------|
| `get_sample` | A coarse up/down direction with a confidence bucket from the cached forecast — see the response format without paying or funding a wallet | Free |

The `asset` each tool accepts:

- `get_derivatives`, `get_funding_rate`, `get_open_interest`, `get_market_regime`, `get_alerts`, `get_liquidations`: `btc`, `eth`, `sol`, `bnb`, `xrp`, `doge`, `ada`, `avax`, `link`, `dot`, `ltc`, `trx`, `bch`, `atom`, `near`, `apt`, `hype`
- `get_price`, `get_snapshot`, `get_ohlc`, `get_volatility`, `get_digest`: `btc`, `eth`, `sol`, `bnb`, `xrp`, `doge`, `ada`, `avax`, `link`, `dot`, `ltc`, `trx`, `bch`, `atom`, `near`, `apt`
- `get_cex_premium` (Coinbase-listed only): `btc`, `eth`, `sol`, `xrp`, `doge`, `ada`, `avax`, `link`, `dot`, `ltc`, `bch`, `atom`, `near`
- `get_forecast`: `btc`, `eth`, `sol`, `doge`, `xrp`, `bnb`, `near`, `ada`
- `get_options_iv`, `get_gex`: `btc`, `eth`
- `get_sample`: `btc`, `eth`, `sol`

## Install

### npx (recommended)

Use the config in [Quick start](#quick-start) above.

`BUYER_PRIVATE_KEY` is optional at boot — the server starts without it. Omit the env block entirely to use only the free `get_sample` tool, or add the key when you need paid data.

### Local clone

```bash
git clone https://github.com/hashchecked/kronos-mcp.git
cd kronos-mcp
npm install
npm run build
```

Then in your MCP client config:

```json
{
  "mcpServers": {
    "kronos-crypto-data": {
      "command": "node",
      "args": ["/absolute/path/to/kronos-mcp/dist/index.js"],
      "env": {
        "BUYER_PRIVATE_KEY": "0x<your-funded-wallet-private-key>"
      }
    }
  }
}
```

## How payment works

When a paid tool is called, the server makes an HTTP GET to the Kronos API. The API returns HTTP 402 with the price and pay-to address. The server's x402 library builds an EIP-3009 `transferWithAuthorization` signed by the configured wallet and sends it in the retry request header. The x402 facilitator submits the on-chain transaction (paying gas). The settlement tx hash is returned alongside the data.

**What to configure:**

- `BUYER_PRIVATE_KEY` — hex private key for a wallet funded with USDC on Base mainnet (`eip155:8453`). No ETH needed; x402 uses gasless EIP-3009 transfers.
- USDC contract on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

Use a dedicated wallet. Fund it with only as much USDC as you need.

## Error messages

| Situation | Error returned |
|-----------|---------------|
| Paid tool called, no key set | `Payment required — BUYER_PRIVATE_KEY is not set...` |
| Paid tool called, wallet has no USDC | `Payment failed — the configured wallet has insufficient USDC on Base mainnet... Fund the wallet at 0x... with USDC on Base...` |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BUYER_PRIVATE_KEY` | No (free tools work without it) | — | Hex private key for wallet funded with USDC on Base mainnet |
| `BASE_URL` | No | `https://kronossignals.com` | Kronos API base URL |
| `NETWORK` | No | `eip155:8453` | EIP-155 chain ID (8453 = Base mainnet) |

## Security

Never commit your private key to version control. The `.gitignore` excludes `.env` and `.env.*`. Use a dedicated wallet with a limited USDC balance. For production deployments, supply the key via a secrets manager.

The forecast tools are an optional add-on and **not financial advice.** No accuracy or performance is guaranteed; `get_forecast_ledger` exposes the raw resolved-forecast history so you can judge it yourself.
