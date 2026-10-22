"use client";

import { btnClass } from "@/components/ui";

export function PrintButton({ label = "Save as PDF or print" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={`${btnClass()} print:hidden`}>
      {label}
    </button>
  );
}
