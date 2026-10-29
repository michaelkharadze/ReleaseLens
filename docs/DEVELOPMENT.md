# Development history

The implementation was developed in one working session with focused branches and actual timestamps. It is an AI-assisted personal project. No dates, third-party reviews, usage numbers, or adoption claims have been fabricated.

| Stage       | Branch                         | Result                                                                       |
| ----------- | ------------------------------ | ---------------------------------------------------------------------------- |
| Scope       | `main` root commit             | Product scope, architectural decision, license                               |
| Analysis    | `feat/release-analysis`        | UTC comparison windows, grouping, original-source briefs, synthetic fixtures |
| Persistence | `feat/ingestion-api`           | SQLite, report validation, API, import jobs, review/audit storage            |
| Workspace   | `feat/investigation-workspace` | Dashboard, evidence library, release switching, review and export            |
| Quality     | `feat/evaluation-and-ci`       | Labeled benchmark, visible failures, CI, documentation                       |

## Publishing the stages to GitHub

`scripts/publish-github.mjs` publishes the existing development stages with real pull requests. It uses GitHub CLI, requires an authenticated `michaelkharadze` account, and refuses to overwrite an unrelated remote history. It can create the public repository if it does not exist. A dry run is the default:

```sh
node scripts/publish-github.mjs
node scripts/publish-github.mjs --publish
```

The script starts remote main at the scope commit, pushes each feature branch, opens a PR with the recorded scope, then pushes that stage's actual local merge commit to main. GitHub recognizes the feature head in main and marks the PR merged. No force pushes or backdating are used. The script is resumable when the remote is at a recognized milestone.

Do not manufacture months of activity or pretend the software has users. A coherent, tested implementation with honest failure analysis is stronger interview material. For future work, create an issue, make a branch, implement and test a bounded change, open a PR with actual results, then merge it.

## Follow-up backlog

- Preserve cluster identity as new or older reports arrive; add explicit split/merge controls.
- Add release-exposure denominators, overlapping release handling, and uncertainty intervals.
- Compare an embedding model to the baseline on a held-out dataset of real reports.
- Add incremental synchronization for edited GitHub issues and rate-limit resume checkpoints.
- Add authenticated tenant isolation before exposing the server beyond loopback.
- Evaluate AI hypotheses for semantic faithfulness and measure actual cost/latency.
