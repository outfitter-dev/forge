# Immutable npm evidence and partial-publication recovery

[FOR-18](https://linear.app/outfitter/issue/FOR-18) adds a pure registry-evidence classifier and a bounded read-only observer to the existing Forge package. They adapt [Skillset's propagation/recovery helper at 24800e0](https://github.com/outfitter-dev/skillset/blob/24800e02ed4e7150ea1bc7130c35603c98ea9da2/scripts/publish-propagation.ts), including the [SET-514](https://linear.app/outfitter/issue/SET-514) occupied-version/visibility regression. The inspected Skillset main still matched that source when implementation began. No npm client, fetch implementation, process runner, credential, publisher, package graph, or consumer migration is included.

## Contract

`evaluateNpmEvidence(publication, observation, policy)` returns a structured state and reason codes from an npm packument observation. The product supplies an exact package name, version, dist-tag and canonical SHA-512 SRI of its staged tarball. These selectors are bounded, whitespace-free exact strings; Forge does not choose versioning or product packaging policy. Expected identities/policy reject unsupported fields. Registry JSON is validated at the relevant fields while unrelated registry metadata remains opaque.

A complete result requires matching top-level and version-entry identities, the exact staged integrity, the selected provenance predicate reference, and the exact dist-tag target. `not-found`, an absent version/integrity/provenance reference or a wrong tag/predicate remains incomplete. A different occupied integrity is a conflict; malformed relevant metadata is invalid. Authentication, rate-limit, network and registry-error observations remain unavailable, never absent or complete. Inherited properties and non-JSON object prototypes cannot supply evidence.

**Completion means the requested registry metadata checks completed.** It does not prove tarball bytes were downloaded/verified, an attestation signature was authenticated, a workflow/source identity was verified, or this invocation published anything. Predicate-reference shape is not producer authentication. The observer always records `provenanceVerification: "reference-only"`; an unsupported policy field requesting stronger authentication is rejected. A trusted adapter must establish the registry origin and transport and perform any separately required authenticated provenance validation before consequential action. Results confer no authority to publish or change dist-tags.

`classifyNpmPublishResult(version, { exitCode, stderr })` separately interprets an already-executed, caller-bound npm command. Exit zero yields `outcome: "verify", publishSucceeded: true`. An exact occupied-version diagnostic yields `outcome: "verify", publishSucceeded: false`; it is not success until fresh matching artifact evidence arrives. Unrelated errors and another version's conflict remain failed. This classifier does not authenticate or bind the subprocess to a package; its trusted caller owns that association and must stop on `failed`. Raw stderr/errors never enter receipts.

## Read-only observation

`observeNpmPublications(publications, policy, io, optionalCancellation)` observes a nonempty set of unique package names. Every round re-reads every package, including previously matching packages, so a changing tag is not silently satisfied by an old observation. Package decisions correspond to the captured publication array in order. A complete set, incomplete/partial set, invalid input, deterministic conflict, unavailable read, exhausted attempt/time budget and cancellation remain distinguishable. No missing package is automatically published, and no product dependency order is inferred.

```ts
import { observeNpmPublications } from "@outfitter/forge";

const result = await observeNpmPublications(
  expectedPublications, // product-owned immutable artifact manifest
  {
    provenancePredicateType: "https://slsa.dev/provenance/v1",
    maxAttempts: 20,
    timeoutMs: 900_000,
    initialDelayMs: 3000,
    maxDelayMs: 30_000,
  },
  {
    read: trustedRegistryRead, // (name, signal) -> found / not-found / unavailable
    sleep: boundedSleep, // (milliseconds, signal) -> Promise
    now: monotonicClock, // milliseconds
  }
);
```

These are explicit caller-selected bounds, not defaults. The operation caps inputs at 100 unique package names, 1000 attempts and 15 minutes; delays must be positive and within the time budget. Backoff doubles up to the explicit delay cap, clipping the last wait to the remaining budget. Only incomplete metadata is retried. Conflicts, invalid data and unavailable reads stop the run; no speculative service-error retry policy is invented.

Injected clocks and sleep keep tests independent of wall time. A real deadline signal also bounds waiting on read/sleep callbacks even when an adapter ignores cancellation. The observer cannot terminate arbitrary callback side effects; adapters must honor signals and release their resources, and must remain read-only. Regressing/nonfinite/throwing clocks fail closed. A callback that resolves after a deadline cannot qualify the set. Transports still own response-size limits, status-to-observation mapping, HTTPS identity and credential handling. A round is a bounded series of observations, not an atomic registry snapshot or a guarantee that a mutable tag stays unchanged afterward.

Receipts capture the exact expected publication set, policy, attempt count, package decisions and stop reason. They omit registry documents, arbitrary input fields, exception text and stderr. Callers must bind their staged-artifact manifest, trusted validator revision/runtime and collection run identity when retaining or acting on receipts; this module does not invent those identities. Pre-publication contents/exports/runtime/type/clean-consumer validation is separately tracked in [FOR-24](https://linear.app/outfitter/issue/FOR-24).

## Offline qualification and limits

The new suites cover matching evidence; absent and partial sets; delayed visibility beyond 30 seconds; same-version wrong integrity; changing tags across rounds; malformed and wrong-identity metadata; exact/unrelated immutable-version diagnostics; missing/wrong predicate; unavailable transport states; sanitized exceptions; invalid/duplicate/sparse inputs; changing caller expectations; bounded backoff; late responses; and cancellation of uncooperative reads. They use fictitious packages and injected IO only. Existing evaluator/CLI behavior is unchanged.

This is offline operation qualification. It does not establish real npm publishing/permissions, cryptographic provenance, registry propagation timing, product adoption or a public Actions adapter. Forge owns the operation; product repositories retain their build/signing/task graphs and release policy. Existing release paths remain operational until a separately authorized replacement qualifies.
