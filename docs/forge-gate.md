# Forge gate: one answer for one pull request

`forge gate` answers, for one pull request, whether it passes Forge's six gates (FOR-36). A trusted CI lane and a person at a terminal run it the same way. The name says what it evaluates, not what it does to a pull request: `forge gate` reports the gates' answer and does not itself block anything. Whatever blocks a merge is the repository rule that requires a status, and the lane that reports this command's exit code as that status. Neither exists yet.

## What it does and does not do

It composes operations that already exist, in one fixed order:

- reads the pull request's [review ledger entry](review-ledger-store.md) from the state directory
- [collects the pull request](pull-request-collection.md) from GitHub's API, read-only
- stores the ledger entry the collection returned
- turns the `forge check` receipts it was given into [verification evidence](verification-evidence.md)
- joins optional collected Codex evidence and supplied agent-review evidence with accepted persisted findings
- calls the [evidence evaluator](evidence-evaluator.md) and prints its result

It reports. It does not post a status, a comment or a label, it does not merge, and it does not enforce anything. It makes no request that writes to GitHub. It runs no check and no review. It reads `forge check` receipts and supplied review evidence as files, and optionally collects existing Codex output from GitHub. It writes the ledger entry in the state directory. It has no retry, cache, daemon or scheduler.

## Invocation

```sh
FORGE_GITHUB_TOKEN=<token> bun src/forge-cli.ts gate \
  --repository <owner/name> \
  --pull-request <number> \
  --policy <file> \
  --state <directory> \
  --run-id <id> \
  [--receipt <file>]... \
  [--review-evidence <file>]
```

`bun run forge gate ...` is the same command through the package script. A lane and a person give the same flags; only where the values come from differs. Run it from a trusted revision of Forge, never from the checkout of the pull request being judged.

Every flag takes one value. A missing required flag, an unknown flag, a repeated flag other than `--receipt`, and a flag without a value are invalid input. A value never starts with `--`: `--run-id --receipt` names no run. Relative file paths resolve against the working directory.

