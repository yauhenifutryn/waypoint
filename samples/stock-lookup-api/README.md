# stock-lookup-api

Tiny read-only HTTP service that serves fixture stock prices as JSON for team dashboards and smoke checks. The `?rates=1` path demonstrates declared egress against a reserved, non-live endpoint, so it cannot fetch real FX rates and returns an error unless a test or local adapter injects a provider. It is the canonical example of a declared-egress Tier 2 service. `GET /healthz` answers `{"status":"ok"}` and `GET /lookup?symbol=ACME` answers with `{symbol, price}`.
