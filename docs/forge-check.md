# Forge check: explicit commands and local observations

`forge check` runs one declared project command. Forge's first consumer declares its existing `bun run check` aggregate; product scripts and task graphs continue to own ordering and parallelism. The evidence evaluator and its `bun run evaluate` interface are unchanged. This command does not invoke review providers or implement Ranger's recovery loop.

## Invocation and configuration

From the repository root, after `./scripts/bootstrap.sh`:

```sh
bun run forge check
bun run forge check --config forge.json --base <full-commit-object-id>
bun run check:hook
```

The same noninteractive command works in an agent session and the CI `check` job. CI still executes checks on every run; a local receipt never skips it. The separate existing evaluator CLI qualification step remains intact.

`forge.json` has exactly these version 1 fields:

```json
{
  "schemaVersion": 1,
  "repository": "outfitter-dev/forge",
  "check": { "id": "check", "command": ["bun", "run", "check"] }
}
```

The command is an argument vector, without implicit shell expansion. Explicitly call a shell or a product script when needed. There is one aggregate command, no discovery, dependency graph, scheduler, provider interface or retry. Unknown keys and versions are invalid. Repository and check identifiers are bounded labels; do not put secrets in configuration. Receipts store argument-vector and config digests, not argument text. Paths supplied with `--config` resolve against the caller's working directory. Arguments are not taken from CI environment variables implicitly.

`--base` takes an explicit full commit object ID available locally. Supply the intended PR base, or the preceding layer's commit for a stack layer. Forge records that base and its actual merge-base with HEAD. An absent base is `null`, meaning not supplied, never inferred applicability to a PR. Missing objects or merge-base fail before command admission. Stack orchestration, fetching and rebasing belong to callers.

## Hooks are configured; activation is explicit

The pinned lefthook dependency and `lefthook.yml` configure pre-push to run the same `bun run forge check`. There is no duplicate full pre-commit check. `check:hook` invokes `lefthook run pre-push --no-auto-install`, allowing qualification without changing shared Git hooks. Neither command calls another hook or `forge check` recursively: the declared command remains the existing `bun run check` task graph.

`trustedDependencies: []` prevents Bun's default trust list from executing Lefthook's automatic hook-install postinstall. Frozen dependency installation and bootstrap must not activate Git hooks. On an isolated fresh Git fixture, plain `bun install --frozen-lockfile` reports a blocked postinstall and creates no pre-push hook. Explicit checkout-owner activation uses `bunx --no-install lefthook install` after coordinating linked worktrees; Git normally shares the hooks directory between them. Do not claim automatic hooks are active from configuration or direct hook qualification alone. The executable adapter is tested without installing shared hooks.

## Framing, paths and exit codes

For a syntactically valid invocation, machine stdout is exactly one JSON object with `kind: "forge-check"` and `schemaVersion: 1`. Its TypeScript contract is [`CheckReceipt`](../src/check-types.ts). Invalid CLI syntax emits a separate `forge-check-input-error` discriminator and exits 2. Missing, malformed or unsupported output is not a valid nonpassing receipt.

Both child stdout and stderr stream to the caller's stderr; stdin is closed. Forge neither persists command output nor copies arbitrary exception text into receipts. Native output is untrusted and can contain secrets printed by project code; callers must protect their terminal/CI logs. The receipt uses fixed bounded diagnostic codes. It captures no environment, hostname, credential values or transcripts.

Receipts live at `<worktree-git-directory>/forge-check/<receiptId>/receipt.json`, outside the source tree and Git's tracked files. A linked worktree uses its own Git administrative directory, not the common hooks directory. Receipt directories and files request owner-only permissions. Publication writes an exclusive temporary file and renames it atomically. `recording.state: "persisted"` describes successful publication, not authentication or fsync/crash durability. The returned path is an informational local reference, not authority for a consumer to read arbitrary paths; resolve it only inside an independently trusted invocation's artifact directory. No transport or automatic import is implemented.

| CLI exit | Meaning |
| --- | --- |
| 0 | Command exited 0, before/after evidence is stable, final record published. |
| 1 | Observed command failure, or successful command with changed/unknown evidence applicability. |
| 2 | Invalid invocation/config/source, or command could not start. |
| 3 | Receipt setup/publication failed; no durable final record is claimed. |
| 4 | Execution completion is unknown if the process can still report it. |
| 130 | Cancellation was requested and terminal attempt observation was recorded. |

Recording failure takes precedence over other CLI exits. Child exit codes remain in `exitCode`; they are not CLI exit codes. Forced termination of Forge itself may produce no JSON and a host/shell signal exit instead of 4. Consumers must treat absent final output as unknown, not retry permission.

## What the record establishes

