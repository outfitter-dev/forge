# Trusted install check

`scripts/verify-trusted-install.sh` checks that a Forge install on a trusted host is the approved repository, the approved commit and the pinned Bun, before anything from that install runs. [FOR-38](https://linear.app/outfitter/issue/FOR-38) requires this of the trusted Buildkite lane: a wrong pin stops before anything runs. This is the check alone. No hook, pipeline or `forge` command calls it yet.

It guards against operator drift: an install left at the wrong commit, edited in place, pulled forward, or run with a different Bun. It does not defend against someone who can already write to the trusted host. Proposed pull-request code never runs on that host.

## Invocation

```sh
scripts/verify-trusted-install.sh --install <absolute-dir> --repository <owner/name> --commit <40-hex>
```

The three values come from the trusted host's own configuration. The script reads none of them from the install or from job input, and its caller must not either. `--install` is an absolute path with no trailing slash and no `.` or `..` component. `--repository` is `owner/name` in letters, digits, hyphens, underscores and dots. `--commit` is a full commit ID in 40 lowercase hexadecimal characters.

Run a copy of the script that the host keeps outside the install. The copy inside the install is part of what is being checked, and an edited one could report anything.

On success the script prints one line to stdout, `trusted install verified: <owner/name> <commit> bun <version>`. Everything else goes to stderr as fixed text. It prints no path, file content, environment value or remote URL, and it discards Git's own error output, which can quote the URL.

The install needs no `node_modules`, and must not have one: `node_modules/` is ignored, and check 5 fails on an ignored file. Forge has no production dependencies. On November 15, 2026, at commit `612aa3be9a120f4d5bc5bcfa6fd395beb1589630` with Bun 1.4.4, `bun src/forge-cli.ts gate` with no arguments ran from a fresh clone without `node_modules`, reported `invalid-input` with exit code 2, and left the clone passing this check.

## Checks

The checks run in this order and stop at the first failure. Each message is prefixed with `Error: `.

| # | Check | Message |
| --- | --- | --- |
| 1 | The install path exists, is a directory and is not a symlink. | `the install path is not an existing directory, or it is a symlink.` |
| 2 | It is the top level of a Git work tree: not a subdirectory of one, not a bare repository, and not a repository whose work tree is configured elsewhere. Git also refuses here when the user running the check does not own the install. | `the install path is not the top level of a Git work tree owned by the user running this check.` |
| 3 | `HEAD` resolves to exactly `--commit`. | `the install's HEAD is not the expected commit.` |
| 4 | The `origin` remote has one URL, and as Git would use it that URL is exactly `https://github.com/<owner>/<name>.git` or the same without `.git`. | `the install's origin remote is not the expected GitHub repository over HTTPS.` |
| 5 | The working tree is exactly the commit. Git's status reports nothing modified, staged, untracked or ignored, and every tracked regular file, hashed as it is on disk, has the ID of the commit's own blob. | `the install's working tree is not exactly the expected commit.` |
| 6 | No index entry is flagged `assume-unchanged` or `skip-worktree`, because status reports nothing for a flagged file. | `the install's index has entries flagged assume-unchanged or skip-worktree.` |
| 6 | The repository has no submodules, because status does not look inside one. | `the install has submodules.` |
| 7 | The install has a `.bun-version` holding a three-part version. | `the install has no .bun-version holding a three-part version.` |
| 7 | `bun` is on `PATH`. | `bun is not on PATH.` |
| 7 | `bun --version` equals the pin exactly. | `the Bun on PATH is not the version the install's .bun-version pins.` |

Exit codes: 0 when every check holds, 1 when a check fails, 2 for a usage error. A usage error is a missing, repeated or unknown flag, a flag without a value, a value that starts with `--`, or a value of the wrong form. It prints its reason and the usage line, and nothing is checked.

## What the script controls about Git

It unsets every `GIT_*` variable before calling Git, so a job environment cannot name another repository, work tree, index, object store or configuration. It does not read the user or system Git configuration. That needs Git 2.32 or later, the first to honour `GIT_CONFIG_GLOBAL`; the script does not check Git's version, and its tests have run on Git 2.54 and 2.55.

Git still reads the install's own configuration. Where a setting there was found able to hide a difference, the script forces the safe value: replace refs are ignored, a file-system monitor is neither run nor believed, the executable bit is always compared, and stat comparison is never relaxed. Untracked and ignored files are always listed, so neither a `status.showUntrackedFiles` setting nor an ignore rule from any source can hide a file. The byte comparison in check 5 does not use the index, so an index flag, cached stat data or a clean filter cannot hide an edit to a regular file. The script takes no optional locks and leaves the index as it found it.

## Ownership

Git refuses to work in a repository that another user owns unless a `safe.directory` entry lists it. The script supplies no such entry and reads no configuration that could hold one, so the install must be owned by the user who runs the check. Otherwise check 2 fails. This case has no offline test, because it needs a second user.

## What this does not establish

- It does not authenticate who approved the commit. It compares the install with the commit it is given, and the approval is whatever put that value in the host's configuration.
- It does not protect against someone who can write the install or the host configuration. That person can change the expected values, the host's copy of this script, the Git object store or the tools on `PATH`.
- It checks the version string that `bun --version` prints, not the Bun binary's bytes. `bun`, `git`, `grep`, `cut` and `tr` are whatever the caller's `PATH` finds.
- It trusts the environment it starts in apart from `GIT_*`: `PATH`, `BASH_ENV`, exported shell functions and dynamic-loader variables all take effect before or around it. The hook that runs it must start it from an environment the host sets, not one a job supplies.
- It is a check at one moment. Nothing stops the install changing between the check and the run that follows.
- The origin URL shows where the install is configured to fetch from, not where its objects came from.
- It does not run `git fsck`. It relies on the object store to return the content that each object ID names.
- A clean filter set up in the install's own Git configuration cannot hide an edit from check 5, but Git's status still runs the filter program. The script does not prevent that.
- A tracked symlink is compared by Git's status alone, with strict stat comparison forced. The byte comparison covers regular files.
- An empty untracked directory passes, because Git does not report one. Files under `.git`, such as hooks, are not inspected beyond the checks above.
- An install whose files are meant to differ from their blobs fails check 5: Git LFS, line-ending conversion, `ident` and other content filters. Forge uses none.
- It accepts only 40-character SHA-1 commit IDs and only `https://github.com/` remotes.
