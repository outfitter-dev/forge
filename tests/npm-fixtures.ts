import type {
  NpmObservationPolicy,
  NpmPublication,
  NpmRegistryRead,
} from "../src/index.ts";

export const publication = (name = "@example/core"): NpmPublication => ({
  integrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}`,
  name,
  tag: "latest",
  version: "1.2.3",
});

export const npmPolicy = (): NpmObservationPolicy => ({
  initialDelayMs: 3000,
  maxAttempts: 20,
  maxDelayMs: 30_000,
  provenancePredicateType: "https://slsa.dev/provenance/v1",
  timeoutMs: 900_000,
});

export const metadata = (
  expected = publication()
): {
  "dist-tags": Record<string, string>;
  name: string;
  versions: Record<
    string,
    {
      name: string;
      version: string;
      dist: {
        integrity: string;
        attestations: { provenance: { predicateType: string } };
      };
    }
  >;
} => ({
  "dist-tags": { [expected.tag]: expected.version },
  name: expected.name,
  versions: {
    [expected.version]: {
      dist: {
        attestations: {
          provenance: { predicateType: npmPolicy().provenancePredicateType },
        },
        integrity: expected.integrity,
      },
      name: expected.name,
      version: expected.version,
    },
  },
});

export const found = (expected = publication()): NpmRegistryRead => ({
  document: metadata(expected),
  status: "found",
});

export const fixtureDist = (document: ReturnType<typeof metadata>) => {
  const version = document.versions["1.2.3"];
  if (!version) {
    throw new Error("fixture version missing");
  }
  return version.dist;
};
