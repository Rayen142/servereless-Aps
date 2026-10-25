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
  /**
   * Proporsi bagian bawah kotak wajah di bawah ujung hidung terhadap tinggi kotak.
   * Pada wajah tertutup masker, tepi bawah kotak BlazeFace cenderung "melompat"
   * sehingga rasio ini berfluktuasi tidak wajar antar-frame.
   */
  readonly lowerFaceRatio: number;
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

/** Titik dalam koordinat piksel frame intrinsik. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Konteks antar-frame opsional untuk validasi yang membutuhkan riwayat. */
export interface FaceValidationContext {
  /** Riwayat `lowerFaceRatio` dari frame-frame sebelumnya (deteksi masker). */
  readonly lowerFaceHistory?: readonly number[];
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
/**
 * Rentang keyakinan "tertahan": wajah jelas terdeteksi (mata terlihat) tetapi
 * fitur bawah (hidung–mulut) tertutup sehingga skor BlazeFace tidak mencapai ambang.
 */
const MASK_CONFIDENCE_MIN = 0.55;
const MASK_CONFIDENCE_MAX = 0.78;
/** Minimal sampel riwayat sebelum menilai stabilitas proporsi bawah wajah. */
const LOWER_FACE_MIN_SAMPLES = 6;
/** Simpangan baku `lowerFaceRatio` di atas nilai ini dianggap tidak stabil. */
const LOWER_FACE_INSTABILITY_STD = 0.055;
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
  maskDetected: {
    status: 'invalid_position',
    message: 'Harap lepaskan masker/penutup wajah sejenak',
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
  const lowerFaceRatio = nose ? (bounds.bottom - nose.y) / faceH : 0.4;

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
    lowerFaceRatio: Number.isFinite(lowerFaceRatio) ? lowerFaceRatio : 0.4,
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

const mean = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((acc, v) => acc + v, 0) / values.length;

const variance = (values: readonly number[]): number => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return values.reduce((acc, v) => acc + (v - m) * (v - m), 0) / values.length;
};

/** Proporsi bagian bawah kotak dianggap tidak stabil bila simpangan bakunya melampaui ambang. */
const isLowerFaceUnstable = (history: readonly number[]): boolean => {
  const samples = history.filter(Number.isFinite);
  return (
    samples.length >= LOWER_FACE_MIN_SAMPLES &&
    Math.sqrt(variance(samples)) > LOWER_FACE_INSTABILITY_STD
  );
};

interface PositionOptions {
  /** Keyakinan deteksi berada di rentang tertahan (indikasi wajah tertutup). */
  readonly suspectOcclusion: boolean;
  readonly lowerFaceHistory: readonly number[];
}

const validateFacePosition = (
  detected: DetectedFace,
  frame: FrameSize,
  { suspectOcclusion, lowerFaceHistory }: PositionOptions,
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

  if (!eyesAreVisible) {
    return { ...FACE_ASSESSMENT.eyesHidden, trackingBox };
  }

  // Mata berada di zona valid (55% atas kotak panduan), namun keyakinan tertahan
  // atau proporsi bagian bawah kotak goyah: indikasi kuat masker / penutup wajah.
  if (
    suspectOcclusion ||
    isLowerFaceUnstable([
      ...lowerFaceHistory,
      trackingBox.geometry.lowerFaceRatio,
    ])
  ) {
    return { ...FACE_ASSESSMENT.maskDetected, trackingBox };
  }

  return { ...FACE_ASSESSMENT.valid, trackingBox };
};

/**
 * Menilai wajah pertama yang lolos ambang keyakinan terhadap kotak panduan.
 * Bila tidak ada, wajah dengan keyakinan tertahan (0.55–0.78) dinilai sebagai
 * kandidat wajah tertutup masker agar pengguna menerima panduan yang tepat.
 * Fungsi murni: tidak menyentuh DOM, ref, maupun state React.
 */
export const validateFaces = (
  faces: readonly NormalizedFace[],
  frame: FrameSize,
  context: FaceValidationContext = {},
): FaceAssessment => {
  const lowerFaceHistory = context.lowerFaceHistory ?? [];
  const detected = faces.map((candidate) => readFace(candidate));

  const confident = detected.find(
    (face) => face.confidence >= CONFIDENCE_THRESHOLD,
  );
  if (confident) {
    return validateFacePosition(confident, frame, {
      suspectOcclusion: false,
      lowerFaceHistory,
    });
  }

  const occluded = detected.find(
    (face) =>
      face.confidence >= MASK_CONFIDENCE_MIN &&
      face.confidence <= MASK_CONFIDENCE_MAX,
  );
  if (occluded) {
    return validateFacePosition(occluded, frame, {
      suspectOcclusion: true,
      lowerFaceHistory,
    });
  }

  return FACE_ASSESSMENT.noFace;
};

/* -------------------------------------------------------------------------- */
/*  Heuristic Anti-Spoofing: Micro-Movement Variance (Geometri Spasial 2D)    */
/* -------------------------------------------------------------------------- */

/** Sampel landmark mata & hidung (piksel frame intrinsik) pada satu frame. */
export interface LandmarkSample {
  readonly t: number;
  readonly rightEye: Point;
  readonly leftEye: Point;
  readonly nose: Point;
}

export type MicroMovementVerdict =
  | 'insufficient'
  | 'static'
  | 'rigid_uniform'
  | 'natural';

export interface MicroMovementAnalysis {
  readonly verdict: MicroMovementVerdict;
  readonly sampleCount: number;
  /** RMS perpindahan titik tengah mata antar-frame (satuan jarak antar-mata). */
  readonly motionRms: number;
  /** Sebaran posisi global wajah sepanjang jendela (satuan jarak antar-mata). */
  readonly motionSpread: number;
  /** Sebaran (terhaluskan) posisi hidung dalam kerangka mata: paralaks non-planar. */
  readonly parallaxStd: number;
  /** Autokorelasi lag-1 deret paralaks: gerak alami halus, derau detektor acak. */
  readonly parallaxCoherence: number;
  /** 1 = ketiga landmark bergerak seragam (lockstep), 0 = sepenuhnya independen. */
  readonly uniformity: number;
  /** Pesan panduan bila verdict bukan `natural`. */
  readonly message: string | null;
}

/** Minimal sampel (~10 fps × 1,5 dtk = 15; 6 untuk perangkat lambat). */
const MICRO_MIN_SAMPLES = 6;
/** Di bawah ini wajah praktis tidak bergerak sama sekali (statis/beku). */
const MICRO_STATIC_MOTION_RMS = 0.004;
/** Ambang minimum paralaks terhaluskan yang menandakan fluktuasi 3D alami. */
const MICRO_PARALLAX_MIN = 0.006;
/** Fluktuasi alami bersifat halus (berkorelasi); derau detektor ~0. */
const MICRO_COHERENCE_MIN = 0.3;
/** Sebaran gerak global yang dianggap "benda sedang digerakkan". */
const MICRO_RIGID_SPREAD_MIN = 0.03;
/** Rasio paralaks/gerak global di bawah ini = benda datar kaku. */
const MICRO_RIGID_PARALLAX_RATIO = 0.08;
const MICRO_RIGID_UNIFORMITY_MIN = 0.9;

export const MICRO_MOVEMENT_GUIDANCE: Record<
  Exclude<MicroMovementVerdict, 'natural'>,
  string
> = {
  insufficient: 'Tahan posisi sebentar…',
  static:
    'Wajah terdeteksi statis — kedipkan mata atau gerakkan kepala perlahan',
  rigid_uniform:
    'Pola gerak seragam terdeteksi (indikasi foto 2D) — tatap kamera secara natural',
};

const lag1Autocorrelation = (values: readonly number[]): number => {
  if (values.length < 3) return 0;
  const m = mean(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i]! - m;
    den += d * d;
    if (i > 0) num += d * (values[i - 1]! - m);
  }
  return den > 1e-12 ? num / den : 0;
};

