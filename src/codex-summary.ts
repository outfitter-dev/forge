import type {
  GitHubActor,
  GitHubIssueComment,
} from "./github-pull-request-types.ts";

const SUMMARY = "<!-- codex-pull-request-review-summary -->";
const STATE_MARKER = "<!-- codex-review-state:";
const SECTION_KEYS = [
  "commit_sha",
  "has_any_findings",
  "has_unresolved_findings",
  "status",
];
const STATE_KEYS = ["code_review", "security_review"];
const COMMIT = /^[\da-f]{40}$/u;

export interface CodexReviewSection {
  commitSha: string;
  hasAnyFindings: boolean;
  hasUnresolvedFindings: boolean;
  /** Observed provider state. Only completed can establish a clean candidate. */
  status: string;
}

export interface CodexSummaryState {
  codeReview: CodexReviewSection;
  /** Null represents the approved inactive all-null section. */
  securityReview: CodexReviewSection | null;
}

export type CodexSummaryReason =
  | "identity-invalid"
  | "summary-missing"
  | "summary-ambiguous"
  | "editor-unverified"
  | "marker-invalid"
  | "state-invalid";

export interface CodexSummaryObservation {
  status: "parsed" | "unavailable";
  reason: CodexSummaryReason | null;
  summary: GitHubIssueComment | null;
  state: CodexSummaryState | null;
  /** Requires subsequent head/base/time, thread, attestation and ledger qualification. */
  cleanCandidate: boolean;
  /** Retained even when parsing cannot establish a credible completed review. */
  reportedAdverse: boolean;
  adverseComments: GitHubIssueComment[];
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const exactKeys = (
  value: unknown,
  keys: string[]
): value is Record<string, unknown> =>
  object(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

const section = (value: unknown): CodexReviewSection | null => {
  if (
    !exactKeys(value, SECTION_KEYS) ||
    typeof value.commit_sha !== "string" ||
    !COMMIT.test(value.commit_sha) ||
    typeof value.has_any_findings !== "boolean" ||
    typeof value.has_unresolved_findings !== "boolean" ||
    typeof value.status !== "string" ||
    value.status === ""
  ) {
    return null;
  }
  return {
    commitSha: value.commit_sha,
    hasAnyFindings: value.has_any_findings,
    hasUnresolvedFindings: value.has_unresolved_findings,
    status: value.status,
  };
};

/** JSON.parse owns syntax. String tokens retain member occurrences before duplicate keys overwrite. */
const stateJson = (body: string) => {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return { keys: [] as string[], reportedAdverse: false, value: null };
  }
  const keys: string[] = [];
  let reportedAdverse = false;
  const whitespaceAfter = (start: number): number => {
    let index = start;
    while (index < body.length && /\s/u.test(body[index] ?? "")) {
      index += 1;
    }
    return index;
  };
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== '"') {
      continue;
    }
    const start = index;
    index += 1;
    while (index < body.length && body[index] !== '"') {
      index += body[index] === "\\" ? 2 : 1;
    }
    const colon = whitespaceAfter(index + 1);
    if (body[colon] !== ":") {
      continue;
    }
    const key = JSON.parse(body.slice(start, index + 1)) as string;
    keys.push(key);
    if (
      (key === "has_any_findings" || key === "has_unresolved_findings") &&
      body.startsWith("true", whitespaceAfter(colon + 1))
    ) {
      reportedAdverse = true;
    }
  }
  return { keys, reportedAdverse, value };
};

const blocks = (body: string) => {
  const found: (ReturnType<typeof stateJson> & { version: string })[] = [];
  let start = body.indexOf(STATE_MARKER);
  while (start !== -1) {
    const contentStart = start + STATE_MARKER.length;
    const end = body.indexOf("-->", contentStart);
    if (end === -1) {
      break;
    }
    const content = body.slice(contentStart, end);
    const separator = content.search(/\s/u);
    if (separator > 0) {
      found.push({
        ...stateJson(content.slice(separator)),
        version: content.slice(0, separator),
      });
    }
    start = body.indexOf(STATE_MARKER, end + 3);
  }
  return found;
};

const summaryState = (
  block: ReturnType<typeof stateJson>
): CodexSummaryState | null => {
  const state = block.value;
  if (
    !exactKeys(state, STATE_KEYS) ||
    !STATE_KEYS.every(
      (key) => block.keys.filter((item) => item === key).length === 1
    ) ||
    !SECTION_KEYS.every(
      (key) => block.keys.filter((item) => item === key).length === 2
    ) ||
    block.keys.length !== 10
  ) {
    return null;
  }
  const codeReview = section(state.code_review);
  const inactive =
    exactKeys(state.security_review, SECTION_KEYS) &&
    Object.values(state.security_review).every((value) => value === null);
  const securityReview = inactive ? null : section(state.security_review);
  if (!codeReview || (!inactive && !securityReview)) {
    return null;
  }
  return { codeReview, securityReview };
};

const bot = (actor: GitHubActor | null, accountId: number): boolean =>
  actor?.id === accountId && actor.type === "Bot";

/**
 * Parses the observed format without assigning a current head/base or a gate outcome.
 * The caller supplies the entire normalized comment list from trusted collection.
 */
export const parseCodexSummary = (
  comments: readonly GitHubIssueComment[],
  expectedBotAccountId: number
): CodexSummaryObservation => {
  const authored = comments.filter((comment) =>
    bot(comment.author, expectedBotAccountId)
  );
  const adverseComments = authored.filter((comment) =>
    blocks(comment.body).some((block) => block.reportedAdverse)
  );
  const result: CodexSummaryObservation = {
    adverseComments,
    cleanCandidate: false,
    reason: null,
    reportedAdverse: adverseComments.length > 0,
    state: null,
    status: "unavailable",
    summary: null,
  };
  const unavailable = (
    reason: CodexSummaryReason
  ): CodexSummaryObservation => ({ ...result, reason });
  if (!Number.isSafeInteger(expectedBotAccountId) || expectedBotAccountId < 1) {
    return unavailable("identity-invalid");
  }
  const summaries = authored.filter((comment) =>
    comment.body.startsWith(SUMMARY)
  );
  if (summaries.length === 0) {
    return unavailable("summary-missing");
  }
  if (
    summaries.length !== 1 ||
    new Set(comments.map((comment) => comment.id)).size !== comments.length ||
    new Set(comments.map((comment) => comment.nodeId)).size !== comments.length
  ) {
    return unavailable("summary-ambiguous");
  }
  const [summary] = summaries;
  if (!summary) {
    return unavailable("summary-missing");
  }
  result.summary = summary;
  if (!bot(summary.editor, expectedBotAccountId)) {
    return unavailable("editor-unverified");
  }
  const parsed = blocks(summary.body);
  const [block] = parsed;
  if (
    !block ||
    parsed.length !== 1 ||
    block.version !== "v1" ||
    summary.body.split("codex-review-state:").length !== 2 ||
    summary.body.split(SUMMARY).length !== 2
  ) {
    return unavailable("marker-invalid");
  }
  const state = summaryState(block);
  if (!state) {
    return unavailable("state-invalid");
  }
  return {
    ...result,
    cleanCandidate:
      state.codeReview.status === "completed" &&
      state.securityReview === null &&
      !result.reportedAdverse,
    state,
    status: "parsed",
  };
};
