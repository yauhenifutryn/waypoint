# Trusted local reporting MVP

This path runs entirely on a developer's machine. It needs Node.js and the repository's installed dependencies, but no provider account, API key, external database, or paid service. The fixture contains fictional team activity and uses only Node's standard library.

Run from the repository root:

```sh
npx tsx scripts/verify-no-key-mvp.ts
```

If a restricted environment prevents the tsx CLI from opening its local IPC pipe, the equivalent runner is:

```sh
node --import tsx scripts/verify-no-key-mvp.ts
```

The verifier creates a fresh temporary `WAYPOINT_DATA_DIR` before importing database code, removes inherited environment variables, and keeps its evidence directory. It does not use the existing `.data`, seed scripts, live credentials, provider APIs, or shared databases. The only subprocess programs are the checked-in reporting sample and explicit trusted regression fixtures. It stops its own child processes on completion.

## Demonstrated behavior

1. Submit `samples/team-report-job`. The real pipeline parses the manifest, scans the source, evaluates its declared resources and risk, reports the absence of third-party dependencies, and executes four reporting assertions.
2. The daily reporting shape scores T1 and receives a recorded automatic policy approval. An owner may deploy only with T1, policy-engine automatic approval evidence, passing checks, and no rejection. A role selector remains a demo role model; this is not authenticated ownership.
3. Request deployment and manually run the artifact snapshot. The output is `report.txt`, containing three teams and 22 completed tasks. The same text is captured in the run log.
4. The supervisor also executes a cron-triggered recovery fixture. The normal sample schedule is 09:00 Europe/Warsaw daily.
5. Runs carry the version ID captured at their atomic SQLite claim. Audit events record start, finish, trigger, deployment, and version. A late result cannot promote a replacement version or overwrite its health.
6. Failures produce failed health; completion is idempotent. Timeout, stop, and post-spawn setup failures terminate the original process group before releasing the run claim, including TERM-resistant background children after their shell leader exits. A committed stop takes precedence over a successful exit even before the stop watcher polls. A concurrent request from another process is rejected. Redeploying the same version preserves its consecutive failure count, so it cannot bypass the three-failure review requirement.
7. Boot recovers dead orphan runs. It preserves runs owned by a live console process, and supervisor shutdown leaves those other owners' runs alone.

Each run prints an `Evidence:` directory. Inspect `verification.json` for scenario results, `logs/` for actual child output, `artifacts/team-report-job/` for the report, and `waypoint.db` for checks, approvals, run attribution, health, and audit rows. Internal demo lease values in that database are not provider credentials. Do not publish the data directory.

Focused regression command:

```sh
npx vitest run src/server/service.test.ts src/server/supervisor/main.test.ts
```

## Limits

This is trusted local execution, not a sandbox for hostile uploads. Never expose the execution console publicly. The Node permission model is partial containment for matching Node commands; arbitrary declared shell commands, network access, same-user host access, mutable artifacts, and demo resource/identity resolution are not production security boundaries. The existing validation command runner can inherit host environment variables during ordinary console submission; the verifier explicitly strips these before running the pipeline. Use a clean environment for the local console.

Only `concurrencyPolicy: forbid` is implemented; `allow` and `replace` fail closed. The sample requests no retries. This MVP does not establish retry guarantees, CPU/memory/disk quotas, provider-backed resource access, hostile-code isolation, or a durable multi-host scheduler. Run history retention is not enforced.

Historical runs have unknown version attribution and stay null after migration. New runs are version-bound. Risk tier is stored per version, including class floors; owner deployment fails closed for historical versions without that evidence until resubmission. A newer submission changing the app's display tier cannot change an older version's owner-deployment eligibility.

A child that survives a dead owner keeps its run occupied: the supervisor will not kill an unverified PID or overlap that run. An operator must verify the surviving process before recovery. PID reuse, escaped process groups, and system reboot identity require stronger process ownership tracking before unattended production use.
