import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createChecker, ERROR, NOTE } from "../js/rules.js";
import { indexFacts } from "../js/snapshot.js";
import { parseDocument, writeDocument } from "../js/toml.js";
import { emptyForm, formFromDocument, documentFromForm, sectionsOf, nounOf, releaseTime } from "../js/model.js";
import { memberChoices, versionChoices, defaultVersion, pinNotes, gameMinNotes } from "../js/pack.js";
import { pullRequestLink, copyAndOpen, documentPath, URL_LIMIT, PASTE_NEW } from "../js/github.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const checker = createChecker({ schema: JSON.parse(read("../../schemas/authored.schema.json")), tagsText: read("../../tags.toml") });
const PACKS = new URL("../../packs/", import.meta.url);

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
      id: "Compendium",
      authored: { type: "mod", name: "Compendium" },
      releases: [{ version: "0.9.13", release_status: "stable", game_min: "2026.9", game_min_revision: 5402 }],
    },
    { id: "Unreleased", authored: { type: "mod" }, releases: [] },
    { id: "StarMap", authored: { type: "mod-loader" }, releases: [{ version: "0.4.7", release_status: "stable" }] },
    { id: "GoneMod", index_status: { state: "delisted" } },
    { id: "HiddenMod", authored: { type: "mod" }, index_status: { state: "delisted" }, releases: [{ version: "1.0.0", release_status: "stable" }] },
  ],
  packs: [{ id: "OtherPack", versions: [{ authored: { version: "1.0.0" } }] }],
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
  assert.deepEqual(memberChoices(index), [["Compendium", "Compendium"], ["DeltaVMap", "Delta-V Map (DeltaVMap)"]]);
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
