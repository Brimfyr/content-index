import { NOTE } from "./rules.js";

const REVISION_BOUND = /^[0-9]{4}\.[0-9]+\.[0-9]+\.([0-9]+)$/;
const MONTH_BOUND = /^([0-9]{4})\.([0-9]+)$/;
const MONTH = /^([0-9]{4})\.([0-9]+)\./;

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
