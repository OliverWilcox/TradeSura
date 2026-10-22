import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { brandName, tradingNameOf } from "@/lib/engineer";
import { CustomerShell } from "@/components/shells";
import { Card } from "@/components/ui";
import { RatingForm } from "@/components/rating-form";

export const metadata: Metadata = { title: "Rate your service", robots: { index: false } };

// Section 5 — the one-tap rating page linked from the text/email the
// customer gets after a logged service.
export default async function RatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rating = await prisma.rating.findUnique({
    where: { requestToken: token },
    include: { engineer: true, serviceRecord: { select: { doneAt: true } } },
  });
  if (!rating) notFound();
  const brand = brandName(rating.engineer);
  const when = rating.serviceRecord.doneAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <CustomerShell tradingName={brand} legalLine={tradingNameOf(rating.engineer)} sub={`Service on ${when}`}>
      {rating.ratedAt ? (
        <Card className="text-center py-6">
          <div className="text-2xl text-flame" aria-hidden>
            {"★".repeat(rating.stars ?? 0)}
          </div>
          <p className="font-semibold mt-2">You&apos;ve already rated this service</p>
          <p className="text-xs text-muted mt-1">Thank you — it&apos;s on {brand}&apos;s page.</p>
        </Card>
      ) : (
        <RatingForm token={token} brand={brand} />
      )}
      <p className="text-[11px] text-muted text-center">
        Every rating is published, good or bad. Ratings come only from {brand}&apos;s plan customers.
      </p>
    </CustomerShell>
  );
}
