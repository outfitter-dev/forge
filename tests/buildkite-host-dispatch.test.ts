import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { exportJWK, generateKeyPair, SignJWT } from "jose";

import {
  buildkiteHostDispatch,
  runCommand,
} from "../src/buildkite-host-dispatch.ts";
import { buildkitePipeline } from "../src/buildkite-pipeline.ts";

const organizationId = "10000000-0000-4000-8000-000000000001";
const pipelineId = "10000000-0000-4000-8000-000000000002";
const queueId = "10000000-0000-4000-8000-000000000003";
const buildId = "10000000-0000-4000-8000-000000000004";
const jobId = "10000000-0000-4000-8000-000000000005";
const otherId = "10000000-0000-4000-8000-000000000006";
const installCommit = "a".repeat(40);
const commit = "b".repeat(40);
const base = "c".repeat(40);
const repository = "example/forge";
const repositoryUrl = `https://github.com/${repository}.git`;
const issuer = "https://agent.buildkite.com";
const audience = "forge-buildkite-bootstrap";
const buildUrl =
  "https://api.buildkite.com/v2/organizations/example/pipelines/forge/builds/7";
const pipeline = JSON.stringify(
  buildkitePipeline([
    "--project-queue",
    "project",
    "--trusted-queue",
    "trusted",
    "--head",
    commit,
    "--base",
    base,
  ])
);
const jobEnvironment = {
  BUILDKITE_AGENT_ACCESS_TOKEN: "fixture-job-token",
  BUILDKITE_JOB_ID: jobId,
  FORGE_BUILDKITE_READ_TOKEN: "fixture-build-read-token",
  FORGE_GITHUB_TOKEN: "fixture-github-read-token",
};
const claims = {
  build_commit: commit,
  build_id: buildId,
  build_number: 7,
  build_source: "webhook",
  job_id: jobId,
  organization_id: organizationId,
  organization_slug: "example",
  pipeline_id: pipelineId,
  pipeline_slug: "forge",
  queue_id: queueId,
  queue_key: "trusted",
  runner_environment: "self-hosted",
  step_key: "forge-bootstrap",
};
const runningJob = {
  cluster_queue_id: queueId,
  id: jobId,
  state: "running",
  step_key: "forge-bootstrap",
  type: "script",
};
const build = {
  commit,
  id: buildId,
  jobs: [runningJob],
  number: 7,
  pipeline: { id: pipelineId, repository: repositoryUrl, slug: "forge" },
  pull_request: { id: "42", repository: repositoryUrl },
  source: "webhook",
  state: "running",
};

let root: string;
let host: string;
let install: string;
let config: string;
let policy: Record<"agent" | "bun" | "verifier", string> &
  Record<string, string>;
const signing = await generateKeyPair("RS256");
const wrongSigning = await generateKeyPair("RS256");
const jwk = {
  ...(await exportJWK(signing.publicKey)),
  alg: "RS256",
  kid: "fixture-key",
};

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "forge-dispatch-"));
  host = path.join(root, "host");
  install = path.join(root, "install");
  await Promise.all([mkdir(host), mkdir(install)]);
  config = path.join(host, "config.json");
  const [agent, bun, verifier] = ["buildkite-agent", "bun", "verify"].map(
    (name) => path.join(host, name)
  ) as [string, string, string];
  policy = {
    agent,
    bun,
    install,
    installCommit,
    organizationId,
    organizationSlug: "example",
    pipelineId,
    pipelineSlug: "forge",
    projectQueue: "project",
    queueId,
    repository,
    trustedQueue: "trusted",
    verifier,
  };
  await Promise.all([
    Bun.write(config, JSON.stringify(policy)),
    ...[agent, bun, verifier].map((file) => Bun.write(file, "fixture")),
  ]);
});

afterAll(async () => {
  await rm(root, { force: true, recursive: true });
});

const signedJob = (
  override: Record<string, unknown> = {},
  wrongKey = false
) => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    ...claims,
    aud: audience,
    exp: now + 120,
    iat: now,
    iss: issuer,
    nbf: now,
    ...override,
  })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .sign(wrongKey ? wrongSigning.privateKey : signing.privateKey);
};

type Command = Parameters<
  NonNullable<Parameters<typeof buildkiteHostDispatch>[2]>
>[0];

