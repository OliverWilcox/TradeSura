import { z } from "zod";
import { isoDay } from "@/lib/admin-api/schemas";

// The engineer and customer list filters, shared by each list and its CSV export.

export const engineerFilters = {
  q: z.string().trim().max(100).optional(),
  status: z.enum(["active", "paused", "banned", "left"]).optional(),
  verification: z.enum(["verified", "pending", "rejected", "not_submitted"]).optional(),
  step: z.enum(["signed_up", "payments", "plan", "customer", "payout"]).optional(),
  town: z.string().trim().max(80).optional(),
  type: z.enum(["sole_trader", "ltd", "partnership"]).optional(),
  channel: z.enum(["letter", "email", "engineer", "online", "other"]).optional(),
  staff: z.enum(["owners", "staff"]).optional(),
  joinedFrom: isoDay.optional(),
  joinedTo: isoDay.optional(),
};

export const customerFilters = {
  q: z.string().trim().max(100).optional(),
  engineerId: z.string().trim().max(40).optional(),
  plan: z.enum(["active", "pending", "paused", "cancelled", "none"]).optional(),
  payment: z.enum(["failing", "paid", "none"]).optional(),
  cancelledFrom: isoDay.optional(),
  cancelledTo: isoDay.optional(),
  source: z.enum(["added", "doorstep", "web", "import", "contacts"]).optional(),
};
