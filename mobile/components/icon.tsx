import { SymbolView, type SymbolWeight } from "expo-symbols";

// Build Guide v2 Part 2.4: "Icons — one native family (SF Symbols), consistent
// line weight. No emoji as icons." Every icon in the app goes through this
// component so the family stays single: SF Symbols on iOS, the matching
// Material Symbol on Android (expo-symbols renders both natively — no
// third-party icon font). Add names here, never inline a glyph or emoji.
const ICONS = {
  home: { ios: "house", android: "home" },
  customers: { ios: "person.2", android: "group" },
  reminders: { ios: "bell", android: "notifications" },
  payouts: { ios: "sterlingsign.circle", android: "currency_pound" },
  addCustomer: { ios: "person.badge.plus", android: "person_add" },
  back: { ios: "chevron.left", android: "chevron_left" },
  chevron: { ios: "chevron.right", android: "chevron_right" },
  check: { ios: "checkmark", android: "check" },
  verified: { ios: "checkmark.circle.fill", android: "check_circle" },
  service: { ios: "wrench.and.screwdriver", android: "build" },
  clock: { ios: "clock", android: "schedule" },
  referral: { ios: "hand.raised", android: "handshake" },
  plans: { ios: "list.bullet.rectangle", android: "receipt_long" },
  phone: { ios: "iphone", android: "smartphone" },
  warning: { ios: "exclamationmark.triangle", android: "warning" },
  pending: { ios: "clock.badge.exclamationmark", android: "pending" },
  growth: { ios: "chart.line.uptrend.xyaxis", android: "trending_up" },
  chat: { ios: "bubble.left", android: "chat" },
  document: { ios: "doc.text", android: "description" },
  close: { ios: "xmark", android: "close" },
  camera: { ios: "camera", android: "photo_camera" },
  invite: { ios: "heart", android: "volunteer_activism" },
  howItWorks: { ios: "checkmark.circle", android: "task_alt" },
  shop: { ios: "shippingbox", android: "inventory_2" },
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 20,
  color = "#f3f7fb",
  weight = "medium",
}: {
  name: IconName;
  size?: number;
  color?: string;
  /** iOS-only; Android renders the regular Material weight. */
  weight?: SymbolWeight;
}) {
  const symbol = ICONS[name];
  return (
    <SymbolView
      name={{ ios: symbol.ios, android: symbol.android }}
      size={size}
      tintColor={color}
      weight={weight}
      resizeMode="scaleAspectFit"
    />
  );
}
