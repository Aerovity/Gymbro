"use client";
// Speaks the coach's spoken_summary once it is final and the voice toggle is on.
// Server TTS (OpenAI) when configured, otherwise the browser's speechSynthesis.
import { useEffect, useRef } from "react";
import { usePipelineStore } from "@/lib/store/pipeline";
import { fetchTts } from "@/lib/api/client";

let audio: HTMLAudioElement | null = null;

function stopSpeaking() {
  audio?.pause();
  audio = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

function speakBrowser(text: string) {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text.replace(/°/g, " degrees"));
  const en = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  u.voice = en.find((v) => /daniel|alex|guy|male|david|george|ryan/i.test(v.name)) ?? en[0] ?? null;
  u.rate = 1.03;
  u.pitch = 0.85;
  window.speechSynthesis.speak(u);
}

async function speak(text: string) {
  stopSpeaking();
  try {
    const blob = await fetchTts(text);
    audio = new Audio(URL.createObjectURL(blob));
    await audio.play();
  } catch {
    speakBrowser(text);
  }
}

export function useCoachVoice() {
  const voiceOn = usePipelineStore((s) => s.voiceOn);
  const summary = usePipelineStore((s) => s.coach?.spoken_summary);
  const spoken = useRef<string | null>(null);

  useEffect(() => {
    if (!voiceOn) {
      stopSpeaking();
      spoken.current = null;
      return;
    }
    if (summary && spoken.current !== summary) {
      spoken.current = summary;
      void speak(summary);
    }
  }, [voiceOn, summary]);

  useEffect(() => () => stopSpeaking(), []);
}
