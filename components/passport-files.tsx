import { PASSPORT_FILE_KINDS, isPdf, type PassportFileKind } from "@/lib/passport-files";

type FileRow = { id: string; kind: string; label: string | null; url: string; contentType: string };

const kindLabel = (k: string) => PASSPORT_FILE_KINDS[(k in PASSPORT_FILE_KINDS ? k : "other") as PassportFileKind];

// Matt, 4 Nov — the engineers' photos and documents on the homeowner's
// passport: photos as thumbnails, PDFs (invoices, certificates) as tiles,
// each opening in a new tab.
export function PassportFiles({ files }: { files: FileRow[] }) {
  if (files.length === 0) return null;
  return (
    <div className="flex gap-2 flex-wrap mt-2.5">
      {files.map((f) => {
        const title = f.label || kindLabel(f.kind);
        return (
          <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="w-[4.5rem] text-center" title={title}>
            {isPdf(f.contentType) ? (
              <span className="flex w-[4.5rem] h-16 items-center justify-center rounded-lg border border-line bg-paper font-mono text-[11px] font-semibold text-flame">
                PDF
              </span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.url} alt={title} className="w-[4.5rem] h-16 object-cover rounded-lg border border-line" />
            )}
            <span className="block mt-1 text-[10.5px] leading-tight text-muted truncate">{title}</span>
          </a>
        );
      })}
    </div>
  );
}
