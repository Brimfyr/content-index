import { semverCompare, threadOf } from "./rules.js";

export const SNAPSHOT_URL = "https://ksamodding.github.io/content-index-releases/v1/index.json";

function forumsOf(authored) {
  return authored && authored.links && typeof authored.links === "object" ? authored.links.forums : undefined;
}

export function newestStable(releases) {
  const stable = (Array.isArray(releases) ? releases : [])
    .filter((release) => release && release.release_status === "stable" && !release.yanked && typeof release.version === "string");
  stable.sort((a, b) => -(semverCompare(a.version, b.version) ?? 0));
  return stable.length ? stable[0].version : null;
}

// The releases a pack can pin, which are stamped and not yanked, newest first.
export function pinnableReleases(releases) {
  const kept = (Array.isArray(releases) ? releases : [])
    .filter((release) => release && !release.yanked && typeof release.version === "string")
    .map((release) => ({
      version: release.version,
      status: typeof release.release_status === "string" ? release.release_status : "",
      gameMin: typeof release.game_min === "string" ? release.game_min : "",
      gameMinRevision: Number.isInteger(release.game_min_revision) ? release.game_min_revision : null,
    }));
  kept.sort((a, b) => -(semverCompare(a.version, b.version) ?? 0));
  return kept;
}

// The release_status of every stamped release, yanked ones included, because a
// pin can stay on a release that was yanked after the pack was published.
export function releaseStatuses(releases) {
  return new Map((Array.isArray(releases) ? releases : [])
    .filter((release) => release && typeof release.version === "string")
    .map((release) => [release.version, typeof release.release_status === "string" ? release.release_status : ""]));
}

// The facts of a pack's forum member list, found the way Borea finds them. A pin
// can name a mod or a mod-loader, and a release that was yanked after the pack
// was published still has its line.
function forumFacts(listing, authored) {
  const forums = forumsOf(authored);
  return {
    id: listing.id,
    name: typeof authored.name === "string" ? authored.name : "",
    authors: Array.isArray(authored.authors) ? authored.authors.filter((author) => typeof author === "string") : [],
    license: typeof authored.license === "string" ? authored.license : "",
    forums: typeof forums === "string" ? forums : "",
    downloads: new Map((Array.isArray(listing.releases) ? listing.releases : [])
      .filter((release) => release && typeof release.version === "string")
      .map((release) => [release.version, release.download && typeof release.download.url === "string" ? release.download.url : ""])),
  };
}

// Every version of a pack, retracted ones included, highest first.
function packVersions(versions) {
  const kept = versions
    .filter((entry) => entry && entry.authored && typeof entry.authored.version === "string")
    .map((entry) => ({
      version: entry.authored.version,
      releasedAt: typeof entry.authored.released_at === "string" ? entry.authored.released_at : "",
      retracted: entry.index_status && entry.index_status.state === "retracted" ? entry.index_status : null,
    }));
  kept.sort((a, b) => -(semverCompare(a.version, b.version) ?? 0));
  return kept;
}

export function indexFacts(snapshot, threadPattern) {
  const holders = new Map();
  const threads = [];
  const loaders = [];
  const mods = [];
  const members = [];
  const forum = new Map();
  const packs = new Map();
  for (const listing of Array.isArray(snapshot.listings) ? snapshot.listings : []) {
    if (!listing || typeof listing.id !== "string") continue;
    const folded = listing.id.toLowerCase();
    const authored = listing.authored;
    const type = authored && typeof authored.type === "string" ? authored.type : null;
    const where = `listings/${listing.id}.toml`;
    if (!holders.has(folded)) holders.set(folded, { id: listing.id, type, where });
    const thread = threadOf(threadPattern, forumsOf(authored));
    if (thread !== null) threads.push({ holder: folded, where, thread });
    if (type === "mod-loader") loaders.push({ id: listing.id, newest: newestStable(listing.releases) });
    if (type === "mod") mods.push(listing.id);
    const delisted = listing.index_status && listing.index_status.state === "delisted";
    if (type === "mod" && !delisted) {
      const name = typeof authored.name === "string" ? authored.name : "";
      members.push({ id: listing.id, name, releases: pinnableReleases(listing.releases), statuses: releaseStatuses(listing.releases) });
    }
    if ((type === "mod" || type === "mod-loader") && !delisted && !forum.has(folded)) forum.set(folded, forumFacts(listing, authored));
  }
  for (const pack of Array.isArray(snapshot.packs) ? snapshot.packs : []) {
    if (!pack || typeof pack.id !== "string") continue;
    const folded = pack.id.toLowerCase();
    const versions = Array.isArray(pack.versions) ? pack.versions : [];
    const wheres = versions.map((entry) => {
      const version = entry && entry.authored ? entry.authored.version : undefined;
      return [entry, `packs/${pack.id}/${version}.toml`];
    });
    if (!holders.has(folded)) {
      holders.set(folded, { id: pack.id, type: "modpack", where: wheres.length ? wheres[0][1] : `packs/${pack.id}/` });
    }
    for (const [entry, where] of wheres) {
      const thread = threadOf(threadPattern, forumsOf(entry && entry.authored));
      if (thread !== null) threads.push({ holder: folded, where, thread });
    }
    if (!packs.has(folded)) packs.set(folded, { id: pack.id, status: pack.index_status || null, versions: packVersions(versions) });
  }
  const gameVersions = snapshot.game_versions && Array.isArray(snapshot.game_versions.versions)
    ? snapshot.game_versions.versions.filter((version) => typeof version === "string")
    : [];
  loaders.sort((a, b) => a.id.localeCompare(b.id));
  mods.sort((a, b) => a.localeCompare(b));
  members.sort((a, b) => a.id.localeCompare(b.id));
  return { holders, threads, threadPattern, loaders, mods, members, forum, packs, gameVersions };
}

export function gameVersionChoices(gameVersions) {
  const months = [];
  for (const version of gameVersions) {
    const match = /^(\d{4})\.(\d{1,2})\./.exec(version);
    const month = match ? `${match[1]}.${Number(match[2])}` : null;
    if (month && !months.includes(month)) months.push(month);
  }
  return [...gameVersions].reverse().concat(months.reverse());
}
