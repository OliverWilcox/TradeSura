import { z } from "zod";
import { AdminApiError, parseQuery } from "@/lib/admin-api/route";

// ?from=&to= as ISO instants, `to` exclusive. The admin app works out the
// range (presets, UK days) and sends its exact edges.

const RangeQuery = z.strictObject({
  from: z.iso.datetime({ offset: true, error: "Use an ISO date and time." }),
  to: z.iso.datetime({ offset: true, error: "Use an ISO date and time." }),
});

const MAX_DAYS = 400;

/** TradeSura's data starts in 2026; anything far outside these years is a mistake, not a range. */
const EARLIEST = new Date("2000-01-01T00:00:00Z");
const LATEST = new Date("2100-01-01T00:00:00Z");

export function parseRange(req: Request) {
  const q = parseQuery(req, RangeQuery);
  const from = new Date(q.from);
  const to = new Date(q.to);
  if (from < EARLIEST || to > LATEST) {
    throw new AdminApiError(400, "VALIDATION", "Choose dates between 2000 and 2100.", { from: ["Choose dates between 2000 and 2100."] });
  }
  if (from >= to) throw new AdminApiError(400, "VALIDATION", "The start must be before the end.", { from: ["Must be before the end."] });
  if (to.getTime() - from.getTime() > MAX_DAYS * 86_400_000) {
    throw new AdminApiError(400, "VALIDATION", "Choose a range of 400 days or less.", { from: ["Choose a range of 400 days or less."] });
  }
  return { from, to };
}
