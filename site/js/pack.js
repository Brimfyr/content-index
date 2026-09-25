import { ERROR, NOTE, semverCompare } from "./rules.js";
import { formFromDocument, releaseTime } from "./model.js";

const REVISION_BOUND = /^[0-9]{4}\.[0-9]+\.[0-9]+\.([0-9]+)$/;
const MONTH_BOUND = /^([0-9]{4})\.([0-9]+)$/;
const MONTH = /^([0-9]{4})\.([0-9]+)\./;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[^+]+)?(\+.*)?$/;
const STABILITY = ["stable", "testing", "dev"];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function memberOf(index, id) {
  if (!index || typeof id !== "string" || !id) return null;
  const folded = id.toLowerCase();
  return index.members.find((member) => member.id.toLowerCase() === folded) || null;
}

// A pin the snapshot does not offer stays a choice, so loading a document never drops it.
export function memberChoices(index, current = "") {
  const choices = (index ? index.members : [])
    .filter((member) => member.releases.length)
    .map((member) => [member.id, member.name && member.name !== member.id ? `${member.name} (${member.id})` : member.id]);
  if (current && !choices.some(([id]) => id === current)) choices.push([current, `${current} (not offered by the index)`]);
  return choices;
}

export function versionChoices(index, id, current = "") {
  const member = memberOf(index, id);
  const choices = (member ? member.releases : []).map((release) =>
    [release.version, release.status ? `${release.version} (${release.status})` : release.version]);
  if (current && !choices.some(([version]) => version === current)) choices.push([current, `${current} (not offered by the index)`]);
  return choices;
}

export function defaultVersion(index, id) {
  const member = memberOf(index, id);
  if (!member || !member.releases.length) return "";
  const stable = member.releases.find((release) => release.status === "stable");
  return (stable || member.releases[0]).version;
}

function pinnedReleases(document, index) {
  const found = [];
  (Array.isArray(document.mods) ? document.mods : []).forEach((pin, number) => {
    if (!isObject(pin) || typeof pin.id !== "string") return;
    const member = memberOf(index, pin.id);
    const release = member ? member.releases.find((entry) => entry.version === pin.version) : undefined;
    found.push({ pin, number, member, release });
  });
  return found;
}

export function pinNotes(document, index) {
  if (!index || document.type !== "modpack") return [];
  const found = [];
  for (const { pin, number, member, release } of pinnedReleases(document, index)) {
    const where = `mods[${number}]`;
    if (!member) {
      found.push({ level: NOTE, path: where, text: `'${pin.id}' is not a listed mod in the index snapshot, so the page offers no release of it; the pin stays as it is` });
    } else if (!release && typeof pin.version === "string") {
      found.push({ level: NOTE, path: where, text: `'${pin.id}' has no release '${pin.version}' in the index snapshot that is not yanked; the pin stays as it is` });
    }
  }
  return found;
}

function olderThan(bound, release) {
  const text = typeof bound === "string" ? bound.trim() : "";
  if (!text) return true;
  if (text === release.gameMin) return false;
  const revision = REVISION_BOUND.exec(text);
  if (revision) return Number(revision[1]) < release.gameMinRevision;
  const month = MONTH_BOUND.exec(text);
  const target = MONTH_BOUND.exec(release.gameMin) || MONTH.exec(release.gameMin);
  if (!month || !target) return false;
  const [year, number] = [Number(month[1]), Number(month[2])];
  const [targetYear, targetNumber] = [Number(target[1]), Number(target[2])];
  // A month bound admits the first build of that month, which is older than any later build of it.
  return year < targetYear || (year === targetYear && number <= targetNumber);
}

function proposedGameMin(document, index) {
  let highest = null;
  for (const { release } of pinnedReleases(document, index)) {
    if (!release || release.gameMinRevision === null || !release.gameMin) continue;
    if (!highest || release.gameMinRevision > highest.gameMinRevision) highest = release;
  }
  return highest;
}

export function gameMinNotes(document, index) {
  if (!index || document.type !== "modpack") return [];
  const release = proposedGameMin(document, index);
  const compatibility = isObject(document.compatibility) ? document.compatibility : {};
  if (!release || !olderThan(compatibility.game_min, release)) return [];
  return [{
    level: NOTE,
    path: "compatibility.game_min",
    text: `the pinned releases need at least '${release.gameMin}', the highest game_min among them, so that is the proposed oldest game version`,
  }];
}

// The ids that the checks of a loaded document treat as its own. Only a loaded
// pack is a later version of a listed pack.
export function ownIds(base) {
  const own = isObject(base) && typeof base.id === "string" ? base.id : null;
  return { own, pack: own && base.type === "modpack" ? own : null };
}

