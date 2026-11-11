/** Local observations, never authenticated proof or permission to reuse a check. */
export interface ProjectConfig {
  schemaVersion: 1;
  repository: string;
  check: { id: string; command: string[] };
}

export interface CheckSource {
  head: string;
  tree: string;
  base: string | null;
  mergeBase: string | null;
  worktreeDigest: string;
  indexDigest: string;
  dirty: boolean;
  untracked: number;
  coverage: "tracked-and-nonignored-untracked";
}

export interface CheckReceipt {
  schemaVersion: 1;
  kind: "forge-check";
  receiptId: string;
  recording: { state: "persisted" | "failed"; path: string | null };
  repository: string | null;
  check: { id: string; commandDigest: string } | null;
  configBefore: string | null;
  configAfter: string | null;
  sourceBefore: CheckSource | null;
  sourceAfter: CheckSource | null;
  runtime: { bun: string; platform: string; arch: string };
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  admission: "not-started" | "started" | "unknown";
  completion: "observed" | "unknown";
  outcome: "passed" | "failed" | "canceled" | "not-run" | "unknown";
  exitCode: number | null;
  signal: string | null;
  cancellation: "SIGINT" | "SIGTERM" | null;
  evidence: "stable" | "changed" | "unknown";
  diagnostic: string;
  cause: "unclassified";
}
