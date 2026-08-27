import json
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path

from jsonschema import Draft202012Validator


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

from build_api import build  # noqa: E402


class StaticApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_directory = tempfile.TemporaryDirectory()
        cls.output = Path(cls.temp_directory.name) / "v1"
        cls.manifest = build(
            PROJECT_ROOT / "contacts-data.json",
            PROJECT_ROOT / "geocodes.json",
            cls.output,
        )
        cls.offices_payload = cls.load("offices.json")
        cls.offices = cls.offices_payload["offices"]
        cls.officials_payload = cls.load("officials.json")

    @classmethod
    def tearDownClass(cls):
        cls.temp_directory.cleanup()

    @classmethod
    def load(cls, relative_path):
        return json.loads((cls.output / relative_path).read_text(encoding="utf-8"))

    def test_manifest_and_collection_counts_are_consistent(self):
        self.assertGreaterEqual(self.manifest["raw_record_count"], 300)
        self.assertEqual(self.manifest["record_count"], len(self.offices))
        self.assertEqual(
            self.manifest["raw_record_count"] - self.manifest["duplicate_records_removed"],
            self.manifest["record_count"],
        )
        self.assertEqual(
            self.manifest["official_count"],
            self.officials_payload["record_count"],
        )

    def test_office_ids_and_detail_resources_are_unique(self):
        office_ids = [office["id"] for office in self.offices]
        self.assertEqual(len(office_ids), len(set(office_ids)))
        for office_id in office_ids:
            detail = self.load(f"offices/{office_id}.json")
            self.assertEqual(office_id, detail["office"]["id"])

    def test_hierarchy_is_complete_and_acyclic(self):
        by_id = {office["id"]: office for office in self.offices}
        roots = [office for office in self.offices if office["parent_id"] is None]
        self.assertEqual(["head-office"], [office["id"] for office in roots])

        for office in self.offices:
            if office["parent_id"] is not None:
                self.assertIn(office["parent_id"], by_id)
                self.assertEqual(office["ancestor_ids"][-1], office["parent_id"])
            self.assertNotIn(office["id"], office["ancestor_ids"])

    def test_basic_office_list_does_not_embed_named_officials(self):
        self.assertTrue(all("officials" not in office for office in self.offices))
        self.assertTrue(all("office_id" in official for official in self.officials_payload["officials"]))

    def test_categories_match_office_collection(self):
        category_payload = self.load("categories.json")
        expected = Counter(office["category"] for office in self.offices)
        actual = {
            category["id"]: category["record_count"]
            for category in category_payload["categories"]
        }
        self.assertEqual(dict(expected), actual)
        self.assertIn("guest_house", actual)
        self.assertIn("district_office", actual)

    def test_committed_schema_is_valid_json_and_has_required_contract(self):
        schema = json.loads(
            (PROJECT_ROOT / "api" / "v1" / "schema.json").read_text(encoding="utf-8")
        )
        self.assertEqual("EPFO office", schema["title"])
        self.assertIn("id", schema["required"])
        self.assertIn("parent_id", schema["required"])
        self.assertIn("contact", schema["required"])

        validator = Draft202012Validator(schema)
        for office in self.offices:
            errors = sorted(validator.iter_errors(office), key=lambda error: list(error.path))
            self.assertEqual([], errors, f"Schema errors for {office['id']}: {errors}")


if __name__ == "__main__":
    unittest.main()
