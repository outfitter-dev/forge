# Legacy Forge retirement

As verified November 10, 2026, [outfitter-dev/forge-old](https://github.com/outfitter-dev/forge-old) was private and archived. It previously used the `outfitter-dev/forge` name and contains the historical durable multi-agent operating-model design. New engineering-automation Forge is a name reuse, not a continuation of that implementation contract.

The original record of preserved legacy checkouts, dirty notes and repaired worktree pointers is verified in the [local operational archive](public-readiness.md#operational-record-preservation). Matt accepted this machine-local, non-durable archive instead of a private-pilot PR. No legacy checkout, branch, worktree or note was deleted by FOR-25, and the predecessor repository was not unarchived or repointed.

Keep existing Actions consumers, Ranger and the CI pilot distinct. A local directory’s old basename does not establish repository identity. Recheck actual origins and ownership before changing external bookmarks or automation; qualify replacements before removing prior behavior. Routine delivery and deletion exceptions remain in [standing authority](../AGENTS.md#standing-delivery-authority).
