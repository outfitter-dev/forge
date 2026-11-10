# Local JSON evaluator CLI

Run the local Bun adapter from a checkout with the pinned Bun version and frozen dependencies installed. It reads normalized facts and explicit policy from two JSON files and calls the same `evaluateEvidence` operation exported by `src/index.ts`. It does not collect evidence, invoke providers, publish statuses, or merge anything. No global command installation or credentials are required.

```sh
bun run evaluate <facts.json> --policy <policy.json>
```

The equivalent direct entry point is `bun src/cli.ts <facts.json> --policy <policy.json>`. Both paths are explicit; relative paths resolve against the caller's working directory. Quote paths containing spaces. There is no automatic policy lookup, environment-based authority, or stdin mode. Wrong/missing arguments and extra options are errors.

| Exit | Meaning | Output |
| --- | --- | --- |
| `0` | Valid evidence is eligible under policy. | Structured evaluated result on stdout. |
| `1` | Evaluation completed, but one or more gates block eligibility. | Structured evaluated result with reasons on stdout. |
| `2` | Input or invocation is invalid, a file cannot be read/parsed, or evaluation failed. | Structured invalid result on stdout and a concise diagnostic on stderr. |

The CLI reserves stdout for one JSON result, including the evaluated evidence/policy snapshot when evaluation completes. A blocked gate is an expected result, not an execution error. On an invalid result, `eligible` is always false and `issues` identifies the boundary that failed. File/parse failures identify `facts` or `policy`; unexpected evaluator failures identify `evaluation`. Diagnostics do not quote malformed JSON contents or unexpected exception text. Bun's package runner may print the invoked command to stderr; direct invocation avoids that runner message.

## Passing example

The committed examples contain fictitious repository, producer, and run identities. They are offline fixtures, not authenticated receipts.

```sh
bun run evaluate examples/evidence/passing-pr.json --policy examples/evidence/policy.json
```

This exits `0`, with `status: "evaluated"`, `eligible: true`, and all six gates successful. The example has complete lint/test/build and agent-review receipts, collected empty human assignment history, and explicit landing facts.

## Blocked and invalid examples

```sh
bun run evaluate examples/evidence/blocked-pr.json --policy examples/evidence/policy.json
```

This intentionally exits `1`. Verification and reviews pass, but `mergeAuthorized` is false. The mergeability decision contains a `landing-blocked` reason at `facts.pullRequest.mergeAuthorized`, and `eligible` is false. A consuming shell or CI step must explicitly check an expected nonzero result instead of treating it as an unexpected job failure.

```sh
bun run evaluate examples/evidence/invalid-facts.json --policy examples/evidence/policy.json
```

This intentionally exits `2`: the valid JSON object declares an unsupported event, so it cannot be evaluated. Syntactically malformed JSON, missing files, invalid policy, and incomplete input also exit `2`; they cannot look successful.

## Trust and qualification

The CLI validates shape and compares declared identities and fingerprints; **it does not authenticate the producer, source revision, runtime, policy, or authority**. Supply evidence from a trusted collector and run trusted evaluator/policy revisions outside proposed code. Do not put credentials, transcripts, or private runtime state in these files. An eligible result grants no merge permission and proves no live landing. See [the evaluator contract](evidence-evaluator.md) for collector responsibilities, exact-source semantics, and limitations.

Offline subprocess tests run the actual entry point with an empty environment and cover passing/blocked/invalid results, parity with the library, argument errors, caller-relative paths with spaces, missing/unreadable files, malformed JSON, invalid policy, and unexpected evaluator failure. They prove the local adapter; they do not qualify production collection, cross-owner distribution, or trust isolation. FOR-4 separately qualifies invocation through a thin CI step.
