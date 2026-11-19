import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";

function authorised(key: string | undefined): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !key || key.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(key), Buffer.from(secret));
}

export default async function Verifications({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  const { key } = await searchParams;
  if (!authorised(key)) return <main className="p-8 text-sm text-muted">Not found.</main>;
  const admin = process.env.ADMIN_APP_URL?.trim().replace(/\/$/, "");
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-bold">Gas Safe checks have moved</h1>
      <p className="mt-3 text-sm">
        Card checks, register checks, member packs and qualifications are in TradeSura Admin.{" "}
        {admin ? (
          <a className="font-semibold underline" href={`${admin}/verification`}>
            Open the verification queue
          </a>
        ) : null}
      </p>
    </main>
  );
}
