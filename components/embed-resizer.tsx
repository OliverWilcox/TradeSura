"use client";

import { useEffect } from "react";

// Tells /embed.js on the host page how tall the plans are, so the iframe
// fits its content instead of scrolling inside the engineer's website.
export function EmbedResizer({ slug }: { slug: string }) {
  useEffect(() => {
    const post = () =>
      window.parent?.postMessage(
        { type: "tradesura:height", slug, height: document.documentElement.scrollHeight },
        "*",
      );
    post();
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [slug]);
  return null;
}
