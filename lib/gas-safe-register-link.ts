// Matt, 4 Nov: checks are made on the live Gas Safe Register, never against
// a stored list, and we never call any list of ours "the register". This
// opens the register's own "check an engineer" search, with the number shown
// beside the link to paste in: the register's results are addressed by its
// own encrypted ID, not by licence number, so no link can open one number's
// result.
export const GAS_SAFE_REGISTER_URL = "https://www.gassaferegister.co.uk/find-an-engineer-or-check-the-register/check-an-engineer/";

export function gasSafeRegisterLink(): string {
  return GAS_SAFE_REGISTER_URL;
}
