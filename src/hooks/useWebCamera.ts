import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

export type CameraStatus = 'idle' | 'initializing' | 'ready' | 'error';

export type CameraErrorCode =
  | 'permission_denied'
  | 'device_not_found'
  | 'device_busy'
  | 'unsupported'
  | 'unknown';

export interface CameraError {
  readonly code: CameraErrorCode;
  readonly message: string;
}

export type CameraState =
  | {
      readonly status: Exclude<CameraStatus, 'error'>;
      readonly error: null;
    }
  | { readonly status: 'error'; readonly error: CameraError };

export interface UseWebCameraOptions {
  /** Kamera hanya menyala saat `true`; saat `false` semua track dilepas. */
  readonly enabled?: boolean;
}

export type UseWebCameraResult = CameraState & {
  readonly videoRef: RefObject<HTMLVideoElement | null>;
  /** Mengulang inisialisasi setelah error. */
  readonly retry: () => void;
};

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: 'user',
    frameRate: { ideal: 30, max: 30 },
    height: { ideal: 1080 },
    width: { ideal: 1920 },
  },
};

const CAMERA_ERRORS = {
  permission_denied: {
    code: 'permission_denied',
    message:
      'Akses ditolak. Izinkan akses kamera di pengaturan peramban atau sistem operasi Anda.',
  },
  device_not_found: {
    code: 'device_not_found',
    message: 'Tidak ada perangkat kamera fisik yang terdeteksi.',
  },
  device_busy: {
    code: 'device_busy',
    message:
      'Kamera sedang sibuk atau digunakan oleh aplikasi lain (misal: Zoom/Meet).',
  },
  unsupported: {
    code: 'unsupported',
    message: 'Terjadi kendala tidak dikenal saat mengakses kamera.',
  },
  unknown: {
    code: 'unknown',
    message: 'Terjadi kendala tidak dikenal saat mengakses kamera.',
  },
} as const satisfies Record<CameraErrorCode, CameraError>;

const IDLE_STATE: CameraState = { status: 'idle', error: null };
const INITIALIZING_STATE: CameraState = { status: 'initializing', error: null };
const READY_STATE: CameraState = { status: 'ready', error: null };

const normalizeError = (caught: unknown): { name: string; message: string } =>
  caught instanceof DOMException || caught instanceof Error
    ? { name: caught.name, message: caught.message }
    : { name: 'Error', message: String(caught) };

const classifyCameraError = (errorName: string): CameraError => {
  switch (errorName) {
    case 'NotAllowedError':
      return CAMERA_ERRORS.permission_denied;
    case 'NotFoundError':
      return CAMERA_ERRORS.device_not_found;
    case 'NotReadableError':
    case 'TrackStartError':
      return CAMERA_ERRORS.device_busy;
    default:
      return CAMERA_ERRORS.unknown;
  }
};

const releaseCamera = (
  stream: MediaStream | null,
  video: HTMLVideoElement | null,
): void => {
  stream?.getTracks().forEach((track) => track.stop());

  if (video) {
    video.srcObject = null;
  }
};

/**
 * Mengelola siklus hidup WebRTC: izin kamera, pemasangan stream ke `<video>`,
 * klasifikasi error perangkat keras, dan pelepasan track.
 *
 * Elemen `<video>` wajib memakai `autoPlay muted playsInline` agar Safari iOS
 * mau memutar stream tanpa interaksi tambahan.
 */
export function useWebCamera({
  enabled = true,
}: UseWebCameraOptions = {}): UseWebCameraResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CameraState>(INITIALIZING_STATE);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    // Effect berjalan setelah commit, jadi `<video>` sudah terpasang di DOM.
    const video = videoRef.current;
    let isActive = true;
    let stream: MediaStream | null = null;

    const fail = (error: CameraError): void => {
      if (isActive) {
        setState({ status: 'error', error });
      }
    };

    const start = async (): Promise<void> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        fail(CAMERA_ERRORS.unsupported);
        return;
      }

      if (!video) {
        fail(CAMERA_ERRORS.unknown);
        return;
      }

      try {
        const acquired = await navigator.mediaDevices.getUserMedia(
          CAMERA_CONSTRAINTS,
        );

        // Sesi ini sudah dibatalkan saat izin kamera masih menunggu.
        if (!isActive) {
          releaseCamera(acquired, null);
          return;
        }

        stream = acquired;
        video.srcObject = acquired;
        await video.play();

        if (isActive) {
          setState(READY_STATE);
        }
      } catch (caught) {
        if (!isActive) {
          return;
        }

        const { name, message } = normalizeError(caught);
        console.error('Detail Error Kamera:', name, message);

        releaseCamera(stream, video);
        stream = null;
        fail(classifyCameraError(name));
      }
    };

    void start();

    return () => {
      isActive = false;
      releaseCamera(stream, video);
      // Sesi berikutnya (retry/retake) selalu dimulai dari "initializing", bukan state basi.
      setState(INITIALIZING_STATE);
    };
  }, [enabled, attempt]);

  const retry = useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);

  const visibleState = enabled ? state : IDLE_STATE;

  return { ...visibleState, videoRef, retry };
}
