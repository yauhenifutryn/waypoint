import { getDb } from "@/lib/db";

/** Reverse proxy to supervised services on 127.0.0.1:<allocated port>. */
export async function handleServiceRequest(
  req: Request,
  slug: string,
  segments: string[] | undefined,
): Promise<Response> {
  const db = getDb();
  const row = db
    .prepare("SELECT d.port, d.actual_state FROM deployments d JOIN apps a ON a.id = d.app_id WHERE a.slug = ?")
    .get(slug) as { port: number | null; actual_state: string } | undefined;
  if (!row || !row.port) {
    return Response.json({ error: `No deployment for "${slug}"` }, { status: 404 });
  }
  if (row.actual_state !== "running") {
    return Response.json({ error: `Service "${slug}" is ${row.actual_state}` }, { status: 503 });
  }
  const url = new URL(req.url);
  const targetPath = "/" + (segments ?? []).join("/") + url.search;
  try {
    const res = await fetch(`http://127.0.0.1:${row.port}${targetPath}`, {
      method: req.method,
      headers: { "content-type": req.headers.get("content-type") ?? "application/json" },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.arrayBuffer();
    return new Response(body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch (e) {
    return Response.json({ error: `Upstream failed: ${(e as Error).message}` }, { status: 502 });
  }
}
