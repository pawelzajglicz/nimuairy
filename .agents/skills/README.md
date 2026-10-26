# Agent skills

This directory is the source of truth for the project's agent skills. `scripts/sync-skills.sh`
(run by the hooks in `.githooks/`) copies each skill directory into `.claude/skills/` and
`.junie/skills/`; files at this level, like this README, stay here. Third-party skills are
recorded in [`skills-lock.json`](../../skills-lock.json); the OpenTelemetry ones are pinned to a
commit.

## Available skills

| Skill | Purpose | Source |
|---|---|---|
| `frontend-design` | Visual design guidance for new or reshaped UI | [anthropics/skills](https://github.com/anthropics/skills) |
| `pre-commit-code-review` | Strict review of the Git changes before a commit | Nimuairy |
| `otel-instrumentation` | OpenTelemetry traces, metrics and logs: SDK setup, spans, metric naming, cardinality | Course fork, below |
| `otel-semantic-conventions` | Choosing, placing and reviewing telemetry attributes by the OpenTelemetry Semantic Conventions | Course fork, below |

Both OpenTelemetry skills come from [ewoludev/otel-skills](https://github.com/ewoludev/otel-skills)
at commit `d28228d`, the "Ewolucja Developera" course fork of
[dash0hq/agent-skills](https://github.com/dash0hq/agent-skills) `v1.2.5`. Their origin, license and
fork changes are in [`THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md).
`otel-semantic-conventions/rules/dash0.md` and the Dash0 section of `rules/versioning.md` describe
the Dash0 SaaS backend, not the local Grafana stack.

## Considered for later (not installed)

The same fork has two more skills. They are **not installed in Nimuairy** and must not be copied
into the synced directories until there is a reason to add them: both are about the
OpenTelemetry Collector, and the local stack has none (the backend sends traces straight to
Tempo).

| Skill | What it covers | Reconsider when |
|---|---|---|
| `otel-collector` ([fork](https://github.com/ewoludev/otel-skills/tree/d28228d2c1680b7186c99e56f74d8f31f2d0cc22/skills/otel-collector), [upstream](https://github.com/dash0hq/agent-skills/tree/main/skills/otel-collector)) | Configuring and deploying an OpenTelemetry Collector: receivers, processors, exporters and pipelines | Nimuairy adds a Collector as a layer that routes, transforms, filters or enriches telemetry between the app and the backends |
| `otel-ottl` ([fork](https://github.com/ewoludev/otel-skills/tree/d28228d2c1680b7186c99e56f74d8f31f2d0cc22/skills/otel-ottl), [upstream](https://github.com/dash0hq/agent-skills/tree/main/skills/otel-ottl)) | OpenTelemetry Transformation Language: transforming, filtering, redacting and enriching telemetry in Collector components | Telemetry needs transforming, redacting or filtering with OTTL, e.g. in Collector pipelines |

Adding one means a pinned entry in `skills-lock.json` and an update to `THIRD-PARTY-NOTICES.md`,
like the skills above.
