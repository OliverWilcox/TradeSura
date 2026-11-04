// Matt, 4 Nov: checks are made on the live Gas Safe Register, never against
// a stored list, and we never call any list of ours "the register". The
// register's own site has the "check an engineer" search; it blocks
// automated visits, so a link that opens one licence number's result
// hasn't been confirmed yet. Until it is, this opens the register and the
// number is shown beside the link.
export const GAS_SAFE_REGISTER_URL = "https://www.gassaferegister.co.uk/";

export function gasSafeRegisterLink(): string {
  return GAS_SAFE_REGISTER_URL;
}
