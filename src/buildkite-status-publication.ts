import { fullCommit } from "./buildkite-job.ts";
import { previewBuildkiteStatusRefresh } from "./buildkite-status-refresh.ts";
import type { GateStatusDocument } from "./buildkite-status-refresh.ts";
import type { GitHubPullRequest } from "./github-pull-request-types.ts";

export interface BuildkiteStatusWrite {
  repository: string;
  head: string;
  context: string;
  state: "pending" | "success" | "failure";
  description: string;
  targetUrl: string;
}

export interface BuildkiteStatusTransport {
  /** Complete authenticated list of open PRs for this repository and head. */
  pullRequests: () => Promise<GitHubPullRequest[] | null>;
  /** Latest status from the approved producer for this repository/head/context. */
  latest: () => Promise<BuildkiteStatusWrite | null>;
  /** Resolve only after the service confirms the write. A throw is ambiguous. */
  write: (status: BuildkiteStatusWrite) => Promise<void>;
}

type PublicationResult =
  | { status: "published"; state: "success" | "failure"; runId: string }
  | {
      status: "withheld";
      reason:
        | "invalid-input"
        | "subject-unavailable"
        | "subject-ambiguous"
        | "superseded"
        | "gate-unavailable"
        | "gate-mismatch"
        | "revision-changed"
        | "admission-refused"
        | "delivery-unknown"
        | "publisher-stopped";
      /** Readback observed this exact write after an ambiguous transport result. */
      observed?: boolean;
      readback?:
        | { status: "read"; latest: BuildkiteStatusWrite | null }
        | { status: "unavailable" };
    };

const sameWrite = (
  left: BuildkiteStatusWrite | null,
  right: BuildkiteStatusWrite
) =>
  left !== null &&
  left.repository === right.repository &&
  left.head === right.head &&
  left.context === right.context &&
  left.state === right.state &&
  left.description === right.description &&
  left.targetUrl === right.targetUrl;

/**
 * One exclusive host owner creates one publisher per repository/head/context.
 * This serializes this instance's writes only. Host custody and durable restart
 * reconciliation must be qualified before a live adapter can adopt it.
 */
export const createBuildkiteStatusPublication = ({
  repository,
  head,
  context,
  holdLabel,
  transport,
}: {
  repository: string;
  head: string;
  context: string;
  holdLabel: string;
  transport: BuildkiteStatusTransport;
}) => {
  let newest = 0;
  let stopped = false;
  let writes: Promise<unknown> = Promise.resolve();
  const identifiers = new Set<string>();
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const next = writes.then(work);
    writes = next.catch(() => null);
    return next;
  };
  const write = async (
    value: BuildkiteStatusWrite
  ): Promise<PublicationResult | null> => {
    try {
      await transport.write(value);
      return null;
    } catch {
      // Even matching readback does not prove a timed-out server request ended.
      // Freeze before reading so no queued refresh can send another write.
      stopped = true;
      let readback: NonNullable<
        Extract<PublicationResult, { status: "withheld" }>["readback"]
      > = { status: "unavailable" };
      try {
        readback = { latest: await transport.latest(), status: "read" };
      } catch {
        // Unreadable delivery remains unknown.
      }
      return {
        observed:
          readback.status === "read" && sameWrite(readback.latest, value),
        readback,
        reason: "delivery-unknown",
        status: "withheld",
      };
    }
  };
  const read = async () => {
    try {
      return await transport.pullRequests();
    } catch {
      return null;
    }
  };
  const subject = (pulls: GitHubPullRequest[] | null, pullRequest: number) => {
    if (pulls === null) {
      return { reason: "subject-unavailable", status: "withheld" } as const;
    }
    if (pulls.length !== 1) {
      return { reason: "subject-ambiguous", status: "withheld" } as const;
    }
    const [pull] = pulls;
    if (
      !pull ||
      pull.number !== pullRequest ||
      pull.state !== "open" ||
      pull.merged ||
      pull.head.sha !== head ||
      pull.base.repositoryName.toLowerCase() !== repository.toLowerCase() ||
      pull.head.repositoryId !== pull.base.repositoryId ||
      !fullCommit(pull.base.sha)
    ) {
      return { reason: "admission-refused", status: "withheld" } as const;
    }
    return { pull };
  };
  return {
    /** A trusted caller supplies a unique evaluation ID and its qualified gate. */
    async refresh({
      pullRequest,
      runId,
      targetUrl,
      evaluate,
    }: {
      pullRequest: number;
      runId: string;
      targetUrl: string;
      evaluate: (
        admitted: GitHubPullRequest
      ) => Promise<GateStatusDocument | null>;
    }): Promise<PublicationResult> {
      if (
        !/^[\w.-]+\/[\w.-]+$/u.test(repository) ||
        !fullCommit(head) ||
        !/^[!-~]{1,100}$/u.test(context) ||
        !holdLabel.trim() ||
        !Number.isSafeInteger(pullRequest) ||
        pullRequest <= 0 ||
        !/^[\w-]{1,64}$/u.test(runId) ||
        identifiers.has(runId) ||
        !/^https:\/\/[^\s]+$/u.test(targetUrl)
      ) {
        return { reason: "invalid-input", status: "withheld" };
      }
      identifiers.add(runId);
      newest += 1;
      const generation = newest;
      const status = (
        state: BuildkiteStatusWrite["state"]
      ): BuildkiteStatusWrite => ({
        context,
        description: `Forge ${runId}: ${state}`,
        head,
        repository,
        state,
        targetUrl,
      });
      const admitted = await exclusive(async () => {
        if (stopped) {
          return { reason: "publisher-stopped", status: "withheld" } as const;
        }
        if (generation !== newest) {
          return { reason: "superseded", status: "withheld" } as const;
        }
        // Invalidate a previous success before collecting a new answer, even
        // when the next subject read is unavailable or finds shared heads.
        const delivery = await write(status("pending"));
        if (delivery) {
          return delivery;
        }
        return subject(await read(), pullRequest);
      });
      if (!("pull" in admitted) || !admitted.pull) {
        return admitted;
      }
      const before = admitted.pull;
      let gate: GateStatusDocument | null = null;
      try {
        gate = await evaluate(before);
      } catch {
        // The confirmed pending status remains the service's latest answer.
      }
      return exclusive(async () => {
        if (stopped) {
          return { reason: "publisher-stopped", status: "withheld" };
        }
        if (generation !== newest) {
          return { reason: "superseded", status: "withheld" };
        }
        const current = subject(await read(), pullRequest);
        if (!("pull" in current) || !current.pull) {
          return current;
        }
        if (generation !== newest) {
          return { reason: "superseded", status: "withheld" };
        }
        const preview = previewBuildkiteStatusRefresh({
          admitted: before,
          current: current.pull,
          gate,
          policy: { holdLabel, repository },
          runId,
          target: { pullRequest, repository },
        });
        if (preview.status === "withheld") {
          return preview;
        }
        const state = preview.eligible ? "success" : "failure";
        return (
          (await write(status(state))) ?? { runId, state, status: "published" }
        );
      });
    },
  };
};
