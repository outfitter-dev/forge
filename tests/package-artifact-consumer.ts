import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  evaluatePackageArtifact,
  packageArtifactContractDigest,
} from "../src/index.ts";
import type {
  PackageArtifactContract,
  PackageConsumerEvidence,
  PackedPackageEvidence,
} from "../src/index.ts";
import { artifactSubject } from "./package-artifact-fixtures.ts";

const run = (cwd: string, args: string[]) =>
  Bun.spawnSync(
    [
      process.execPath,
      "--no-env-file",
      `--config=${path.join(cwd, "bunfig.toml")}`,
      ...args,
    ],
    {
      cwd,
      env: { NO_COLOR: "1", PATH: process.env.PATH ?? "" },
      stderr: "pipe",
      stdout: "pipe",
      timeout: 5000,
    }
  );

/** Fixture-only collector: operates solely on its own synthetic, regular-file package. Not an untrusted tar extractor. */
export const qualifyFixturePackage = async (
  contract: PackageArtifactContract,
  files: Record<string, string>,
  manifestChanges: Record<string, unknown> = {}
) => {
  const root = await mkdtemp(path.join(tmpdir(), "forge-artifact-"));
  const source = path.join(root, "product");
  const consumerRoot = path.join(root, "consumer");
  let cleanup: PackageConsumerEvidence["cleanup"] = "failed";
  let evidence: PackageConsumerEvidence | undefined;
  let pack: PackedPackageEvidence | undefined;
  let workspacePassed = false;
  try {
    await mkdir(source);
    await mkdir(consumerRoot);
    await writeFile(path.join(source, "bunfig.toml"), "");
    const manifest = {
      files: contract.allowedFiles.filter((file) => file !== "package.json"),
      name: contract.name,
      type: "module",
      version: contract.version,
      ...contract.entrypoints,
      ...manifestChanges,
    };
    await writeFile(
      path.join(source, "package.json"),
      JSON.stringify(manifest)
    );
    await Promise.all(
      Object.entries(files).map(async ([name, content]) => {
        // Test fixture paths are controlled by this suite, not supplied by a proposal.
        const target = path.join(source, name);
        await mkdir(path.join(target, ".."), { recursive: true });
        await writeFile(target, content);
      })
    );
    await writeFile(
      path.join(source, "workspace-probe.ts"),
      "import {value} from './index.js'; if(value!==42) throw Error('wrong value');"
    );
    workspacePassed = run(source, ["workspace-probe.ts"]).exitCode === 0;
    const packed = run(source, [
      "pm",
      "pack",
      "--ignore-scripts",
      "--filename",
      path.join(root, "artifact.tgz"),
    ]);
    if (packed.exitCode !== 0) {
      throw new Error("fixture packing failed");
    }
    const bytes = await readFile(path.join(root, "artifact.tgz"));
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    const entries = await new Bun.Archive(bytes).files();
    const manifestFile = entries.get("package/package.json");
    if (
      !manifestFile ||
      [...entries.keys()].some((name) => !name.startsWith("package/"))
    ) {
      throw new Error("unexpected fixture archive");
    }
    pack = {
      files: [...entries.keys()].map((name) => name.slice(8)),
      integrity,
      manifest: JSON.parse(await manifestFile.text()) as unknown,
    };
    const subject = { ...artifactSubject(), artifactIntegrity: integrity };
    const digest = packageArtifactContractDigest(contract);
    if (!digest) {
      throw new Error("invalid fixture contract");
    }
    await writeFile(
      path.join(consumerRoot, "package.json"),
      JSON.stringify({
        dependencies: { [contract.name]: "file:../artifact.tgz" },
        private: true,
        type: "module",
      })
    );
    await writeFile(path.join(consumerRoot, "bunfig.toml"), "");
    await writeFile(
      path.join(consumerRoot, "runtime.ts"),
      `import {value} from '${contract.name}'; if(value!==42) throw Error('wrong value');`
    );
    await writeFile(
      path.join(consumerRoot, "types.ts"),
      `import {value} from '${contract.name}'; const checked: number = value; void checked;`
    );
    await writeFile(
      path.join(consumerRoot, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "Preserve",
          moduleResolution: "Bundler",
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: "ESNext",
          types: [],
        },
        files: ["types.ts"],
      })
    );
    const installed = run(consumerRoot, [
      "install",
      "--offline",
      "--ignore-scripts",
      "--backend",
      "copyfile",
      "--cache-dir",
      path.join(root, "cache"),
      "--no-save",
    ]);
    if (installed.exitCode !== 0) {
      throw new Error(
        `fixture install failed: ${installed.stdout.toString()} ${installed.stderr.toString()}`
      );
    }
    const installedDirectory = await lstat(
      path.join(consumerRoot, "node_modules", contract.name)
    );
    if (installedDirectory.isSymbolicLink()) {
      throw new Error("fixture install unexpectedly linked workspace");
    }
    const runtime =
      installed.exitCode === 0 ? run(consumerRoot, ["runtime.ts"]).exitCode : 1;
    const types =
      installed.exitCode === 0
        ? run(consumerRoot, [
            "check",
            "--no-script",
            "--project",
            "tsconfig.json",
          ]).exitCode
        : 1;
    evidence = {
      ...subject,
      checks: [
        {
          id: "install",
          status: installed.exitCode === 0 ? "passed" : "failed",
        },
        { id: "import-root", status: runtime === 0 ? "passed" : "failed" },
        { id: "type-root", status: types === 0 ? "passed" : "failed" },
      ],
      cleanup: "failed",
      contractDigest: digest,
      isolation: "disposable-artifact-only",
      runtime: contract.runtime,
    };
  } finally {
    await rm(root, { force: true, recursive: true });
    cleanup = "complete";
  }
  if (!pack || !evidence) {
    throw new Error("fixture evidence missing");
  }
  evidence.cleanup = cleanup;
  return {
    decision: evaluatePackageArtifact(contract, evidence, pack, evidence),
    evidence,
    pack,
    root,
    workspacePassed,
  };
};
