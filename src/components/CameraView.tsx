import type { ReactNode } from 'react';
import type { FaceDetectionResult } from '../hooks/useFaceDetection';
import type { UseWebCameraResult } from '../hooks/useWebCamera';
import { AlertIcon, RefreshIcon, ShieldCheckIcon } from './icons';

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

/** Tampilan kamera minimalis dengan indikator Liveness Detection (Anti-Spoofing). */
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
  const liveness = detection.livenessStatus;

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-neutral-950 ring-1 ring-black/5">
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

      {/* Top Minimal Status & Liveness Bar */}
      <div className="pointer-events-none absolute left-3.5 right-3.5 top-3.5 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium text-white/90 backdrop-blur-md">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              capturedImage
                ? 'bg-amber-400'
                : isReady
                  ? 'bg-emerald-400'
                  : 'bg-rose-400'
            }`}
          />
          <span>
            {capturedImage
              ? 'Foto Tersimpan'
              : isReady
                ? 'Kamera Aktif'
                : 'Menyiapkan…'}
          </span>
        </div>

        {/* Liveness Anti-Spoofing Indicator */}
        {!capturedImage && isReady && box && (
          <div
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium backdrop-blur-md transition ${
              liveness === 'verified'
                ? 'bg-emerald-950/75 text-emerald-300 ring-1 ring-emerald-400/30'
                : liveness === 'spoof_warning'
                  ? 'bg-rose-950/80 text-rose-200 ring-1 ring-rose-400/40'
                  : 'bg-black/55 text-neutral-300'
            }`}
          >
            <ShieldCheckIcon width={13} height={13} />
            <span>
              {liveness === 'verified'
                ? `Liveness Live · ${detection.livenessScore.toFixed(0)}%`
                : liveness === 'spoof_warning'
                  ? 'Anti-Spoofing: Gerakkan Wajah'
                  : 'Cek Liveness Biometrik…'}
            </span>
          </div>
        )}
      </div>

      {/* Kotak tracking wajah minimalis */}
      {!capturedImage && isReady && box && (
        <div className="pointer-events-none absolute inset-0">
          <div
            className={`absolute rounded-2xl border transition-all duration-100 ease-out ${
              liveness === 'spoof_warning'
                ? 'border-rose-400/90'
                : isValid
                  ? 'border-emerald-400/90 shadow-[0_0_0_1px_rgba(52,211,153,0.25)]'
                  : 'border-white/60'
            }`}
            style={{
              left: `${100 - box.leftPct - box.widthPct}%`,
              top: `${box.topPct}%`,
              width: `${box.widthPct}%`,
              height: `${box.heightPct}%`,
            }}
          >
            {/* Floating identity tag */}
            {faceLabel && (
              <div className="absolute -top-2.5 left-1/2 flex -translate-x-1/2 -translate-y-full flex-col items-center">
                <div className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white/95 px-3 py-1 text-xs font-medium text-neutral-900 shadow-sm backdrop-blur-md">
                  <span>{faceLabel}</span>
                  {faceAlert && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                      <AlertIcon width={10} height={10} />
                      Alergi
                    </span>
                  )}
                </div>
                {faceSubLabel && (
                  <span className="mt-1 rounded-full bg-black/65 px-2.5 py-0.5 font-mono text-[10px] text-neutral-200 backdrop-blur-sm">
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
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
          <div
            className="h-full bg-emerald-400 transition-[width] duration-75"
            style={{ width: `${detection.holdProgress * 100}%` }}
          />
        </div>
      )}

      {/* State Kamera Standby / Error */}
      {!capturedImage && !isReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950 px-8 text-center">
          {camera.status === 'error' ? (
            <div className="max-w-xs space-y-2.5">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-rose-500/10 text-rose-400">
                <AlertIcon width={18} height={18} />
              </div>
              <p className="text-sm font-medium text-white">
                Kamera tidak dapat diakses
              </p>
              <p className="text-xs leading-relaxed text-neutral-400">
                {camera.error.message}
              </p>
              <button
                type="button"
                onClick={camera.retry}
                className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-white/20"
              >
                <RefreshIcon width={13} height={13} />
                Coba lagi
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-neutral-700 border-t-white" />
              <p className="text-xs text-neutral-400">Menyiapkan kamera…</p>
            </div>
          )}
        </div>
      )}

      {children}

      {isFlashing && (
        <div className="pointer-events-none absolute inset-0 bg-white/75 transition-opacity duration-200" />
      )}
    </div>
  );
}

export default CameraView;
