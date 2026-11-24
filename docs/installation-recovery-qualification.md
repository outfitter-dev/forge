# Local installation and recovery qualification

This November 24, 2026 rehearsal supports [FOR-38](https://linear.app/outfitter/issue/FOR-38). It exercised Forge source revision `bd873454a67db313e51491611ab8e548ea150767` on macOS ARM64 with Bun 1.4.4 and Apple Git 2.54.0. The operation uses disposable local checkouts and credential-free GitHub fixtures. Worker installation, host permissions, Buildkite job authentication, protected capture transport and status publication still need qualification on the selected hosts.

## Verify an installation before running it

The rehearsal created a fresh standalone clone without installing dependencies, selected the full revision above, and kept the verifier copy outside the clone. The copied verifier's SHA-256 was `12da5d37df269050a4ab65742f7c3a0e9ca6df44905d105fdbc1a3ad60e70877`. The check accepted the selected source and Bun pin. Supplying the earlier commit `e5f1571acb3577dae4b60c3eb3a4817fba838e1b` was refused with `the install's HEAD is not the expected commit.`

Use an operator-selected source and verifier for a new rehearsal. Resolve all placeholders before running this example. Keep the verifier, policy and state outside proposed checkouts. The [trusted installation contract](trusted-install-check.md) describes the host ownership and environment assumptions that accompany these commands.

```sh
env -i PATH="$approved_tool_path" bash "$protected_verifier" \
  --install "$clean_install" --repository outfitter-dev/forge \
  --commit "$approved_commit"
```

From the verified clone, `bun src/forge-cli.ts gate` reported the required input fields and exited 2 without dependencies. The clone then passed the verifier again and had empty Git status. This establishes that the installed CLI starts and refuses an incomplete invocation. A real evaluation additionally needs a trusted policy, authenticated GitHub reads, the explicit head/base pair, qualified check receipts, review evidence and a state directory outside the job workspace.

## Recover an interrupted local operation

The recovery suite ran from a separate clean, bootstrapped development checkout at `d55b658ca64733329668b4635b17cae8c0547289`, including the new recovery test. To reproduce that recorded run, check out that revision before running the following credential-free rehearsal:

```sh
./scripts/bootstrap.sh
bun test tests/check-recovery.test.ts tests/check-cancellation.test.ts tests/review-ledger-store.test.ts
```

The November 24 run passed 126 tests and 671 assertions. The recovery test starts the real check CLI against a disposable Git proposal, waits until its command starts, and sends SIGTERM. Although that command exits zero while handling the signal, Forge exits 130 and persists a canceled receipt. After command termination, a fresh invocation at the same source revision produces a new passing receipt. The canceled receipt remains byte-for-byte intact, with its own ID. The test also reads the restarted receipt from disk and compares the complete persisted JSON with the CLI output. A bounded wait and explicit process-group cleanup keep the fixture from surviving a broken cancellation path. The fixture changes only a control marker in its Git administrative directory to let the second invocation finish. Source, command and configuration bindings stay the same. This models an operator-approved retry of a harmless fixture command; a product owner must assess real command effects before retrying.

The cancellation suite also kills the runner abruptly and checks that its already-published receipt remains unknown. No finished receipt or passing result is inferred after that interruption. Detached process cleanup still belongs to the selected host's supervisor.

The ledger suite writes an entry, simulates an abandoned per-PR lock, and verifies that repeated writes report `ledger-busy` while preserving the entry. It removes only its own simulated lock after confirming no fixture writer owns it, then successfully replaces the entry. A separate read/collect/replace sequence demonstrates that the next collection starts from persisted history, and a stale concurrent writer cannot replace a newer entry. In a real recovery, the operator must drain or stop the writer, preserve the existing entry and determine lock ownership before removing an abandoned lock. Follow the [ledger store recovery procedure](review-ledger-store.md).

## Inputs and rollback

For the live installation, record the approved Forge commit, verifier and hook hashes, Bun pin, actual host/account, protected policy digest, repository and PR revision pair, expected job and capture identity, and ledger path and writer. Project code must be unable to modify these inputs or read orchestration credentials. [The lane plan](buildkite-lanes-plan.md) identifies the remaining host and service choices.

The local rehearsal creates no reporting route. Its rollback is to stop the fixture processes and preserve the check receipts and ledger evidence before disposing of the temporary workspace. A live rollback must disable the affected reporting route, leave an unavailable or nonpassing decision instead of stale success, drain jobs, preserve the ledger and capture records, and restore the previous approved installation and policy. Re-evaluate the current PR revision before resuming publication. Those live steps require their own service qualification and authorization.
