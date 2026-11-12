# Review ledger store

`readReviewLedger(options)` and `replaceReviewLedger(options, expected, next)` keep one pull request's review-ledger entry in a file between collections (FOR-34). `parseReviewLedgerEntry(value)` is the strict check every entry passes on the way in and on the way out. All three are exported from `src/index.ts`. The store reads no clock, environment or network: the directory and the time come from the caller. Nothing calls it yet outside tests, and nothing here changes [`collectPullRequest`](pull-request-collection.md), `humanReviewEvidence`, the evaluator or `forge check`.

## What the entry holds and why it matters

GitHub forgets a review request once it is answered and never records the base an approval was given against. A collection therefore starts from a [`ReviewLedgerEntry`](../src/review-ledger.ts) and returns the next one:

| Field | Meaning |
| --- | --- |
| `requiredReviewers` | Everyone who was ever asked to review, keyed by kind and account or team ID. |
| `observedRevision` | The head and base GitHub served, and the read time of the collection that first saw them. `null` before the first collection. |
| `reviewBindings` | For each approval that was bound, by review ID: the head and base it counts against, the snapshot time that justified it, and when it was submitted. |

The entry decides whether an approval counts. An entry that drops a required reviewer, or that binds an approval to a base it was not given against, can let the `human-review` gate pass. The ledger rules and the collector trust the entry's shape, so a corrupted entry has to stop here.

## The caller's flow

```ts
import {
  collectPullRequest,
  readReviewLedger,
  replaceReviewLedger,
} from "./src/index.ts";

const location = { directory, pullRequest: 34, repository: "example/project" };

const entry = await readReviewLedger({ ...location, now });
const result = await collectPullRequest({ ...request, ledger: entry }, reads);
if (result.status === "collected") {
  const outcome = await replaceReviewLedger(location, entry, result.ledger);
  if (outcome === "conflict") {
    // Another collection stored an entry in between. Discard `result` and start again from the read.
  }
}
```

1. Read the stored entry. A pull request with no file has the empty entry (`emptyReviewLedgerEntry()`).
2. Collect, giving the collector that entry. No lock is held while GitHub is read, so a collection that is canceled or killed leaves nothing behind in the store.
3. If the collection is `collected`, replace the stored entry with the one it returned, passing the entry from step 1 as `expected`. For any other status, store nothing: the stored entry stays as it was.
4. On `"stored"`, the collection's evidence may be used. On `"conflict"`, discard the whole result and go back to step 1.

**Evidence from a collection whose ledger was not stored must not be used as if its bindings were recorded.** A collection binds an approval by writing the binding into the entry it returns, and it takes a new snapshot the same way. If that entry is not stored, the next collection starts without the binding and without the snapshot, and can come to a different answer for the same approval. Evidence that claims a bound approval is only as good as the stored entry that holds the binding. This applies to `"conflict"` and to every `ReviewLedgerError` from the replace.

**Why a lost update matters.** Two collections of one pull request can overlap. Both read the same entry; each returns its own next entry. If the second simply overwrote the first, a binding or a snapshot the first recorded would be gone: an approval already reported as bound would be unbound on the next collection, or a snapshot would be moved later, past an approval it should have preceded. The comparison with `expected` is what prevents this. The second collection is told `"conflict"` and must collect again from the entry the first one stored.

## `readReviewLedger`

`readReviewLedger({ directory, repository, pullRequest, now })` returns the stored entry in canonical form, as a new object on every call. It takes no lock and creates nothing, not even the directory. A replace renames a complete file into place, so a read that overlaps one sees the old entry or the new entry whole.

Only a missing file, or a missing directory, is the empty entry. A file that exists but cannot be read, is a symlink, a directory or another non-regular file, is not UTF-8 JSON, or fails `parseReviewLedgerEntry` throws `ReviewLedgerError`. It is never treated as empty: treating a corrupted ledger as empty would silently drop its requirements and bindings. Recovering it is a decision for a person.

### `now` and `entry-ahead-of-clock`

`now` is the time of the read as a whole-second UTC time, from a clock the caller trusts. An invalid `now` is `request-invalid` before anything is read. After the entry has passed the validator, each of its times is compared with `now`: the snapshot's `observedAt`, and every binding's `observedAt` and `submittedAt`. A time later than `now` throws `ReviewLedgerError` with the code `entry-ahead-of-clock`, and the message names the field. A time equal to `now` is accepted.

The entry's times are GitHub's: a snapshot carries the `Date` header of the response that served the pull request, and a binding carries GitHub's `submitted_at`. `now` is the caller's clock. So `entry-ahead-of-clock` means one of two things:

- **The machine's clock is behind GitHub's.** The entry is genuine, and the read succeeds once the clock catches up. Nothing needs repair.
- **The entry is corrupted or forged.** No collection can have recorded the future.

The store cannot tell these apart. **It is not a reason to delete the file.** Deleting it discards every requirement and binding of that pull request. Check the machine's clock first.

The check is only as good as `now`. A caller whose clock is too far ahead lets a future-dated record through, up to however far ahead it is. The check is made on reads only: `replaceReviewLedger` takes no `now`.