The receipt has a fresh `receiptId`, claimed repository/check identity, command/config digests, runtime Bun/platform/architecture, timestamps and elapsed milliseconds. `sourceBefore` and `sourceAfter` record HEAD/tree, optional base/merge-base, the index digest and a digest of tracked plus nonignored untracked working files. Working bytes, modes, symlink targets, deletions, staged state and nonignored untracked content affect identity. Counts and dirty flags make coverage explicit without recording filenames or contents. Ignored files are excluded; symlink targets outside the checkout are not read, and submodules fail as unsupported coverage. Runtime dependencies, ignored artifacts and the inherited environment are not fingerprinted. This is not a hermetic execution proof.

Config bytes are observed before and after execution separately. `evidence: "stable"` means those endpoint observations agree; it does not establish that no transient mutation occurred between them or that all runtime inputs were covered. `changed` and `unknown` cannot produce CLI success. Command facts remain intact: exit 0 with changed source is `outcome: "passed", exitCode: 0, evidence: "changed"`, with CLI exit 1. New source, base, config or command identity requires fresh applicable evidence. No pass inheritance or receipt reuse is implemented.

Before spawning, Forge publishes an incomplete record with `admission: "unknown"`, `completion: "unknown"` and no finish time. This conservatively covers interruption between spawn and observation/publication. Reopening that record never proves whether code ran or completed. `admission: "started"` is set only after the process spawn event. `completion: "observed"` means a terminal **attempt** outcome was observed; for spawn failure no child existed. A request to cancel is distinct from observed termination. On supported POSIX hosts, SIGINT/SIGTERM is forwarded to the child's process group, with SIGKILL after two seconds if it has not exited. This bounds cancellation cleanup, not recovery retries. Escaped/detached descendants and a killed parent require host supervision; Forge is not a process sandbox.

These are project-code observations from the caller's authority. Project commands inherit the caller's environment and filesystem access. Invoke them without privileged orchestration credentials; this command grants no credentials and provides no sandbox. CI checkout continues to disable persisted Git credentials. Repository identity is a claim from explicit config: a future consumer must compare it, the source/base, command/config and runtime against its own trusted expectations. Neither matching hashes nor a recorded receipt authenticate a producer. No signing key, trusted-key policy, gate receipt reuse or evaluator integration is introduced here.

## Observed examples and next owner

These cases are exercised in offline credential-free subprocess fixtures. The examples show distinguishing fields, not complete receipts; full fields are declared in `src/check-types.ts`.

| Observation | Receipt fields | CLI | Next owner/action |
| --- | --- | --- | --- |
| Command succeeds | `started / observed / passed`, `exitCode: 0`, `evidence: stable` | 0 | Caller continues its existing gates; CI still runs. |
| Ordinary failed test | `started / observed / failed`, nonzero `exitCode`, `cause: unclassified` | 1 | Author/Ranger diagnoses with evidence; exit alone establishes no flakiness. |
| Declared formatter fails | Same failure facts, formatter's declared check ID | 1 | Author/Ranger determines whether a bounded repair is authorized; no automatic edit authority. |
| Executable cannot start | `not-started / observed / not-run`, null exit, `command-start-failed` | 2 | Caller diagnoses local command/setup; no transient cause is inferred. |
| Invalid config or unavailable source | `not-started / observed / not-run`, fixed diagnostic | 2 | Project owner repairs config or caller supplies applicable source/base. |
| Exit 0 changes source/config | `passed`, `exitCode: 0`, `evidence: changed` | 1 | Author/Ranger reconciles the changed subject and obtains fresh evidence. |
| SIGTERM, child gracefully exits 0 | `canceled`, `cancellation: SIGTERM`, `exitCode: 0`, null observed signal | 130 | Caller honors cancellation; it is not a generic retry. |
| SIGTERM, child ignores it | `canceled`, request SIGTERM, observed `signal: SIGKILL` | 130 | Caller handles cancellation; process termination is separate from its cause. |
| Forge forcibly interrupted | Initial record stays `unknown / unknown / unknown`, finish null | No final output | Caller reconciles delivery/completion and any remaining processes before choosing an action. |
| Receipt publication fails after exit 0 | `passed`, `exitCode: 0`, `recording: {state: failed, path: null}`, `receipt-write-failed` | 3 | Caller repairs local artifact storage and reconciles execution; never replay solely to obtain a receipt. |

Every cause is currently `unclassified`; this producer has no evidence rule establishing transient infrastructure or flaky-test categories. Ranger owns classification, evidence-backed bounded retry/repair/review/refresh/diagnosis, and separate cause/result lineage with changed-subject identity. Cancellation and delivery certainty are independent facts. Ranger retains handoff ownership until accepted; unresolved contract decisions go to the engineering owner. The FOR-26 review contract remains the review evidence contract, with no second fallback ladder here.

## Verification scope

`bun run check` exercises config validation, command failure/admission, identity changes, source coverage, PR/stack-layer bases, cancellation, interruption, publication failure and adapters. Direct CLI and lefthook invocation use the same declared operation; CI invokes it and retains its named evaluator fixture qualification. Local receipts are observations only. This slice does not qualify external consumers, deploy workers, publish packages, change repository visibility/access, or resume the parked tokens trial.
