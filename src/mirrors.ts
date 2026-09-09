import type { Env } from "./types";

const NAMESPACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

function repositoryMap(env: Env): Record<string, unknown> {
  // wrangler.jsonc delivers a JSON object; .dev.vars and CI environment
  // overrides can only carry strings, so accept an encoded object too.
  const configured: unknown =
    typeof env.REPOSITORIES === "string"
      ? JSON.parse(env.REPOSITORIES)
      : env.REPOSITORIES;
  if (
    typeof configured !== "object" ||
    configured === null ||
    Array.isArray(configured)
  ) {
    throw new Error(
      "REPOSITORIES must be an object mapping namespace to owner/repository",
    );
  }
  return configured as Record<string, unknown>;
}

/**
 * Resolves a URL's first path segment to the repository it mirrors.
 *
 * Returns null for a namespace that is not configured, which the caller turns
 * into a 404. Only names present in the deploy-time map are reachable, so no
 * request can point the Worker at a repository its operator did not choose.
 */
export function resolveRepository(env: Env, namespace: string): string | null {
  if (!NAMESPACE_PATTERN.test(namespace)) return null;
  const map = repositoryMap(env);
  // Own properties only: a bare lookup would resolve "constructor" and every
  // other inherited name to something that is not a configured mirror.
  if (!Object.hasOwn(map, namespace)) return null;

  const repository = map[namespace];
  if (typeof repository !== "string" || !REPOSITORY_PATTERN.test(repository)) {
    throw new Error(
      `REPOSITORIES[${JSON.stringify(namespace)}] must have the form owner/repository`,
    );
  }
  return repository;
}
