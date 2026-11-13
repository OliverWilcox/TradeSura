import { Share } from "react-native";
import * as Haptics from "expo-haptics";
import { findClaimCode } from "@/lib/claim-code";

export { findClaimCode };

// expo-clipboard is a native module: builds made before it was added don't
// have it, and requiring it there throws. Those builds fall back to the
// share sheet, which has its own Copy.
export async function copyText(text: string): Promise<"copied" | "shared"> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Clipboard = require("expo-clipboard") as typeof import("expo-clipboard");
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    return "copied";
  } catch {
    await Share.share({ message: text }).catch(() => {});
    return "shared";
  }
}

// 30 Oct update 3.2 — "Paste your code" on the front screen. Null when the
// clipboard is empty, unreadable (permission declined, older build without
// expo-clipboard) or holds no claim code.
export async function pasteClaimCode(): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Clipboard = require("expo-clipboard") as typeof import("expo-clipboard");
    return findClaimCode(await Clipboard.getStringAsync());
  } catch {
    return null;
  }
}
