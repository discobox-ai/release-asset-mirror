import { UpstreamError } from "./errors";
import type { Alias, Env, GitHubRelease } from "./types";

function githubHeaders(env: Env, etag?: string): Headers {
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "User-Agent": "release-asset-mirror",
    "X-GitHub-Api-Version": "2022-11-28",
  });
  if (env.GITHUB_TOKEN)
    headers.set("Authorization", `Bearer ${env.GITHUB_TOKEN}`);
  if (etag) headers.set("If-None-Match", etag);
  return headers;
}

export async function fetchAlias(
  repository: string,
  alias: Alias,
  env: Env,
  etag?: string,
  asset?: string,
): Promise<{ etag?: string; notModified: boolean; tag?: string }> {
  const endpoint =
    alias === "latest" ? "/releases/latest" : "/releases?per_page=30";
  const response = await fetch(
    `https://api.github.com/repos/${repository}${endpoint}`,
    { headers: githubHeaders(env, etag) },
  );
  if (response.status === 304) return { notModified: true };
  if (response.status === 403 && alias === "latest" && asset) {
    return fetchLatestFromDownloadRedirect(repository, asset);
  }
  if (!response.ok)
    throw new UpstreamError(
      `GitHub releases API returned ${String(response.status)}`,
    );

  const responseEtag = response.headers.get("ETag") ?? undefined;
  if (alias === "latest") {
    const release = await response.json<GitHubRelease>();
    return {
      notModified: false,
      tag: release.tag_name,
      ...(responseEtag ? { etag: responseEtag } : {}),
    };
  }

  const releases = await response.json<GitHubRelease[]>();
  const release = releases
    .filter(
      (candidate) =>
        !candidate.draft && candidate.prerelease && candidate.published_at,
    )
    .sort(
      (a, b) =>
        Date.parse(b.published_at ?? "") - Date.parse(a.published_at ?? ""),
    )[0];
  return {
    notModified: false,
    ...(responseEtag ? { etag: responseEtag } : {}),
    ...(release ? { tag: release.tag_name } : {}),
  };
}

export async function fetchLatestFromDownloadRedirect(
  repository: string,
  asset: string,
): Promise<{ notModified: false; tag?: string }> {
  const response = await fetch(
    `https://github.com/${repository}/releases/latest/download/${encodeURIComponent(asset)}`,
    { method: "HEAD", redirect: "manual" },
  );
  if (response.status === 404) return { notModified: false };
  if (response.status < 300 || response.status >= 400) {
    throw new UpstreamError(
      `GitHub latest release redirect returned ${String(response.status)}`,
    );
  }

  const location = response.headers.get("Location");
  if (!location)
    throw new UpstreamError("GitHub latest release redirect omitted Location");
  const target = new URL(location, "https://github.com");
  const [owner, repositoryName] = repository.split("/");
  const parts = target.pathname
    .split("/")
    .map((part) => decodeURIComponent(part));
  if (
    target.origin !== "https://github.com" ||
    parts.length !== 7 ||
    parts[1] !== owner ||
    parts[2] !== repositoryName ||
    parts[3] !== "releases" ||
    parts[4] !== "download" ||
    parts[6] !== asset ||
    !parts[5]
  ) {
    throw new UpstreamError(
      "GitHub latest release returned an unexpected redirect",
    );
  }
  return { notModified: false, tag: parts[5] };
}

export function downloadUrl(
  repository: string,
  tag: string,
  asset: string,
): string {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`;
}
