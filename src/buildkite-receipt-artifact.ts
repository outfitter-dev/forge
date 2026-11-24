import { buildkiteUuid } from "./buildkite-job.ts";
import { BUILDKITE_MAX_RECEIPT_BYTES } from "./buildkite-project-receipt.ts";
import { boundedBytes, stop } from "./buildkite-receipt-read.ts";
import { isRecord } from "./github-response.ts";

const MAX_ARTIFACT_PAGES = 10;
type ApiRead = (
  url: string,
  redirect?: "error" | "manual"
) => Promise<Response>;

export const selectReceiptArtifact = async (
  json: (url: string) => Promise<{ next: boolean; value: unknown }>,
  artifactRoot: string,
  jobId: string,
  artifactPath: string
) => {
  const matches: Record<string, unknown>[] = [];
  for (let page = 1; page <= MAX_ARTIFACT_PAGES; page += 1) {
    // oxlint-disable-next-line no-await-in-loop -- The next page is needed only after a full preceding page.
    const { next, value: artifacts } = await json(
      `${artifactRoot}?per_page=100&page=${page}`
    );
    if (
      !Array.isArray(artifacts) ||
      artifacts.length > 100 ||
      artifacts.some((artifact) => !isRecord(artifact))
    ) {
      return stop("artifact-list-invalid");
    }
    for (const artifact of artifacts) {
      if (artifact.path === artifactPath) {
        matches.push(artifact);
      }
    }
    if (!next) {
      break;
    }
    if (page === MAX_ARTIFACT_PAGES) {
      return stop("artifact-page-limit");
    }
  }
  const [artifact] = matches;
  if (
    matches.length !== 1 ||
    !artifact ||
    !buildkiteUuid(artifact.id) ||
    artifact.job_id !== jobId ||
    artifact.state !== "finished" ||
    typeof artifact.file_size !== "number" ||
    artifact.file_size < 1 ||
    artifact.file_size > BUILDKITE_MAX_RECEIPT_BYTES
  ) {
    return stop("artifact-mismatch");
  }
  return { file_size: artifact.file_size, id: artifact.id };
};

export const downloadReceiptArtifact = async (
  api: ApiRead,
  request: typeof fetch,
  artifactRoot: string,
  artifact: { id: string; file_size: number },
  artifactOrigins: string[]
) => {
  // Derive the API URL instead of trusting artifact metadata URL fields.
  const download = await api(
    `${artifactRoot}/${artifact.id}/download`,
    "manual"
  );
  if (download.status !== 302 || download.redirected) {
    return stop("artifact-download-unavailable");
  }
  const location = download.headers.get("Location");
  await download.body?.cancel();
  const storage = new URL(location ?? "");
  if (
    storage.protocol !== "https:" ||
    storage.username ||
    storage.password ||
    !artifactOrigins.includes(storage.origin)
  ) {
    return stop("artifact-origin-denied");
  }
  const response = await request(storage, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 200 || response.redirected) {
    return stop("artifact-download-unavailable");
  }
  const bytes = await boundedBytes(response, BUILDKITE_MAX_RECEIPT_BYTES);
  if (bytes.byteLength !== artifact.file_size) {
    return stop("artifact-size-mismatch");
  }
  return bytes;
};
