# Northline · Live Edge Desk

High-frequency challenge desk on **live Coinbase** market data (WebSocket ticker + REST fallback).

- Paper challenge capital ($50k) with 10% target / 5% daily / 10% max drawdown rails
- Four systems: Pulse · Snap · Grid · Scalp — continuous regime scoring every ~2s
- Dynamic risk scaling from win/loss streaks and equity slope
- Honest framing: strategies can lose; not a broker; no real withdrawals

## Live

Deployed via Vercel from this repo.

## Local

Open `index.html` or serve statically. Requires browser access to `api.exchange.coinbase.com` and `wss://ws-feed.exchange.coinbase.com`.
