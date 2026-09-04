// Pure reconciliation primitives. No I/O here so tests stay fast and honest.

export const TOLERANCE = 0.01;
export const INVOICES_DB_ENDPOINT = 'postgres.example.invalid:5432/invoices';

/** Minimal RFC4180-style CSV parser (quotes, doubled quotes, CRLF). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = ''; rows.push(row); row = [];
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((cells) =>
    Object.fromEntries(header.map((h, idx) => [h, (cells[idx] ?? '').trim()])),
  );
}

export function parseAmount(value) {
  const n = Number(String(value).trim());
  if (!Number.isFinite(n)) throw new Error(`invalid amount: "${value}"`);
  return n;
}

/** invoices.csv -> Map keyed by invoice_id. */
export function loadInvoices(text) {
  const map = new Map();
  for (const r of parseCsv(text)) {
    const id = r.invoice_id;
    if (!id) throw new Error('invoices.csv row without invoice_id');
    if (map.has(id)) throw new Error(`duplicate invoice_id ${id}`);
    map.set(id, { invoiceId: id, amount: parseAmount(r.amount), status: r.status || '' });
  }
  return map;
}

/** settlements.csv -> array of settlement records in file order. */
export function loadSettlements(text) {
  return parseCsv(text).map((r) => ({
    settlementId: r.settlement_id,
    invoiceId: r.invoice_id,
    amount: parseAmount(r.amount),
    currency: r.currency,
    date: r.date,
  }));
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Compare settled amounts against the invoice book.
 * Returns { tolerance, counts..., mismatches[] } with mismatches sorted by
 * settlementId for deterministic output.
 */
export function reconcile(invoices, settlements, { tolerance = TOLERANCE } = {}) {
  const mismatches = [];
  let matchedCount = 0;
  for (const s of settlements) {
    const inv = invoices.get(s.invoiceId);
    if (!inv) {
      mismatches.push({
        type: 'unmatched_settlement',
        settlementId: s.settlementId,
        invoiceId: s.invoiceId,
        settledAmount: s.amount,
        currency: s.currency,
        date: s.date,
      });
      continue;
    }
    const delta = round2(s.amount - inv.amount);
    if (Math.abs(delta) > tolerance) {
      mismatches.push({
        type: 'amount_mismatch',
        settlementId: s.settlementId,
        invoiceId: s.invoiceId,
        invoicedAmount: inv.amount,
        settledAmount: s.amount,
        delta,
      });
      continue;
    }
    matchedCount++;
  }
  mismatches.sort((a, b) => String(a.settlementId).localeCompare(String(b.settlementId)));
  return {
    tolerance,
    invoiceCount: invoices.size,
    settlementCount: settlements.length,
    matchedCount,
    mismatchCount: mismatches.length,
    mismatches,
  };
}

/** Where the invoice book came from; keeps the declared DB endpoint observable. */
export function describeInvoiceSource(env = process.env) {
  return env.INVOICES_DB_URL
    ? `postgres ${INVOICES_DB_ENDPOINT} via minted INVOICES_DB_URL`
    : 'invoices.csv alongside the settlements export';
}
