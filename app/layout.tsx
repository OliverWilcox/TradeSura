import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TradeSura",
  description: "Care plans for gas engineers, collected by Direct Debit",
  manifest: "/manifest.json",
};

// Build Spec v1 §1: system font stack, no custom webfonts.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-GB" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
