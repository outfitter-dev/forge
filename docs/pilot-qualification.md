# Self-hosted Buildkite pilot — public findings

The November 10, 2026 [private pilot](https://github.com/outfitter-dev/agentic-ci-pilot) qualified a separate verification and trusted-review execution model. The complete original report, machine-specific recovery details and dated availability are preserved in the [local operational archive](public-readiness.md#operational-record-preservation), accepted by Matt as machine-local and not long-term durable. Source evidence ends at `5264279b9ce776d2a8f8e6c3785c663d9b653cf8`; these observations do not establish current worker health.

## Findings Forge preserves

- Lint, test, build, agent review, assigned-human review and merge eligibility were independent required results. Missing, stale, failed, canceled or incomplete required evidence did not pass, and model judgment could not override deterministic blockers.
- Proposed code ran unprivileged without model, GitHub or Buildkite credentials, host-home access or a Docker socket. Trusted orchestration was installed outside proposed checkouts. Native review consumed bounded text rather than executing proposal code.
- Review/admission reuse required matching head, base and trusted runtime. Changes to relevant model/harness/prompt/configuration invalidated reuse; JSON output or green provider status alone was not a review verdict.
- GitHub’s actual merge candidate supplied integration checks; member admission evidence remained distinct. Passing candidate verification could not refresh stale member reviews.

| Historical scenario | Evidence | Observed result |
| --- | --- | --- |
| Initial qualification and queue landing | [Build16](https://buildkite.com/outfitter/agentic-ci-pilot/builds/16), [Build17](https://buildkite.com/outfitter/agentic-ci-pilot/builds/17), [PR1](https://github.com/outfitter-dev/agentic-ci-pilot/pull/1) | Six gates passed and candidate landed. |
| Failing upper layer, safe lower prefix | [Build22](https://buildkite.com/outfitter/agentic-ci-pilot/builds/22), [Build25](https://buildkite.com/outfitter/agentic-ci-pilot/builds/25), [PR2](https://github.com/outfitter-dev/agentic-ci-pilot/pull/2) | Failure blocked the upper layer while the passing lower layer landed. |
| Upper repair and requalification | [Build33](https://buildkite.com/outfitter/agentic-ci-pilot/builds/33), [Build34](https://buildkite.com/outfitter/agentic-ci-pilot/builds/34), [PR3](https://github.com/outfitter-dev/agentic-ci-pilot/pull/3) | Fresh context/revision-bound checks passed; upper layer landed. |
| Final private release qualification | [Build35](https://buildkite.com/outfitter/agentic-ci-pilot/builds/35) | Packaging, source/digest validation and clean-consumer smoke passed; no registry or public release publication. |

The historical suite had 204 tests. Native-stack rebase after a lower landing was observed; simultaneous independent groups and arbitrary advancing-base refresh were not qualified. The later [bounded queue record](queue-refresh-qualification.md) adds partial baseline evidence, not those missing acceptance cases. Assigned-human live approval, Ranger replacement and production adoption were not established by the original pilot.

The pilot’s configured reviewer/landing actor were experimental choices. Current review semantics are in the [automation contract](automation-contract.md), with delivery and failure ownership in [AGENTS](../AGENTS.md#standing-delivery-authority). No provider is universally mandatory. Host, queue, actor, state and credential placement are configuration for an agreed operation; this summary selects no permanent host or live action.
