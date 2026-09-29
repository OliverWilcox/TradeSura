import { SiteHeader } from "@/components/site-header";

// Linked from the engineer signup (29 Sept review: "Terms of Service and
// Privacy Policy must be tappable links"). Placeholder until the solicitor's
// wording lands — replace the body, keep the route.
export const metadata = { title: "Privacy policy — TradeSura" };

export default function Page() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl px-6 py-12">
        <h1 className="text-3xl font-bold">Privacy policy</h1>
        <p className="mt-2 text-sm text-muted">
          Draft — pending solicitor review
        </p>
        <p className="mt-6 leading-7">
          How TradeSura collects, uses and protects engineers&apos; and
          customers&apos; personal data under UK GDPR. The full policy is being
          finalised with our solicitor and will be published here before launch.
        </p>
        <p className="mt-4 leading-7">
          Questions in the meantime: support@tradesura.com
        </p>
      </main>
    </>
  );
}
