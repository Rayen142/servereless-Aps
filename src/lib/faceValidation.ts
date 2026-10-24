import type { NormalizedFace } from '@tensorflow-models/blazeface';

export type FaceStatus = 'valid' | 'invalid_position' | 'no_face';
export type LivenessStatus = 'idle' | 'checking' | 'verified' | 'spoof_warning';

export interface NormalizedPoint {
  readonly xPct: number;
  readonly yPct: number;
}

export interface FaceGeometryMetrics {
  /** Rasio posisi horizontal hidung di antara kedua mata (indikator rotasi 3D yaw). */
  readonly noseYawRatio: number;
  /** Rasio jarak vertikal mata ke mulut terhadap tinggi wajah (indikator pitch/ekspresi). */
  readonly eyeMouthPitchRatio: number;
  /** Jarak antar-mata relatif terhadap lebar wajah. */
  readonly interocularRatio: number;
  /** Titik pusat wajah ternormalisasi (0..1). */
  readonly centerNormX: number;
  readonly centerNormY: number;
}

export interface FaceTrackingBox {
  readonly leftPct: number;
  readonly topPct: number;
  readonly widthPct: number;
  readonly heightPct: number;
  readonly confidence: number;
  readonly landmarks: readonly NormalizedPoint[];
  readonly geometry: FaceGeometryMetrics;
}

export interface FaceAssessment {
  readonly status: FaceStatus;
  readonly message: string;
  readonly trackingBox: FaceTrackingBox | null;
}

/** Dimensi intrinsik frame video (bukan ukuran elemen di layar). */
export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface DetectedFace {
  readonly confidence: number;
  readonly bounds: Bounds;
  readonly landmarks: readonly Point[];
}

const CONFIDENCE_THRESHOLD = 0.8;
const MIN_FACE_AREA_RATIO = 0.2;
const MAX_FACE_AREA_RATIO = 0.78;
const EYE_ZONE_HEIGHT_RATIO = 0.55;
const GUIDE_WIDTH_RATIO = 0.6;
const GUIDE_HEIGHT_RATIO = 0.6;
const GUIDE_TOLERANCE_RATIO = 0.12;

export const FACE_ASSESSMENT = {
  noFace: {
    status: 'no_face',
    message: 'Posisikan wajah di dalam area kamera',
    trackingBox: null,
  },
  detectorUnavailable: {
    status: 'no_face',
    message: 'Deteksi wajah tidak tersedia',
    trackingBox: null,
  },
  calibrating: {
    status: 'invalid_position',
    message: 'Menyiapkan area panduan…',
    trackingBox: null,
  },
  tooFar: {
    status: 'invalid_position',
    message: 'Mendekatlah sedikit ke kamera',
    trackingBox: null,
  },
  tooClose: {
    status: 'invalid_position',
    message: 'Jauhi kamera sedikit',
    trackingBox: null,
  },
  outOfGuide: {
    status: 'invalid_position',
    message: 'Tengahkan wajah di area pindai',
    trackingBox: null,
  },
  eyesHidden: {
    status: 'invalid_position',
    message: 'Pastikan kedua mata terlihat jelas',
    trackingBox: null,
  },
  valid: {
    status: 'valid',
    message: 'Tahan posisi sebentar…',
    trackingBox: null,
  },
} as const satisfies Record<string, FaceAssessment>;

const readNumbers = (value: unknown): readonly number[] => {
  if (typeof value === 'number') {
    return [value];
  }

  return Array.isArray(value) ? value : [];
};

const readPoint = (value: unknown): Point => {
  const [x = Number.NaN, y = Number.NaN] = readNumbers(value);
  return { x, y };
};

const readPoints = (value: unknown): readonly Point[] =>
  Array.isArray(value) ? value.map((point) => readPoint(point)) : [];

const readFace = (face: NormalizedFace): DetectedFace => {
  const topLeft = readPoint(face.topLeft);
  const bottomRight = readPoint(face.bottomRight);

  return {
    confidence: readNumbers(face.probability)[0] ?? 0,
    bounds: {
      left: topLeft.x,
      top: topLeft.y,
      right: bottomRight.x,
      bottom: bottomRight.y,
    },
    landmarks: readPoints(face.landmarks),
  };
};

const isUsableFrame = ({ width, height }: FrameSize): boolean =>
  Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;

const containsPoint = (area: Bounds, point: Point): boolean =>
  point.x >= area.left &&
  point.x <= area.right &&
  point.y >= area.top &&
  point.y <= area.bottom;

const containsBounds = (area: Bounds, inner: Bounds): boolean =>
  inner.left >= area.left &&
  inner.top >= area.top &&
  inner.right <= area.right &&
  inner.bottom <= area.bottom;

/** Kotak panduan di tengah frame intrinsik, diperlebar toleransi 12% dari ukurannya. */
const getGuideGeometry = ({ width, height }: FrameSize) => {
  const guideWidth = width * GUIDE_WIDTH_RATIO;
  const guideHeight = height * GUIDE_HEIGHT_RATIO;
  const guideLeft = (width - guideWidth) / 2;
  const guideTop = (height - guideHeight) / 2;
  const toleranceX = guideWidth * GUIDE_TOLERANCE_RATIO;
  const toleranceY = guideHeight * GUIDE_TOLERANCE_RATIO;

  const allowed: Bounds = {
    left: guideLeft - toleranceX,
    top: guideTop - toleranceY,
    right: guideLeft + guideWidth + toleranceX,
    bottom: guideTop + guideHeight + toleranceY,
  };

  return {
    area: guideWidth * guideHeight,
    allowed,
    eyeZone: {
      ...allowed,
      bottom: guideTop + guideHeight * EYE_ZONE_HEIGHT_RATIO + toleranceY,
    },
  };
};

