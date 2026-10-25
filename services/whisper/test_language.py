import unittest
from unittest import mock

import numpy as np

import language


class FakeWhisper:
    def __init__(self, answers):
        self.answers = iter(answers)

    def detect_language(self, _audio):
        return (*next(self.answers), {})


def speech(seconds):
    return np.zeros(seconds * language.SAMPLE_RATE, dtype=np.float32)


def detect(answers, seconds):
    whisper = FakeWhisper(answers)
    spans = [{"start": 0, "end": seconds * language.SAMPLE_RATE}]
    with mock.patch.object(language, "get_speech_timestamps", return_value=spans):
        return language.detect(whisper, speech(seconds))


class DetectTest(unittest.TestCase):
    def test_majority_beats_one_poisoned_window(self):
        answers = [("cy", 0.9)] + [("nl", 0.8)] * 6
        result = detect(answers, 300)
        self.assertEqual(result["language"], "nl")

    def test_no_speech_names_no_language(self):
        with mock.patch.object(language, "get_speech_timestamps", return_value=[]):
            result = language.detect(FakeWhisper([]), speech(60))
        self.assertEqual(result, {"language": None, "confidence": 0.0})

    def test_split_votes_name_no_language(self):
        result = detect([("nl", 0.6), ("en", 0.6), ("de", 0.6), ("fr", 0.6)] * 2, 300)
        self.assertIsNone(result["language"])

    def test_short_audio_is_one_window(self):
        result = detect([("nl", 0.9)], 10)
        self.assertEqual(result, {"language": "nl", "confidence": 1.0})


if __name__ == "__main__":
    unittest.main()