## `replaceReviewLedger`

`replaceReviewLedger({ directory, repository, pullRequest }, expected, next)` returns `"stored"` or `"conflict"`.

1. `expected` and `next` are both validated with `parseReviewLedgerEntry` before anything is touched. An invalid one throws `entry-invalid`, with the message starting `expected entry:` or `new entry:`.
2. The directory is created if it is missing, and the pull request's lock is taken.
3. The stored entry is read and validated; a missing file is the empty entry. A corrupted file throws as it does for a read and is not replaced.
4. The stored entry is compared with `expected`. If they are the same entry, `next` replaces the file and the result is `"stored"`. If they differ, nothing is written and the result is `"conflict"`.
5. The lock is released, whatever happened.

**The same entry** means deep equality of the two validated, canonical forms: the same reviewers by kind, ID and name, the same snapshot or none, and the same set of review IDs with the same binding under each. The order `expected` lists its reviewers or bindings in does not matter, and neither does object identity, so the entry `readReviewLedger` returned can be passed as it is. A file that was deleted since the read is a conflict with a non-empty `expected`.

`next` is validated for shape and internal consistency only. It is never compared with a clock and never refused for being ahead of one: it is what the collector just produced, stamped with GitHub's time, which can be later than any `now` the caller took before the collection. The stored entry is not compared with a clock here either.

## Validation rules

`parseReviewLedgerEntry(value)` returns a new entry in canonical form or throws `ReviewLedgerError` with `entry-invalid`. The message names a field path and what was expected, and never carries a value from the entry, an unknown field name included.

- The entry is a plain object with exactly `requiredReviewers`, `observedRevision` and `reviewBindings`. At every level an unknown, missing, symbol-keyed or non-enumerable field is refused, and so is anything that is not a plain object where one is expected.
- `requiredReviewers` is an array of `{ kind: "user", id, login }` or `{ kind: "team", id, slug }`. `id` is a positive safe integer and the name is a nonempty string. A kind and ID that appear twice are refused, not merged. The input may list them in any order; the result is sorted by kind and then ID.
- `observedRevision` is `null`, or exactly `{ headSha, baseSha, observedAt }`. A commit is 40 lowercase hexadecimal characters. A time is a whole-second UTC time such as `2026-01-01T00:00:00Z`: no fractional seconds, no offset, and a date that exists.
- `reviewBindings` is a plain object. Each key is a review ID as a canonical positive safe integer: no sign, leading zero, fraction or exponent. Each value is exactly `{ headSha, baseSha, observedAt, submittedAt }` with the same commit and time forms, and `observedAt` strictly earlier than `submittedAt`. The binding rule only ever binds to an earlier snapshot, so a binding that says otherwise was never made by it.

The validator compares no time with a clock. These rules establish the entry's shape and internal consistency. They do not establish who wrote it.

## Files

Each pull request has one entry file directly inside `directory`:

```text
<owner>+<name>+<number>.json     the entry
<owner>+<name>+<number>.lock     present while a replace runs
```

`outfitter-dev/forge` number 34 is `outfitter-dev+forge+34.json`. The name comes only from the validated repository and number:

- The repository must pass the same `owner/name` rule as evidence subjects: each part holds only letters, digits, `_`, `.` and `-`. A part that is `.` or `..` is refused as well. The number is a positive safe integer.
- The repository is lower-cased first, because GitHub does not tell names apart by case. `Owner/Repo` and `owner/repo` are one file.
- `+` cannot occur in an owner, a name or a number, so the three parts can always be read back from the name. Two different repositories or numbers never share a file: `a-b/c` is `a-b+c+…` and `a/b-c` is `a+b-c+…`. No part can hold a path separator, and the whole name is never `.` or `..`, so the file cannot be anywhere but directly inside `directory`.

A malformed directory, repository or number is refused with `request-invalid` before anything is read or created.

A replace creates the directory if it is missing, with every missing parent, for its owner only (`0700`). The entry and the lock are created for their owner only (`0600`). An existing directory is used as it is: its permissions and owner are not checked or changed. `directory` must be absolute and must not itself be a symlink, for a read as for a replace; its parent directories are the caller's responsibility and are not examined.

The entry is opened without following a symlink, so a symlink at the entry's name is refused (`ledger-unavailable`, typically with `ELOOP`), whether or not it points at anything.

## Writing

The new entry is written as one line of JSON to an exclusively created temporary file in the same directory, named `<entry file>.<random UUID>.tmp`, and that file is renamed over the entry. A reader therefore sees the whole old entry or the whole new one, and the old file is never written into. If writing or renaming fails, the temporary file is removed and the error is `ledger-unavailable`.

Nothing is flushed to the device. This is the same publication `forge check` uses for receipts, and like it, it makes no claim about what survives a crash of the machine.

## The lock

One replace at a time per pull request. A replace creates the lock file exclusively and removes it when it finishes, whatever the outcome. The lock is held only for the read, the comparison and the write: no network request and no caller code runs under it. If the lock file already exists, the replace throws `ReviewLedgerError` with code `ledger-busy` at once: it does not wait, retry or take the lock over. Anything at the lock's name counts, a symlink included, and nothing is created through one. Other pull requests are not affected, and reads are not either.

