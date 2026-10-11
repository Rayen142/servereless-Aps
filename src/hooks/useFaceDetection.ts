import {
  useEffect,
  useEffectEvent,
  useReducer,
  type RefObject,
} from 'react';
import {
  FACE_ASSESSMENT,
  validateFaces,
  type FaceAssessment,
  type FaceStatus,
} from '../lib/faceValidation';
import { isVideoFrameReady } from '../lib/video';
import { useBlazeFaceModel, type ModelStatus } from './useBlazeFaceModel';

export type DetectorStatus = ModelStatus;

export interface UseFaceDetectionOptions {
  readonly videoRef: RefObject<HTMLVideoElement | null>;
  /** Loop deteksi hanya berjalan saat `true` (kamera siap dan belum ada tangkapan). */
  readonly enabled: boolean;
  /** Dipanggil saat wajah valid bertahan selama durasi auto-capture penuh. */
  readonly onHoldComplete: () => void;
}

export interface FaceDetectionResult {
  readonly detectorStatus: DetectorStatus;
  readonly faceStatus: FaceStatus;
  /** Pesan panduan dinamis untuk pengguna. */
  readonly guidance: string;
  /** Progres timer auto-capture, 0 sampai 1. */
  readonly holdProgress: number;
}

const DETECTION_INTERVAL_MS = 100;
const AUTO_CAPTURE_HOLD_MS = 1500;

interface AnalysisState {
  readonly faceStatus: FaceStatus;
  readonly guidance: string;
  readonly holdProgress: number;
  readonly hasScanFailed: boolean;
}

type AnalysisAction =
  | { readonly type: 'reset' }
  | {
      readonly type: 'frame_assessed';
      readonly assessment: FaceAssessment;
      readonly holdProgress: number;
    }
  | { readonly type: 'scan_failed' };

const INITIAL_ANALYSIS: AnalysisState = {
  faceStatus: FACE_ASSESSMENT.noFace.status,
  guidance: FACE_ASSESSMENT.noFace.message,
  holdProgress: 0,
  hasScanFailed: false,
};

const IDLE_RESULT: FaceDetectionResult = {
  detectorStatus: 'idle',
  faceStatus: INITIAL_ANALYSIS.faceStatus,
  guidance: INITIAL_ANALYSIS.guidance,
  holdProgress: 0,
};

const UNAVAILABLE_RESULT: FaceDetectionResult = {
  detectorStatus: 'error',
  faceStatus: FACE_ASSESSMENT.detectorUnavailable.status,
  guidance: FACE_ASSESSMENT.detectorUnavailable.message,
  holdProgress: 0,
};

const analysisReducer = (
  state: AnalysisState,
  action: AnalysisAction,
): AnalysisState => {
  switch (action.type) {
    case 'reset':
      return INITIAL_ANALYSIS;

    case 'scan_failed':
      return { ...INITIAL_ANALYSIS, hasScanFailed: true };

    case 'frame_assessed': {
      const { assessment } = action;
      // Progres hanya bermakna untuk posisi valid; selain itu paksa kembali ke 0.
      const holdProgress =
        assessment.status === 'valid' ? action.holdProgress : 0;

      if (
        state.faceStatus === assessment.status &&
        state.guidance === assessment.message &&
        state.holdProgress === holdProgress
      ) {
        return state;
      }

      return {
        faceStatus: assessment.status,
        guidance: assessment.message,
        holdProgress,
        hasScanFailed: false,
      };
    }
  }
};

/** Timer tahan-posisi: berhenti dan kembali ke 0 pada frame pertama yang tidak valid. */
const createHoldTimer = (durationMs: number) => {
  let startedAt: number | null = null;

  return {
    update(isHolding: boolean, now: number): number {
      if (!isHolding) {
        startedAt = null;
        return 0;
      }

      startedAt ??= now;
      const progress = (now - startedAt) / durationMs;

      if (!Number.isFinite(progress)) {
        startedAt = null;
        return 0;
      }

      return Math.min(1, Math.max(0, progress));
    },
    reset(): void {
      startedAt = null;
    },
  };
};

/**
 * Menjalankan prediksi BlazeFace pada frame video, memvalidasi posisi wajah
 * terhadap kotak panduan, dan mengelola timer auto-capture.
 *
 * Seluruh loop `requestAnimationFrame` hidup di dalam satu effect, sehingga
 * cleanup-nya selalu membatalkan frame yang sedang terjadwal.
 */
export function useFaceDetection({
  videoRef,
  enabled,
  onHoldComplete,
}: UseFaceDetectionOptions): FaceDetectionResult {
  const model = useBlazeFaceModel(enabled);
  const [analysis, dispatch] = useReducer(analysisReducer, INITIAL_ANALYSIS);
  const notifyHoldComplete = useEffectEvent(onHoldComplete);
  const faceModel = model.model;

  useEffect(() => {
    if (!enabled || faceModel === null) {
      return undefined;
    }

    let isActive = true;
    let isAnalyzing = false;
    let frameId: number | null = null;
    let lastAnalysisAt = Number.NEGATIVE_INFINITY;
    const holdTimer = createHoldTimer(AUTO_CAPTURE_HOLD_MS);

    const stop = (): void => {
      isActive = false;

      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
    };

    const analyzeFrame = async (): Promise<void> => {
      const video = videoRef.current;
      if (!isVideoFrameReady(video)) {
        holdTimer.reset();
        return;
      }

      const faces = await faceModel.estimateFaces(video, false, false, true);

      // Stream bisa saja sudah dilepas selama model berjalan.
      const currentVideo = videoRef.current;
      if (!isActive) {
        return;
      }
      if (!isVideoFrameReady(currentVideo)) {
        holdTimer.reset();
        return;
      }

      const assessment = validateFaces(faces, {
        width: currentVideo.videoWidth,
        height: currentVideo.videoHeight,
      });
      const holdProgress = holdTimer.update(
        assessment.status === 'valid',
        performance.now(),
      );
      dispatch({ type: 'frame_assessed', assessment, holdProgress });

      if (holdProgress >= 1) {
        // Jika penangkapan gagal, timer harus terisi penuh lagi sebelum mencoba ulang.
        holdTimer.reset();
        notifyHoldComplete();
      }
    };

    const handleFailure = (error: unknown): void => {
      // Error saat teardown (misalnya model sudah di-dispose) bukan kegagalan deteksi.
      if (!isActive) {
        return;
      }

      console.error(error);
      stop();
      dispatch({ type: 'scan_failed' });
    };

    const tick = (timestamp: number): void => {
      if (!isActive) {
        return;
      }

      frameId = requestAnimationFrame(tick);

      if (
        isAnalyzing ||
        timestamp - lastAnalysisAt < DETECTION_INTERVAL_MS
      ) {
        return;
      }

      lastAnalysisAt = timestamp;
      isAnalyzing = true;
      void analyzeFrame()
        .catch(handleFailure)
        .finally(() => {
          isAnalyzing = false;
        });
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      stop();
      dispatch({ type: 'reset' });
    };
  }, [enabled, faceModel, videoRef]);

  if (!enabled) {
    return IDLE_RESULT;
  }

  if (model.status === 'error' || analysis.hasScanFailed) {
    return UNAVAILABLE_RESULT;
  }

  return {
    detectorStatus: model.status,
    faceStatus: analysis.faceStatus,
    guidance: analysis.guidance,
    holdProgress: analysis.holdProgress,
  };
}
