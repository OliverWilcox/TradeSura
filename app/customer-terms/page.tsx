import { SiteHeader } from "@/components/site-header";
import { CURRENT_TERMS_VERSION, TERMS_SUMMARY } from "@/lib/terms";
import { NOT_INCLUDED_COPY } from "@/lib/clauses";

// Linked from the plan builder's Step 4 promise ("I'll provide everything in
// this plan … under the TradeSura customer terms"). Shows the same summary
// customers agree to at checkout until the solicitor's full wording lands.
export const metadata = { title: "Customer plan terms — TradeSura" };

export default function Page() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl px-6 py-12">
        <h1 className="text-3xl font-bold">Customer plan terms</h1>
        <p className="mt-2 text-sm text-muted">Version {CURRENT_TERMS_VERSION} · draft, pending solicitor review</p>
        <p className="mt-6 leading-7">{TERMS_SUMMARY}</p>
        <p className="mt-4 leading-7">{NOT_INCLUDED_COPY}</p>
        <h2 className="mt-8 text-xl font-semibold">What the engineer agrees to</h2>
        <p className="mt-3 leading-7">
          Before a plan goes live, the engineer confirms they will provide everything listed in it
          to every customer on it. Each plan&apos;s services are described in the plan document the
          customer receives when they join.
        </p>
        <p className="mt-4 leading-7">Questions: support@tradesura.com</p>
      </main>
    </>
  );
}
