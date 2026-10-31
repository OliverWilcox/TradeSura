import { beforeEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET as engineerAccounts } from "@/app/api/admin/v1/accounts/engineers/route";
import { POST as tell } from "@/app/api/admin/v1/accounts/engineers/[engineerId]/tell-customers/route";
import { POST as remove } from "@/app/api/admin/v1/accounts/delete/route";
import { call, resetDb } from "./helpers";
import { makeCustomer, makeEngineer, makePlan } from "./factories";

// 7.3: an engineer with customers on a live plan can't be deleted until
// those customers have been told, and offered an engineer near them.

const sent = vi.hoisted(() => ({ sms: vi.fn(async () => ({ sent: true })), email: vi.fn(async () => undefined) }));
vi.mock("@/lib/sms", () => ({ sendSms: sent.sms, notifyEngineer: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: sent.email }));

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
});

it("asks for the customers to be told first, tells them, and says so", async () => {
  const leaving = await makeEngineer({ tradingName: "Leaving Heating" });
  const customer = await makeCustomer(leaving.id, { firstName: "Oliver" });
  await makePlan(leaving.id, customer.id, { status: "ACTIVE" });

  const before = (await call(engineerAccounts)).body.items.find((i: { id: string }) => i.id === leaving.id);
  expect(before).toMatchObject({ untoldCustomers: 1, blocked: expect.stringContaining("Tell the customer first") });
  expect((await call(remove, { body: { engineerIds: [leaving.id], customerIds: [] } })).body.items[0].outcome).toBe("refused");

  const res = await call(tell, { params: { engineerId: leaving.id } });
  expect(res.body).toEqual({ offered: 1 });
  expect(sent.sms).toHaveBeenCalledWith(expect.objectContaining({ to: customer.phone, body: expect.stringContaining("Leaving Heating is no longer offering care plans through TradeSura") }));
  expect(await prisma.event.findFirst({ where: { name: "engineer_customers_told" } })).toMatchObject({ actorType: "ADMIN" });

  const after = (await call(engineerAccounts)).body.items.find((i: { id: string }) => i.id === leaving.id);
  expect(after).toMatchObject({ untoldCustomers: 0, blocked: expect.stringMatching(/^Customers told on .* once their plan has ended/) });
});
