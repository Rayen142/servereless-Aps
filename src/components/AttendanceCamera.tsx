import {
  useAttendanceVerification,
  type VerificationFeedback,
} from '../hooks/useAttendanceVerification';
import {
  useFaceDetection,
  type FaceDetectionResult,
} from '../hooks/useFaceDetection';
import { useFrameCapture } from '../hooks/useFrameCapture';
import {
  useWebCamera,
  type CameraErrorCode,
  type UseWebCameraResult,
} from '../hooks/useWebCamera';

interface NoticeCopy {
  readonly title: string;
  readonly message: string;
}

const PREPARING_NOTICE: NoticeCopy = {
  title: 'Menyiapkan kamera',
  message: 'Mohon tunggu sebentar saat kami meminta akses kamera perangkat.',
};

const CAMERA_ERROR_TITLES: Record<CameraErrorCode, string> = {
  permission_denied: 'Akses kamera diperlukan',
  device_not_found: 'Kamera tidak ditemukan',
  unsupported: 'Kamera tidak ditemukan',
  device_busy: 'Kamera tidak dapat digunakan',
  unknown: 'Kamera tidak dapat digunakan',
};

const GUIDE_CORNER_CLASSES = [
  'absolute left-[-1px] top-[-1px] h-8 w-8 rounded-tl-[2rem] border-l-2 border-t-2',
  'absolute right-[-1px] top-[-1px] h-8 w-8 rounded-tr-[2rem] border-r-2 border-t-2',
  'absolute bottom-[-1px] left-[-1px] h-8 w-8 rounded-bl-[2rem] border-b-2 border-l-2',
  'absolute bottom-[-1px] right-[-1px] h-8 w-8 rounded-br-[2rem] border-b-2 border-r-2',
] as const;

const getCameraNotice = (camera: UseWebCameraResult): NoticeCopy =>
  camera.status === 'error'
    ? {
        title: CAMERA_ERROR_TITLES[camera.error.code],
        message: camera.error.message,
      }
    : PREPARING_NOTICE;

interface CapturePreviewProps {
  readonly image: string;
  readonly feedback: VerificationFeedback | null;
  readonly isSubmitting: boolean;
  readonly onRetake: () => void;
  readonly onConfirm: () => void;
}

function CapturePreview({
  image,
  feedback,
  isSubmitting,
  onRetake,
  onConfirm,
}: CapturePreviewProps) {
  return (
    <>
      <img
        src={image}
        alt="Pratinjau hasil tangkapan wajah"
        className="h-full w-full object-cover"
      />
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 bg-slate-950/75 p-5 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Tangkapan berhasil</p>
          <p className="mt-1 text-xs text-slate-300">Pastikan hasil foto terlihat jelas sebelum konfirmasi.</p>
          {feedback && (
            <div
              role="alert"
              aria-live="polite"
              className={`mt-3 rounded-xl px-3 py-2 text-xs font-medium ${
                feedback.type === 'success'
                  ? 'bg-emerald-400/15 text-emerald-200'
                  : 'bg-rose-400/15 text-rose-200'
              }`}
            >
              {feedback.message}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onRetake}
            disabled={isSubmitting}
            className="rounded-full border border-white/20 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Ulangi
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="flex items-center gap-2 rounded-full bg-teal-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-teal-300 focus:outline-none focus:ring-2 focus:ring-teal-200 disabled:cursor-wait disabled:opacity-70"
          >
            {isSubmitting && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-950/30 border-t-slate-950" />
            )}
            {isSubmitting ? 'Memverifikasi Biometrik...' : 'Konfirmasi Absen'}
          </button>
        </div>
      </div>
    </>
  );
}

function FaceGuide({ detection }: { readonly detection: FaceDetectionResult }) {
  const isFaceValid = detection.faceStatus === 'valid';
  const cornerTone = isFaceValid ? 'border-emerald-300' : 'border-teal-300';

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 pb-8 pt-6 text-center text-white">
      <div
        className={`relative h-[60%] w-[60%] max-w-[22rem] rounded-[2rem] border bg-white/[0.03] shadow-[0_0_0_999px_rgba(2,6,23,0.08)] backdrop-blur-[1px] transition-colors duration-300 ${
          isFaceValid
            ? 'border-emerald-300 shadow-[0_0_0_999px_rgba(2,6,23,0.08),0_0_28px_rgba(52,211,153,0.35)]'
            : 'border-white/50'
        }`}
      >
        {GUIDE_CORNER_CLASSES.map((cornerClasses) => (
          <span key={cornerClasses} className={`${cornerClasses} ${cornerTone}`} />
        ))}
      </div>
      <div className="mt-5 w-full max-w-sm rounded-2xl bg-slate-950/60 px-4 py-3 backdrop-blur-md">
        <p className="text-sm font-medium tracking-wide">{detection.guidance}</p>
        {isFaceValid && (
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-emerald-300 transition-[width] duration-100"
              style={{ width: `${detection.holdProgress * 100}%` }}
            />
          </div>
        )}
        {!isFaceValid && detection.detectorStatus === 'loading' && (
          <p className="mt-1 text-xs text-slate-300">Menyiapkan deteksi wajah...</p>
        )}
      </div>
    </div>
  );
}

