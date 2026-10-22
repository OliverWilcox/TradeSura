"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";

// Section 4 — the homeowner's consent to be contacted about their home
// (replacement / repair suggestions from the passport). Off until ticked;
// unticking withdraws it.
export async function setContactConsent(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const consent = formData.get("consent") === "on";
  const passport = await prisma.homePassport.findUnique({ where: { viewToken: token }, select: { id: true } });
  if (!passport) return;
  await prisma.homePassport.update({
    where: { id: passport.id },
    data: { contactConsentAt: consent ? new Date() : null },
  });
  await track(consent ? "passport_consent_given" : "passport_consent_withdrawn", { type: "CUSTOMER" }, {
    passportId: passport.id,
  });
  revalidatePath(`/passport/${token}`);
}
