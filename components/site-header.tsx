import Link from "next/link";
import { RingMark } from "@/components/ring-mark";

// Public site header — the mark home on the left, the legal pages on the
// right so anyone can reach them from tradesura.com (not only from inside
// the app's signup).
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-bg-deep/70 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <Link href="/" className="flex items-center gap-2" aria-label="TradeSura home">
          <RingMark size={24} />
          <span className="text-lg font-extrabold">
            <span className="text-white">Trade</span>
            <span className="text-[#5FA3F0]">Sura</span>
          </span>
        </Link>
        <div className="flex items-center gap-5 text-sm text-muted">
          <Link href="/terms" className="hover:text-white">
            Terms of service
          </Link>
          <Link href="/privacy" className="hover:text-white">
            Privacy
          </Link>
        </div>
      </nav>
    </header>
  );
}
