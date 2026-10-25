#!/usr/bin/env python3
"""Evaluate the OpenMinutes audio pipeline on public AMI meetings (CC BY 4.0).

Steps (run `ami_eval.py all` or one by one): fetch, prepare, asr, diar, score.
Everything is written under $EVAL_DIR (default ~/.cache/openminutes-eval), never into git.
Run with the e2e venv python (faster-whisper, sherpa-onnx, numpy, scipy) and ffmpeg + node on PATH.
"""
import argparse, ast, json, math, os, re, resource, subprocess, sys, time, urllib.request, zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ROOT = Path(os.environ.get("EVAL_DIR", "~/.cache/openminutes-eval")).expanduser()
MEETINGS = os.environ.get("EVAL_MEETINGS", "ES2004a ES2014a IS1009a TS3003a TS3007a").split()
WINDOW = float(os.environ.get("EVAL_WINDOW", "600"))  # seconds of real meeting per recording
PAD = 30.0  # seconds of synthetic silence before (digital) and after (-55 dB noise) the meeting
AMI = "https://groups.inf.ed.ac.uk/ami"
RTTM_URL = "https://raw.githubusercontent.com/BUTSpeechFIT/AMI-diarization-setup/main/only_words/rttms"
FILLERS = {"uh", "um", "mm", "hmm", "mhm", "er", "erm", "ah", "eh", "huh", "uhhuh", "mmm", "hm"}
ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def sh(*cmd, **kw):
    return subprocess.run(cmd, check=True, **kw)


