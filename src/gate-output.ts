import type { GateDocument } from "./gate-document.ts";
import { legacyGateDocument } from "./legacy-gate-document.ts";
import type { LegacyGateDocument } from "./legacy-gate-document.ts";

export type GateOutputDocument = GateDocument | LegacyGateDocument;

/** Invalid selections fall back to the established envelope so argument errors remain readable. */
export const gateOutputVersion = (args: string[]): 1 | 2 => {
  const selections = args.flatMap((value, index) =>
    value === "--output-version" ? [args[index + 1]] : []
  );
  return selections.length === 1 && selections[0] === "2" ? 2 : 1;
};

/** Representation changes neither the evaluator's facts nor the command's outcome. */
export const gateOutputDocument = (
  document: GateDocument,
  version: 1 | 2
): GateOutputDocument =>
  version === 1 ? legacyGateDocument(document) : document;
