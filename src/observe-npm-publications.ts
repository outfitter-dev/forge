import type {
  NpmEvidenceDecision,
  NpmEvidenceIO,
  NpmObservationPolicy,
  NpmObservationResult,
  NpmPublication,
} from "./npm-evidence-types.ts";
import {
  evaluateNpmEvidence,
  validNpmEvidencePolicy,
  validNpmPublication,
} from "./npm-evidence.ts";

const boundedInteger = (value: number, maximum: number): boolean =>
  Number.isSafeInteger(value) && value > 0 && value <= maximum;

const readTime = (io: NpmEvidenceIO): number => {
  try {
    return io.now();
  } catch {
    return Number.NaN;
  }
};

/** Abort also stops waiting on an adapter that ignores its signal; no adapter result is trusted afterward. */
const abortable = <T>(
  work: () => Promise<T>,
  signal: AbortSignal
): Promise<T> => {
  const { promise, reject, resolve } = Promise.withResolvers<T>();
  const abort = () => reject(new Error("observation aborted"));
  if (signal.aborted) {
    abort();
    return promise;
  }
  signal.addEventListener("abort", abort, { once: true });
  Promise.resolve()
    .then(() => {
      if (signal.aborted) {
        throw new Error("observation aborted");
      }
      return work();
    })
    .then(resolve)
    .finally(() => {
      signal.removeEventListener("abort", abort);
    })
    .catch(reject);
  return promise;
};

const validObservationInput = (
  input: NpmPublication[],
  policy: NpmObservationPolicy
): boolean =>
  Array.isArray(input) &&
  input.length > 0 &&
  input.length <= 100 &&
  [...input].every(validNpmPublication) &&
  new Set(input.map((item) => item.name)).size === input.length &&
  validNpmEvidencePolicy(policy) &&
  boundedInteger(policy.maxAttempts, 1000) &&
  boundedInteger(policy.timeoutMs, 900_000) &&
  boundedInteger(policy.initialDelayMs, policy.timeoutMs) &&
  boundedInteger(policy.maxDelayMs, policy.timeoutMs) &&
  policy.initialDelayMs <= policy.maxDelayMs;

/** Observe only: no publish callback, filesystem access, credentials or transport implementation. */
export const observeNpmPublications = async (
  input: NpmPublication[],
  inputPolicy: NpmObservationPolicy,
  io: NpmEvidenceIO,
  cancellation?: AbortSignal
): Promise<NpmObservationResult> => {
  const valid = validObservationInput(input, inputPolicy);
  // Capture the exact expectations before any asynchronous adapter can change caller-owned inputs.
  const publications = valid
    ? input.map(({ name, version, tag, integrity }) => ({
        integrity,
        name,
        tag,
        version,
      }))
    : [];
  const policy = valid
    ? {
        initialDelayMs: inputPolicy.initialDelayMs,
        maxAttempts: inputPolicy.maxAttempts,
        maxDelayMs: inputPolicy.maxDelayMs,
        provenancePredicateType: inputPolicy.provenancePredicateType,
        timeoutMs: inputPolicy.timeoutMs,
      }
    : null;
  let attempts = 0;
  let packages: NpmEvidenceDecision[] = [];
  const result = (
    stopped: NpmObservationResult["stopped"]
  ): NpmObservationResult => ({
    attempts,
    complete: stopped === "complete",
    packages,
    policy,
    provenanceVerification: "reference-only",
    publications,
    schemaVersion: 1,
    stopped,
  });
  if (!valid || policy === null) {
    return result("invalid-input");
  }
  const deadline = AbortSignal.timeout(policy.timeoutMs);
  const signal = cancellation
    ? AbortSignal.any([deadline, cancellation])
    : deadline;
  const stopped = () =>
    cancellation?.aborted ? ("aborted" as const) : ("deadline" as const);
  const started = readTime(io);
  let previous = started;
  const remaining = () => {
    const current = readTime(io);
    if (!Number.isFinite(current) || current < previous) {
      return Number.NaN;
    }
    previous = current;
    return policy.timeoutMs - (current - started);
  };
  if (!Number.isFinite(started)) {
    return result("invalid-input");
  }
  let delay = policy.initialDelayMs;
  while (attempts < policy.maxAttempts) {
    if (signal.aborted) {
      return result(stopped());
    }
    const budget = remaining();
    if (Number.isNaN(budget)) {
      return result("invalid-input");
    }
    if (budget <= 0) {
      return result("deadline");
    }
    attempts += 1;
    // oxlint-disable-next-line no-await-in-loop -- Each bounded round needs fresh registry observations.
    packages = await Promise.all(
      publications.map(async (publication) => {
        try {
          const observation = await abortable(
            () => io.read(publication.name, signal),
            signal
          );
          return evaluateNpmEvidence(publication, observation, policy);
        } catch {
          return {
            reasons: ["network"],
            state: "unavailable",
          } as NpmEvidenceDecision;
        }
      })
    );
    if (signal.aborted) {
      return result(stopped());
    }
    const afterRead = remaining();
    if (Number.isNaN(afterRead)) {
      return result("invalid-input");
    }
    if (afterRead <= 0) {
      return result("deadline");
    }
    if (
      packages.some((item) =>
        ["invalid", "conflict", "unavailable"].includes(item.state)
      )
    ) {
      return result("blocked");
    }
    if (packages.every((item) => item.state === "complete")) {
      return result("complete");
    }
    if (attempts === policy.maxAttempts) {
      return result("attempt-limit");
    }
    try {
      const waitMs = Math.min(delay, afterRead);
      // oxlint-disable-next-line no-await-in-loop -- Backoff must finish before the next observation round.
      await abortable(() => io.sleep(waitMs, signal), signal);
    } catch {
      return result(signal.aborted ? stopped() : "blocked");
    }
    delay = Math.min(delay * 2, policy.maxDelayMs);
  }
  return result("attempt-limit");
};
