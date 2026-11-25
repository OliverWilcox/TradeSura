import type { IconName } from "@/components/icon";

// Ali's final member pack (the list admin packs from), shared by Getting
// started, the Member pack screen and How it works so the app can't drift
// from what's actually posted again (Matt, 16 Nov).
export const MEMBER_PACK: { label: string; detail: string; icon: IconName }[] = [
  { label: "Cover letter", detail: "Welcome to TradeSura", icon: "document" },
  { label: "Quick-start booklet", detail: "Offering plans in under 90 seconds", icon: "booklet" },
  { label: "Show cards", detail: "3–4 cards to show customers your plans", icon: "cards" },
  { label: "Boiler stickers", detail: "20–30 QR stickers, one on each boiler you service", icon: "qr" },
  { label: "Van stickers", detail: "5 Verified Member stickers for your van", icon: "van" },
];
