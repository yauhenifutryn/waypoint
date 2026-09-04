# Waypoint

Waypoint is a local-first reference implementation for reviewing and operating small software with explicit manifests, risk scoring, source inspection, approval roles, and a local supervisor.

Public landing page: https://waypoint.yfutryn.chatgpt.site

## Local setup

Use Node.js 22.13 or later.

```bash
# Source-only verification: lifecycle scripts stay disabled.
npm ci --ignore-scripts
npm test
```

To run the local application, review the repository first, then install the
trusted native dependency required by the local SQLite store:

```bash
npm ci
node samples/weekly-ops-report/build.mjs
npm run seed
npm run dev
```

The development console binds only to `127.0.0.1:4300`. In a separate terminal,
run `npm run supervisor`. Build the weekly-report sample before seeding. Its
generated `dist/` output is intentionally ignored and is not committed.

The second install runs the reviewed package lifecycle required to build
`better-sqlite3`; it does not seed data or start a service. The seed, smoke test,
supervisor, and sample services execute curated code or start local processes, so
review them before running.

## Safety model and limits

This repository is a demonstration, not a hostile-code sandbox. Run only code you trust. The sample roles and approvals are simulated locally, and the scanner is a policy aid rather than a security boundary.

The `customer-export` sample is intentionally blocked by the governance gate. Its credential-shaped fixture is synthetic and exists to exercise detection paths. It does not contain a usable credential or a live destination.

The `stock-lookup-api` sample declares a reserved demonstration provider. Its
`?rates=1` route cannot fetch real FX rates; inject a test or local provider
when exercising that code path.

Dependency advisory lookups use the OSV API during the dependency-audit step.
The request contains package names and versions only, not application source or
local data. No licence grant is made by this repository: use, copying, and
redistribution remain subject to the owner’s applicable terms.