def get(url, dest):
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=600) as r, dest.open("wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)


def fetch():
    for m in MEETINGS:
        get(f"{AMI}/AMICorpusMirror/amicorpus/{m}/audio/{m}.Mix-Headset.wav", ROOT / "raw" / f"{m}.wav")
        for split in ("test", "dev", "train"):
            try:
                get(f"{RTTM_URL}/{split}/{m}.rttm", ROOT / "ref" / f"{m}.rttm")
                break
            except OSError:
                continue
    zpath = ROOT / "ann.zip"
    get(f"{AMI}/AMICorpusAnnotations/ami_public_manual_1.6.2.zip", zpath)
    with zipfile.ZipFile(zpath) as z:
        for n in z.namelist():
            if n.startswith("words/") and any(f"/{m}." in "/" + n for m in MEETINGS):
                z.extract(n, ROOT / "ann")


def prepare():
    out = ROOT / "audio"
    out.mkdir(exist_ok=True)
    for m in MEETINGS:
        dst = out / f"{m}.wav"
        if dst.exists():
            continue
        sh("ffmpeg", "-v", "error", "-y", "-i", str(ROOT / "raw" / f"{m}.wav"), "-t", str(WINDOW), "-ac", "1", "-ar", "16000", str(out / "core.wav"))
        sh("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"anullsrc=r=16000:cl=mono", "-t", str(PAD), str(out / "lead.wav"))
        sh("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anoisesrc=r=16000:a=0.0018:c=white", "-t", str(PAD), str(out / "tail.wav"))
        lst = out / "list.txt"
        lst.write_text("".join(f"file '{out / n}.wav'\n" for n in ("lead", "core", "tail")))
        sh("ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-ar", "16000", "-ac", "1", str(dst))
        for n in ("core", "lead", "tail"):
            (out / f"{n}.wav").unlink()
        lst.unlink()


# ---- jobs that run in a subprocess so RAM is measured per run ----

def prompts():
    tree = ast.parse((REPO / "services/whisper/app.py").read_text())
    for node in tree.body:
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", "") == "PUNCTUATION_PROMPTS":
            return ast.literal_eval(node.value)
    return {}


def job_asr(model, compute, audio, out):
    from faster_whisper import WhisperModel
    from faster_whisper.audio import decode_audio
    t0 = time.time()
    whisper = WhisperModel(model, device="cpu", compute_type=compute)
    load = time.time() - t0
    t0 = time.time()
    samples = decode_audio(audio)
    # Same call as services/whisper/app.py /transcribe.
    segments, _ = whisper.transcribe(samples, language="en", initial_prompt=prompts().get("en"), vad_filter=True, word_timestamps=True)
    rows = [
        {"startMs": round(s.start * 1000), "endMs": round(s.end * 1000), "text": s.text.strip(),
         "words": [{"startMs": round(w.start * 1000), "endMs": round(w.end * 1000), "text": w.word.strip()} for w in s.words or []]}
        for s in segments
    ]
    run = time.time() - t0
    Path(out).write_text(json.dumps({"segments": rows, "loadS": load, "runS": run, "audioS": len(samples) / 16000,
                                     "maxRssMb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024}))


def job_diar(audio, out):
    sys.path.insert(0, str(REPO / "services/whisper"))
    os.environ.setdefault("DIARIZATION_MODEL_DIR", str(Path("~/.cache/openminutes-e2e/diarize-models").expanduser()))
    import diarize
    results = {}
    for name, (n, thr) in CONFIGS.items():
        t0 = time.time()
        r = diarize.diarize_file(audio, n, thr)
        results[name] = {"result": r, "runS": time.time() - t0}
    Path(out).write_text(json.dumps({"configs": results, "maxRssMb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024}))


# name -> (num_speakers, threshold). "default" is what the service does today.
CONFIGS = {"default": (None, None), "t0.8": (None, 0.8), "t1.0": (None, 1.0), "t1.1": (None, 1.1), "oracle4": (4, None)}


def run_jobs(only):
    (ROOT / "out").mkdir(exist_ok=True)
    plan = [("small", "default"), ("medium", "default"), ("small", "int8")]
    big = os.environ.get("EVAL_LARGE", "IS1009a")
    for m in MEETINGS:
        audio, base = ROOT / "audio" / f"{m}.wav", ROOT / "out" / m
        if only in ("all", "diar") and not Path(f"{base}.diar.json").exists():
            sh(sys.executable, "-I", __file__, "job-diar", str(audio), f"{base}.diar.json")
        if only in ("all", "asr"):
            jobs = plan + ([("large-v3", "default")] if m == big else [])
            for model, compute in jobs:
                dst = Path(f"{base}.{model}-{compute}.asr.json")
                if not dst.exists():
                    sh(sys.executable, "-I", __file__, "job-asr", model, compute, str(audio), str(dst))


# ---- scoring ----

def spell(n):
    if n < 20: return ONES[n]
    if n < 100: return TENS[n // 10] + ("" if n % 10 == 0 else " " + ONES[n % 10])
    if n < 1000: return ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + spell(n % 100))
    if n < 10000 and n % 1000 == 0: return ONES[n // 1000] + " thousand"
    return " ".join(ONES[int(c)] for c in str(n))


def normalize(text):
    text = text.lower().replace("%", " percent ").replace("&", " and ").replace("-", " ")
    text = re.sub(r"(\d),(\d)", r"\1\2", text)
    text = re.sub(r"\d+", lambda m: " " + spell(int(m.group())) + " ", text)
    text = text.replace("ok ", "okay ")
    words = [re.sub(r"[^a-z0-9']", "", w) for w in text.split()]
    return [w for w in words if w and w not in FILLERS]


def edit_distance(ref, hyp):
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i] + [0] * len(hyp)
        for j, h in enumerate(hyp, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h))
        prev = cur
    return prev[-1]


def ref_words(m):
    """Reference words with time and speaker, within the window; punctuation tokens kept apart."""
    words, punct = [], []
    for f in sorted((ROOT / "ann/words").glob(f"{m}.*.words.xml")):
        spk = f.name.split(".")[1]
        for el in ET.parse(f).getroot():
            if el.tag != "w" or el.get("trunc") == "true" or el.get("starttime") is None:
                continue
            t = float(el.get("starttime"))
            if t >= WINDOW:
                continue
            (punct if el.get("punc") == "true" else words).append((t, spk, (el.text or "").strip()))
    return sorted(words), sorted(punct)


def ref_rttm(m):
    segs = []
    for line in (ROOT / "ref" / f"{m}.rttm").read_text().splitlines():
        p = line.split()
        s, d = float(p[3]), float(p[4])
        if s < WINDOW:
            segs.append((s, min(WINDOW, s + d), p[7]))
    return segs


def der(ref, hyp, collar):
    """Frame level (10 ms) DER with overlap scored, optimal speaker mapping, collar around ref edges."""
    import numpy as np
    from scipy.optimize import linear_sum_assignment
    n = int(WINDOW * 100)
    rs, hs = sorted({r[2] for r in ref}), sorted({h[2] for h in hyp})
    R, H = np.zeros((len(rs), n), bool), np.zeros((max(1, len(hs)), n), bool)
    for s, e, k in ref:
        R[rs.index(k), int(s * 100):int(e * 100)] = True
    for s, e, k in hyp:
        if e > 0 and s < WINDOW:
            H[hs.index(k), max(0, int(s * 100)):min(n, int(e * 100))] = True
    keep = np.ones(n, bool)
    if collar:
        for s, e, _ in ref:
            for edge in (s, e):
                keep[max(0, int((edge - collar) * 100)):int((edge + collar) * 100)] = False
    R, H = R[:, keep], H[:, keep]
    overlap = R.astype(np.int32) @ H.T.astype(np.int32)
    ri, hi = linear_sum_assignment(-overlap)
    nr, nh = R.sum(0), H.sum(0)
    correct = np.zeros(R.shape[1], int)
    for a, b in zip(ri, hi):
        correct += R[a] & H[b]
    miss, fa = np.maximum(nr - nh, 0).sum(), np.maximum(nh - nr, 0).sum()
    conf = (np.minimum(nr, nh) - correct).sum()
    total = nr.sum()
    return {"der": (miss + fa + conf) / total, "miss": miss / total, "fa": fa / total, "conf": conf / total}, dict(zip([rs[a] for a in ri], [hs[b] for b in hi]))


def word_attribution(rwords, rttm, hyp_words, turns, mapping_from):
    """Share of hypothesis words that carry the right speaker (after best mapping) and share left unknown."""
    import numpy as np
    from scipy.optimize import linear_sum_assignment
    def at(segs, a, b):
        best, who = 0, None
        for s, e, k in segs:
            o = min(b, e) - max(a, s)
            if o > best: best, who = o, k
        return who
    pairs = [(at(rttm, a, b), at(turns, a, b)) for a, b in hyp_words]
    pairs = [(r, h) for r, h in pairs if r is not None]
    rs, hs = sorted({r for r, _ in pairs}), sorted({h for _, h in pairs if h is not None})
    if not pairs or not hs: return 0.0, 1.0
    C = np.zeros((len(rs), len(hs)))
    for r, h in pairs:
        if h is not None: C[rs.index(r), hs.index(h)] += 1
    ri, hi = linear_sum_assignment(-C)
    good = C[ri, hi].sum()
    return good / len(pairs), sum(h is None for _, h in pairs) / len(pairs)


def silences(audio, dur_ms):
    log = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", audio, "-af", "silencedetect=noise=-45dB:d=2", "-f", "null", "-"], capture_output=True, text=True).stderr
    out, start = [], None
    for line in log.splitlines():
        a, b = re.search(r"silence_start: (-?[\d.]+)", line), re.search(r"silence_end: (-?[\d.]+)", line)
        if a: start = max(0, round(float(a[1]) * 1000))
        elif b and start is not None: out.append({"startMs": start, "endMs": round(float(b[1]) * 1000)}); start = None
    if start is not None and start < dur_ms: out.append({"startMs": start, "endMs": dur_ms})
    return out


def gate(segments, sil):
    r = subprocess.run(["node", str(Path(__file__).parent / "gate.mjs")], input=json.dumps({"segments": segments, "silences": sil}), capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def in_window(s):  # by segment midpoint, seconds relative to the meeting start
    return 0 <= (s["startMs"] + s["endMs"]) / 2000 - PAD < WINDOW


def punct_stats(texts, words):
    t = " ".join(texts)
    n = max(1, words)
    return {"end": len(re.findall(r"[.?!]", t)) / n * 100, "comma": t.count(",") / n * 100}


def score():
    rows = []
    for m in MEETINGS:
        rw, rp = ref_words(m)
        ref_tokens = normalize(" ".join(w[2] for w in rw))
        rttm = ref_rttm(m)
        dur_ms = round((WINDOW + 2 * PAD) * 1000)
        sil = silences(str(ROOT / "audio" / f"{m}.wav"), dur_ms)
        ref_punct = punct_stats([p[2] for p in rp], len(rw))
        for f in sorted((ROOT / "out").glob(f"{m}.*.asr.json")):
            name = f.name[len(m) + 1:-len(".asr.json")]
            d = json.loads(f.read_text())
            raw = d["segments"]
            kept = gate(raw, sil)
            rec = {"meeting": m, "system": name, "rtf": d["runS"] / d["audioS"], "ram": d["maxRssMb"], "refWords": len(ref_tokens)}
            for label, segs in (("raw", raw), ("gated", kept)):
                inside = [s for s in segs if in_window(s)]
                pad = [s for s in segs if not in_window(s)]
                hyp = normalize(" ".join(s["text"] for s in inside))
                rec[label] = {"wer": edit_distance(ref_tokens, hyp) / len(ref_tokens), "padWords": len(normalize(" ".join(s["text"] for s in pad))), "padSegs": len(pad)}
            inside = [s for s in kept if in_window(s)]
            rec["punct"] = punct_stats([s["text"] for s in inside], len(normalize(" ".join(s["text"] for s in inside))) or 1)
            rec["refPunct"] = ref_punct
            rec["lostWords"] = max(0, len(ref_tokens) - len(normalize(" ".join(s["text"] for s in inside)))) 
            if name == "small-default":  # diarization is scored once, words from the default model
                dj = json.loads((ROOT / "out" / f"{m}.diar.json").read_text())
                hw = [((w["startMs"] / 1000 - PAD), (w["endMs"] / 1000 - PAD)) for s in inside for w in s["words"]]
                rec["diar"] = {}
                for cname, c in dj["configs"].items():
                    r = c["result"]
                    hyp_t = [(t["startMs"] / 1000 - PAD, t["endMs"] / 1000 - PAD, t["speaker"]) for t in r["turns"]]
                    d0, _ = der(rttm, hyp_t, 0.0)
                    d25, _ = der(rttm, hyp_t, 0.25)
                    acc, unk = word_attribution(rw, rttm, hw, hyp_t, None)
                    rec["diar"][cname] = {"speakers": len(r["speakers"]), "refSpeakers": len({x[2] for x in rttm}), "der": d25["der"], "der0": d0["der"], "miss": d25["miss"], "fa": d25["fa"], "conf": d25["conf"], "wordAcc": acc, "unknown": unk, "rtf": c["runS"] / (WINDOW + 2 * PAD)}
                rec["diarRam"] = dj["maxRssMb"]
            rows.append(rec)
    (ROOT / "scores.json").write_text(json.dumps(rows, indent=1))
    report(rows)


def mean(xs):
    xs = list(xs)
    return sum(xs) / len(xs) if xs else float("nan")


def report(rows):
    print("| system | files | WER raw | WER gated | pad words raw | pad words gated | pad segs raw | RTF | peak RAM MB | end-punct /100w | comma /100w |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for name in sorted({r["system"] for r in rows}):
        rs = [r for r in rows if r["system"] == name]
        print(f"| {name} | {len(rs)} | {mean(r['raw']['wer'] for r in rs):.1%} | {mean(r['gated']['wer'] for r in rs):.1%} | {mean(r['raw']['padWords'] for r in rs):.1f} | {mean(r['gated']['padWords'] for r in rs):.1f} | {mean(r['raw']['padSegs'] for r in rs):.1f} | {mean(r['rtf'] for r in rs):.2f} | {mean(r['ram'] for r in rs):.0f} | {mean(r['punct']['end'] for r in rs):.1f} | {mean(r['punct']['comma'] for r in rs):.1f} |")
    ref = [r["refPunct"] for r in rows if r["system"] == "small-default"]
    print(f"\nreference (AMI manual transcripts): end-punct {mean(x['end'] for x in ref):.1f}, comma {mean(x['comma'] for x in ref):.1f} per 100 words\n")
    print("| diarization config | mean speakers (ref mean) | exact count | DER c0.25 | DER c0 | miss | FA | conf | word speaker acc | words w/o speaker | RTF |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    ds = [r for r in rows if "diar" in r]
    for c in CONFIGS:
        xs = [r["diar"][c] for r in ds]
        print(f"| {c} | {mean(x['speakers'] for x in xs):.1f} ({mean(x['refSpeakers'] for x in xs):.1f}) | {sum(x['speakers'] == x['refSpeakers'] for x in xs)}/{len(xs)} | {mean(x['der'] for x in xs):.1%} | {mean(x['der0'] for x in xs):.1%} | {mean(x['miss'] for x in xs):.1%} | {mean(x['fa'] for x in xs):.1%} | {mean(x['conf'] for x in xs):.1%} | {mean(x['wordAcc'] for x in xs):.1%} | {mean(x['unknown'] for x in xs):.1%} | {mean(x['rtf'] for x in xs):.2f} |")


def diar_quick():
    """Diarization only, no ASR: DER and the share of reference words that get the right speaker
    (the reference word times stand in for a perfect transcript), default and true speaker count."""
    sys.path.insert(0, str(REPO / "services/whisper"))
    os.environ.setdefault("DIARIZATION_MODEL_DIR", str(Path("~/.cache/openminutes-e2e/diarize-models").expanduser()))
    import diarize
    rows = {name: [] for name in ("default", "oracle4")}
    for m in MEETINGS:
        rw, _ = ref_words(m)
        rttm = ref_rttm(m)
        words = [(t, t + 0.25) for t, _, _ in rw]
        for name, count in (("default", None), ("oracle4", 4)):
            t0 = time.time()
            r = diarize.diarize_file(str(ROOT / "audio" / f"{m}.wav"), count, None)
            hyp = [(t["startMs"] / 1000 - PAD, t["endMs"] / 1000 - PAD, t["speaker"]) for t in r["turns"]]
            d, _ = der(rttm, hyp, 0.25)
            acc, unknown = word_attribution(rw, rttm, words, hyp, None)
            rows[name].append((len(r["speakers"]), d["der"], d["miss"], d["fa"], d["conf"], acc, unknown, time.time() - t0))
            print(m, name, rows[name][-1], flush=True)
    print("| config | speakers | DER c0.25 | miss | FA | conf | word speaker acc | words w/o speaker | s per meeting |")
    print("|---|---|---|---|---|---|---|---|---|")
    for name, rs in rows.items():
        mean = [sum(col) / len(col) for col in zip(*rs)]
        print(f"| {name} | {mean[0]:.1f} | {mean[1]:.1%} | {mean[2]:.1%} | {mean[3]:.1%} | {mean[4]:.1%} | {mean[5]:.1%} | {mean[6]:.1%} | {mean[7]:.0f} |")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("step", choices=["fetch", "prepare", "asr", "diar", "score", "diar-quick", "all", "job-asr", "job-diar"])
    p.add_argument("args", nargs="*")
    a = p.parse_args()
    ROOT.mkdir(parents=True, exist_ok=True)
    if a.step == "job-asr": return job_asr(*a.args)
    if a.step == "job-diar": return job_diar(*a.args)
    if a.step in ("fetch", "all"): fetch()
    if a.step in ("prepare", "all"): prepare()
    if a.step in ("asr", "diar", "all"): run_jobs(a.step)
    if a.step in ("score", "all"): score()
    if a.step == "diar-quick": diar_quick()


if __name__ == "__main__":
    main()
