import { existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize, extname } from "node:path";
import { DATA_DIR } from "@/lib/db";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv",
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string; path?: string[] }> },
): Promise<Response> {
  const { slug, path: segments } = await ctx.params;
  const pointer = join(DATA_DIR, "static", slug);
  if (!existsSync(pointer)) {
    return new Response(`No published site "${slug}". Deploy it first.`, { status: 404 });
  }
  const rootDir = readFileSync(pointer, "utf8").trim();
  const rel = (segments ?? []).join("/");
  // traversal guard
  const target = normalize(join(rootDir, rel));
  if (!target.startsWith(normalize(rootDir))) {
    return new Response("Forbidden", { status: 403 });
  }
  const filePath = existsSync(target) && statSync(target).isDirectory() ? join(target, "index.html") : target;
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    return new Response("Not found", { status: 404 });
  }
  const body = readFileSync(filePath);
  return new Response(new Uint8Array(body), {
    headers: { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" },
  });
}
