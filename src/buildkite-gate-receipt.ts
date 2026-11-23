import {
  BUILDKITE_MAX_RECEIPT_BYTES,
  verifyBuildkiteProjectReceipt,
} from "./buildkite-project-receipt.ts";

/**
 * Keeps only exact captured bytes that yielded passing verification evidence.
 * A bound observation with empty checks must never reach gate's raw-receipt
 * input. The returned copy is independent of the artifact buffer supplied by
 * the collector. Authentication and protected file custody belong to the host.
 */
export const qualifyBuildkiteGateReceipt = (
  input: Parameters<typeof verifyBuildkiteProjectReceipt>[0]
) => {
  const bytes =
    input.bytes && input.bytes.byteLength <= BUILDKITE_MAX_RECEIPT_BYTES
      ? new Uint8Array(input.bytes)
      : null;
  const verification = verifyBuildkiteProjectReceipt({ ...input, bytes });
  return {
    receipt:
      verification.verified && verification.checks.length > 0 ? bytes : null,
    verification,
  };
};
