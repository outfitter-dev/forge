# Verification gate evidence from check receipts

`normalizeCheckReceipts(receipts, expectation)` turns [`forge check`](forge-check.md) receipts into the `CheckEvidence` entries the [evidence evaluator](evidence-evaluator.md) requires for its `lint`, `test` and `build` gates (FOR-35). It is a pure function exported from `src/index.ts`: no filesystem, clock, network or process access. It does not read receipts from disk, collect PR facts, call the evaluator or publish anything. `forge.json`, `forge check` and the evaluator are unchanged.

```ts
import { normalizeCheckReceipts } from "./src/index.ts";

const { checks, rejected } = normalizeCheckReceipts(receipts, {
  checks: { build: "check", lint: "check", test: "check" },
  provenance: trustedBuild,
  pullRequest: 35,
});
```

The caller places `checks` in the PR facts it gives the evaluator and decides what to do with `rejected`.

## Expectation and result

The trusted caller supplies the `CheckReceiptExpectation`. None of it is read from a receipt or from the proposed checkout.

| Field | Meaning |
| --- | --- |
| `pullRequest` | The PR number the caller collected these receipts for. A receipt carries no PR number, so this is the one subject field that does not come from the receipt. |
| `checks` | For each verification gate, the declared check ID that satisfies it. Several gates may name the same ID. |
| `provenance` | The verification producer ID and runtime fingerprint the caller vouches for. It is copied onto every result with the receipt's `receiptId` as `runId`. |

