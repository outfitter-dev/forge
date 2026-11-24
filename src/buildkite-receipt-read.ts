export class CollectionStoppedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "CollectionStoppedError";
    this.reason = reason;
  }
}

export const stop = (reason: string): never => {
  throw new CollectionStoppedError(reason);
};
export const boundedBytes = async (response: Response, limit: number) => {
  const reader = response.body?.getReader();
  if (!reader) {
    return stop("read-unavailable");
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- Stream bounds must be checked before reading the next chunk.
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      length += value.byteLength;
      if (length > limit) {
        return stop("read-too-large");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => null);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};
