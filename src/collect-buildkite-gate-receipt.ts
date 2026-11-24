import { realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { readBuildkiteProjectCapture } from "./buildkite-capture-store.ts";
import { buildkiteUuid } from "./buildkite-job.ts";
import { collectBuildkiteReceipt } from "./collect-buildkite-receipt.ts";
import type { CollectionInput } from "./collect-buildkite-receipt.ts";

export type GateReceiptCollectionInput = Omit<CollectionInput, "capture"> & {
  /** Authenticated capture records delivered under trusted host custody. */
  captureRoot: string;
  /** Existing private host-owned directory outside proposed workspaces. */
  outputRoot: string;
};

/**
 * Connects the protected capture store to authenticated collection and the
 * existing gate file input. Host custody authenticates both selected roots.
 */
export const collectBuildkiteGateReceipt = async (
  input: GateReceiptCollectionInput
) => {
  try {
    if (
      !path.isAbsolute(input.captureRoot) ||
      !path.isAbsolute(input.outputRoot) ||
      !buildkiteUuid(input.admission.jobId)
    ) {
      return { reason: "input-invalid", status: "withheld" } as const;
    }
    const output = await realpath(input.outputRoot);
    const info = await stat(output);
    if (
      !info.isDirectory() ||
      info.uid !== process.getuid?.() ||
      // oxlint-disable-next-line no-bitwise -- POSIX directory permission bits.
      (info.mode & 0o077) !== 0
    ) {
      return { reason: "output-unavailable", status: "withheld" } as const;
    }
    const capture = await readBuildkiteProjectCapture(
      input.captureRoot,
      input.admission.jobId
    );
    if (!capture) {
      return { reason: "capture-unavailable", status: "withheld" } as const;
    }
    const collection = await collectBuildkiteReceipt({ ...input, capture });
    if (!collection.collected) {
      return { reason: collection.reason, status: "withheld" } as const;
    }
    if (!collection.receipt) {
      return {
        reason: "receipt-unqualified",
        status: "withheld",
        verification: collection.verification,
      } as const;
    }
    // A job gets one immutable handoff. Exclusive creation refuses reuse so
    // an earlier path can never silently change under gate.
    const receiptFile = path.join(
      output,
      `${input.admission.jobId}.receipt.json`
    );
    await writeFile(receiptFile, collection.receipt, {
      flag: "wx",
      mode: 0o600,
    });
    return {
      artifactId: collection.artifactId,
      capture,
      receiptFile,
      status: "ready",
    } as const;
  } catch {
    return { reason: "output-unavailable", status: "withheld" } as const;
  }
};
