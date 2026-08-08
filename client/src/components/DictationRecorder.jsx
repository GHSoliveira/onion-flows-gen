import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { transcribeDictation } from '../services/dictation';

const MAX_RECORDING_SECONDS = 120;
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/webm',
  'audio/mp4',
];

const formatSeconds = (value) => {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const stopStream = (stream) => {
  stream?.getTracks?.().forEach((track) => track.stop());
};

const DictationRecorder = ({ chatId, disabled = false, onTranscribed }) => {
  const [status, setStatus] = useState('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const canceledRef = useRef(false);
  const intervalRef = useRef(null);
  const stopTimerRef = useRef(null);
  const requestControllerRef = useRef(null);
  const mountedRef = useRef(true);
  const disabledRef = useRef(disabled);

  const clearTimers = () => {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
    intervalRef.current = null;
    stopTimerRef.current = null;
  };

  const releaseRecorder = () => {
    clearTimers();
    stopStream(streamRef.current);
    streamRef.current = null;
    recorderRef.current = null;
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      canceledRef.current = true;
      requestControllerRef.current?.abort();
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder?.state === 'recording') {
        try { recorder.stop(); } catch {}
      }
      releaseRecorder();
    };
  }, []);

  useEffect(() => {
    disabledRef.current = disabled;
    if (!disabled) return;
    requestControllerRef.current?.abort();
    if (recorderRef.current?.state === 'recording') {
      canceledRef.current = true;
      chunksRef.current = [];
      try { recorderRef.current.stop(); } catch {}
      setStatus('idle');
      setElapsedSeconds(0);
    }
  }, [disabled]);

  const finishRecording = () => {
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') recorder.stop();
  };

  const cancelRecording = () => {
    if (status !== 'recording') return;
    canceledRef.current = true;
    chunksRef.current = [];
    finishRecording();
    setStatus('idle');
    setElapsedSeconds(0);
  };

  const transcribeRecording = async (blob, durationSeconds) => {
    if (!mountedRef.current || canceledRef.current) return;
    setStatus('transcribing');
    const controller = new AbortController();
    requestControllerRef.current = controller;
    try {
      const result = await transcribeDictation({
        chatId,
        audioBlob: blob,
        durationSeconds,
        signal: controller.signal,
      });
      if (!mountedRef.current || controller.signal.aborted) return;
      const text = String(result?.text || '').trim();
      if (!text) {
        toast.error('Não identifiquei fala nessa gravação.');
      } else {
        onTranscribed?.(text);
        toast.success('Ditado inserido no rascunho. Confira antes de enviar.');
      }
    } catch (error) {
      if (error?.name !== 'AbortError' && mountedRef.current) {
        toast.error(error?.message || 'Falha ao transcrever a gravação.');
      }
    } finally {
      if (mountedRef.current) {
        setStatus('idle');
        setElapsedSeconds(0);
      }
      requestControllerRef.current = null;
    }
  };

  const startRecording = async () => {
    if (disabled || status !== 'idle') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error('Este navegador não oferece gravação local de áudio.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!mountedRef.current || disabledRef.current) {
        stopStream(stream);
        return;
      }
      const mimeType = MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported?.(candidate)) || '';
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 32_000,
      });
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      canceledRef.current = false;
      startedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (!canceledRef.current && event.data?.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        canceledRef.current = true;
        chunksRef.current = [];
        releaseRecorder();
        if (mountedRef.current) {
          setStatus('idle');
          toast.error('A gravação foi interrompida pelo navegador.');
        }
      };
      recorder.onstop = () => {
        const durationSeconds = Math.max(1, (Date.now() - startedAtRef.current) / 1000);
        const parts = canceledRef.current ? [] : chunksRef.current;
        const recordedMime = recorder.mimeType || mimeType || 'audio/webm';
        chunksRef.current = [];
        releaseRecorder();
        if (canceledRef.current || !parts.length || !mountedRef.current) return;
        const blob = new Blob(parts, { type: recordedMime });
        if (blob.size < 256) {
          setStatus('idle');
          toast.error('A gravação ficou curta demais.');
          return;
        }
        void transcribeRecording(blob, durationSeconds);
      };

      recorder.start(250);
      setElapsedSeconds(0);
      setStatus('recording');
      intervalRef.current = window.setInterval(() => {
        const elapsed = Math.min(MAX_RECORDING_SECONDS, (Date.now() - startedAtRef.current) / 1000);
        if (mountedRef.current) setElapsedSeconds(elapsed);
      }, 250);
      stopTimerRef.current = window.setTimeout(finishRecording, MAX_RECORDING_SECONDS * 1000);
    } catch (error) {
      releaseRecorder();
      const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
      toast.error(denied
        ? 'Permita o acesso ao microfone para usar o ditado.'
        : 'Não foi possível iniciar o microfone.');
    }
  };

  if (status === 'recording') {
    return (
      <div className="flex h-9 shrink-0 items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-1.5 text-red-600 shadow-sm dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
        <button type="button" onClick={finishRecording} title="Parar e transcrever" aria-label="Parar e transcrever" className="flex h-7 items-center gap-1.5 rounded-lg px-1.5 text-[11px] font-bold hover:bg-red-100 dark:hover:bg-red-900/30">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          {formatSeconds(elapsedSeconds)}
          <Square size={10} fill="currentColor" />
        </button>
        <button type="button" onClick={cancelRecording} title="Cancelar gravação" aria-label="Cancelar gravação" className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30"><X size={13} /></button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startRecording}
      disabled={disabled || status === 'transcribing'}
      title={status === 'transcribing' ? 'Transformando áudio em texto…' : 'Ditar mensagem'}
      aria-label={status === 'transcribing' ? 'Transcrevendo ditado' : 'Ditar mensagem'}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
    >
      {status === 'transcribing' ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} />}
    </button>
  );
};

export default DictationRecorder;
