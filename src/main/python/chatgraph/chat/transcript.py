"""Two-participant conversation transcript writer.

Writes two files in parallel:

- ``transcripts/<session>.txt`` -- human-readable, one utterance per
  paragraph, ``speaker: text`` formatting.
- ``transcripts/<session>.jsonl`` -- JSON Lines, one utterance per line with
  start/end timestamps and an ``interrupted`` flag for agent turns that
  were cut short by barge-in.

Both files are append-only. Each ``write(utterance)`` flushes immediately
so partial transcripts survive a crash.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Utterance:
    speaker: str  # "patient" or "agent"
    text: str
    ts_start: float
    ts_end: float
    interrupted: bool = False


class TranscriptWriter:
    def __init__(self, session_dir: Path | None = None) -> None:
        if session_dir is None:
            session_dir = Path("transcripts")
        session_dir.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y%m%d-%H%M%S")
        self._txt = (session_dir / f"{stamp}.txt").open("a", encoding="utf-8")
        self._jsonl = (session_dir / f"{stamp}.jsonl").open("a", encoding="utf-8")
        self.txt_path = Path(self._txt.name)
        self.jsonl_path = Path(self._jsonl.name)

    def write(self, u: Utterance) -> None:
        # During shutdown a coroutine may race to write an utterance after
        # close() has run; ignore those writes rather than crashing.
        if self._txt.closed or self._jsonl.closed:
            return
        suffix = " [interrupted]" if u.interrupted else ""
        self._txt.write(f"{u.speaker}: {u.text}{suffix}\n\n")
        self._txt.flush()
        self._jsonl.write(
            json.dumps(
                {
                    "speaker": u.speaker,
                    "text": u.text,
                    "ts_start": u.ts_start,
                    "ts_end": u.ts_end,
                    "interrupted": u.interrupted,
                }
            )
            + "\n"
        )
        self._jsonl.flush()

    def close(self) -> None:
        self._txt.close()
        self._jsonl.close()

    def __enter__(self) -> TranscriptWriter:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()
