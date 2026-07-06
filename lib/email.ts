// Thin email provider interface with a console/dev driver (CLAUDE.md §Stack).
// Real provider keys are a human task.
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}) {
  console.log(
    `[EMAIL] to=${opts.to} subject="${opts.subject}"\n${opts.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400)}`,
  );
}
