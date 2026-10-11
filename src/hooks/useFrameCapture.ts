import { useCallback, useEffect, useRef, useState } from 'react';
import { captureVideoFrame } from '../lib/video';

const JPEG_QUALITY = 0.92;
const FLASH_DURATION_MS = 420;

export interface UseFrameCaptureResult {
  /** Data URL JPEG hasil tangkapan; `null` selama mode kamera langsung. */
  readonly image: string | null;
  readonly isFlashing: boolean;
  /** Mengembalikan data URL frame jika berhasil ditangkap, `null` jika gagal. */
  readonly capture: (video: HTMLVideoElement | null) => string | null;
  /** Membuang tangkapan untuk kembali ke kamera langsung. */
  readonly discard: () => void;
}

export function useFrameCapture(): UseFrameCaptureResult {
  const [image, setImage] = useState<string | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);
  const flashTimerRef = useRef<number | null>(null);

  const clearFlashTimer = useCallback(() => {
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
  }, []);

  const capture = useCallback(
    (video: HTMLVideoElement | null): string | null => {
      const frame = captureVideoFrame(video, JPEG_QUALITY);
      if (frame === null) {
        return null;
      }

      clearFlashTimer();
      setImage(frame);
      setIsFlashing(true);
      flashTimerRef.current = window.setTimeout(() => {
        flashTimerRef.current = null;
        setIsFlashing(false);
      }, FLASH_DURATION_MS);

      return frame;
    },
    [clearFlashTimer],
  );

  const discard = useCallback(() => {
    clearFlashTimer();
    setImage(null);
    setIsFlashing(false);
  }, [clearFlashTimer]);

  useEffect(() => clearFlashTimer, [clearFlashTimer]);

  return { image, isFlashing, capture, discard };
}
