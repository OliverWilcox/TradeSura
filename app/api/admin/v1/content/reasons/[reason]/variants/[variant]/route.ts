import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { CONTENT_LIMITS, PRESELECTS, deleteVariant, saveVariant } from "@/lib/admin/content";

const L = CONTENT_LIMITS;
const line = (what: string) => z.string({ error: `Write the ${what}.` }).trim().min(1, `Write the ${what}.`).max(L.line, `Keep each line under ${L.line} characters.`);

const Body = z.strictObject({
  label: z.string({ error: "Name the reason." }).trim().min(2, "Name the reason.").max(L.label, `Keep it under ${L.label} characters.`),
  headline: z.string({ error: "Write the headline." }).trim().min(1, "Write the headline.").max(L.headline, `Keep it under ${L.headline} characters.`),
  worries: z.array(line("worry")).max(L.worries, `Up to ${L.worries} worries.`),
  messages: z.array(line("message")).min(1, "Write at least one message.").max(L.messages, `Up to ${L.messages} messages.`),
  graphicKey: z.string().trim().min(1).max(40).nullable(),
  benefitOrder: z.array(z.string().trim().min(1).max(40)).max(40),
  preselect: z.enum(PRESELECTS as [string, ...string[]]),
  followUp2d: z.string({ error: "Write the 2-day text." }).trim().min(1, "Write the 2-day text.").max(L.followUp, `Keep it under ${L.followUp} characters.`),
  followUp7d: z.string({ error: "Write the 7-day text." }).trim().min(1, "Write the 7-day text.").max(L.followUp, `Keep it under ${L.followUp} characters.`),
});

export const PUT = adminRoute<{ reason: string; variant: string }>("content:write", async ({ req, admin, params }) => {
  const body = await parseBody(req, Body);
  return saveVariant(admin, params.reason, params.variant, { ...body, preselect: body.preselect as (typeof PRESELECTS)[number] });
});

export const DELETE = adminRoute<{ reason: string; variant: string }>("content:write", async ({ admin, params }) => deleteVariant(admin, params.reason, params.variant));
