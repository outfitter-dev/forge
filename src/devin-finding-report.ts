import type { FindingReportClassification } from "./configured-finding-classification.ts";
import type { FindingReport } from "./github-finding-observations.ts";

const COUNT =
  /^\*\*Devin Review\*\* found (?<count>[1-9]\d*) potential issues\.\n\n/u;
const ADVERSE = /^\*\*Devin Review\*\* found [1-9]\d* potential issues\./u;

const reviewPath = (nativeRef: string): string | null => {
  try {
    const url = new URL(nativeRef);
    if (
      url.origin === "https://github.com" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      /^\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*$/u.test(url.pathname) &&
      /^#pullrequestreview-[1-9]\d*$/u.test(url.hash)
    ) {
      return url.pathname;
    }
  } catch {
    return null;
  }
  return null;
};

/** The qualified count/badge envelope identifies an adverse report, never its finding set. */
export const classifyDevinFindingReport = (
  report: FindingReport
): FindingReportClassification => {
  const adverse =
    report.state === "CHANGES_REQUESTED" || ADVERSE.test(report.body);
  const matched = COUNT.exec(report.body);
  const count = Number(matched?.groups?.count);
  const path = reviewPath(report.nativeRef);
  if (matched === null || path === null || !Number.isSafeInteger(count)) {
    return { adverse, known: false };
  }
  const expected = `${matched[0]}<!-- devin-review-badge-begin -->\n<a href="https://app.devin.ai/review${path}" target="_blank"><picture><source media="(prefers-color-scheme: dark)" srcset="https://static.devin.ai/assets/gh-devin-review-dark.svg?v=4"><img src="https://static.devin.ai/assets/gh-devin-review-light.svg?v=4" alt="Devin Review"></picture></a>\n<!-- devin-review-badge-end -->`;
  return { adverse, known: report.body.trimEnd() === expected };
};
