import { downloadUrl, fetchAlias } from "./github";
import { resolveRepository } from "./mirrors";
import { asAlias } from "./path";
import type { AliasState, Env, FillRequest } from "./types";

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export class Coordinator implements DurableObject {
  private fillPromise: Promise<Response> | undefined;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.startsWith("/resolve/")) {
      const alias = asAlias(url.pathname.slice("/resolve/".length));
      const namespace = url.searchParams.get("namespace");
      if (!alias || !namespace)
        return new Response("Not found", { status: 404 });
      // Resolve the repository here rather than trusting the caller: the map
      // in the environment stays the only place a namespace is interpreted.
      const repository = resolveRepository(this.env, namespace);
      if (!repository) return new Response("Not found", { status: 404 });
      return this.resolve(
        repository,
        alias,
        url.searchParams.get("asset") ?? undefined,
      );
    }
    if (request.method === "POST" && url.pathname === "/fill") {
      const input = await request.json<FillRequest>();
      const repository = resolveRepository(this.env, input.namespace);
      if (!repository) return new Response("Not found", { status: 404 });
      this.fillPromise ??= this.fill(repository, input).finally(() => {
        this.fillPromise = undefined;
      });
      return this.fillPromise;
    }
    return new Response("Not found", { status: 404 });
  }

  private async resolve(
    repository: string,
    alias: "latest" | "prerelease",
    asset?: string,
  ): Promise<Response> {
    const now = Date.now();
    const ttl = positiveInteger(this.env.ALIAS_TTL_SECONDS, 60) * 1000;
    const cached = await this.state.storage.get<AliasState>("alias");
    if (cached && now - cached.checkedAt < ttl)
      return Response.json({ tag: cached.tag });

    try {
      const result = await fetchAlias(
        repository,
        alias,
        this.env,
        cached?.etag,
        asset,
      );
      if (result.notModified && cached) {
        const refreshed = { ...cached, checkedAt: now };
        await this.state.storage.put("alias", refreshed);
        return Response.json({ tag: refreshed.tag });
      }
      if (!result.tag)
        return new Response("No matching release", { status: 404 });
      const refreshed: AliasState = {
        checkedAt: now,
        tag: result.tag,
        ...(result.etag ? { etag: result.etag } : {}),
      };
      await this.state.storage.put("alias", refreshed);
      return Response.json({ tag: refreshed.tag });
    } catch (error) {
      if (cached) return Response.json({ stale: true, tag: cached.tag });
      console.error("Unable to resolve release alias", error);
      return new Response("Unable to resolve release alias", { status: 502 });
    }
  }

  private async fill(
    repository: string,
    input: FillRequest,
  ): Promise<Response> {
    if (await this.env.ASSETS.head(input.key))
      return new Response(null, { status: 204 });

    const source = downloadUrl(repository, input.tag, input.asset);
    const upstream = await fetch(source, { redirect: "follow" });
    if (upstream.status === 404)
      return new Response("Asset not found", { status: 404 });
    if (!upstream.ok || !upstream.body) {
      console.error(
        "GitHub asset download failed",
        upstream.status,
        upstream.url,
      );
      return new Response("Upstream download failed", { status: 502 });
    }

    const contentLength = upstream.headers.get("Content-Length");
    const contentType =
      upstream.headers.get("Content-Type") ?? "application/octet-stream";
    const contentDisposition =
      upstream.headers.get("Content-Disposition") ?? undefined;
    await this.env.ASSETS.put(input.key, upstream.body, {
      customMetadata: {
        cachedAt: new Date().toISOString(),
        githubUrl: source,
        releaseTag: input.tag,
        repository,
        ...(contentLength ? { sourceContentLength: contentLength } : {}),
      },
      httpMetadata: {
        cacheControl: "public, max-age=31536000, immutable",
        contentType,
        ...(contentDisposition ? { contentDisposition } : {}),
      },
    });
    return new Response(null, { status: 201 });
  }
}
