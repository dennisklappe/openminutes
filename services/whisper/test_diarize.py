import io
import math
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

import diarize


class FallbackTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        patcher = mock.patch.dict(os.environ, {"DIARIZATION_MODEL_DIR": self.dir.name})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.dir.cleanup)
        diarize._load.cache_clear()

    def test_missing_model_and_no_network_answers_unavailable(self):
        with mock.patch("urllib.request.urlopen", side_effect=OSError("offline")):
            result = diarize.diarize_file("unused.wav", None, None)
        self.assertFalse(result["available"])
        self.assertIn("could not be downloaded", result["reason"])

    def test_download_with_wrong_checksum_is_rejected_and_not_kept(self):
        response = io.BytesIO(b"not the model")
        with (
            mock.patch("urllib.request.urlopen", return_value=response),
            self.assertRaises(diarize.Unavailable),
        ):
            diarize.fetch(diarize.SEGMENTATION)
        self.assertEqual(list(Path(self.dir.name).iterdir()), [])

    def test_disabled_service_answers_unavailable(self):
        with mock.patch.object(diarize, "ENABLED", False):
            result = diarize.diarize_file("unused.wav", None, None)
        self.assertEqual(result["available"], False)


class FakeExtractor:
    """Embeds a clip as a unit vector at the angle of its (constant) sample value, so one value is
    one voice and the cosine between voices is the cosine of their angle difference."""

    dim = 2

    def create_stream(self):
        return self

    def accept_waveform(self, _rate, samples):
        self.value = float(samples[0])

    def input_finished(self):
        pass

    def compute(self, _stream):
        return [math.cos(math.radians(self.value)), math.sin(math.radians(self.value))]


def clip(*spans):
    """Turns and audio for (speaker, seconds) spans, speaker n sounding like value n."""
    turns, pieces, cursor = [], [], 0
    for speaker, seconds in spans:
        turns.append({"startMs": cursor, "endMs": cursor + seconds * 1000, "speaker": speaker})
        pieces.append(np.full(seconds * diarize.SAMPLE_RATE, float(speaker)))
        cursor += seconds * 1000
    return turns, np.concatenate(pieces)


def speakers_after(spans, keep, limit, similarity=2.0):
    turns, audio = clip(*spans)
    with mock.patch.object(diarize, "MERGE_SIMILARITY", similarity):
        diarize._merge_clusters(FakeExtractor(), audio, turns, keep, limit)
    return sorted({t["speaker"] for t in turns}), turns


class MergeClustersTest(unittest.TestCase):
    def test_short_speaker_joins_the_nearest_voice(self):
        found, turns = speakers_after([(0, 10), (90, 10), (40, 2)], keep=1, limit=99)
        self.assertEqual(found, [0, 90])
        self.assertEqual(turns[2]["speaker"], 0)

    def test_stray_voices_in_a_long_conversation_join_the_two_talkers(self):
        found, _ = speakers_after([(0, 600), (90, 300), (40, 10), (130, 10)], keep=1, limit=99)
        self.assertEqual(found, [0, 90])

    def test_known_count_is_never_undercut(self):
        found, _ = speakers_after(
            [(0, 10), (90, 10), (40, 2), (135, 1)], keep=4, limit=4, similarity=0.5
        )
        self.assertEqual(found, [0, 40, 90, 135])

    def test_merging_stops_at_the_known_count(self):
        found, _ = speakers_after([(0, 10), (90, 10), (40, 2), (135, 1)], keep=3, limit=3)
        self.assertEqual(len(found), 3)

    def test_unknown_count_is_capped_by_folding_the_smallest(self):
        found, turns = speakers_after([(0, 20), (90, 15), (180, 10), (270, 5)], keep=1, limit=3)
        self.assertEqual(found, [0, 90, 180])
        self.assertIn(turns[3]["speaker"], (0, 180))

    def test_voices_that_sound_alike_become_one_speaker(self):
        found, turns = speakers_after(
            [(0, 20), (90, 20), (10, 15)], keep=1, limit=99, similarity=0.65
        )
        self.assertEqual(found, [0, 90])
        self.assertEqual(turns[2]["speaker"], 0)

    def test_different_voices_stay_apart(self):
        found, _ = speakers_after([(0, 20), (90, 20), (180, 15)], keep=1, limit=99, similarity=0.65)
        self.assertEqual(found, [0, 90, 180])

    def test_last_speaker_is_never_merged_away(self):
        found, _ = speakers_after([(1, 2)], keep=1, limit=99)
        self.assertEqual(found, [1])


