import type { Metadata } from "next";
import { ClaimForm, type Resolved } from "@/components/claim-form";
import { resolveClaimCode } from "@/lib/claim";
import { track } from "@/lib/track";

export const metadata: Metadata = {
  title: "Claim your TradeSura account",
  description: "Enter the claim code from your letter to set up your free TradeSura account.",
};

export const dynamic = "force-dynamic";

export default async function ClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;

  let initialResolved: Resolved = null;
  if (code) {
    const r = await resolveClaimCode(code);
    initialResolved = r.valid
      ? { valid: true, personalised: r.personalised, firstName: r.firstName, businessName: r.businessName }
      : { valid: false };
    await track(r.valid ? "claim_code_resolved" : "claim_code_failed", { type: "SYSTEM" }, {
      code: code.slice(0, 20),
      source: "qr",
    });
  }

  return (
    <div className="flex flex-col max-w-md w-full mx-auto min-h-screen bg-panel">
      <header className="bg-flame text-white px-5 py-7 text-center">
        <div className="font-disp text-2xl font-bold uppercase tracking-wide">
          Trade<span className="text-[#7EE2AE]">Sura</span>
        </div>
        <div className="text-[13px] opacity-90 mt-1">Your trade. On plan.</div>
      </header>
      <main className="flex-1 flex flex-col gap-3.5 px-5 py-7 text-center">
        <h1 className="font-disp text-xl font-bold uppercase tracking-wide">
          Claim your free account
        </h1>
        <p className="text-sm text-muted -mt-1">Enter the claim code from your letter.</p>
        <ClaimForm initialCode={code} initialResolved={initialResolved} />
      </main>
      <footer className="font-mono text-[10px] text-faint text-center px-4 py-3">
        Care plans are ongoing service agreements with your engineer, not insurance products.
      </footer>
    </div>
  );
}
