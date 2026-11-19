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

The [host bootstrap dispatcher](#host-bootstrap-dispatch) verifies the installation, authenticates the actual Buildkite job and derives the build commit and PR number from that identity. Caller-supplied arguments and job environment variables do not authenticate those claims. Later worker tasks must recheck admission and artifact bindings because the PR can change after this read.

## Host bootstrap dispatch

The dispatcher handles only the self-hosted, webhook-triggered `forge-bootstrap` step. It runs a protected copy of the install verifier before starting Forge, requests a short-lived [Buildkite OIDC token](https://buildkite.com/docs/agent/cli/reference/oidc) from the current job, and checks the signature, issuer, audience, time window, job, pipeline, step and queue. It reads the [build record](https://buildkite.com/docs/apis/rest-api/builds#get-a-build) using the signed build number and checks the build UUID, running job, repository and commit before taking the PR number from Buildkite. The verified install reads that PR from GitHub and produces the graph. Only a successful, nonempty graph goes to native `pipeline upload`, over stdin, with interpolation disabled and parse warnings rejected.

Build the dispatcher from reviewed source as a host-owned executable. Do not install dependencies into the Forge checkout that the verifier inspects.

```sh
bun build --compile --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
  src/buildkite-host-dispatch.ts --outfile /path/outside/the/install/forge-buildkite-dispatch
```

The operator supplies one absolute path to protected JSON. It contains:

| Fields | Host selection |
| --- | --- |
| `install`, `installCommit`, `repository` | Absolute verified Forge checkout, approved full commit, GitHub owner/name |
| `verifier`, `bun`, `agent` | Absolute protected paths outside that checkout, including a copy of the verifier and the Bun executable named `bun` |
| `organizationId`, `organizationSlug`, `pipelineId`, `pipelineSlug` | Configured Buildkite organization and pipeline UUIDs and slugs |
| `queueId`, `trustedQueue`, `projectQueue` | Trusted cluster queue UUID and the two distinct queue names |

The protected launcher must start the dispatcher from a host-controlled working directory and a cleared environment. It supplies `BUILDKITE_JOB_ID` and `BUILDKITE_AGENT_ACCESS_TOKEN` from the real agent job, `FORGE_BUILDKITE_READ_TOKEN` with Buildkite `read_builds` access, and `FORGE_GITHUB_TOKEN` with GitHub PR read access. It must prevent the job from replacing those inputs, the launcher, binary, configuration, verifier, tools, or approved installation. Do not apply environment cleanup only after starting a shell in a job-controlled environment. Configure the stored bootstrap step to skip checkout, disable local hooks and plugins, and protect the job credentials and the host execution boundary. The dispatcher does not accept job-provided commands or trust job-provided repository, ref, commit, PR or queue values; its subprocesses inherit only the environment they need. Captured token and graph data, subprocess stderr and service errors are not written to logs.

Use the [lane plan's agent controls](buildkite-lanes-plan.md#lane-responsibilities), including `no-command-eval`, so only the protected command hook can call the dispatcher with its fixed config path. The stored step should fail if the hook is absent. Keep the config directory free of default pipeline files; the dispatcher supplies its graph on stdin, not from a checkout. The launcher must deliver interruption or termination signals to the dispatcher and contain its subprocesses on a hard kill, which the dispatcher cannot handle itself.

Offline tests cover the boundary with local signing keys and service/process fixtures. They do not qualify actual Buildkite claims and PR metadata, API privileges, agent configuration or host isolation. This slice supplies no worker installation or service settings, including pipeline signing configuration. Manual rebuilds, `forge-check` and `forge-gate` are not dispatched by this bootstrap entry point.

## Project check runner

The project runner is the unprivileged half of the future `forge-check` hook. Build it from reviewed source, outside the proposed checkout:

```sh
bun build --compile --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
  src/buildkite-project-check.ts --outfile /protected/forge-buildkite-project-check
```

The protected launcher must authenticate the job and pins, prepare a fresh full checkout with host-controlled Git metadata, and enter the selected OS isolation under a dedicated account before invoking the absolute executable from the checkout root. It passes the expected repository and full head/base OIDs as arguments and starts the runner with an empty environment:

```sh
env -i /protected/forge-buildkite-project-check \
  outfitter-dev/forge "$ADMITTED_HEAD" "$ADMITTED_BASE" /protected/project-tools
```

The runner refuses root, inherited environment, linked or shallow checkouts, unexpected source or repository identity, and existing working files that are modified, untracked or ignored. It uses the checkout's regular `forge.json`, a host-selected tool directory plus system paths, and the existing [Forge check receipt and exit contract](forge-check.md). The check subprocess receives only the tool `PATH` at launch. The runner sends command output to stderr and the receipt to stdout; the receipt is a project-side observation, not authenticated evidence.

This does not install a hook, acquire source or dependencies, upload receipts, or create a sandbox. The actual launcher must keep credentials, agent interfaces, host homes and sockets inaccessible to the project account and contain detached processes. Host/account choice, dependency preparation inside isolation, and job/receipt binding and upload remain separate; offline fixtures qualify only the runner's behavior. The native graph still fails without the protected hook.

## Project receipt verification

`verifyBuildkiteProjectReceipt` takes the admitted project job and PR pins, a normalized job outcome from authenticated Buildkite collection, and the protected launcher's capture record. None may come from project code or artifact metadata. The launcher must record the exact job ID, the runner exit code, and the SHA-256 of the exact bytes read from the protected runner's stdout (including the trailing newline). It must keep that record outside the project account's reach. Do not hash a receipt read from the project workspace or derive the expected digest from the retrieved artifact.

The verifier accepts one receipt of at most 64 KiB. The job must match the admitted organization, pipeline, build, job, queue, repository, PR and head and be a successful, non-soft-failed, non-superseded `forge-check` attempt. The capture must match that exact job, report runner exit zero, and match the receipt bytes. The receipt's repository and both head/base observations must match admission; its config observations must agree and its normalized check evidence must pass. Only then does the verifier return check evidence using the caller's trusted check mapping and producer/runtime policy. Failures return fixed reasons and no evidence. A matching artifact name, receipt ID, or successful job status is not sufficient.

This function does not authenticate Buildkite records or the capture store itself. The future adapters must select a unique current job attempt and its authoritative capture, preserve the job ID and digest for audit, enforce the size bound while reading, and refuse missing or ambiguous records. Before live use, approve and qualify the protected capture channel and digest storage, job-attempt selection, artifact upload/read permissions, and producer/runtime identity. No adapter, network call, credential, status write or gate hook is included here.

## Remaining integration

The remaining project and gate hooks must implement their own dispatch and qualification. The host must disable local hooks and plugins, keep persistent ledger state outside jobs, and prevent proposed code from accessing orchestration credentials or changing task dispatch.

The project launcher must run the declared check in isolation and capture its receipt under the admitted job identity. The trusted worker must authenticate the Buildkite job outcome and protected capture, apply the receipt verifier, then pass the trusted policy, state and revision pair to [Forge gate](forge-gate.md). Use `--expected-head` for the exact commit that will receive the status and `--expected-base` for the admitted PR base. If either differs from GitHub’s collected subject, the gate exits 3 before updating its ledger.

Status publication awaits a qualified subject and producer boundary. No emitted notification grants a GitHub success status. Live worker deployment, webhook triggers for review/hold changes, verification of the existing GitHub App access, and the acceptance scenarios remain FOR-38 work. The emitter creates no pipeline, build, worker or credential.
