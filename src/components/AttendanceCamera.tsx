import { useCallback, useEffect, useState } from 'react';
import {
  useAttendanceVerification,
  type RecognizedPerson,
} from '../hooks/useAttendanceVerification';
import { useFaceDetection } from '../hooks/useFaceDetection';
import { useFrameCapture } from '../hooks/useFrameCapture';
import { useWebCamera } from '../hooks/useWebCamera';
import { captureVideoFrame } from '../lib/video';
import {
  advancePoliQueue,
  DEFAULT_POLI_QUEUES,
  fetchPoliQueues,
  hasRealAllergy,
  POLIKLINIK_LIST,
  type PoliQueueSnapshot,
} from '../lib/hospital';
import CameraView from './CameraView';
import {
  ActivityIcon,
  AlertIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  FileTextIcon,
  PrinterIcon,
  RefreshIcon,
  ScanIcon,
  ShieldCheckIcon,
  StethoscopeIcon,
  TicketIcon,
  UsersIcon,
} from './icons';

const AUTO_POLI = 'auto';

/* -------------------------------------------------------------------------- */
/*  Papan Informasi Antrean Poliklinik Real-Time                              */
/* -------------------------------------------------------------------------- */

function LiveQueueBoard({
  queues,
  activePoliName,
  onSelectPoli,
  onAdvanceQueue,
  isAdvancing,
}: {
  readonly queues: readonly PoliQueueSnapshot[];
  readonly activePoliName: string;
  readonly onSelectPoli: (poli: string) => void;
  readonly onAdvanceQueue: (poli: string) => void;
  readonly isAdvancing: boolean;
}) {
  const currentPoli =
    queues.find((q) => q.poliklinik === activePoliName) ??
    queues[0] ??
    DEFAULT_POLI_QUEUES[0];

  const canAdvance =
    currentPoli.currentServingSequence < currentPoli.latestQueueSequence;

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-card">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-900 px-5 py-3 text-white">
        <div className="flex items-center gap-2.5">
          <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
            Monitor Antrean Poliklinik Real-Time
          </span>
          <span className="hidden sm:inline-block rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-teal-300 border border-slate-700">
            {currentPoli.room} · {currentPoli.dokter}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={currentPoli.poliklinik}
            onChange={(e) => onSelectPoli(e.target.value)}
            aria-label="Pilih Poliklinik Monitor"
            className="h-8 rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-xs font-semibold text-white outline-none transition focus:border-teal-400"
          >
            {queues.map((q) => (
              <option key={q.poliklinik} value={q.poliklinik}>
                {q.poliklinik} ({q.currentServingNumber})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => onAdvanceQueue(currentPoli.poliklinik)}
            disabled={!canAdvance || isAdvancing}
            title={
              canAdvance
                ? 'Simulasi dokter memanggil nomor antrean berikutnya'
                : 'Semua antrean yang diterbitkan sedang dilayani'
            }
            className="inline-flex h-8 items-center gap-1 rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white transition hover:bg-teal-500 disabled:opacity-40"
          >
            <span>Panggil Berikutnya</span>
            <ChevronRightIcon width={13} height={13} />
          </button>
        </div>
      </div>

      {/* 4 Live Queue Metrics */}
      <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-4 sm:divide-y-0">
        {/* Metric 1: Sedang Dilayani */}
        <div className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Sedang Dilayani
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200/60">
              Di Ruang Poli
            </span>
          </div>
          <p className="mt-1.5 font-mono text-2xl font-extrabold tracking-tight text-slate-900">
            {currentPoli.currentServingNumber}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 truncate">
            {currentPoli.poliklinik}
          </p>
        </div>

        {/* Metric 2: Antrean Terbaru */}
        <div className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Antrean Terbaru
            </span>
            <TicketIcon width={14} height={14} className="text-teal-600" />
          </div>
          <p className="mt-1.5 font-mono text-2xl font-extrabold tracking-tight text-teal-700">
            {currentPoli.latestQueueNumber}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Nomor terakhir diterbitkan
          </p>
        </div>

        {/* Metric 3: Total Pasien Menunggu */}
        <div className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Sisa Antrean Poli
            </span>
            <UsersIcon width={14} height={14} className="text-slate-400" />
          </div>
          <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-slate-900">
            {currentPoli.totalWaiting}{' '}
            <span className="text-sm font-semibold text-slate-500">Pasien</span>
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Menunggu panggilan dokter
          </p>
        </div>

        {/* Metric 4: Estimasi Waktu Tunggu */}
        <div className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Estimasi Tunggu Baru
            </span>
            <ClockIcon width={14} height={14} className="text-slate-400" />
          </div>
          <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-slate-900">
            ± {currentPoli.estimatedWaitMinutes + 8}{' '}
            <span className="text-sm font-semibold text-slate-500">Menit</span>
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Rata-rata 8 menit / pasien
          </p>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Empty State (Saat Belum Ada Pasien yang Di-scan)                          */
/* -------------------------------------------------------------------------- */

function EmptyState({
  activePoliQueue,
}: {
  readonly activePoliQueue: PoliQueueSnapshot;
}) {
  const nextNumber = `${activePoliQueue.prefix}-${String(
    activePoliQueue.latestQueueSequence + 1,
  ).padStart(3, '0')}`;
  const waitingForNext = Math.max(
    0,
    activePoliQueue.latestQueueSequence + 1 - activePoliQueue.currentServingSequence,
  );

  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 shadow-card">
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-teal-200/80 bg-teal-50/80 text-teal-700 shadow-sm">
          <ScanIcon width={26} height={26} />
        </div>
        <h3 className="mt-4 text-base font-bold text-slate-900">
          Siap Memindai Identitas Wajah Pasien
        </h3>
        <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-slate-500">
          Arahkan wajah pasien ke kamera. Sistem secara otomatis mencocokkan biometrik wajah dengan Rekam Medis Elektronik (RME) dan menerbitkan tiket antrean poliklinik.
        </p>
      </div>

      {/* Preview Estimasi Antrean Berikutnya */}
      <div className="rounded-xl border border-slate-200/80 bg-slate-50/90 p-4">
        <div className="flex items-center justify-between border-b border-slate-200/70 pb-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Estimasi Tiket Berikutnya ({activePoliQueue.poliklinik})
            </p>
            <p className="mt-0.5 text-xs text-slate-600">
              {activePoliQueue.dokter} · {activePoliQueue.room}
            </p>
          </div>
          <span className="rounded-lg bg-slate-900 px-3 py-1 font-mono text-sm font-bold text-white">
            {nextNumber}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-white p-2.5 border border-slate-200/60">
            <span className="block text-[10px] font-semibold uppercase text-slate-400">
              Sedang Dilayani
            </span>
            <span className="mt-0.5 block font-mono text-sm font-bold text-emerald-700">
              {activePoliQueue.currentServingNumber}
            </span>
          </div>
          <div className="rounded-lg bg-white p-2.5 border border-slate-200/60">
            <span className="block text-[10px] font-semibold uppercase text-slate-400">
              Antrean Menunggu
            </span>
            <span className="mt-0.5 block font-bold text-slate-800">
              {waitingForNext} Pasien Lagi
            </span>
          </div>
          <div className="rounded-lg bg-white p-2.5 border border-slate-200/60">
            <span className="block text-[10px] font-semibold uppercase text-slate-400">
              Perkiraan Tunggu
            </span>
            <span className="mt-0.5 block font-bold text-slate-800">
              ± {waitingForNext * 8} Menit
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Kartu Tiket Antrean Pasien (Dengan Informasi Sisa Antrean Real-time)      */
/* -------------------------------------------------------------------------- */

function QueueTicketCard({
  patient,
  livePoliQueue,
  onAdvanceQueue,
  isAdvancing,
  onNext,
}: {
  readonly patient: RecognizedPerson;
  readonly livePoliQueue?: PoliQueueSnapshot;
  readonly onAdvanceQueue: (poli: string) => void;
  readonly isAdvancing: boolean;
  readonly onNext: () => void;
}) {
  const ticket = patient.queueTicket;
  if (!ticket) {
    return null;
  }

  // Sinkronkan dengan counter antrean terbaru dari livePoliQueue jika tersedia
  const currentServingSeq =
    livePoliQueue?.currentServingSequence ?? ticket.currentServingSequence;
  const currentServingNumber =
    livePoliQueue?.currentServingNumber ?? ticket.currentServingNumber;
  const latestQueueNumber =
    livePoliQueue?.latestQueueNumber ?? ticket.latestQueueNumber;

  const patientsAhead = Math.max(0, ticket.queueSequence - currentServingSeq);
  const estimatedWaitMinutes = patientsAhead * 8;
  const isTurnNow = patientsAhead === 0;

  return (
    <div
      id="printable-queue-ticket"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card"
    >
      {/* Top Banner Tiket */}
      <div className="flex items-center justify-between bg-slate-900 px-5 py-3.5 text-white">
        <div className="flex items-center gap-2">
          <TicketIcon width={16} height={16} className="text-teal-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-slate-100">
            Tiket Antrean Poliklinik Resmi
          </span>
        </div>
        <span className="font-mono text-[11px] text-slate-400">
          {ticket.ticketId}
        </span>
      </div>

      {/* Main Queue Numbers & Waiting Comparison */}
      <div className="p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {/* Kolom 1: Nomor Antrean Pasien */}
          <div className="rounded-xl border-2 border-teal-600 bg-teal-50/50 p-3.5">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-teal-800">
              Nomor Antrean Anda
            </span>
            <p className="mt-1 font-mono text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              {ticket.queueNumber}
            </p>
            <span className="mt-1 inline-block text-[11px] font-semibold text-teal-700">
              Pasien: {patient.noRm}
            </span>
          </div>

          {/* Kolom 2: Nomor Sedang Dilayani Saat Ini */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Sedang Dilayani
              </span>
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <p className="mt-1 font-mono text-2xl font-extrabold tracking-tight text-slate-800 sm:text-3xl">
              {currentServingNumber}
            </p>
            <span className="mt-1 block text-[11px] text-slate-500">
              Terbaru: <strong className="font-mono">{latestQueueNumber}</strong>
            </span>
          </div>

          {/* Kolom 3: Berapa Pasien Lagi */}
          <div
            className={`col-span-2 sm:col-span-1 rounded-xl border p-3.5 ${
              isTurnNow
                ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
                : 'border-amber-200 bg-amber-50/70 text-amber-950'
            }`}
          >
            <span
              className={`block text-[10px] font-bold uppercase tracking-wider ${
                isTurnNow ? 'text-emerald-700' : 'text-amber-800'
              }`}
            >
              Status Tunggu Anda
            </span>
            {isTurnNow ? (
              <>
                <p className="mt-1 text-lg font-extrabold leading-tight text-emerald-800">
                  Giliran Anda!
                </p>
                <span className="mt-1 block text-[11px] font-semibold text-emerald-700">
                  Silakan masuk ke ruang poli
                </span>
              </>
            ) : (
              <>
                <p className="mt-1 text-2xl font-extrabold tracking-tight text-amber-900">
                  {patientsAhead}{' '}
                  <span className="text-sm font-bold">Pasien Lagi</span>
                </p>
                <span className="mt-1 block text-[11px] font-semibold text-amber-800">
                  Est. tunggu ± {estimatedWaitMinutes} menit
                </span>
              </>
            )}
          </div>
        </div>

        {/* Highlight Callout Box Informasi Antrean */}
        <div
          className={`mt-3.5 flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-2.5 text-xs ${
            isTurnNow
              ? 'bg-emerald-600 text-white font-semibold'
              : 'bg-slate-900 text-slate-100'
          }`}
        >
          <div className="flex items-center gap-2">
            <ClockIcon width={15} height={15} className="shrink-0 text-teal-300" />
            {isTurnNow ? (
              <span>
                Nomor antrean <strong>{ticket.queueNumber}</strong> sedang dipanggil di{' '}
                <strong>{ticket.room}</strong>.
              </span>
            ) : (
              <span>
                Saat ini poli melayani nomor{' '}
                <strong className="font-mono text-teal-300 underline decoration-teal-500/50">
                  {currentServingNumber}
                </strong>
                . Anda menunggu <strong>{patientsAhead} pasien lagi</strong> sebelum dipanggil.
              </span>
            )}
          </div>

          {!isTurnNow && (
            <button
              type="button"
              onClick={() => onAdvanceQueue(ticket.poliklinik)}
              disabled={isAdvancing}
              className="no-print rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-teal-200 transition hover:bg-white/20"
            >
              Simulasi Panggil (+1)
            </button>
          )}
        </div>

        {/* Rincian Poliklinik & Dokter */}
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-dashed border-slate-200 pt-4 text-xs sm:grid-cols-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Poliklinik Tujuan
            </p>
            <p className="mt-0.5 font-bold text-slate-900">{ticket.poliklinik}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Lokasi Ruang
            </p>
            <p className="mt-0.5 font-bold text-slate-900">{ticket.room}</p>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Dokter Pemeriksa
            </p>
            <p className="mt-0.5 font-bold text-teal-800">{ticket.dokter}</p>
          </div>
        </div>

        {/* Tombol Aksi */}
        <div className="no-print mt-5 flex items-center gap-2.5 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800"
          >
            <PrinterIcon width={15} height={15} />
            Cetak Slip Antrean
          </button>
          <button
            type="button"
            onClick={onNext}
            className="inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
          >
            Selesai / Pasien Berikutnya
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Panel Rekam Medis Elektronik (RME) Pasien                                 */
/* -------------------------------------------------------------------------- */

function PatientDetails({ patient }: { readonly patient: RecognizedPerson }) {
  const allergy = hasRealAllergy(patient.allergies);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-card">
      {/* Header Identitas Rekam Medis */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-teal-200 bg-teal-50 font-mono text-sm font-bold text-teal-800">
            {patient.fullName
              .split(' ')
              .slice(0, 2)
              .map((w) => w[0])
              .join('')
              .toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold text-slate-900 sm:text-base">
                {patient.fullName}
              </h4>
              <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] font-bold text-slate-700">
                {patient.noRm}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              NIK: <span className="font-mono">{patient.nik || '-'}</span> ·{' '}
              {patient.gender} · {patient.age} Tahun
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200/80 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
          <ShieldCheckIcon width={14} height={14} className="text-emerald-600" />
          <span>Biometrik {patient.similarity.toFixed(1)}%</span>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Demografi & Jaminan */}
        <div className="grid grid-cols-3 gap-2.5 text-xs">
          <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-2.5">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Gol. Darah
            </span>
            <span className="mt-0.5 block font-mono text-sm font-bold text-slate-800">
              {patient.bloodType || '-'}
            </span>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-2.5">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Jaminan Kesehatan
            </span>
            <span className="mt-0.5 block font-bold text-slate-800 truncate">
              {patient.insurance || 'Umum'}
            </span>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-2.5">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Poli Terdaftar
            </span>
            <span className="mt-0.5 block font-bold text-slate-800 truncate">
              {patient.poliklinik}
            </span>
          </div>
        </div>

        {/* Alergi & Komorbiditas */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div
            className={`rounded-xl border p-3 text-xs ${
              allergy
                ? 'border-rose-200 bg-rose-50/80 text-rose-950'
                : 'border-slate-200/80 bg-slate-50/60 text-slate-700'
            }`}
          >
            <div className="flex items-center gap-1.5 font-bold">
              {allergy ? (
                <AlertIcon width={14} height={14} className="text-rose-600 shrink-0" />
              ) : (
                <CheckIcon width={14} height={14} className="text-emerald-600 shrink-0" />
              )}
              <span className={allergy ? 'text-rose-800' : 'text-slate-700'}>
                Catatan Alergi Obat / Makanan
              </span>
            </div>
            <p className={`mt-1 font-medium ${allergy ? 'text-rose-700' : 'text-slate-500'}`}>
              {patient.allergies || 'Tidak Ada Alergi'}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-slate-700">
              <ActivityIcon width={14} height={14} className="text-teal-600 shrink-0" />
              <span>Penyakit Penyerta (Komorbid)</span>
            </div>
            <p className="mt-1 font-medium text-slate-600">
              {patient.chronicConditions || 'Tidak Ada'}
            </p>
          </div>
        </div>

        {/* Riwayat Rekam Medis */}
        <div className="border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between mb-2.5">
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
              <FileTextIcon width={14} height={14} className="text-slate-400" />
              Riwayat Kunjungan & Diagnosis
            </span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
              {patient.medicalHistory.length} Kunjungan
            </span>
          </div>

          {patient.medicalHistory.length === 0 ? (
            <p className="rounded-xl bg-slate-50 p-3 text-center text-xs text-slate-500">
              Belum ada riwayat pemeriksaan sebelumnya.
            </p>
          ) : (
            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {patient.medicalHistory.map((item, idx) => (
                <div
                  key={`${item.date}-${idx}`}
                  className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3 text-xs"
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono font-bold text-slate-700">
                      {item.date}
                    </span>
                    <span className="rounded bg-white px-2 py-0.5 font-semibold text-teal-800 border border-slate-200/80">
                      {item.poliklinik}
                    </span>
                  </div>
                  <p className="mt-1 font-bold text-slate-900">{item.diagnosis}</p>
                  <p className="mt-0.5 text-slate-600">{item.treatment}</p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    DPJP: <span className="font-medium text-slate-600">{item.doctor}</span>
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Komponen Utama Pemindai & Antrean                                         */
/* -------------------------------------------------------------------------- */

function AttendanceCamera() {
  const frame = useFrameCapture();
  const verification = useAttendanceVerification();
  const [poli, setPoli] = useState<string>(AUTO_POLI);
  const [queues, setQueues] = useState<readonly PoliQueueSnapshot[]>(
    DEFAULT_POLI_QUEUES,
  );
  const [monitorPoli, setMonitorPoli] = useState<string>('Poli Penyakit Dalam');
  const [isAdvancing, setIsAdvancing] = useState(false);

  const camera = useWebCamera({ enabled: frame.image === null });

  const refreshQueues = useCallback(async () => {
    const data = await fetchPoliQueues();
    setQueues(data);
  }, []);

  useEffect(() => {
    void refreshQueues();
    const id = window.setInterval(() => {
      void refreshQueues();
    }, 5000);
    return () => window.clearInterval(id);
  }, [refreshQueues]);

  const issueTicket = async (image: string) => {
    await verification.submit(image, poli === AUTO_POLI ? undefined : poli);
    await refreshQueues();
  };

  const captureAndIssue = () => {
    const snap = frame.capture(camera.videoRef.current);
    if (snap) {
      verification.reset();
      void issueTicket(snap);
    }
  };

  const detection = useFaceDetection({
    videoRef: camera.videoRef,
    enabled: camera.status === 'ready' && frame.image === null,
    onHoldComplete: captureAndIssue,
  });

  const hasFace = detection.trackingBox !== null;

  // Identifikasi ringan di latar belakang agar nama tampil di atas wajah
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

  const live = verification.liveIdentity;
  const patient = verification.feedback?.person ?? (frame.image ? live : null);
  const error =
    verification.feedback?.type === 'error'
      ? verification.feedback.message
      : null;

  // Otomatis arahkan monitor poli ke poli pasien yang terdeteksi atau dipilih
  const effectivePoliName =
    patient?.queueTicket?.poliklinik ??
    (poli !== AUTO_POLI ? poli : live?.poliklinik ?? monitorPoli);

  const activePoliQueue =
    queues.find((q) => q.poliklinik === effectivePoliName) ??
    queues[0] ??
    DEFAULT_POLI_QUEUES[0];

  const handleAdvanceQueue = async (targetPoli: string) => {
    setIsAdvancing(true);
    const updated = await advancePoliQueue(targetPoli);
    if (updated) {
      setQueues(updated);
    } else {
      await refreshQueues();
    }
    setIsAdvancing(false);
  };

  const handleNext = () => {
    frame.discard();
    verification.reset();
    verification.clearLiveIdentity();
    void refreshQueues();
  };

  const statusText = (() => {
    if (frame.image) {
      if (verification.isSubmitting) return 'Memverifikasi biometrik wajah…';
      if (error) return error;
      if (patient?.queueTicket) return 'Terverifikasi · Tiket antrean diterbitkan';
      return 'Citra wajah berhasil ditangkap';
    }
    if (camera.status !== 'ready') return 'Menyiapkan perangkat kamera…';
    if (!hasFace) return 'Posisikan wajah menghadap kamera';
    if (detection.faceStatus === 'valid') return 'Tahan posisi wajah sebentar…';
    return detection.guidance;
  })();

  return (
    <div>
      {/* Papan Monitor Antrean Poliklinik */}
      <LiveQueueBoard
        queues={queues}
        activePoliName={effectivePoliName}
        onSelectPoli={(selected) => {
          setMonitorPoli(selected);
        }}
        onAdvanceQueue={(target) => void handleAdvanceQueue(target)}
        isAdvancing={isAdvancing}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start">
        {/* Kolom Kiri: Terminal Kamera Biometrik */}
        <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-card space-y-4">
          {/* Header Terminal Kamera */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <StethoscopeIcon width={16} height={16} className="text-teal-700" />
              <span className="text-xs font-bold text-slate-800">
                Terminal Pemindai Biometrik Pasien
              </span>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="poli-select" className="text-[11px] font-semibold text-slate-500">
                Tujuan:
              </label>
              <select
                id="poli-select"
                value={poli}
                onChange={(e) => {
                  setPoli(e.target.value);
                  if (e.target.value !== AUTO_POLI) {
                    setMonitorPoli(e.target.value);
                  }
                }}
                className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-700 outline-none transition focus:border-teal-600 focus:bg-white"
              >
                <option value={AUTO_POLI}>Otomatis Sesuai Riwayat Poli</option>
                {POLIKLINIK_LIST.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <CameraView
            camera={camera}
            detection={detection}
            capturedImage={frame.image}
            isFlashing={frame.isFlashing}
            faceLabel={live ? live.fullName : null}
            faceSubLabel={live ? `${live.noRm} · ${live.poliklinik}` : null}
            faceAlert={live ? hasRealAllergy(live.allergies) : false}
          >
            {frame.image && verification.isSubmitting && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/60 backdrop-blur-sm">
                <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-teal-400" />
                <p className="text-xs font-semibold text-white">
                  Mencocokkan Biometrik & Menerbitkan Nomor Antrean…
                </p>
              </div>
            )}
          </CameraView>

          {/* Footer Kontrol Kamera */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  error
                    ? 'bg-rose-500 ring-4 ring-rose-100'
                    : hasFace || frame.image
                      ? 'bg-emerald-500 ring-4 ring-emerald-100'
                      : 'bg-slate-300'
                }`}
              />
              <span
                className={`text-xs font-semibold ${
                  error ? 'text-rose-600' : 'text-slate-700'
                }`}
              >
                {statusText}
              </span>
            </div>

            {frame.image ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={verification.isSubmitting}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshIcon width={14} height={14} />
                Pindai Pasien Lain
              </button>
            ) : (
              <button
                type="button"
                onClick={captureAndIssue}
                disabled={camera.status !== 'ready'}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-40"
              >
                <ScanIcon width={14} height={14} />
                Verifikasi & Ambil Antrean
              </button>
            )}
          </div>
        </section>

        {/* Kolom Kanan: Tiket Antrean & Rekam Medis Pasien */}
        <section className="space-y-4">
          {patient ? (
            <>
              <QueueTicketCard
                patient={patient}
                livePoliQueue={activePoliQueue}
                onAdvanceQueue={(target) => void handleAdvanceQueue(target)}
                isAdvancing={isAdvancing}
                onNext={handleNext}
              />
              <PatientDetails patient={patient} />
            </>
          ) : (
            <EmptyState activePoliQueue={activePoliQueue} />
          )}
        </section>
      </div>
    </div>
  );
}

export default AttendanceCamera;