export function packOf(index, id) {
  return index && typeof id === "string" && id ? index.packs.get(id.toLowerCase()) || null : null;
}

// The next version by SemVer, raised as npm raises a patch. A prerelease becomes
// its own release, and any other version gets the next patch number.
export function raiseVersion(version) {
  const parts = typeof version === "string" ? SEMVER.exec(version) : null;
  if (!parts) return null;
  const [major, minor, patch] = parts.slice(1, 4).map(Number);
  return parts[4] ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`;
}

// The loaded version stays as it is except for the keys that belong to one version.
export function nextPackForm(base, pack, now = new Date()) {
  const form = formFromDocument(base);
  const highest = pack && pack.versions.length ? pack.versions[0].version : base.version;
  form.version = raiseVersion(highest) || "";
  form.releasedAt = releaseTime(now);
  form.changelog = "";
  return form;
}

// The snapshot follows main with a delay, so a version it does not know can
// already be a file there. taken answers whether that file exists.
export async function freeVersion(version, taken, tries = 20) {
  let proposed = version;
  for (let attempt = 0; attempt < tries && proposed; attempt += 1) {
    if (!(await taken(proposed))) return proposed;
    proposed = raiseVersion(proposed);
  }
  return null;
}

function stability(status) {
  const rank = STABILITY.indexOf(status);
  return rank < 0 ? STABILITY.length : rank;
}

// A pin on a yanked release keeps the stability of that release. A pin whose
// release the snapshot does not have at all is held to stable, the strictest level.
export function newerRelease(index, pin) {
  const member = isObject(pin) ? memberOf(index, pin.id) : null;
  if (!member) return null;
  const least = stability(member.statuses.has(pin.version) ? member.statuses.get(pin.version) : "stable");
  return member.releases.find((release) =>
    semverCompare(release.version, pin.version) > 0 && stability(release.status) <= least) || null;
}

export function newerNotes(document, index) {
  if (!index || document.type !== "modpack") return [];
  const found = [];
  (Array.isArray(document.mods) ? document.mods : []).forEach((pin, number) => {
    const release = newerRelease(index, pin);
    if (!release) return;
    found.push({
      level: NOTE,
      path: `mods[${number}]`,
      text: `'${pin.id}' has a newer ${release.status ? `${release.status} ` : ""}release '${release.version}'; the pin stays until you move it`,
      newer: release.version,
    });
  });
  return found;
}

function names(reason, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9._-])${escaped}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`, "i").test(reason);
}

function later(a, b) {
  const [left, right] = [Date.parse(a), Date.parse(b)];
  return Number.isNaN(left) || Number.isNaN(right) || left > right;
}

// The notes and errors of a later version of a listed pack, whose id is own.
export function nextVersionNotes(document, index, own) {
  const pack = document.type === "modpack" ? packOf(index, own) : null;
  if (!pack) return [];
  const found = [];
  if (pack.status) {
    found.push({ level: NOTE, path: "id", text: `the index marks this pack ${pack.status.state}${pack.status.reason ? `: ${pack.status.reason}` : ""}` });
  }
  const pins = Array.isArray(document.mods) ? document.mods : [];
  for (const { version, retracted } of pack.versions) {
    if (!retracted) continue;
    const reason = typeof retracted.reason === "string" ? retracted.reason : "";
    found.push({ level: NOTE, path: "version", text: `version '${version}' of this pack is retracted${reason ? `: ${reason}` : ""}` });
    pins.forEach((pin, number) => {
      if (reason && isObject(pin) && typeof pin.id === "string" && names(reason, pin.id)) {
        found.push({ level: NOTE, path: `mods[${number}]`, text: `the retraction of version '${version}' names '${pin.id}': ${reason}` });
      }
    });
  }
  const highest = pack.versions[0];
  if (highest && (semverCompare(document.version, highest.version) ?? 1) <= 0) {
    found.push({
      level: ERROR,
      path: "version",
      text: `'${document.version}' is not higher than '${highest.version}', the highest version of this pack, retracted ones included`,
    });
  }
  const newest = pack.versions.filter((entry) => entry.releasedAt).sort((a, b) => Date.parse(b.releasedAt) - Date.parse(a.releasedAt))[0];
  if (newest && typeof document.released_at === "string" && !later(document.released_at, newest.releasedAt)) {
    found.push({
      level: ERROR,
      path: "released_at",
      text: `'${document.released_at}' is not later than '${newest.releasedAt}', the release time of version '${newest.version}'`,
    });
  }
  return found;
}
