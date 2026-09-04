import { handleServiceRequest } from "@/server/proxy";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string; path?: string[] }> }): Promise<Response> {
  const { slug, path } = await ctx.params;
  return handleServiceRequest(req, slug, path);
}

export async function POST(req: Request, ctx: { params: Promise<{ slug: string; path?: string[] }> }): Promise<Response> {
  const { slug, path } = await ctx.params;
  return handleServiceRequest(req, slug, path);
}
