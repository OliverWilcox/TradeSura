import { Linking } from "react-native";
import { noteTrouble } from "@/lib/api";

// TradeSura's own support line (Review 4 — replaces the 07700 placeholder).
// One place for the number so the WhatsApp links can't drift apart.
export const SUPPORT_PHONE = "0330 223 8456";

export const WHATSAPP_SUPPORT_URL =
  "https://wa.me/443302238456?text=" + encodeURIComponent("TradeSura support: ");

// Opening support chat counts as trouble: no rating prompt straight after
// (Matt, 30 Oct §8).
export function openSupportChat() {
  noteTrouble();
  Linking.openURL(WHATSAPP_SUPPORT_URL).catch(() => {});
}
