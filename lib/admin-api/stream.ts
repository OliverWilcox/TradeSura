// Long lists (CSV exports) as newline-delimited JSON: one object per line,
// sent batch by batch as they're read, ending with {"end":true,"count":N}.
// A stream that stops without that last line didn't finish, and the caller
// must treat what it got as incomplete.

export function ndjson<T>(batches: AsyncGenerator<T[]>, requestId: string): Response {
  const encoder = new TextEncoder();
  let count = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await batches.next();
          if (next.done) {
            controller.enqueue(encoder.encode(`${JSON.stringify({ end: true, count })}\n`));
            controller.close();
            return;
          }
          count += next.value.length;
          controller.enqueue(encoder.encode(next.value.map((item) => `${JSON.stringify(item)}\n`).join("")));
        } catch (err) {
          console.error(`[admin-api] export stream failed (request ${requestId}):`, err);
          controller.error(err);
        }
      },
      async cancel() {
        await batches.return(undefined);
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } },
  );
}
