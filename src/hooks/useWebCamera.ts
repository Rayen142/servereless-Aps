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
  /** Kamera hanya menyala saat `true`; saat `false` stream dilepas. */
  readonly enabled?: boolean;
}

export type UseWebCameraResult = CameraState & {
  readonly videoRef: RefObject<HTMLVideoElement | null>;
  /** Mengulang inisialisasi setelah error. */
  readonly retry: () => void;
};

/**
 * Urutan constraint dari ideal ke paling longgar. Beberapa webcam Windows menolak
 * resolusi tinggi (OverconstrainedError / NotReadableError), jadi kita turunkan bertahap.
 */
const CONSTRAINT_CANDIDATES: readonly MediaStreamConstraints[] = [
  {
    audio: false,
    video: {
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  },
  { audio: false, video: { facingMode: 'user' } },
  { audio: false, video: true },
];

const CAMERA_ERRORS = {
  permission_denied: {
    code: 'permission_denied',
    message:
      'Akses kamera ditolak. Klik ikon kamera/gembok di address bar lalu pilih "Izinkan".',
  },
  device_not_found: {
    code: 'device_not_found',
    message: 'Tidak ada kamera yang terdeteksi di perangkat ini.',
  },
  device_busy: {
    code: 'device_busy',
    message:
      'Kamera sedang dipakai aplikasi/tab lain (Zoom, Meet, tab lain). Tutup aplikasi tersebut lalu coba lagi.',
  },
  unsupported: {
    code: 'unsupported',
    message:
      'Browser tidak mendukung akses kamera. Buka lewat http://localhost:5173 di Chrome/Edge terbaru.',
  },
  unknown: {
    code: 'unknown',
    message: 'Kamera gagal dibuka. Coba muat ulang halaman.',
  },
} as const satisfies Record<CameraErrorCode, CameraError>;

const classifyCameraError = (errorName: string): CameraError => {
  switch (errorName) {
    case 'NotAllowedError':
    case 'SecurityError':
      return CAMERA_ERRORS.permission_denied;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return CAMERA_ERRORS.device_not_found;
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return CAMERA_ERRORS.device_busy;
    default:
      return CAMERA_ERRORS.unknown;
  }
};

const errorName = (caught: unknown): string =>
  caught instanceof DOMException || caught instanceof Error
    ? caught.name
    : 'Error';

/* -------------------------------------------------------------------------- */
/* Shared stream manager                                                       */
/* -------------------------------------------------------------------------- */
/*
 * Satu MediaStream dipakai bersama oleh semua komponen. Pelepasan ditunda sebentar
 * sehingga mount -> unmount -> mount (React StrictMode atau pindah halaman) tidak
 * mematikan lalu menyalakan ulang webcam. Pola matikan-nyalakan yang terlalu cepat
 * inilah yang memicu "NotReadableError: Could not start video source" di Windows.
 */
const RELEASE_DELAY_MS = 800;
const BUSY_RETRY_DELAYS_MS = [300, 900];

let sharedStream: MediaStream | null = null;
let pendingStream: Promise<MediaStream> | null = null;
let subscribers = 0;
let releaseTimer: number | null = null;

const wait = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const isStreamLive = (stream: MediaStream | null): stream is MediaStream =>
  stream !== null &&
  stream.getVideoTracks().some((track) => track.readyState === 'live');

const openStream = async (): Promise<MediaStream> => {
  let lastError: unknown = null;

  for (const constraints of CONSTRAINT_CANDIDATES) {
    for (let attempt = 0; attempt <= BUSY_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (caught) {
        lastError = caught;
        const name = errorName(caught);
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          throw caught;
        }
        if (name === 'NotReadableError' || name === 'AbortError') {
          const delay = BUSY_RETRY_DELAYS_MS[attempt];
          if (delay !== undefined) {
            await wait(delay);
            continue;
          }
        }
        break;
      }
    }
  }

  throw lastError ?? new Error('Camera unavailable');
};

const acquireSharedStream = async (): Promise<MediaStream> => {
  subscribers += 1;
  if (releaseTimer !== null) {
    window.clearTimeout(releaseTimer);
    releaseTimer = null;
  }

  if (isStreamLive(sharedStream)) {
    return sharedStream;
  }

  if (!pendingStream) {
    pendingStream = openStream()
      .then((stream) => {
        sharedStream = stream;
        return stream;
      })
      .finally(() => {
        pendingStream = null;
      });
  }

  return pendingStream;
};

const releaseSharedStream = (): void => {
  subscribers = Math.max(0, subscribers - 1);
  if (subscribers > 0 || releaseTimer !== null) {
    return;
  }

  releaseTimer = window.setTimeout(() => {
    releaseTimer = null;
    if (subscribers === 0 && sharedStream) {
      sharedStream.getTracks().forEach((track) => track.stop());
      sharedStream = null;
    }
  }, RELEASE_DELAY_MS);
};

const forceResetSharedStream = (): void => {
  sharedStream?.getTracks().forEach((track) => track.stop());
  sharedStream = null;
};

/* -------------------------------------------------------------------------- */

const INITIALIZING_STATE: CameraState = { status: 'initializing', error: null };
const READY_STATE: CameraState = { status: 'ready', error: null };
const IDLE_STATE: CameraState = { status: 'idle', error: null };

/**
 * Mengelola kamera: izin, pemasangan stream ke `<video>`, klasifikasi error.
 * Elemen `<video>` wajib memakai `autoPlay muted playsInline`.
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

    let isActive = true;
    setState(INITIALIZING_STATE);

    const start = async (): Promise<void> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState({ status: 'error', error: CAMERA_ERRORS.unsupported });
        return;
      }

      try {
        const stream = await acquireSharedStream();
        if (!isActive) {
          return;
        }

        const video = videoRef.current;
        if (!video) {
          setState({ status: 'error', error: CAMERA_ERRORS.unknown });
          return;
        }

        if (video.srcObject !== stream) {
          video.srcObject = stream;
        }

        try {
          await video.play();
        } catch (playError) {
          // "play() interrupted by a new load request" tidak fatal; tunggu frame berikutnya.
          if (errorName(playError) !== 'AbortError') {
            throw playError;
          }
        }

        if (isActive) {
          setState(READY_STATE);
        }
      } catch (caught) {
        if (!isActive) {
          return;
        }
        console.error('Detail Error Kamera:', errorName(caught), caught);
        setState({
          status: 'error',
          error: classifyCameraError(errorName(caught)),
        });
      }
    };

    void start();

    return () => {
      isActive = false;
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.srcObject = null;
      }
      releaseSharedStream();
    };
  }, [enabled, attempt]);

  const retry = useCallback(() => {
    forceResetSharedStream();
    setAttempt((count) => count + 1);
  }, []);

  const visibleState = enabled ? state : IDLE_STATE;
  return { ...visibleState, videoRef, retry };
}
