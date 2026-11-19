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

Stage the host files on Linux from a separate, reviewed source checkout with the pinned Bun, its build dependencies, and a C compiler with static libc. Build for the worker's architecture. Do not install dependencies into the release checkout that the verifier inspects.

```sh
bash scripts/stage-buildkite-bootstrap.sh /path/to/empty-staging-directory
```

For an approved deployment, install the staged files at the following fixed paths. Root must own these directories, their parent paths and the files, with no write access for either lane account. Use executable files with mode `0555` and config with mode `0640` and group `bk-trusted`. Keep the configuration directory free of default pipeline files.

| Staged file | Trusted host path |
| --- | --- |
| `command` | `/etc/buildkite-agent/hooks/trusted/command` |
| `forge-buildkite-dispatch` | `/opt/forge/bootstrap/forge-buildkite-dispatch` |
| `verify-trusted-install.sh` | `/opt/forge/bootstrap/verify-trusted-install.sh` |

The operator creates `/etc/forge/trusted-bootstrap/dispatch.json` separately. It contains no credentials and selects:

| Fields | Host selection |
| --- | --- |
| `install`, `installCommit`, `repository` | Read-only mount at `/opt/forge/releases/<commit>`, approved full commit, GitHub owner/name |
| `verifier`, `bun`, `agent` | Staged verifier above, `/opt/forge/tools/bin/bun`, `/usr/local/bin/buildkite-agent` |
| `organizationId`, `organizationSlug`, `pipelineId`, `pipelineSlug` | Configured Buildkite organization and pipeline UUIDs and slugs |
| `queueId`, `trustedQueue`, `projectQueue` | Trusted cluster queue UUID and the two distinct queue names |

