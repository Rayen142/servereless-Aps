import type { NormalizedFace } from '@tensorflow-models/blazeface';

export type FaceStatus = 'valid' | 'invalid_position' | 'no_face';

export interface FaceAssessment {
  readonly status: FaceStatus;
  readonly message: string;
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
  noFace: { status: 'no_face', message: 'Posisikan wajah di dalam kotak' },
  detectorUnavailable: {
    status: 'no_face',
    message: 'Deteksi wajah tidak tersedia',
  },
  calibrating: {
    status: 'invalid_position',
    message: 'Menyiapkan area panduan...',
  },
  tooFar: { status: 'invalid_position', message: 'Mendekatlah ke kamera' },
  tooClose: { status: 'invalid_position', message: 'Jauhi kamera sedikit' },
  outOfGuide: {
    status: 'invalid_position',
    message: 'Posisikan wajah di dalam kotak',
  },
  eyesHidden: { status: 'invalid_position', message: 'Mata tidak terlihat' },
  valid: { status: 'valid', message: 'Tahan posisi...' },
} as const satisfies Record<string, FaceAssessment>;

/*
 * Dengan `returnTensors = false`, BlazeFace mengembalikan array biasa
 * (`probability` berupa array satu elemen), meski typings juga mengizinkan tensor.
 * Pembaca di bawah menerima `unknown` dan menghasilkan NaN untuk bentuk tak dikenal,
 * sehingga validasi akhirnya jatuh ke status "calibrating" alih-alih melempar error.
 */
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

const validateFacePosition = (
  { bounds, landmarks }: DetectedFace,
  frame: FrameSize,
): FaceAssessment => {
  if (!isUsableFrame(frame)) {
    return FACE_ASSESSMENT.calibrating;
  }

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

  if (areaRatio < MIN_FACE_AREA_RATIO) {
    return FACE_ASSESSMENT.tooFar;
  }

  if (areaRatio > MAX_FACE_AREA_RATIO) {
    return FACE_ASSESSMENT.tooClose;
  }

  if (
    !containsPoint(guide.allowed, center) ||
    !containsBounds(guide.allowed, bounds)
  ) {
    return FACE_ASSESSMENT.outOfGuide;
  }

  // Dua landmark pertama BlazeFace adalah mata kanan dan kiri.
  const eyes = landmarks.slice(0, 2);
  const eyesAreVisible =
    eyes.length === 2 && eyes.every((eye) => containsPoint(guide.eyeZone, eye));

  return eyesAreVisible ? FACE_ASSESSMENT.valid : FACE_ASSESSMENT.eyesHidden;
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
