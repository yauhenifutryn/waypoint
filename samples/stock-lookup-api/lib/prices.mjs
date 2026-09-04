// Fixture price table plus a reserved, deliberately non-live outbound fixture.

export const PRICES = {
  ACME: 123.45,
  GLOBEX: 89.1,
  INITECH: 456.78,
  STARK: 231.4,
  UMBRELLA: 67.25,
};

export const FX_RATE_URL = 'https://rates.example.invalid/latest?from=EUR&to=USD';
export function lookup(symbol) {
  const key = String(symbol ?? '').trim().toUpperCase();
  if (!key || !(key in PRICES)) return null;
  return { symbol: key, price: PRICES[key] };
}

/** Reads a demo-provider response; injected fetch supports tests or a local adapter. */
export async function getEurUsdRate(fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(FX_RATE_URL);
  if (!res.ok) throw new Error(`fx provider responded ${res.status}`);
  const body = await res.json();
  const rate = body?.rates?.USD;
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    throw new Error('fx provider response missing rates.USD');
  }
  return rate;
}
