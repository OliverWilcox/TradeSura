import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { embedSnippet, profileUrl } from "@/lib/public-url";
import { sendEmail } from "@/lib/email";
import { EMAIL, emailShell, escapeHtml } from "@/lib/email-layout";

// "Connect your website": the embed snippet, a plain link alternative, and
// whether the embed has been seen on a live site yet.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const e = await prisma.engineer.findUnique({ where: { id: engineerId } });
  if (!e) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({
    snippet: embedSnippet(e.slug),
    link: `${profileUrl(e.slug)}?src=website`,
    connected: Boolean(e.websiteConnectedAt),
    host: e.websiteHost,
  });
}

const Body = z.object({ to: z.string().email().max(200) });

// Most engineers have someone else look after their site — email them the code.
export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const e = await prisma.engineer.findUnique({ where: { id: engineerId } });
  if (!e) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const brand = escapeHtml(e.tradingName?.trim() || "Your client");
  const snippet = escapeHtml(embedSnippet(e.slug));
  const link = escapeHtml(`${profileUrl(e.slug)}?src=website`);
  const rows = `
  <tr><td style="padding:26px 30px 8px;font-size:16px;line-height:24px;">
    ${brand} would like their care plans on their website. Paste this where the plans should appear:
  </td></tr>
  <tr><td style="padding:8px 30px;">
    <pre style="margin:0;white-space:pre-wrap;word-break:break-all;background:${EMAIL.wash};border:1px solid #DCE3EC;border-radius:10px;padding:14px;font-size:13px;line-height:19px;font-family:Menlo,Consolas,monospace;color:${EMAIL.ink};">${snippet}</pre>
  </td></tr>
  <tr><td style="padding:12px 30px 6px;font-size:14px;line-height:21px;color:${EMAIL.body};">
    It shows their live plans and resizes to fit. Joining opens their plan page in a new tab, so no
    payment details ever pass through the website.
  </td></tr>
  <tr><td style="padding:6px 30px 26px;font-size:14px;line-height:21px;color:${EMAIL.body};">
    Prefer a plain link or button? Point it at <a href="${link}" style="color:${EMAIL.link};">${link}</a>
  </td></tr>`;
  await sendEmail({
    to: parsed.data.to.toLowerCase(),
    subject: `Website code for ${e.tradingName?.trim() || "your client"}'s care plans`,
    html: emailShell({ title: "Care plans for your website", preheader: "Paste one snippet to show the plans.", rows }),
  });
  return NextResponse.json({ ok: true });
}
