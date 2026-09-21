import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIRECTORY = path.resolve(TEST_DIRECTORY, "..")
const REGISTER_HOOK_URL = pathToFileURL(
  path.join(TEST_DIRECTORY, "register-server-only.mjs"),
).href
const AUTH_URL = pathToFileURL(path.join(ROOT_DIRECTORY, "lib/auth.js")).href
const ROUTE_URL = pathToFileURL(
  path.join(ROOT_DIRECTORY, "app/api/auth/[...all]/route.js"),
).href
const SYNTHETIC_DATABASE_URL =
  "postgresql://projekt_space_app:synthetic-password@127.0.0.1:55432/projekt_space_dev"
const SYNTHETIC_SECRET =
  "A1b2C3d4E5f6G7h8I9j0K!l@M#n$O%p^Q&r*S(t)U-v_W+x="

function processEnvironment(overrides = {}) {
  return {
    ...process.env,
    NODE_ENV: "development",
    DATABASE_URL: SYNTHETIC_DATABASE_URL,
    BETTER_AUTH_SECRET: SYNTHETIC_SECRET,
    BETTER_AUTH_URL: "http://127.0.0.1:3000",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    VERCEL: "",
    VERCEL_ENV: "",
    VERCEL_URL: "",
    ...overrides,
  }
}

function runModuleCheck(expression, overrides = {}) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      REGISTER_HOOK_URL,
      "--input-type=module",
      "--eval",
      expression,
    ],
    {
      cwd: ROOT_DIRECTORY,
      encoding: "utf8",
      env: processEnvironment(overrides),
      windowsHide: true,
    },
  )
}

test("auth configuration imports with process-scoped synthetic values", () => {
  const result = runModuleCheck(`
    const { auth } = await import(${JSON.stringify(AUTH_URL)});
    const options = auth.options;
    const output = {
      baseURL: options.baseURL,
      trustedOrigins: options.trustedOrigins,
      emailAndPassword: options.emailAndPassword?.enabled,
      implicitLinking: options.account?.accountLinking?.disableImplicitLinking,
      hasDatabaseAdapter: typeof options.database === "function",
      hasSecret: typeof options.secret === "string",
      googleConfigured: Object.hasOwn(options, "socialProviders"),
      generateIdConfigured: options.advanced?.database?.generateId !== undefined,
    };
    process.stdout.write(JSON.stringify(output));
  `)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    baseURL: "http://127.0.0.1:3000",
    trustedOrigins: ["http://127.0.0.1:3000"],
    emailAndPassword: true,
    implicitLinking: true,
    hasDatabaseAdapter: true,
    hasSecret: true,
    googleConfigured: false,
    generateIdConfigured: false,
  })
})

test("non-Vercel production requires and trusts one explicit HTTPS auth origin", () => {
  const result = runModuleCheck(`
    const { auth } = await import(${JSON.stringify(AUTH_URL)});
    process.stdout.write(JSON.stringify({
      baseURL: auth.options.baseURL,
      trustedOrigins: auth.options.trustedOrigins,
    }));
  `, {
    NODE_ENV: "production",
    BETTER_AUTH_URL: "https://projekt-space.example.invalid",
  })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    baseURL: "https://projekt-space.example.invalid",
    trustedOrigins: ["https://projekt-space.example.invalid"],
  })
})

test("Vercel production also trusts only its exact validated deployment URL", () => {
  const result = runModuleCheck(`
    const { auth } = await import(${JSON.stringify(AUTH_URL)});
    process.stdout.write(JSON.stringify({
      baseURL: auth.options.baseURL,
      trustedOrigins: auth.options.trustedOrigins,
    }));
  `, {
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_URL: "projekt-space-a1b2c3-example.vercel.app",
    BETTER_AUTH_URL: "https://projekt-space.vercel.app",
  })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    baseURL: "https://projekt-space.vercel.app",
    trustedOrigins: [
      "https://projekt-space.vercel.app",
      "https://projekt-space-a1b2c3-example.vercel.app",
    ],
  })
  assert.equal(
    JSON.parse(result.stdout).trustedOrigins.includes(
      "https://unrelated-project.vercel.app",
    ),
    false,
  )
})

