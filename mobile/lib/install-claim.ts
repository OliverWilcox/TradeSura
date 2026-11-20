import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import { api } from "@/lib/api";
import { findClaimCode } from "@/lib/claim-code";

// Letter → app without Branch or AppsFlyer (Matt, 13 Nov): on the very first
// open, a letter's claim code that came through the install, so the engineer
// lands on their own claim screen without typing it.
//   1. Android: the Play Store passes the code through (the claim page's
//      store link carries referrer=claim=CODE).
//   2. iPhone: the claim page copied the code; the clipboard still has it
//      (iOS asks "Allow paste" once).
//   3. Either: the server matches the network that opened the claim page in
//      the last hour, when exactly one did (app/api/claim/install-match).
// Runs once per install; null when nothing turns up (Paste your code and the
// code box are still there).

// A file in the app's own documents, not the keychain: iOS keeps keychain
// items after the app is deleted, and a reinstall must check again (Matt's
// 20-scan test reinstalls).
const CHECKED_FILE = "install-claim-checked";

async function fromPlayStore(): Promise<string | null> {
  if (Platform.OS !== "android") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Application = require("expo-application") as typeof import("expo-application");
    const referrer = await Application.getInstallReferrerAsync();
    const claim = new URLSearchParams(referrer).get("claim");
    return findClaimCode(claim);
  } catch {
    return null;
  }
}

async function fromClipboard(): Promise<string | null> {
  if (Platform.OS !== "ios") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Clipboard = require("expo-clipboard") as typeof import("expo-clipboard");
    // Only read (and so only show iOS's paste prompt) when there's text there.
    if (!(await Clipboard.hasStringAsync())) return null;
    return findClaimCode(await Clipboard.getStringAsync());
  } catch {
    return null;
  }
}

async function fromServer(): Promise<string | null> {
  try {
    const { code } = await api<{ code: string | null }>("/api/claim/install-match");
    return findClaimCode(code);
  } catch {
    return null;
  }
}

export async function installClaimCode(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const marker = new File(Paths.document, CHECKED_FILE);
    if (marker.exists) return null;
    marker.create();
  } catch {
    return null;
  }
  return (await fromPlayStore()) ?? (await fromClipboard()) ?? (await fromServer());
}
