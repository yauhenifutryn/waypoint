# Waypoint

Waypoint explores an almost autonomous path from team software to governed internal operation: inspect a repository, check independent operating rules, deploy eligible software, and monitor actual runs. Builders keep their tools; humans handle higher-risk exceptions.

Public landing page: https://waypoint.yfutryn.chatgpt.site

## Try the no-key MVP

The public Site accepts small source folders/files without requiring YAML. It derives repository facts, scans supported source patterns and compares a fixed demo policy. It never executes uploads or grants enterprise authorization. Semantic AI checks are disabled.

After reviewing this repository, run the real trusted local reporting example:

```bash
npm ci
node --import tsx scripts/verify-no-key-mvp.ts
```

This creates a fresh temporary database, checks the job, records automatic low-risk approval, deploys and runs it locally, and verifies output plus failure/concurrency cases. No provider keys or external service are needed for this fixture. It preserves evidence and does not reset existing data. See [the exact scope and safety limits](docs/NO_KEY_LOCAL_MVP.md).

## Local console setup

Use Node.js 22.13 or later.

```bash
# Source-only verification: lifecycle scripts stay disabled.
npm ci --ignore-scripts
npx vitest run src/lib/engine
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

The full install runs the reviewed package lifecycle required to build
`better-sqlite3`; it does not seed data or start a service. The seed, smoke test,
supervisor, and sample services execute curated code or start local processes, so
review them before running.

`npm test` includes the native SQLite and actual-process regression suite, so run it after the full install. Owner controls can deploy only versions with recorded T1 automatic approval; demo roles are not enterprise authentication. Existing versions without version-bound tier evidence need resubmission for owner deployment.

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
