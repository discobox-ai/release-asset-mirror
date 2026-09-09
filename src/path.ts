import type { Alias } from "./types";

// The leading-alphanumeric requirement is also what excludes "." and "..".
const SAFE_PART = /^[A-Za-z0-9][A-Za-z0-9._+@-]{0,254}$/;

export interface AssetPath {
  asset: string;
  namespace: string;
  tag: string;
}

export function parseAssetPath(pathname: string): AssetPath | null {
  const encoded = pathname.split("/");
  if (encoded.length !== 4 || encoded[0] !== "") return null;

  try {
    const namespace = decodeURIComponent(encoded[1] ?? "");
    const tag = decodeURIComponent(encoded[2] ?? "");
    const asset = decodeURIComponent(encoded[3] ?? "");
    if (![namespace, tag, asset].every((part) => SAFE_PART.test(part)))
      return null;
    return { asset, namespace, tag };
  } catch {
    return null;
  }
}

export function asAlias(tag: string): Alias | null {
  if (tag === "latest" || tag === "prerelease") return tag;
  return null;
}

export function objectKey(
  namespace: string,
  tag: string,
  asset: string,
): string {
  return `releases/${namespace}/${tag}/${asset}`;
}

export function versionedPath(
  namespace: string,
  tag: string,
  asset: string,
): string {
  return `/${[namespace, tag, asset].map(encodeURIComponent).join("/")}`;
}
