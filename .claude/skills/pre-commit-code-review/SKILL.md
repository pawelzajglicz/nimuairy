---
name: pre-commit-code-review
description: Perform a strict pre-commit code review of the current Git changes. Use this skill whenever code has been changed and the user wants to commit, asks whether changes are ready to commit, requests a code review before commit, or asks to validate a change before committing. Review the diff against repository instructions and conventions, including Java 25/Spring Boot backend, Angular frontend, API contracts, security, tests, database migrations, and battle-domain architecture. Report actionable findings with severity and finish with READY TO COMMIT or NOT READY TO COMMIT. Do not modify code or create commits unless explicitly asked.
---

# Pre-Commit Code Review

Review all current uncommitted changes before allowing a commit.

## Goal

Act as a strict but pragmatic senior code reviewer for this repository.

The purpose of this review is to catch:

* correctness bugs,
* regressions,
* broken architecture,
* security issues,
* missing or misleading tests,
* API contract inconsistencies,
* violations of project conventions,
* accidental complexity,
* incomplete changes.

Do not review code merely for stylistic preferences when the existing project conventions do not require them.

The review must be based primarily on the actual diff and the surrounding code needed to understand it.

---

## 1. Load project rules first

Before reviewing the changes, read the applicable project instructions:

* `/CLAUDE.md`
* `/nimuairy-api/CLAUDE.md` for backend changes
* `/frontend/CLAUDE.md` for frontend changes
* relevant documentation under `/docs/`
* relevant local skills under `.claude/skills/` or `.agents/skills/` when applicable

Treat these documents as project-specific review rules.

Do not suggest changes that contradict documented project decisions.

---

## 2. Determine exactly what is being reviewed

Inspect the Git working tree and determine:

* modified files,
* added files,
* deleted files,
* renamed files,
* unstaged changes,
* staged changes.

Review **all current changes that would affect the upcoming commit**.

Prefer commands such as:

```bash
git status --short
git diff
git diff --cached
```

Do not review the whole repository unless required to understand a changed piece of code.

Inspect surrounding implementation when the diff alone is insufficient.

---

## 3. Understand the intent

Before judging implementation details, identify what the change is trying to accomplish.

Use:

* changed code,
* tests,
* commit history when useful,
* existing documentation,
* API definitions,
* nearby implementations.

Do not invent requirements that are not supported by the repository or the change itself.

If the intent is unclear, state the uncertainty explicitly and review based on the most likely interpretation.

---

# 4. Review priorities

Review findings in this order:

### P0 — Must fix before commit

Issues that can cause:

* data loss,
* security vulnerabilities,
* broken authentication/authorization,
* production-breaking behavior,
* corrupted state,
* incorrect game/domain rules,
* API contract breakage,
* severe runtime failures.

### P1 — Should fix before commit

Issues that can cause:

* incorrect functionality,
* significant regressions,
* broken edge cases,
* missing validation,
* incorrect persistence behavior,
* missing error handling,
* broken frontend/backend integration,
* insufficient tests for important behavior,
* architectural violations that will make the feature harder to evolve.

### P2 — Worth fixing

Issues such as:

* maintainability problems,
* unnecessary duplication,
* avoidable complexity,
* weak naming,
* non-obvious code that should be simplified,
* missing tests for lower-risk cases.

### P3 — Optional

Purely stylistic or subjective suggestions.

Do not report P3 findings unless they are directly supported by an existing project convention.

---

# 5. Backend review — Java / Spring Boot

For changes under `nimuairy-api/`, verify the following.

## Architecture

Confirm the documented layering is preserved:

```text
Controller -> Service -> Repository
```

Check that:

* controllers handle HTTP concerns and delegate to services,
* business rules are not implemented in controllers,
* repositories are not used directly from controllers,
* entities do not escape the service layer,
* transactional boundaries remain appropriate.

## DTOs

Check that:

