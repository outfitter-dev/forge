# Pull request collection

`collectPullRequest(request, reads)` reads one pull request's live state and returns the pull-request part of the [evidence evaluator](evidence-evaluator.md)'s input (FOR-34). It is exported from `src/index.ts` with its types. Everything it learns comes through the four injected reads: it performs no network, filesystem, clock or environment access, and it never writes to GitHub.

It supplies `subject`, `provenance`, `assignments`, `humanReviews`, `open`, `draft`, `mergeable`, `mergeAuthorized` and `unresolvedThreads`, typed from `PullRequestEvidenceOf` in [evidence-types.ts](../src/evidence-types.ts). It does not supply `checks`, `agentReviews`, `reviewFindings` or `reviewLadder`; [verification evidence](verification-evidence.md) and other operations do. It contains no GitHub client, pagination, token handling, ledger store or command, and it collects no merge group.

```ts
import { collectPullRequest } from "./src/index.ts";

const result = await collectPullRequest(
  {
    holdLabel: "forge:hold",
    ledger: storedEntry,
    maxThreadPages: 20,
    provenance: collector,
    pullRequest: 34,
    repository: "example/project",
  },
  reads
);
if (result.status === "collected") {
  await persist(result.ledger);
}
```

## Request and reads

| Field | Meaning |
| --- | --- |
| `repository` | `owner/name`, as evaluator policy names it. The evidence subject carries it exactly as given. |
| `pullRequest` | The pull request number, a positive integer. |
| `holdLabel` | The label that withholds landing. For Forge it is `forge:hold`. |
| `provenance` | The collector's producer ID, runtime fingerprint and run ID, copied onto the evidence. Evaluator policy compares it with `policy.collector`. |
| `ledger` | The `ReviewLedgerEntry` the last accepted collection of this pull request returned, or an empty entry for a pull request never collected. |
| `maxThreadPages` | The most review-thread pages one pass may read, a positive integer. |

The request is copied before the first read, so changing it or its ledger while the collection runs changes nothing. The request's ledger is never modified.

| Read | Returns |
| --- | --- |
| `pullRequest()` | The REST pull request as `body`, and `servedAt`: GitHub's `Date` header for that response as a whole-second UTC time. |
| `timeline()` | The whole REST timeline: every page, in order, as one array. |
| `reviews()` | Every REST review: every page, in order, as one array. |
| `reviewThreads(cursor)` | One page of the GraphQL `reviewThreads` connection starting after `cursor`, which is `null` for the first page. |

Responses are parsed by the functions in [parse-github-pull-request.ts](../src/parse-github-pull-request.ts), which read only the fields Forge uses.

## Read order

Each collection makes two passes, and no two reads run at once.

1. First pass: reviews, then the pull request, then the timeline, then review threads page by page.
2. Second pass: the pull request, then reviews, then the timeline, then review threads page by page.

The order of the first pass is fixed by the binding rule in [review-ledger.ts](../src/review-ledger.ts). GitHub records no base for an approval, so an approval is bound to the base the pull request had when it was read, and only if an earlier collection saw this same head and base before the approval and no base change is recorded since. That is sound only if the reviews are read no later than the pull request and the timeline no earlier. Read in that order, every approval the collection holds was submitted before the pull request was served, and every base change recorded up to that moment is in the timeline. Read in another order, an approval could be bound across a base change the collection never saw.

For the same reason the time given to the binding rule as `pullRequestReadAt` is the `servedAt` of the first pull request read. The second read's `servedAt` is checked for its form and against the first, and not otherwise used: the first read is the one the reviews and the timeline were ordered around, and a later cut-off would admit an approval submitted after it. GitHub's clock does not run backwards between two reads, so a second read served earlier than the first is a stale or cached response and stops the collection as `served-at-regressed`. Two reads served in the same second are accepted.

The second pass starts with the pull request so that the two reads of the reviews lie either side of both pull request reads.

## Stability

A collection is accepted only if the second pass parses to the same values as the first for everything a decision reads:

- the pull request: number, open or closed state, draft, merged, mergeable, author, head and base commit, ref and repository, labels, requested reviewers and requested teams
- the parsed reviews
- the review requests and the base changes parsed from the timeline
- the count of unresolved review threads

Parsed values are compared, not response text. A field Forge does not read, such as the title, and a timeline event that is neither a review request nor a possible base change, do not count. The order of labels, reviewers, reviews and events does count. `servedAt` may differ between the passes and is not part of this comparison.

The comparison follows the second pass and stops at the first difference, so a collection reported as changed made no further reads. GitHub computes `mergeable` after it is first asked: a collection that sees `null` and then a value is `changed`, and the caller collects again. A `mergeable` that is `null` in both passes is collected as `null`, which the evaluator blocks.

