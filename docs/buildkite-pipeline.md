# Buildkite pipeline graph

`forge buildkite pipeline` emits native Buildkite JSON for the two execution lanes in [FOR-38](https://linear.app/outfitter/issue/FOR-38). It runs offline and writes one pipeline document to stdout. Invalid arguments exit 2, print usage to stderr and leave stdout empty.

```sh
bun src/forge-cli.ts buildkite pipeline \
  --project-queue ci-project \
  --trusted-queue ci-trusted \
  --head "$ADMITTED_HEAD" \
  --base "$ADMITTED_BASE"
```

Queue names are explicit and contain ASCII letters, digits, underscores or hyphens. Supply distinct names from the trusted bootstrap configuration. Equal names, including names differing only in ASCII case, are refused. Each lane's registration token must be bounded to its own queue. Agents also carry the corresponding `role=project` or `role=trusted` tag. Routing tags select workers; queue-scoped registration and the host establish their actual isolation and credentials.

Both full lowercase 40-character commit IDs are required from trusted admission. Each step carries the same `FORGE_HEAD_SHA` and `FORGE_BASE_SHA` pins. Missing, malformed or symbolic revisions fail before any graph is emitted. Workers must compare the actual checked revision, current head/base and received artifact/receipt bindings to these pins before status eligibility. The emitted environment alone establishes no authenticated subject or producer.

The first step selects the project lane with `FORGE_BUILDKITE_TASK=check`. The second selects the trusted lane with `FORGE_BUILDKITE_TASK=gate` and depends on the check, with `allow_dependency_failure: true` so failed verification can still be evaluated. Buildkite cancellation can cancel a dependent step; the graph makes no promise of a final evaluation after cancellation. The [native dependency behavior](https://buildkite.com/docs/pipelines/configure/depends-on) remains applicable.

Both steps disable automatic checkout using the native [command-step checkout attribute](https://buildkite.com/docs/pipelines/configure/step-types/command-step). The eventual project worker must acquire the admitted proposal in its isolated execution boundary. The trusted worker must never check out or execute the proposal. Every emitted command exits 1 with a fixed missing-hook message. An installed host command hook must dispatch the fixed task from its trusted runtime before either step can perform work. This keeps an unconfigured worker from reporting a passing placeholder command.

## Bootstrap admission

`forge buildkite bootstrap` reads the specified pull request through Forge's existing bounded GitHub REST transport and emits the same native graph only after admission. The host supplies the repository, pull request number, queues and the exact commit Buildkite will report on. `FORGE_GITHUB_TOKEN` supplies the read credential. `BUN_CONFIG_VERBOSE_FETCH` must be absent, including an empty value, before any authenticated request can run.

```sh
bun src/forge-cli.ts buildkite bootstrap \
  --repository outfitter-dev/forge \
  --pull-request "$BUILD_PULL_REQUEST" \
  --commit "$BUILD_COMMIT" \
  --project-queue ci-project \
  --trusted-queue ci-trusted
```

Admission requires an open, unmerged pull request whose number and base repository match the request, whose head repository ID equals its base repository ID, and whose head commit equals the supplied build commit. A missing head repository or a fork fails admission. Draft pull requests may run verification. The graph's head and base come from GitHub's response, including for a pull request targeting another feature branch. `base.sha` is the base GitHub records for the PR and can lag the branch tip, as described in [pull request collection](pull-request-collection.md). Gate collection must still check the admitted pair immediately before evaluation.

Success writes only the native graph to stdout and exits 0. Invalid arguments or a missing credential exit 2. Refused admission and unavailable or malformed GitHub observations exit 3. Every failure leaves stdout empty and prints a fixed diagnostic to stderr. Tokens and remote response/error text stay out of diagnostics. No upload is performed. A host adapter must capture the successful document before invoking Buildkite's upload command, checking the bootstrap exit code first.

The host must first verify its trusted Forge installation, authenticate the actual Buildkite pipeline/build identity, and derive the build commit and PR number from that identity. It must supply its own configured repository and queues. Caller-supplied arguments and job environment variables do not authenticate those claims. Run from the verified installation under a host-controlled environment and working directory, with local hooks and plugins disabled. The eventual host hook owns those requirements and must recheck admission and artifact bindings in subsequent tasks because the PR can change after this read.

## Remaining integration

The graph emitter and bootstrap admission are the dispatch slices. The host bootstrap must validate the install and build identity before running admission and uploading the graph. Repository, pull request, head/base revisions, fork origin and run identity belong to that admission and the host worker; pipeline environment values alone cannot prove them. The host must disable local hooks and plugins, keep persistent ledger state outside jobs, and prevent proposed code from accessing orchestration credentials or changing task dispatch.

The project worker must run the declared check and bind its receipt to the admitted revision and producer. The trusted worker must verify the Buildkite job outcome and receipt provenance, then pass the trusted policy, state and revision pair to [Forge gate](forge-gate.md). Use `--expected-head` for the exact commit that will receive the status and `--expected-base` for the admitted PR base. If either differs from GitHub’s collected subject, the gate exits 3 before updating its ledger.

Status publication awaits a qualified subject and producer boundary. No emitted notification grants a GitHub success status. Live worker deployment, webhook triggers for review/hold changes, verification of the existing GitHub App access, and the acceptance scenarios remain FOR-38 work. The emitter creates no pipeline, build, worker or credential.
