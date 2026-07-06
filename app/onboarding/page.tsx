import { requireEngineer } from "@/lib/auth";
import { Brandmark } from "@/components/shells";
import { OnboardingForm } from "@/components/onboarding-form";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ gc?: string }>;
}) {
  const engineer = await requireEngineer();
  const { gc } = await searchParams;

  return (
    <div className="flex-1 flex flex-col max-w-md w-full mx-auto min-h-screen bg-panel px-4">
      <div className="flex justify-between items-center pt-3 pb-2">
        <Brandmark />
        <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-faint">
          {engineer.gasSafeVerifiedAt ? "Step 3 of 3" : "Step 2 of 3"}
        </span>
      </div>
      <OnboardingForm
        verified={Boolean(engineer.gasSafeVerifiedAt)}
        gcConnected={Boolean(engineer.gcOrganisationId)}
        gcStatus={gc ?? null}
        initial={{
          regNo: engineer.gasSafeNo ?? "",
          name: engineer.gasSafeName,
          company: engineer.gasSafeCompany,
          categories: engineer.gasSafeCategories,
          tradingName: engineer.tradingName ?? "",
        }}
      />
    </div>
  );
}
