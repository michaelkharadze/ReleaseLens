# Explaining ReleaseLens

## Project pitch

ReleaseLens helps an engineer investigate what customers started reporting after a deployment. It groups reports, compares their share of reporting accounts before and after the release, and assembles a brief with original evidence and a reproduction checklist.

## Suggested résumé bullets

- Built a TypeScript and SQLite release-triage application that ingests public GitHub issues and support reports, compares pre/post-release report frequencies, and produces source-backed engineering briefs.
- Implemented idempotent imports, background job tracking, transactional persistence, release-scoped investigation notes, and a shared browser/server analysis engine.
- Created a reproducible 24-pair development evaluation with per-case failure analysis and CI regression checks; measured 74.1% F1 for the initial lexical grouping baseline on synthetic cases.

Use the evaluation bullet only with its synthetic-development qualifier. Do not claim production users, incident reduction, cost savings, or commercial adoption without collecting that evidence.

## A five-minute demo

1. Open the release overview for v2.8.0. The 41 synthetic reports form six topics.
2. Show why nine login complaints represent nine accounts, while repeated reports from the same account count once.
3. Select the CSV export signal. Explain its before/after counts and normalized ratio.
4. Inspect the release-note association and source quotes. Explain why the suspected connection is not a proven cause.
5. Add an investigation note, save it, and reload to demonstrate persistence.
6. Generate a brief and inspect its original source IDs and reproduction checklist.
7. Open Evaluation. Discuss a hard negative that merged incorrectly and a semantic paraphrase the baseline missed.

## Engineering decisions worth discussing

**Normalization:** Raw complaint volume can rise with overall traffic. Normalizing by reporting accounts helps, but remains biased because the app does not know how many users were exposed to each release. A production version should ingest active-account or request counts.

**Grouping:** A deterministic baseline is cheap and reproducible. Complete-link grouping reduces bridge-report chaining, at the expense of recall and quadratic cost. An embedding model should be evaluated on held-out, real, manually labeled data before replacing it.

**Evidence:** The program builds counts and quotes directly from stored records. A model may generate a tentative hypothesis, but its citation IDs must exist. Semantic entailment is a separate problem from ID validity.

**Persistence:** SQLite transactions prevent partially validated batches. Source IDs make retries safe. Job state survives restart; an interrupted job is marked failed, and the user can retry without duplicating existing records.

**Deployment:** The browser-only demo is easy to share and needs no secrets. The local app adds a database and GitHub imports. Production multi-user hosting would require authenticated tenancy and a durable server runtime.

## Next evidence to collect

Evaluate 100–200 real, permissioned reports labeled independently by two people. Keep a held-out set. Compare lexical grouping with embeddings using pairwise precision/recall and cluster-level metrics. Time actual triage sessions before claiming time savings. Add release exposure counts before interpreting frequency as incidence.
