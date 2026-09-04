#!/usr/bin/env node
// Read-only price lookup service. Declared egress: reserved demo provider (https).
import { createServer } from 'node:http';
import { FX_RATE_URL, getEurUsdRate, lookup } from './lib/prices.mjs';

const port = Number(process.env.PORT ?? 8080);

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(`${payload}\n`);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  if (req.method === 'GET' && url.pathname === '/healthz') {
    json(res, 200, { status: 'ok' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/lookup') {
    const symbolParam = url.searchParams.get('symbol');
    const hit = lookup(symbolParam);
    if (!hit) {
      json(res, 404, { error: 'unknown symbol', symbol: symbolParam });
      return;
    }
    if (url.searchParams.get('rates') !== '1') {
      json(res, 200, hit);
      return;
    }
    try {
      const rate = await getEurUsdRate();
      json(res, 200, {
        ...hit,
        fx: { base: 'EUR', quote: 'USD', rate, source: new URL(FX_RATE_URL).host },
      });
    } catch (err) {
      json(res, 502, { ...hit, fx: { error: String(err.message ?? err) } });
    }
    return;
  }

  json(res, 404, { error: 'not found' });
});

server.listen(port, () => {
  console.log(`[stock-lookup-api] listening on :${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
