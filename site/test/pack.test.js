import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createChecker, ERROR, NOTE } from "../js/rules.js";
import { indexFacts } from "../js/snapshot.js";
import { parseDocument, writeDocument } from "../js/toml.js";
import { emptyForm, formFromDocument, documentFromForm, sectionsOf, nounOf, releaseTime } from "../js/model.js";
import {
  memberChoices, versionChoices, defaultVersion, pinNotes, gameMinNotes, packOf, ownIds, raiseVersion, nextPackForm, freeVersion, newerNotes, nextVersionNotes,
} from "../js/pack.js";
import { pullRequestLink, copyAndOpen, documentPath, rawPackUrl, URL_LIMIT, PASTE_NEW } from "../js/github.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const checker = createChecker({ schema: JSON.parse(read("../../schemas/authored.schema.json")), tagsText: read("../../tags.toml") });
const PACKS = new URL("../../packs/", import.meta.url);

const PACK_ID = "beiks-flight-planning-essentials-pack";
const packText = (version) => read(`../../packs/${PACK_ID}/${version}.toml`);

const snapshot = {
  listings: [
    {
      id: "DeltaVMap",
      authored: { type: "mod", name: "Delta-V Map" },
      releases: [
        { version: "1.3.0", release_status: "stable", yanked: true, game_min: "2026.9.25.5500", game_min_revision: 5500 },
        { version: "1.3.0-beta.1", release_status: "testing", game_min: "2026.9.22.5482", game_min_revision: 5482 },
        { version: "1.2.7", release_status: "stable", game_min: "2026.9.22.5482", game_min_revision: 5482 },
        { version: "1.2.6", release_status: "stable", game_min: "2026.9.10.5438", game_min_revision: 5438 },
      ],
    },
    {
      id: "AdvancedFlightComputer",
      authored: { type: "mod", name: "Advanced Flight Computer" },
      releases: [
        { version: "0.8.2-nightly.20260925", release_status: "dev" },
        { version: "0.8.1", release_status: "testing" },
        { version: "0.8.0", release_status: "stable" },
        { version: "0.7.5", release_status: "testing", yanked: true },
      ],
    },
    {
      id: "Compendium",
      authored: { type: "mod", name: "Compendium" },
      releases: [{ version: "0.9.13", release_status: "stable", game_min: "2026.9", game_min_revision: 5402 }],
    },
    { id: "Unreleased", authored: { type: "mod" }, releases: [] },
    { id: "StarMap", authored: { type: "mod-loader" }, releases: [{ version: "0.4.7", release_status: "stable" }] },
    { id: "GoneMod", index_status: { state: "delisted" } },
    { id: "HiddenMod", authored: { type: "mod" }, index_status: { state: "delisted" }, releases: [{ version: "1.0.0", release_status: "stable" }] },
  ],
  packs: [
    { id: PACK_ID, versions: [{ authored: parseDocument(packText("1.0.1")) }, { authored: parseDocument(packText("1.0.0")) }] },
    { id: "OtherPack", versions: [{ authored: { version: "1.0.0" } }] },
  ],
  game_versions: { versions: ["2026.9.10.5438", "2026.9.22.5482"] },
};
const index = indexFacts(snapshot, checker.threadPattern);

function packForm() {
  const form = emptyForm();
  Object.assign(form, {
    id: "ExamplePack",
    type: "modpack",
    name: "Example Pack",
    authors: "Example Author",
    abstract: "Two mods for mission planning.",
    license: "MIT",
    tags: ["user-interface"],
    gameMin: "2026.9.22.5482",
    version: "1.0.0",
    releasedAt: "2026-09-25T12:00:00Z",
    changelog: "The first version.",
    members: [{ id: "DeltaVMap", version: "1.2.7" }, { id: "", version: "" }, { id: "Compendium", version: "0.9.13" }],
  });
  form.links.forums = "https://forums.ahwoo.com/threads/example-pack.1/";
  return form;
}

test("a pack form writes a valid document at packs/<id>/<version>.toml, the one tools/test_vectors.py checks", () => {
  const document = documentFromForm(packForm(), null);
  assert.equal(documentPath(document), "packs/ExamplePack/1.0.0.toml");
  assert.equal(writeDocument(document), read(`fixtures/${documentPath(document)}`));
  assert.deepEqual(checker.check(document, { index }).filter((entry) => entry.level === ERROR), []);
  assert.deepEqual(pinNotes(document, index), []);
  assert.deepEqual(gameMinNotes(document, index), []);
});

