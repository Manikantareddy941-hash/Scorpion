import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Start Dictation, via the browser's Web Speech API.
 *
 * Entirely client-side: the transcript is placed in the input box and the user
 * still has to press Enter, so dictation cannot run a command on its own. That
 * matters here — a mis-heard word should never become an executed verb, and the
 * allowlist would reject it anyway rather than doing something approximate.
 *
 * The API is prefixed in Chromium and absent in Firefox, so `supported` is part
 * of the contract rather than something callers have to sniff for themselves.
 */

interface SpeechRecognitionAlternative { transcript: string }
interface SpeechRecognitionResult { 0: SpeechRecognitionAlternative; isFinal: boolean; length: number }
interface SpeechRecognitionResultList { length: number; [index: number]: SpeechRecognitionResult }
interface SpeechRecognitionEventLike { resultIndex: number; results: SpeechRecognitionResultList }

interface SpeechRecognitionLike {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start: () => void;
    stop: () => void;
    onresult: ((e: SpeechRecognitionEventLike) => void) | null;
    onerror: (() => void) | null;
    onend: (() => void) | null;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): RecognitionCtor | undefined {
    const w = window as unknown as {
        SpeechRecognition?: RecognitionCtor;
        webkitSpeechRecognition?: RecognitionCtor;
    };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function useDictation(onTranscript: (text: string) => void) {
    const [listening, setListening] = useState(false);
    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
    /** Kept in a ref so restarting recognition does not need a new callback identity. */
    const handlerRef = useRef(onTranscript);
    handlerRef.current = onTranscript;

    const supported = typeof window !== 'undefined' && getRecognitionCtor() !== undefined;

    const stop = useCallback(() => {
        recognitionRef.current?.stop();
        recognitionRef.current = null;
        setListening(false);
    }, []);

    const start = useCallback(() => {
        const Ctor = getRecognitionCtor();
        if (!Ctor) return;

        const recognition = new Ctor();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = navigator.language || 'en-US';

        recognition.onresult = (event) => {
            let text = '';
            for (let i = event.resultIndex; i < event.results.length; i += 1) {
                const result = event.results[i];
                if (result.isFinal) text += result[0].transcript;
            }
            const trimmed = text.trim();
            if (trimmed) handlerRef.current(trimmed);
        };
        // Both paths land in the same place: the mic indicator must not stay lit
        // after recognition has actually stopped.
        recognition.onerror = () => setListening(false);
        recognition.onend = () => setListening(false);

        recognitionRef.current = recognition;
        recognition.start();
        setListening(true);
    }, []);

    const toggle = useCallback(() => {
        if (listening) stop();
        else start();
    }, [listening, start, stop]);

    // Unmounting a pane while the mic is live would otherwise leave recognition
    // running with nowhere to deliver its transcript.
    useEffect(() => () => { recognitionRef.current?.stop(); }, []);

    return { supported, listening, toggle, start, stop };
}
