# Trusted install check

`scripts/verify-trusted-install.sh` checks that a Forge install on a trusted host is the approved repository, the approved commit and the pinned Bun, before anything from that install runs. [FOR-38](https://linear.app/outfitter/issue/FOR-38) requires this of the trusted Buildkite lane: a wrong pin stops before anything runs. This is the check alone. No hook, pipeline or `forge` command calls it yet.

It guards against operator drift: an install left at the wrong commit, edited in place, pulled forward, or run with a different Bun. It does not defend against someone who can already write to the trusted host. Proposed pull-request code never runs on that host.

## Invocation

```sh
scripts/verify-trusted-install.sh --install <absolute-dir> --repository <owner/name> --commit <40-hex>
```

The three values come from the trusted host's own configuration. The script reads none of them from the install or from job input, and its caller must not either. `--install` is an absolute path with one leading slash, no trailing slash and no `.` or `..` component. `--repository` is `owner/name` in letters, digits, hyphens, underscores and dots, with no `.git` suffix. `--commit` is a full commit ID in 40 lowercase hexadecimal characters.

Run a copy of the script that the host keeps outside the install. The copy inside the install is part of what is being checked, and an edited one could report anything.

On success the script prints one line to stdout, `trusted install verified: <owner/name> <commit> bun <version>`. Everything else goes to stderr as fixed text. It prints no path, file content, environment value or remote URL, and it discards the error output of the tools it runs, which can quote a path or the URL.

The install needs no `node_modules`, and must not have one: `node_modules/` is ignored, and check 6 fails on an ignored file. Forge has no production dependencies. On November 15, 2026, at commit `612aa3be9a120f4d5bc5bcfa6fd395beb1589630` with Bun 1.4.4, `bun src/forge-cli.ts gate` with no arguments ran from a fresh clone without `node_modules`, reported `invalid-input` with exit code 2, and left the clone passing this check.

## Checks

The checks run in this order and stop at the first failure. Each message is prefixed with `Error: `.

| # | Check | Message |
| --- | --- | --- |
| 1 | The install path exists, is a directory and is not a symlink. | `the install path is not an existing directory, or it is a symlink.` |
| 2 | It is the top level of a Git work tree: not a subdirectory of one, not a bare repository, and not a repository whose work tree is configured elsewhere. Git also refuses here when the user running the check does not own the install, and the check fails when that user cannot enter the directory. | `the install path is not the top level of a Git work tree owned by the user running this check.` |
| 3 | `HEAD` resolves to exactly `--commit`. | `the install's HEAD is not the expected commit.` |
| 4 | The `origin` remote has one URL, and as Git would use it that URL is exactly `https://github.com/<owner>/<name>.git` or the same without `.git`. | `the install's origin remote is not the expected GitHub repository over HTTPS.` |
| 5 | `git ls-files` lists at least one index entry and marks every entry as ordinary. An entry flagged `assume-unchanged` or `skip-worktree` fails, because status reports nothing for a flagged file. So does an unmerged entry, an index Git cannot read, and a missing or empty index, which Git reads as holding no entries. This runs before any file's content is read: a flagged path can be a FIFO, and reading one would block. | `the install's index is unreadable or has entries flagged assume-unchanged or skip-worktree.` |
| 5 | The repository has no submodules, because status does not look inside one. | `the install has submodules.` |
| 6 | The working tree is exactly the commit, in three steps. Git's status reports nothing modified, staged, untracked or ignored. A walk of the install with `find`, which fails on a directory it cannot read, counts exactly as many files, links and empty directories as the commit names entries. Status has found no tracked path missing by then and a checkout has no empty directory, so equal counts mean the install holds nothing that status does not list. For each tracked regular file or symlink, the verifier hashes the file contents or the link target bytes and compares the result with the blob ID in the commit. | `the install's working tree is not exactly the expected commit.` |
| 7 | The install has a `.bun-version` that is a regular file, or a link to one, holding a three-part version. Nothing else is opened: reading a FIFO or a device would block. | `the install has no .bun-version holding a three-part version.` |
| 7 | `bun` is on `PATH`. | `bun is not on PATH.` |
| 7 | `bun --version` prints the pin exactly and exits 0. | `the Bun on PATH is not the version the install's .bun-version pins.` |

Exit codes: 0 when every check holds, 1 when a check fails, 2 for a usage error. A usage error is a missing, repeated or unknown flag, a flag without a value, a value that starts with `--`, or a value of the wrong form. It prints its reason and the usage line, and nothing is checked.

## What the script controls about Git

It unsets every `GIT_*` variable before calling Git, so a job environment cannot name another repository, work tree, index, object store or configuration. It does not read the user or system Git configuration. One consequence was observed with Apple Git 2.54.0 and Git 2.47.3: an install whose index was written under a user-level `core.splitIndex` together with `index.skipHash`, for example by cloning with both set, fails check 5, because the script reads the index without them. That fails closed, and either setting alone passes.

The script needs Git 2.35.2 or later. `GIT_CONFIG_GLOBAL` arrived in 2.32, and Git's refusal of a repository owned by another user arrived in 2.35.2. The script does not check Git's version, and older versions are untested. Its test file has been run with Apple Git 2.54.0 on macOS and with Git 2.39.5 and 2.47.3 in Debian containers. CI runs it on an Ubuntu runner, which had Git 2.56.1 on November 15, 2026.

Git still reads the install's own configuration. Where a setting there is known to hide a difference, the script forces the safe value: replace refs are ignored, a file-system monitor is neither run nor believed, the executable bit is always compared, stat comparison is never relaxed, a tracked symlink must be a symlink on disk, and file names are compared with regard to case. The last means that on a case-insensitive file system a tracked file renamed only in case fails check 6.

Status is asked for every untracked and ignored file, whatever `status.showUntrackedFiles` says and whichever ignore rules apply. It still never lists an entry named `.git` below the top level or anything inside one, a FIFO, a socket or a device file, an empty directory, or anything below a path longer than the system allows in one call, which is 1,024 bytes on macOS and 4,096 on Linux. It also skips a directory it cannot read. Each of those changes the count in check 6 or makes its walk fail. The byte comparison in check 6 does not use the index, so cached stat data or a clean filter cannot hide an edit to a regular file or a changed link target. The script takes no optional locks and leaves the index as it found it.

## Ownership

Git refuses to work in a repository that another user owns unless a `safe.directory` entry lists it. The script supplies no such entry and reads no configuration that could hold one, so the install must be owned by the user who runs the check. Otherwise check 2 fails. This case has no offline test, because it needs a second user; the following was observed by hand with Git 2.47.3 in a container.

- Git tests the owner of the top directory and of `.git` only. An install whose subdirectory or file belongs to another user passes that test, and its content is still checked.
- Git run as root accepts a repository owned by the user that `SUDO_UID` names. Without `SUDO_UID`, root is refused an install that another user owns.

## What this does not establish

- It does not authenticate who approved the commit. It compares the install with the commit it is given, and the approval is whatever put that value in the host's configuration.
- It does not protect against someone who can write the install or the host configuration. That person can change the expected values, the host's copy of this script, the Git object store or the tools on `PATH`.
- It checks the version string that `bun --version` prints, not the Bun binary's bytes. `bun`, `git`, `find`, `grep`, `cut`, `tr`, `readlink` and `wc` are whatever the caller's `PATH` finds, and `find` must support `-print0` and `-empty`, as GNU and BSD find do. The GNU and macOS versions of `readlink` support `-n` to emit the exact target bytes.
- It trusts the environment it starts in apart from `GIT_*`: `PATH`, `BASH_ENV`, `SHELLOPTS`, exported shell functions and dynamic-loader variables all take effect before or around it. `SHELLOPTS=xtrace`, for one, makes bash trace every command to stderr, install path and origin URL included. The hook that runs the script must start it from an environment the host sets, not one a job supplies.
- It is a check at one moment. Nothing stops the install changing between the check and the run that follows.
- The origin URL shows where the install is configured to fetch from, not where its objects came from.
- The script forces, one at a time, the install-level Git settings that are known to hide a difference. That is not a proof that no other setting can. The count and the byte comparison in check 6 do not depend on those settings: a file, link or empty directory that status does not list still changes the count, and an edited regular file or retargeted link changes its hash. A changed executable bit or a regular file replaced by a link to the same contents still depends on status reporting the mode change. A missing entry alone would not, because the count changes.
- It does not run `git fsck`, and Git does not re-hash every object it reads. With Apple Git 2.54.0 and Git 2.47.3, a forged commit object and a forged root tree were each rejected with a hash mismatch, and a forged blob for a regular file failed the byte comparison. The earlier verification run also accepted a forged subtree object and a forged blob for a tracked symlink. The current check compares link target bytes with the blob ID recorded in the tree. It does not audit the object store.
- A clean filter set up in the install's own Git configuration cannot hide an edit from check 6, but Git's status still runs the filter program. The script does not prevent that.
- The count assumes that every name the commit tracks is its own entry on disk. On a case-insensitive file system, a commit that tracks two names differing only in case checks out as one file. A clean install of such a commit fails check 6, because the count is one short. If the two names hold the same bytes, it passes with one added entry that status does not list, which makes up the count. Both were reproduced on macOS. Forge tracks no such names today. Names that differ only in Unicode normalisation are the same class and were not tested.
- Files under the top-level `.git`, such as hooks, are not inspected beyond the checks above.
- An install at the root of its own volume fails check 6 where the file system keeps a directory of its own there, such as `lost+found`. That directory is either empty or unreadable to the checking user, and both fail. A reviewer observed this on an ext4 volume with Git 2.47.3: the root held a root-owned `lost+found` with mode 0700, the check failed for a non-root user, and it passed once the directory was removed.
- An install whose files are meant to differ from their blobs fails check 6: Git LFS, line-ending conversion, `ident` and other content filters. Forge uses none.
- It accepts only 40-character SHA-1 commit IDs and only `https://github.com/` remotes.
