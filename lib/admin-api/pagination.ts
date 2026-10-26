import { z } from "zod";

// List endpoints take ?page=&size= (1-based, 1–100 a page) and answer
// { items, page, size, total }.

export const pageParams = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  size: z.coerce.number().int().min(1).max(100).default(25),
};

export const sortDir = z.enum(["asc", "desc"]).optional();

export type Page<T> = { items: T[]; page: number; size: number; total: number };

export function pageArgs(q: { page: number; size: number }) {
  return { skip: (q.page - 1) * q.size, take: q.size };
}

export function page<T>(items: T[], total: number, q: { page: number; size: number }): Page<T> {
  return { items, page: q.page, size: q.size, total };
}