test("Vercel production rejects unrelated or missing deployment hosts", () => {
  const secretHost = "never-print-this-production.example.invalid"
  const cases = [
    { VERCEL_URL: secretHost },
    { VERCEL_URL: "" },
    { VERCEL: "", VERCEL_URL: "projekt-space-a1b2c3-example.vercel.app" },
  ]

  for (const environment of cases) {
    const result = runModuleCheck(
      `await import(${JSON.stringify(AUTH_URL)});`,
      {
        NODE_ENV: "production",
        VERCEL: "1",
        VERCEL_ENV: "production",
        BETTER_AUTH_URL: "https://projekt-space.vercel.app",
        ...environment,
      },
    )

    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /Better Auth production deployment origin configuration is invalid/,
    )
    assert.doesNotMatch(result.stderr, new RegExp(secretHost))
  }
})

test("Vercel production rejects a request from another Vercel origin", () => {
  const result = runModuleCheck(`
    const { auth } = await import(${JSON.stringify(AUTH_URL)});
    const response = await auth.handler(new Request(
      "https://projekt-space.vercel.app/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://unrelated-project.vercel.app",
        },
        body: JSON.stringify({
          email: "origin-check@example.invalid",
          password: "synthetic-password",
        }),
      },
    ));
    process.stdout.write(JSON.stringify({
      status: response.status,
      body: await response.json(),
    }));
  `, {
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_URL: "projekt-space-a1b2c3-example.vercel.app",
    BETTER_AUTH_URL: "https://projekt-space.vercel.app",
  })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 403,
    body: {
      code: "INVALID_ORIGIN",
      message: "Invalid origin",
    },
  })
})

test("production rejects missing or non-HTTPS auth origins without exposing values", () => {
  const secretHost = "never-print-this-origin.example.invalid"

  for (const baseURL of ["", `http://${secretHost}`]) {
    const result = runModuleCheck(
      `await import(${JSON.stringify(AUTH_URL)});`,
      {
        NODE_ENV: "production",
        VERCEL: "1",
        VERCEL_ENV: "production",
        BETTER_AUTH_URL: baseURL,
      },
    )

    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /Better Auth requires a valid explicit application origin/,
    )
    assert.doesNotMatch(result.stderr, new RegExp(secretHost))
  }
})

test("Vercel preview derives and trusts only its validated system URL", () => {
  const result = runModuleCheck(`
    const { auth } = await import(${JSON.stringify(AUTH_URL)});
    process.stdout.write(JSON.stringify({
      baseURL: auth.options.baseURL,
      trustedOrigins: auth.options.trustedOrigins,
    }));
  `, {
    NODE_ENV: "production",
    VERCEL: "1",
    VERCEL_ENV: "preview",
    VERCEL_URL: "projekt-space-git-feature-example.vercel.app",
    BETTER_AUTH_URL: "",
  })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    baseURL: "https://projekt-space-git-feature-example.vercel.app",
    trustedOrigins: [
      "https://projekt-space-git-feature-example.vercel.app",
    ],
  })
})

test("Vercel preview rejects arbitrary or missing system hosts", () => {
  const secretHost = "never-print-this-preview.example.invalid"
  const cases = [
    { VERCEL_URL: secretHost },
    { VERCEL_URL: "" },
    { VERCEL: "", VERCEL_URL: "projekt-space-preview.vercel.app" },
  ]

  for (const environment of cases) {
    const result = runModuleCheck(
      `await import(${JSON.stringify(AUTH_URL)});`,
      {
        NODE_ENV: "production",
        VERCEL: "1",
        VERCEL_ENV: "preview",
        BETTER_AUTH_URL: "",
        ...environment,
      },
    )

    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /Better Auth preview origin configuration is invalid/,
    )
    assert.doesNotMatch(result.stderr, new RegExp(secretHost))
  }
})