* request and response DTOs remain separated,
* request DTOs use validation where appropriate,
* DTOs are records when consistent with project conventions,
* entities are not exposed directly through REST,
* API changes are reflected on the frontend where required.

## Persistence

Check for:

* incorrect JPA mappings,
* unintended eager loading,
* N+1 query risks,
* invalid transaction boundaries,
* incorrect cascade behavior,
* entity equality/hashCode problems,
* accidental lazy-loading failures.

For schema changes verify:

* a new numbered Liquibase changeset is used,
* existing applied changesets are not modified,
* `changelog-master.xml` includes the new changeset,
* entity and database schema remain compatible,
* `ddl-auto: validate` assumptions are preserved.

## Security

Pay special attention to:

* authentication bypasses,
* authorization mistakes,
* missing ownership checks,
* JWT handling,
* exposing sensitive data,
* accepting client-controlled values that should be server-controlled,
* accidental logging of credentials or tokens,
* insecure public endpoints.

Never assume that frontend validation provides security.

## Error handling

Verify that:

* services use the established exceptions,
* `GlobalExceptionHandler` remains the error response boundary,
* controllers do not construct ad-hoc error responses,
* client-facing errors do not expose internal implementation details.

---

# 6. Frontend review — Angular

For changes under `frontend/`, verify the project conventions.

Check that:

* standalone Angular architecture is preserved,
* `inject()` is used according to project conventions,
* components do not call `HttpClient` directly,
* generated Orval clients are used appropriately,
* generated API files are not manually edited,
* application/domain models are not unnecessarily duplicated,
* `any` is not introduced,
* templates use `@if` / `@for`,
* loops use stable `track` expressions where applicable,
* signals are used appropriately,
* subscriptions do not leak,
* reactive forms remain typed,
* accessibility is preserved.

Look especially for:

* state mutations that bypass the intended state-management boundary,
* duplicated state,
* stale state after API calls,
* race conditions,
* incorrect signal dependencies,
* effects being used where derived state is more appropriate,
* unnecessary subscriptions,
* UI state that can diverge from the domain state.

---

# 7. Battle system review

The battle system has explicit architectural constraints. Treat them as high-priority review rules.

## Current prototype

Remember that:

* backend currently provides the initial battle state,
* battle rules temporarily execute on the frontend,
* the backend must not become authoritative prematurely,
* battle state should use SignalStore,
* battle rules belong in a framework-independent battle engine,
* Angular components must not contain battle rules,
* the conceptual model is:

```text
(state, action) -> state
```

Check especially for:

* battle logic accidentally placed in Angular components,
* HTTP concerns leaking into the battle engine,
* SignalStore becoming the location of domain rules,
* mutable state transitions,
* duplicated battle rules in multiple layers,
* assumptions that make future backend migration unnecessarily difficult.

## M2 board rules

For changes related to the board verify:

* one CSS Grid remains the board coordinate system,
* domain coordinates remain Cartesian,
* `(0,0)` remains bottom-left,
* screen/CSS coordinate mapping remains a presentation concern,
* entity geometry respects `position` + `footprint`,
* units, walls, terrain and objectives remain conceptually distinct,
* M2 does not accidentally introduce gameplay logic.

---

# 8. Backend/frontend API contract

Whenever both backend and frontend are involved, verify the entire contract.

Pay special attention to:

* renamed fields,
* changed enum values,
* nullable vs non-nullable fields,
* numeric/string type changes,
* request/response shape changes,
* error response changes,
* pagination changes,
* authentication requirements,
* generated client synchronization.

Remember:

* OpenAPI is the source of truth.
* Orval-generated API code must be regenerated after contract changes.
* Do not manually duplicate generated request/response models.
* Backend DTO and corresponding frontend model changes must stay synchronized where the project requires it.

Treat a mismatch between backend and frontend contract as at least P1.

---

# 9. Tests

Review tests as part of the feature, not as an afterthought.

Ask:

