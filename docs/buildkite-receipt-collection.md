# Buildkite receipt collection

`collectBuildkiteReceipt` is the trusted lane's read operation for an admitted project check. It reads a Buildkite build, chooses one current `forge-check` job, retrieves that job's receipt artifact and calls `qualifyBuildkiteGateReceipt`. The caller receives structured collection diagnostics and, when qualified, the exact bytes for the existing gate receipt input.

The caller supplies authenticated admission, the organization and pipeline slugs, build number, exact artifact path, independently protected capture, trusted execution expectations and a Buildkite read token. Admission must already bind the organization UUID, pipeline UUID, build UUID, job UUID, queue UUID, repository, PR, head and base. The REST route selects the organization by slug, while the returned build establishes the remaining build identity. The read operation does not independently verify an organization UUID or infer the PR base from Buildkite. The host authenticates admission and rereads GitHub's current PR before evaluating its gate.

The [Buildkite build API](https://buildkite.com/docs/apis/rest-api/builds) returns the latest job for each step by default. Collection uses that response and requires exactly one matching step with the admitted job ID and queue. Retried, parallel, matrix, unknown or duplicate attempts are refused. The selected job must have passed with exit zero and no soft failure. After downloading the receipt, collection rereads the build and requires the same selected job outcome. A retry during transfer therefore cannot supply an old success. An attempt or PR can still change after that final read, so publication must perform its own freshness check.

The [artifact API](https://buildkite.com/docs/apis/rest-api/artifacts) is read under that exact job. Collection follows the API’s next-page relation within a ten-page bound, requiring exactly one artifact at the configured path. It derives each page URL locally instead of following the header’s target. A full final tenth page is complete when the response has no next-page relation. A next-page relation at the bound refuses collection. The artifact must be finished and report a size from one byte through 64 KiB. Collection derives its download API URL from the selected identities, ignoring artifact URL fields. It obtains the API redirect with the read token, then fetches storage with no API authorization header. The operator must configure exact HTTPS storage origins accepted for this installation. An unknown origin or another redirect refuses collection. The download is bounded while reading and must match the declared size.

Artifact metadata supplies no receipt authority. The expected SHA-256 and runner exit code come from the protected launcher capture supplied separately by the host. The existing verifier checks those against the downloaded bytes and the independent execution expectations. Collection can succeed while qualification withholds the receipt, for example when a capture digest differs or execution expectations are unavailable. Only a non-null returned `receipt` may enter a protected file passed to `forge gate --receipt`, with the admitted `--expected-head` and `--expected-base`.

The project and trusted workers run on separate hosts. Their operator must choose and qualify how the protected capture reaches the trusted collector. A project-uploaded capture artifact cannot establish its own expected digest. The host also controls read-token delivery, artifact storage origins, protected temporary files and ledger custody. This operation supplies no upload, cross-host capture authentication, status publication or worker installation.

Run the transport and selection regression cases from a bootstrapped checkout:

```sh
bun test tests/collect-buildkite-receipt.test.ts
```

The transport cases are offline. They prove request bindings, bounded reads, credential handling and rejection behavior against recorded API shapes. Actual Buildkite responses, storage destinations and permissions still need qualification on the configured installation.

## Protected gate handoff

`collectBuildkiteGateReceipt` connects the protected capture reader, authenticated collector and gate file input. The trusted host supplies the admitted job identity, execution expectations, API selectors, approved storage origins, `captureRoot` and `outputRoot`. Both roots must be absolute. The output root must already exist, owned by the collector account with mode 0700. The capture reader enforces its documented record permissions. These checks depend on the host keeping both roots outside proposal access and job cleanup.

The operation reads `captureRoot/<job-id>/capture.json` through `readBuildkiteProjectCapture`. A missing capture stops before network collection. A qualified download is published once to `outputRoot/<job-id>/receipt.json`, in a new private directory with a mode 0600 file. Only `status: "ready"` supplies a receipt path. Failed collection or verification supplies a fixed withholding reason. A duplicate or interrupted output directory is refused, so a previously returned path cannot silently change on a later invocation. Reconcile an interrupted directory under host ownership or admit a new job attempt before trying again.

The CLI in `src/buildkite-receipt-collection-cli.ts` takes one absolute operator-selected JSON file. That protected file contains the same `admission`, `expectation`, `organizationSlug`, `pipelineSlug`, `buildNumber`, `artifactPath` and `artifactOrigins` inputs as the collector, plus the two roots. It contains no `capture` field or API credential. The CLI reads the token only from `FORGE_BUILDKITE_READ_TOKEN`, uses its installed fetch transport, and refuses verbose-fetch configuration. Exit zero means a ready file was published, exit one means evidence was withheld, and exit two means the invocation or operator file could not be accepted.

Build this CLI from the approved install, with the pinned Bun version and both autoload options disabled, as for the project-capture CLI. The host's credential delivery mechanism then invokes the compiled collector outside proposal workspaces. An illustrative protected gate hook uses its result without reimplementing correlation:

```sh
set -eu
/opt/forge/bootstrap/forge-buildkite-collect /etc/forge/collect.json > "$collection_result"
receipt=$(jq -er 'select(.status == "ready") | .receiptFile' "$collection_result")
/opt/forge/releases/APPROVED_COMMIT/bin/forge gate \
  --repository "$admitted_repository" --pull-request "$admitted_pr" \
  --expected-head "$admitted_head" --expected-base "$admitted_base" \
  --policy "$trusted_policy" --state "$trusted_state" --run-id "$admitted_run" \
  --receipt "$receipt" --review-evidence "$qualified_review_evidence"
```

The hook's variables, compiled paths, policy, review evidence, result file and credential environment are host-selected protected inputs. The example assumes that installation layout and qualified review evidence exist. Capture delivery between the project and trusted hosts, artifact upload, actual download-origin qualification, PR freshness, worker isolation and live status publication still need host integration and approval. The gate checks the supplied revision pair again against its own GitHub collection.

`tests/buildkite-gate-receipt.test.ts` now exercises the real capture operation and protected reader, retrieves those bytes through the actual collector with controlled HTTP responses, publishes the gate handoff and gives that exact file to the real gate CLI. A changed artifact body is refused against the protected digest, an actual command exit 17 stays nonpassing, and duplicate file publication leaves the earlier bytes intact. The transport fixtures establish operation composition and preserve the explicitly unqualified live boundaries.