test("Vercel preview rejects a production auth-origin fallback", () => {
  const result = runModuleCheck(
    `await import(${JSON.stringify(AUTH_URL)});`,
    {
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_URL: "projekt-space-preview.vercel.app",
      BETTER_AUTH_URL: "https://projekt-space.example.invalid",
    },
  )

  assert.notEqual(result.status, 0)
  assert.match(
    result.stderr,
    /Better Auth preview origin configuration is invalid/,
  )
})

test("missing and invalid Better Auth secrets fail with a fixed error", () => {
  for (const secret of ["", "too-short", "replace-with-random-secret-at-least-32-characters"]) {
    const result = runModuleCheck(
      `await import(${JSON.stringify(AUTH_URL)});`,
      { BETTER_AUTH_SECRET: secret },
    )

    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /BETTER_AUTH_SECRET must be a non-placeholder value of at least 32 characters/,
    )
    if (secret.length > 0) {
      assert.doesNotMatch(result.stderr, new RegExp(secret))
    }
  }
})

test("Google is disabled when both provider variables are absent", () => {
  const result = runModuleCheck(`
    const { auth } = await import(${JSON.stringify(AUTH_URL)});
    process.stdout.write(String(Object.hasOwn(auth.options, "socialProviders")));
  `)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "false")
})

test("one Google variable fails with a fixed non-secret error", () => {
  const secretValue = "never-print-this-google-secret"
  const cases = [
    { GOOGLE_CLIENT_ID: "synthetic-client-id" },
    { GOOGLE_CLIENT_SECRET: secretValue },
  ]

  for (const environment of cases) {
    const result = runModuleCheck(
      `await import(${JSON.stringify(AUTH_URL)});`,
      environment,
    )

    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must either both be set or both be absent/,
    )
    assert.doesNotMatch(result.stderr, new RegExp(secretValue))
  }
})

test("Google provider is enabled only when both variables are present", () => {
  const result = runModuleCheck(`
    const { auth } = await import(${JSON.stringify(AUTH_URL)});
    const google = auth.options.socialProviders?.google;
    process.stdout.write(JSON.stringify({
      clientId: google?.clientId,
      hasClientSecret: typeof google?.clientSecret === "string",
    }));
  `, {
    GOOGLE_CLIENT_ID: "synthetic-client-id",
    GOOGLE_CLIENT_SECRET: "synthetic-client-secret",
  })

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    clientId: "synthetic-client-id",
    hasClientSecret: true,
  })
})

test("configuration reuses the provided shared Prisma client with PostgreSQL", () => {
  const result = runModuleCheck(`
    const { createAuthOptions } = await import(${JSON.stringify(AUTH_URL)});
    const sharedClient = {};
    let adapterCall;
    const databaseAdapter = () => {};
    const options = createAuthOptions({
      environment: process.env,
      prismaClient: sharedClient,
      createAdapter(client, config) {
        adapterCall = { sameClient: client === sharedClient, config };
        return databaseAdapter;
      },
    });
    process.stdout.write(JSON.stringify({
      ...adapterCall,
      sameAdapter: options.database === databaseAdapter,
    }));
  `)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    sameClient: true,
    config: { provider: "postgresql" },
    sameAdapter: true,
  })
})

test("route exports only the required Better Auth HTTP handlers", () => {
  const result = runModuleCheck(`
    const route = await import(${JSON.stringify(ROUTE_URL)});
    process.stdout.write(JSON.stringify({
      exports: Object.keys(route).sort(),
      getType: typeof route.GET,
      postType: typeof route.POST,
      sameHandler: route.GET === route.POST,
      runtime: route.runtime,
      dynamic: route.dynamic,
    }));
  `)

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    exports: ["GET", "POST", "dynamic", "runtime"],
    getType: "function",
    postType: "function",
    sameHandler: true,
    runtime: "nodejs",
    dynamic: "force-dynamic",
  })
})
