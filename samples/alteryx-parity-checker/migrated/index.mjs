#!/usr/bin/env node
// Faithful migration of legacy/workflow.yxmd:
// Input CSV -> Filter(amount > 1000) -> Formula(fee = Round(amount*0.02, 2))
//   -> Summarize(GroupBy region; Sum amount, Sum fee) -> Output CSV.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_LEDGER_DIR = '//example.invalid/demo/ledger';

export function resolveLedgerDir(env = process.env, cwd = process.cwd()) {
  if (env.LEDGER_DIR) return env.LEDGER_DIR;
  if (existsSync(join(cwd, 'fixtures', 'input.csv'))) return join(cwd, 'fixtures');
  return DEFAULT_LEDGER_DIR;
}

/** [Input Data] Minimal RFC4180-style CSV parse into typed rows. */
export function parseLedgerCsv(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  const [headerLine, ...dataLines] = lines;
  const header = headerLine.split(',').map((h) => h.trim());
  if (header.join(',') !== 'region,vendor,amount') {
    throw new Error(`unexpected ledger header: "${headerLine}"`);
  }
  return dataLines.map((line) => {
    const [region, vendor, amountRaw] = line.split(',');
    const amount = Number(String(amountRaw).trim());
    if (!Number.isFinite(amount)) throw new Error(`invalid amount in row: "${line}"`);
    return { region: region.trim(), vendor: vendor.trim(), amount };
  });
}

/** [Filter] Keep rows strictly above the 1000 threshold. */
export function filterHighValue(rows) {
  return rows.filter((r) => r.amount > 1000);
}

/** [Formula] fee = Round(amount * 0.02, 2): half-up rounding at cents. */
export function applyFeeRule(rows) {
  return rows.map((r) => ({ ...r, fee: Math.round(r.amount * 0.02 * 100) / 100 }));
}

/** [Summarize] GroupBy region, Sum amount -> total_amount, Sum fee -> total_fee. */
export function summarizeByRegion(rows) {
  const groups = new Map();
  for (const r of rows) {
    const g = groups.get(r.region) ?? { region: r.region, totalAmount: 0, totalFee: 0 };
    g.totalAmount += r.amount;
    g.totalFee += r.fee;
    groups.set(r.region, g);
  }
  // Sort for byte-stable parity diffs; legacy engine grouping order was not guaranteed.
  return [...groups.values()].sort((a, b) => a.region.localeCompare(b.region));
}

/** [Output] Render region,total_amount,total_fee with fixed two decimals. */
export function renderParityCsv(groups) {
  const lines = ['region,total_amount,total_fee'];
  for (const g of groups) {
    lines.push(`${g.region},${g.totalAmount.toFixed(2)},${g.totalFee.toFixed(2)}`);
  }
  return `${lines.join('\n')}\n`;
}

export function runPipeline(text) {
  return renderParityCsv(summarizeByRegion(applyFeeRule(filterHighValue(parseLedgerCsv(text)))));
}

export function main(env = process.env) {
  const dir = resolveLedgerDir(env);
  console.log(`[alteryx-parity-checker] ledger dir: ${dir}`);
  const csv = runPipeline(readFileSync(join(dir, 'input.csv'), 'utf8'));
  mkdirSync('out', { recursive: true });
  writeFileSync(join('out', 'parity_result.csv'), csv);
  const groupCount = csv.trim().split('\n').length - 1;
  console.log(`[alteryx-parity-checker] wrote out/parity_result.csv (${groupCount} regions)`);
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  try {
    main();
  } catch (err) {
    console.error(`[alteryx-parity-checker] fatal: ${err.message}`);
    process.exitCode = 1;
  }
}
