# Development checks

Forge uses Bun **1.4.4** for runtime, tests, dependency installation, and native typechecking. `.bun-version`, `packageManager`, bootstrap, and CI select that runtime. Run `./scripts/bootstrap.sh` in a fresh checkout/worktree, then use the same aggregate gate locally and in CI:

```sh
bun install --frozen-lockfile
bun run check
```

## Commands and configuration

| Command | Responsibility |
| --- | --- |
| `bun run lint` | `oxlint --deny-warnings .`; warnings and errors fail the gate. |
| `bun run format:check` | `oxfmt --check .`; Markdown prose is not hard-wrapped. |
| `bun run typecheck` | `bun check --no-script`; native checking with the repository tsconfig. |
| `bun run test` | Offline Bun tests; an empty suite is not allowed. |
| `bun run check` | Lint, formatting, native typechecking, then tests. |

`--no-script` explicitly selects Bun's typechecker even though `package.json` also defines an aggregate `check` script. Use the explicit typecheck command for typechecking alone; do not replace it with an ambiguous bare `bun check`. See [Bun's check-script behavior](https://github.com/oven-sh/bun/blob/main/docs/runtime/check.mdx#if-packagejson-has-a-check-script).

The strict tsconfig is unchanged: it includes `src/**/*.ts`, `tests/**/*.ts`, and root `*.config.ts`, with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, and `noEmit`. Both Oxc configuration files remain checked. Output/cache directories stay excluded. Lint uses the Ultracite core preset with a Node environment, read-only `Bun` global, and explicit generated-output ignores. Formatting preserves the Ultracite preset and `proseWrap: "never"`.

## Pins and editor decision

The accepted reference was [Ranger main at `fa0660b4f50e3bc6dcd4ae597b67ada39a174551`](https://github.com/outfitter-dev/ranger/blob/fa0660b4f50e3bc6dcd4ae597b67ada39a174551/package.json), read November 10, 2026. Forge adopts its exact tooling pins: oxlint **1.93.0**, oxfmt **0.78.0**, Ultracite **8.1.1**, and `@types/bun` **1.4.4**. The committed lockfile records the resolved dependencies. Ranger's application, skill-generation commands, and skill-specific formatting ignores are not Forge tooling requirements and were not copied. No Ranger or Skillset files were changed.

Forge no longer has a direct `typescript` dependency or a `tsc` gate. The active checker is the native checker shipped by the pinned Bun release; these checks do not establish a separately named TypeScript compiler version. A TypeScript package that appears transitively in the lockfile is not the gate or an intentional workspace editor pin.

There is no demonstrated need for a separate editor-only TypeScript pin in this package, so retaining one would add a second version to maintain without controlling the gate. Editors may use their bundled language service. If an editor disagrees with CI, reproduce with `bun run typecheck`; record the discrepancy before adding a workspace editor dependency or configuration. This decision does not claim that every editor version produces identical diagnostics.

## Qualification evidence

FOR-5 qualified the selected versions against the actual Forge checkout with Bun 1.4.4. Temporary fixtures were created one at a time, checked with `bun run typecheck`, and removed before the clean gate. They were not committed as deliberately broken source.

| Probe | Observed result |
| --- | --- |
| `export const value: number = "wrong"` in `src` | Exit 1, `TS2322`. |
| The same error in `tests` | Exit 1, `TS2322`. |
| The same error in a root `*.config.ts` | Exit 1, `TS2322`; config-file inclusion is preserved. |
| Assigning an indexed `string[]` read to `string` | Exit 1, `TS2322`; unchecked indexed access remains enforced. |
| Explicit `undefined` for an optional boolean property | Exit 1, `TS2375`; exact optional properties remain enforced. |
| Exported function with an implicit-any parameter | Exit 1, `TS7006`; strict checking remains enforced. |
| `debugger;` fixture with `no-debugger` explicitly set to warning | Direct oxlint without `--deny-warnings` exited 0; `bun run lint --warn no-debugger <fixture>` exited 1 for the same warning. |

After removal, the standalone typecheck and complete aggregate gate pass. Completion of the aggregate gate verifies that its typecheck invocation does not recurse into the aggregate script. The upgraded lint/format presets accept the existing application/tests; only the edited formatter config required formatting. Frozen installation and CI use these same pinned commands. This is tooling qualification, with no provider calls, runtime deployment, consumer migration, or claims about live evidence collection.
