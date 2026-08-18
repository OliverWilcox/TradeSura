import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";

// Engineer profile — used by the mobile app to gate onboarding vs. the tab
// shell, and to pre-fill the onboarding form.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const engineer = await prisma.engineer.findUnique({ where: { id: engineerId } });
  if (!engineer) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json({
    id: engineer.id,
    email: engineer.email,
    firstName: engineer.firstName,
    lastName: engineer.lastName,
    phone: engineer.phone,
    phoneVerifiedAt: engineer.phoneVerifiedAt,
    businessType: engineer.businessType,
    companyNumber: engineer.companyNumber,
    postcode: engineer.postcode,
    tradingName: engineer.tradingName,
    slug: engineer.slug,
    gasSafeVerifiedAt: engineer.gasSafeVerifiedAt,
    gasSafeNo: engineer.gasSafeNo,
    gasSafeName: engineer.gasSafeName,
    gasSafeCompany: engineer.gasSafeCompany,
    gasSafeCategories: engineer.gasSafeCategories,
    gcConnected: Boolean(engineer.gcOrganisationId),
    gcOrganisationId: engineer.gcOrganisationId,
  });
}
