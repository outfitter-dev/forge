import { parseCodexSummary } from "./codex-summary.ts";
import type { FindingReport } from "./github-finding-observations.ts";

export interface FindingReportClassification {
  known: boolean;
  adverse: boolean;
}

/** A report's format never grants review eligibility or resolves an earlier finding. */
export const classifyFindingReport = (
  report: FindingReport,
  formats: readonly string[],
  accountId: number
): FindingReportClassification => {
  const adverseState = report.state === "CHANGES_REQUESTED";
  const { surface } = report;
  if (surface === "issue-comment" && formats.includes("codex-summary-v1")) {
    const parsed = parseCodexSummary(
      [
        {
          author: report.author,
          body: report.body,
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
    if (parsed.status === "parsed" || parsed.reportedAdverse) {
      return {
        adverse: adverseState || parsed.reportedAdverse,
        known:
          parsed.status === "parsed" &&
          report.body
            .replace("<!-- codex-pull-request-review-summary -->", "")
            .replace(/<!-- codex-review-state:v1[\s\S]*?-->/u, "")
            .trim() === "",
      };
    }
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
