"use client";

import { useEffect } from "react";

// The welcome screen shows on first open only. Marking it seen client-side
// keeps the page itself a cacheable server component.
// ponytail: cookie, no server round-trip; move to middleware if it ever needs
// to survive a cleared browser
export function SeenWelcome() {
  useEffect(() => {
    document.cookie = `ts_welcome=1; max-age=${60 * 60 * 24 * 365}; path=/; samesite=lax`;
  }, []);
  return null;
}
