import {
  array,
  choice,
  invalid,
  object,
  text,
} from "./evidence-validation-primitives.ts";
import { parseGateCodexReviewPolicy } from "./gate-codex-policy.ts";
import type { GateCodexReviewPolicy } from "./gate-codex-policy.ts";
import type { GatePolicy } from "./gate-policy.ts";

/** Schema 2 currently configures one supported collector; ordered fallback is a separate operation. */
export const parseGateReviewAdapters = (
  value: unknown,
  evidence: GatePolicy["evidence"]
): GateCodexReviewPolicy | undefined => {
  const path = "gatePolicy.reviewAdapters";
  const entries = array(value, path);
  const seen = new Set<string>();
  const configured = entries.map((entry, index) => {
    const location = `${path}[${index}]`;
    const source = object(entry, location, [
      "adapter",
      "reviewer",
      "configuration",
    ]);
    const adapter = text(source.adapter, `${location}.adapter`);
    if (seen.has(adapter)) {
      invalid(`${location}.adapter`, "duplicate adapter");
    }
    seen.add(adapter);
    choice(adapter, `${location}.adapter`, ["codex-github"]);
    const config = object(source.configuration, `${location}.configuration`, [
      "botAccountId",
      "findingHistory",
      "independence",
    ]);
    choice(config.findingHistory, `${location}.configuration.findingHistory`, [
      "adapter-only",
      "supplied-global-ledger",
    ]);
    return parseGateCodexReviewPolicy(
      {
        ...config,
        findingHistory:
          config.findingHistory === "adapter-only"
            ? "codex-only"
            : config.findingHistory,
        reviewer: source.reviewer,
      },
      evidence,
      `${location}.configuration`,
      `${location}.reviewer`
    );
  });
  return configured[0];
};
