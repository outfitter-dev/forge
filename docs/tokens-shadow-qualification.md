# Tokens artifact shadow qualification

Matt approved one bounded artifact-only shadow trial for `outfitter-dev/monorepo`, `@outfitter/tokens@0.0.0`, preserving its current source-TypeScript/generated-CSS contract for Bun 1.4.4. [MONO-83](https://linear.app/outfitter/issue/MONO-83) retains the broader source-versus-built/Node publishing decision. This record distinguishes a stopped isolation attempt from package qualification; no artifact outcome has been established.

## Selected contract and bounds

The selected [source revision](https://github.com/outfitter-dev/monorepo/tree/2dc0fd17c2d5b8903e571158b7376c269b719e65) exports `.` → `./src/tokens.ts` and `./css` → `./tokens.css`, with no runtime/optional/peer dependencies, binaries, imports or pattern/fallback exports. Its dev-only workspace dependency does not make the artifact runtime-dependent. The proposed exact regular-file set is `package.json`, `src/tokens.ts`, `tokens.css`; that is manifest/tree intent, not a verified tarball. Packing must retain workspace context and confirm the actual file/manifest contract before accepting it.

The approved ceiling was five minutes, one immutable disposable source snapshot, one CSS coherence command, four packs, four fresh offline consumer installs, 12 install/runtime/type outcomes and four CSS checks. The healthy case and omit-source/omit-CSS/extra-file controls would remain disposable; negative copies would not be attributed as pristine source. Trusted validator revision was Forge `3675a3f62fd22ea0cd5867777120d5dbdd735a23`. No root workspace install, CI/Buildkite job, publish/tag/release mutation, migration, new access or worker change was included. A verified unprivileged, credential-free, no-network isolation boundary was a mandatory preflight; failure required stopping rather than relaxing it.

## Stopped attempt — November 11, 2026

The measured attempt began at **12:06:06.545481 UTC** and stopped **0.044 seconds** later. A restrictive macOS sandbox launched the pinned Bun binary with a scrubbed environment and owned temporary paths. It aborted with `SIGABRT` (exit signal 6) before producing the planned UID/environment/filesystem/network assertions. Captured stdout/stderr were empty; the isolation boundary was therefore **not qualified**.

| Actual operation | Count |
| --- | --: |
| Initial isolation preflight | 1 |
| Product snapshots / CSS coherence commands / packs | 0 / 0 / 0 |
| Consumer installs / install-runtime-type outcomes / CSS checks | 0 / 0 / 0 |
| Product code execution / trial CI or Buildkite jobs / publication mutations | 0 / 0 / 0 |

The initial preflight used only owned public canaries and a controlled local loopback listener; no external service, consumer code or secret was accessed. All owned temporary paths and the listener were removed. The existing monorepo checkout's eight unrelated modifications were preserved; the Forge checkout remained unchanged during execution. No full-trial retry occurred.

## Scoped diagnosis and remaining blocker

Separately authorized diagnosis used synthetic startup commands only, with no consumer/source execution, network attempt or secret access. Both `bun --version` and a trivial JavaScript print under the unchanged permission rules aborted before output. Scoped crash metadata for those two owned processes places the abort in `ignition_halt`, `boot_boot`, `ignite` and dyld cache initialization. The host was macOS 27.3 build `26C5035r`, arm64; the same Bun 1.4.4 binary reports its version outside this profile. These facts identify a profile/loader startup incompatibility, not an artifact failure or universal absence of sandbox support.

The installed Apple `dyld-support.sb` explicitly documents libignition's need to open `/` as its `openat` root, and lists loader syscall/fcntl/mapping support. Apple labels this a private, version-dependent system interface; it is diagnostic evidence, not a portable profile recipe. The handwritten deny-default profile omitted those bootstrap allowances. Missing loader support is a supported hypothesis; neither crash metadata nor scoped logs prove the exact minimal denied operation. A reporting-only modifier experiment was rejected by the profile compiler before startup; it granted no permission. No system profile, host/security setting or worker was changed.

The smallest proposed next diagnostic is a narrowly scoped loader allowance with synthetic positive/negative canaries. Root-directory read/open would change the original file-read scope, so it was not attempted under the instruction to preserve the original restrictions. Do not import broad `system.sb`, grant private-home/source access, enable network or run unsandboxed consumer code to obtain a green result. Requalify any explicitly released correction before separately resuming the artifact trial. Local raw receipts and crash excerpts stay outside Git; this document retains sanitized facts only.

[FOR-19](https://linear.app/outfitter/issue/FOR-19) remains open. No pack, consumer, artifact, complete release-policy or adoption claim follows from this stopped attempt; the [real-consumer trial prerequisites](release-composition.md#minimum-remaining-for-a-real-consumer-trial) still apply.