const fixture = (
  token: string,
  response: () => Response = () => Response.json(build),
  failAt?: number,
  graph = pipeline
) => {
  const calls: Command[] = [];
  const reads: string[] = [];
  const command = (invocation: Command): Promise<string> => {
    calls.push(invocation);
    if (calls.length === failAt) {
      return Promise.reject(new Error("private service diagnostic"));
    }
    return Promise.resolve(
      ["verifier output", token, graph, "upload output"][calls.length - 1] ?? ""
    );
  };
  const request = ((input: string | URL | Request, options?: RequestInit) => {
    const url = input.toString();
    reads.push(url);
    expect(options?.redirect).toBe("error");
    if (url === `${issuer}/.well-known/jwks`) {
      expect(new Headers(options?.headers).has("Authorization")).toBe(false);
      return Promise.resolve(Response.json({ keys: [jwk] }));
    }
    expect(url).toBe(buildUrl);
    expect(new Headers(options?.headers).get("Authorization")).toBe(
      `Bearer ${jobEnvironment.FORGE_BUILDKITE_READ_TOKEN}`
    );
    return Promise.resolve(response());
  }) as typeof fetch;
  return { calls, command, reads, request };
};

test("verifies the install before fixed dispatch and only uploads to the signed job", async () => {
  const { calls, command, request, reads } = fixture(await signedJob());
  expect(
    await buildkiteHostDispatch(
      [config],
      {
        ...jobEnvironment,
        BASH_ENV: "/job/proposal",
        BUILDKITE_AGENT_ENDPOINT: "https://untrusted.invalid",
        BUILDKITE_COMMAND: "unapproved command",
        BUILDKITE_COMMIT: "fake",
        BUILDKITE_PULL_REQUEST: "99",
        FORGE_BUILDKITE_TASK: "gate",
        PATH: "/job/proposal",
      },
      command,
      request
    )
  ).toBeNull();
  const env = { HOME: host, PATH: `${host}:/usr/bin:/bin` };
  const agentEnv = {
    ...env,
    BUILDKITE_AGENT_ACCESS_TOKEN: jobEnvironment.BUILDKITE_AGENT_ACCESS_TOKEN,
    BUILDKITE_JOB_ID: jobId,
  };
  expect(calls).toEqual([
    {
      argv: [
        "/bin/bash",
        policy.verifier,
        "--install",
        install,
        "--repository",
        repository,
        "--commit",
        installCommit,
      ],
      cwd: host,
      env,
    },
    {
      argv: [
        policy.agent,
        "oidc",
        "request-token",
        "--audience",
        audience,
        "--claim",
        "queue_id,queue_key",
        "--lifetime",
        "120",
        "--skip-redaction",
      ],
      cwd: host,
      env: agentEnv,
    },
    {
      argv: [
        policy.bun,
        "--no-env-file",
        "--no-install",
        "src/forge-cli.ts",
        "buildkite",
        "bootstrap",
        "--repository",
        repository,
        "--pull-request",
        "42",
        "--commit",
        commit,
        "--project-queue",
        "project",
        "--trusted-queue",
        "trusted",
      ],
      cwd: install,
      env: { ...env, FORGE_GITHUB_TOKEN: jobEnvironment.FORGE_GITHUB_TOKEN },
    },
    {
      argv: [
        policy.agent,
        "pipeline",
        "upload",
        "--no-interpolation",
        "--reject-parse-warnings",
      ],
      cwd: host,
      env: agentEnv,
      input: pipeline,
    },
  ]);
  expect(reads).toEqual([`${issuer}/.well-known/jwks`, buildUrl]);
});

test.each([
  ["another organization", { organization_id: otherId }],
  ["another pipeline", { pipeline_id: otherId }],
  ["another job", { job_id: otherId }],
  ["another queue", { queue_id: otherId }],
  ["a different queue name", { queue_key: "project" }],
  ["the check step", { step_key: "forge-check" }],
  ["a hosted runner", { runner_environment: "buildkite-hosted" }],
  ["a manual run", { build_source: "ui" }],
  ["an expired token", { exp: 1 }],
  ["a wrong issuer", { iss: "https://untrusted.invalid" }],
  ["a wrong audience", { aud: "something-else" }],
  ["an unpinned build commit", { build_commit: "HEAD" }],
] as const)(
  "refuses %s before reading the build or running Forge",
  async (_label, override) => {
    const { calls, command, request, reads } = fixture(
      await signedJob(override)
    );
    expect(
      await buildkiteHostDispatch([config], jobEnvironment, command, request)
    ).toBe("Forge could not authenticate the Buildkite bootstrap job.");
    expect(calls).toHaveLength(2);
    expect(reads).not.toContain(buildUrl);
  }
);

