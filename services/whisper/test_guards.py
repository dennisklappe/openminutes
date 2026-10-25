import io
import unittest

import guards


class ModelNameTest(unittest.TestCase):
    def test_accepts_hub_names(self):
        for name in ["small", "large-v3", "distil-large-v3", "Systran/faster-whisper-small"]:
            self.assertTrue(guards.valid_model(name), name)

    def test_refuses_paths_and_odd_names(self):
        for name in [
            "",
            "/etc/passwd",
            "../models/x",
            "a/../b",
            "./x",
            "a/b/c",
            "x y",
            "x;rm",
            "-small",
            "a" * 65,
        ]:
            self.assertFalse(guards.valid_model(name), name)


class CopyLimitedTest(unittest.TestCase):
    def test_copies_within_the_limit(self):
        target = io.BytesIO()
        self.assertEqual(guards.copy_limited(io.BytesIO(b"abc"), target, 3), 3)
        self.assertEqual(target.getvalue(), b"abc")

    def test_stops_when_larger_than_the_limit(self):
        target = io.BytesIO()
        with self.assertRaises(guards.UploadTooLarge):
            guards.copy_limited(io.BytesIO(b"x" * (guards.CHUNK + 5)), target, guards.CHUNK)
        self.assertLessEqual(len(target.getvalue()), guards.CHUNK)


if __name__ == "__main__":
    unittest.main()
