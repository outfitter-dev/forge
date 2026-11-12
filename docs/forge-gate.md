# Forge gate: one answer for one pull request

`forge gate` answers, for one pull request, whether it passes Forge's six gates (FOR-36). A trusted CI lane and a person at a terminal run it the same way. The name says what it evaluates, not what it does to a pull request: `forge gate` reports the gates' answer and does not itself block anything. Whatever blocks a merge is the repository rule that requires a status, and the lane that reports this command's exit code as that status. Neither exists yet.

## What it does and does not do

It composes operations that already exist, in one fixed order:

- reads the pull request's [review ledger entry](review-ledger-store.md) from the state directory
- [collects the pull request](pull-request-collection.md) from GitHub's API, read-only
- stores the ledger entry the collection returned
- turns the `forge check` receipts it was given into [verification evidence](verification-evidence.md)
- joins the agent-review evidence it was given with accepted persisted findings
- calls the [evidence evaluator](evidence-evaluator.md) and prints its result

It reports. It does not post a status, a comment or a label, it does not merge, and it does not enforce anything. It makes no request that writes to GitHub. It runs no check and no review: receipts come from `forge check` runs and review evidence comes from Ranger, and both reach this command as files. It writes one thing, the ledger entry in the state directory. It has no retry, cache, daemon or scheduler.

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

Without `--review-evidence` the command supplies no agent attempts or ladder, starts from unknown finding evidence and includes accepted persisted findings, so the `agent-review` gate fails. Without any `--receipt` the three verification gates fail the same way.

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

Forge's own policy will be `forge-gate.json` at the root of the trusted revision the lane runs. It is not in the repository yet, and this change does not add it. A policy names a collector, a verification producer and the eligible reviewers, each with a runtime fingerprint, and Forge has none of those identities until a lane exists to hold them. The file arrives with the lane. Until then the only policies are the fictitious ones the tests build.

## Flow

1. Validate the arguments, the token, the state directory, the policy file, each receipt file and the review-evidence file. The policy must parse, each receipt must be readable JSON, and the review evidence must be a JSON object with exactly its three keys. Any failure is invalid input, and at that point nothing has been requested from GitHub and nothing has been read from or created in the state directory.
2. Read the machine's clock once, as a whole-second UTC time.
3. Read the stored ledger entry for this pull request from `<state>/review-ledger`, giving the store that time. A pull request with no entry has the empty one.
4. Collect the pull request from GitHub, giving the collector the stored entry, the policy's hold label, and a provenance made of the policy's collector `producer` and `runtimeFingerprint` and the `--run-id`.
5. If the collection did not end as `collected`, stop: not collected. Nothing is stored.
6. Store the entry the collection returned, in place of the one read in step 3. If another run stored an entry in between (`conflict`), the lock file exists (`ledger-busy`) or the store refuses for any other reason, stop: not collected. Evidence from a collection whose ledger was not stored is never evaluated, because the bindings and snapshot it relies on would be recorded nowhere.
7. Normalize the receipts under the policy's `checks` mapping and `evidence.verification` identity.
8. Assemble version 2 pull request facts from the collected evidence, the normalized checks and the review evidence. Combine supplied finding entries with accepted persisted entries under the [finding-history rules](review-ledger-store.md#finding-history-and-compatibility), then evaluate under `policy.evidence`.
9. If the evaluator answers `invalid`, report invalid input with its issues. Otherwise report its result.

Nothing is retried. On `conflict` or `ledger-busy` the invoker runs the command again; see [the lock](review-ledger-store.md#the-lock) for a lock a stopped process left behind.

Step 9 comes after steps 4 and 6. A policy whose `evidence.agentReview` the evaluator refuses, or review evidence whose content it refuses, is therefore reported only after GitHub has been read and the ledger entry stored. That entry is a true record of the collection and stays.

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
| Requests to GitHub for a pull request whose lists each fit one page | 8: four reads in each of two passes |
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
- **Anything about a live GitHub.** No live run against GitHub is qualified. The API version, the GraphQL query, the token's access and GitHub's actual responses are untested outside fixtures, as the [transport's own limits](pull-request-collection.md#what-the-transport-does-not-establish) say.
- **Any enforcement.** Nothing here posts a status, and no repository rule requires one. Until a lane reports the exit code as a required status, a pull request this command calls not eligible can still be merged.

The limits of the composed operations carry over unchanged: [collection](pull-request-collection.md#what-this-does-not-establish), the [ledger store](review-ledger-store.md#what-it-does-not-establish), [verification evidence](verification-evidence.md#what-this-does-not-establish) and the [evaluator](evidence-evaluator.md#trusted-collector-responsibilities).

## Verification scope

`bun test tests/gate-policy.test.ts tests/forge-gate.test.ts` exercises the policy parser and the command offline. The command tests run `src/forge-cli.ts gate` as a real subprocess with a test file preloaded that replaces the global `fetch`: it answers requests to `https://api.github.com` from a script, records every request, and fails a request to any other origin. No production code has a test hook. State, policy, receipts and review evidence live in temporary directories outside the repository, which the tests remove.

They cover an eligible pull request; each gate failing alone where the evaluator allows it; an approval that binds on a second run because the first recorded its snapshot; rejected receipts; every not-collected stage, with the ledger file compared byte for byte; every kind of invalid input, with no request made and nothing created in the state directory; and, on every run, that the token appears only in the `Authorization` header of requests to GitHub. They prove deterministic behavior only.
