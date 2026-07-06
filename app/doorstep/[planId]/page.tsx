import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireEngineer } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/shells";
import { Micro } from "@/components/ui";
import { DoorstepLive } from "@/components/doorstep-live";

export default async function DoorstepLivePage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const engineer = await requireEngineer();
  const { planId } = await params;
  const plan = await prisma.plan.findFirst({
    where: { id: planId, engineerId: engineer.id },
  });
  if (!plan) notFound();

  const link = `${process.env.APP_URL}/p/${engineer.slug}/signup/${plan.signupToken}`;
  const qrDataUrl = await QRCode.toDataURL(link, { width: 280, margin: 1 });

  return (
    <AppShell active="HOME" topRight={<Micro>Doorstep</Micro>}>
      <DoorstepLive planId={plan.id} link={link} qrDataUrl={qrDataUrl} />
    </AppShell>
  );
}
