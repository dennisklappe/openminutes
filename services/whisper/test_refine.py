import math
import unittest

import numpy as np

import refine

RATE = refine.SAMPLE_RATE


def embed(samples: np.ndarray) -> np.ndarray:
    """A clip is a unit vector at the angle of its mean value: one value is one voice."""
    angle = math.radians(float(samples.mean()))
    return np.array([math.cos(angle), math.sin(angle)])


def tone(*spans):
    """Audio for (voice angle, seconds) spans."""
    return np.concatenate([np.full(int(seconds * RATE), float(angle)) for angle, seconds in spans])


def turn(start, end, speaker):
    return {"startMs": start, "endMs": end, "speaker": speaker}


class UncoveredSpeechTest(unittest.TestCase):
    def audio(self, *levels):
        return np.concatenate([np.full(int(seconds * RATE), level) for level, seconds in levels])

    def test_loud_stretch_outside_every_turn_is_found(self):
        audio = self.audio((0.1, 4), (0.0005, 1), (0.1, 1), (0.0005, 2), (0.1, 4))
        found = refine.uncovered_speech(audio, [turn(0, 4000, 0), turn(8000, 12000, 0)])
        self.assertEqual([(g["startMs"], g["endMs"]) for g in found], [(5000, 6000)])
        self.assertEqual(found[0]["speaker"], refine.UNCOVERED)

    def test_room_noise_and_blips_are_ignored(self):
        audio = self.audio((0.1, 4), (0.001, 2), (0.1, 0.2), (0.001, 2), (0.1, 4))
        self.assertEqual(
            refine.uncovered_speech(audio, [turn(0, 4000, 0), turn(8200, 12200, 0)]), []
        )

    def test_without_turns_there_is_no_reference_level(self):
        self.assertEqual(refine.uncovered_speech(self.audio((0.1, 3)), []), [])


class WindowsTest(unittest.TestCase):
    def test_cells_tile_a_span_without_gaps(self):
        placed = refine.windows([turn(1000, 6200, 0)])
        self.assertEqual(placed[0].cellStartMs, 1000)
        self.assertEqual(placed[-1].cellEndMs, 6200)
        for before, after in zip(placed, placed[1:], strict=False):
            self.assertEqual(before.cellEndMs, after.cellStartMs)

    def test_a_span_shorter_than_a_window_is_one_window(self):
        placed = refine.windows([turn(0, 700, 0)])
        self.assertEqual([(w.startMs, w.endMs) for w in placed], [(0, 700)])

    def test_a_span_too_short_to_embed_has_no_window(self):
        self.assertEqual(refine.windows([turn(0, refine.MIN_EMBED_MS - 1, 0)]), [])


class RelabelTest(unittest.TestCase):
    centroids = {0: np.array([1.0, 0.0]), 1: np.array([0.0, 1.0])}

    def relabel(self, angles, labels, fixed=None):
        vectors = np.array([[math.cos(math.radians(a)), math.sin(math.radians(a))] for a in angles])
        fixed = np.zeros(len(labels), dtype=bool) if fixed is None else np.array(fixed)
        return refine.relabel(vectors, np.array(labels), [0] * len(labels), self.centroids, fixed)

    def test_a_run_that_clearly_sounds_like_another_speaker_switches(self):
        self.assertEqual(self.relabel([0, 80, 80, 0], [0] * 4).tolist(), [0, 1, 1, 0])

    def test_one_window_needs_twice_the_margin(self):
        self.assertEqual(self.relabel([0, 50, 0], [0] * 3).tolist(), [0, 0, 0])
        self.assertEqual(self.relabel([0, 85, 0], [0] * 3).tolist(), [0, 1, 0])

    def test_a_small_lead_does_not_switch(self):
        self.assertEqual(self.relabel([0, 48, 48, 0], [0] * 4).tolist(), [0, 0, 0, 0])

    def test_fixed_windows_keep_their_label(self):
        self.assertEqual(
            self.relabel([0, 80, 80, 0], [0] * 4, fixed=[False, True, True, False]).tolist(),
            [0] * 4,
        )

    def test_unlabelled_speech_takes_the_nearest_speaker(self):
        self.assertEqual(self.relabel([80, 10], [refine.UNCOVERED] * 2).tolist(), [1, 0])


class ContestedTest(unittest.TestCase):
    def test_windows_under_another_turn_are_contested(self):
        spans = [turn(0, 6000, 0), turn(3000, 5000, 1)]
        found = refine.contested(spans, refine.windows(spans))
        placed = refine.windows(spans)
        for window, flag in zip(placed, found, strict=False):
            inside = window.span == 0 and window.cellStartMs < 5000 and window.cellEndMs > 3000
            self.assertEqual(bool(flag), inside or window.span == 1)