const clampPct = (val: number): number =>
  Math.min(100, Math.max(0, Number.isFinite(val) ? val : 0));

const computeGeometryMetrics = (
  bounds: Bounds,
  landmarks: readonly Point[],
  frame: FrameSize,
): FaceGeometryMetrics => {
  const faceW = Math.max(1, bounds.right - bounds.left);
  const faceH = Math.max(1, bounds.bottom - bounds.top);
  const rightEye = landmarks[0];
  const leftEye = landmarks[1];
  const nose = landmarks[2];
  const mouth = landmarks[3];

  let noseYawRatio = 0.5;
  let eyeMouthPitchRatio = 0.35;
  let interocularRatio = 0.4;

  if (rightEye && leftEye) {
    const eyeDx = leftEye.x - rightEye.x;
    const eyeDy = leftEye.y - rightEye.y;
    const eyeDist = Math.hypot(eyeDx, eyeDy);
    interocularRatio = eyeDist / faceW;

    if (nose && Math.abs(eyeDx) > 1) {
      noseYawRatio = (nose.x - rightEye.x) / eyeDx;
    }
    if (mouth) {
      const eyeMidY = (rightEye.y + leftEye.y) / 2;
      eyeMouthPitchRatio = (mouth.y - eyeMidY) / faceH;
    }
  }

  return {
    noseYawRatio: Number.isFinite(noseYawRatio) ? noseYawRatio : 0.5,
    eyeMouthPitchRatio: Number.isFinite(eyeMouthPitchRatio)
      ? eyeMouthPitchRatio
      : 0.35,
    interocularRatio: Number.isFinite(interocularRatio)
      ? interocularRatio
      : 0.4,
    centerNormX: (bounds.left + faceW / 2) / Math.max(1, frame.width),
    centerNormY: (bounds.top + faceH / 2) / Math.max(1, frame.height),
  };
};

const buildTrackingBox = (
  { bounds, landmarks, confidence }: DetectedFace,
  frame: FrameSize,
): FaceTrackingBox => {
  const leftPct = clampPct((bounds.left / frame.width) * 100);
  const topPct = clampPct((bounds.top / frame.height) * 100);
  const rightPct = clampPct((bounds.right / frame.width) * 100);
  const bottomPct = clampPct((bounds.bottom / frame.height) * 100);

  return {
    leftPct,
    topPct,
    widthPct: Math.max(8, rightPct - leftPct),
    heightPct: Math.max(8, bottomPct - topPct),
    confidence,
    landmarks: landmarks
      .filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y))
      .map((pt) => ({
        xPct: clampPct((pt.x / frame.width) * 100),
        yPct: clampPct((pt.y / frame.height) * 100),
      })),
    geometry: computeGeometryMetrics(bounds, landmarks, frame),
  };
};

const validateFacePosition = (
  detected: DetectedFace,
  frame: FrameSize,
): FaceAssessment => {
  if (!isUsableFrame(frame)) {
    return FACE_ASSESSMENT.calibrating;
  }

  const { bounds, landmarks } = detected;
  const guide = getGuideGeometry(frame);
  const faceWidth = bounds.right - bounds.left;
  const faceHeight = bounds.bottom - bounds.top;
  const faceArea = Math.max(0, faceWidth * faceHeight);
  const areaRatio = faceArea / guide.area;
  const center: Point = {
    x: bounds.left + faceWidth / 2,
    y: bounds.top + faceHeight / 2,
  };

  const measurements = [
    bounds.left,
    bounds.top,
    bounds.right,
    bounds.bottom,
    faceWidth,
    faceHeight,
    faceArea,
    areaRatio,
    center.x,
    center.y,
  ];
  if (!measurements.every(Number.isFinite)) {
    return FACE_ASSESSMENT.calibrating;
  }

  const trackingBox = buildTrackingBox(detected, frame);

  if (areaRatio < MIN_FACE_AREA_RATIO) {
    return { ...FACE_ASSESSMENT.tooFar, trackingBox };
  }

  if (areaRatio > MAX_FACE_AREA_RATIO) {
    return { ...FACE_ASSESSMENT.tooClose, trackingBox };
  }

  if (
    !containsPoint(guide.allowed, center) ||
    !containsBounds(guide.allowed, bounds)
  ) {
    return { ...FACE_ASSESSMENT.outOfGuide, trackingBox };
  }

  // Dua landmark pertama BlazeFace adalah mata kanan dan kiri.
  const eyes = landmarks.slice(0, 2);
  const eyesAreVisible =
    eyes.length === 2 && eyes.every((eye) => containsPoint(guide.eyeZone, eye));

  return eyesAreVisible
    ? { ...FACE_ASSESSMENT.valid, trackingBox }
    : { ...FACE_ASSESSMENT.eyesHidden, trackingBox };
};

/**
 * Menilai wajah pertama yang lolos ambang keyakinan terhadap kotak panduan.
 * Fungsi murni: tidak menyentuh DOM, ref, maupun state React.
 */
export const validateFaces = (
  faces: readonly NormalizedFace[],
  frame: FrameSize,
): FaceAssessment => {
  for (const candidate of faces) {
    const face = readFace(candidate);

    if (face.confidence >= CONFIDENCE_THRESHOLD) {
      return validateFacePosition(face, frame);
    }
  }

  return FACE_ASSESSMENT.noFace;
};
