import { prisma } from "@/lib/db";
import { makeCustomer, makeEngineer, makePlan } from "./factories";

// The client's data as they saw it on 31 October 2026, rebuilt from the
// feedback: £12 collected, 2 plans live, 2 customers, 1 WhatsApp offer that
// never went, sign-ups shown as 7 on a card and 4 in the funnel (3 accounts
// deleted since), testers' "Letter" sign-ups, and a staff account counted as
// a verified engineer. Every value is fictional.

/** October 2026 in UK time: 00:00 1 October (BST) to 00:00 1 November (GMT). */
export const OCTOBER = { from: "2026-09-30T23:00:00.000Z", to: "2026-11-01T00:00:00.000Z" };

const at = (iso: string) => new Date(iso);
const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

async function offer(engineerId: string, planId: string, customerId: string, channel: "sms" | "whatsapp", ts: string) {
  await prisma.event.create({ data: { name: "offer_sent", actorType: "ENGINEER", actorId: engineerId, ts: at(ts), meta: { planId, customerId, channel } } });
}

async function paidInvoice(id: string, subscription: string, amount: number, fee: number | null, paidAt: string) {
  await prisma.stripeWebhookEvent.create({
    data: {
      id: `evt_${id}`,
      type: "invoice.paid",
      processedAt: at(paidAt),
      payload: {
        livemode: false, // production runs Stripe in test mode until go-live
        data: { object: { id, amount_paid: amount, application_fee_amount: fee, status_transitions: { paid_at: unix(paidAt) }, parent: { subscription_details: { subscription } } } },
      },
    },
  });
}

