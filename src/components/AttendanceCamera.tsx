import { useEffect, useState } from 'react';
import {
  useAttendanceVerification,
  type RecognizedPerson,
} from '../hooks/useAttendanceVerification';
import { useFaceDetection } from '../hooks/useFaceDetection';
import { useFrameCapture } from '../hooks/useFrameCapture';
import { useWebCamera } from '../hooks/useWebCamera';
import { captureVideoFrame } from '../lib/video';
import { hasRealAllergy, POLIKLINIK_LIST } from '../lib/hospital';
import CameraView from './CameraView';
import { AlertIcon, PrinterIcon, RefreshIcon, ScanIcon } from './icons';

const AUTO_POLI = 'auto';

/* -------------------------------------------------------------------------- */

function EmptyState() {
  return (
    <div className="flex h-full min-h-[22rem] flex-col items-center justify-center rounded-3xl border border-dashed border-neutral-200 px-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-500">
        <ScanIcon width={22} height={22} />
      </div>
      <p className="mt-4 text-sm font-medium text-neutral-900">Belum ada pasien</p>
      <p className="mt-1 max-w-xs text-sm leading-6 text-neutral-500">
        Hadapkan wajah ke kamera dan tahan sebentar. Data pasien dan tiket antrean
        akan muncul di sini.
      </p>
    </div>
  );
}

function QueueTicketCard({
  patient,
  onNext,
}: {
  readonly patient: RecognizedPerson;
  readonly onNext: () => void;
}) {
  const ticket = patient.queueTicket;
  if (!ticket) {
    return null;
  }

  return (
    <div className="rounded-3xl bg-neutral-900 p-6 text-white">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs text-neutral-400">Nomor antrean</p>
          <p className="mt-1 text-5xl font-semibold tracking-tight">
            {ticket.queueNumber}
          </p>
        </div>
        <span className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
          Menunggu panggilan
        </span>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 border-t border-white/10 pt-5 text-sm">
        <div>
          <p className="text-xs text-neutral-400">Poliklinik</p>
          <p className="mt-0.5 font-medium">{ticket.poliklinik}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-400">Ruang</p>
          <p className="mt-0.5 font-medium">{ticket.room}</p>
        </div>
        <div className="col-span-2">
          <p className="text-xs text-neutral-400">Dokter</p>
          <p className="mt-0.5 font-medium">{ticket.dokter}</p>
        </div>
      </div>

      <div className="mt-6 flex gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 transition hover:bg-neutral-200"
        >
          <PrinterIcon width={16} height={16} />
          Cetak tiket
        </button>
        <button
          type="button"
          onClick={onNext}
          className="inline-flex flex-1 items-center justify-center rounded-full border border-white/15 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/10"
        >
          Pasien berikutnya
        </button>
      </div>
    </div>
  );
}

