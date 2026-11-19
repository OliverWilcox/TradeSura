export const GAS_SAFE_REGISTER_URL = "https://www.gassaferegister.co.uk/find-an-engineer-or-check-the-register/check-an-engineer/";

export function gasSafeRegisterLink(): string {
  return GAS_SAFE_REGISTER_URL;
}

export type RegisterSearch = { url: string; number: string; kind: "licence" | "registration" };

export function gasSafeRegisterSearch(read: { licenceNo: string | null; registrationNo: string | null } | null): RegisterSearch | null {
  if (read?.licenceNo) return { url: GAS_SAFE_REGISTER_URL, number: read.licenceNo, kind: "licence" };
  if (read?.registrationNo) return { url: GAS_SAFE_REGISTER_URL, number: read.registrationNo, kind: "registration" };
  return null;
}
