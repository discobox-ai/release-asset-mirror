import { describe, expect, it } from "vitest";

import { resolveRepository } from "../src/mirrors";
import type { Env } from "../src/types";

function env(repositories: Env["REPOSITORIES"]): Env {
  return { REPOSITORIES: repositories } as Env;
}

const configured = env({
  discobox: "discobox-ai/discobox",
  rv64: "ibuildthecloud/rv64.js",
});

describe("mirror namespaces", () => {
  it("maps each namespace to its own repository", () => {
    expect(resolveRepository(configured, "discobox")).toBe(
      "discobox-ai/discobox",
    );
    expect(resolveRepository(configured, "rv64")).toBe(
      "ibuildthecloud/rv64.js",
    );
  });

  it("accepts the map encoded as a string", () => {
    expect(
      resolveRepository(
        env(JSON.stringify({ rv64: "ibuildthecloud/rv64.js" })),
        "rv64",
      ),
    ).toBe("ibuildthecloud/rv64.js");
  });

  it("refuses namespaces that are not configured", () => {
    expect(resolveRepository(configured, "unknown")).toBeNull();
    expect(resolveRepository(configured, "")).toBeNull();
  });

  it("does not resolve inherited object properties to a mirror", () => {
    expect(resolveRepository(configured, "constructor")).toBeNull();
    expect(resolveRepository(configured, "toString")).toBeNull();
    expect(resolveRepository(configured, "__proto__")).toBeNull();
  });

  it("rejects a configured value that is not owner/repository", () => {
    expect(() =>
      resolveRepository(env({ open: "https://example.com/proxy" }), "open"),
    ).toThrow("owner/repository");
    expect(() =>
      resolveRepository(env({ open: "owner/repo/extra" }), "open"),
    ).toThrow("owner/repository");
  });

  it("rejects a map that is not an object of namespaces", () => {
    expect(() => resolveRepository(env("[]"), "rv64")).toThrow("REPOSITORIES");
    expect(() =>
      resolveRepository(env(JSON.stringify("owner/repo")), "rv64"),
    ).toThrow("REPOSITORIES");
  });
});