interface CameraNoticeProps {
  readonly notice: NoticeCopy;
  readonly isPreparing: boolean;
  readonly onRetry?: () => void;
}

function CameraNotice({ notice, isPreparing, onRetry }: CameraNoticeProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
      <div className="max-w-sm">
        {isPreparing && (
          <span className="mx-auto mb-5 block h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-teal-300" />
        )}
        <p className="text-lg font-semibold text-white">{notice.title}</p>
        <p className="mt-2 text-sm leading-6 text-slate-300">{notice.message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-6 rounded-full bg-teal-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-teal-300 focus:outline-none focus:ring-2 focus:ring-teal-200 focus:ring-offset-2 focus:ring-offset-slate-950"
          >
            Coba lagi
          </button>
        )}
      </div>
    </div>
  );
}

type BadgeTone = 'pending' | 'live' | 'valid';

const BADGE_DOT_CLASSES: Record<BadgeTone, string> = {
  pending: 'bg-amber-300',
  live: 'bg-teal-300',
  valid: 'bg-emerald-400',
};

const BADGE_LIVE_LABELS = {
  live: 'Live preview',
  valid: 'Wajah terdeteksi',
} as const;

const getBadgeTone = (isReady: boolean, isFaceValid: boolean): BadgeTone => {
  if (!isReady) {
    return 'pending';
  }

  return isFaceValid ? 'valid' : 'live';
};

interface StatusBadgeProps {
  readonly tone: BadgeTone;
  readonly pendingLabel: string;
}

function StatusBadge({ tone, pendingLabel }: StatusBadgeProps) {
  const label = tone === 'pending' ? pendingLabel : BADGE_LIVE_LABELS[tone];

  return (
    <div className="absolute bottom-5 left-5 flex items-center gap-2 rounded-full bg-slate-950/60 px-3.5 py-2 text-xs font-medium text-white backdrop-blur-md">
      <span className={`h-2 w-2 rounded-full ${BADGE_DOT_CLASSES[tone]}`} />
      {label}
    </div>
  );
}

interface LiveCameraViewProps {
  readonly camera: UseWebCameraResult;
  readonly detection: FaceDetectionResult;
}

function LiveCameraView({ camera, detection }: LiveCameraViewProps) {
  const isReady = camera.status === 'ready';
  const notice = getCameraNotice(camera);

  return (
    <>
      <video
        ref={camera.videoRef}
        autoPlay
        muted
        playsInline
        className={`h-full w-full object-cover transition-opacity duration-500 ${
          isReady ? 'opacity-100' : 'opacity-0'
        }`}
        aria-label="Live feed kamera"
      />

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_35%,rgba(2,6,23,0.3)_100%)]" />

      {isReady ? (
        <FaceGuide detection={detection} />
      ) : (
        <CameraNotice
          notice={notice}
          isPreparing={camera.status !== 'error'}
          onRetry={camera.status === 'error' ? camera.retry : undefined}
        />
      )}

      <StatusBadge
        tone={getBadgeTone(isReady, detection.faceStatus === 'valid')}
        pendingLabel={notice.title}
      />
    </>
  );
}

function AttendanceCamera() {
  const frame = useFrameCapture();
  const verification = useAttendanceVerification();
  const camera = useWebCamera({ enabled: frame.image === null });
  const detection = useFaceDetection({
    videoRef: camera.videoRef,
    enabled: camera.status === 'ready',
    onHoldComplete: () => {
      if (frame.capture(camera.videoRef.current)) {
        verification.reset();
      }
    },
  });

  const handleRetake = () => {
    frame.discard();
    verification.reset();
  };

  const handleConfirm = () => {
    if (frame.image !== null) {
      void verification.submit(frame.image);
    }
  };

  return (
    <section className="w-full" aria-label="Kamera absensi">
      <div className="relative mx-auto aspect-[4/3] w-full max-w-4xl overflow-hidden rounded-[1.75rem] bg-slate-950 shadow-[0_24px_70px_-28px_rgba(15,23,42,0.6)] ring-1 ring-slate-200">
        {frame.image !== null ? (
          <CapturePreview
            image={frame.image}
            feedback={verification.feedback}
            isSubmitting={verification.isSubmitting}
            onRetake={handleRetake}
            onConfirm={handleConfirm}
          />
        ) : (
          <LiveCameraView camera={camera} detection={detection} />
        )}

        {frame.isFlashing && <div className="pointer-events-none absolute inset-0 animate-pulse bg-white/80" />}
      </div>
    </section>
  );
}

export default AttendanceCamera;
