# invoice-reconciler

Weekday-morning job that compares bank settlement exports against the issued invoice book and reports every mismatch above a one-cent tolerance, both to stdout and to `out/discrepancies.json`. It is owned by finance operations so that revenue-affecting discrepancies surface before the daily cash meeting. Exits 0 when clean and 2 when discrepancies exist, so the platform can page on failure. Locally it reads `fixtures/*.csv`; in production `SETTLEMENTS_DIR` points at the declared settlements share.
