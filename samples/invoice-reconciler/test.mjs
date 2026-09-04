import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  TOLERANCE,
  loadInvoices,
  loadSettlements,
  parseAmount,
  parseCsv,
  reconcile,
} from './lib/reconcile.mjs';

const invoicesText = readFileSync(new URL('./fixtures/invoices.csv', import.meta.url), 'utf8');
const settlementsText = readFileSync(new URL('./fixtures/settlements.csv', import.meta.url), 'utf8');

test('csv parser returns 8 data rows per fixture', () => {
  assert.equal(parseCsv(invoicesText).length, 8);
  assert.equal(parseCsv(settlementsText).length, 8);
});

test('parseAmount converts decimal strings exactly', () => {
  assert.equal(parseAmount('118.50'), 118.5);
  assert.equal(parseAmount(' 2520.00 '), 2520);
  assert.throws(() => parseAmount('n/a'), /invalid amount/);
});

test('invoice book loads 8 unique invoices with numeric amounts', () => {
  const invoices = loadInvoices(invoicesText);
  assert.equal(invoices.size, 8);
  assert.equal(invoices.get('INV-1003').amount, 119.0);
  assert.equal(invoices.get('INV-1008').status, 'void');
});

test('settlements load 8 rows with parsed amounts', () => {
  const settlements = loadSettlements(settlementsText);
  assert.equal(settlements.length, 8);
  assert.equal(settlements[0].settlementId, 'ST-2001');
  assert.equal(settlements[0].amount, 1250);
});

test('reconciliation finds exactly 6 matches and 2 mismatches', () => {
  const result = reconcile(loadInvoices(invoicesText), loadSettlements(settlementsText));
  assert.equal(result.invoiceCount, 8);
  assert.equal(result.settlementCount, 8);
  assert.equal(result.matchedCount, 6);
  assert.equal(result.mismatchCount, 2);
  assert.deepEqual(
    result.mismatches.map((m) => m.type).sort(),
    ['amount_mismatch', 'unmatched_settlement'],
  );
});

test('amount mismatch math is exact to cents', () => {
  const result = reconcile(loadInvoices(invoicesText), loadSettlements(settlementsText));
  const amountMismatch = result.mismatches.find((m) => m.type === 'amount_mismatch');
  assert.equal(amountMismatch.invoiceId, 'INV-1003');
  assert.equal(amountMismatch.invoicedAmount, 119.0);
  assert.equal(amountMismatch.settledAmount, 118.5);
  assert.equal(amountMismatch.delta, -0.5);
  assert.ok(Math.abs(amountMismatch.delta) > result.tolerance);
});

test('widening tolerance absorbs amount deltas but not unknown invoices', () => {
  const result = reconcile(loadInvoices(invoicesText), loadSettlements(settlementsText), {
    tolerance: 1.0,
  });
  assert.deepEqual(result.mismatches.map((m) => m.type), ['unmatched_settlement']);
  assert.equal(result.mismatchCount, 1);
});

test('default tolerance is one cent', () => {
  assert.equal(TOLERANCE, 0.01);
});
