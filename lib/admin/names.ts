// Does a name on a register belong to the applicant? Used for Companies
// House officers ("WOOD, Matthew Dean") and the Gas Safe register
// ("D. Smith"). A signal for the checker, never a decision:
//
// - match: same surname, and the same first name, or the register only has
//   an initial and it's theirs;
// - likely: same surname, and the first name is a short form of the
//   register's (Matt and Matthew), one starts the other, or it's one of the
//   register's middle names;
// - none: anything else.
//
// Case, accents, punctuation and the order (surname first, with a comma, or
// last) don't matter.

export type NameMatch = "match" | "likely" | "none";

/** Common short forms, each group the same name. */
const SAME_NAME: string[][] = [
  ["matthew", "matt", "mat", "matty"],
  ["david", "dave", "davey", "davy"],
  ["christopher", "chris", "kit"],
  ["michael", "mike", "mick", "mikey", "micky"],
  ["stephen", "steven", "steve", "stevie"],
  ["robert", "rob", "robbie", "bob", "bobby", "bert"],
  ["william", "will", "bill", "billy", "liam", "willie"],
  ["thomas", "tom", "tommy"],
  ["james", "jim", "jimmy", "jamie"],
  ["daniel", "dan", "danny"],
  ["andrew", "andy", "drew"],
  ["anthony", "tony", "ant"],
  ["nicholas", "nick", "nicky"],
  ["benjamin", "ben", "benny"],
  ["samuel", "sam", "sammy"],
  ["joseph", "joe", "joey"],
  ["alexander", "alex", "al", "sandy"],
  ["peter", "pete"],
  ["philip", "phillip", "phil"],
  ["richard", "rich", "rick", "ricky", "dick"],
  ["edward", "ed", "eddie", "ted", "ned"],
  ["jonathan", "jon", "jonny", "johnny"],
  ["john", "jack", "johnny"],
  ["kenneth", "ken", "kenny"],
  ["gregory", "greg"],
  ["timothy", "tim", "timmy"],
  ["patrick", "pat", "paddy"],
  ["raymond", "ray"],
  ["ronald", "ron", "ronnie"],
  ["donald", "don", "donnie"],
  ["gerald", "gerry", "ged"],
  ["terence", "terry"],
  ["lawrence", "laurence", "larry", "laurie"],
  ["frederick", "fred", "freddie"],
  ["henry", "harry", "hal"],
  ["charles", "charlie", "chas", "chuck"],
  ["douglas", "doug", "dougie"],
  ["stuart", "stewart", "stu"],
  ["leonard", "len", "lenny", "leo"],
  ["nathan", "nathaniel", "nat", "nate"],
  ["zachary", "zach", "zak"],
  ["katherine", "catherine", "kathryn", "kate", "katie", "cathy", "kath"],
  ["elizabeth", "liz", "lizzie", "beth", "betty", "eliza"],
  ["margaret", "maggie", "meg", "peggy"],
  ["rebecca", "becky", "becca"],
  ["jennifer", "jen", "jenny"],
  ["victoria", "vicky", "tori"],
  ["susan", "sue", "susie"],
  ["deborah", "debbie", "deb"],
  ["samantha", "sam", "sammy"],
  ["jessica", "jess", "jessie"],
];

const SAME = new Map<string, Set<string>>();
for (const group of SAME_NAME) for (const name of group) SAME.set(name, new Set([...(SAME.get(name) ?? []), ...group]));

/** Lower case, no accents, letters and spaces only; a hyphen or apostrophe joins nothing apart. */
function words(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** The register's forenames and surname: "SURNAME, Forenames" or "Forenames Surname" (the surname as long as the applicant's). */
function split(registered: string, surnameLength: number): { forenames: string[]; surname: string[] } {
  const comma = registered.indexOf(",");
  if (comma >= 0) return { surname: words(registered.slice(0, comma)), forenames: untitled(words(registered.slice(comma + 1))) };
  const all = untitled(words(registered));
  return { surname: all.slice(-surnameLength), forenames: all.slice(0, Math.max(0, all.length - surnameLength)) };
}

/** Companies House sometimes puts a title before the forenames. */
const TITLES = new Set(["mr", "mrs", "ms", "miss", "mx", "dr", "sir", "dame", "rev"]);
const untitled = (ws: string[]) => (ws.length > 1 && TITLES.has(ws[0]) ? ws.slice(1) : ws);

const sameName = (a: string, b: string) => a === b || SAME.get(a)?.has(b) === true;
/** "Matt" starts "Matthew", "Chris" starts "Christopher": three letters or more. */
const startsTheOther = (a: string, b: string) => Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a));

export function matchPersonName(registered: string, firstName: string | null, lastName: string | null): NameMatch {
  const first = words(firstName ?? "");
  const surname = words(lastName ?? "");
  if (!first.length || !surname.length || !registered.trim()) return "none";
  const reg = split(registered, surname.length);
  if (reg.surname.join(" ") !== surname.join(" ") || !reg.forenames.length) return "none";
  const given = first[0];
  const [regFirst, ...middles] = reg.forenames;
  if (regFirst === given) return "match";
  // The register has only an initial (the Gas Safe register's "D. Smith"): as far as it can say.
  if (regFirst.length === 1) return regFirst === given[0] ? "match" : "none";
  if (sameName(regFirst, given) || startsTheOther(regFirst, given)) return "likely";
  if (middles.some((m) => m === given || sameName(m, given) || (m.length === 1 && m === given[0]))) return "likely";
  return "none";
}