test("a pack loaded into the form and written back is unchanged", () => {
  for (const folder of fs.readdirSync(PACKS, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    for (const name of fs.readdirSync(new URL(`${folder.name}/`, PACKS)).filter((file) => file.endsWith(".toml"))) {
      const base = parseDocument(fs.readFileSync(new URL(`${folder.name}/${name}`, PACKS), "utf8"));
      assert.deepEqual(documentFromForm(formFromDocument(base), base), base, name);
    }
  }
});

test("the picker offers listed mods at releases that are not yanked, newest first", () => {
  assert.deepEqual(memberChoices(index), [
    ["AdvancedFlightComputer", "Advanced Flight Computer (AdvancedFlightComputer)"],
    ["Compendium", "Compendium"],
    ["DeltaVMap", "Delta-V Map (DeltaVMap)"],
  ]);
  assert.deepEqual(versionChoices(index, "DeltaVMap"), [
    ["1.3.0-beta.1", "1.3.0-beta.1 (testing)"],
    ["1.2.7", "1.2.7 (stable)"],
    ["1.2.6", "1.2.6 (stable)"],
  ]);
  assert.deepEqual(versionChoices(index, "StarMap"), []);
  assert.deepEqual(versionChoices(index, "HiddenMod"), []);
  assert.equal(defaultVersion(index, "DeltaVMap"), "1.2.7");
});

test("a loaded pin the snapshot does not list stays in the file and gets a note", () => {
  const base = documentFromForm(packForm(), null);
  base.mods = [{ id: "DeltaVMap", version: "1.3.0" }, { id: "NotListed", version: "2.0.0" }, { id: "StarMap", version: "0.4.7" }];
  const form = formFromDocument(base);
  const document = documentFromForm(form, null);
  assert.deepEqual(document.mods, base.mods);
  assert.deepEqual(pinNotes(document, index).map((entry) => [entry.level, entry.path, entry.text]), [
    [NOTE, "mods[0]", "'DeltaVMap' has no release '1.3.0' in the index snapshot that is not yanked; the pin stays as it is"],
    [NOTE, "mods[1]", "'NotListed' is not a listed mod in the index snapshot, so the page offers no release of it; the pin stays as it is"],
    [NOTE, "mods[2]", "'StarMap' is not a listed mod in the index snapshot, so the page offers no release of it; the pin stays as it is"],
  ]);
  assert.deepEqual(memberChoices(index, "NotListed").at(-1), ["NotListed", "NotListed (not offered by the index)"]);
  assert.deepEqual(versionChoices(index, "NotListed", "2.0.0"), [["2.0.0", "2.0.0 (not offered by the index)"]]);
  assert.deepEqual(versionChoices(index, "DeltaVMap", "1.3.0").at(-1), ["1.3.0", "1.3.0 (not offered by the index)"]);
});

test("the page proposes the highest game_min of the pinned releases as a note", () => {
  const document = documentFromForm(packForm(), null);
  const proposal = "compatibility.game_min: the pinned releases need at least '2026.9.22.5482', the highest game_min among them, so that is the proposed oldest game version";
  const notes = (gameMin) => gameMinNotes({ ...document, compatibility: gameMin === undefined ? {} : { game_min: gameMin } }, index)
    .map((entry) => `${entry.path}: ${entry.text}`);
  assert.deepEqual(notes(undefined), [proposal]);
  assert.deepEqual(notes("2026.9.10.5438"), [proposal]);
  assert.deepEqual(notes("2026.9"), [proposal]);
  assert.deepEqual(notes("2026.9.22.5481"), [proposal]);
  assert.deepEqual(notes("2026.9.22.5482"), []);
  assert.deepEqual(notes("2026.9.0.5482"), []);
  assert.deepEqual(notes("2026.10"), []);
  assert.deepEqual(gameMinNotes({ ...document, mods: [{ id: "Compendium", version: "0.9.13" }], compatibility: { game_min: "2026.9" } }, index), []);
  assert.deepEqual(gameMinNotes({ ...document, type: "mod", compatibility: {} }, index), []);
});

test("the new-file link names the pack path, and a pack over the limit is copied instead", async () => {
  const short = documentFromForm(packForm(), null);
  short.version = "1.0.0+build.1";
  const path = documentPath(short, encodeURIComponent);
  assert.equal(path, "packs/ExamplePack/1.0.0%2Bbuild.1.toml");
  const plain = `https://github.com/KSAModding/content-index/new/main?filename=${path}`;
  assert.deepEqual(pullRequestLink(path, "x"), { url: `${plain}&value=x`, step: "" });

  const text = fs.readFileSync(new URL("beiks-flight-planning-essentials-pack/1.0.1.toml", PACKS), "utf8");
  const real = documentPath(parseDocument(text), encodeURIComponent);
  const link = pullRequestLink(real, text);
  assert.ok(encodeURIComponent(text).length > URL_LIMIT);
  assert.deepEqual(link, {
    url: "https://github.com/KSAModding/content-index/new/main?filename=packs/beiks-flight-planning-essentials-pack/1.0.1.toml",
    step: PASTE_NEW,
  });
  const copied = [];
  await copyAndOpen(link.url, text, { writeText: async (value) => copied.push(value) }, () => ({}));
  assert.deepEqual(copied, [text]);
});

test("switching the type back to mod keeps the mod fields the author typed", () => {
  const form = emptyForm();
  Object.assign(form, { id: "MyMod", github: "me/MyMod", loaderId: "StarMap", loaderMin: "0.4.7", gameMin: "2026.9.22.5482" });
  form.dependencies.push({ id: "Compendium", kind: "optional", min: "", max: "" });
  const mod = documentFromForm(form, null);
  form.type = "modpack";
  form.version = "1.0.0";
  form.members.push({ id: "DeltaVMap", version: "1.2.7" });
  const pack = documentFromForm(form, null);
  for (const key of ["releases", "loader", "dependencies", "install", "provides"]) assert.equal(pack[key], undefined, key);
  assert.deepEqual(pack.mods, [{ id: "DeltaVMap", version: "1.2.7" }]);
  form.type = "mod";
  assert.deepEqual(documentFromForm(form, null), mod);
});

test("a pack shows the pack sections and hides releases, loader, dependencies and install", () => {
  assert.deepEqual(sectionsOf("modpack"), { releases: false, loader: false, launch: false, dependencies: false, pack: true, members: true });
  assert.deepEqual(sectionsOf("mod"), { releases: true, loader: true, launch: false, dependencies: true, pack: false, members: false });
  assert.deepEqual(sectionsOf("mod-loader"), { releases: true, loader: false, launch: true, dependencies: true, pack: false, members: false });
});

test("the page calls what is listed a mod, a mod loader or a pack", () => {
  assert.equal(nounOf("mod"), "mod");
  assert.equal(nounOf("mod-loader"), "mod loader");
  assert.equal(nounOf("modpack"), "pack");
});

test("the release time is UTC to the second", () => {
  assert.equal(releaseTime(new Date(Date.UTC(2026, 8, 25, 12, 3, 4, 567))), "2026-09-25T12:03:04Z");
});

const NOW = new Date(Date.UTC(2026, 8, 25, 18, 0, 0));
const withoutVersionKeys = ({ version, released_at: releasedAt, changelog, ...rest }) => rest;
const levels = (found, level) => found.filter((entry) => entry.level === level).map((entry) => `${entry.path}: ${entry.text}`);

test("loading the listed pack proposes the next version with the same pins and a new release time", () => {
  const base = parseDocument(packText("1.0.1"));
  const pack = packOf(index, PACK_ID.toUpperCase());
  assert.deepEqual(pack.versions.map((entry) => entry.version), ["1.0.1", "1.0.0"]);
  const document = documentFromForm(nextPackForm(base, pack, NOW), base);
  assert.equal(document.version, "1.0.2");
  assert.equal(document.released_at, "2026-09-25T18:00:00Z");
  assert.notEqual(document.released_at, base.released_at);
  assert.deepEqual(document.mods, [
    { id: "DeltaVMap", version: "1.2.6" },
    { id: "AdvancedFlightComputer", version: "0.8.0" },
    { id: "Compendium", version: "0.9.13" },
  ]);
  assert.deepEqual(withoutVersionKeys(document), withoutVersionKeys(base));
  assert.equal(documentPath(document), `packs/${PACK_ID}/1.0.2.toml`);
  assert.deepEqual(levels(nextVersionNotes(document, index, PACK_ID), ERROR), []);
});

test("the next version starts with an empty changelog, because the old one describes the old version", () => {
  const base = { ...parseDocument(packText("1.0.1")), changelog: "Adds Compendium." };
  const form = nextPackForm(base, packOf(index, PACK_ID), NOW);
  assert.equal(form.changelog, "");
  assert.equal(documentFromForm(form, base).changelog, undefined);
});

test("the pack's own id gives no id error, and another pack's id does", () => {
  const base = parseDocument(packText("1.0.1"));
  const document = documentFromForm(nextPackForm(base, packOf(index, PACK_ID), NOW), base);
  const { own, pack } = ownIds(base);
  assert.deepEqual([own, pack], [PACK_ID, PACK_ID]);
  assert.deepEqual(levels(checker.check(document, { index, own }), ERROR), []);
  assert.deepEqual(levels(nextVersionNotes(document, index, pack), ERROR), []);
  assert.ok(levels(checker.check(document, { index }), ERROR).some((text) => text.startsWith("id: ") && text.includes("is already held by")));
  assert.deepEqual(ownIds({ id: "DeltaVMap", type: "mod" }), { own: "DeltaVMap", pack: null });
  assert.deepEqual(ownIds(null), { own: null, pack: null });
});

test("a later pack version opens the new file, never the edit page of the loaded one", () => {
  const base = parseDocument(packText("1.0.1"));
  const document = documentFromForm(nextPackForm(base, packOf(index, PACK_ID), NOW), base);
  const text = writeDocument(document);
  const link = pullRequestLink(documentPath(document, encodeURIComponent), text, base);
  assert.equal(link.url, `https://github.com/KSAModding/content-index/new/main?filename=packs/${PACK_ID}/1.0.2.toml`);
  assert.equal(link.step, PASTE_NEW);
});

test("a pack whose highest version is retracted proposes a version above it and shows the reason", () => {
  const reason = "Retracted at the request of the author of DeltaVMap.";
  const newest = { ...parseDocument(packText("1.0.1")), version: "1.1.0", released_at: "2026-09-24T10:00:00Z" };
  const retracted = indexFacts({
    ...snapshot,
    packs: [{
      id: PACK_ID,
      versions: [
        { authored: parseDocument(packText("1.0.0")) },
        { authored: newest, index_status: { state: "retracted", reason } },
        { authored: parseDocument(packText("1.0.1")) },
      ],
    }],
  }, checker.threadPattern);
  const pack = packOf(retracted, PACK_ID);
  assert.deepEqual(pack.versions.map((entry) => entry.version), ["1.1.0", "1.0.1", "1.0.0"]);
  const document = documentFromForm(nextPackForm(newest, pack, NOW), newest);
  assert.equal(document.version, "1.1.1");
  assert.deepEqual(levels(nextVersionNotes(document, retracted, PACK_ID), NOTE), [
    `version: version '1.1.0' of this pack is retracted: ${reason}`,
    `mods[0]: the retraction of version '1.1.0' names 'DeltaVMap': ${reason}`,
  ]);
  assert.deepEqual(levels(nextVersionNotes(document, retracted, PACK_ID), ERROR), []);
  const behind = { ...document, version: "1.0.2", released_at: "2026-09-24T10:00:00Z" };
  assert.deepEqual(levels(nextVersionNotes(behind, retracted, PACK_ID), ERROR), [
    "version: '1.0.2' is not higher than '1.1.0', the highest version of this pack, retracted ones included",
    "released_at: '2026-09-24T10:00:00Z' is not later than '2026-09-24T10:00:00Z', the release time of version '1.1.0'",
  ]);
  assert.deepEqual(nextVersionNotes(document, retracted, null), []);
});

test("a proposed path that exists on raw GitHub is raised again", async () => {
  const onMain = new Set(["1.0.2", "1.0.3"]);
  const asked = [];
  const taken = async (version) => {
    asked.push(rawPackUrl(PACK_ID, version));
    return onMain.has(version);
  };
  assert.equal(await freeVersion("1.0.2", taken), "1.0.4");
  assert.deepEqual(asked, ["1.0.2", "1.0.3", "1.0.4"].map((version) =>
    `https://raw.githubusercontent.com/KSAModding/content-index/main/packs/${PACK_ID}/${version}.toml`));
  assert.equal(await freeVersion("1.0.5", taken), "1.0.5");
  assert.equal(await freeVersion("1.0.2", async () => true, 3), null);
  await assert.rejects(freeVersion("1.0.2", async () => { throw new Error("GitHub did not answer."); }));
});

test("the version is raised as npm raises a patch", () => {
  assert.equal(raiseVersion("1.0.1"), "1.0.2");
  assert.equal(raiseVersion("2.3.9+build.7"), "2.3.10");
  assert.equal(raiseVersion("1.1.0-rc.1"), "1.1.0");
  assert.equal(raiseVersion("not a version"), null);
});

test("a member with a newer release at least as stable is marked, and a newer testing release does not mark a stable pin", () => {
  const document = {
    type: "modpack",
    mods: [
      { id: "DeltaVMap", version: "1.2.6" },
      { id: "DeltaVMap", version: "1.2.7" },
      { id: "AdvancedFlightComputer", version: "0.8.0" },
      { id: "AdvancedFlightComputer", version: "0.8.1" },
      { id: "DeltaVMap", version: "1.1.0" },
      { id: "Compendium", version: "0.9.13" },
      { id: "NotListed", version: "1.0.0" },
      { id: "AdvancedFlightComputer", version: "0.7.5" },
    ],
  };
  assert.deepEqual(newerNotes(document, index).map((entry) => [entry.path, entry.newer, entry.level, entry.text]), [
    ["mods[0]", "1.2.7", NOTE, "'DeltaVMap' has a newer stable release '1.2.7'; the pin stays until you move it"],
    ["mods[4]", "1.2.7", NOTE, "'DeltaVMap' has a newer stable release '1.2.7'; the pin stays until you move it"],
    ["mods[7]", "0.8.1", NOTE, "'AdvancedFlightComputer' has a newer testing release '0.8.1'; the pin stays until you move it"],
  ]);
  assert.deepEqual(newerNotes({ ...document, type: "mod" }, index), []);
});