test("matches a legacy GitHub repository URL as identity without using its transport", async () => {
  const { calls, command, request, reads } = fixture(await signedJob(), () =>
    Response.json({
      ...build,
      pull_request: {
        ...build.pull_request,
        repository: `git://github.com/${repository}.git`,
      },
    })
  );
  expect(
    await buildkiteHostDispatch([config], jobEnvironment, command, request)
  ).toBeNull();
  expect(calls).toHaveLength(4);
  expect(reads).toEqual([`${issuer}/.well-known/jwks`, buildUrl]);
});

test("does not trust a signed payload with the wrong key", async () => {
  const { calls, command, request, reads } = fixture(await signedJob({}, true));
  expect(
    await buildkiteHostDispatch([config], jobEnvironment, command, request)
  ).toBe("Forge could not authenticate the Buildkite bootstrap job.");
  expect(calls).toHaveLength(2);
  expect(reads).toEqual([`${issuer}/.well-known/jwks`]);
});

test.each([
  ["build UUID mismatch", { id: otherId }],
  ["commit mismatch", { commit: base }],
  [
    "pipeline repository mismatch",
    {
      pipeline: {
        ...build.pipeline,
        repository: "https://github.com/other/forge",
      },
    },
  ],
  ["no matching job", { jobs: [{ ...runningJob, id: otherId }] }],
  ["a canceled job", { jobs: [{ ...runningJob, state: "canceled" }] }],
  ["missing PR metadata", { pull_request: {} }],
  [
    "a fork",
    {
      pull_request: {
        ...build.pull_request,
        repository: "https://github.com/fork/forge",
      },
    },
  ],
  ["invalid PR number", { pull_request: { ...build.pull_request, id: "0" } }],
] as const)(
  "refuses %s in the Buildkite response",
  async (_label, override) => {
    const { calls, command, request } = fixture(await signedJob(), () =>
      Response.json({ ...build, ...override })
    );
    expect(
      await buildkiteHostDispatch([config], jobEnvironment, command, request)
    ).toBe("Forge could not authenticate the Buildkite bootstrap job.");
    expect(calls).toHaveLength(2);
  }
);

test("refuses a forbidden Buildkite read without reporting its body", async () => {
  const { calls, command, request } = fixture(
    await signedJob(),
    () => new Response("private service diagnostic", { status: 403 })
  );
  expect(
    await buildkiteHostDispatch([config], jobEnvironment, command, request)
  ).toBe("Forge could not authenticate the Buildkite bootstrap job.");
  expect(calls).toHaveLength(2);
});

test.each([
  [1, "Forge trusted install verification failed."],
  [2, "Forge could not authenticate the Buildkite bootstrap job."],
  [3, "Forge could not admit the Buildkite pull request."],
  [4, "Forge could not upload the admitted Buildkite graph."],
] as const)(
  "stops at a failed process (position %d)",
  async (failAt, error) => {
    const { calls, command, request, reads } = fixture(
      await signedJob(),
      undefined,
      failAt
    );
    expect(
      await buildkiteHostDispatch([config], jobEnvironment, command, request)
    ).toBe(error);
    expect(calls).toHaveLength(failAt);
    if (failAt < 3) {
      expect(reads).toEqual([]);
    }
  }
);

test("does not upload when admission returns empty stdout", async () => {
  const { calls, command, request } = fixture(
    await signedJob(),
    undefined,
    undefined,
    "  \n"
  );
  expect(
    await buildkiteHostDispatch([config], jobEnvironment, command, request)
  ).toBe("Forge could not admit the Buildkite pull request.");
  expect(calls).toHaveLength(3);
});

test("refuses verbose fetch before invoking any command", async () => {
  const { calls, command, request } = fixture(await signedJob());
  expect(
    await buildkiteHostDispatch(
      [config],
      { ...jobEnvironment, BUN_CONFIG_VERBOSE_FETCH: "" },
      command,
      request
    )
  ).toBe("Forge host job inputs are invalid.");
  expect(calls).toEqual([]);
});

