import { describe, expect, it } from "vitest";

import { asAlias, objectKey, parseAssetPath, versionedPath } from "../src/path";

describe("release asset paths", () => {
  it("parses a concrete release tag and asset", () => {
    expect(parseAssetPath("/v1.2.0/disk.img")).toEqual({
      asset: "disk.img",
      tag: "v1.2.0",
    });
  });

  it("rejects paths that could escape the two-segment namespace", () => {
    expect(parseAssetPath("/tag/directory/asset")).toBeNull();
    expect(parseAssetPath("/../asset")).toBeNull();
    expect(parseAssetPath("/tag/%2Fetc")).toBeNull();
    expect(parseAssetPath("/tag/asset%00")).toBeNull();
  });

  it("recognizes only the two virtual tags", () => {
    expect(asAlias("latest")).toBe("latest");
    expect(asAlias("prerelease")).toBe("prerelease");
    expect(asAlias("v1.2.0")).toBeNull();
  });

  it("always versions R2 keys by the resolved release tag", () => {
    expect(objectKey("v1.2.0", "disk.img")).toBe("releases/v1.2.0/disk.img");
    expect(versionedPath("v1.2.0", "disk.img")).toBe("/v1.2.0/disk.img");
  });
});
