#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Tests for the privileged mod pack ownership decision."""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import check_scope
import ownership
import pack_ownership

PATH = "packs/Starter/1.0.0.toml"
OWNER = "packs/Starter/owner.json"
HEAD = "head1234567890"
BASE = "main"
RECORDED = "packs/beiks-flight-planning-essentials-pack/owner.json"


def owner(login="Maxi", account_id=7):
    return json.dumps({"github_login": login, "github_id": account_id})


def pull(login="Maxi", account_id=7, base=BASE):
    return {"user": {"login": login, "id": account_id}, "base": {"ref": base}}


class Api:
    repository = "KSAModding/content-index"

    def __init__(self, files=None, folders=None):
        self.files = files or {}
        self.folders = folders or {}
        self.reads = []

    def file(self, repository, path, ref=None):
        self.reads.append((path, ref))
        return self.files.get((path, ref))

    def folder(self, path, ref):
        return self.folders.get((path, ref), [])


class PackOwnership(unittest.TestCase):
    def test_a_first_claim_always_waits_for_a_steward(self):
        api = Api({(OWNER, HEAD): owner()})
        result = pack_ownership.verify(api, pull(), PATH, HEAD)
        self.assertEqual(result.state, ownership.UNVERIFIED)
        self.assertIn("first claim", result.reason)
        self.assertIn("steward", result.instructions)

    def test_a_first_claim_must_record_the_pull_request_author(self):
        api = Api({(OWNER, HEAD): owner("Attacker", 9)})
        result = pack_ownership.verify(api, pull(), PATH, HEAD)
        self.assertEqual(result.state, ownership.REJECTED)
        self.assertIn("account that opened", result.reason)

    def test_head_content_cannot_replace_the_recorded_owner(self):
        api = Api({(OWNER, BASE): owner("Victim", 8), (OWNER, HEAD): owner()})
        result = pack_ownership.verify(api, pull(), PATH, HEAD)
        self.assertEqual(result.state, ownership.UNVERIFIED)
        self.assertIn("not the recorded owner", result.reason)
        self.assertNotIn((OWNER, HEAD), api.reads)

    def test_the_recorded_account_can_add_a_version(self):
        api = Api({(OWNER, BASE): owner()})
        result = pack_ownership.verify(api, pull(), PATH, HEAD)
        self.assertEqual(result.state, ownership.VERIFIED)
        self.assertEqual(result.proof, "pack owner record")

    def test_the_numeric_account_id_survives_a_login_change(self):
        api = Api({(OWNER, BASE): owner("OldName", 7)})
        result = pack_ownership.verify(api, pull("NewName", 7), PATH, HEAD)
        self.assertEqual(result.state, ownership.VERIFIED)

    def test_an_existing_version_is_rejected_even_when_the_diff_calls_it_added(self):
        api = Api({(PATH, BASE): 'id = "Starter"\n', (OWNER, BASE): owner()})
        result = pack_ownership.verify(api, pull(), PATH, HEAD)
        self.assertEqual(result.state, ownership.REJECTED)
        self.assertIn("immutable", result.reason)

    def test_a_malformed_base_record_reaches_no_verdict(self):
        api = Api({(OWNER, BASE): "not json"})
        result = pack_ownership.verify(api, pull(), PATH, HEAD)
        self.assertEqual(result.state, ownership.COULD_NOT_EVALUATE)

    def test_a_first_claim_without_an_owner_record_is_rejected(self):
        result = pack_ownership.verify(Api(), pull(), PATH, HEAD)
        self.assertEqual(result.state, ownership.REJECTED)
        self.assertIn(OWNER, result.reason)


class RecordText(unittest.TestCase):
    def test_it_is_written_as_the_records_in_packs_are(self):
        record = Path(__file__).resolve().parent.parent / RECORDED
        text = pack_ownership.record_text("renancamm", 31055336)
        self.assertEqual(text, record.read_text(encoding="utf-8"))
        parsed, problem = pack_ownership.parse_record(text, OWNER)
        self.assertEqual(problem, "")
        self.assertEqual(parsed, {"github_login": "renancamm", "github_id": 31055336})


class UnreadableApi(Api):
    def folder(self, path, ref):
        raise ownership.Unavailable("HTTP 502")


class MissingRecords(unittest.TestCase):
    def test_a_first_version_without_a_record_lacks_one(self):
        changes = check_scope.changes([PATH])
        self.assertEqual(pack_ownership.missing_records(Api(), pull(), changes), [OWNER])

    def test_a_record_in_the_change_is_not_asked_for(self):
        changes = check_scope.changes([PATH, OWNER])
        self.assertEqual(pack_ownership.missing_records(Api(), pull(), changes), [])

    def test_a_later_version_has_its_record_on_the_base_branch(self):
        api = Api(folders={("packs", BASE): [("Starter", "dir"), ("README.md", "file")]})
        self.assertEqual(pack_ownership.missing_records(api, pull(), check_scope.changes([PATH])), [])

    def test_an_id_held_in_another_case_is_not_a_first_claim(self):
        api = Api(folders={("packs", BASE): [("STARTER", "dir")]})
        self.assertEqual(pack_ownership.missing_records(api, pull(), check_scope.changes([PATH])), [])

    def test_an_id_that_a_listing_holds_is_not_a_first_claim(self):
        api = Api(folders={("listings", BASE): [("starter.TOML", "file")]})
        self.assertEqual(pack_ownership.missing_records(api, pull(), check_scope.changes([PATH])), [])

    def test_a_pack_folder_file_or_a_listing_folder_holds_no_id(self):
        api = Api(folders={
            ("packs", BASE): [("Starter", "file")],
            ("listings", BASE): [("Starter.toml", "dir")],
        })
        changes = check_scope.changes([PATH])
        self.assertEqual(pack_ownership.missing_records(api, pull(), changes), [OWNER])

    def test_a_path_that_is_not_plain_asks_for_nothing(self):
        for path in ("packs/My Pack/1.0.0.toml", "packs/Caf\u00e9/1.0.0.toml"):
            changes = check_scope.changes([path])
            self.assertEqual(pack_ownership.missing_records(Api(), pull(), changes), [], path)

    def test_two_versions_of_one_pack_ask_once(self):
        changes = check_scope.changes([PATH, "packs/Starter/1.0.1.toml"])
        self.assertEqual(pack_ownership.missing_records(Api(), pull(), changes), [OWNER])

    def test_a_base_branch_that_cannot_be_read_asks_for_nothing(self):
        changes = check_scope.changes([PATH])
        self.assertEqual(pack_ownership.missing_records(UnreadableApi(), pull(), changes), [])

    def test_only_an_added_pack_version_counts(self):
        changes = check_scope.changes([PATH], status="modified")
        changes += check_scope.changes(["listings/Starter.toml"])
        self.assertEqual(pack_ownership.missing_records(Api(), pull(), changes), [])


if __name__ == "__main__":
    unittest.main()
