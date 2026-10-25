import unittest
from types import SimpleNamespace

import numpy as np

import app
import tones

RATE = tones.SAMPLE_RATE
RNG = np.random.default_rng(7)


def word(text, start, end, probability=0.9):
    return SimpleNamespace(word=f" {text}", start=start, end=end, probability=probability)


def chime(seconds=0.5):
    t = np.arange(int(seconds * RATE)) / RATE
    return (
        0.3 * np.exp(-t * 4) * (np.sin(2 * np.pi * 660 * t) + np.sin(2 * np.pi * 880 * t))
    ).astype(np.float32)


def speech(seconds):
    """Voiced noise with a moving formant: not a pure tone."""
    t = np.arange(int(seconds * RATE)) / RATE
    carrier = np.sin(2 * np.pi * 120 * t) * (1 + np.sin(2 * np.pi * 3 * t))
    return (0.2 * carrier + 0.05 * RNG.standard_normal(len(t))).astype(np.float32)


def recording(lead: np.ndarray, gap: float = 0.5) -> np.ndarray:
    return np.concatenate([lead, np.zeros(int(gap * RATE), np.float32), speech(1.5)])


class StrayLeadTest(unittest.TestCase):
    def test_pure_tone_heard_as_you_is_stray_even_when_the_model_is_sure(self):
        words = [word("You", 0.0, 0.5, 0.9), word("Good", 1.0, 1.3), word("morning", 1.3, 1.8)]
        self.assertTrue(tones.stray_lead(recording(chime()), words))

    def test_unsure_interjection_stretched_over_half_a_second_is_stray(self):
        words = [word("Woo!", 0.0, 0.7, 0.15), word("Good", 1.0, 1.3)]
        self.assertTrue(tones.stray_lead(recording(speech(0.7)), words))

    def test_unsure_short_word_before_a_comma_pause_is_kept(self):
        words = [word("Hi,", 0.0, 0.3, 0.3), word("all", 0.5, 0.7)]
        self.assertFalse(tones.stray_lead(recording(speech(0.3), 0.2), words))

    def test_stretched_confident_word_is_kept(self):
        words = [word("Yeah", 0.0, 0.8, 0.9), word("sure", 1.0, 1.3)]
        self.assertFalse(tones.stray_lead(recording(speech(0.8)), words))

    def test_spoken_you_followed_by_a_pause_is_kept(self):
        words = [word("You", 0.0, 0.5, 0.9), word("know", 1.0, 1.3)]
        self.assertFalse(tones.stray_lead(recording(speech(0.5)), words))

    def test_unsure_word_without_a_pause_is_kept(self):
        words = [word("You", 0.0, 0.5, 0.2), word("know", 0.6, 1.0)]
        self.assertFalse(tones.stray_lead(recording(speech(0.5), 0.1), words))

    def test_longer_words_and_lone_words_are_kept(self):
        audio = recording(chime())
        self.assertFalse(
            tones.stray_lead(audio, [word("Welcome", 0.0, 0.5, 0.1), word("all", 1.0, 1.3)])
        )
        self.assertFalse(tones.stray_lead(audio, [word("You", 0.0, 0.5, 0.1)]))
        self.assertFalse(tones.stray_lead(audio, []))

    def test_flatness_tells_a_tone_from_speech(self):
        self.assertLess(tones.spectral_flatness(chime()), tones.PURE_TONE_FLATNESS)
        self.assertGreater(tones.spectral_flatness(speech(0.5)), tones.PURE_TONE_FLATNESS)
        self.assertIsNone(tones.spectral_flatness(np.zeros(100, np.float32)))


class SegmentJsonTest(unittest.TestCase):
    def segment(self, words):
        return SimpleNamespace(
            start=words[0].start,
            end=words[-1].end,
            text="".join(w.word for w in words),
            avg_logprob=-0.2,
            words=words,
        )

    def test_stray_lead_is_removed_from_text_words_and_start(self):
        words = [word("You", 0.0, 0.5), word("Good", 1.0, 1.3), word("morning", 1.3, 1.8)]
        result = app.as_json(self.segment(words), recording(chime()))
        self.assertEqual(result["text"], "Good morning")
        self.assertEqual(result["startMs"], 1000)
        self.assertEqual([w["text"] for w in result["words"]], ["Good", "morning"])

    def test_other_segments_are_unchanged(self):
        words = [word("You", 0.0, 0.5), word("know", 0.55, 0.9)]
        result = app.as_json(self.segment(words), recording(speech(0.5), 0.1))
        self.assertEqual(result["text"], "You know")
        self.assertEqual(result["startMs"], 0)


if __name__ == "__main__":
    unittest.main()
