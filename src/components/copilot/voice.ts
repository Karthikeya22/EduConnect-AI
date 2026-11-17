/**
 * Replaceable browser voice adapters. Text works without these.
 * Live Web Speech is best-effort; never treat confidence as authorization.
 */

export type TranscriptEvent = {
  text: string;
  isFinal: boolean;
  confidence?: number;
};

export interface SpeechToText {
  available(): boolean;
  start(): void;
  stop(): TranscriptEvent;
  onPartial?: (ev: TranscriptEvent) => void;
}

export interface TextToSpeech {
  available(): boolean;
  speak(text: string, opts?: { allowNames?: boolean; allowGrades?: boolean }): void;
  stop(): void;
  mute(muted: boolean): void;
}

export class MockSTT implements SpeechToText {
  constructor(private finals: string[] = []) {}
  private i = 0;
  available() {
    return true;
  }
  start() {}
  stop(): TranscriptEvent {
    const text = this.finals[this.i++] ?? '';
    return { text, isFinal: true, confidence: 1 };
  }
}

export class MockTTS implements TextToSpeech {
  spoken: string[] = [];
  private muted = false;
  available() {
    return true;
  }
  speak(text: string) {
    if (!this.muted) this.spoken.push(text);
  }
  stop() {}
  mute(muted: boolean) {
    this.muted = muted;
  }
}

export class UnavailableSTT implements SpeechToText {
  available() {
    return false;
  }
  start(): void {
    throw new Error('Speech recognition unavailable');
  }
  stop(): TranscriptEvent {
    throw new Error('Speech recognition unavailable');
  }
}

export class UnavailableTTS implements TextToSpeech {
  available() {
    return false;
  }
  speak(): void {
    throw new Error('Speech synthesis unavailable');
  }
  stop() {}
  mute() {}
}

/** Browser Web Speech when present; otherwise unavailable (not falsely functional). */
export function createBrowserSTT(): SpeechToText {
  const SR =
    typeof window !== 'undefined'
      ? (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any })
          .SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition
      : undefined;
  if (!SR) return new UnavailableSTT();

  let last: TranscriptEvent = { text: '', isFinal: false };
  let rec: any = null;
  return {
    available: () => true,
    start() {
      rec = new SR();
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (event: any) => {
        const result = event.results[event.results.length - 1];
        last = {
          text: result[0].transcript,
          isFinal: Boolean(result.isFinal),
          confidence: result[0].confidence,
        };
      };
      rec.start();
    },
    stop() {
      try {
        rec?.stop();
      } catch {
        /* ignore */
      }
      return { ...last, isFinal: true };
    },
  };
}

export function createBrowserTTS(): TextToSpeech {
  if (typeof window === 'undefined' || !window.speechSynthesis) return new UnavailableTTS();
  let muted = false;
  return {
    available: () => true,
    speak(text, opts) {
      if (muted) return;
      // Default: do not speak grades/names unless opted in (caller must sanitize).
      if (!opts?.allowGrades && /\d+\s*\/\s*\d+/.test(text)) return;
      const u = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(u);
    },
    stop() {
      window.speechSynthesis.cancel();
    },
    mute(m) {
      muted = m;
      if (m) window.speechSynthesis.cancel();
    },
  };
}
