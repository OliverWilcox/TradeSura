import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyToken } from "@/lib/auth";
import { cleanCardPhoto } from "@/lib/gas-safe-card";
import { readGasSafeCard, type CardImage } from "@/lib/card-read";

export const maxDuration = 60;

// How long sign-up waits for the reading before carrying on without it.
const READ_WAIT_MS = 25_000;

const Photo = z.object({ base64: z.string().min(1), mimeType: z.string().min(1) });
const Body = z.object({ phoneToken: z.string().min(1), front: Photo, back: Photo.optional() });

export type CardProblem = "not_a_card" | "not_readable" | "screen_photo" | "expired";

// Matt 16 Nov — sign-up step 2 reads the card the moment the photo is taken,
// so the numbers and expiry pre-fill and a bad photo is retaken on the spot.
// Uses Muhammad's card reader (lib/card-read.ts) and stores nothing: the
// photos are stored by /api/onboarding/gas-safe-card on Continue, and his
// full card check runs on the finished account as usual. Never blocks: no
// reading (not set up, slow, error) just means the engineer types as before.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Add a photo of your Gas Safe ID card." }, { status: 400 });
  const phone = await verifyToken(parsed.data.phoneToken);
  if (phone?.verified !== "1" || !phone.phone) {
    return NextResponse.json({ error: "Phone verification expired — go back and verify your mobile number again." }, { status: 400 });
  }
  const image = (p: z.infer<typeof Photo>): CardImage | { error: string } => {
    const clean = cleanCardPhoto(Buffer.from(p.base64, "base64"), p.mimeType);
    return clean.ok ? { bytes: clean.bytes, mediaType: clean.type } : { error: clean.error };
  };
  const front = image(parsed.data.front);
  if ("error" in front) return NextResponse.json({ error: front.error }, { status: 400 });
  const back = parsed.data.back ? image(parsed.data.back) : null;
  if (back && "error" in back) return NextResponse.json({ error: back.error, field: "back" }, { status: 400 });

  const reading = await Promise.race([
    readGasSafeCard(front, back).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_WAIT_MS)),
  ]);
  if (!reading || reading.outcome === "error" || reading.outcome === "not_set_up") return NextResponse.json({ reading: null, problem: null });

  const today = new Date().toISOString().slice(0, 10);
  const problem: CardProblem | null =
    reading.outcome === "not_a_card" || reading.isGasSafeCard === false
      ? "not_a_card"
      : reading.outcome === "unreadable"
        ? "not_readable"
        : reading.suspect
          ? "screen_photo"
          : reading.expiresOn && reading.expiresOn < today
            ? "expired"
            : null;
  return NextResponse.json({
    reading: {
      licenceNumber: reading.licenceNo,
      registrationNumber: reading.registrationNo,
      expiresOn: reading.expiresOn,
      holderName: reading.name,
      businessName: reading.company,
    },
    problem,
  });
}