class SplitVoiceTest(unittest.TestCase):
    def vectors(self, *groups):
        return np.array(
            [
                [math.cos(math.radians(a)), math.sin(math.radians(a))]
                for n, a in groups
                for _ in range(n)
            ]
        )

    def test_a_second_voice_is_found(self):
        voice = refine.split_voice(self.vectors((40, 0), (10, 90)))
        self.assertIsNotNone(voice)
        self.assertGreater(float(voice @ np.array([0.0, 1.0])), 0.99)

    def test_one_voice_is_not_split(self):
        self.assertIsNone(refine.split_voice(self.vectors((50, 0))))

    def test_voices_that_sound_alike_are_not_split(self):
        self.assertIsNone(refine.split_voice(self.vectors((40, 0), (10, 25))))

    def test_a_few_odd_windows_are_not_a_voice(self):
        self.assertIsNone(refine.split_voice(self.vectors((40, 0), (3, 90))))


class RefineTest(unittest.TestCase):
    def test_a_short_reply_inside_a_long_turn_gets_its_own_turn(self):
        audio = tone((0, 12), (90, 1.5), (0, 12), (90, 6))
        turns = [turn(0, 25500, 0), turn(25500, 31500, 1)]
        result = refine.refine(embed, audio, turns, wanted=2)
        reply = [t for t in result if t["speaker"] == 1 and t["startMs"] < 20000]
        self.assertEqual(len(reply), 1)
        self.assertLessEqual(abs(reply[0]["startMs"] - 12000), 750)
        self.assertLessEqual(abs(reply[0]["endMs"] - 13500), 750)
        self.assertAlmostEqual(reply[0]["similarity"], 1.0, places=2)
        self.assertLess(reply[0]["runnerUp"]["similarity"], 0.1)

    def test_overlapping_speech_keeps_both_labels(self):
        audio = tone((0, 12))
        turns = [turn(0, 12000, 0), turn(4000, 9000, 1)]
        result = refine.refine(embed, audio, turns, wanted=2)
        inside = {t["speaker"] for t in result if t["startMs"] < 8500 and t["endMs"] > 4500}
        self.assertEqual(inside, {0, 1})

    def test_a_second_speaker_is_split_off_a_lone_cluster(self):
        audio = tone(*([(0, 5), (90, 1.5)] * 6))
        result = refine.refine(embed, audio, [turn(0, 39000, 0)], wanted=2)
        self.assertEqual({t["speaker"] for t in result}, {0, 1})
        self.assertEqual(sum(t["speaker"] == 1 for t in result), 6)

    def test_a_stray_cluster_does_not_count_towards_the_known_speakers(self):
        audio = tone(*([(0, 5), (90, 1.5)] * 6), (45, 1))
        turns = [turn(0, 39000, 0), turn(39000, 40000, 2)]
        result = refine.refine(embed, audio, turns, wanted=2)
        self.assertEqual(len({t["speaker"] for t in result}), 2)
        self.assertEqual(sum(t["speaker"] != 0 for t in result), 6)

    def test_speakers_beyond_the_known_count_are_folded_into_the_nearest(self):
        audio = tone((0, 10), (90, 10), (80, 1.2), (0, 10))
        turns = [
            turn(0, 10000, 0),
            turn(10000, 20000, 1),
            turn(20000, 21200, 2),
            turn(21200, 31200, 0),
        ]
        result = refine.refine(embed, audio, turns, wanted=2)
        self.assertEqual({t["speaker"] for t in result}, {0, 1})
        self.assertEqual([t["speaker"] for t in result if 20000 <= t["startMs"] < 21200], [1])

    def test_a_known_single_speaker_is_never_split(self):
        audio = tone(*([(0, 5), (90, 1.5)] * 6))
        result = refine.refine(embed, audio, [turn(0, 39000, 0)], wanted=1)
        self.assertEqual({t["speaker"] for t in result}, {0})

    def test_speech_between_turns_becomes_a_turn_of_the_nearest_voice(self):
        loud = np.full(int(2 * RATE), 90.0)
        audio = np.concatenate([tone((0, 6)), loud, tone((0, 6), (90, 6))])
        turns = [turn(0, 6000, 0), turn(8000, 14000, 0), turn(14000, 20000, 1)]
        result = refine.refine(embed, audio, turns, wanted=2)
        found = [t for t in result if 6000 <= t["startMs"] < 8000]
        self.assertEqual([t["speaker"] for t in found], [1])

    def test_turns_too_short_to_embed_stay_and_have_no_similarity(self):
        audio = tone((0, 10), (90, 0.3), (0, 10))
        turns = [turn(0, 10000, 0), turn(10000, 10300, 1), turn(10300, 20300, 0)]
        short = [t for t in refine.refine(embed, audio, turns, wanted=1) if t["speaker"] == 1]
        self.assertEqual(len(short), 1)
        self.assertNotIn("similarity", short[0])

    def test_one_speaker_has_no_runner_up(self):
        result = refine.refine(embed, tone((0, 8)), [turn(0, 8000, 0)], wanted=1)
        self.assertTrue(all("runnerUp" not in t and "similarity" in t for t in result))

    def test_nothing_to_embed_returns_the_turns(self):
        turns = [turn(0, 300, 0)]
        self.assertEqual(refine.refine(embed, tone((0, 1)), turns, wanted=2), turns)


if __name__ == "__main__":
    unittest.main()
