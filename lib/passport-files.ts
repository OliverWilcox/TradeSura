import { put } from "@vercel/blob";

// Matt, 4 Nov — what an engineer can add to a boiler or a visit on a Home
// Passport. The homeowner sees every file; each engineer only their own.
export const PASSPORT_FILE_KINDS = {
  boiler: "Boiler",
  data_plate: "Data plate",
  repair: "Repair work",
  parts: "Parts fitted",
  invoice: "Invoice",
  certificate: "Certificate",
  other: "Other",
} as const;
export type PassportFileKind = keyof typeof PASSPORT_FILE_KINDS;
export const FILE_KIND_KEYS = Object.keys(PASSPORT_FILE_KINDS) as [PassportFileKind, ...PassportFileKind[]];

// Sent as base64 JSON (the app's FormData uploads are unreliable), which
// grows by a third: 3 MB of file stays under Vercel's 4.5 MB request limit.
export const MAX_FILE_BYTES = 3 * 1024 * 1024;
const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

export function isPdf(contentType: string) {
  return contentType === "application/pdf";
}

export async function storePassportFile(
  base64: string,
  mimeType: string,
): Promise<{ url: string; contentType: string } | { error: string }> {
  const ext = TYPES[mimeType];
  if (!ext) return { error: "Add a photo or a PDF." };
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0) return { error: "That file couldn't be read. Try again." };
  if (buffer.length > MAX_FILE_BYTES) return { error: "That file is too big. Keep it under 3 MB." };
  // A PDF that isn't one (or a photo pretending to be a PDF) is refused.
  if (ext === "pdf" && buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return { error: "That PDF couldn't be read. Try again." };
  }
  // Public Blob behind an unguessable path, like the passport photos: only
  // the homeowner's passport (after its code) and the engineer who added it
  // ever show the address.
  const blob = await put(`passport-files/file.${ext}`, buffer, { access: "public", contentType: mimeType, addRandomSuffix: true });
  return { url: blob.url, contentType: mimeType };
}

export type PassportFileView = {
  id: string;
  kind: PassportFileKind;
  kindLabel: string;
  label: string | null;
  url: string;
  contentType: string;
  recordId: string | null;
  createdAt: string;
};

export function fileView(f: {
  id: string;
  kind: string;
  label: string | null;
  url: string;
  contentType: string;
  serviceRecordId: string | null;
  createdAt: Date;
}): PassportFileView {
  const kind = (f.kind in PASSPORT_FILE_KINDS ? f.kind : "other") as PassportFileKind;
  return {
    id: f.id,
    kind,
    kindLabel: PASSPORT_FILE_KINDS[kind],
    label: f.label,
    url: f.url,
    contentType: f.contentType,
    recordId: f.serviceRecordId,
    createdAt: f.createdAt.toISOString(),
  };
}
