# Third-party notices

This file lists third-party material included in Nimuairy, with its origin and license. Each
item stays under its own license; this file does not change how Nimuairy itself is licensed.

## OpenTelemetry Agent Skills (`otel-instrumentation`)

The `otel-instrumentation` skill in `.agents/skills/otel-instrumentation/`, mirrored unchanged
into `.claude/skills/` and `.junie/skills/` by `scripts/sync-skills.sh`. Upstream calls the
collection Dash0 Agent Skills.

- **Upstream:** [dash0hq/agent-skills](https://github.com/dash0hq/agent-skills), tag `v1.2.5`
  (commit `e73252a`).
- **Copied from:** [ewoludev/otel-skills](https://github.com/ewoludev/otel-skills), the
  "Ewolucja Developera" course fork, commit `d28228d` (pinned in `skills-lock.json`). The fork
  is upstream `v1.2.5` plus three commits: `580b1a6`, `2634f40` and `d28228d`.
- **Copyright:** Copyright 2025 Dash0 Inc.
- **License:** Apache License 2.0. The upstream `LICENSE` is kept byte for byte in
  [`licenses/dash0-agent-skills/LICENSE`](licenses/dash0-agent-skills/LICENSE); the fork ships
  the same file. Its text differs slightly from the one on apache.org (three wording changes in
  sections 1 and 4, and a different sentence in the appendix). Neither repository has a
  `NOTICE` file.
- **Changes in Nimuairy:** none. The files are byte-identical to the fork at `d28228d`.

### Where each file comes from

| Files | Origin |
|---|---|
| `README.md`, every file in `rules/` except the two below | Upstream `v1.2.5`, unchanged |
| `SKILL.md` | Upstream `v1.2.5`, changed in the fork (`580b1a6`): a table row and a paragraph that point to `wkontenerach-stack` |
| `rules/sdks/nextjs.md` | Upstream `v1.2.5`, changed in the fork (`d28228d`): the server setup is split into `instrumentation.ts` and `instrumentation.node.ts` |
| `rules/wkontenerach-stack.md` | Added in the fork (`580b1a6`, `2634f40`): a course adaptation for its local Prometheus, Tempo, Loki, Alloy and Grafana stack, not an upstream rule |

The fork adds no copyright notice or license statement of its own for these changes. Its
README says upstream rule files are kept unmodified; `nextjs.md` is the exception, changed in a
later commit.

### License declared inside the skill

`SKILL.md` (`license: MIT`) and `README.md` (License: MIT) keep the declaration from upstream
`v1.2.5`. At that tag, the repository's `LICENSE` and plugin manifests
(`.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`) say Apache 2.0. Upstream changed
both skill declarations to Apache-2.0 in `665f5bd` (first released in `v1.3.1`); its commit
message calls MIT "inconsistent with the repository's actual Apache-2.0 LICENSE and plugin
manifests". Nimuairy keeps the files as copied.

### Checking the copy

```bash
git clone https://github.com/ewoludev/otel-skills.git <dir>
git -C <dir> checkout d28228d2c1680b7186c99e56f74d8f31f2d0cc22
diff -r --strip-trailing-cr <dir>/skills/otel-instrumentation .agents/skills/otel-instrumentation
git -C <dir> fetch https://github.com/dash0hq/agent-skills.git tag v1.2.5
git -C <dir> diff --name-status v1.2.5 HEAD -- skills/otel-instrumentation LICENSE
```

When the skill is reinstalled or updated, update this section and the license copy with it.
