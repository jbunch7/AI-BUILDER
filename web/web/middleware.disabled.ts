import { NextRequest, NextResponse } from "next/server";

async function verifyToken(token: string | null) {
  if (!token) return false;

  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!exp || Date.now() > exp) return false;

  const secret = process.env.EMBED_TOKEN_SECRET!;
  const enc = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(expStr)
  );

  const expected = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  return sig === expected;
}

export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname !== "/") {
    return NextResponse.next();
  }

  // If no secret is configured, do not block access.
  // This keeps local dev + early deployments frictionless.
  if (!process.env.EMBED_TOKEN_SECRET) {
    return NextResponse.next();
  }

  const token = req.nextUrl.searchParams.get("t");

  if (await verifyToken(token)) {
    return NextResponse.next();
  }

  // Show a friendly access-gated page
  return new NextResponse(
    `<!doctype html>
    <html>
    <body style="margin:0;font-family:system-ui;background:#f7f7f7;">
      <div style="max-width:720px;margin:40px auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 10px 30px rgba(0,0,0,.08);text-align:center;">
        <h1>Access required</h1>
        <p>This tool is only available through an authorized link.</p>
        <a href="/"
           style="display:inline-block;padding:10px 16px;border-radius:8px;background:#111;color:#fff;text-decoration:none;font-weight:600;">
          Return
        </a>
      </div>
    </body>
    </html>`,
    { headers: { "content-type": "text/html" } }
  );
}

export const config = {
  matcher: ["/"],
};