* Does the changed behavior have adequate test coverage?
* Do tests verify behavior rather than implementation details?
* Are important edge cases covered?
* Could an existing test pass while the implementation is actually broken?
* Does the test exercise the real boundary that matters?

For backend, prefer the project conventions:

* Mockito for services,
* `@WebMvcTest` for controller contracts,
* `@SpringBootTest` sparingly.

For frontend, verify that the appropriate unit/integration/e2e level is used.

Do not demand tests for trivial mechanical changes when they add no useful confidence.

---

# 10. Run validation

When practical, run the same or equivalent checks used by CI.

Backend:

```bash
cd nimuairy-api
./mvnw test
```

Frontend:

```bash
cd frontend
npm run lint
npm run format:check
npm run build
```

Run additional tests relevant to the changed feature.

If a command cannot be run, report that fact instead of assuming it passes.

Do not weaken or bypass validation just to make the review pass.

---

# 11. Security and secrets scan

Before approving the commit, check for accidental inclusion of:

* API keys,
* passwords,
* tokens,
* private keys,
* credentials,
* real JWT secrets,
* production configuration,
* `.env` secrets,
* sensitive debug output.

The repository explicitly contains a development JWT placeholder.

Never replace it with a real secret during a review.

---

# 12. Diff quality

Look for changes that are technically valid but suspicious for a pre-commit review:

* unrelated files modified,
* generated files changed without source changes,
* temporary debugging code,
* commented-out code,
* TODOs that leave functionality incomplete,
* unnecessary dependency additions,
* large refactors mixed with a small feature,
* accidental formatting churn,
* unrelated renames,
* test changes that weaken assertions.

Prefer small, focused and reviewable commits.

---

# 13. Dependency changes

Any new dependency is worth explicit review.

Check:

* why it is needed,
* whether an existing dependency already solves the problem,
* whether it affects bundle size or runtime behavior,
* whether it introduces a new architectural direction,
* whether the project instructions require approval before adding it.

The repository explicitly says:

> Ask before adding a dependency.

Therefore, if the current change introduces a new dependency, flag it as a review finding rather than silently accepting it.

---

# 14. Avoid false positives

Do not report:

* purely theoretical problems with no realistic failure mode,
* subjective refactoring preferences,
* style differences already accepted by the project,
* improvements unrelated to the current change,
* speculative performance issues without evidence,
* issues caused solely by existing code unless the change makes them worse.

Every finding should explain a concrete risk.

---

# 15. Finding format

For every finding use:

```text
[P1] path/to/File.java:42

Problem:
<what is wrong>

Why it matters:
<observable consequence or realistic failure mode>

Suggested fix:
<smallest practical fix>
```

For frontend files include the relevant Angular/domain context.

Keep findings focused and actionable.

Prefer one finding per problem.

---

# 16. Final verdict

At the end, provide exactly one of:

```text
READY TO COMMIT
```

or

```text
NOT READY TO COMMIT
```

Use `NOT READY TO COMMIT` when there is at least one P0 or P1 issue, or when required validation fails for a reason that could invalidate the change.

A P2 finding alone does not block the commit.

A P3 finding never blocks the commit.

Then provide:

```text
Summary:
- P0: <count>
- P1: <count>
- P2: <count>
- P3: <count>

Validation:
- Backend: PASS / FAIL / NOT RUN
- Frontend: PASS / FAIL / NOT RUN
- Other relevant checks: ...

Main concerns:
<up to 3 most important points>
```

Do not approve a change merely because it compiles.

The standard is:

**correct, consistent with the architecture, tested, secure, and ready to be committed.**

---

# 17. Important behavior

This skill is a **review gate**, not an automatic refactoring workflow.

During review:

* do not modify production code automatically,
* do not create a commit automatically,
* do not silently fix findings,
* do not add dependencies,
* do not rewrite unrelated code.

Report findings first.

When the user explicitly asks to fix the findings, make the smallest changes necessary and run the relevant validation again.

After fixes, repeat the review of the resulting diff before the commit.
