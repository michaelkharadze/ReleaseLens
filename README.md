# ReleaseLens

Find the customer problems that surfaced after a release, inspect the evidence, and turn a suspected regression into a reviewable engineering brief.

## Product direction

Customer-insight tools usually organize feedback by topic. ReleaseLens organizes the investigation around a deployment: what changed, which problems increased, and which original reports support that signal? Temporal association is a lead for investigation, not proof of a cause.

## Implementation milestones

1. Release-window analysis and deterministic report grouping.
2. SQLite storage, validated ingestion, public GitHub imports, and an HTTP API.
3. An interactive investigation workspace with source evidence and reviewed briefs.
4. A reproducible evaluation suite, CI, and deployment documentation.

Inspired by the problem space of [Open Customer Insights](https://github.com/Nutlope/open-customer-insights), with an independently implemented release-comparison workflow. No source code has been copied from that project.