| Flag | Meaning |
| --- | --- |
| `--repository` | The repository, as `owner/name`. It must equal the policy's `evidence.repository` exactly, including case. |
| `--pull-request` | The pull request number: a positive decimal integer with no sign or leading zero. |
| `--policy` | The [gate policy file](#the-gate-policy-file). The invoker guarantees it comes from a trusted revision and never from the pull request under evaluation. The command cannot check that. |
| `--state` | An absolute directory for state kept between runs. The review ledger is kept in its `review-ledger` subdirectory, which the command creates when it first stores an entry. A state directory that is the working directory, is inside it, or is reached through it is refused: state must not live in a checkout or a job workspace, where proposed code could write it and cleanup would delete it. |
| `--run-id` | The invoker's identifier for this run: a CI build ID, or anything for a local run. It becomes `provenance.runId` of the collected evidence. Nonempty, with no space at either end. |
| `--receipt` | A file holding one [`forge check` receipt](forge-check.md) as JSON. Give it once per receipt, or not at all. |
| `--review-evidence` | A file holding `{ "agentReviews": [...], "reviewFindings": {...}, "reviewLadder": ... }`: exactly the three [agent-review fields](evidence-evaluator.md#agent-review-under-schema-version-2) of a version 2 pull request, and no other key. The evaluator validates the content. |

With Codex collection disabled, an absent `--review-evidence` supplies no agent attempts or ladder and leaves finding evidence unknown, so `agent-review` fails. With Codex collection enabled and `findingHistory: "codex-only"`, complete accepted collector history can satisfy the gate without that flag. `findingHistory: "supplied-global-ledger"` requires current complete trusted supplied history. An explicitly supplied unknown history remains unknown during composition and blocks. Without any `--receipt` the three verification gates fail the same way.

### The token

The GitHub token is read from the environment variable `FORGE_GITHUB_TOKEN` and from nowhere else: not from `GITHUB_TOKEN`, `GH_TOKEN`, a flag or a file. A missing or empty token, or one that is not visible ASCII with no spaces, is invalid input. The token is sent only as the `Authorization` header of requests to `https://api.github.com`. The command never writes it: not in a document, an issue or an error. It needs read access to the pull request and nothing more.

Bun's verbose fetch logging can print the `Authorization` header to stderr. The command refuses any invocation where `BUN_CONFIG_VERBOSE_FETCH` is set, including an empty value, before reading the token, collecting GitHub state or opening the ledger. Unset the variable before invoking the command.

## The gate policy file

The policy is a strict format of its own. Every level takes exactly the fields shown, except `evidence`, whose remaining fields the evaluator checks.

```json
{
  "schemaVersion": 1,
  "kind": "forge-gate-policy",
  "evidence": {
    "schemaVersion": 2,
    "repository": "example/project",
    "collector": {
      "producer": "collector:example",
      "runtimeFingerprint": "1111111111111111111111111111111111111111111111111111111111111111"
    },
    "verification": {
      "producer": "verification:example",
      "runtimeFingerprint": "2222222222222222222222222222222222222222222222222222222222222222"
    },
    "agentReview": {
      "reviewers": [
        {
          "reviewer": "hosted-bot",
          "rung": "hosted",
          "waitSeconds": 900,
          "producer": "hosted-collector:example",
          "runtimeFingerprint": "6666666666666666666666666666666666666666666666666666666666666666"
        },
        {
          "reviewer": "local-cli",
          "rung": "local",
          "producer": "agent:example",
          "runtimeFingerprint": "3333333333333333333333333333333333333333333333333333333333333333"
        }
      ],
      "instructions": [
        {
          "id": "general-review/standard@1",
          "digest": "4444444444444444444444444444444444444444444444444444444444444444"
        }
      ],
      "ladder": {
        "producer": "ladder:example",
        "runtimeFingerprint": "7777777777777777777777777777777777777777777777777777777777777777"
      }
    }
  },
  "checks": { "lint": "check", "test": "check", "build": "check" },
  "mergeAuthorization": {
    "rule": "same-repository-unless-held",
    "holdLabel": "forge:hold"
  }
}
```

| Field | Meaning |
| --- | --- |
| `schemaVersion`, `kind` | Exactly `1` and `forge-gate-policy`. |
| `evidence` | An `EvidencePolicyV2`, the [evaluator's policy](evidence-evaluator.md#policy), passed to the evaluator as it is. This format checks only that it is an object with `schemaVersion: 2`, an `owner/name` `repository`, and a `collector` and a `verification` that are each exactly a nonempty `producer` and a 64-character lowercase hexadecimal `runtimeFingerprint`. The evaluator validates the rest, and it does so only after the pull request is collected. |
| `checks` | For each of `lint`, `test` and `build`, the declared check ID that satisfies it: the [`CheckReceiptExpectation.checks`](verification-evidence.md#expectation-and-result) mapping. Each is nonempty with no space at either end. Several gates may name one ID. |
| `mergeAuthorization` | How a repository adopts the collector's rule for `mergeAuthorized`. `rule` must be exactly `same-repository-unless-held`. `holdLabel` is the label that withholds landing, printable ASCII with no space at either end, and is what the collector is given. |

`mergeAuthorization` is required, and no other rule exists. The collector reports `mergeAuthorized: true` when the head branch is in the base repository and the pull request does not carry the hold label, and [its contract](pull-request-collection.md#evidence) requires that a repository's trusted configuration adopts that rule before anyone collects for it. This field is that adoption. A policy without it, or with another `rule`, is invalid input: naming a hold label somewhere else never adopts the rule by default.

The parser is `parseGatePolicy` in [gate-policy.ts](../src/gate-policy.ts).

### Forge's own policy file

Forge's own production policy is [`forge-gate.json`](../forge-gate.json) at the repository root ([FOR-38](https://linear.app/outfitter/issue/FOR-38)). No lane reads it yet. It takes effect only when a trusted lane passes it as `--policy` from a trusted revision, and that lane, its installed source and its state are still owed by FOR-38. Local qualification policies identify their actual local execution and retain their advisory scope.

The file's `evidence.repository` is `outfitter-dev/forge`. Its `checks` map `lint`, `test` and `build` to `check`, the one check ID [`forge.json`](../forge.json) declares. Its merge authorization is `same-repository-unless-held` with hold label `forge:hold`. Its only eligible reviewer is the hosted `codex-github`, and that reviewer entry's wait and the `codexReview` extension are the [adopted Codex entry](hosted-reviewer-attestations.md#adopted-policy-entry) value for value: reviewer key, bot account, wait, independence basis and finding-history requirement. No local reviewer is adopted for Forge, so `instructions` is empty.

**Identities.** The file names four lane roles. Each `runtimeFingerprint` is the lowercase hexadecimal SHA-256 of the UTF-8 bytes of the role's descriptor, with nothing before or after them.

| Role | `producer` | Descriptor | Used for |
| --- | --- | --- | --- |
| Collector | `forge-lane:collector` | `forge-lane/collector@1` | What the command collects from GitHub. |
| Verification | `forge-lane:verification` | `forge-lane/verification@1` | Every receipt the command is given. |
| Reviewer issuer | `forge-lane:codex-github` | `forge-lane/codex-github@1` | The attempts and native resolutions collected for `codex-github`. |
| Ladder, reserved | `forge-lane:ladder` | `forge-lane/ladder@1` | Nothing. See below. |

A fingerprint here is the lane's declared identity for that role and nothing more. It is not a hash of any code, executable or configuration, and it shows nothing about what ran. It cannot be a hash of the commit that holds the file, because the file is part of that commit, and the file has to be a complete static policy. The evaluator's contract requires a fingerprint's [definition](evidence-evaluator.md#input-and-provenance) to cover the role's machinery and semantic configuration. Here that coverage is a declaration: whoever changes what a role's evidence means bumps the number after `@`, replacing the descriptor in this table and the fingerprint in the file together. A change that arrives without a bump is invisible to the gate. Binding the running source to an approved commit is the job of a trusted-install check that FOR-38 still owes. This file is no part of it, and until that check exists nothing binds the source. The command stamps the collector and verification identities itself, so those two comparisons always agree, as [below](#what-this-does-not-establish).

**The reserved ladder identity.** The evaluator's policy format requires a ladder issuer, so the file declares one. No ladder runner is adopted for Forge and nothing issues under this identity. A `reviewLadder` claim can reach the evaluator only through `--review-evidence`. A claim that matches the identity can only turn an `agent-review` gate that has already failed from `blocked` into `needs_human`: `evaluateAgentReview` in [agent-review-gate.ts](../src/agent-review-gate.ts) returns before reading the claim whenever a review satisfies the gate, and reads it only to choose between those two failed dispositions. It can never make the gate pass. Replace it with the real issuer's identity when a ladder runner is adopted.

**What a bump does.**

| Identity | Stored state that depends on it | Effect of a bump |
| --- | --- | --- |
| Collector | None. The command stamps it on each collection. The stored snapshot, required reviewers and human-review bindings hold no producer or fingerprint. | Nothing stored is invalidated. |
| Verification | None. The command stamps it on every receipt on every run. | Nothing stored is invalidated. |
| Reviewer issuer | The Codex attempt ID hashes the producer and fingerprint. A stored resolution carries them, and the evaluator accepts a resolution only when they equal the policy's. | The attempt for an unchanged head gets a new ID, and stored findings keep the attempt that first reported them. A Codex thread that is still visible and resolved is re-stamped on every collected run, so it stays resolved across a bump. A resolution the collector does not regenerate is stranded: one that arrived on an entry from a supplied ledger stops being accepted, and supplying it again under the new identity sets the stored resolution to `null` instead of replacing it. While `codexReview` is absent nothing is re-stamped, so after a bump a resolved Codex thread blocks too, until a run collects it again. |
| Ladder | None. It is compared only with a supplied claim. | A claim under the old identity no longer matches, and the failure stays `blocked`. |

The hashing is in [codex-review-evidence.ts](../src/codex-review-evidence.ts), the re-stamping in [codex-review-findings.ts](../src/codex-review-findings.ts), the acceptance rule in [review-finding-ledger.ts](../src/review-finding-ledger.ts) and the rule for supplied entries in [gate-finding-history.ts](../src/gate-finding-history.ts).

**Limits of the policy as it stands.**

- With `findingHistory: "supplied-global-ledger"` the gate cannot answer yes unless every run is given, through `--review-evidence`, a current complete finding ledger with `recorded: true`. Without one, `agent-review` fails with `findings-unknown` even beside a clean collected Codex review. Nothing in the lane produces that ledger yet. The same file also carries `agentReviews`, and a supplied attempt under the reviewer issuer's identity can satisfy `agent-review` with no Codex summary on the pull request at all. Whoever produces that file can therefore satisfy `agent-review` on its own, attempts and follow-up resolutions included, whenever no collected or stored entry blocks, and its source needs the same trust as the policy's. It cannot override what the collector records: a collected unresolved Codex thread or adverse summary still blocks beside a supplied clean attempt. Where the finding list comes from is an open decision tracked on FOR-38, and it governs the limits that follow.
- A supplied ledger must omit Codex's own thread entries. The stored native resolution of a resolved thread carries the run ID of the run that last collected it, so a copy supplied on a later run with a different `--run-id` differs from what that run collects. The difference sets the entry's resolution to `null` and leaves a duplicate for the evaluator, and that run fails with `blocking-findings` and `duplicate-evidence`. A later run that omits the entry reads the thread again and restores the resolution.
- An entry stored with `resolution: null` that the collector does not resolve again blocks for as long as that state directory is used, and the command has no input that clears it. Three kinds of entry are in that position: a finding from any reviewer other than `codex-github`, a detail-less Codex `adverse-review` entry, and a Codex thread that is no longer visible. A resolution supplied after such an entry is stored leaves the stored resolution `null` and adds a duplicate. A `native` resolution is never accepted for another reviewer's finding, because that reviewer is not an eligible hosted reviewer.
- A `follow-up-review` resolution that is on an entry when it is first supplied is stored with it and judged again on every run against the attempts collected or supplied. It is accepted while it names a credible attempt on the same head and base under the reviewer issuer's identity, so an entry first supplied with one can pass on a later run once that attempt is present. Nothing produces such a resolution, the [local qualification](codex-command-qualification.md#findings-and-source-coverage) rejected attributing a fix to the generic hosted review, and after a push it is stale and cannot be replaced through this input. That qualification cleared its retained Devin finding through a separate eligible local reviewer and a trusted write to the ledger store, and this policy and this command have neither.

`bun test tests/forge-gate-policy-file.test.ts` keeps the file equal to the values this section states, which are copied into the test. It reads neither this document nor the adopted entry, so either can drift from the file without a failure. It parses the committed file with `parseGatePolicy`, recomputes each fingerprint from its descriptor, compares the Codex values with the test's copy of the adopted entry and the repository and check ID with `forge.json`, evaluates facts issued under the file's identities, and runs the real command with the file as `--policy`, with and without a complete finding ledger. The bump and limit behavior described above was confirmed by running the real command when this section was written, and this test does not pin it.

## Optional Codex collector policy

`GatePolicy.codexReview` is an optional explicit collector-policy extension. Its fields are distinct from the evaluator’s eligible-reviewer list.

| Field | Meaning |
| --- | --- |
| `reviewer` | The exact key of one eligible hosted reviewer in `evidence.agentReview.reviewers`. |
| `botAccountId` | The configured positive numeric account ID of that bot. |
| `independence` | `null`, or exactly `{ id, policyRevision, statement }`. |
| `findingHistory` | Required `"codex-only"` or `"supplied-global-ledger"` source-coverage claim. |

An independence entry’s statement must be exactly `separate-hosted-invocation-without-inherited-author-context`. Its identifier and trusted policy revision are nonempty trimmed strings. Merely listing Codex as an eligible reviewer grants no independence attestation. A null entry collects observations with `context: "unknown"`, which cannot establish an independent completed review.

The policy parser rejects unknown, local or duplicate selected reviewer identities and malformed statements before GitHub or the ledger is read. The collector takes issuer identity, runtime and wait from the matching eligible hosted entry. Its issuer run ID comes from the invocation. The recorded attestation scopes its identifier and policy revision to the wrapper's repository, selected reviewer and bot account ID. The command uses a fixed maximum of 50 comment pages per pass. There are no account or wait defaults.

The invoker guarantees that the entire wrapper policy, including this extension, comes from a trusted revision outside proposed code. The extension records the [approved independence meaning](hosted-reviewer-attestations.md) and the caller’s explicit adoption. It does not authenticate the file’s source or supply credentials. Forge’s own adopting policy is [the root policy file](#forges-own-policy-file). Live adoption qualification remains separate work.

`findingHistory: "codex-only"` explicitly asserts that configured Codex observations plus persisted entries cover all owned reporting history. `"supplied-global-ledger"` requires a current well-formed, unique supplied finding ledger with `recorded: true` before collection can attest global completeness. A previously complete stored ledger cannot substitute for that current file. Eligible reviewers remain choices for independent review and do not define reporting-source coverage or require attempts from every reviewer.

The invoker authenticates review-evidence files from protected trusted sources outside the proposed checkout. Accepted unique supplied findings are ingested before the same snapshot/bindings/findings CAS. New entries retain their typed resolutions. Exact existing entries deduplicate. A changed origin or resolution preserves the stored origin and sets its resolution to `null`, so external conflicts can add or reopen durable blockers but cannot clear an existing blocker or rewrite its origin. Omission on a later run preserves accepted entries. Malformed or duplicate finding histories are not ingested and remain non-passing through evaluator validation. Supplied attempts are appended without deduplication. Explicitly supplied unknown finding history remains blocking, including under `"codex-only"`. Whole native unresolved threads independently block mergeability.

Only a stored accepted collection can reach evaluation. Comment read failures retain the transport code and HTTP status in `not-collected.read`. CAS conflicts return `not-collected` with no evaluation or source record. An evaluated enabled result adds `codexReview: { findingHistory, diagnostics, observations }` beside the evaluator result. That record retains scoped attestation ID/policy revision and normalized source identities, state, flags, timestamps and threads, with comment bodies stripped. The evaluator input still contains only normalized evidence.

## Flow

1. Validate the arguments, the token, the state directory, the policy file, each receipt file and the review-evidence file. The policy must parse, each receipt must be readable JSON, and the review evidence must be a JSON object with exactly its three keys. Any failure is invalid input, and at that point nothing has been requested from GitHub and nothing has been read from or created in the state directory.
2. Read the machine's clock once, as a whole-second UTC time.
3. Read the stored ledger entry for this pull request from `<state>/review-ledger`, giving the store that time. A pull request with no entry has the empty one.
4. Collect the pull request from GitHub, giving the collector the stored entry, the policy’s hold label and collector provenance with the `--run-id`. When `codexReview` is configured, also supply its resolved hosted reviewer configuration and retain the comment-read capability. The [optional collection flow](pull-request-collection.md#optional-codex-collection) establishes complete comments, source stability, the effective snapshot and updated findings.
5. If the collection did not end as `collected`, stop: not collected. Nothing is stored.
6. Ingest accepted trusted supplied findings into the returned ledger under the conflict rules above, then store that entry, in place of the one read in step 3. If another run stored an entry in between (`conflict`), the lock file exists (`ledger-busy`) or the store refuses for any other reason, stop: not collected. Evidence from a collection whose ledger was not stored is never evaluated, because the bindings and snapshot it relies on would be recorded nowhere.
7. Normalize the receipts under the policy's `checks` mapping and `evidence.verification` identity.
8. Assemble version 2 pull request facts from collected evidence, normalized checks, optional collected Codex attempts and supplied review evidence. Preserve duplicate attempts and malformed supplied content for the evaluator. Compose findings from the stored combined ledger and preserve invalid or conflicting supplied evidence under the [finding-history rules](review-ledger-store.md#finding-history-and-compatibility), then evaluate under `policy.evidence`.
9. If the evaluator answers `invalid`, report invalid input with its issues. Otherwise report its result.

Nothing is retried. On `conflict` or `ledger-busy` the invoker runs the command again; see [the lock](review-ledger-store.md#the-lock) for a lock a stopped process left behind.

Step 9 comes after steps 4 and 6. Supplied review-evidence content and evidence-policy fields left to the evaluator may therefore be reported invalid only after GitHub has been read and the collector’s ledger entry stored. When Codex is enabled, its selected eligible reviewer and independence statement are validated before reads. That entry is a true record of the collection and stays.

## Output

Stdout is exactly one JSON document on one line, followed by a newline, in every case. The command writes nothing else to stdout and nothing to stderr. Bun's package runner prints the command it invokes to stderr, so `bun run forge gate ...` shows the arguments there; the direct entry point does not. Every document has `kind: "forge-gate"`, `schemaVersion: 1` and a `status`. The TypeScript contract is [`GateDocument`](../src/gate-document.ts). The examples below are laid out for reading.

### `evaluated`

The pull request was judged. Exit 0 when `eligible` is true and 1 when it is false.

| Field | Meaning |
| --- | --- |
| `eligible` | The answer. It is the evaluator's `eligible`. |
| `subject` | `repository`, `pullRequest`, `headSha` and `baseSha` of the revision judged, from the collected evidence. |
| `runId` | The `--run-id`. |
| `rejectedReceipts` | The normalizer's list of `{ index, code }` for receipts that produced no evidence, with its [rejection codes](verification-evidence.md#rejected-receipts). `index` is the position of the `--receipt` flag, counting from 0. A rejected receipt is not an error: the gates it would have served are left without evidence. |
| `evaluation` | The [evaluator's result](evidence-evaluator.md#decisions), unchanged: the six gate decisions with their reasons, `agentReview`, and `input`, the snapshot of the facts and policy it evaluated. |

A draft pull request with everything else in order:

```json
{
  "kind": "forge-gate",
  "schemaVersion": 1,
  "status": "evaluated",
  "eligible": false,
  "subject": {
    "repository": "example/project",
    "pullRequest": 12,
    "headSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "baseSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  },
  "runId": "build-4521",
  "rejectedReceipts": [],
  "evaluation": {
    "status": "evaluated",
    "schemaVersion": 2,
    "eligible": false,
    "gates": [
      { "name": "lint", "conclusion": "success", "reasons": [] },
      { "name": "test", "conclusion": "success", "reasons": [] },
      { "name": "build", "conclusion": "success", "reasons": [] },
      { "name": "agent-review", "conclusion": "success", "reasons": [] },
      { "name": "human-review", "conclusion": "success", "reasons": [] },
      {
        "name": "mergeability",
        "conclusion": "failure",
        "reasons": [
          {
            "code": "landing-blocked",
            "path": "facts.pullRequest.draft",
            "message": "draft must be false; observed true"
          }
        ]
      }
    ],
    "agentReview": [
      {
        "pullRequest": 12,
        "disposition": "satisfied",
        "satisfiedBy": ["ladder-1/2"]
      }
    ],
    "modelAssessment": { "authority": "advisory", "assessment": null },
    "input": {
      "facts": "the facts evaluated",
      "policy": "the policy's evidence"
    }
  }
}
```

`input` is shortened here. In real output it holds the whole facts and policy, so the document repeats the review evidence, the normalized checks and the policy's `evidence` as they were evaluated. Do not put a secret in any of those files.

### `not-collected`

The pull request was not judged. Exit 3, always: never 0 and never 1. `stage` says where the run stopped, and the other fields are fixed codes. No field holds a message from an underlying error, a response body or a path on disk.

| `stage` | Other fields |
| --- | --- |
| `ledger-read` | `code`: the store's [error code](review-ledger-store.md#errors), such as `entry-invalid` or `entry-ahead-of-clock`. GitHub was not read. |
| `collection` | `collection`: the collector's own `status` and `reason`, and `path` when the reason is about a response field, from [its results](pull-request-collection.md#results). `read`: the `code` and HTTP `status` of the first [read failure](pull-request-collection.md#failures) the transport threw, or `null` when no read threw. |
| `ledger-store` | `code`: `conflict`, or the store's error code, such as `ledger-busy`. GitHub was read and the result was discarded. |
| `internal` | Nothing. An unexpected failure anywhere in the operation ends here, with nothing from the failure in the output. |

```json
{
  "kind": "forge-gate",
  "schemaVersion": 1,
  "status": "not-collected",
  "stage": "collection",
  "collection": { "status": "unavailable", "reason": "read-failed" },
  "read": { "code": "request-failed", "status": 404 }
}
```

```json
{
  "kind": "forge-gate",
  "schemaVersion": 1,
  "status": "not-collected",
  "stage": "ledger-store",
  "code": "conflict"
}
```

GitHub answers 404 both for a pull request that does not exist and for one the token cannot see. The collector reports every thrown read as `unavailable` and `read-failed`; `read` is what tells an outage (`request-failed` with a status), a refused redirect (`request-failed` with no status, or `redirected`), a timeout (`timed-out`) and a list longer than the page bound (`pages-exceeded`) apart.

### `invalid-input`

What the command was given could not be used. Exit 2.

| Field | Meaning |
| --- | --- |
| `issues` | A list of `{ path, message }`. |
| `usage` | The usage line. Present only when the arguments themselves were wrong. |

```json
{
  "kind": "forge-gate",
  "schemaVersion": 1,
  "status": "invalid-input",
  "issues": [{ "path": "--state", "message": "required" }],
  "usage": "Usage: forge gate --repository <owner/name> --pull-request <number> --policy <file> --state <directory> --run-id <id> [--receipt <file>]... [--review-evidence <file>]"
}
```

```json
{
  "kind": "forge-gate",
  "schemaVersion": 1,
  "status": "invalid-input",
  "issues": [
    {
      "path": "gatePolicy.mergeAuthorization",
      "message": "expected a JSON object"
    }
  ]
}
```

An issue's `path` names where the problem is:

| Path | About |
| --- | --- |
| A flag, such as `--state` | That flag: missing, repeated, without a value, or with a value of the wrong form. `--repository` is also the path when the repository differs from the policy's. |
| `arguments[N]` | The argument at position N after `gate`, which is not a known flag. The argument is not repeated: a stray argument can be anything, a credential included. |
| `FORGE_GITHUB_TOKEN` | The token. |
| `BUN_CONFIG_VERBOSE_FETCH` | Verbose fetch logging must be unset to keep the token out of runtime logs. |
| `--policy`, `--receipt[N]`, `--review-evidence` | That file could not be read or is not JSON. N is the position of the `--receipt` flag. |
| `gatePolicy…` | A field of the policy file, as the gate policy format reads it. |
| `reviewEvidence…` | A key of the review-evidence file. |
| `policy…`, `facts…` | The evaluator's own issue, passed through as it is. There `policy` is the gate policy's `evidence`, and `facts.pullRequest` holds the three review-evidence fields beside what was collected. |

Problems with the arguments are listed together, except that an argument that is not a known flag ends the reading. After the arguments, the first problem found is the only one reported. A `path` can hold a field name from a file, including the name of a field the format does not know. No issue holds a field's value, a file's content, a file's path on disk, or the text of a parser's or the system's error.

### Exit codes

| Exit | Status | Meaning |
| --- | --- | --- |
| 0 | `evaluated` | The pull request passes all six gates. |
| 1 | `evaluated` | It was judged and at least one gate fails. The reasons are in `evaluation.gates`. |
| 2 | `invalid-input` | The arguments, the token, a file, the policy or the review evidence could not be used. |
| 3 | `not-collected` | The pull request could not be collected, the ledger could not be read or stored, or the command failed unexpectedly. |

Only exit 0 is a pass. A consumer reads the exit code together with the document: an exit code that arrives without a `forge-gate` document on stdout is not a result. Bun itself exits 1 with a stack trace if the command cannot even be loaded, and a killed process has a signal's exit code. Neither is a judgment of the pull request.

## Fixed limits

| Limit | Value |
| --- | --- |
| One request to GitHub | 15 seconds |
| Pages of one REST list (reviews, timeline), 100 items each | 50 |
| Review-thread pages in one pass, 100 threads each | 50 |
| Issue-comment pages in one enabled pass, 100 comments each | 50 |
| Requests to GitHub for a pull request whose lists each fit one page | 8 with Codex disabled, 10 with Codex enabled |
| Retries | None |

They are constants in [run-gate.ts](../src/run-gate.ts), not flags. A list that outruns its bound stops the run as not collected; it is never cut short. There is no deadline for the run as a whole, so the invoker bounds it with its own job timeout.

## What this does not establish

- **Where the policy came from.** The command reads the file it is pointed at. It cannot verify that the policy came from a trusted revision and not from the pull request under evaluation. A pull request that could supply its own policy could name its own reviewers and its own hold label.
- **Who produced the receipts and the review evidence.** The command cannot verify that those files came from the producers the policy names. It stamps the policy's verification identity on every receipt it is given, and the policy's collector identity on what it collects itself, so those two comparisons in the evaluator always agree. The review evidence carries its own producer claims, which the evaluator compares with the policy; that shows the invoker supplied files consistent with the policy, and nothing more. In this path the evaluator's producer and runtime comparisons do not authenticate anyone. The trust is in who runs the command and where its inputs came from.
- **Authorization to land.** `mergeAuthorized` is the [GitHub-readable part](pull-request-collection.md#evidence) of an authorization rule: the head branch is in the base repository and the pull request is not held. Whether the work is inside the agreed task scope, whether its task is parked, and whether an ask-first exception applies are not read by anything here. They stay with whoever lands the change, under the [standing delivery authority](../AGENTS.md#standing-delivery-authority). `eligible: true` is an input to a separately authorized landing, never permission to merge.
- **That a local run agrees with the lane.** A local run is advisory. It keeps its own ledger history in its own state directory, and an approval counts only against a snapshot an earlier run recorded there. Two runs give the same answer only for the same facts, the ledger included: a first local run of a pull request the lane has been collecting for days can fail `human-review` where the lane passes it.
- **That the working directory is the checkout.** The state directory is checked against the working directory only. A state directory inside some other checkout or job workspace is not caught.
- **That the facts still hold.** The answer describes the pull request when it was read. A push, a label or a review after that is not seen. The [automation contract](automation-contract.md#decisions-leave-usable-evidence) requires a fresh evaluation before a consequential action.
- **That the clock is right.** The time given to the ledger store is the machine's. A clock behind GitHub's stops the run with `entry-ahead-of-clock`; a clock far ahead lets a future-dated ledger entry through. See [`now` and `entry-ahead-of-clock`](review-ledger-store.md#now-and-entry-ahead-of-clock).
- **That the runtime's environment is clean.** The requests are made by Bun's own `fetch`, which the invoker's environment configures. A proxy, or a setting that turns off certificate verification, removes the assurance that a response is GitHub's, as the [transport's limits](pull-request-collection.md#what-the-transport-does-not-establish) say. The command refuses `BUN_CONFIG_VERBOSE_FETCH` as described under [the token](#the-token).
- **Production adoption.** [FOR-37](https://linear.app/outfitter/issue/FOR-37) records two complete live source reads and local ledger CAS of Forge PR 26 at trusted source `452529cf45b5348b5f931cb0302cb243f224de69`. The historical summary correctly remained unavailable because its update predates the new snapshot and independence was unknown. Matt subsequently accepted the [observed guidance influence and source-path uncertainty](codex-guidance-qualification.md#adoption-decision-and-remaining-qualification). That owner-decision prerequisite is satisfied. The [bounded local normal-command qualification](codex-command-qualification.md) records accepted hosted Codex evidence and retained findings. The [root policy file](#forges-own-policy-file) and its declared lane identities exist, and no lane reads the file. The production lane, its trusted installed source and state, the source of the finding ledger and live lane qualification remain pending in FOR-38.
- **Any enforcement.** Nothing here posts a status, and no repository rule requires one. Until a lane reports the exit code as a required status, a pull request this command calls not eligible can still be merged.

The limits of the composed operations carry over unchanged: [collection](pull-request-collection.md#what-this-does-not-establish), the [ledger store](review-ledger-store.md#what-it-does-not-establish), [verification evidence](verification-evidence.md#what-this-does-not-establish) and the [evaluator](evidence-evaluator.md#trusted-collector-responsibilities).

## Verification scope

`bun test tests/gate-policy.test.ts tests/gate-codex-policy.test.ts tests/forge-gate.test.ts tests/forge-gate-codex.test.ts` exercises the policy parser and the command offline. The command tests run `src/forge-cli.ts gate` as a real subprocess with a test file preloaded that replaces the global `fetch`: it answers requests to `https://api.github.com` from a script, records every request, and fails a request to any other origin. No production code has a test hook. State, policy, receipts and review evidence live in temporary directories outside the repository, which the tests remove.

They cover an eligible pull request; each gate failing alone where the evaluator allows it; an approval that binds on a second run because the first recorded its snapshot; rejected receipts; every not-collected stage, with the ledger file compared byte for byte; every kind of invalid input, with no request made and nothing created in the state directory; and, on every run, that the token appears only in the `Authorization` header of requests to GitHub. They prove deterministic behavior only.
