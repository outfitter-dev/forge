# Selected distribution qualification

Matt authorized creating/testing two disposable `outfitter-dev` consumers using existing access, no new keys, and a trusted Studio execution boundary. The November 10, 2026 run below exercises the [source-invocation route](private-distribution-analysis.md); it does not complete [FOR-6](https://linear.app/outfitter/issue/FOR-6)'s original personal-account cross-owner criteria. No production consumer, private package, reusable workflow access, or public Forge source distribution was enabled.

## Immutable subjects and service evidence

| Subject | Identity and result |
| --- | --- |
| Trusted private Forge source | `outfitter-dev/forge` at `8678be9dad814d35f42a2c159c375a7f48e9e8f4`, fetched on Studio through existing authorized GitHub access; checkout commit verified before/after invocation. Bun 1.4.4. |
| Private fixture | [outfitter-dev/forge-distribution-pilot](https://github.com/outfitter-dev/forge-distribution-pilot), repository ID `1453270363`, fixture commit `1c95756d6e15ce54963d57f1d0b9bb9e2931ce1d`. Ownership/private visibility verified after creation. |
| Public fixture | [outfitter-dev/forge-pilot](https://github.com/outfitter-dev/forge-pilot), repository ID `1453270480`, fixture commit `2607e945541697bdd31f9a743c4ee9bffc6f79c5`. Ownership/public visibility verified after creation. |
| Private repository-token denial | [Actions run 42917818335](https://github.com/outfitter-dev/forge-distribution-pilot/actions/runs/42917818335) passed fixture validation and required HTTP 404 when its own repository-scoped token requested private Forge metadata. |
| Public repository-token denial | [Actions run 42917824369](https://github.com/outfitter-dev/forge-pilot/actions/runs/42917824369) passed the same denial. No Forge credential or private source was supplied to that job. |

Both repositories contain only a harmless README, three synthetic case selectors, and a boundary workflow. The workflow uses the existing pinned checkout revision with credential persistence disabled; its token has only its own repository's contents-read permission. It validates selectors and checks denial, not Forge eligibility. There is no schedule, provider call, publication, or consumer-side fetch of private Forge source.

## Trusted-host invocation

At 22:49:30 UTC the trusted Studio process fetched each consumer's selector file at its exact fixture commit using existing GitHub access. It accepted only `passing-pr`, `blocked-pr`, and `invalid-facts`, and selected the corresponding fictitious examples from the pinned private Forge checkout. Consumer selectors were data, never shell commands, arbitrary paths, workflow instructions or grants of authority. This is fixture compatibility through a trusted external host, not adoption of a product task graph.

The CLI child environment contained only an explicit system `PATH`, an empty temporary `HOME`, and locale; no GitHub fetch token, Devin token, provider credential or proposed executable code was supplied. This environment discipline is not an OS sandbox: the approved trusted runtime still runs under the operator's account. The same existing evaluator/CLI ran for both consumers:

| Selector | Expected/actual exit | Decision |
| --- | --- | --- |
| `passing-pr` | 0 / 0 | Evaluated, eligible true under the fictitious fixture policy. |
| `blocked-pr` | 1 / 1 | Evaluated, eligible false. |
| `invalid-facts` | 2 / 2 | Invalid, eligible false. |

Corresponding outputs were byte-identical across consumers. The private normalized receipts and their SHA-256 digests were retained with source/runtime/consumer identity. No receipt authorizes a real landing. A deliberately wrong configured source pin was rejected by the qualification runner before invocation; this is a runner control, not a newly implemented production distribution API.

## Cleanup and limits

The owned temporary private Forge checkout was removed after source identity and absence of local persisted fetch-credential configuration were checked. Synthetic receipts and sanitized results remain in private thread storage. The two authorized fixture repositories and completed Actions runs are retained as evidence; no new credential, grant, sharing setting or repeating job needs revocation. The original pilot runtime/state and other checkouts were untouched by this distribution run.

This establishes same-owner selected private/public fixtures, denial to each consumer's ordinary CI token, and successful private Forge execution on the explicitly trusted Studio host. It does not establish authenticated source access from consumer CI, personal `galligan` access, private reusable workflow resolution, package/artifact distribution, least-privilege scope inventory of the existing workstation identity, or real credential expiry/rotation. No secrets or private source entered the public repository. FOR-6 remains open for its remaining acceptance gaps; these observations must not be relabeled as cross-owner qualification.