test("refuses a protected verifier path that resolves into the install", async () => {
  const verifier = path.join(host, "linked-verifier");
  const installedVerifier = path.join(install, "verifier");
  await Bun.write(installedVerifier, "fixture");
  await symlink(installedVerifier, verifier);
  const badConfig = path.join(host, "bad-config.json");
  await Bun.write(badConfig, JSON.stringify({ ...policy, verifier }));
  const { calls, command, request } = fixture(await signedJob());
  expect(
    await buildkiteHostDispatch([badConfig], jobEnvironment, command, request)
  ).toBe("Forge host configuration and tools must be outside the install.");
  expect(calls).toEqual([]);
});

test.each(Object.keys(jobEnvironment))(
  "requires %s before invoking any process",
  async (name) => {
    const { calls, command, request } = fixture("");
    expect(
      await buildkiteHostDispatch(
        [config],
        { ...jobEnvironment, [name]: undefined },
        command,
        request
      )
    ).toBe("Forge host job inputs are invalid.");
    expect(calls).toEqual([]);
  }
);

test("passes the admitted graph over stdin through the real process runner", async () => {
  const subprocessHome = path.join(root, "subprocess");
  await mkdir(subprocessHome);
  const subprocessPolicy = {
    ...policy,
    agent: path.join(subprocessHome, "agent"),
    bun: path.join(subprocessHome, "bun"),
    verifier: path.join(subprocessHome, "verify"),
  };
  const subprocessConfig = path.join(subprocessHome, "configuration.json");
  const upload = path.join(subprocessHome, "uploaded.json");
  const token = await signedJob();
  await Promise.all([
    Bun.write(subprocessConfig, JSON.stringify(subprocessPolicy)),
    Bun.write(path.join(subprocessHome, "fixture.json"), `${pipeline}\n`),
    Bun.write(
      subprocessPolicy.verifier,
      '[[ -z "$FORGE_GITHUB_TOKEN$FORGE_BUILDKITE_READ_TOKEN$BUILDKITE_AGENT_ACCESS_TOKEN" ]]'
    ),
    Bun.write(
      subprocessPolicy.agent,
      `#!/bin/bash
set -e
[[ -z "$FORGE_GITHUB_TOKEN$FORGE_BUILDKITE_READ_TOKEN" ]]
[[ "$BUILDKITE_JOB_ID" = "${jobId}" ]]
case "$1" in
  oidc) printf '%s\\n' '${token}' ;;
  pipeline) cat > "$HOME/uploaded.json" ;;
  *) exit 1 ;;
esac
`
    ),
    Bun.write(
      subprocessPolicy.bun,
      `#!/bin/bash
set -e
[[ -z "$FORGE_BUILDKITE_READ_TOKEN$BUILDKITE_AGENT_ACCESS_TOKEN" ]]
[[ "$PWD" = "${install}" && "$FORGE_GITHUB_TOKEN" = "fixture-github-read-token" ]]
cat "$HOME/fixture.json"
`
    ),
  ]);
  await Promise.all(
    [subprocessPolicy.agent, subprocessPolicy.bun].map((file) =>
      chmod(file, 0o700)
    )
  );
  const { request, reads } = fixture(token);
  expect(
    await buildkiteHostDispatch(
      [subprocessConfig],
      jobEnvironment,
      undefined,
      request
    )
  ).toBeNull();
  expect(await Bun.file(upload).text()).toBe(`${pipeline}\n`);

  await Bun.write(subprocessPolicy.verifier, "exec head -c 1048576 /dev/zero");
  reads.length = 0;
  expect(
    await buildkiteHostDispatch(
      [subprocessConfig],
      jobEnvironment,
      undefined,
      request
    )
  ).toBe("Forge trusted install verification failed.");
  expect(reads).toEqual([]);
});

test("bounds a verifier whose descendant holds stdout open after the shell exits", async () => {
  // A background process inherits the shell's stdout even after Bash has exited.
  await expect(
    runCommand(
      {
        argv: ["/bin/bash", "-c", "/bin/sleep 10 &"],
        cwd: host,
        env: { PATH: "/usr/bin:/bin" },
      },
      100
    )
  ).rejects.toThrow("Host command timed out.");
}, 2000);