Each receipt arrives as `unknown`, because it is JSON from another process. The fields this operation reads are validated here; the others (`runtime`, `startedAt`, `durationMs`, `signal`, `diagnostic`, `cause`, `configBefore`, `configAfter`, `check.commandDigest`, `recording.path`, and a source's `mergeBase` and `coverage`) are neither read nor checked.

A usable receipt produces one `CheckEvidence` for every gate whose mapped check ID equals the receipt's `check.id`, in `lint`, `test`, `build` order. Its subject is `{ kind: "pull_request", id: expectation.pullRequest, repository: receipt.repository, headSha: sourceAfter.head, baseSha: sourceAfter.base }`. The repository, head and base are deliberately the receipt's own, not those of the PR being evaluated. A receipt for an older head, another base or another repository then reaches the evaluator with that subject and fails there as a subject mismatch. Stamping the current revision onto it would relabel stale evidence as current.

Two receipts for the same mapped check produce two results per gate. They are not deduplicated or ranked; the evaluator blocks on duplicate evidence. No receipts produce no results, and the evaluator reports missing evidence.

## Rejected receipts

A rejected receipt produces no evidence and one `{ index, code }` entry, where `index` is its position in the supplied list. The first applicable code in this order is reported.

| Code | The receipt |
| --- | --- |
| `malformed-receipt` | Is not a JSON object with `kind: "forge-check"` and `schemaVersion: 1`, or a field this operation reads is missing, has the wrong type or holds an unsupported value. A `receiptId` with surrounding whitespace is one such value. |
| `repository-missing` | Has `repository: null`. |
| `repository-invalid` | Has a `repository` that is not an `owner/repository` identity. `forge.json` allows other labels; an evaluator subject does not. |
| `check-unmapped` | Has `check: null`, or a `check.id` that no gate maps to. |
| `source-missing` | Has `sourceBefore` or `sourceAfter` null. |
| `head-invalid` | Has a `sourceAfter.head` that is not 40 lowercase hexadecimal characters. |
| `base-missing` | Has `sourceAfter.base: null`: the run was not given `--base`, so it is not bound to a PR base. |
| `base-invalid` | Has a `sourceAfter.base` that is not 40 lowercase hexadecimal characters. |

`forge check` accepts a 64-character base, but an evaluator subject requires 40-character object IDs, so a receipt from a SHA-256 repository is rejected. Rejection is a report, not a failure of the call: the gates that receipt would have served are left without evidence unless another receipt supplies it.

## State mapping

The first matching row decides the state of every result from that receipt.

| Receipt                                              | State        |
| ---------------------------------------------------- | ------------ |
| Every passing condition below holds                  | `passed`     |
| `completion: "unknown"` or `outcome: "unknown"`      | `unknown`    |
| `outcome: "canceled"`                                | `canceled`   |
| `outcome: "failed"`                                  | `failed`     |
| `outcome: "not-run"`                                 | `incomplete` |
| `outcome: "passed"` with any passing condition unmet | `incomplete` |

The passing conditions are all of:

- `recording.state` is `persisted`, `admission` is `started`, `completion` is `observed`, `outcome` is `passed` and `exitCode` is 0.
- `evidence` is `stable`, `cancellation` is null and `finishedAt` is not null.
- `sourceBefore` and `sourceAfter` agree on `head`, `tree`, `base`, `worktreeDigest` and `indexDigest`.
- `dirty` is false and `untracked` is 0 in both `sourceBefore` and `sourceAfter`. A dirty tree means the checked bytes are not the commit's.

So a command that exits 0 while the source or config changed (`evidence: "changed"`) is `incomplete`, never `passed`. The evaluator passes a gate only on `passed`.

## Decision

A project keeps declaring its commands in `forge.json`, which stays at schema version 1 with one aggregate `check`. Which declared check ID satisfies each verification gate is an explicit expectation from the trusted caller. For Forge itself all three gates map to the check ID `check`.

The mapping is not read from `forge.json` because that file lives in the proposed checkout, and [proposed code cannot govern its own acceptance](automation-contract.md#proposed-code-cannot-govern-its-own-acceptance). A change could otherwise choose which of its declared checks answers for a gate. With one check per `forge.json` this fixes a name and nothing more: the command behind that name is still the proposed checkout's own, as the limits below say.

The alternative considered was to let evaluator policy declare which verification checks are required. It was rejected because it changes the evaluator's contract, and the November 12, 2026 [lead handoff](https://linear.app/outfitter/document/forge-lead-handoff-delivered-foundations-ranger-boundary-and-next-ae5e1fc7e398) names a rewrite of the delivered evaluator as work not to take on. The evaluator still requires exactly one result for each of `lint`, `test` and `build`.

The consequence is that with one aggregate check, a failing run fails all three gates. The receipt does not say which part failed; that detail is in the command's own output.

## What this does not establish

- It does not authenticate the receipt's producer. A receipt is a shape-valid claim. The trusted caller must obtain receipts from a build it trusts, and the `provenance` it supplies is its own statement about that build, not something read from the receipt. The receipt's recorded `runtime` is not compared with the fingerprint.
- It fixes which check ID satisfies a gate, not which command ran under that ID. The command behind an ID is declared in the proposed checkout's `forge.json`. This operation does not compare `check.commandDigest`, `configBefore`, `configAfter` or `runtime` with any expectation, and it stamps the caller's fingerprint on every result. The [evaluator's contract](evidence-evaluator.md#input-and-provenance) requires that fingerprint to cover the task and the machinery that ran it, so the caller must establish that before supplying a receipt. The automation contract lets proposed code supply the tasks under evaluation, so a receipt for a rewritten command is a true observation of what that checkout declares; whether such a change is acceptable is for review, not for this step. Pinning the digest here would not settle it either: `["bun", "run", "check"]` keeps its digest while the script it names is rewritten.
- It re-checks the source fields listed above, and otherwise takes `evidence: "stable"` as the receipt's own claim that config and source did not change.
- It trusts the receipt's `dirty` and `untracked` observation. `forge check` derives it from Git's status, which reports nothing for a tracked file marked `assume-unchanged` or `skip-worktree`, as a sparse checkout does. A run over such a tree can be `passed` for a head whose bytes were not the ones checked. Ignored and locally excluded files are not observed at all: they are outside `dirty`, `untracked` and both digests, and the proposed head's own `.gitignore` decides what is ignored. A check that passes only because such a file is present yields a `passed` receipt for a head that fails from a fresh clone. A caller must therefore produce receipts from a fresh, full clone of the head with no index flags, not merely an unflagged checkout, and this stays true after `forge check` learns to refuse or record those flags.
- It does not rank receipts for one check. A run that was interrupted before its record was completed is rejected as `source-missing`, so a later passing run stands alone. A failed run followed by a passing run yields two results, and the evaluator blocks on the duplicate. The caller chooses the one authoritative receipt.
- It emits PR subjects only. It does not produce the `merge_group` candidate checks a merge-group evaluation needs.
- It adds no collector, CLI, transport, signing or receipt reuse. Reading receipts from a trusted build and assembling the remaining PR facts remain the caller's work.

Offline tests in `tests/normalize-check-receipts.test.ts` cover the mapping, each rejection and each state, and give the results to the real evaluator under schema version 2 fixtures for the passing, stale, missing, failing and duplicate cases. They prove deterministic behavior only; no live consumer is qualified.
