import { z } from "zod";
import { adminRoute, notFound, parseBody } from "@/lib/admin-api/route";
import { prisma } from "@/lib/db";
import { raiseSafetyComplaint, SAFETY_COMPLAINT_LIMITS } from "@/lib/safety-complaints";

const Body = z.strictObject({
  message: z
    .string({ error: "Say what the homeowner told you." })
    .trim()
    .min(SAFETY_COMPLAINT_LIMITS.min, `Say what the homeowner told you, in at least ${SAFETY_COMPLAINT_LIMITS.min} characters.`)
    .max(SAFETY_COMPLAINT_LIMITS.max, "Keep it under 2,000 characters."),
});

export const POST = adminRoute<{ customerId: string }>("customers:notes", async ({ req, admin, params }) => {
  const { message } = await parseBody(req, Body);
  const customer = await prisma.customer.findFirst({
    where: { id: params.customerId, engineer: { deletedAt: null } },
    select: { id: true, engineerId: true, plans: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } },
  });
  if (!customer) throw notFound("There's no customer with that ID.");
  return raiseSafetyComplaint({ engineerId: customer.engineerId, customerId: customer.id, planId: customer.plans[0]?.id ?? null, message, from: "admin" }, admin);
});
