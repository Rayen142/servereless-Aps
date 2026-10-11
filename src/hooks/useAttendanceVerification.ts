import { useCallback, useEffect, useRef, useState } from 'react';

export interface VerificationFeedback {
  readonly type: 'success' | 'error';
  readonly message: string;
}

export interface UseAttendanceVerificationResult {
  readonly isSubmitting: boolean;
  readonly feedback: VerificationFeedback | null;
  readonly submit: (image: string) => Promise<void>;
  /** Membatalkan permintaan yang berjalan dan menghapus umpan balik. */
  readonly reset: () => void;
}

interface VerifyResponse {
  readonly success: boolean;
  readonly message?: string;
}

const MESSAGES = {
  notConfigured: 'Endpoint verifikasi belum dikonfigurasi.',
  recorded: 'Absensi berhasil dicatat.',
  notRecognized: 'Wajah tidak dikenali.',
  unreachable: 'Tidak dapat terhubung ke layanan verifikasi.',
} as const;

const parseVerifyResponse = (body: unknown): VerifyResponse => {
  if (typeof body !== 'object' || body === null) {
    return { success: false };
  }

  const { success, message } = body as {
    success?: unknown;
    message?: unknown;
  };

  return {
    success: success === true,
    message: typeof message === 'string' ? message : undefined,
  };
};

export function useAttendanceVerification(): UseAttendanceVerificationResult {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<VerificationFeedback | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);

  const abortInFlight = useCallback(() => {
    inFlightRef.current?.abort();
    inFlightRef.current = null;
  }, []);

  const submit = useCallback(
    async (image: string): Promise<void> => {
      if (inFlightRef.current) {
        return;
      }

      const apiUrl = import.meta.env.VITE_API_URL;
      if (!apiUrl) {
        setFeedback({ type: 'error', message: MESSAGES.notConfigured });
        return;
      }

      const controller = new AbortController();
      inFlightRef.current = controller;
      const isCurrent = (): boolean => inFlightRef.current === controller;

      setIsSubmitting(true);
      setFeedback(null);

      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image }),
          signal: controller.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        const payload = parseVerifyResponse(body);

        if (!isCurrent()) {
          return;
        }

        setFeedback(
          response.ok && payload.success
            ? {
                type: 'success',
                message: payload.message ?? MESSAGES.recorded,
              }
            : {
                type: 'error',
                message: payload.message ?? MESSAGES.notRecognized,
              },
        );
      } catch {
        if (isCurrent()) {
          setFeedback({ type: 'error', message: MESSAGES.unreachable });
        }
      } finally {
        // Permintaan yang sudah dibatalkan tidak boleh menyentuh state permintaan baru.
        if (isCurrent()) {
          inFlightRef.current = null;
          setIsSubmitting(false);
        }
      }
    },
    [],
  );

  const reset = useCallback(() => {
    abortInFlight();
    setIsSubmitting(false);
    setFeedback(null);
  }, [abortInFlight]);

  useEffect(() => abortInFlight, [abortInFlight]);

  return { isSubmitting, feedback, submit, reset };
}
