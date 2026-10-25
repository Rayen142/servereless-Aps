import {
  useEffect,
  useEffectEvent,
  useReducer,
  type RefObject,
} from 'react';
import {
  analyzeMicroMovement,
  createLandmarkSample,
  FACE_ASSESSMENT,
  MICRO_MOVEMENT_GUIDANCE,
  validateFaces,
  type FaceAssessment,
  type FaceStatus,
  type FaceTrackingBox,
  type LandmarkSample,
  type LivenessStatus,
  type MicroMovementVerdict,
} from '../lib/faceValidation';
import { isVideoFrameReady } from '../lib/video';
import { useBlazeFaceModel, type ModelStatus } from './useBlazeFaceModel';

export type DetectorStatus = ModelStatus;

export interface UseFaceDetectionOptions {
  readonly videoRef: RefObject<HTMLVideoElement | null>;
  /** Loop deteksi hanya berjalan saat `true` (kamera siap dan belum ada tangkapan). */
  readonly enabled: boolean;
  /** Dipanggil saat wajah valid + liveness terverifikasi bertahan selama durasi auto-capture penuh. */
  readonly onHoldComplete: () => void;
}

export interface FaceDetectionResult {
  readonly detectorStatus: DetectorStatus;
  readonly faceStatus: FaceStatus;
  /** Pesan panduan dinamis untuk pengguna. */
  readonly guidance: string;
  /** Progres timer auto-capture, 0 sampai 1. */
  readonly holdProgress: number;
  /** Koordinat kotak tracking wajah dan titik landmark dalam persentase (0..100). */
  readonly trackingBox: FaceTrackingBox | null;
  /** Status Liveness Detection (Anti-Spoofing). */
  readonly livenessStatus: LivenessStatus;
  /** Skor keaslian wajah hidup (0..100). */
  readonly livenessScore: number;
}

const DETECTION_INTERVAL_MS = 100;
const AUTO_CAPTURE_HOLD_MS = 1500;
const PATCH_SIZE = 32;
/** Jendela geser sampel landmark micro-movement (±2 dtk pada ~10 fps). */
const MICRO_SAMPLE_WINDOW_MS = 2000;
const MICRO_SAMPLE_MAX = 30;
/** Riwayat proporsi bawah wajah untuk indikator masker. */
const LOWER_FACE_HISTORY_MAX = 10;

interface AnalysisState {
  readonly faceStatus: FaceStatus;
  readonly guidance: string;
  readonly holdProgress: number;
  readonly trackingBox: FaceTrackingBox | null;
  readonly livenessStatus: LivenessStatus;
  readonly livenessScore: number;
  readonly hasScanFailed: boolean;
}

type AnalysisAction =
  | { readonly type: 'reset' }
  | {
      readonly type: 'frame_assessed';
      readonly assessment: FaceAssessment;
      readonly holdProgress: number;
      readonly livenessStatus: LivenessStatus;
      readonly livenessScore: number;
      /** Pesan panduan prioritas (mis. hasil analisis micro-movement). */
      readonly guidanceOverride?: string;
    }
  | { readonly type: 'scan_failed' };

const INITIAL_ANALYSIS: AnalysisState = {
  faceStatus: FACE_ASSESSMENT.noFace.status,
  guidance: FACE_ASSESSMENT.noFace.message,
  holdProgress: 0,
  trackingBox: null,
  livenessStatus: 'idle',
  livenessScore: 0,
  hasScanFailed: false,
};

const IDLE_RESULT: FaceDetectionResult = {
  detectorStatus: 'idle',
  faceStatus: INITIAL_ANALYSIS.faceStatus,
  guidance: INITIAL_ANALYSIS.guidance,
  holdProgress: 0,
  trackingBox: null,
  livenessStatus: 'idle',
  livenessScore: 0,
};

const UNAVAILABLE_RESULT: FaceDetectionResult = {
  detectorStatus: 'error',
  faceStatus: FACE_ASSESSMENT.detectorUnavailable.status,
  guidance: FACE_ASSESSMENT.detectorUnavailable.message,
  holdProgress: 0,
  trackingBox: null,
  livenessStatus: 'idle',
  livenessScore: 0,
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
      const { assessment, livenessStatus, livenessScore } = action;
      const holdProgress =
        assessment.status === 'valid' ? action.holdProgress : 0;

      const guidance =
        action.guidanceOverride ??
        (assessment.status === 'valid' && livenessStatus === 'spoof_warning'
          ? 'Gerakkan kepala sedikit untuk verifikasi keaslian wajah'
          : assessment.message);

      if (
        state.faceStatus === assessment.status &&
        state.guidance === guidance &&
        state.holdProgress === holdProgress &&
        state.trackingBox === assessment.trackingBox &&
        state.livenessStatus === livenessStatus &&
        state.livenessScore === livenessScore
      ) {
        return state;
      }

      return {
        faceStatus: assessment.status,
        guidance,
        holdProgress,
        trackingBox: assessment.trackingBox,
        livenessStatus,
        livenessScore,
        hasScanFailed: false,
      };
    }
  }
};

