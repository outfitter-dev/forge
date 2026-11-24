import { parseCodexSummary } from "./codex-summary.ts";
import type { FindingReport } from "./github-finding-observations.ts";

export interface FindingReportClassification {
  known: boolean;
  adverse: boolean;
}

const CODEX_SUMMARY = "<!-- codex-pull-request-review-summary -->";
const CODEX_STATE = "<!-- codex-review-state:";

/** Disjoint marker blocks keep parsing work proportional to the report length. */
const codexFindingReport = (
  report: FindingReport,
  accountId: number
): FindingReportClassification => {
  let start = report.body.indexOf(CODEX_STATE);
  let markerCount = 0;
  let adverse = report.state === "CHANGES_REQUESTED";
  let known = false;
  while (start !== -1) {
    const end = report.body.indexOf("-->", start + CODEX_STATE.length);
    if (end === -1) {
      return { adverse, known: false };
    }
    let nested = report.body.indexOf(CODEX_STATE, start + CODEX_STATE.length);
    // Nested markers make the envelope unsupported. Inspect the final bounded
    // block for a positive adverse claim without repeatedly parsing overlaps.
    while (nested !== -1 && nested < end) {
      markerCount += 1;
      start = nested;
      nested = report.body.indexOf(CODEX_STATE, start + CODEX_STATE.length);
    }
    markerCount += 1;
    const parsed = parseCodexSummary(
      [
        {
          author: report.author,
          body: `${CODEX_SUMMARY}\n${report.body.slice(start, end + 3)}`,
          editor: report.editor,
          id: 1,
          lastEditedAt: report.lastEditedAt,
          nativeRef: report.nativeRef,
          nodeId: report.nodeId,
          updatedAt: report.updatedAt,
        },
      ],
      accountId
    );
    adverse ||= parsed.reportedAdverse;
    known =
      parsed.status === "parsed" &&
      markerCount === 1 &&
      report.body.startsWith(CODEX_SUMMARY) &&
      report.body.slice(CODEX_SUMMARY.length, start).trim() === "" &&
      report.body.slice(end + 3).trim() === "";
    start = report.body.indexOf(CODEX_STATE, end + 3);
  }
  return { adverse, known };
};

/** A report's format never grants review eligibility or resolves an earlier finding. */
export const classifyFindingReport = (
  report: FindingReport,
  formats: readonly string[],
  accountId: number
): FindingReportClassification => {
  const adverseState = report.state === "CHANGES_REQUESTED";
  const { surface } = report;
  if (
    surface === "issue-comment" &&
    formats.includes("codex-summary-v1") &&
    (report.body.includes("<!-- codex-pull-request-review-summary") ||
      report.body.includes("<!-- codex-review-state"))
  ) {
    return codexFindingReport(report, accountId);
  }
  // A count without a finding map cannot account for each native report.
  // Badge prose has no qualified deterministic grammar yet.
  if (
    surface === "review" &&
    formats.includes("devin-review-v1") &&
    /^\*\*Devin Review\*\* found [1-9]\d* potential issues\./u.test(report.body)
  ) {
    return { adverse: true, known: false };
  }
  if (
    surface === "issue-comment" &&
    formats.includes("cursor-summary-v1") &&
    /^<h3>Bugbot couldn't run - usage limit reached<\/h3>\n\nBugbot is counted against Cursor usage for this user or team, and this run hit a usage or spend limit\.\n\nA user or team admin can review and increase usage limits in the \[Cursor dashboard\]\(https:\/\/www\.cursor\.com\/dashboard\/spending\)\.\n\n\(requestId: [\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\)\s*$/u.test(
      report.body
    )
  ) {
    return { adverse: adverseState, known: true };
  }
  if (
    surface === "issue-comment" &&
    formats.includes("linear-linkback-v1") &&
    /^<!-- linear-linkback -->\n<p><a href="https:\/\/linear\.app\/[a-zA-Z0-9-]+\/issue\/(?<issue>[A-Z][A-Z0-9]*-[1-9]\d*)">\k<issue><\/a><\/p>\s*$/u.test(
      report.body
    )
  ) {
    return { adverse: adverseState, known: true };
  }
  return { adverse: adverseState, known: false };
};