function PatientDetails({ patient }: { readonly patient: RecognizedPerson }) {
  const allergy = hasRealAllergy(patient.allergies);

  return (
    <div className="rounded-3xl border border-neutral-200 bg-white p-6">
      {/* Identitas */}
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-sm font-semibold text-neutral-700">
          {patient.fullName
            .split(' ')
            .slice(0, 2)
            .map((w) => w[0])
            .join('')
            .toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-neutral-900">
            {patient.fullName}
          </p>
          <p className="text-sm text-neutral-500">
            {patient.noRm} · {patient.gender} · {patient.age} th
          </p>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-3 gap-4 text-sm">
        <div>
          <dt className="text-xs text-neutral-500">Gol. darah</dt>
          <dd className="mt-0.5 font-medium text-neutral-900">{patient.bloodType}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Jaminan</dt>
          <dd className="mt-0.5 font-medium text-neutral-900">{patient.insurance}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Kecocokan</dt>
          <dd className="mt-0.5 font-medium text-neutral-900">
            {patient.similarity.toFixed(1)}%
          </dd>
        </div>
      </dl>

      {/* Alergi */}
      <div
        className={`mt-6 flex gap-3 rounded-2xl p-4 text-sm ${
          allergy ? 'bg-rose-50 text-rose-900' : 'bg-neutral-50 text-neutral-700'
        }`}
      >
        {allergy && <AlertIcon className="mt-0.5 shrink-0 text-rose-600" width={16} height={16} />}
        <div>
          <p className={`text-xs ${allergy ? 'text-rose-700' : 'text-neutral-500'}`}>
            Alergi
          </p>
          <p className="mt-0.5 font-medium">{patient.allergies}</p>
        </div>
      </div>

      <div className="mt-3 rounded-2xl bg-neutral-50 p-4 text-sm">
        <p className="text-xs text-neutral-500">Penyakit penyerta</p>
        <p className="mt-0.5 font-medium text-neutral-900">{patient.chronicConditions}</p>
      </div>

      {/* Riwayat */}
      <div className="mt-6">
        <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
          Riwayat berobat
        </p>
        {patient.medicalHistory.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">Belum ada riwayat kunjungan.</p>
        ) : (
          <ol className="mt-3 space-y-4 border-l border-neutral-200 pl-4">
            {patient.medicalHistory.map((item, idx) => (
              <li key={`${item.date}-${idx}`} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-neutral-300" />
                <p className="text-xs text-neutral-500">
                  {item.date} · {item.poliklinik}
                </p>
                <p className="mt-0.5 text-sm font-medium text-neutral-900">
                  {item.diagnosis}
                </p>
                <p className="mt-0.5 text-sm text-neutral-600">{item.treatment}</p>
                <p className="mt-0.5 text-xs text-neutral-400">{item.doctor}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function AttendanceCamera() {
  const frame = useFrameCapture();
  const verification = useAttendanceVerification();
  const [poli, setPoli] = useState<string>(AUTO_POLI);
  const camera = useWebCamera({ enabled: frame.image === null });

  const issueTicket = (image: string) => {
    void verification.submit(image, poli === AUTO_POLI ? undefined : poli);
  };

  const captureAndIssue = () => {
    const snap = frame.capture(camera.videoRef.current);
    if (snap) {
      verification.reset();
      issueTicket(snap);
    }
  };

  const detection = useFaceDetection({
    videoRef: camera.videoRef,
    enabled: camera.status === 'ready' && frame.image === null,
    onHoldComplete: captureAndIssue,
  });

  const hasFace = detection.trackingBox !== null;

  // Identifikasi ringan di latar belakang agar nama tampil di atas wajah.
  useEffect(() => {
    if (camera.status !== 'ready' || !hasFace) {
      return undefined;
    }
    const identify = () => {
      const snap = captureVideoFrame(camera.videoRef.current, 0.7);
      if (snap) {
        void verification.identifyLive(snap);
      }
    };
    identify();
    const id = window.setInterval(identify, 2500);
    return () => window.clearInterval(id);
  }, [camera.status, camera.videoRef, hasFace, verification.identifyLive]);

  const handleNext = () => {
    frame.discard();
    verification.reset();
    verification.clearLiveIdentity();
  };

  const live = verification.liveIdentity;
  const patient = verification.feedback?.person ?? (frame.image ? live : null);
  const error = verification.feedback?.type === 'error' ? verification.feedback.message : null;

  const statusText = (() => {
    if (frame.image) {
      if (verification.isSubmitting) return 'Mencocokkan wajah…';
      if (error) return error;
      if (patient?.queueTicket) return 'Tiket antrean diterbitkan';
      return 'Foto diambil';
    }
    if (camera.status !== 'ready') return 'Menyiapkan kamera';
    if (!hasFace) return 'Hadapkan wajah ke kamera';
    if (detection.faceStatus === 'valid') return 'Tahan posisi…';
    return detection.guidance;
  })();

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* Kamera */}
      <section className="space-y-4">
        <CameraView
          camera={camera}
          detection={detection}
          capturedImage={frame.image}
          isFlashing={frame.isFlashing}
          faceLabel={live ? live.fullName : null}
          faceSubLabel={live ? live.noRm : null}
          faceAlert={live ? hasRealAllergy(live.allergies) : false}
        >
          {frame.image && verification.isSubmitting && (
            <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/40 backdrop-blur-[2px]">
              <span className="h-7 w-7 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            </div>
          )}
        </CameraView>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p
            className={`flex items-center gap-2 text-sm ${
              error ? 'text-rose-600' : 'text-neutral-600'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                error
                  ? 'bg-rose-500'
                  : hasFace || frame.image
                    ? 'bg-emerald-500'
                    : 'bg-neutral-300'
              }`}
            />
            {statusText}
          </p>

          <div className="flex items-center gap-2">
            <select
              value={poli}
              onChange={(e) => setPoli(e.target.value)}
              aria-label="Poliklinik tujuan"
              className="h-10 rounded-full border border-neutral-200 bg-white px-4 text-sm text-neutral-700 outline-none transition focus:border-neutral-400"
            >
              <option value={AUTO_POLI}>Poli sesuai riwayat</option>
              {POLIKLINIK_LIST.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            {frame.image ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={verification.isSubmitting}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-800 transition hover:bg-neutral-50 disabled:opacity-50"
              >
                <RefreshIcon width={15} height={15} />
                Scan ulang
              </button>
            ) : (
              <button
                type="button"
                onClick={captureAndIssue}
                disabled={camera.status !== 'ready'}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-neutral-900 px-5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-40"
              >
                <ScanIcon width={15} height={15} />
                Scan sekarang
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Panel pasien */}
      <section className="space-y-4">
        {patient ? (
          <>
            <QueueTicketCard patient={patient} onNext={handleNext} />
            <PatientDetails patient={patient} />
          </>
        ) : (
          <EmptyState />
        )}
      </section>
    </div>
  );
}

export default AttendanceCamera;
