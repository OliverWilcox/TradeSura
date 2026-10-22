import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { activeMonthlyPence } from "@/lib/plans";

export const dynamic = "force-dynamic";

// E10 — the WhatsApp share image, name-stamped with the referrer's business
// and their locked-in annual income. Rendered with next/og (no extra dep).
// Each text div gets ONE string child (template literals, not JSX text +
// {expr}): next/og throws on a non-flex div with several child nodes, which
// 500'd this route and left the referral screen's card blank.
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug") ?? "";
  const engineer = await prisma.engineer.findUnique({ where: { slug } });
  if (!engineer) return new Response("Not found", { status: 404 });

  const { totalPence } = await activeMonthlyPence(engineer.id);
  const yearly = Math.round((totalPence * 12) / 100).toLocaleString();
  const brand = brandName(engineer);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#0B1A2E",
          color: "#fff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 30, color: "#5FA3F0", letterSpacing: 2 }}>
          {`${brand.toUpperCase()} RECOMMENDS`}
        </div>
        <div style={{ fontSize: 84, fontWeight: 800, marginTop: 8 }}>TradeSura</div>
        <div style={{ fontSize: 96, fontWeight: 800, color: "#3DD68C", marginTop: 24 }}>
          {`£${yearly}/yr`}
        </div>
        <div style={{ fontSize: 34, color: "#9FB6D0", marginTop: 8 }}>
          locked in with care plans
        </div>
        <div style={{ fontSize: 26, color: "#9FB6D0", marginTop: 40 }}>
          {`Free account · you keep 80% · paid weekly · tradesura.com/join/${slug}`}
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