def replies(count):
    """A long talker whose neighbour answers in `count` short turns between the talker's turns."""
    return [item for _ in range(count) for item in ((0, 10), (90, 1))] + [(0, 10)]


class ShortReplyTest(unittest.TestCase):
    def test_a_quiet_speaker_who_answers_several_times_is_kept(self):
        found, _ = speakers_after(replies(6), keep=1, limit=99)
        self.assertEqual(found, [0, 90])

    def test_a_single_stray_turn_is_still_folded(self):
        found, turns = speakers_after([(0, 20), (90, 1), (0, 20)], keep=1, limit=99)
        self.assertEqual(found, [0])
        self.assertEqual(turns[1]["speaker"], 0)

    def test_replies_too_short_to_embed_do_not_count_as_alternating(self):
        turns, _ = clip(*replies(6))
        for turn in turns:
            if turn["speaker"] == 90:
                turn["endMs"] = turn["startMs"] + diarize.MIN_EMBED_MS - 1
        self.assertEqual(diarize._alternations(turns, 90), 0)

    def test_the_cap_still_folds_alternating_speakers(self):
        found, _ = speakers_after(replies(6) + [(180, 30)], keep=1, limit=2)
        self.assertEqual(len(found), 2)


class EmbedRangesTest(unittest.TestCase):
    def embed(self, ranges, spans=((0, 10), (90, 10))):
        _, audio = clip(*spans)
        with (
            mock.patch.object(diarize, "_load", return_value=(None, "", "", FakeExtractor())),
            mock.patch.object(diarize, "decode_audio", return_value=audio),
        ):
            return diarize.embed_ranges("x.wav", ranges)

    def test_ranges_are_averaged_by_length(self):
        result = self.embed([(0, 3000), (10_000, 11_000)])
        self.assertEqual(result["durationMs"], 4000)
        angle = math.degrees(math.atan2(result["embedding"][1], result["embedding"][0]))
        self.assertAlmostEqual(angle, math.degrees(math.atan(1 / 3)), places=3)
        self.assertAlmostEqual(sum(x * x for x in result["embedding"]), 1.0)

    def test_ranges_under_the_minimum_are_skipped(self):
        result = self.embed([(0, diarize.MIN_EMBED_MS - 1)])
        self.assertEqual(result, {"available": True, "embedding": None, "durationMs": 0})

    def test_the_longest_ranges_fill_the_budget_first(self):
        with mock.patch.object(diarize, "CENTROID_MS", 5_000):
            result = self.embed([(0, 2000), (10_000, 17_000), (3000, 4000)])
        self.assertEqual(result["durationMs"], 7000)

    def test_unavailable_models_are_reported(self):
        with mock.patch.object(diarize, "_load", side_effect=diarize.Unavailable("no models")):
            result = diarize.embed_ranges("x.wav", [(0, 2000)])
        self.assertEqual(result, {"available": False, "reason": "no models"})


class KnownCountTest(unittest.TestCase):
    def test_diarize_file_hands_the_count_to_the_merge(self):
        turns, audio = clip((0, 10), (90, 2))
        with (
            mock.patch.object(diarize, "_load", return_value=(None, "", "", FakeExtractor())),
            mock.patch.object(diarize, "decode_audio", return_value=audio),
            mock.patch.object(diarize, "_cluster", side_effect=lambda *_: [dict(t) for t in turns]),
        ):
            known = diarize.diarize_file("x.wav", 2, None)
            unknown = diarize.diarize_file("x.wav", None, None)
        self.assertEqual(len(known["speakers"]), 2)
        self.assertEqual(len(unknown["speakers"]), 1)

    def test_turns_carry_similarity_and_runner_up_in_final_numbering(self):
        turns, audio = clip((90, 12), (0, 6), (90, 12))
        with (
            mock.patch.object(diarize, "_load", return_value=(None, "", "", FakeExtractor())),
            mock.patch.object(diarize, "decode_audio", return_value=audio),
            mock.patch.object(diarize, "_cluster", side_effect=lambda *_: [dict(t) for t in turns]),
        ):
            result = diarize.diarize_file("x.wav", 2, None)
        self.assertEqual([t["speaker"] for t in result["turns"]], [0, 1, 0])
        for turn in result["turns"]:
            self.assertEqual(turn["runnerUp"]["speaker"], 1 - turn["speaker"])
            self.assertGreater(turn["similarity"], turn["runnerUp"]["similarity"])


if __name__ == "__main__":
    unittest.main()
