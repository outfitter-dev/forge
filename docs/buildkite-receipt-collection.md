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