The Buildkite agent must execute the statically linked command hook directly as a [binary hook](https://buildkite.com/docs/agent/hooks#polyglot-hooks), not source a wrapper or run an intermediate shell. The hook refuses every step key except `forge-bootstrap`; this is a prefilter, not authentication. It starts the fixed dispatcher and config from the protected config directory with closed inherited descriptors above stderr, no job stdin, and only fixed `PATH` and `HOME` plus these inputs:

- The agent supplies the actual job's `BUILDKITE_JOB_ID` and `BUILDKITE_AGENT_ACCESS_TOKEN`, not the registration token.
- The trusted caller supplies `FORGE_BUILDKITE_READ_TOKEN` with only Buildkite `read_builds` access.
- The trusted caller supplies `FORGE_GITHUB_TOKEN`, a short-lived per-job GitHub App installation token scoped to the configured repository and PR read. There is no PAT, static file, or App private-key fallback. Credential delivery and the [scoped token service](https://linear.app/outfitter/issue/OUT-497) are separate.

Use the [lane plan's agent controls](buildkite-lanes-plan.md#lane-responsibilities), including strict checkout overrides, `no-command-eval`, no local hooks and no plugins. Set `skip-checkout=true` on the trusted agent itself; also set checkout skip on the stored bootstrap and make its placeholder command fail if the hook is absent. Protect the four inputs from job-supplied overrides using the agent's [protected environment variables](https://buildkite.com/docs/agent/self-hosted/configure#protected-environment-variables); also protect pre-hook execution inputs such as `PATH`, `HOME`, `BASH_ENV`, `ENV`, `LD_*`, `GLIBC_TUNABLES`, and dangerous Git variables. Do not allow proposed code to set protected variables through hooks or the Job API, access the job token, or modify the bootstrap files, tools, or approved release. None of the accepted input values authenticates a job on its own; the dispatcher still checks the signed claims and build record. Captured token and graph data, subprocess stderr and service errors are not written to logs.

The hook uses Linux user and PID namespaces without changing the agent UID or GID. It forwards interruption and termination to the dispatcher, kills the job if it does not stop within two seconds, and relies on namespace teardown to remove detached children even if the hook is killed. The hook refuses to run if it cannot establish containment. This is process lifetime containment for trusted tasks, not an isolation boundary for proposed code. Qualify the worker's kernel support, actual agent configuration and job credentials separately.

Offline tests cover staging, launch, refusal, signal forwarding, descendant cleanup, and the existing signed-job and service fixtures. No worker settings or pipeline signing settings are applied. Manual rebuilds, `forge-check` and `forge-gate` are not dispatched by this entry point. Before Google federation or any real trusted-lane workload, whichever comes first, complete and verify the [pilot credential restriction](https://linear.app/outfitter/issue/OUT-499); a secret-store change alone does not satisfy that gate.

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

The verifier accepts one receipt of at most 64 KiB. The job must match the admitted organization, pipeline, build, job, queue, repository, PR and head and be a successful, non-soft-failed, non-superseded `forge-check` attempt. The capture must match that exact job, report runner exit zero, and match the receipt bytes. The receipt's repository and both head/base observations must match admission. `verified: true` means the receipt is bound to the job, not that the expected check passed.

Passing evidence also requires independent expectations for the command digest, the raw config digest, and the runner's Bun version, platform and architecture. Both config observations must equal the expected digest; agreement with each other is not enough. Select these pins, the check mapping, and the producer/runtime fingerprint from trusted policy, never from the proposed checkout or receipt. Missing pins, mismatched execution, and nonpassing normalized checks return a bound observation with an empty `checks` list and a fixed reason. Matching metadata is not a proof of hermetic execution.

This function does not authenticate Buildkite records or the capture store itself. The future adapters must select a unique current job attempt and its authoritative capture, preserve the job ID and digest for audit, enforce the size bound while reading, and refuse missing or ambiguous records. Before live use, approve and qualify the protected capture channel and digest storage, job-attempt selection, artifact upload/read permissions, and how trusted execution expectations are approved and maintained. No adapter, network call, credential, status write or gate hook is included here.

## Status refresh preview

`selectBuildkiteStatusRefresh` recognizes submitted or dismissed reviews, resolved or reopened review threads, and changes to the configured hold label. A delivery names only the configured repository and PR number to reread. It does not supply revisions, authorize a build, resolve findings, or prove that the condition described in the event still holds. Any eventual adapter must authenticate GitHub deliveries and qualify which events it subscribes to. Comments and rebuild authorization are outside this preview.

`previewBuildkiteStatusRefresh` takes an independently read, admitted PR, a fresh trusted gate result, and a second PR read. Both reads must identify the same open, unmerged, same-repository PR and exact head/base. The gate run identifier and recorded evaluation must also match; a newer hold, draft or mergeability observation withholds the preview. A same-head review or hold change can yield a different verdict, but an unavailable observation, stale run, changed base or changed head yields no preview. This is an offline preview, not a status payload, webhook receiver, queue or publisher. A live integration must still obtain qualified project evidence and run the existing gate against fresh review state and the exact admitted pair.

Before deployment, the operator must approve how review, hold and thread changes enter the authenticated trusted lane. Qualify Buildkite's native events where supported; choose an authenticated receiver or authorized rebuild path for events it does not originate, and show that each delivery is accepted under protected job admission. Current dispatch requires both Buildkite's signed job claims and its build record to identify a webhook source, so an API or manual rebuild is not automatically admitted. Select the GitHub App and gate-only status context, how to supersede a prior success while refresh is pending or unavailable, and how to handle multiple PRs sharing one head SHA (a head/context status cannot distinguish them). Serialize refresh evaluation and publication per status identity and qualify replays and concurrent same-head changes. Findings-source policy adoption remains separate.

## Remaining integration

The remaining project and gate hooks must implement their own dispatch and qualification. The host must disable local hooks and plugins, keep persistent ledger state outside jobs, and prevent proposed code from accessing orchestration credentials or changing task dispatch.

The project launcher must run the declared check in isolation and capture its receipt under the admitted job identity. The trusted worker must authenticate the Buildkite job outcome and protected capture, apply the receipt verifier, then pass the trusted policy, state and revision pair to [Forge gate](forge-gate.md). Use `--expected-head` for the exact commit that will receive the status and `--expected-base` for the admitted PR base. If either differs from GitHub’s collected subject, the gate exits 3 before updating its ledger.

Status publication awaits a qualified subject and producer boundary. No preview or emitted notification grants a GitHub success status. Live worker deployment, authenticated review/hold triggers, verification of GitHub App access, and the acceptance scenarios remain FOR-38 work. The emitter creates no pipeline, build, worker or credential.
