import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { saveCardDetails } from "@/lib/admin/verifications";
import { cleanRegistration, EXPIRY_YEARS_AHEAD, expiryTooFar, typedName } from "@/lib/card-read";

const digits = (n: number, label: string) =>
  z
    .string({ error: `Enter the ${label}.` })
    .transform((s) => s.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(new RegExp(`^\\d{${n}}$`), `The ${label} is ${n} digits.`));

const Body = z.strictObject({
  licenceNo: digits(7, "licence number"),
  registrationNo: z
    .string({ error: "Enter the registration number." })
    .transform((s) => s.replace(/[\s-]/g, ""))
    .refine((s) => cleanRegistration(s) !== null, "The registration number is up to 6 digits."),
  name: z
    .string({ error: "Enter the name on the card." })
    .trim()
    .max(120)
    .refine((s) => typedName(s) !== null, "Enter the name as it's printed on the card."),
  expiresOn: z.iso
    .date({ error: "Enter the card's expiry date." })
    .refine((d) => !expiryTooFar(d), `A Gas Safe card expires within ${EXPIRY_YEARS_AHEAD} years. Check the date on the card.`),
  categories: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  revision: z.string().regex(/^[0-9a-f]{16}$/, "Reload the application and try again.").optional(),
});

export const POST = adminRoute<{ engineerId: string }>("verification:decide", async ({ req, admin, params }) =>
  saveCardDetails(admin, params.engineerId, await parseBody(req, Body)),
);
