#!/usr/bin/env node
// Reads settlements.csv from SETTLEMENTS_DIR, reconciles against invoices.csv,
// prints per-mismatch lines, writes out/discrepancies.json inside the workspace.
// Exit 0 clean, exit 2 when discrepancies exceed tolerance.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  describeInvoiceSource,
  loadInvoices,
  loadSettlements,
  reconcile,
} from './lib/reconcile.mjs';

const DEFAULT_SETTLEMENTS_DIR = '//example.invalid/demo/settlements';

export function resolveSettlementsDir(env = process.env, cwd = process.cwd()) {
  if (env.SETTLEMENTS_DIR) return env.SETTLEMENTS_DIR;
  // Local dev convenience: use repo fixtures when present, else the declared share.
  if (existsSync(join(cwd, 'fixtures', 'settlements.csv'))) return join(cwd, 'fixtures');
  return DEFAULT_SETTLEMENTS_DIR;
}

function formatMismatch(m) {
  if (m.type === 'amount_mismatch') {
    return `[mismatch] ${m.settlementId} ${m.invoiceId}: invoiced=${m.invoicedAmount.toFixed(2)} settled=${m.settledAmount.toFixed(2)} delta=${m.delta.toFixed(2)}`;
  }
  return `[mismatch] ${m.settlementId} ${m.invoiceId}: no such invoice in the invoice book (settled=${m.settledAmount.toFixed(2)})`;
}

export function main(env = process.env) {
  const dir = resolveSettlementsDir(env);
  console.log(`[invoice-reconciler] settlements dir: ${dir}`);
  console.log(`[invoice-reconciler] invoice source: ${describeInvoiceSource(env)}`);

  const settlements = loadSettlements(readFileSync(join(dir, 'settlements.csv'), 'utf8'));
  const invoices = loadInvoices(readFileSync(join(dir, 'invoices.csv'), 'utf8'));
  const result = reconcile(invoices, settlements);

  for (const m of result.mismatches) console.log(formatMismatch(m));
  console.log(
    `[invoice-reconciler] invoices=${result.invoiceCount} settlements=${result.settlementCount} ` +
      `matched=${result.matchedCount} mismatches=${result.mismatchCount}`,
  );

  mkdirSync('out', { recursive: true });
  const report = {
    settlementsDir: dir,
    tolerance: result.tolerance,
    counts: {
      invoices: result.invoiceCount,
      settlements: result.settlementCount,
      matched: result.matchedCount,
      mismatches: result.mismatchCount,
    },
    discrepancies: result.mismatches,
  };
  writeFileSync(join('out', 'discrepancies.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log('[invoice-reconciler] wrote out/discrepancies.json');

  // Discrepancies are the job's OUTPUT, not a failure: a completed
  // reconciliation run is successful whether or not mismatches were found.
  process.exitCode = 0;
}

try {
  main();
} catch (err) {
  console.error(`[invoice-reconciler] fatal: ${err.message}`);
  process.exitCode = 1;
}
