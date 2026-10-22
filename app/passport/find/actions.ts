"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { notifyEngineer } from "@/lib/sms";
import { sendPushNotification } from "@/lib/push";
import { addressKey, loadPassportView } from "@/lib/passport";
import { normaliseUkPhone } from "@/lib/phone";
import { headers } from "next/headers";
import { ipHash, recentAttempts } from "@/lib/enquiries";

// Section 4 backup — someone who found a passport by postcode asks for
// access. Nothing is revealed to them; the engineer gets their details and
// decides (they know the homeowner).
export async function requestPassportAccess(formData: FormData) {
  const postcode = String(formData.get("postcode") ?? "");
  const line1 = String(formData.get("line1") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const contact = String(formData.get("contact") ?? "").trim().slice(0, 120);
  const back = `/passport/find?postcode=${encodeURIComponent(postcode)}&line1=${encodeURIComponent(line1)}`;
  if (name.length < 2 || contact.length < 5) redirect(`${back}&err=1`);

  const passport = await prisma.homePassport.findUnique({
    where: { addressKey: addressKey({ addressLine1: line1, postcode }) },
    select: { id: true },
  });
  if (!passport) redirect(back);
  const view = await loadPassportView({ id: passport.id });
  const engineer = view?.lookedAfterBy[0] ?? view?.lead;

  // Public form: at most 3 requests an hour from one visitor, so it can't be
  // used to spam engineers.
  const h = await headers();
  const ip = ipHash(h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown");
  if ((await recentAttempts("passport_access_requested", ip, 60)) >= 3) redirect(`${back}&err=2`);

  const phone = normaliseUkPhone(contact);
  await track("passport_access_requested", { type: "CUSTOMER" }, {
    ip,
    passportId: passport.id,
    engineerId: engineer?.id,
    name,
    contact: phone ?? contact,
  });
  if (engineer) {
    const msg = `TradeSura: ${name} (${phone ?? contact}) asked for access to the Home Passport at ${view!.passport.addressLine1}, ${view!.passport.postcode}. Check with the homeowner before sharing anything.`;
    await notifyEngineer(engineer.id, msg).catch(() => {});
    await sendPushNotification(engineer.id, "Home Passport request", `${name} asked for access to a home you look after.`);
  }
  redirect(`${back}&sent=1`);
}
