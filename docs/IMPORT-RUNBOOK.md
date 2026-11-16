# Import runbook — Datatruck loads, 2026-09-20 → today

## The brief

The owner's brief, 2026-11-16, transcribed before the runbook is written:

```
Task 1, written down now, commit it as docs/IMPORT-RUNBOOK.md first. Scope:
the Datatruck LOADS import only (scripts/seed-datatruck-loads.ts and whatever
it depends on), for the weeks from Sep 20 2026 to today that are not yet in
Zebra. Not remittance, not the in-app importers. Produce: (1) exactly what
Islom exports from Datatruck — screen, filters, date range Sep 20 2026 →
today, file type, where to save it under corpus/; (2) the one PowerShell line
to preview against production and the one to write, org
cmsbsc82y0000nsvsa6yffuyh named; (3) what the preview must print before write
is allowed; (4) what a re-run does if a week is imported twice — must be
nothing, read from the script, not assumed; (5) if the script can't take a
date-bounded export without code, say what's missing. Read each script, don't
run anything against a database. Unit tests only.
```
