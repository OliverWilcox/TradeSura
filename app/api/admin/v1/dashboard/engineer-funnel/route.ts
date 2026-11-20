import { z } from "zod";
import { AdminApiError, adminRoute, parseQuery } from "@/lib/admin-api/route";
import { parseRange } from "@/lib/admin-api/range";
import { engineerFunnel, engineerFunnelFromSignups, engineerFunnelOptions, FUNNEL_CHANNELS } from "@/lib/admin/engineer-funnel";
import { VISIT_REASONS } from "@/lib/visit-reasons";

const Filters = {
  batch: z.string().trim().min(1).max(40).optional(),
  code: z.string().trim().min(1).max(20).optional(),
  town: z.string().trim().min(1).max(80).optional(),
  reason: z.string().trim().min(1).max(60).optional(),
  channel: z.enum(FUNNEL_CHANNELS).optional(),
};

export const GET = adminRoute("dashboard:read", async ({ req }) => {
  const range = parseRange(req, Filters);
  const { batch, code, town, reason, channel } = parseQuery(req, z.object(Filters).passthrough());
  if (reason && !(VISIT_REASONS as readonly string[]).includes(reason)) {
    throw new AdminApiError(400, "VALIDATION", "That visit reason doesn't exist.", { reason: ["That visit reason doesn't exist."] });
  }
  if (channel && channel !== "letter" && (batch || code)) {
    const message = "Batch and claim code are for letters only. Choose the Letter channel, or clear them.";
    throw new AdminApiError(400, "VALIDATION", message, { channel: [message] });
  }
  const [funnel, options] = await Promise.all([
    channel && channel !== "letter" ? engineerFunnelFromSignups(range, { channel, town, reason }) : engineerFunnel(range, { batch, code, town, reason }),
    engineerFunnelOptions(),
  ]);
  return { ...funnel, channel: channel ?? "letter", options };
});
