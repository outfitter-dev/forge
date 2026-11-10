# Legacy Forge retirement

As verified November 10, 2026, GitHub repository ID `1373562974` is private, named [outfitter-dev/forge-old](https://github.com/outfitter-dev/forge-old), and archived. It previously used the `outfitter-dev/forge` name. The archive is the historical home of the durable multi-agent execution, review, and recovery design. New engineering-automation work belongs in the new Forge repository; this is a name reuse, not a continuation of the old implementation contract.

The legacy base checkout was moved from `/Users/mg/Developer/outfitter/forge` to `/Users/mg/Developer/outfitter/forge-old`. Its modified `docs/notes/2026-09-18-bb-plugin/bb-plugin-design.md` was preserved. The origin now explicitly targets `https://github.com/outfitter-dev/forge-old.git`; it must not point at the new repository.

An existing linked worktree remains at `/Users/mg/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_3xi5re597t-1/forge`. Its Git administrative pointer was repaired after the base checkout moved; its branch and contents were preserved. Its old basename does not make it a checkout of the new Forge.

No legacy branches, worktrees, notes, or open work were deleted. The archived repository was not unarchived to edit historical files. Any external bookmarks, automation configuration, or open editor references that hard-code the old checkout path need owner-specific updates before use; this bootstrap does not silently repoint historical jobs at the new codebase.

Keep existing `outfitter-dev/actions`, Ranger, and `agentic-ci-pilot` distinct. They are not deprecated by the legacy Forge archive. Move proven responsibilities through focused migration PRs with consumer verification before retiring their old implementations.
