import { describe, expect, it } from "vitest";

import { asAlias, objectKey, parseAssetPath, versionedPath } from "../src/path";

describe("release asset paths", () => {
  it("parses a namespace, a concrete release tag and an asset", () => {
    expect(parseAssetPath("/rv64/v1.2.0/disk.img")).toEqual({
      asset: "disk.img",
      namespace: "rv64",
      tag: "v1.2.0",
    });
  });

  it("rejects paths that could escape the three-segment namespace", () => {
    expect(parseAssetPath("/rv64/tag/directory/asset")).toBeNull();
    expect(parseAssetPath("/rv64/v1.2.0")).toBeNull();
    expect(parseAssetPath("/rv64/../asset")).toBeNull();
    expect(parseAssetPath("/../v1/asset")).toBeNull();
    expect(parseAssetPath("/rv64/tag/%2Fetc")).toBeNull();
    expect(parseAssetPath("/rv64/tag/asset%00")).toBeNull();
  });

  it("recognizes only the two virtual tags", () => {
    expect(asAlias("latest")).toBe("latest");
    expect(asAlias("prerelease")).toBe("prerelease");
    expect(asAlias("v1.2.0")).toBeNull();
  });

  it("keys and links every asset by namespace and resolved tag", () => {
    expect(objectKey("rv64", "v1.2.0", "disk.img")).toBe(
      "releases/rv64/v1.2.0/disk.img",
    );
    expect(versionedPath("rv64", "v1.2.0", "disk.img")).toBe(
      "/rv64/v1.2.0/disk.img",
    );
  });

  it("keeps two mirrors apart when they share a release tag", () => {
    expect(objectKey("rv64", "v1.0.0", "disk.img")).not.toBe(
      objectKey("discobox", "v1.0.0", "disk.img"),
    );
  });
});
