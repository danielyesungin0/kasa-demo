import { NextResponse } from "next/server";

/**
 * Deployed build identifier. Lets anyone confirm WHICH commit is live without
 * guessing from cache headers — answers "is my fix deployed yet?" in one call.
 *
 * Vercel injects VERCEL_GIT_COMMIT_SHA at build time. Falls back to "dev" when
 * run locally. Cache-busting headers so it always reflects the current deploy.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? "dev";
  return NextResponse.json(
    {
      commit: sha,
      shortCommit: sha.slice(0, 7),
      ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      deployedAt: process.env.VERCEL_DEPLOYMENT_ID ? new Date().toISOString() : null,
      env: process.env.VERCEL_ENV ?? "local",
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