/**
 * Menganalisis keaslian wajah hidup (Anti-Spoofing / Liveness Detection)
 * melalui perubahan mikro-geometri landmark 3D dan dinamika tekstur piksel antar-frame.
 */
const createLivenessAnalyzer = () => {
  const canvas = document.createElement('canvas');
  canvas.width = PATCH_SIZE;
  canvas.height = PATCH_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  let prevLuma: Float32Array | null = null;
  const yawHistory: number[] = [];
  const pitchHistory: number[] = [];
  const temporalDiffs: number[] = [];
  let consecutiveFrozenFrames = 0;

  return {
    reset(): void {
      prevLuma = null;
      yawHistory.length = 0;
      pitchHistory.length = 0;
      temporalDiffs.length = 0;
      consecutiveFrozenFrames = 0;
    },
    evaluate(
      video: HTMLVideoElement,
      box: FaceTrackingBox | null,
    ): { readonly status: LivenessStatus; readonly score: number } {
      if (!box) {
        this.reset();
        return { status: 'idle', score: 0 };
      }

      yawHistory.push(box.geometry.noseYawRatio);
      pitchHistory.push(box.geometry.eyeMouthPitchRatio);
      if (yawHistory.length > 12) yawHistory.shift();
      if (pitchHistory.length > 12) pitchHistory.shift();

      let frameDiff = 1.2;
      let contrastScore = 18;

      if (ctx && video.videoWidth > 0 && video.videoHeight > 0) {
        const sx = Math.max(0, (box.leftPct / 100) * video.videoWidth);
        const sy = Math.max(0, (box.topPct / 100) * video.videoHeight);
        const sw = Math.max(16, (box.widthPct / 100) * video.videoWidth);
        const sh = Math.max(16, (box.heightPct / 100) * video.videoHeight);

        try {
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, PATCH_SIZE, PATCH_SIZE);
          const pixels = ctx.getImageData(0, 0, PATCH_SIZE, PATCH_SIZE).data;
          const currLuma = new Float32Array(PATCH_SIZE * PATCH_SIZE);

          let sum = 0;
          let sumSq = 0;
          let diffSum = 0;
          const total = PATCH_SIZE * PATCH_SIZE;

          for (let i = 0; i < total; i++) {
            const idx = i * 4;
            const luma =
              0.299 * pixels[idx]! +
              0.587 * pixels[idx + 1]! +
              0.114 * pixels[idx + 2]!;
            currLuma[i] = luma;
            sum += luma;
            sumSq += luma * luma;
            if (prevLuma) {
              diffSum += Math.abs(luma - prevLuma[i]!);
            }
          }

          const mean = sum / total;
          const variance = Math.max(0, sumSq / total - mean * mean);
          contrastScore = Math.sqrt(variance);
          if (prevLuma) {
            frameDiff = diffSum / total;
          }
          prevLuma = currLuma;
        } catch {
          // Abaikan jika canvas gagal membaca frame
        }
      }

      temporalDiffs.push(frameDiff);
      if (temporalDiffs.length > 10) temporalDiffs.shift();

      // Hitung variasi mikro-gerakan 3D landmark
      const calcRange = (arr: readonly number[]): number => {
        if (arr.length < 2) return 0;
        let min = arr[0]!;
        let max = arr[0]!;
        for (const v of arr) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
        return max - min;
      };

      const yawRange = calcRange(yawHistory);
      const pitchRange = calcRange(pitchHistory);
      const avgTemporalDiff =
        temporalDiffs.reduce((a, b) => a + b, 0) /
        Math.max(1, temporalDiffs.length);

      // Deteksi frame beku / gambar statis murni
      if (frameDiff < 0.04 && yawRange < 0.0005 && pitchRange < 0.0005) {
        consecutiveFrozenFrames += 1;
      } else {
        consecutiveFrozenFrames = 0;
      }

      if (consecutiveFrozenFrames >= 8) {
        return { status: 'spoof_warning', score: 38 };
      }

      if (yawHistory.length < 3) {
        return { status: 'checking', score: 72 };
      }

      // Kombinasikan skor tekstur alami, dinamika frame, dan mikro-geometri 3D
      const naturalTextureComponent =
        contrastScore >= 12 && contrastScore <= 85 ? 35 : 18;
      const temporalComponent = Math.min(
        35,
        Math.max(15, avgTemporalDiff * 18),
      );
      const microMotionComponent = Math.min(
        28,
        Math.max(14, (yawRange + pitchRange) * 950),
      );

      const rawScore = Math.min(
        99.4,
        naturalTextureComponent + temporalComponent + microMotionComponent,
      );
      const roundedScore = Math.round(rawScore * 10) / 10;

      return {
        status: roundedScore >= 75 ? 'verified' : 'checking',
        score: roundedScore,
      };
    },
  };
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
    const livenessAnalyzer = createLivenessAnalyzer();
    /** Sampel landmark mata & hidung, hanya direkam selama timer tahan berjalan. */
    const landmarkSamples: LandmarkSample[] = [];
    const lowerFaceHistory: number[] = [];
    /** Verdict micro-movement terakhir yang gagal; dipertahankan sebagai panduan. */
    let lastMicroFailure: Exclude<
      MicroMovementVerdict,
      'natural' | 'insufficient'
    > | null = null;

    const resetTracking = (): void => {
      holdTimer.reset();
      livenessAnalyzer.reset();
      landmarkSamples.length = 0;
      lowerFaceHistory.length = 0;
      lastMicroFailure = null;
    };

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
        resetTracking();
        return;
      }

      const faces = await faceModel.estimateFaces(video, false, false, true);

      const currentVideo = videoRef.current;
      if (!isActive) {
        return;
      }
      if (!isVideoFrameReady(currentVideo)) {
        resetTracking();
        return;
      }

      const frameSize = {
        width: currentVideo.videoWidth,
        height: currentVideo.videoHeight,
      };
      const assessment = validateFaces(faces, frameSize, { lowerFaceHistory });

      if (assessment.trackingBox) {
        lowerFaceHistory.push(assessment.trackingBox.geometry.lowerFaceRatio);
        if (lowerFaceHistory.length > LOWER_FACE_HISTORY_MAX) {
          lowerFaceHistory.shift();
        }
      } else {
        lowerFaceHistory.length = 0;
        lastMicroFailure = null;
      }

      const liveness = livenessAnalyzer.evaluate(
        currentVideo,
        assessment.trackingBox,
      );

      const isReadyForHold =
        assessment.status === 'valid' && liveness.status !== 'spoof_warning';

      const now = performance.now();
      let holdProgress = holdTimer.update(isReadyForHold, now);

      // Rekam koordinat landmark antar-frame hanya selama timer tahan berjalan.
      const sample =
        isReadyForHold && assessment.trackingBox
          ? createLandmarkSample(assessment.trackingBox, frameSize, now)
          : null;
      if (sample) {
        landmarkSamples.push(sample);
        while (
          landmarkSamples.length > MICRO_SAMPLE_MAX ||
          (landmarkSamples[0] !== undefined &&
            now - landmarkSamples[0].t > MICRO_SAMPLE_WINDOW_MS)
        ) {
          landmarkSamples.shift();
        }
      } else {
        landmarkSamples.length = 0;
      }

      let shouldCapture = false;
      if (holdProgress >= 1) {
        const micro = analyzeMicroMovement(landmarkSamples);

        if (micro.verdict === 'natural') {
          lastMicroFailure = null;
          shouldCapture = liveness.status === 'verified';
        } else if (micro.verdict !== 'insufficient') {
          // Objek statis / digerakkan seragam: ulangi jendela tahan 1,5 dtk baru.
          lastMicroFailure = micro.verdict;
          holdTimer.reset();
          landmarkSamples.length = 0;
          holdProgress = 0;
        }
        // 'insufficient' (perangkat lambat): tetap kumpulkan sampel tambahan.
      }

      const microBlocked = isReadyForHold && lastMicroFailure !== null;

      dispatch({
        type: 'frame_assessed',
        assessment,
        holdProgress,
        livenessStatus: microBlocked ? 'spoof_warning' : liveness.status,
        livenessScore: microBlocked
          ? Math.min(liveness.score, 52)
          : liveness.score,
        guidanceOverride:
          microBlocked && lastMicroFailure
            ? MICRO_MOVEMENT_GUIDANCE[lastMicroFailure]
            : undefined,
      });

      if (shouldCapture) {
        holdTimer.reset();
        landmarkSamples.length = 0;
        notifyHoldComplete();
      }
    };

    const handleFailure = (error: unknown): void => {
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
    trackingBox: analysis.trackingBox,
    livenessStatus: analysis.livenessStatus,
    livenessScore: analysis.livenessScore,
  };
}
