"""Second pass over the clustered turns, built on one voice print per sliding window.

The segmentation joins short replies to the turn next to them and drops quiet speech, and one
embedding per long turn averages a second voice away. Windows of WINDOW_MS every HOP_MS are
compared with the speaker centroids instead: a run of windows that sounds clearly more like another
speaker becomes its own turn, speech the segmentation missed becomes a turn, and a second speaker
is split off a lone cluster when its windows separate. Pure numpy, the embedder is passed in."""

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

SAMPLE_RATE = 16_000
WINDOW_MS = 1_000
HOP_MS = 500
MIN_EMBED_MS = 500
SWITCH_MARGIN = 0.12
SPLIT_SIMILARITY = 0.8
SPLIT_GAIN = 0.1
SPLIT_TAIL = 0.12
MIN_SPLIT_WINDOWS = 6
CORE_SHARE = 0.6
GAP_FRAME_MS = 50
GAP_BRIDGE_FRAMES = 4
GAP_MIN_MS = 400
GAP_RELATIVE_LEVEL = 0.3
GAP_FLOOR_LEVEL = 0.004
UNCOVERED = -1

Embedder = Callable[[np.ndarray], np.ndarray]


@dataclass(frozen=True)
class Window:
    span: int
    startMs: int
    endMs: int
    cellStartMs: int
    cellEndMs: int


def unit(vector: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vector)
    return vector / norm if norm else vector


def _samples(ms: int) -> int:
    return ms * SAMPLE_RATE // 1000


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    edges = np.flatnonzero(np.diff(np.concatenate([[0], mask.astype(int), [0]])))
    return list(zip(edges[::2].tolist(), edges[1::2].tolist(), strict=False))


