import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import handler from "../src/index";
import type { Env } from "../src/types";

const ASSET = "https://assets.example.com/tools/prerelease/disk.img";
const LATEST = "https://assets.example.com/tools/latest/disk.img";

function envWith(coordinator: () => Promise<Response>): Env {
  return {
    ALIAS_TTL_SECONDS: "60",
    COORDINATOR: {
      get: () => ({ fetch: coordinator }),
      idFromName: () => "coordinator-id",
    },
    EDGE_ALIAS_TTL_SECONDS: "60",
    R2_PUBLIC_BASE_URL: "",
    R2_REDIRECT_TTL_SECONDS: "3600",
    REPOSITORIES: { tools: "example/tools" },
  } as unknown as Env;
}

beforeEach(() => {
  // The alias edge cache is a Workers global; a miss keeps every test on the
  // resolution path it is actually about.
  vi.stubGlobal("caches", {
    open: async () => ({
      delete: async () => undefined,
      match: async () => undefined,
      put: async () => undefined,
    }),
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("alias failures reach the caller intact", () => {
  it("forwards the coordinator's 502 rather than collapsing it into a 500", async () => {
    const env = envWith(async () =>
      Promise.resolve(
        new Response("Unable to resolve release alias", { status: 502 }),
      ),
    );

    const response = await handler.fetch(new Request(ASSET), env);

    expect(response.status).toBe(502);
    await expect(response.text()).resolves.toBe(
      "Unable to resolve release alias",
    );
  });

  it("answers 502 when GitHub's latest-release redirect fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.resolve(new Response(null, { status: 500 }))),
    );
    const env = envWith(async () =>
      Promise.resolve(new Response(null, { status: 500 })),
    );

    const response = await handler.fetch(new Request(LATEST), env);

    expect(response.status).toBe(502);
    await expect(response.text()).resolves.toBe(
      "GitHub latest release redirect returned 500",
    );
  });

  it("still answers 404 when there is no matching release", async () => {
    const env = envWith(async () =>
      Promise.resolve(new Response("No matching release", { status: 404 })),
    );

    const response = await handler.fetch(new Request(ASSET), env);

    expect(response.status).toBe(404);
  });

  it("keeps a bug in this Worker an opaque 500", async () => {
    const env = envWith(async () =>
      Promise.resolve(Response.json({ tag: "v1.5.0-rc.1" })),
    );

    const response = await handler.fetch(
      new Request(ASSET),
      // Misconfiguration is ours, not an upstream's: it must not read as 502.
      { ...env, REPOSITORIES: "not json" },
    );

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe("Internal error");
  });

  it("redirects to the resolved tag when the coordinator answers", async () => {
    const env = envWith(async () =>
      Promise.resolve(Response.json({ tag: "v1.5.0-rc.1" })),
    );

    const response = await handler.fetch(new Request(ASSET), env);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "/tools/v1.5.0-rc.1/disk.img",
    );
  });
});