**A lock left behind blocks replaces of that pull request until someone removes it.** A process that is killed, or a machine that stops, in the moment between taking the lock and releasing it leaves `<directory>/<owner>+<name>+<number>.lock` in place, and every later replace of that pull request fails with `ledger-busy`. That moment is a few file operations long, so this takes a crash, not a canceled collection. The store cannot tell a stale lock from a live one, so it never clears one. To clear it:

1. Make sure no replace of that pull request is still running. Removing the lock under a live replace lets a second one in, and when the first finishes it removes the second's lock.
2. Delete `<owner>+<name>+<number>.lock` from the state directory. The `ledger-busy` message names the file.
3. Delete any `<owner>+<name>+<number>.json.*.tmp` beside it. A replace that stopped mid-write can leave one; it is never read.

The entry file itself needs no repair after a stale lock: it is the last entry that was fully published.

## Errors

Every refusal is a `ReviewLedgerError` with a fixed `code`.

| `code` | Meaning | What changed |
| --- | --- | --- |
| `request-invalid` | `directory`, `repository`, `pullRequest` or `now` is malformed. | Nothing was read or created. |
| `entry-invalid` | The stored entry (`stored entry: …`), `expected` (`expected entry: …`) or `next` (`new entry: …`) breaks a rule, or the file is not UTF-8 JSON. | The file is as it was. |
| `entry-ahead-of-clock` | Reads only. The stored entry is well formed but holds a time later than `now`: the clock is behind GitHub's, or the entry is corrupted or forged. | Nothing. Do not delete the file. |
| `ledger-busy` | Replaces only. The lock file exists: another replace is running, or a stale lock was left. | Nothing. |
| `ledger-unavailable` | The filesystem refused, or a path is not what it must be: an unreadable entry, a symlink, a state directory that is not a real directory, a failed write. The message carries the system's error name, such as `EACCES`. | The file is as it was. |

## What a caller must do

- **Choose the directory.** It must be outside any checkout and never inside a job workspace: proposed code must not be able to read or write it, and workspace cleanup must not delete it. A deleted entry is indistinguishable from a pull request that was never collected. Every collector of a repository must use the same directory, on a local filesystem of one host.
- **Pass a `now` it trusts** to each read, taken when it makes the read. See [`now` and `entry-ahead-of-clock`](#now-and-entry-ahead-of-clock) for what a clock that is behind or ahead does.
- **Give the collector the entry the read returned, and pass that same entry as `expected`.** Do not build or edit an entry by hand.
- **Persist only an entry the collector returned with `collected`.** A collection that failed, was canceled, changed underneath or was incomplete returns no ledger, and nothing may be stored for it.
- **Use a collection's evidence only after its ledger is `"stored"`.** On `"conflict"`, discard the result and start again from a fresh read. Bound the number of attempts; a pull request that keeps conflicting has several collectors running at once.
- **Treat every `ReviewLedgerError` as missing evidence.** No ledger means no recorded assignments, and the gate must stay blocked. Do not fall back to the empty entry, and do not retry `ledger-busy` in a tight loop.

## What it does not establish

- **Who wrote the file.** There is no signature and no authentication. Anyone who can write the directory can write an entry the validator accepts, replace an entry with an older valid copy of itself, or delete it so that the next read sees the empty entry. Protection is the directory's permissions and the caller's choice of location, nothing else.
- **Which pull request an entry belongs to.** The entry holds no repository or number, so a valid file copied or renamed to another pull request's name is read as that pull request's entry.
- **That `expected` was really read from the store.** A caller that passes the empty entry for a pull request with no file, or any entry equal to the stored one, replaces it. The comparison stops an accidental lost update, not a caller that fabricates its `expected`.
- **Confidentiality.** Nothing is encrypted. The entry holds reviewer logins, team slugs, account IDs and commit IDs.
- **Crash durability.** Nothing is flushed. After a machine crash the entry may be old, new, or damaged; a damaged one is refused, not repaired.
- **Locking beyond cooperating processes on one host.** The lock is a file that callers of this store honour. It does not stop a process that writes the file directly, it is not safe across hosts or on a network filesystem, and it is not held by the operating system, so it does not disappear when its holder dies.
- **Behaviour on Windows.** Owner-only modes and the refusal to follow a symlink rely on POSIX semantics and are tested on POSIX hosts only.

## Verification scope

`bun test tests/review-ledger-entry.test.ts tests/review-ledger-store.test.ts` exercises the validator and the store offline in temporary directories that the tests remove. That includes the whole flow with the real `collectPullRequest` over scripted reads, with a collection served later than the `now` of the read it started from, and replaces started together in one process. The mode assertions are skipped on Windows, and the unreadable-file case is also skipped for an administrator, who can read a file whatever its mode. Removal of the temporary file after a failed rename is exercised on macOS only, where an ordinary user can make a file that cannot be renamed over. No test covers a crash, replaces from separate processes or hosts, or a live collection.
