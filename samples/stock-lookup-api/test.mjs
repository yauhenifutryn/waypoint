import assert from 'node:assert/strict';
import test from 'node:test';
import { PRICES, lookup } from './lib/prices.mjs';

test('known symbols resolve case-insensitively', () => {
  assert.deepEqual(lookup('ACME'), { symbol: 'ACME', price: 123.45 });
  assert.deepEqual(lookup('initech'), { symbol: 'INITECH', price: 456.78 });
});

test('padded input is trimmed before lookup', () => {
  assert.deepEqual(lookup('  globex '), { symbol: 'GLOBEX', price: 89.1 });
});

test('unknown or empty symbols return null', () => {
  assert.equal(lookup('NOPE'), null);
  assert.equal(lookup(''), null);
  assert.equal(lookup(null), null);
});

test('fixture table holds at least three finite prices', () => {
  const entries = Object.entries(PRICES);
  assert.ok(entries.length >= 3, `expected >=3 symbols, got ${entries.length}`);
  for (const [symbol, price] of entries) {
    assert.equal(typeof price, 'number', `${symbol} price not numeric`);
    assert.ok(Number.isFinite(price), `${symbol} price not finite`);
    assert.equal(lookup(symbol).price, price);
  }
});
