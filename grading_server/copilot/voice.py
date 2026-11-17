"""Replaceable STT/TTS interfaces. Text works without voice dependencies.

First release: push-to-talk semantics, editable final transcripts, no always-on mic,
no raw-audio retention by default, no action from partial transcripts.
Speech-recognition confidence is never authorization.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class TranscriptEvent:
    text: str
    is_final: bool
    confidence: float | None = None  # informational only — never authz
    corrected: bool = False


@dataclass
class SpeakRequest:
    text: str
    allow_names: bool = False
    allow_grades: bool = False
    allow_submission_quotes: bool = False


class SpeechToText(Protocol):
    def start_utt(self) -> None: ...
    def stop_utt(self) -> TranscriptEvent: ...
    def available(self) -> bool: ...


class TextToSpeech(Protocol):
    def speak(self, req: SpeakRequest) -> None: ...
    def stop(self) -> None: ...
    def mute(self, muted: bool) -> None: ...
    def available(self) -> bool: ...


@dataclass
class MockSTT:
    """Offline tests: scripted finals; partials never executable."""

    script: list[TranscriptEvent] = field(default_factory=list)
    _idx: int = 0
    _listening: bool = False

    def available(self) -> bool:
        return True

    def start_utt(self) -> None:
        self._listening = True

    def stop_utt(self) -> TranscriptEvent:
        self._listening = False
        if self._idx >= len(self.script):
            return TranscriptEvent(text="", is_final=True, confidence=1.0)
        ev = self.script[self._idx]
        self._idx += 1
        return ev


@dataclass
class MockTTS:
    spoken: list[str] = field(default_factory=list)
    muted: bool = False
    stopped: bool = False

    def available(self) -> bool:
        return True

    def speak(self, req: SpeakRequest) -> None:
        if self.muted:
            return
        # Default: refuse names/grades/quotes unless explicitly allowed.
        text = req.text
        if not req.allow_names:
            text = _strip_sensitive(text)
        if not req.allow_grades:
            text = _strip_grades(text)
        self.spoken.append(text)
        self.stopped = False

    def stop(self) -> None:
        self.stopped = True

    def mute(self, muted: bool) -> None:
        self.muted = muted


@dataclass
class UnavailableSTT:
    reason: str = "Live speech recognition is not installed in this build."

    def available(self) -> bool:
        return False

    def start_utt(self) -> None:
        raise RuntimeError(self.reason)

    def stop_utt(self) -> TranscriptEvent:
        raise RuntimeError(self.reason)


@dataclass
class UnavailableTTS:
    reason: str = "Live text-to-speech is not installed in this build."

    def available(self) -> bool:
        return False

    def speak(self, req: SpeakRequest) -> None:
        raise RuntimeError(self.reason)

    def stop(self) -> None:
        return None

    def mute(self, muted: bool) -> None:
        return None


def sanitize_spoken_summary(text: str) -> str:
    """Default spoken output: concise, no names/grades/submission quotes."""
    return _strip_grades(_strip_sensitive(text))


def _strip_sensitive(text: str) -> str:
    # Heuristic scrub for demos — UI still must not pass PII into TTS by default.
    import re

    text = re.sub(r"\b[A-Z][a-z]+ [A-Z][a-z]+\b", "[student]", text)
    return text


def _strip_grades(text: str) -> str:
    import re

    text = re.sub(r"\b\d{1,3}(\.\d+)?\s*/\s*\d{1,3}(\.\d+)?\b", "[score]", text)
    text = re.sub(r"\bscore(d|s)?\s*[:=]?\s*\d+(\.\d+)?\b", "score [hidden]", text, flags=re.I)
    return text


# Selected future real-time framework (document only — do not install both):
# Prefer **LiveKit Agents** for browser push-to-talk + server relays when a speech
# key is approved. Pipecat remains an alternative; never install LiveKit and
# Pipecat together in this repo without an explicit product decision.
FUTURE_VOICE_FRAMEWORK = "livekit-agents"
