# Devin findings discovery

[FOR-9](https://linear.app/outfitter/issue/FOR-9) requires a supported findings interface, validated credentials, exact repository/head/base binding, offline regressions, and live negative/passing cases before Devin becomes a required provider. This November 10, 2026 record is read-only discovery, not a completed adapter or live qualification. No authenticated Devin API call, review trigger, credential creation, settings change, or worker operation was performed.

## Supported public interface found

The official [organization PR-review endpoint](https://docs.devin.ai/api-reference/v3/pr-reviews/get-organizations-pr-reviews) documents `GET /v3/organizations/{org_id}/pr-reviews`, with required `pr_url` and optional `commit_sha`. It requires a supported service user or personal access token with `ViewReview` for that organization. Use a full immutable head SHA for an eventual collector, despite the API accepting short prefixes. Omitting it resolves the current head, which is not a binding to an earlier observation. A missing review for the resolved commit returns 404.

| Published response field | Documented meaning and limit |
| --- | --- |
| `commit_sha` | PR head to be reviewed; no original base is returned. |
| `created_at` | When the review was accepted, not a completion timestamp. |
| `pr_number` | PR identity; compare with the explicitly requested consumer. |
| `repo_path` | Host-prefixed repository identity such as `github.com/owner/repo`; do not silently discard the host. |
| `status` | `pending`, `running`, `completed`, `errored`, `cancelled`, or `skipped`; execution state does not establish zero findings or full coverage. |

The [enterprise endpoint](https://docs.devin.ai/api-reference/v3/pr-reviews/get-enterprise-pr-reviews) also looks up status; organization ownership is resolved from the PR URL. Prefer the narrower organization route for the pilot. The separate POST trigger uses `UseReviewManual` and starts work on the latest PR commit; reading its documentation is not permission to invoke it. GET-only discovery needs no trigger, impersonation, review-management, or organization-admin permission.

The inspected public PR-review GET schema supplies no findings, blocking counts, coverage/completeness, original base SHA, or stable review-result identifier distinct from commit/acceptance time. The documented [code-scan findings endpoint](https://docs.devin.ai/api-reference/v3/code-scans/organizations-code-scans-findings) belongs to code scans; a `pr_url` on a scan finding does not establish equivalence to a complete PR review. These observations describe the inspected published contract, not a claim that no additional vendor-supported interface could exist.

## Status and comments cannot fill the gap

The official [Devin Review guide](https://docs.devin.ai/work-with-devin/devin-review#posting-to-github) documents configurable commit-status passing conditions: review completed is the default; other choices include resolved threads or no findings. Posting of bugs, security findings, investigate flags, and informational flags is independently configurable, including per-scope suppression. Therefore a green status or an empty set of GitHub comments cannot establish a complete clean provider result. Resolving visible threads remains a separate landing requirement.

At pilot source `5264279b9ce776d2a8f8e6c3785c663d9b653cf8`, `machinery/github_reviews.py` expects an allowlisted GitHub check run with an explicit `pilot-evidence` head/base/findings marker. That was a proposed contract, not the documented live status API; the required-provider adapter remains disabled. Local pilot HEAD `897810f03bc14098809c5a113472649923d0d905` has the same `github_reviews.py` blob (`38f3120ef1b5872e8f155df13558225f98c520cf`) as the qualified source on GitHub. No marker producer, private browser endpoint, or replacement wire schema is invented here.

[Forge's evaluator](evidence-evaluator.md) already rejects missing findings and mismatched revisions under an explicit required-Devin policy. Do not manufacture `complete: true`, zero findings, the current base, or trusted runtime identity from status. Manual UI inspection used for Forge's own PR reviews is not a supported authenticated collection contract for an unattended provider adapter.

## Established runtime and remaining access

Reuse the [established Studio/Buildkite setup](handoff.md#established-pilot-setup). Matt confirmed it, and authorized read-only Rex/container inspection established topology and dated availability. Do not ask him to reselect the host, reinstall workers, or relocate preserved state. The native review pane's four-hour exit and Linux worker's running state are availability facts, not reasons to redesign the setup; restarting is a separate operation.

The consumer remains `outfitter-dev/agentic-ci-pilot`; discovery needs no new repository. Existing GitHub access read pilot metadata and Devin's signed-in UI displayed Outfitter. Neither establishes a Devin API organization ID or API permission. GitHub owner `outfitter-dev` is not a Devin `org-...` identifier. Matt has created a service-user API token with a stated 90-day lifetime and is its custodian. Protected delivery as `DEVIN_API_TOKEN` is pending confirmation; exact expiry and effective permission have not been verified. No token value or secret file was read or included here.

Use the supplied identity only through its protected delivery mechanism in an approved trusted GET-only process outside proposed checkouts. The documented minimum for PR-review lookup is `ViewReview`; confirm the owning organization ID and effective scope without expanding permissions. Record exact expiry/renewal responsibility privately, plus output readers and retention. Never put the value or local secret-file path in Git, a PR job, command logs, or chat. Delivery and API access do not resolve the unsupported findings contract or authorize review triggers, worker restarts, or broader grants.

GET-only discovery would not intentionally start review/model/worker jobs. The inspected docs do not establish a zero-charge guarantee; preserve rate limits and existing spend boundaries. Actual review triggers, live cases, and worker operations require bounded execution/budget decisions. Do not change spending limits or count skipped/errored work as complete.

## Prerequisites before implementation

Obtain vendor-supported documentation or an explicitly supported export establishing:

1. Complete PR findings and coverage, including category filtering, pagination, unresolved/fixed/invalidated dispositions, any required custom reviewers, and clean results distinguishable from missing data.
2. Original repository and exact head/base semantics for base-only movement, same-head reruns, cancellation, result identity, and acceptance/completion ordering. Copying a current base onto a head-only response cannot establish its historical base.
3. Authenticated producer identity, minimum permission, stable version/compatibility, error/rate behavior, and result access after reruns or retention expiry.
4. Permitted evidence transfer, credential delivery/custody, and budget for the existing disposable pilot. Validate selected credentials only after scope/authority is explicit; documentation is not proof of account access.

Matt can settle organization and custody now, but credentials alone cannot supply absent findings/base/completeness semantics. An owner/vendor must provide the supported contract; do not reverse-engineer private browser traffic or send support messages without authorization. If no adequate interface exists, leave the required provider unsatisfied. A policy change needs explicit owner approval and qualification; a tactical status parser cannot waive the automation contract.

Then implement a focused provider-specific boundary and reuse the evaluator. Offline cases must cover clean/blocking findings, incomplete coverage/pages, malformed/duplicate data, wrong repository/head/base/runtime, reruns/cancellation, missing/unavailable/auth/rate-limit responses, and tampering. Separately authorize actual passing and deliberate-finding pilot cases with exact source/runtime, authenticated references, expected/actual gates, costs/limits and cleanup. FOR-9 remains open until its live acceptance criteria are met.
