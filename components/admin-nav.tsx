import Link from "next/link";

// Review 3 §9 — Mohammed's admin area. Every page carries the ADMIN_SECRET
// key in the query string, so the nav passes it along.
const PAGES = [
  { href: "/admin/engineers", label: "Engineers" },
  { href: "/admin/verifications", label: "Verification queue" },
  { href: "/admin/retention", label: "Retention" },
] as const;

export function AdminNav({ adminKey, current }: { adminKey: string; current: (typeof PAGES)[number]["href"] }) {
  return (
    <nav className="mb-6 flex flex-wrap gap-2 text-sm">
      {PAGES.map((p) => (
        <Link
          key={p.href}
          href={`${p.href}?key=${encodeURIComponent(adminKey)}`}
          aria-current={p.href === current ? "page" : undefined}
          className={`rounded-lg border px-3 py-1.5 font-semibold ${
            p.href === current ? "border-white bg-white text-[#0f2140]" : "border-line text-ink"
          }`}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