/** Rata-rata bergerak 3 titik: meredam derau detektor frekuensi tinggi. */
const movingAverage3 = (values: readonly number[]): number[] =>
  values.map((_, i) => {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(values.length - 1, i + 1);
    let sum = 0;
    for (let k = lo; k <= hi; k++) sum += values[k]!;
    return sum / (hi - lo + 1);
  });

/**
 * Mengubah tracking box (persentase) menjadi sampel landmark piksel.
 * Mengembalikan `null` bila mata/hidung tidak lengkap.
 */
export const createLandmarkSample = (
  box: FaceTrackingBox,
  frame: FrameSize,
  t: number,
): LandmarkSample | null => {
  const [rightEye, leftEye, nose] = box.landmarks;
  if (!rightEye || !leftEye || !nose || !isUsableFrame(frame)) {
    return null;
  }
  const toPx = (p: NormalizedPoint): Point => ({
    x: (p.xPct / 100) * frame.width,
    y: (p.yPct / 100) * frame.height,
  });
  return { t, rightEye: toPx(rightEye), leftEye: toPx(leftEye), nose: toPx(nose) };
};

/**
 * Analisis variansi micro-movement antar-frame (fungsi murni).
 *
 * Prinsip geometri spasial pada kamera 2D: ujung hidung manusia menonjol
 * keluar dari bidang mata, sehingga rotasi kepala sekecil apa pun (goyangan
 * postural, napas, tremor) menggeser posisi hidung relatif terhadap kerangka
 * mata (paralaks). Pada foto/layar datar, posisi tersebut invarian terhadap
 * translasi, rotasi bidang, dan skala — objek bergerak "seragam" tanpa paralaks.
 *
 * - `static`: hampir tidak ada gerak global maupun paralaks (foto di dudukan).
 * - `rigid_uniform`: ada gerak global, tetapi landmark bergerak lockstep tanpa
 *   paralaks yang koheren (foto/layar yang digerakkan tangan).
 * - `natural`: terdapat fluktuasi paralaks halus & berkorelasi khas wajah hidup.
 */
