import { useCallback, useEffect, useRef, useState } from 'react';
import { showToast } from '../../../ui/toast';

/**
 * 「🎤 話して入力」(GAS版 startVoiceInput)。ブラウザの音声認識(Web Speech API)で日本語を聞き取り、
 * 言い終わった文を onTranscript に渡す。押すたびに聞き始める/止める。
 * 短い間があっても止まらないよう continuous にしている(GAS版と同じ)。
 */

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** 聞き取りの失敗の知らせ方(マイクが許可されていない・つながらない以外は、言わなかった/止めたは知らせない) */
export function voiceInputErrorMessage(error: string): string | null {
  if (error === 'not-allowed') return 'マイクの使用が許可されていません。ブラウザの設定で許可してください。';
  if (error === 'network') return '音声認識サーバーへの接続に失敗しました。';
  if (error === 'no-speech' || error === 'aborted') return null;
  return `音声入力エラー: ${error}`;
}

/**
 * @param active ダイアログが開いているか。閉じたら聞くのをやめる(聞き取り途中の文も捨てる)
 * @param sessionKey 開き直すたびに変わる値(日報ダイアログの nonce)。変わったら聞くのをやめる
 *   (前に開いたお客様の聞き取りが、次のお客様のメモに入らないように)
 */
export function useVoiceInput(
  onTranscript: (text: string) => void,
  active = true,
  sessionKey: unknown = null,
) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  });

  /** すぐにやめる。まだ届いていない聞き取りの結果は捨てる */
  const cancel = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognitionRef.current = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.abort();
    } catch (e) {
      console.error(e);
    }
    setListening(false);
  }, []);

  const toggle = useCallback(() => {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) {
      showToast('このブラウザはWeb Speech APIによる音声入力に対応していません。', true);
      return;
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    const recognition = new Ctor();
    recognition.lang = 'ja-JP';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = true;
    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result?.isFinal) transcript += result[0].transcript;
      }
      if (transcript) onTranscriptRef.current(transcript);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognition.onerror = (event) => {
      console.error(event.error);
      const message = voiceInputErrorMessage(event.error);
      if (message) showToast(message, true);
      // このあと onend が来て表示が戻る
    };
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, []);

  // ダイアログを閉じた・開き直した・画面を離れたら聞くのをやめる
  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionKey は開き直したきっかけとしてだけ使う
  useEffect(() => cancel, [active, sessionKey, cancel]);

  return { listening, toggle, cancel };
}
