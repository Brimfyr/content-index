import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { NOTE } from "../js/rules.js";
import { indexFacts } from "../js/snapshot.js";
import { rawOwnerUrl } from "../js/github.js";
import {
  isLogin, userApiUrl, ownerRecordText, parseOwnerRecord, accountFromAnswer, packIdState, firstClaimText, FREE, YOURS, OTHER, UNKNOWN,
} from "../js/owner.js";

const PACK_ID = "beiks-flight-planning-essentials-pack";
const RECORDED = new URL(`../../packs/${PACK_ID}/owner.json`, import.meta.url);
const TOOLS = fileURLToPath(new URL("../../tools/", import.meta.url));

const index = indexFacts({
  listings: [{ id: "DeltaVMap", authored: { type: "mod" } }],
  packs: [{ id: PACK_ID, versions: [{ authored: { version: "1.0.0" } }] }],
}, null);

const OWNER = { login: "renancamm", id: 31055336 };
const recorded = { text: fs.readFileSync(RECORDED, "utf8") };
const missing = { error: "There is no such file on main.", missing: true };

// The owner records the index accepts are the ones tools/pack_ownership.py parse_record accepts.
function parseRecord(text) {
  const script = "import sys; sys.path.insert(0, sys.argv[1]); import pack_ownership; "
    + "record, problem = pack_ownership.parse_record(sys.stdin.read(), 'owner.json'); print(problem or 'ok')";
  for (const python of ["python3", "python"]) {
    const run = spawnSync(python, ["-c", script, TOOLS], { input: text, encoding: "utf8" });
    if (!run.error && run.status === 0) return run.stdout.trim();
  }
  return null;
}

test("the page writes owner.json as the index keeps it", () => {
  assert.equal(ownerRecordText(OWNER), recorded.text);
  assert.deepEqual(parseOwnerRecord(ownerRecordText(OWNER)), { github_login: "renancamm", github_id: 31055336 });
});

test("the owner.json the page writes passes pack_ownership.parse_record", (t) => {
  const accounts = [OWNER, { login: "a", id: 1 }, { login: "Some-Login-9", id: 123456789 }];
  const answers = accounts.map((account) => parseRecord(ownerRecordText(account)));
  if (answers.includes(null)) {
    t.skip("no Python to run tools/pack_ownership.py with");
    return;
  }
  assert.deepEqual(answers, accounts.map(() => "ok"));
});

test("an owner record the index would refuse is not read as one", () => {
  for (const text of ["not json", "[]", '{"github_login": "a"}', '{"github_login": "a", "github_id": 0}',
    '{"github_login": "a--b", "github_id": 1}', '{"github_login": "a", "github_id": 1, "extra": 1}', '{"github_login": "a", "github_id": true}']) {
    assert.equal(parseOwnerRecord(text), null, text);
  }
});

test("only a GitHub login is asked for", () => {
  assert.equal(userApiUrl("renancamm"), "https://api.github.com/users/renancamm");
  for (const login of ["", "-a", "a-", "a--b", "a/b", "a".repeat(40), "a b"]) {
    assert.equal(isLogin(login), false, login);
    assert.equal(userApiUrl(login), null, login);
  }
});

test("the account comes from the answer of GitHub, in the spelling GitHub gives", () => {
  assert.deepEqual(accountFromAnswer("RENANCAMM", 200, { login: "renancamm", id: 31055336, type: "User" }), { account: OWNER });
});

test("an organization is not an account that owner.json can name", () => {
  const answer = accountFromAnswer("KSAModding", 200, { login: "KSAModding", id: 244305372, type: "Organization" });
  assert.equal(answer.account, null);
  assert.equal(answer.level, NOTE);
  assert.match(answer.text, /KSAModding is not a personal account/);
  assert.match(answer.text, /still copy or save the pack version/);
});

test("an unknown login and a rate-limited answer each give a message and block nothing", () => {
  const unknown = accountFromAnswer("nobody-here", 404, null);
  assert.match(unknown.text, /no account nobody-here/);
  for (const status of [403, 429]) assert.match(accountFromAnswer("renancamm", status, null).text, /limit/);
  for (const answer of [unknown, accountFromAnswer("renancamm", 403, null), accountFromAnswer("renancamm", 429, null),
    accountFromAnswer("renancamm", null, null), accountFromAnswer("renancamm", 200, { login: "renancamm" })]) {
    assert.equal(answer.account, null);
    assert.equal(answer.level, NOTE);
    assert.match(answer.text, /still copy or save the pack version/);
  }
});

test("an id is free only when main has no owner record and the snapshot has no holder in any case", () => {
  assert.equal(packIdState("NewPack", index, missing, OWNER).state, FREE);
  for (const id of ["BEIKS-Flight-Planning-Essentials-Pack", "deltavmap", PACK_ID]) {
    const answer = packIdState(id, index, missing, OWNER);
    assert.equal(answer.state, OTHER, id);
    assert.match(answer.text, /steward decides/);
  }
  assert.equal(packIdState("NewPack", null, missing, OWNER).state, UNKNOWN);
  assert.equal(packIdState("NewPack", index, { error: "GitHub did not answer." }, OWNER).state, UNKNOWN);
});

test("a recorded id is yours or another account's by the numeric id", () => {
  assert.equal(packIdState(PACK_ID, index, recorded, { login: "renamed", id: 31055336 }).state, YOURS);
  const other = packIdState(PACK_ID, index, recorded, { login: "someone", id: 7 });
  assert.equal(other.state, OTHER);
  assert.match(other.text, /renancamm.*steward decides/);
  assert.equal(packIdState(PACK_ID, index, recorded, null).state, UNKNOWN);
  assert.equal(packIdState(PACK_ID, index, { text: "{}" }, OWNER).state, UNKNOWN);
});

test("a first claim says that the bot answers with a link and the checks stay red until then", () => {
  const text = firstClaimText("NewPack");
  assert.match(text, /packs\/NewPack\/owner\.json/);
  assert.match(text, /bot answers with a link/);
  assert.match(text, /checks stay red until that file is there/);
});

test("the owner record is read from main at its encoded path", () => {
  assert.equal(rawOwnerUrl("a b"), "https://raw.githubusercontent.com/KSAModding/content-index/main/packs/a%20b/owner.json");
});
