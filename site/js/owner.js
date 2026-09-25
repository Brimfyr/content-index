import { NOTE } from "./rules.js";
import { ownerPath } from "./github.js";

// The login rule that tools/pack_ownership.py checks an owner record with.
const LOGIN = /^(?!.*--)[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const KEYS = ["github_id", "github_login"];
const STILL = "You can still copy or save the pack version and open the pull request, and the comment of the bot then gives owner.json.";

export const FREE = "free";
export const YOURS = "yours";
export const OTHER = "other";
export const UNKNOWN = "unknown";

export function isLogin(login) {
  return typeof login === "string" && LOGIN.test(login);
}

export function userApiUrl(login) {
  return isLogin(login) ? `https://api.github.com/users/${login}` : null;
}

// The same text as the owner records in packs/.
export function ownerRecordText(account) {
  return `${JSON.stringify({ github_login: account.login, github_id: account.id }, null, 2)}\n`;
}

// The record as pack_ownership.parse_record accepts it, or null.
export function parseOwnerRecord(text) {
  let record;
  try {
    record = JSON.parse(text);
  } catch {
    return null;
  }
  if (record === null || typeof record !== "object" || Array.isArray(record)) return null;
  if (Object.keys(record).sort().join() !== KEYS.join()) return null;
  if (!isLogin(record.github_login) || !Number.isInteger(record.github_id) || record.github_id < 1) return null;
  return record;
}

// The account behind a login, from the answer of GET /users/<login>, where a
// status of null means that GitHub did not answer. A failure is a note, because
// the pack version does not need the account. Only a personal account can open
// the pull request, so an organization is never the owner.
export function accountFromAnswer(login, status, body) {
  const usable = status === 200 && body && isLogin(body.login) && Number.isInteger(body.id) && body.id > 0;
  if (usable && body.type === "User") {
    return { account: { login: body.login, id: body.id } };
  }
  let text;
  if (usable) text = `${body.login} is not a personal account. owner.json names the personal account that opens the pull request.`;
  else if (status === 404) text = `GitHub has no account ${login}. Check the login.`;
  else if (status === 403 || status === 429) text = `GitHub answered HTTP ${status}, often its limit of 60 requests an hour for visitors. Try again later.`;
  else if (status === null) text = "GitHub did not answer. Try again.";
  else if (status === 200) text = "GitHub answered without a numeric account id.";
  else text = `GitHub answered HTTP ${status}.`;
  return { account: null, level: NOTE, text: `${text} ${STILL}` };
}

// Whether a pack id is free, yours, or another account's. Raw GitHub paths are
// case-sensitive, so the id is free only when main has no owner record at its
// path and no pack or listing in the snapshot has the id in any case.
// recorded is the raw read of the owner record: { text }, { missing } or { error }.
export function packIdState(id, index, recorded, account) {
  const path = ownerPath(id);
  if (typeof recorded.text === "string") {
    const record = parseOwnerRecord(recorded.text);
    if (!record) return { state: UNKNOWN, level: NOTE, text: `${path} on main is not an owner record that the index reads, so a steward decides.` };
    if (account && record.github_id === account.id) {
      return { state: YOURS, level: null, text: `The pack id is yours, because ${path} on main names your account.` };
    }
    if (!account) return { state: UNKNOWN, level: NOTE, text: `${path} on main names ${record.github_login}. If that is not your account, a steward decides.` };
    return { state: OTHER, level: NOTE, text: `The pack id is held by another account, ${record.github_login}, which ${path} on main names. A steward decides.` };
  }
  if (!recorded.missing) {
    return { state: UNKNOWN, level: NOTE, text: `The page could not read ${path} on main, so it cannot say whether the id is free. ${recorded.error || ""}`.trim() };
  }
  const holder = index ? index.holders.get(id.toLowerCase()) : undefined;
  if (holder) {
    return { state: OTHER, level: NOTE, text: `The id is not free, because the index has ${holder.where} and compares ids without case. A steward decides.` };
  }
  if (!index) {
    return { state: UNKNOWN, level: NOTE, text: `Main has no ${path}, but the index snapshot did not load, so the page cannot compare the id with the listed ids.` };
  }
  return { state: FREE, level: null, text: "The pack id is free, so this pull request is its first claim." };
}

// What the page says before the pull request of a first claim opens.
export function firstClaimText(id) {
  return `A first claim also needs ${ownerPath(id)}. Open the pull request with the version. The bot answers with a link that adds ${ownerPath(id)} to the same pull request, and the checks stay red until that file is there.`;
}
