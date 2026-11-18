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

## Remaining integration

This graph is the offline dispatch slice. A trusted bootstrap must validate the install and admission before uploading it. Repository, pull request, head/base revisions, fork origin and run identity belong to that admission and the host worker; pipeline environment values alone cannot prove them. The host must disable local hooks and plugins, keep persistent ledger state outside jobs, and prevent proposed code from accessing orchestration credentials or changing task dispatch.

The project worker must invoke the declared check through Forge and bind its receipt to the admitted revision and producer. The trusted worker must authenticate and validate that receipt, then invoke the existing `forge gate` operation with trusted policy and state. Neither gate behavior nor receipt validation is implemented again in the emitter.

Status publication awaits a qualified subject and producer boundary. No emitted notification grants a GitHub success status. Live worker deployment, webhook triggers for review/hold changes, verification of the existing GitHub App access, and the acceptance scenarios remain FOR-38 work. The emitter creates no pipeline, build, worker or credential.
