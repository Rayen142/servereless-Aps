import type { ReactNode } from 'react';
import type { FaceDetectionResult } from '../hooks/useFaceDetection';
import type { UseWebCameraResult } from '../hooks/useWebCamera';
import { RefreshIcon } from './icons';

interface CameraViewProps {
  readonly camera: UseWebCameraResult;
  readonly detection: FaceDetectionResult;
  /** Foto hasil tangkapan; jika ada, ditampilkan menggantikan video. */
  readonly capturedImage?: string | null;
  readonly isFlashing?: boolean;
  /** Label kecil yang menempel di atas kotak wajah. */
  readonly faceLabel?: string | null;
  readonly faceSubLabel?: string | null;
  readonly faceAlert?: boolean;
  /** Overlay tambahan (mis. status di atas foto). */
  readonly children?: ReactNode;
}

/** Tampilan kamera minimalis dengan kotak tracking wajah tipis. */
function CameraView({
  camera,
  detection,
  capturedImage = null,
  isFlashing = false,
  faceLabel,
  faceSubLabel,
  faceAlert = false,
  children,
}: CameraViewProps) {
  const isReady = camera.status === 'ready';
  const box = detection.trackingBox;
  const isValid = detection.faceStatus === 'valid';

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-3xl bg-neutral-900">
      {capturedImage ? (
        <img
          src={capturedImage}
          alt="Hasil tangkapan wajah"
          className="h-full w-full -scale-x-100 object-cover"
        />
      ) : (
        <video
          ref={camera.videoRef}
          autoPlay
          muted
          playsInline
          aria-label="Kamera langsung"
          className={`h-full w-full -scale-x-100 object-cover transition-opacity duration-500 ${
            isReady ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

      {/* Kotak tracking wajah (video di-mirror, jadi koordinat X juga dicerminkan) */}
      {!capturedImage && isReady && box && (
        <div className="pointer-events-none absolute inset-0">
          <div
            className={`absolute rounded-2xl border transition-all duration-150 ease-out ${
              isValid ? 'border-emerald-400' : 'border-white/70'
            }`}
            style={{
              left: `${100 - box.leftPct - box.widthPct}%`,
              top: `${box.topPct}%`,
              width: `${box.widthPct}%`,
              height: `${box.heightPct}%`,
            }}
          >
            {faceLabel && (
              <div className="absolute -top-2 left-1/2 flex -translate-x-1/2 -translate-y-full flex-col items-center">
                <div className="whitespace-nowrap rounded-full bg-white/95 px-3 py-1 text-xs font-medium text-neutral-900 shadow-sm">
                  {faceLabel}
                  {faceAlert && (
                    <span className="ml-1.5 inline-block h-1.5 w-1.5 -translate-y-px rounded-full bg-rose-500" />
                  )}
                </div>
                {faceSubLabel && (
                  <span className="mt-1 whitespace-nowrap text-[11px] text-white/80">
                    {faceSubLabel}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Progress tahan posisi */}
      {!capturedImage && isReady && isValid && detection.holdProgress > 0 && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
          <div
            className="h-full bg-emerald-400 transition-[width] duration-100"
            style={{ width: `${detection.holdProgress * 100}%` }}
          />
        </div>
      )}

      {/* State kamera */}
      {!capturedImage && !isReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
          {camera.status === 'error' ? (
            <>
              <p className="text-sm font-medium text-white">Kamera tidak dapat dibuka</p>
              <p className="max-w-xs text-xs leading-5 text-neutral-400">
                {camera.error.message}
              </p>
              <button
                type="button"
                onClick={camera.retry}
                className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-medium text-neutral-900 transition hover:bg-neutral-200"
              >
                <RefreshIcon width={14} height={14} />
                Coba lagi
              </button>
            </>
          ) : (
            <>
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-white" />
              <p className="text-xs text-neutral-400">Membuka kamera…</p>
            </>
          )}
        </div>
      )}

      {children}

      {isFlashing && (
        <div className="pointer-events-none absolute inset-0 animate-pulse bg-white/70" />
      )}
    </div>
  );
}

export default CameraView;
