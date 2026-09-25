import { useRef, useState } from 'react';

/**
 * ブラウザ標準のWeb Speech API(SpeechRecognition)の最小限の型定義。
 * lib.domには含まれておらず、ベンダープレフィックス(webkitSpeechRecognition)も必要なため
 * ここで宣言する。
 */
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly [index: number]: { readonly transcript: string };
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

/**
 * 音声入力(GAS版index.htmlのstartVoiceInput/resetMicBtnと同じ挙動)。
 * `ja-JP`・`continuous: true`(短い間でも止まらない)で、確定した(isFinalな)発話区間だけを
 * `onTranscript`へ渡す。呼び出し側はテキストエリアへの追記方法(改行区切りで末尾に足す等)を
 * 自由に決められる。同じ認識中に再度呼ぶと停止する、というトグル動作もGAS版と同じ。
 */
export function useVoiceInput(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const toggle = () => {
    setError(null);

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setError('このブラウザはWeb Speech APIによる音声入力に対応していません。');
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'ja-JP';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = true;

    recognition.onresult = (event) => {
      let newTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result?.isFinal && result[0]) newTranscript += result[0].transcript;
      }
      if (newTranscript) onTranscript(newTranscript);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed') {
        setError('マイクの使用が許可されていません。ブラウザの設定で許可してください。');
      } else if (event.error === 'network') {
        setError('音声認識サーバーへの接続に失敗しました。');
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setError(`音声入力エラー: ${event.error}`);
      }
      // UIのリセットはonendで行う(GAS版と同じ、onerror後に必ずonendが発火する前提)。
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  };

  return { listening, error, toggle };
}
