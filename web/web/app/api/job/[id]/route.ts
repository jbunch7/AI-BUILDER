import { NextRequest, NextResponse } from "next/server";
import { enforceAllowedOrigin, withCors, getClientIp } from "@/lib/security";
import { rateLimit } from "@/lib/ratelimit";
import { getJob } from "@/lib/store";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const originCheck = enforceAllowedOrigin(req);
  if (!originCheck.ok) {
    return withCors(
      req,
      NextResponse.json({ error: originCheck.reason }, { status: 403 })
    );
  }

  const ip = getClientIp(req);
  const jobLimit = Number(process.env.RATE_LIMIT_JOB_PER_MINUTE || "90");
  const rl = await rateLimit(`rl:job:${ip}`, jobLimit, 60);
  if (!rl.allowed) {
    return withCors(
      req,
      NextResponse.json(
        { error: "Too many requests. Please wait a moment." },
        { status: 429 }
      )
    );
  }

  const { id } = await context.params;

  const job = await getJob(id);

  if (!job) {
    return withCors(req, NextResponse.json({ error: "Not found" }, { status: 404 }));
  }

  return withCors(req, NextResponse.json(job));
}