def uncovered_speech(audio: np.ndarray, turns: list[dict]) -> list[dict]:
    """Stretches clearly louder than the room that belong to no turn, as unlabelled turns."""
    size = _samples(GAP_FRAME_MS)
    frames = len(audio) // size
    level = np.sqrt((audio[: frames * size].reshape(frames, size) ** 2).mean(axis=1))
    covered = np.zeros(frames, dtype=bool)
    for turn in turns:
        covered[turn["startMs"] // GAP_FRAME_MS : -(-turn["endMs"] // GAP_FRAME_MS)] = True
    if not covered.any():
        return []
    loud = ~covered & (level > max(GAP_FLOOR_LEVEL, GAP_RELATIVE_LEVEL * np.median(level[covered])))
    merged: list[list[int]] = []
    for start, end in _runs(loud):
        if merged and start - merged[-1][1] <= GAP_BRIDGE_FRAMES:
            merged[-1][1] = end
        else:
            merged.append([start, end])
    return [
        {"startMs": start * GAP_FRAME_MS, "endMs": end * GAP_FRAME_MS, "speaker": UNCOVERED}
        for start, end in merged
        if (end - start) * GAP_FRAME_MS >= GAP_MIN_MS
    ]


def windows(spans: list[dict]) -> list[Window]:
    """Sliding windows over every span that is long enough to embed. A window owns the HOP_MS
    around its middle, the first and last one also the span's edges."""
    found = []
    for index, span in enumerate(spans):
        length = span["endMs"] - span["startMs"]
        if length < MIN_EMBED_MS:
            continue
        count = max(1, (length - WINDOW_MS) // HOP_MS + 1)
        for k in range(count):
            start = span["startMs"] + k * HOP_MS
            end = min(start + WINDOW_MS, span["endMs"])
            lead = (WINDOW_MS - HOP_MS) // 2
            found.append(
                Window(
                    index,
                    start,
                    end,
                    span["startMs"] if k == 0 else start + lead,
                    span["endMs"] if k == count - 1 else start + lead + HOP_MS,
                )
            )
    return found


def _core(vectors: np.ndarray) -> np.ndarray:
    """Centroid of the windows nearest to the middle: a second voice hardly moves it."""
    centre = unit(vectors.mean(axis=0))
    for _ in range(5):
        similarity = vectors @ centre
        centre = unit(vectors[similarity >= np.quantile(similarity, 1 - CORE_SHARE)].mean(axis=0))
    return centre


def centroids(vectors: np.ndarray, labels: np.ndarray) -> dict[int, np.ndarray]:
    return {int(s): _core(vectors[labels == s]) for s in set(labels.tolist()) if s != UNCOVERED}


def split_voice(vectors: np.ndarray) -> np.ndarray | None:
    """Centroid of a second voice hiding in the windows of one cluster, or None when they do not
    separate: the voice must sound unlike the main one, from enough windows that fit it clearly
    better than they fit the main one."""
    if len(vectors) < 2 * MIN_SPLIT_WINDOWS:
        return None
    main = _core(vectors)
    similarity = vectors @ main
    other = unit(vectors[similarity <= np.quantile(similarity, SPLIT_TAIL)].mean(axis=0))
    for _ in range(15):
        mine = vectors @ main >= vectors @ other
        if mine.all() or not mine.any():
            return None
        main, other = unit(vectors[mine].mean(axis=0)), unit(vectors[~mine].mean(axis=0))
    away = vectors[~mine]
    gain = float((away @ other).mean() - (away @ main).mean())
    enough = len(away) >= MIN_SPLIT_WINDOWS
    return (
        other if enough and float(main @ other) < SPLIT_SIMILARITY and gain >= SPLIT_GAIN else None
    )


def contested(spans: list[dict], placed: list[Window]) -> np.ndarray:
    """Windows whose cell overlaps a turn of another speaker: two voices at once, which one
    embedding cannot separate, so the segmentation's label stays."""
    starts = np.array([s["startMs"] for s in spans])
    ends = np.array([s["endMs"] for s in spans])
    speakers = np.array([s["speaker"] for s in spans])
    own = np.array([w.span for w in placed])
    cell_start = np.array([w.cellStartMs for w in placed])[:, None]
    cell_end = np.array([w.cellEndMs for w in placed])[:, None]
    other = (starts < cell_end) & (ends > cell_start) & (speakers != speakers[own][:, None])
    return other.any(axis=1)


def relabel(
    vectors: np.ndarray, labels: np.ndarray, spans: list[int], found: dict, fixed: np.ndarray
) -> np.ndarray:
    """Labels from the nearest centroid, except for `fixed` windows. A window of a labelled turn
    only switches as part of a run of two or more windows that fit another speaker SWITCH_MARGIN
    better, or alone at twice that."""
    ids = list(found)
    scores = vectors @ np.stack([found[s] for s in ids]).T
    best = np.array(ids)[scores.argmax(axis=1)]
    best[fixed & (labels != UNCOVERED)] = labels[fixed & (labels != UNCOVERED)]
    own = np.array([ids.index(s) if s in ids else 0 for s in labels])
    gain = scores.max(axis=1) - scores[np.arange(len(labels)), own]
    result = labels.copy()
    result[labels == UNCOVERED] = best[labels == UNCOVERED]
    index = 0
    while index < len(labels):
        end = index + 1
        while (
            end < len(labels)
            and spans[end] == spans[index]
            and best[end] == best[index]
            and labels[end] == labels[index]
        ):
            end += 1
        if labels[index] != UNCOVERED and best[index] != labels[index]:
            needed = SWITCH_MARGIN * (1 if end - index > 1 else 2)
            if gain[index:end].mean() >= needed:
                result[index:end] = best[index]
        index = end
    return result


def rebuild(
    spans: list[dict], placed: list[Window], labels: np.ndarray, folded: dict[int, int]
) -> list[dict]:
    """Turns from the labelled cells, adjacent cells of one speaker joined. `members` are the window
    indices of each turn. Turns that were not windowed keep their speaker unless it was `folded`."""
    turns: list[dict] = []
    covered = set()
    for index, (window, label) in enumerate(zip(placed, labels, strict=False)):
        covered.add(window.span)
        last = turns[-1] if turns else None
        if last and last["speaker"] == int(label) and last["span"] == window.span:
            last["endMs"] = window.cellEndMs
            last["members"].append(index)
        else:
            turns.append(
                {
                    "startMs": window.cellStartMs,
                    "endMs": window.cellEndMs,
                    "speaker": int(label),
                    "span": window.span,
                    "members": [index],
                }
            )
    kept = [
        {**s, "speaker": folded.get(s["speaker"], s["speaker"]), "span": i, "members": []}
        for i, s in enumerate(spans)
        if i not in covered
    ]
    return sorted(
        turns + [k for k in kept if k["speaker"] != UNCOVERED], key=lambda t: t["startMs"]
    )


def score(turns: list[dict], vectors: np.ndarray, found: dict[int, np.ndarray]) -> None:
    """Adds `similarity` (cosine of the turn's voice print to its speaker's centroid) and, when
    there is another speaker, `runnerUp` (the best other one). Turns too short to embed get none."""
    for turn in turns:
        members = turn.pop("members")
        turn.pop("span")
        if not members:
            continue
        voice = unit(vectors[members].sum(axis=0))
        turn["similarity"] = round(float(voice @ found[turn["speaker"]]), 4)
        others = {s: float(voice @ c) for s, c in found.items() if s != turn["speaker"]}
        if others:
            speaker = max(others, key=others.__getitem__)
            turn["runnerUp"] = {"speaker": speaker, "similarity": round(others[speaker], 4)}


def substantial(labels: np.ndarray) -> int:
    counts = np.unique(labels[labels != UNCOVERED], return_counts=True)[1]
    return int((counts >= MIN_SPLIT_WINDOWS).sum())


def fold_strays(
    vectors: np.ndarray, labels: np.ndarray, wanted: int
) -> tuple[np.ndarray, dict[int, int]]:
    """While there are more than `wanted` speakers, the one with the fewest windows joins the
    speaker it sounds most like. Returns the new labels and who was folded into whom."""
    labels = labels.copy()
    folded: dict[int, int] = {}
    found = centroids(vectors, labels)
    while len(found) > wanted:
        small = min(found, key=lambda s: int((labels == s).sum()))
        target = max((s for s in found if s != small), key=lambda s: float(found[small] @ found[s]))
        labels[labels == small] = target
        folded = {old: (target if new == small else new) for old, new in folded.items()}
        folded[small] = target
        found = centroids(vectors, labels)
    return labels, folded


def refine(embed: Embedder, audio: np.ndarray, turns: list[dict], wanted: int | None) -> list[dict]:
    """Turns after the window pass, with `similarity` and `runnerUp`. With a known number of
    speakers, the biggest one is split in two while fewer than `wanted` have a real share of the
    windows and its windows separate, and the smallest are folded away while there are more."""
    spans = turns + uncovered_speech(audio, turns)
    placed = windows(spans)
    if not placed:
        return turns
    vectors = np.stack(
        [unit(embed(audio[_samples(w.startMs) : _samples(w.endMs)])) for w in placed]
    )
    labels = np.array([spans[w.span]["speaker"] for w in placed])
    found = centroids(vectors, labels)
    trial = labels.copy()
    next_id = max(t["speaker"] for t in turns) + 1
    while wanted and substantial(trial) < wanted:
        main = max(found, key=lambda s: int((trial == s).sum()))
        voice = split_voice(vectors[trial == main])
        if voice is None:
            break
        mine = np.flatnonzero(trial == main)
        trial[mine[vectors[mine] @ voice > vectors[mine] @ found[main]]] = next_id
        found[next_id] = voice
        next_id += 1
    labels = relabel(vectors, labels, [w.span for w in placed], found, contested(spans, placed))
    labels, folded = fold_strays(vectors, labels, wanted) if wanted else (labels, {})
    result = rebuild(spans, placed, labels, folded)
    score(result, vectors, centroids(vectors, labels))
    return result
