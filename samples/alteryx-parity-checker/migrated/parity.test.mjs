import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyFeeRule,
  filterHighValue,
  parseLedgerCsv,
  runPipeline,
  summarizeByRegion,
} from './index.mjs';

const inputText = readFileSync(new URL('../fixtures/input.csv', import.meta.url), 'utf8');
const expectedText = readFileSync(new URL('../fixtures/expected.csv', import.meta.url), 'utf8');

test('pipeline reproduces the legacy Alteryx baseline row-for-row', () => {
  assert.equal(runPipeline(inputText), expectedText);
});

test('filter keeps strictly-above-threshold rows only', () => {
  const rows = parseLedgerCsv(inputText);
  const kept = filterHighValue(rows);
  assert.equal(kept.length, 7);
  const vendors = kept.map((r) => r.vendor);
  assert.ok(vendors.includes('Nordwind GmbH'));
  for (const excluded of ['Baltika Sp. z o.o.', 'Gallia SARL']) {
    assert.ok(!vendors.includes(excluded), `${excluded} should be filtered out`);
  }
});

test('boundary row of exactly 1000.00 is excluded (strictly greater)', () => {
  const vendors = filterHighValue(parseLedgerCsv(inputText)).map((r) => r.vendor);
  assert.ok(!vendors.includes('Pacific Rim Co'));
});

test('fee rule matches Alteryx Round(amount*0.02, 2) half-up at cents', () => {
  const [hudson] = applyFeeRule([{ region: 'NA-East', vendor: 'Hudson Trading', amount: 1875.25 }]);
  assert.equal(hudson.fee, 37.51);
  const [kiwi] = applyFeeRule([{ region: 'APAC', vendor: 'Kiwi Logistics', amount: 1320.4 }]);
  assert.equal(kiwi.fee, 26.41);
});

test('summarize groups by region with sorted deterministic order', () => {
  const groups = summarizeByRegion(
    applyFeeRule(filterHighValue(parseLedgerCsv(inputText))),
  );
  const regions = groups.map((g) => g.region);
  assert.deepEqual(regions, [...regions].sort());
  assert.deepEqual(regions, ['APAC', 'EU-Central', 'EU-South', 'EU-West', 'NA-East']);
});

test('region totals match hand-computed sums', () => {
  const groups = summarizeByRegion(
    applyFeeRule(filterHighValue(parseLedgerCsv(inputText))),
  );
  const euSouth = groups.find((g) => g.region === 'EU-South');
  assert.equal(euSouth.totalAmount.toFixed(2), '3910.75');
  assert.equal(euSouth.totalFee.toFixed(2), '78.22');
  const naEast = groups.find((g) => g.region === 'NA-East');
  assert.equal(naEast.totalAmount.toFixed(2), '6075.35');
  assert.equal(naEast.totalFee.toFixed(2), '121.51');
});
