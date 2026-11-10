# Self-hosted Buildkite pilot

Private experiment: [outfitter-dev/agentic-ci-pilot](https://github.com/outfitter-dev/agentic-ci-pilot). Pipeline: [Outfitter Buildkite](https://buildkite.com/outfitter/agentic-ci-pilot). Implemented and exercised November 10, 2026.

## Execution model

Both workers run on this Mac. A Linux container runs lint, tests, builds, and private packaging; a native worker invokes the authenticated local Codex CLI for review and collects GitHub landing facts. The reviewer uses `gpt-6.1-sol` with execution tools disabled and bounded supplied source context. Another machine can host the same worker roles after registering in the queue and authenticating its own CLIs.

Proposed code runs as an unprivileged container user without model, GitHub, or Buildkite credentials. Trusted worker code is installed separately from proposed checkouts. The container exposes no host home directory or Docker socket. Native review does not execute proposal code. Review context is text-only; missing context, oversized changes, binary changes, unavailable inference, and incomplete reviews block qualification.

Six independent required statuses are `pilot/lint`, `pilot/test`, `pilot/build`, `pilot/agent-review`, `pilot/human-review`, and `pilot/mergeability`. Human review is required when assigned; outstanding changes-requested reviews and unresolved threads block landing. Deterministic blockers cannot be overridden by a model. The landing label must have been applied by the configured authorized GitHub actor. GitHub's native ALLGREEN merge queue reruns verification against its actual candidate and consumes revision-bound admission evidence.

## Live evidence

| Scenario | Evidence | Result |
| --- | --- | --- |
| Initial PR qualification | [Build 16](https://buildkite.com/outfitter/agentic-ci-pilot/builds/16) | All six gates passed. |
| Initial queue landing | [Build 17](https://buildkite.com/outfitter/agentic-ci-pilot/builds/17), [PR 1](https://github.com/outfitter-dev/agentic-ci-pilot/pull/1) | Candidate qualified and landed. |
| Initial release | [Build 18](https://buildkite.com/outfitter/agentic-ci-pilot/builds/18) | Private ZIP, source/digest validation, and clean-consumer smoke passed. |
| Deliberate upper-layer failure | [Build 22](https://buildkite.com/outfitter/agentic-ci-pilot/builds/22) | Incorrect expected result blocked the upper PR; missing review context independently failed closed. |
| Safe lower-prefix landing | [Build 25](https://buildkite.com/outfitter/agentic-ci-pilot/builds/25), [PR 2](https://github.com/outfitter-dev/agentic-ci-pilot/pull/2) | Passing lower layer landed while upper PR remained open and draft. |
| Release after prefix | [Build 26](https://buildkite.com/outfitter/agentic-ci-pilot/builds/26) | Private release qualification passed. |
| Repaired upper PR | [Build 33](https://buildkite.com/outfitter/agentic-ci-pilot/builds/33), [PR 3](https://github.com/outfitter-dev/agentic-ci-pilot/pull/3) | Corrected fixture and explicit dependency context passed all six gates. |
| Recovery queue landing | [Build 34](https://buildkite.com/outfitter/agentic-ci-pilot/builds/34) | All six candidate gates passed; PR 3 landed at 17:24:34 UTC as `5264279b9ce776d2a8f8e6c3785c663d9b653cf8`. |
| Final main release | [Build 35](https://buildkite.com/outfitter/agentic-ci-pilot/builds/35) | Lint, tests, build, private packaging, source/digest validation, and clean-consumer smoke passed. |

Final saved artifact: `outfitter-ci-pilot-0.1.0-5264279b9ce7.zip`. SHA-256: `9be4f634f6d68ca8f3a01897ded13f35aebc6c8aeeec233d8961f3da70465d0f`. The adjacent `final-release-receipt.json` binds the artifact to the exact landed source. [MONO-91](https://linear.app/outfitter/issue/MONO-91) records completed pilot qualification and the explicit follow-up scope.

GitHub automatically rebased the remaining native-stack layer after the lower PR landed, producing a fresh head and new checks. The local owner reconciled the clean worktree with `gh stack sync`. The recovery preserves the required review gates; it supplies the missing dependencies rather than accepting an incomplete model response.

Local validation: 204 tests and lint pass. Live reviewer findings led to fixes for Git source export fidelity and pipe deadlocks, PR/main routing, human-review ordering and outstanding objections, artifact file-type checks, retry evidence, and review-runtime fingerprinting. Completed review results are reused only for matching head, base, and trusted runtime; unavailable/incomplete results are not cached as passes.

## Limits and follow-up

- Devin's actual unresolved GitHub review threads are enforced and its reported findings were addressed. The required Devin findings-provider adapter remains disabled: a green Devin status is not evidence of zero findings. [MONO-92](https://linear.app/outfitter/issue/MONO-92) tracks validated API integration.
- Simultaneous multiple-PR candidate groups and automatic admission refresh for arbitrary concurrent queue entries remain unqualified. Old-base admissions fail closed. [MONO-93](https://linear.app/outfitter/issue/MONO-93) tracks these cases.
- Assigned-human approval and stale-evidence rules have regression coverage; an assigned-human live approval scenario was not exercised.
- No Dagger execution, production adoption, GitHub release publication, or public package publication was performed. The optional advisory-model adapter is not the live review path.
- Shared machinery remains separate from the fixture in this private repository. The initial proposal was to move proven pieces into `outfitter-dev/actions`; the subsequent decision is to use the new `outfitter-dev/forge` as the shared automation home, with explicit migration from existing Actions and pilot code.

## Operation

The native worker has a four-hour maximum uptime and is not installed as a permanent service. Its latest start was 12:47 PM Eastern on November 10, under Rex in the `remotes` session; its four-hour limit now falls around 4:47 PM Eastern. The Linux worker uses Docker Compose with `restart: unless-stopped`. Registration uses the authorized seven-day token stored outside the repository. Keep that local secret directory private.

Repository setup and stop instructions are in [docs/runtime.md](https://github.com/outfitter-dev/agentic-ci-pilot/blob/main/docs/runtime.md). The local checkout is `/Users/mg/Documents/Codex/2026-11-10/i/work/agentic-ci-pilot`; native runtime/state are in its sibling `native-agent` directory. Stop Linux with `docker compose -p outfitter-ci-pilot -f infra/compose.yaml down` from the checkout with `PILOT_SECRETS_DIR` set to the sibling `pilot-secrets` directory. Stop the native process with SIGTERM using its `agent.pid`; retain review/admission state while continuing the pilot.

## Rex operation update

The Studio `remotes` session contains one `buildkite-workers` tab with two equal side-by-side panes: native review on the left and Docker verification on the right. The native reviewer runs directly under Rex at nice level 10, with one job slot. The verification tab runs attached Docker Compose against the existing container, capped at 2 CPU equivalents and 2 GiB RAM, also with one job slot. The container remains Docker-managed. Rex focus was preserved. Native launcher: `/Users/mg/Documents/Codex/2026-11-10/i/work/native-agent/run-in-rex.sh`; it updates `agent.pid`. Current native output is in the Rex tab (the earlier `agent.log` is historical).

Rex provides process visibility and control, not resource isolation. CPU priority is a scheduling preference, not a hard cap. Native review still shares the user account and Codex service quota, and there is no automatic desktop-activity or memory-pressure throttle. Keep this pilot at one verification job plus one review job until additional slots have distinct checkout/state handling and measured resource budgets.
