import { appUrl } from "@/lib/app-url";

// The homeowner's Home Passport link, as it goes out in texts and emails.
// One place, so how the link is made (and checked) can change without
// touching every message.
export function passportUrl(viewToken: string): string {
  return `${appUrl()}/passport/${viewToken}`;
}
