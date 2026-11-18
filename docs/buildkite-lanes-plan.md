# Configurable Buildkite hosts and lanes

This completes FOR-8's reopened planning scope for configurable hosts and trusted/project execution lanes. The [worker lifecycle plan](worker-lifecycle-plan.md) owns preservation, launch, drain, update, rollback and capacity measurement. [FOR-38](https://linear.app/outfitter/issue/FOR-38) owns implementation and live qualification of the first Forge pipeline. Host selection and credential changes still require Matt's decision under [standing delivery authority](../AGENTS.md#standing-delivery-authority).

## Configuration to settle before launch

The operator keeps one private, reviewed record for the selected installation. The table describes the required information and its owner. It defines planning inputs, with no new configuration format or parser.

| Configuration | Owner and required decision |
| --- | --- |
| Consumer and service identity | Forge delivery owner records the exact GitHub owner/repository, Buildkite organization/cluster/pipeline, GitHub App installation, status context and permitted build sources. Another consumer receives its own authority and credentials. |
| Host and process identity | Matt selects each lane's machine and operator, with a backup operator. Record operating system, agent version, agent account, project execution account and the actual enforcement mechanism. A Linux VM on NUC/Proxmox and a native review host remain placement candidates. |
| Queue routing | Operator records distinct project/trusted queue names and IDs, and `role=project` / `role=trusted` tags. Names are passed explicitly to the [graph emitter](buildkite-pipeline.md). |
| Trusted release | Forge delivery owner selects the approved repository, full commit, Bun pin, protected verifier copy, host hook and policy revision. Operator records absolute install/configuration paths and the prior rollback release privately. |
| State and workspace roots | Operator records protected ledger state, any qualified review cache, disposable job roots and private diagnostic retention. Persistent state has one accountable writer and a drained backup/restore procedure. Job cleanup cannot traverse these roots. |
| Credential custody | Named custodians record secret-store references, delivery permissions, scopes, actual expiry, renewal owner/backup, overlap and revocation procedure. Keep values and concrete secret-store locations outside source. |
| Limits and operator surface | Operator selects enforced CPU, memory, process, disk and duration budgets, plus network/mount policy. Preserve separate review/verification panes if Rex remains the selected surface. Start with one job per lane and use the lifecycle plan's measurement criteria before increasing capacity. |

Several lanes may share physical infrastructure only after its configured enforcement proves credential, filesystem and process separation. Sharing a hostname or an agent executable establishes no permission to share state or tokens. The selected record must show who can write the install and hook while a job runs.

## Lane responsibilities

The trusted lane owns admission, pipeline upload, GitHub collection, ledger writes and gate evaluation. Keep its runtime and working directory outside proposed checkouts. Start the protected verifier copy with an environment and tool paths the host controls, verify the approved install, then invoke the fixed task from that install. Bun can load a working directory's `bunfig.toml`, so a job-controlled working directory cannot be used for this invocation. The verifier's [documented assumptions and limits](trusted-install-check.md) remain part of qualification.

The project agent's host hook acquires a fresh, full clone at the admitted head and dispatches the declared check with the admitted base. Run proposed code as a second unprivileged account with a cleared environment, no orchestration credentials, host-home access or Docker socket. The project execution account cannot read the agent's registration token or job credentials, change the hook/install, or contact the agent's local privileged interface. The host wrapper owns credentialed artifact upload after the process exits. An old workspace or restored source tree can carry ignored files, so each build starts from a fresh clone. A cache optimization needs its own qualification before adoption.

Use a dedicated registration token per lane, restricted to that lane's selected queue. The project token must exclude `upload_steps`, `write_steps` and `cancel_builds`. It needs `run_jobs` and the artifact operations the host wrapper actually uses. The trusted token permits pipeline upload and the exact read/report operations its tasks require. Configure every permission explicitly, including secret, OIDC and repository-credential access. Buildkite documents that new tokens default to all permissions and all queues, and that agent/job permissions inherit from registration. [Scoped agent tokens](https://buildkite.com/docs/agent/self-hosted/scoped-agent-tokens)

The host disables repository hooks and plugins for both lanes and enforces fixed dispatch. The FOR-38 design calls for `no-command-eval`, `no-plugins`, `no-local-hooks`, `no-git-submodules`, `strict-single-hooks`, protected environment variables and strict checkout override settings. Verify the selected agent version's actual behavior during deployment. Buildkite's command hook order gives plugin/repository command hooks priority over the agent hook. [Agent hooks](https://buildkite.com/docs/agent/hooks)

## Admission and evidence flow

1. The pipeline's stored bootstrap routes to the trusted queue. Trusted admission verifies the consumer, pipeline/build identity, open pull request, same-repository origin, current head/base and the exact commit that will receive the status. Reject fork origins before dispatch to Matt's hardware. Check the actual fork-build setting during setup and enforce origin again in admission.
2. The verified install emits the two steps with that revision pair. Both skip automatic checkout. The `forge-check` host wrapper runs the isolated check, records its process outcome and uploads the selected receipt for this build. The graph's fixed command fails until the host hook exists.
3. `forge-gate` runs after verification failure as well as success. The trusted task validates the Buildkite job outcome, artifact identity, receipt completeness and exact subject, then calls `forge gate` with trusted policy/state and both `--expected-head` and `--expected-base`. Incomplete, missing, canceled or mismatched evidence stays non-passing. Cancellation may prevent the dependent gate task from running.
4. After qualification, only the gate step carries the rolled-up status. Disable the pipeline's default build-level status. Each new evaluation runs both steps again and consumes that build's receipt. A successful artifact transfer alone supplies no producer or source authenticity.

The adopted findings policy still requires a current complete supplied global ledger. The [configured-bot findings document](configured-bot-findings-proposal.md) is a proposal pending confirmation. Deployment cannot treat it as accepted policy or manufacture complete findings from a green provider check.

The setup must cover every open PR base, including upper stack layers. Configure native review/label events for changes they support. The current FOR-38 design uses an authorized command comment to request a rebuild after thread resolution, because that event has no native trigger in the documented event list. Automatic refresh requires a qualified trigger path before unattended acceptance can be claimed. [GitHub source-control events](https://buildkite.com/docs/pipelines/source-control/github#running-builds-on-additional-github-events)

## Plugin fit

The first two-lane implementation uses native pipeline upload, artifact transfer and annotations through the host wrapper. Plugins execute lifecycle hooks, so adopting one changes the code and environment that run at that boundary. The current `no-plugins` lanes need none of these candidates. A product adoption should name its concrete need, review the plugin and pin an immutable source revision before enabling it on an appropriate worker. [Buildkite plugins](https://buildkite.com/docs/pipelines/integrations/plugins)

| Candidate | Concrete fit and adoption condition |
| --- | --- |
| Docker Compose | Product integration checks with service containers. Qualify an isolated worker with controlled mounts, environment and daemon access before use. Keep the product's Compose graph in its repository. [Docker Compose plugin](https://github.com/buildkite-plugins/docker-compose-buildkite-plugin) |
| Cache | Dependency-download optimization after measuring installation cost. Use consumer/runtime/lockfile-specific storage with a qualified trust boundary and cold-run comparison. Trusted runtime/state and source workspaces stay outside restored caches. [Cache plugin](https://github.com/buildkite-plugins/cache-buildkite-plugin) |
| Test Collector | Upload existing JUnit/JSON reports when a product adopts Test Engine. Put upload credentials in a reporting boundary that cannot execute proposed code and qualify handling of untrusted report files. [Test Collector plugin](https://github.com/buildkite-plugins/test-collector-buildkite-plugin) |
| Monorepo Diff | Path-driven pipeline selection for a product that needs it. Prefer its existing task graph when it already selects affected work. Any step-uploading plugin belongs in a trusted control boundary whose inputs cannot edit gate policy. [Monorepo Diff plugin](https://github.com/buildkite-plugins/monorepo-diff-buildkite-plugin) |

## Implementation and qualification sequence

The approved policy file, trusted-install verifier and offline graph emitter are delivered. The remaining FOR-38 sequence is host-owned bootstrap/command tasks, authenticated artifact and result collection, service configuration, then live acceptance. The Forge delivery owner prepares those changes and obtains independent review and checks. Matt selects hosts and approves the pipeline/webhook or credential changes when their concrete configuration is ready.

First use credential-free disposable fixtures to check admission rejection, fixed task dispatch, missing/wrong install pins, artifact/subject mismatch, deterministic failed checks and cancellation. Then the selected operator qualifies the actual host isolation and credential boundaries, a passing PR, a failed check, proposal edits to orchestration files, same-head review/hold refresh, fork rejection and drain/update/rollback. Record dated source/runtime/configuration identity, service settings, job/status references and observed limits. Keep runtime and persistent state under the lifecycle plan's preservation procedure throughout.

FOR-38 owns the resulting implementation and live evidence. [FOR-39](https://linear.app/outfitter/issue/FOR-39) owns required-status enforcement and [FOR-40](https://linear.app/outfitter/issue/FOR-40) owns live consumer acceptance. FOR-8 planning can close when this plan is reviewed and merged, while those delivery issues retain their own acceptance conditions.
