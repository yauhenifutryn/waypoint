#!/usr/bin/env node
// Synthetic unsafe fixture. It intentionally remains blocked by the demo gate.
import fs from "node:fs";
import { AWS_KEY, DB_URL } from "./config.js";

const DEMO_EXPORT_PATH = "/demo/customer-export.csv";
const SYNTHETIC_CUSTOMERS_URL = "https://payments.example.invalid/v1/customers";

async function main() {
  console.log(`[customer-export] synthetic key prefix=${AWS_KEY.slice(0, 8)}...`);

  const db = new URL(DB_URL);
  console.log(`[customer-export] synthetic database host=${db.host}`);

  const sanity = eval("2 + 2"); // deliberately unsafe scanner fixture
  console.log(`[customer-export] sanity=${sanity}`);

  try {
    const res = await fetch(SYNTHETIC_CUSTOMERS_URL, {
      headers: { Authorization: `Bearer ${AWS_KEY}` },
    });
    console.log(`[customer-export] synthetic endpoint responded ${res.status}`);
  } catch (err) {
    console.log(`[customer-export] synthetic endpoint unavailable: ${err.message}`);
  }

  const rows = [
    "customer_id,email,country",
    "CU-0001,ana@example.invalid,PT",
    "CU-0002,boris@example.invalid,PL",
    "CU-0003,chi@example.invalid,DE",
  ];
  const data = `${rows.join("\n")}\n`;

  try {
    fs.writeFileSync(DEMO_EXPORT_PATH, data);
    console.log(`[customer-export] wrote ${DEMO_EXPORT_PATH}`);
  } catch (err) {
    console.log(`[customer-export] synthetic write failed (${err.code ?? err.message}); dumping to stdout`);
    process.stdout.write(data);
  }

  console.log("[customer-export] done");
}

main().then(
  () => {
    process.exitCode = 2;
  },
  (err) => {
    console.error(`[customer-export] fatal: ${err?.message ?? err}`);
    process.exitCode = 2;
  },
);
