# Pull request collection

`collectPullRequest(request, reads)` reads one pull request's live state and returns the pull-request part of the [evidence evaluator](evidence-evaluator.md)'s input (FOR-34). It is exported from `src/index.ts` with its types. Everything it learns comes through the four injected reads: it performs no network, filesystem, clock or environment access, and it never writes to GitHub.

It supplies `subject`, `provenance`, `assignments`, `humanReviews`, `open`, `draft`, `mergeable`, `mergeAuthorized` and `unresolvedThreads`, typed from `PullRequestEvidenceOf` in [evidence-types.ts](../src/evidence-types.ts). It does not supply `checks`, `agentReviews`, `reviewFindings` or `reviewLadder`; [verification evidence](verification-evidence.md) and other operations do. It contains no GitHub client, pagination, token handling, ledger store or command, and it collects no merge group. The [GitHub read transport](#github-read-transport) is a separate operation that supplies the four reads, and the [review ledger store](review-ledger-store.md) is a separate operation that supplies the ledger entry and persists the one returned.

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

`storedEntry` and `persist` stand for the review ledger store's `readReviewLedger` and `replaceReviewLedger`. [Its page](review-ledger-store.md#the-callers-flow) shows the whole flow, including what to do when another collection stored an entry in between.

## Request and reads

| Field | Meaning |
| --- | --- |
| `repository` | `owner/name`, as evaluator policy names it. The evidence subject carries it exactly as given. |
| `pullRequest` | The pull request number, a positive integer. |
| `holdLabel` | The label that withholds landing. For Forge it is `forge:hold`. It must be printable ASCII (U+0020 to U+007E) with no space at either end. |
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

Each read is its own moment. Two agreeing passes show the pull request, the reviews, the timeline and the threads each agreeing at two moments; they do not show that nothing changed and changed back between those two. The pull request is last observed at the start of the second pass. A label, push or close after that read is not seen, including one made while the second pass is still reading the reviews, timeline and threads. The [automation contract](automation-contract.md#decisions-leave-usable-evidence) requires a fresh collection before a consequential action.

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

`mergeAuthorized` reports two conditions that can be read from GitHub, and both must hold:

- The head branch is in the base repository: the head's repository ID is present and equals the base's. A branch there is what shows push access to that repository. A head in a fork, and a head whose fork was deleted, is never authorized, held or not.
- The pull request does not carry `holdLabel`. The hold label is printable ASCII, and a label is the hold label when the two are equal after lower-casing the ASCII letters `A` to `Z` and nothing else. GitHub does not let two labels differ only in case, so `Forge:Hold` holds under `forge:hold`. A label that only looks like the hold label, or only contains it, does not hold.

`true` means only that neither condition withholds authorization. It is not the whole of an authorization rule. Forge's [standing delivery authority](../AGENTS.md#standing-delivery-authority) also depends on facts this operation cannot read: whether the work is inside the agreed task scope, whether its task is parked, whether an ask-first exception applies, and who opened the pull request. Those stay with the operation that lands the change. The standing delivery authority names `forge:hold` as a landing hold; it does not establish that the label exists in a repository.

A label never grants authorization; the hold label only withholds it. The caller must collect only for a repository whose trusted configuration adopts "head branch in the base repository and not held" as the GitHub-readable part of its rule. Supplying a `holdLabel` does not make that choice. A repository that needs a narrower rule must not take this field as that rule.

The result's `ledger` is the entry to persist. It carries every reviewer ever requested, the snapshot of the head and base, and the base each bound approval was bound to.

## Results

Success is `{ status: "collected", evidence, ledger }`. For a request that keeps to its types, every other result has a fixed `status` and `reason` and no ledger, so the persisted entry stays as it was. No result carries a response body, a token or anything a read threw. `path` appears only on `unreadable`; it names a field, such as `reviews[0].state`, and never holds that field's value.

The call can reject instead of returning a result when the caller breaks the request's types, for example with a ledger that is `null`, lacks its fields or holds a value that cannot be cloned. The ledger's shape is not checked here.

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
| `unavailable` | `read-failed` | A read rejected or threw, or the pull request read resolved to `null` or `undefined` in place of its object. |
| `unavailable` | `thread-pages-exceeded` | The review-thread list did not end within `maxThreadPages`. |
| `mismatch` | `repository-mismatch` | The pull request's base repository is not the requested one. The whole `owner/name` is compared, and case is ignored for the ASCII letters `A` to `Z` only. |
| `mismatch` | `pull-request-mismatch` | The pull request's number is not the requested one. |
| `invalid-request` | `request-malformed` | The repository is not `owner/name`, the number or page bound is not a positive integer, the hold label is empty, starts or ends with a space or holds a character outside printable ASCII (U+0020 to U+007E), or the provenance is not a producer, a 64-character fingerprint and a run ID. Nothing was read. |

A stopped collection is not evidence. The caller collects again or reports the stop; it does not fill in the missing facts.

## What the caller must supply and guarantee

- Reads bound to the requested repository and pull request. Only the pull request response is checked for identity, by its number and base repository. Nothing read from the reviews, timeline or thread responses identifies their pull request, so the transport must bind those three reads to the same pull request. Reviews, a timeline or threads from another pull request would be collected as this one's.
- The whole timeline and every page of reviews. One page is not the list, and nothing here can tell. A missing page can hide a review request, a base change or a change request.
- A fresh read on every call. A response replayed from a cache makes the second pass agree with the first without showing anything. The only replay caught here is a second pull request read whose `servedAt` is earlier than the first's. A replay carrying the same time, and a replayed reviews, timeline or thread response, are not caught.
- The repository's hold label, spelled as it is there apart from the case of ASCII letters. It must be printable ASCII, so a repository whose hold label holds any other character cannot be collected with it. A mistyped hold label holds nothing: the operation cannot tell whether a label of that name exists, and every unheld-looking pull request from the base repository is then authorized.
- `servedAt` from the `Date` header of the pull request response itself, converted to a whole-second UTC time such as `2026-01-01T01:00:00Z`. It must not be a local clock or a time taken before the request. `HumanReviewInput.pullRequestReadAt` in [human-review-evidence.ts](../src/human-review-evidence.ts) says what a wrong time can do.
- The stored ledger entry for this pull request, and persistence of the returned entry only when the status is `collected`. The ledger must be an entry validated by its store, the [review ledger store](review-ledger-store.md): its shape is not checked here, and a malformed one can make the call reject or bind an approval it should not. The collection's evidence must not be used as if its bindings were recorded until that store has stored the returned entry.
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

Offline tests in `tests/collect-pull-request.test.ts` use scripted reads built from raw response fixtures. They assert the order of reads, each stop, the stability rule and the ledger across two collections, and give collected evidence to the real evaluator beside the version 2 fixtures. They prove deterministic behavior only: no live consumer is qualified.

## GitHub read transport

`githubPullRequestReads(options)` returns the four reads for one pull request of one repository, read from GitHub's API. It is exported from `src/index.ts` with `GitHubPullRequestReadsOptions`. It only reads. All its I/O goes through the `fetch` it is given: it reads no clock, file or environment variable, and it adds no dependency.

```ts
import { collectPullRequest, githubPullRequestReads } from "./src/index.ts";

const reads = githubPullRequestReads({
  fetch,
  maxPages: 20,
  pullRequest: 34,
  repository: "example/project",
  timeoutMs: 10_000,
  token,
});
const result = await collectPullRequest(request, reads);
```

| Option | Meaning |
| --- | --- |
| `repository` | `owner/name`. Each part is letters, digits, `_`, `.` or `-`, and is neither `.` nor `..`, so a URL parser leaves the path as written. |
| `pullRequest` | The pull request number, a positive integer. |
| `token` | The credential, visible ASCII with no spaces. The caller obtains it; nothing here reads the environment. |
| `fetch` | The global `fetch`, or a stand-in with its shape. |
| `timeoutMs` | The longest one request may take, a positive integer. |
| `maxPages` | The most pages one REST list may span, a positive integer. |

The options are checked and copied when the reads are constructed. An option that is not as described throws `options-invalid` there, before any request, and the message names no option and holds no value. Changing the options object afterwards changes no request. `repository` and `pullRequest` should be the ones given to `collectPullRequest`: the collector checks the pull request response against its own request, and nothing checks the other three reads.

### Requests

| Read | Request |
| --- | --- |
| `pullRequest()` | `GET /repos/{owner}/{name}/pulls/{number}` |
| `timeline()` | `GET /repos/{owner}/{name}/issues/{number}/timeline?per_page=100&page=N`, for each page |
| `reviews()` | `GET /repos/{owner}/{name}/pulls/{number}/reviews?per_page=100&page=N`, for each page |
| `reviewThreads(cursor)` | `POST /graphql`, asking for `reviewThreads(first: 100, after: $cursor)` with `isResolved` for each thread and the page's `hasNextPage` and `endCursor` |

Every request goes to `https://api.github.com` and to nowhere else. Each address is that origin followed by a path built from the checked repository and number. Nothing from a response is ever used as an address: not a `Link` header, not a `Location` header, not a URL in a body. The GraphQL query is one fixed text; the owner, name, number and cursor travel as variables and are never written into it. The query asks GitHub not to follow a repository rename: it passes `followRenames: false` on `repository`, as a literal in that text. `reviewThreads` returns the response body as it is, so a GraphQL `errors` member reaches `parseReviewThreadPage`, which rejects it.

Each read step is one request. There is no retry, backoff, conditional request or cache, and no request writes anything.

The transport sets these headers on every request and no others, except that it also sets `Content-Type: application/json` on the GraphQL request. The `fetch` may add its own, such as `Host` and `Accept-Encoding`:

| Header | Value |
| --- | --- |
| `Authorization` | `Bearer` and the token. The token appears nowhere else: not in an address, a request body, an error or a returned value. |
| `Accept` | `application/vnd.github+json` |
| `X-GitHub-Api-Version` | `2026-03-10`, the version the earlier pilot qualified live. |
| `Cache-Control` | `no-cache` |
| `User-Agent` | `forge` |

Every request is made with `redirect: "error"`, `cache: "no-store"` and an abort signal that fires after `timeoutMs`. A redirect is a failure and is never followed: GitHub answers a renamed or moved repository with a redirect, and following it would read a repository under a name the evidence does not carry. A response that reports it followed a redirect anyway is also a failure. Only status 200 is a success, which is what GitHub answers each of these reads with; another 2xx status fails like any other. The timeout covers the response body as well as its headers.

### Served time

`servedAt` is the `Date` header of the pull request response itself, converted to a whole-second UTC time: `Thu, 12 Nov 2026 17:07:30 GMT` gives `2026-11-12T17:07:30Z`. The header must be in exactly that form, the one GitHub sends, and must name a real date and time. A missing, empty or repeated header, another date format, another time zone, or a date that does not exist fails the read. The day name is read for its form and is not checked against the date. No local clock is read at any point, so a response without a usable `Date` never gets a time from the machine that asked.

### Pagination

A list is read one page at a time, starting at page 1, and the pages are joined in order. Each page must be a JSON array. There is another page when the response's `Link` header is longer than 4096 characters, or has a `rel` parameter whose value contains the word `next`. The value may open with a double quote and is read up to the next double quote, comma or semicolon, so a single quote does not end it and `rel='next'` counts as another page. `next` must stand as a word by the pattern's word boundary, so `next-page` counts and `nextPage`, `_next` and `next_` do not. The next request is for the next page number at the same computed address. The target in the header is never read, so a header pointing at another host, repository or path cannot send a request there. A header that is doubtful counts as another page: asking for a page that does not exist costs one request, and missing a page that exists loses items. One that mentions `rel=next` inside a target is doubtful. So is one over 4096 characters, which is not matched at all, because matching takes time that grows with the square of the header's length.

Two forms are not recognised and end the list: a `rel` whose value has a comma or semicolon before `next`, and the extended form `rel*=`. GitHub sends neither.

If `maxPages` pages have been read and the last one still names a next page, the read fails with `pages-exceeded`. A list is returned whole or not at all. The collector reports that failure as `unavailable`, `read-failed`.

### Failures

For a caller that keeps to the types, everything this transport throws is a `GitHubReadError`. Three cases outside the types can throw something else: an options value that is `null` or `undefined`, a cursor that is not a string or `null`, and a `fetch` that resolves to something that is not a response. The first is thrown at construction, before any read. The other two are thrown by a read, and the collector still reports each as `unavailable`, `read-failed`. The error's message is one of the codes below, followed by the HTTP status for a response with a failing status. `code` and `status` carry the same two facts. The error never holds the token, an address or its query, a response body or header, or anything an underlying error said, and it has no `cause`. The class and its code type, `GitHubReadFailure`, are exported from `src/index.ts`.

`collectPullRequest` discards what a read threw and reports `unavailable`, `read-failed`. A caller that wants the code in its logs must wrap the reads to record it. Otherwise `pages-exceeded` from a `maxPages` that is too small cannot be told from an outage in the collected result.

| Message | Meaning |
| --- | --- |
| `options-invalid` | An option was not as described. Thrown at construction. |
| `request-failed` | `fetch` rejected or threw, which includes a redirect refused by `redirect: "error"`, or the body could not be read. |
| `request-failed 404` | The response's status was not 200. The number is that status. |
| `timed-out` | The request did not finish within `timeoutMs`. |
| `redirected` | The response reports that a redirect was followed. |
| `response-unreadable` | The body was not JSON. |
| `date-header-unreadable` | The pull request response had no `Date` header in the expected form. |
| `page-not-a-list` | A page of a list was not a JSON array. |
| `pages-exceeded` | The list did not end within `maxPages`. |

A rate limit is reported like any other failing status, as `request-failed 403` or `request-failed 429`. Nothing reads the rate-limit headers or waits.

### What the transport does not establish

- It does not authenticate that a response is GitHub's beyond the TLS connection to that origin, and that connection is made by the `fetch` it is given. A `fetch` that routes through a proxy, or one that does not verify certificates, removes that assurance.
- It cannot limit what the token may do. It sends only the four requests above, but a token with more than read access is the caller's risk wherever else that token goes.
- It cannot show that a list is complete beyond what GitHub's `Link` header says. A response that should name a next page and does not ends the list there.
- A list is not a snapshot. Pages are asked for by number, one request after another, so an item that appears or disappears while the pages are read can be skipped or repeated. The collector's second pass is the only check for that: it catches a difference between the two passes, not an item both passes missed.
- Only the address binds a reviews, timeline or thread response to the pull request; nothing in those responses is checked. The GraphQL read is not covered by `redirect: "error"`, so the query passes `followRenames: false` to ask GitHub to refuse an old name; GitHub accepts that argument, and that it then refuses an old name has not been qualified.
- `servedAt` is the time GitHub's server put on the response. It does not show that the state in the response was current at that time, and it is only as fresh as the response: a response replayed by something between GitHub and the `fetch` carries the time it was first served. `Cache-Control: no-cache` and `cache: "no-store"` ask for a fresh response and cannot prove one was given.
- `timeoutMs` bounds a request only if the `fetch` honours its abort signal, as the global one does. It bounds network waits only: the size of a response body is not bounded, and parsing the body and matching the `Link` header are synchronous, so no timeout can interrupt them.
- Refusing a redirect depends on the `fetch`: it must honour `redirect: "error"` or report `redirected` on the response. A `fetch` that follows a redirect and reports neither is not caught.
- It does not show that GitHub accepts the API version, the query or the token. Offline tests cannot.

Offline tests in `tests/github-pull-request-reads.test.ts` give the transport a `fetch` that records every request and answers from a script. They assert each request's address, method, headers and options, the conversion of the `Date` header, pagination and its bound, every failure and what a failure may hold, and they give these reads to the real `collectPullRequest`. No test makes a network request, and no live read of GitHub through this transport has been qualified.