export const analyzeMicroMovement = (
  samples: readonly LandmarkSample[],
): MicroMovementAnalysis => {
  const frames = samples
    .map((s) => {
      const ax = s.leftEye.x - s.rightEye.x;
      const ay = s.leftEye.y - s.rightEye.y;
      const iod = Math.hypot(ax, ay);
      const midX = (s.leftEye.x + s.rightEye.x) / 2;
      const midY = (s.leftEye.y + s.rightEye.y) / 2;
      const ex = ax / iod;
      const ey = ay / iod;
      const nx = s.nose.x - midX;
      const ny = s.nose.y - midY;
      return {
        sample: s,
        iod,
        midX,
        midY,
        // Koordinat hidung dalam kerangka mata, dinormalisasi jarak antar-mata.
        u: (nx * ex + ny * ey) / iod,
        v: (-nx * ey + ny * ex) / iod,
      };
    })
    .filter(
      (f) =>
        f.iod > 4 &&
        [f.u, f.v, f.midX, f.midY].every(Number.isFinite),
    );

  const empty: MicroMovementAnalysis = {
    verdict: 'insufficient',
    sampleCount: frames.length,
    motionRms: 0,
    motionSpread: 0,
    parallaxStd: 0,
    parallaxCoherence: 0,
    uniformity: 0,
    message: MICRO_MOVEMENT_GUIDANCE.insufficient,
  };
  if (frames.length < MICRO_MIN_SAMPLES) {
    return empty;
  }

  const iodMean = mean(frames.map((f) => f.iod));

  // Gerak global & keseragaman perpindahan ketiga landmark antar-frame.
  let midStepSq = 0;
  let totalEnergy = 0;
  let residualEnergy = 0;
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1]!.sample;
    const curr = frames[i]!.sample;
    const deltas = (['rightEye', 'leftEye', 'nose'] as const).map((key) => ({
      x: (curr[key].x - prev[key].x) / iodMean,
      y: (curr[key].y - prev[key].y) / iodMean,
    }));
    const mx = mean(deltas.map((d) => d.x));
    const my = mean(deltas.map((d) => d.y));
    for (const d of deltas) {
      totalEnergy += d.x * d.x + d.y * d.y;
      residualEnergy += (d.x - mx) ** 2 + (d.y - my) ** 2;
    }
    const dMidX = (frames[i]!.midX - frames[i - 1]!.midX) / iodMean;
    const dMidY = (frames[i]!.midY - frames[i - 1]!.midY) / iodMean;
    midStepSq += dMidX * dMidX + dMidY * dMidY;
  }

  const steps = frames.length - 1;
  const motionRms = Math.sqrt(midStepSq / steps);
  const motionSpread = Math.sqrt(
    variance(frames.map((f) => f.midX / iodMean)) +
      variance(frames.map((f) => f.midY / iodMean)),
  );
  const uniformity =
    totalEnergy > 1e-12 ? Math.max(0, 1 - residualEnergy / totalEnergy) : 1;

  const uSeries = frames.map((f) => f.u);
  const vSeries = frames.map((f) => f.v);
  const parallaxStd = Math.sqrt(
    variance(movingAverage3(uSeries)) + variance(movingAverage3(vSeries)),
  );
  const parallaxCoherence = Math.max(
    lag1Autocorrelation(uSeries),
    lag1Autocorrelation(vSeries),
  );

  const metrics = {
    sampleCount: frames.length,
    motionRms,
    motionSpread,
    parallaxStd,
    parallaxCoherence,
    uniformity,
  };

  const hasNaturalParallax =
    parallaxStd >= MICRO_PARALLAX_MIN &&
    parallaxCoherence >= MICRO_COHERENCE_MIN;
  const isBeingMoved = motionSpread >= MICRO_RIGID_SPREAD_MIN;

  let verdict: MicroMovementVerdict;
  if (motionRms < MICRO_STATIC_MOTION_RMS && parallaxStd < MICRO_PARALLAX_MIN) {
    verdict = 'static';
  } else if (
    isBeingMoved &&
    (!hasNaturalParallax ||
      (uniformity >= MICRO_RIGID_UNIFORMITY_MIN &&
        parallaxStd / motionSpread < MICRO_RIGID_PARALLAX_RATIO))
  ) {
    verdict = 'rigid_uniform';
  } else if (hasNaturalParallax) {
    verdict = 'natural';
  } else {
    // Ada sedikit gerak, tetapi tanpa fluktuasi paralaks alami.
    verdict = 'static';
  }

  return {
    ...metrics,
    verdict,
    message: verdict === 'natural' ? null : MICRO_MOVEMENT_GUIDANCE[verdict],
  };
};
