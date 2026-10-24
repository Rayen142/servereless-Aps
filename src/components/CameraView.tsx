import type { ReactNode } from 'react';
import type { FaceDetectionResult } from '../hooks/useFaceDetection';
import type { UseWebCameraResult } from '../hooks/useWebCamera';
import { RefreshIcon, ShieldCheckIcon, AlertIcon } from './icons';

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

/** Tampilan kamera biometrik berstandar medis dengan HUD tracking presisi tinggi. */
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
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-950 shadow-xl">
      {capturedImage ? (
        <img
          src={capturedImage}
          alt="Hasil tangkapan wajah pasien"
          className="h-full w-full -scale-x-100 object-cover"
        />
      ) : (
        <video
          ref={camera.videoRef}
          autoPlay
          muted
          playsInline
          aria-label="Kamera langsung pemindai wajah"
          className={`h-full w-full -scale-x-100 object-cover transition-opacity duration-300 ${
            isReady ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

      {/* Biometric Viewport Corner Guides */}
      <div className="pointer-events-none absolute inset-4 border border-white/5">
        <div className="absolute -left-0.5 -top-0.5 h-4 w-4 border-l-2 border-t-2 border-teal-400/70" />
        <div className="absolute -right-0.5 -top-0.5 h-4 w-4 border-r-2 border-t-2 border-teal-400/70" />
        <div className="absolute -bottom-0.5 -left-0.5 h-4 w-4 border-b-2 border-l-2 border-teal-400/70" />
        <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 border-b-2 border-r-2 border-teal-400/70" />
      </div>

      {/* Top HUD Status Bar */}
      <div className="pointer-events-none absolute left-4 right-4 top-4 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 rounded-full border border-slate-700/60 bg-slate-900/80 px-3 py-1 text-[11px] font-medium text-slate-300 backdrop-blur-md">
          <span
            className={`h-2 w-2 rounded-full ${
              capturedImage
                ? 'bg-amber-400'
                : isReady
                  ? 'animate-pulse bg-emerald-400'
                  : 'bg-rose-400'
            }`}
          />
          <span className="font-mono tracking-wider">
            {capturedImage ? 'FRAME CAPTURED' : isReady ? 'AI SCANNER ONLINE' : 'STANDBY'}
          </span>
        </div>

        {isReady && !capturedImage && (
          <div className="rounded-full border border-slate-700/60 bg-slate-900/80 px-2.5 py-1 font-mono text-[10px] text-slate-400 backdrop-blur-md">
            720p · 30 FPS
          </div>
        )}
      </div>

      {/* Kotak tracking wajah (video di-mirror, koordinat X dicerminkan) */}
      {!capturedImage && isReady && box && (
        <div className="pointer-events-none absolute inset-0">
          <div
            className={`absolute rounded-xl border-2 transition-all duration-100 ease-out ${
              isValid
                ? 'border-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.3)]'
                : 'border-cyan-400/80 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
            }`}
            style={{
              left: `${100 - box.leftPct - box.widthPct}%`,
              top: `${box.topPct}%`,
              width: `${box.widthPct}%`,
              height: `${box.heightPct}%`,
            }}
          >
            {/* Corner Markers on Tracking Box */}
            <div className="absolute -left-1 -top-1 h-2 w-2 rounded-sm bg-white" />
            <div className="absolute -right-1 -top-1 h-2 w-2 rounded-sm bg-white" />
            <div className="absolute -bottom-1 -left-1 h-2 w-2 rounded-sm bg-white" />
            <div className="absolute -bottom-1 -right-1 h-2 w-2 rounded-sm bg-white" />

            {/* Floating identity card */}
            {faceLabel && (
              <div className="absolute -top-3 left-1/2 flex -translate-x-1/2 -translate-y-full flex-col items-center">
                <div className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-900 shadow-md backdrop-blur-md">
                  <ShieldCheckIcon width={14} height={14} className="text-teal-600" />
                  <span>{faceLabel}</span>
                  {faceAlert && (
                    <span
                      title="Pasien memiliki catatan alergi"
                      className="ml-1 inline-flex items-center gap-0.5 rounded bg-rose-100 px-1 py-0.5 text-[10px] font-bold text-rose-700"
                    >
                      <AlertIcon width={10} height={10} />
                      Alergi
                    </span>
                  )}
                </div>
                {faceSubLabel && (
                  <span className="mt-1 rounded bg-slate-900/80 px-2 py-0.5 font-mono text-[10px] font-medium text-slate-300 backdrop-blur-sm">
                    {faceSubLabel}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Progress Tahan Posisi Wajah */}
      {!capturedImage && isReady && isValid && detection.holdProgress > 0 && (
        <div className="absolute inset-x-0 bottom-0 h-1.5 bg-slate-900/60 backdrop-blur-sm">
          <div
            className="h-full bg-gradient-to-r from-teal-400 to-emerald-400 transition-[width] duration-75"
            style={{ width: `${detection.holdProgress * 100}%` }}
          />
        </div>
      )}

      {/* State Kamera Standby / Error */}
      {!capturedImage && !isReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center bg-slate-950/90 backdrop-blur-sm">
          {camera.status === 'error' ? (
            <div className="max-w-xs space-y-2">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
                <AlertIcon width={20} height={20} />
              </div>
              <p className="text-sm font-semibold text-white">Kamera Tidak Dapat Diakses</p>
              <p className="text-xs leading-relaxed text-slate-400">
                {camera.error.message}
              </p>
              <button
                type="button"
                onClick={camera.retry}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 shadow-sm"
              >
                <RefreshIcon width={14} height={14} />
                Hubungkan Ulang Kamera
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-teal-400" />
              <p className="text-xs font-medium text-slate-300 tracking-wide">
                Menginisialisasi Kamera Biometrik…
              </p>
            </div>
          )}
        </div>
      )}

      {children}

      {/* Flash Effect on capture */}
      {isFlashing && (
        <div className="pointer-events-none absolute inset-0 bg-white/80 transition-opacity duration-200" />
      )}
    </div>
  );
}

export default CameraView;