export async function clientFixture() {
  // 302 MD LTD: verified, a plan on sale, payments set up, three customers.
  const md = await makeEngineer({
    tradingName: "302 MD LTD",
    businessType: "ltd",
    createdAt: at("2026-10-10T09:00:00Z"),
    gasSafeVerifiedAt: at("2026-10-12T09:00:00Z"),
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
    stripeAccountId: "acct_302md",
    serviceArea: "Holmfirth, Huddersfield, HD9",
    postcode: "E16 1YL",
    attribution: { heardVia: "online" },
  });
  await prisma.planTier.create({ data: { engineerId: md.id, name: "Boiler Care", priceMonthlyPence: 2299, sortOrder: 0, status: "LIVE" } });
  await prisma.event.createMany({
    data: [
      { name: "plan_live", actorType: "ENGINEER", actorId: md.id, ts: at("2026-10-13T09:00:00Z") },
      { name: "stripe_onboarded", actorType: "ENGINEER", actorId: md.id, ts: at("2026-10-14T09:00:00Z") },
    ],
  });
  const oliver = await makeCustomer(md.id, { firstName: "Oliver", lastName: "Wilcox", source: "doorstep" });
  const oliverPlan = await makePlan(md.id, oliver.id, {
    priceMonthlyPence: 1200,
    mandateStatus: "active",
    activatedAt: at("2026-10-20T12:00:00Z"),
    createdAt: at("2026-10-20T10:00:00Z"),
    linkOpenedAt: at("2026-10-20T10:05:00Z"),
    stripeSubscriptionId: "sub_oliver",
    paymentsCleared: 1,
  });
  await offer(md.id, oliverPlan.id, oliver.id, "sms", "2026-10-20T10:00:00Z");
  // Stripe's £0 cooling-off trial invoice, then the first real collection.
  await paidInvoice("in_trial_oliver", "sub_oliver", 0, 0, "2026-10-20T12:00:00Z");
  await paidInvoice("in_oliver_1", "sub_oliver", 1200, 240, "2026-10-29T09:00:00Z");

  const sam = await makeCustomer(md.id, { firstName: "Sam", lastName: "Taylor" });
  const samPlan = await makePlan(md.id, sam.id, {
    priceMonthlyPence: 2299,
    mandateStatus: "active",
    activatedAt: at("2026-10-27T12:00:00Z"),
    createdAt: at("2026-10-27T10:00:00Z"),
    linkOpenedAt: at("2026-10-27T10:30:00Z"),
    stripeSubscriptionId: "sub_sam",
  });
  await offer(md.id, samPlan.id, sam.id, "sms", "2026-10-27T10:00:00Z");
  await paidInvoice("in_trial_sam", "sub_sam", 0, 0, "2026-10-27T12:00:00Z");

  // Jess: offered by WhatsApp, which never went. Her plan waits as PENDING
  // with no price, as every offer does until the customer picks.
  const jess = await makeCustomer(md.id, { firstName: "Jess", lastName: "Brown" });
  const jessPlan = await makePlan(md.id, jess.id, { status: "PENDING", priceMonthlyPence: null, activatedAt: null, createdAt: at("2026-10-29T15:00:00Z") });
  await offer(md.id, jessPlan.id, jess.id, "whatsapp", "2026-10-29T15:00:00Z");

  // A staff engineer on 302 MD LTD's team: not an engineer of their own.
  await makeEngineer({ ownerId: md.id, createdAt: at("2026-10-15T09:00:00Z"), gasSafeVerifiedAt: at("2026-10-16T09:00:00Z") });

  // Verified with a plan on sale, but payments not set up.
  const noPayments = await makeEngineer({ createdAt: at("2026-10-11T09:00:00Z"), gasSafeVerifiedAt: at("2026-10-13T09:00:00Z"), attribution: { heardVia: "engineer" } });
  await prisma.planTier.create({ data: { engineerId: noPayments.id, name: "Basic", priceMonthlyPence: 1500, sortOrder: 0, status: "LIVE" } });

  // Verified, a plan on sale and payments set up, but no customers yet.
  const noCustomers = await makeEngineer({ createdAt: at("2026-10-15T09:00:00Z"), gasSafeVerifiedAt: at("2026-10-16T09:00:00Z"), stripeChargesEnabled: true });
  await prisma.planTier.create({ data: { engineerId: noCustomers.id, name: "Gold", priceMonthlyPence: 1999, sortOrder: 0, status: "LIVE" } });

  // Waiting for verification.
  const waiting = await makeEngineer({ createdAt: at("2026-10-20T09:00:00Z") });

  // Three accounts a tester deleted to sign up again.
  for (const day of ["2026-10-02", "2026-10-03", "2026-10-04"]) {
    await makeEngineer({ createdAt: at(`${day}T09:00:00Z`), deletedAt: at("2026-10-28T20:00:00Z"), attribution: { heardVia: "letter" } });
  }

  // Testers' sign-ups that said they heard by letter, marked as test data,
  // with a customer, an offer and a payment of their own.
  const testers = [];
  for (const day of ["2026-10-05", "2026-10-06"]) {
    const t = await makeEngineer({ createdAt: at(`${day}T09:00:00Z`), gasSafeVerifiedAt: at(`${day}T10:00:00Z`), stripeChargesEnabled: true, attribution: { heardVia: "letter" } });
    await prisma.adminTestMark.create({ data: { subjectType: "engineer", subjectId: t.id, adminId: "adm_test_super", adminName: "Test Super" } });
    testers.push(t);
  }
  const testCustomer = await makeCustomer(testers[0].id);
  const testPlan = await makePlan(testers[0].id, testCustomer.id, { mandateStatus: "active", activatedAt: at("2026-10-28T12:00:00Z"), stripeSubscriptionId: "sub_test", createdAt: at("2026-10-28T10:00:00Z"), linkOpenedAt: at("2026-10-28T10:01:00Z") });
  await offer(testers[0].id, testPlan.id, testCustomer.id, "sms", "2026-10-28T10:00:00Z");
  await paidInvoice("in_test_1", "sub_test", 5000, 1000, "2026-10-29T09:00:00Z");

  return { md, oliver, oliverPlan, sam, samPlan, jess, jessPlan, noPayments, noCustomers, waiting, testers, testCustomer };
}