Two agreeing passes show that state at two moments. They do not show that nothing changed and changed back in between, and they say nothing about what happens after the second pass. The [automation contract](automation-contract.md#decisions-leave-usable-evidence) requires a fresh collection before a consequential action.

## Evidence

| Field | Value |
| --- | --- |
| `subject` | `{ kind: "pull_request", id, repository, headSha, baseSha }`. `repository` is the requested one; the rest is from the parsed pull request. |
| `provenance` | The request's `provenance`. |
| `assignments`, `humanReviews` | From `humanReviewEvidence`, given the first pass, the first read's `servedAt` and the request's ledger. |
| `open` | `true` when the state is `open`. |
| `draft`, `mergeable` | As parsed. `mergeable: null` stays `null`. |
| `mergeAuthorized` | `true` only when the head branch is in the base repository and the pull request does not carry `holdLabel`; otherwise `false`. |
| `unresolvedThreads` | The sum of unresolved threads over every page. |

`mergeAuthorized` applies one rule: a pull request from the trusted setup may land unless it is held. That rule is Forge's [standing delivery authority](../AGENTS.md#standing-delivery-authority), which names `forge:hold` as a landing hold. The collector applies it as two conditions, and both must hold:

- The head branch is in the base repository: the head's repository ID is present and equals the base's. A branch there is what shows push access to that repository. A head in a fork, and a head whose fork was deleted, is never authorized, held or not.
- The pull request does not carry `holdLabel`. GitHub does not let two labels differ only in case, so the hold label in any case holds.

A label never grants authorization; the hold label only withholds it. The caller applies the standing rule to a repository by collecting with a `holdLabel`, and a repository that needs a narrower authorization rule must not take this field as that rule.

The result's `ledger` is the entry to persist. It carries every reviewer ever requested, the snapshot of the head and base, and the base each bound approval was bound to.

## Results

Success is `{ status: "collected", evidence, ledger }`. Every other result has a fixed `status` and `reason` and no ledger, so the persisted entry stays as it was. No result carries a response body, a token or anything a read threw. `path` appears only on `unreadable`; it names a field, such as `reviews[0].state`, and never holds that field's value.

| Status | Reason | Meaning |
| --- | --- | --- |
| `changed` | `pull-request-changed` | The second read of the pull request parsed differently from the first. |
| `changed` | `reviews-changed` | The reviews differed between the passes. |
| `changed` | `timeline-changed` | The review requests or base changes in the timeline differed between the passes. |
| `changed` | `threads-changed` | The count of unresolved threads differed between the passes. |
| `unreadable` | `response-unreadable` | A response did not parse. `path` is the parser's path to the field. |
| `unreadable` | `served-at-unreadable` | A `servedAt` was not a whole-second UTC time. `path` is `servedAt`. |
| `unreadable` | `served-at-regressed` | The second pull request read was served earlier than the first, so it is a stale or cached response. `path` is `servedAt`. |
| `ambiguous` | `review-history-ambiguous` | `humanReviewEvidence` could not decide the review history, for example two approvals of different commits submitted in the same second. |
| `unavailable` | `read-failed` | A read rejected or threw. |
| `unavailable` | `thread-pages-exceeded` | The review-thread list did not end within `maxThreadPages`. |
| `mismatch` | `repository-mismatch` | The pull request's base repository is not the requested one. Names are compared without case. |
| `mismatch` | `pull-request-mismatch` | The pull request's number is not the requested one. |
| `invalid-request` | `request-malformed` | The repository is not `owner/name`, the number or page bound is not a positive integer, the hold label is empty or has surrounding whitespace, or the provenance is not a producer, a 64-character fingerprint and a run ID. Nothing was read. |

A stopped collection is not evidence. The caller collects again or reports the stop; it does not fill in the missing facts.

## What the caller must supply and guarantee

- Reads bound to the requested repository and pull request. Only the pull request response is checked for identity, by its number and base repository. Nothing read from the reviews, timeline or thread responses identifies their pull request, so the transport must bind those three reads to the same pull request. Reviews, a timeline or threads from another pull request would be collected as this one's.
- The whole timeline and every page of reviews. One page is not the list, and nothing here can tell. A missing page can hide a review request, a base change or a change request.
- A fresh read on every call. A response replayed from a cache makes the second pass agree with the first without showing anything. The only replay caught here is a second pull request read whose `servedAt` is earlier than the first's. A replay carrying the same time, and a replayed reviews, timeline or thread response, are not caught.
- The repository's hold label, spelled as it is there apart from case. A mistyped hold label holds nothing: the operation cannot tell whether a label of that name exists, and every unheld-looking pull request from the base repository is then authorized.
- `servedAt` from the `Date` header of the pull request response itself, converted to a whole-second UTC time such as `2026-01-01T01:00:00Z`. It must not be a local clock or a time taken before the request. `HumanReviewInput.pullRequestReadAt` in [human-review-evidence.ts](../src/human-review-evidence.ts) says what a wrong time can do.
- The stored ledger entry for this pull request, and persistence of the returned entry only when the status is `collected`. The entry's shape is not checked here: rejecting a corrupted entry is for its store.
- A `maxThreadPages` large enough for the pull request. Too small a bound gives `unavailable`, never a short count.
- A collector identity in `provenance` that it can vouch for.

## What this does not establish

- It does not authenticate GitHub's responses beyond their shape. A well-formed response from anything else parses the same.
- It reads no agent reviews, checks, review findings or ladder claim. Evidence from this operation alone cannot be evaluated.
- The base commit is the one GitHub last recorded for the pull request. It can lag the tip of the base branch: an ordinary push to that branch changes neither the value nor the timeline.
- A base change GitHub records with no timeline event cannot be seen. The binding rule relies on those events to notice a base that left and came back.
- It does not establish who may lift a hold. Anyone who can remove the label on GitHub lifts the hold.
- A head branch in the base repository shows that someone with push access to it put the branch there. It does not show who, and the pull request's author is not checked.
- The evidence carries the `mergeAuthorized` decision, not the labels and repository IDs it was made from. A caller that must retain those keeps the responses itself.
- A team review request stays a requirement no individual review meets, as `humanReviewEvidence` leaves it, so such a pull request fails the `human-review` gate.

Offline tests in `tests/collect-pull-request.test.ts` use scripted reads built from raw response fixtures. They assert the order of reads, each stop, the stability rule and the ledger across two collections, and give collected evidence to the real evaluator beside the version 2 fixtures. They prove deterministic behavior only: no GitHub client exists and no live consumer is qualified.
