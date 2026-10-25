import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  useAttendanceVerification,
  type MedicalHistoryItem,
  type RecognizedPerson,
} from '../hooks/useAttendanceVerification';
import { useFaceDetection } from '../hooks/useFaceDetection';
import { useFrameCapture } from '../hooks/useFrameCapture';
import { useWebCamera } from '../hooks/useWebCamera';
import { captureVideoFrame } from '../lib/video';
import {
  addMedicalRecord,
  advancePoliQueue,
  DEFAULT_POLI_QUEUES,
  fetchPoliQueues,
  hasRealAllergy,
  POLIKLINIK_LIST,
  speakQueueCall,
  type PoliQueueSnapshot,
  type QueueControlAction,
} from '../lib/hospital';
import CameraView from './CameraView';
import {
  formatIcd10Diagnosis,
  parseIcd10FromText,
  searchIcd10Catalog,
  type Icd10Entry,
} from '../lib/icd10';
import {
  buildSatusehatFhirBundle,
  downloadSatusehatFhirJson,
} from '../lib/satusehat';
import {
  AlertIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  DownloadIcon,
  FileTextIcon,
  HospitalIcon,
  PlusIcon,
  PrinterIcon,
  RefreshIcon,
  ScanIcon,
  SearchIcon,
  ShieldCheckIcon,
  StethoscopeIcon,
  TvIcon,
  VolumeIcon,
} from './icons';

const AUTO_POLI = 'auto';
export type ViewRoleMode = 'kiosk' | 'doctor' | 'tv';

/* -------------------------------------------------------------------------- */
/*  Generator QR Code & Barcode SVG Deterministik untuk Struk Thermal         */
/* -------------------------------------------------------------------------- */

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function ThermalQrCodeSvg({ value }: { readonly value: string }) {
  const size = 21;
  const cells: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );

  const drawFinder = (r0: number, c0: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        cells[r0 + r]![c0 + c] = isBorder || isInner;
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  let seed = hashString(value);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const inFinder =
        (r < 8 && c < 8) ||
        (r < 8 && c >= size - 8) ||
        (r >= size - 8 && c < 8);
      if (inFinder) continue;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      cells[r]![c] = (seed & 3) !== 0;
    }
  }

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width="88"
      height="88"
      shapeRendering="crispEdges"
      aria-label="QR Code Tiket Antrean"
      className="mx-auto block"
    >
      {cells.map((row, r) =>
        row.map((filled, c) =>
          filled ? (
            <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill="#000" />
          ) : null,
        ),
      )}
    </svg>
  );
}

function ThermalBarcodeSvg({ value }: { readonly value: string }) {
  const bars: { x: number; w: number }[] = [];
  let x = 2;
  let seed = hashString(value);
  for (let i = 0; i < 34; i++) {
    seed = (Math.imul(seed, 22695477) + 1) >>> 0;
    const w = (seed % 3) + 1;
    const gap = ((seed >>> 4) % 2) + 1;
    bars.push({ x, w });
    x += w + gap;
  }

  return (
    <svg
      viewBox={`0 0 ${x + 2} 28`}
      width="180"
      height="28"
      shapeRendering="crispEdges"
      aria-label="Barcode Tiket"
      className="mx-auto block"
    >
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={28} fill="#000" />
      ))}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Struk Cetak Thermal 58mm/80mm (Hanya Tampil Saat @media print)            */
/* -------------------------------------------------------------------------- */

function ThermalPrintReceipt({
  patient,
  livePoliQueue,
}: {
  readonly patient: RecognizedPerson;
  readonly livePoliQueue?: PoliQueueSnapshot;
}) {
  const ticket = patient.queueTicket;
  if (!ticket) return null;

  const currentServingSeq =
    livePoliQueue?.currentServingSequence ?? ticket.currentServingSequence;
  const currentServingNumber =
    livePoliQueue?.currentServingNumber ?? ticket.currentServingNumber;
  const patientsAhead = Math.max(0, ticket.queueSequence - currentServingSeq);
  const qrPayload = `SIMRS|${ticket.ticketId}|${ticket.queueNumber}|${patient.noRm}`;
  const issuedDate = new Date(ticket.issuedAt || Date.now());
  const formattedTime = issuedDate.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div id="thermal-print-receipt" aria-hidden="true">
      <div style={{ textAlign: 'center', borderBottom: '1px dashed #000', paddingBottom: '6px' }}>
        <div style={{ fontSize: '12px', fontWeight: 700 }}>RSUD SIMRS BIOMETRIK</div>
        <div style={{ fontSize: '9px' }}>Instalasi Rawat Jalan Terpadu</div>
        <div style={{ fontSize: '9px' }}>{formattedTime} WIB</div>
      </div>

      <div style={{ textAlign: 'center', padding: '10px 0', borderBottom: '1px dashed #000' }}>
        <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Nomor Antrean Poliklinik
        </div>
        <div style={{ fontSize: '34px', fontWeight: 800, lineHeight: 1.15, margin: '4px 0' }}>
          {ticket.queueNumber}
        </div>
        <div style={{ fontSize: '10px', fontWeight: 700 }}>{ticket.poliklinik}</div>
        <div style={{ fontSize: '9px' }}>{ticket.room}</div>
        <div style={{ fontSize: '9px' }}>{ticket.dokter}</div>
      </div>

      <div style={{ fontSize: '9px', padding: '8px 0', borderBottom: '1px dashed #000', lineHeight: 1.5 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Pasien:</span>
          <strong>{patient.fullName}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>No. RM:</span>
          <strong>{patient.noRm}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Tgl Lahir:</span>
          <span>{patient.birthDate || '-'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Jaminan:</span>
          <span>{patient.insurance}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Alergi:</span>
          <strong>{patient.allergies}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
          <span>Sedang Dilayani:</span>
          <strong>{currentServingNumber}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Sisa Antrean:</span>
          <strong>
            {patientsAhead === 0
              ? 'Giliran Anda Sekarang'
              : `${patientsAhead} pasien (±${patientsAhead * 8} mnt)`}
          </strong>
        </div>
      </div>

      <div style={{ textAlign: 'center', paddingTop: '8px' }}>
        <ThermalQrCodeSvg value={qrPayload} />
        <div style={{ marginTop: '6px' }}>
          <ThermalBarcodeSvg value={ticket.ticketId} />
        </div>
        <div style={{ fontSize: '8px', marginTop: '3px' }}>
          ID: {ticket.ticketId} · Biometrik {patient.similarity.toFixed(1)}%
        </div>
        <div style={{ fontSize: '8px', marginTop: '4px' }}>
          Harap tunjukkan struk ini saat dipanggil ke ruang poli.
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Panel Panggil Antrean + Suara Otomatis (Text-to-Speech) Minimalis         */
/* -------------------------------------------------------------------------- */

function MinimalQueuePanel({
  queues,
  activePoliName,
  onSelectPoli,
  onQueueAction,
  isAdvancing,
  lastSpokenText,
  allowStaffControls,
}: {
  readonly queues: readonly PoliQueueSnapshot[];
  readonly activePoliName: string;
  readonly onSelectPoli: (poli: string) => void;
  readonly onQueueAction: (poli: string, action: QueueControlAction) => void;
  readonly isAdvancing: boolean;
  readonly lastSpokenText: string | null;
  readonly allowStaffControls: boolean;
}) {
  const currentPoli =
    queues.find((q) => q.poliklinik === activePoliName) ??
    queues[0] ??
    DEFAULT_POLI_QUEUES[0];

  const canAdvance =
    currentPoli.currentServingSequence < currentPoli.latestQueueSequence;
  const servingStatus = currentPoli.servingStatus ?? 'DIPANGGIL';

  return (
    <div className="no-print mb-6 rounded-2xl border border-neutral-200/80 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-xs font-semibold text-neutral-900">
            {allowStaffControls
              ? 'Panel Kontrol Antrean Dokter & Petugas'
              : 'Informasi Antrean Poliklinik Saat Ini'}
          </span>
          <select
            value={currentPoli.poliklinik}
            onChange={(e) => onSelectPoli(e.target.value)}
            aria-label="Pilih Poliklinik"
            className="h-8 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 text-xs font-medium text-neutral-800 outline-none transition focus:border-neutral-900 focus:bg-white"
          >
            {queues.map((q) => (
              <option key={q.poliklinik} value={q.poliklinik}>
                {q.poliklinik} ({q.currentServingNumber})
              </option>
            ))}
          </select>
          <span className="hidden md:inline-block text-xs text-neutral-400">
            {currentPoli.room} · {currentPoli.dokter}
          </span>
        </div>

        {/* Kontrol Petugas / Dokter (Hanya tampil pada Mode Dokter/Petugas) */}
        {allowStaffControls && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => onQueueAction(currentPoli.poliklinik, 'recall')}
              disabled={isAdvancing}
              title="Panggil ulang nomor saat ini dengan suara Bahasa Indonesia"
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-40"
            >
              <VolumeIcon width={13} height={13} className="text-neutral-600" />
              <span>Panggil Suara</span>
            </button>

            {servingStatus !== 'SELESAI' && (
              <button
                type="button"
                onClick={() => onQueueAction(currentPoli.poliklinik, 'complete')}
                disabled={isAdvancing}
                title="Tandai pemeriksaan nomor antrean saat ini selesai"
                className="inline-flex h-8 items-center gap-1 rounded-full border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-40"
              >
                <CheckIcon width={13} height={13} className="text-emerald-600" />
                <span>Selesai</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onQueueAction(currentPoli.poliklinik, 'call_next')}
              disabled={!canAdvance || isAdvancing}
              title={
                canAdvance
                  ? 'Panggil antrean berikutnya dan umumkan dengan suara otomatis'
                  : 'Belum ada antrean menunggu berikutnya'
              }
              className="inline-flex h-8 items-center gap-1 rounded-full bg-neutral-900 px-3.5 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-35"
            >
              <VolumeIcon width={13} height={13} />
              <span>Panggil Berikutnya</span>
              <ChevronRightIcon width={13} height={13} />
            </button>
          </div>
        )}
      </div>

      {/* Ringkasan Status Antrean (MENUNGGU -> DIPANGGIL -> SELESAI) */}
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">Sedang Dilayani</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                servingStatus === 'SELESAI'
                  ? 'bg-neutral-100 text-neutral-600'
                  : 'bg-emerald-50 text-emerald-700'
              }`}
            >
              {servingStatus}
            </span>
          </div>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-tight text-neutral-900">
            {currentPoli.currentServingNumber}
          </p>
          <p className="mt-0.5 truncate text-xs text-neutral-500">
            {currentPoli.currentPatientName ?? 'Pasien Poliklinik'}
          </p>
        </div>

        <div>
          <span className="text-xs text-neutral-500">Antrean Berikutnya</span>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-tight text-neutral-900">
            {currentPoli.nextQueueNumber ?? '—'}
          </p>
          <p className="mt-0.5 truncate text-xs text-neutral-500">
            {currentPoli.nextPatientName
              ? `MENUNGGU · ${currentPoli.nextPatientName}`
              : 'Tidak ada antrean menunggu'}
          </p>
        </div>

        <div>
          <span className="text-xs text-neutral-500">Sisa Menunggu</span>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">
            {currentPoli.totalWaiting}{' '}
            <span className="text-xs font-normal text-neutral-500">pasien</span>
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            Terakhir: <span className="font-mono">{currentPoli.latestQueueNumber}</span>
          </p>
        </div>

        <div>
          <span className="text-xs text-neutral-500">Estimasi Tunggu Baru</span>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">
            ± {currentPoli.estimatedWaitMinutes + 8}{' '}
            <span className="text-xs font-normal text-neutral-500">menit</span>
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">Rata-rata 8 menit/pasien</p>
        </div>
      </div>

      {/* Transkrip Panggilan Suara TTS Aktif */}
      {lastSpokenText && (
        <div className="mt-3.5 flex items-center justify-between gap-2 rounded-xl bg-neutral-50 px-3.5 py-2 text-xs text-neutral-600">
          <div className="flex items-center gap-2 min-w-0">
            <VolumeIcon width={14} height={14} className="shrink-0 text-emerald-600" />
            <span className="truncate font-medium">
              Suara TTS: &ldquo;{lastSpokenText}&rdquo;
            </span>
          </div>
          <span className="shrink-0 text-[10px] text-neutral-400">id-ID</span>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Mode Layar TV Ruang Tunggu Poliklinik (Public Queue Display)              */
/* -------------------------------------------------------------------------- */

function WaitingRoomTvDisplay({
  queues,
  activePoliName,
  onSelectPoli,
  onQueueAction,
  isAdvancing,
  lastSpokenText,
}: {
  readonly queues: readonly PoliQueueSnapshot[];
  readonly activePoliName: string;
  readonly onSelectPoli: (poli: string) => void;
  readonly onQueueAction: (poli: string, action: QueueControlAction) => void;
  readonly isAdvancing: boolean;
  readonly lastSpokenText: string | null;
}) {
  const [clockText, setClockText] = useState<string>('');
  const [dateText, setDateText] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setClockText(
        now.toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
        }) + ' WIB',
      );
      setDateText(
        now.toLocaleDateString('id-ID', {
          weekday: 'long',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
      );
    };
    updateClock();
    const timer = window.setInterval(updateClock, 10000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      /* abaikan jika browser membatasi fullscreen */
    }
  };

  const currentPoli =
    queues.find((q) => q.poliklinik === activePoliName) ??
    queues[0] ??
    DEFAULT_POLI_QUEUES[0];

  const canAdvance =
    currentPoli.currentServingSequence < currentPoli.latestQueueSequence;
  const servingStatus = currentPoli.servingStatus ?? 'DIPANGGIL';

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200/90 bg-white">
      {/* Top Bar Minimalis */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200/80 px-6 py-4">
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-semibold tracking-tight text-neutral-900">
            Instalasi Rawat Jalan
          </span>
          <span className="text-xs text-neutral-400">
            Papan Informasi Antrean Poliklinik
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <span>{dateText}</span>
            <span className="text-neutral-300">·</span>
            <span className="font-mono font-semibold text-neutral-900">
              {clockText}
            </span>
          </div>

          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="h-8 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50"
          >
            {isFullscreen ? 'Keluar layar penuh' : 'Layar penuh'}
          </button>
        </div>
      </div>

      {/* Main Split Grid: Kiri (Fokus Panggilan), Kanan (Tabel Direktori 10 Poli) */}
      <div className="grid divide-y divide-neutral-200/80 lg:grid-cols-[1.15fr_1fr] lg:divide-x lg:divide-y-0">
        {/* Panel Kiri: Nomor Sedang Dilayani */}
        <div className="flex flex-col justify-between p-7 sm:p-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  servingStatus === 'SELESAI'
                    ? 'bg-neutral-300'
                    : 'bg-emerald-600'
                }`}
              />
              <span className="text-xs font-medium text-neutral-500">
                {servingStatus === 'SELESAI'
                  ? 'Pelayanan selesai'
                  : 'Sedang dipanggil'}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onQueueAction(currentPoli.poliklinik, 'recall')}
                disabled={isAdvancing}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-40"
              >
                <VolumeIcon width={13} height={13} className="text-neutral-500" />
                Panggil ulang
              </button>
              <button
                type="button"
                onClick={() => onQueueAction(currentPoli.poliklinik, 'call_next')}
                disabled={!canAdvance || isAdvancing}
                className="inline-flex h-8 items-center gap-1 rounded-lg bg-neutral-900 px-3.5 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-35"
              >
                Berikutnya
                <ChevronRightIcon width={13} height={13} />
              </button>
            </div>
          </div>

          {/* Nomor Antrean Utama */}
          <div className="my-10 sm:my-14">
            <p className="font-mono text-7xl font-semibold leading-none tracking-tighter text-neutral-950 sm:text-8xl">
              {currentPoli.currentServingNumber}
            </p>
            <p className="mt-5 text-xl font-medium tracking-tight text-neutral-900 sm:text-2xl">
              {currentPoli.currentPatientName ?? 'Pasien Poliklinik'}
            </p>
            <p className="mt-1.5 text-xs text-neutral-500">
              No. RM{' '}
              <span className="font-mono text-neutral-700">
                {currentPoli.currentPatientNoRm ?? '—'}
              </span>{' '}
              · Silakan menuju{' '}
              <span className="font-medium text-neutral-800">
                {currentPoli.room.replace('•', '·')}
              </span>
            </p>
          </div>

          {/* Ringkasan Bawah */}
          <div>
            <div className="grid grid-cols-3 gap-6 border-t border-neutral-150 pt-6 text-xs">
              <div>
                <p className="text-neutral-400">Poliklinik</p>
                <p className="mt-1 font-medium text-neutral-900">
                  {currentPoli.poliklinik}
                </p>
                <p className="mt-0.5 truncate text-neutral-500">
                  {currentPoli.dokter}
                </p>
              </div>

              <div>
                <p className="text-neutral-400">Berikutnya</p>
                <p className="mt-1 font-mono text-base font-semibold text-neutral-900">
                  {currentPoli.nextQueueNumber ?? '—'}
                </p>
                <p className="mt-0.5 truncate text-neutral-500">
                  {currentPoli.nextPatientName ?? 'Tidak ada antrean'}
                </p>
              </div>

              <div>
                <p className="text-neutral-400">Sisa antrean</p>
                <p className="mt-1 font-medium text-neutral-900">
                  {currentPoli.totalWaiting} pasien
                </p>
                <p className="mt-0.5 font-mono text-neutral-500">
                  Terakhir {currentPoli.latestQueueNumber}
                </p>
              </div>
            </div>

            {lastSpokenText && (
              <div className="mt-5 flex items-center gap-2 border-t border-neutral-100 pt-3.5 text-xs text-neutral-500">
                <VolumeIcon width={13} height={13} className="shrink-0 text-neutral-400" />
                <span className="truncate">{lastSpokenText}</span>
              </div>
            )}
          </div>
        </div>

        {/* Panel Kanan: Tabel Direktori 10 Poliklinik */}
        <div className="flex flex-col">
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-neutral-100 bg-neutral-50/60 px-6 py-3 text-[11px] font-medium text-neutral-400">
            <span>Poliklinik</span>
            <span className="text-right">Menunggu</span>
            <span className="w-20 text-right">Dilayani</span>
          </div>

          <div className="divide-y divide-neutral-100">
            {queues.map((q) => {
              const isSelected = q.poliklinik === currentPoli.poliklinik;
              return (
                <button
                  key={q.poliklinik}
                  type="button"
                  onClick={() => onSelectPoli(q.poliklinik)}
                  className={`grid w-full grid-cols-[1fr_auto_auto] items-center gap-4 px-6 py-3.5 text-left transition ${
                    isSelected
                      ? 'bg-neutral-100/80'
                      : 'bg-white hover:bg-neutral-50/70'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`truncate text-xs ${
                          isSelected
                            ? 'font-semibold text-neutral-950'
                            : 'font-medium text-neutral-800'
                        }`}
                      >
                        {q.poliklinik}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-neutral-400">
                      {q.room.replace('•', '·')} · {q.dokter}
                    </p>
                  </div>

                  <span className="text-right text-xs text-neutral-500">
                    {q.totalWaiting > 0 ? `${q.totalWaiting} pasien` : '—'}
                  </span>

                  <span
                    className={`w-20 text-right font-mono text-sm ${
                      isSelected
                        ? 'font-semibold text-neutral-950'
                        : 'font-medium text-neutral-800'
                    }`}
                  >
                    {q.currentServingNumber}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Empty State Minimalis                                                     */
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
    <div className="flex h-full min-h-[22rem] flex-col justify-between rounded-2xl border border-neutral-200/80 bg-white p-6">
      <div className="my-auto flex flex-col items-center text-center py-6">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-600">
          <ScanIcon width={20} height={20} />
        </div>
        <p className="mt-3.5 text-sm font-semibold text-neutral-900">
          Menunggu Pemindaian Wajah Pasien
        </p>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-neutral-500">
          Hadapkan wajah ke kamera dan tahan 1,5 detik. Sistem memvalidasi Liveness 3D dan menerbitkan tiket antrean otomatis.
        </p>
      </div>

      <div className="rounded-xl bg-neutral-50 p-3.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-neutral-500">
            Tiket berikutnya ({activePoliQueue.poliklinik})
          </span>
          <span className="font-mono font-semibold text-neutral-900">
            {nextNumber} · Menunggu {waitingForNext} pasien (±{waitingForNext * 8} mnt)
          </span>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Kartu Tiket Antrean Pasien Minimalis                                      */
/* -------------------------------------------------------------------------- */

function QueueTicketCard({
  patient,
  livePoliQueue,
  onQueueAction,
  isAdvancing,
  onNext,
  allowStaffControls,
}: {
  readonly patient: RecognizedPerson;
  readonly livePoliQueue?: PoliQueueSnapshot;
  readonly onQueueAction: (poli: string, action: QueueControlAction) => void;
  readonly isAdvancing: boolean;
  readonly onNext: () => void;
  readonly allowStaffControls: boolean;
}) {
  const ticket = patient.queueTicket;
  if (!ticket) {
    return null;
  }

  const currentServingSeq =
    livePoliQueue?.currentServingSequence ?? ticket.currentServingSequence;
  const currentServingNumber =
    livePoliQueue?.currentServingNumber ?? ticket.currentServingNumber;
  const servingStatus = livePoliQueue?.servingStatus ?? 'DIPANGGIL';

  const patientsAhead = Math.max(0, ticket.queueSequence - currentServingSeq);
  const estimatedWaitMinutes = patientsAhead * 8;
  const isTurnNow = patientsAhead === 0;
  const isCompleted = isTurnNow && servingStatus === 'SELESAI';

  const ticketStateLabel = isCompleted
    ? 'SELESAI'
    : isTurnNow
      ? 'DIPANGGIL'
      : 'MENUNGGU';

  const isDuplicateScan =
    patient.alreadyQueued === true || ticket.isExistingTicket === true;

  return (
    <div className="no-print rounded-2xl border border-neutral-200/80 bg-white p-5">
      {isDuplicateScan && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/80 px-3.5 py-2.5 text-xs text-amber-900">
          <p className="font-semibold">
            Antrean Aktif Sudah Ada (Tidak Dobel Order)
          </p>
          <p className="mt-0.5 text-[11px] text-amber-800">
            Satu pasien hanya dapat memiliki 1 antrean aktif. Menampilkan tiket{' '}
            <strong className="font-mono">{ticket.queueNumber}</strong> milik{' '}
            <strong>{patient.fullName}</strong> tanpa menerbitkan nomor baru.
          </p>
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="text-xs text-neutral-500">Nomor Antrean Pasien</span>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="font-mono text-4xl font-semibold tracking-tight text-neutral-900">
              {ticket.queueNumber}
            </span>
            <span className="text-xs text-neutral-500">
              Dilayani: <strong className="font-mono text-neutral-800">{currentServingNumber}</strong>
            </span>
          </div>
        </div>

        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            ticketStateLabel === 'SELESAI'
              ? 'bg-neutral-100 text-neutral-600'
              : ticketStateLabel === 'DIPANGGIL'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-800'
          }`}
        >
          {ticketStateLabel === 'MENUNGGU'
            ? `MENUNGGU · ${patientsAhead} pasien lagi (±${estimatedWaitMinutes} mnt)`
            : ticketStateLabel}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-neutral-100 pt-3.5 text-xs">
        <div>
          <p className="text-neutral-400">Poliklinik</p>
          <p className="mt-0.5 font-medium text-neutral-900">{ticket.poliklinik}</p>
        </div>
        <div>
          <p className="text-neutral-400">Ruang</p>
          <p className="mt-0.5 font-medium text-neutral-900">{ticket.room}</p>
        </div>
        <div>
          <p className="text-neutral-400">Dokter</p>
          <p className="mt-0.5 font-medium text-neutral-900">{ticket.dokter}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3.5">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-neutral-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-neutral-800"
        >
          <PrinterIcon width={14} height={14} />
          Cetak Struk Thermal
        </button>

        {allowStaffControls && (
          <>
            {!isTurnNow ? (
              <button
                type="button"
                onClick={() => onQueueAction(ticket.poliklinik, 'call_next')}
                disabled={isAdvancing}
                className="inline-flex items-center justify-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 py-2 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50"
              >
                <VolumeIcon width={13} height={13} />
                Panggil (+1)
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  onQueueAction(
                    ticket.poliklinik,
                    isCompleted ? 'recall' : 'complete',
                  )
                }
                disabled={isAdvancing}
                className="inline-flex items-center justify-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 py-2 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50"
              >
                <CheckIcon width={13} height={13} />
                {isCompleted ? 'Panggil Ulang' : 'Tandai Selesai'}
              </button>
            )}
          </>
        )}

        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center justify-center rounded-full border border-neutral-200 bg-white px-3.5 py-2 text-xs font-medium text-neutral-600 transition hover:bg-neutral-50"
        >
          Pasien Berikutnya
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Rekam Medis Pasien + Form Tambah Riwayat Pemeriksaan Dokter               */
/* -------------------------------------------------------------------------- */

function PatientDetails({
  patient,
  onAddHistory,
  allowDoctorForm,
}: {
  readonly patient: RecognizedPerson;
  readonly onAddHistory: (
    item: MedicalHistoryItem,
    fullHistory?: readonly MedicalHistoryItem[],
  ) => void;
  readonly allowDoctorForm: boolean;
}) {
  const allergy = hasRealAllergy(patient.allergies);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [icdSearchQuery, setIcdSearchQuery] = useState('');
  const [selectedIcd, setSelectedIcd] = useState<Icd10Entry | null>(null);
  const [showIcdDropdown, setShowIcdDropdown] = useState(false);
  const [diagnosisCustomSuffix, setDiagnosisCustomSuffix] = useState('');
  const [treatment, setTreatment] = useState('');
  const [notePoli, setNotePoli] = useState(
    patient.queueTicket?.poliklinik ?? patient.poliklinik,
  );
  const [noteDoctor, setNoteDoctor] = useState(
    patient.queueTicket?.dokter ?? patient.dokter,
  );
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [showFhirPreview, setShowFhirPreview] = useState(false);

  useEffect(() => {
    setNotePoli(patient.queueTicket?.poliklinik ?? patient.poliklinik);
    setNoteDoctor(patient.queueTicket?.dokter ?? patient.dokter);
    setSelectedIcd(null);
    setIcdSearchQuery('');
    setDiagnosisCustomSuffix('');
  }, [patient.personId, patient.poliklinik, patient.dokter, patient.queueTicket]);

  const icdSuggestions = searchIcd10Catalog(icdSearchQuery, notePoli, 8);

  const handleSelectIcdEntry = (entry: Icd10Entry) => {
    setSelectedIcd(entry);
    setIcdSearchQuery(`${entry.code} — ${entry.nameId}`);
    setShowIcdDropdown(false);
    if (!treatment.trim()) {
      setTreatment(entry.defaultTreatment);
    }
  };

  const composedDiagnosis = selectedIcd
    ? diagnosisCustomSuffix.trim()
      ? `${formatIcd10Diagnosis(selectedIcd)} — ${diagnosisCustomSuffix.trim()}`
      : formatIcd10Diagnosis(selectedIcd)
    : '';

  const handleSaveDoctorNote = async (e: FormEvent) => {
    e.preventDefault();
    setNoteError(null);
    if (!selectedIcd) {
      setNoteError(
        'Pilih kode diagnosis standar WHO ICD-10 dari daftar pencarian terlebih dahulu.',
      );
      return;
    }
    if (!treatment.trim()) {
      setNoteError('Tindakan klinis dan resep obat wajib diisi.');
      return;
    }

    setIsSavingNote(true);
    const result = await addMedicalRecord({
      personId: patient.personId,
      noRm: patient.noRm,
      poliklinik: notePoli,
      doctor: noteDoctor,
      diagnosis: composedDiagnosis,
      treatment: treatment.trim(),
    });
    setIsSavingNote(false);

    if (!result.success) {
      setNoteError(result.message);
      return;
    }

    const newEntry: MedicalHistoryItem = result.record ?? {
      date: new Date().toISOString().slice(0, 10),
      poliklinik: notePoli,
      doctor: noteDoctor,
      diagnosis: composedDiagnosis,
      treatment: treatment.trim(),
    };

    onAddHistory(newEntry, result.medicalHistory);
    setSelectedIcd(null);
    setIcdSearchQuery('');
    setDiagnosisCustomSuffix('');
    setTreatment('');
    setIsAddingNote(false);
  };

  const fhirBundle = showFhirPreview ? buildSatusehatFhirBundle(patient) : null;

  return (
    <div className="no-print rounded-2xl border border-neutral-200/80 bg-white p-5">
      {/* Identitas Pasien & Status Kepatuhan UU PDP */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-700">
            {patient.fullName
              .split(' ')
              .slice(0, 2)
              .map((w) => w[0])
              .join('')
              .toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-900">
              {patient.fullName}
            </p>
            <p className="text-xs text-neutral-500">
              <span className="font-mono">{patient.noRm}</span> · {patient.gender} ·{' '}
              {patient.age} th
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span
            title="Persetujuan pemrosesan data biometrik & RME sesuai UU PDP No. 27/2022 tercatat"
            className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-semibold text-sky-700"
          >
            <CheckIcon width={11} height={11} />
            UU PDP Consent
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
            <ShieldCheckIcon width={13} height={13} />
            {patient.similarity.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Ringkasan Medis */}
      <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-neutral-100 pt-3.5 text-xs">
        <div>
          <dt className="text-neutral-400">Tgl Lahir</dt>
          <dd className="mt-0.5 font-medium text-neutral-900">{patient.birthDate || '-'}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">Gol. Darah</dt>
          <dd className="mt-0.5 font-medium text-neutral-900">{patient.bloodType}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">Jaminan</dt>
          <dd className="mt-0.5 font-medium text-neutral-900">{patient.insurance}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">NIK (IHS)</dt>
          <dd className="mt-0.5 font-mono font-medium text-neutral-900 truncate">
            {patient.nik || '-'}
          </dd>
        </div>
      </dl>

      {patient.medicalNotes && (
        <div className="mt-3 rounded-xl bg-sky-50/70 border border-sky-100 p-2.5 text-xs text-sky-950">
          <p className="text-[10px] font-semibold text-sky-700 uppercase tracking-wider">
            Catatan Klinis
          </p>
          <p className="mt-0.5 text-neutral-800">{patient.medicalNotes}</p>
        </div>
      )}

      {/* Alergi & Komorbid */}
      <div className="mt-3.5 grid gap-2.5 sm:grid-cols-2 text-xs">
        <div
          className={`rounded-xl p-3 ${
            allergy
              ? 'bg-rose-50/90 text-rose-900 ring-1 ring-rose-200/70'
              : 'bg-neutral-50 text-neutral-700'
          }`}
        >
          <div className="flex items-center gap-1.5 font-medium">
            {allergy && <AlertIcon width={13} height={13} className="text-rose-600" />}
            <span className={allergy ? 'text-rose-700' : 'text-neutral-400'}>
              Alergi
            </span>
          </div>
          <p className="mt-0.5 font-medium">{patient.allergies}</p>
        </div>

        <div className="rounded-xl bg-neutral-50 p-3 text-neutral-700">
          <p className="text-neutral-400">Penyakit Penyerta</p>
          <p className="mt-0.5 font-medium text-neutral-900">
            {patient.chronicConditions}
          </p>
        </div>
      </div>

      {/* Riwayat Pemeriksaan + Tombol Tambah Catatan Dokter (ICD-10) & SATUSEHAT FHIR */}
      <div className="mt-4 border-t border-neutral-100 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-neutral-900">
            Riwayat Pemeriksaan ({patient.medicalHistory.length})
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowFhirPreview((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 text-[11px] font-medium text-emerald-800 transition hover:bg-emerald-100"
            >
              <FileTextIcon width={12} height={12} />
              {showFhirPreview ? 'Tutup FHIR R4' : 'SATUSEHAT FHIR'}
            </button>

            {allowDoctorForm && (
              <button
                type="button"
                onClick={() => setIsAddingNote((v) => !v)}
                className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-700 transition hover:bg-neutral-50"
              >
                <PlusIcon width={12} height={12} />
                {isAddingNote ? 'Tutup Form' : 'Catat Diagnosis ICD-10'}
              </button>
            )}
          </div>
        </div>

        {/* Panel Preview & Ekspor HL7 FHIR R4 Bundle SATUSEHAT Kemenkes */}
        {showFhirPreview && fhirBundle && (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-neutral-950 p-3.5 text-xs text-neutral-100">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2.5">
              <div>
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-emerald-400">
                  HL7 FHIR R4 Transaction Bundle · SATUSEHAT Kemenkes RI
                </span>
                <p className="text-[11px] text-neutral-400">
                  Terdiri dari Resource Patient (IHS/NIK), Consent (UU PDP), Encounter (AMB), & Condition (ICD-10)
                </p>
              </div>
              <button
                type="button"
                onClick={() => downloadSatusehatFhirJson(patient)}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-3 py-1 text-[11px] font-semibold text-neutral-950 transition hover:bg-emerald-400"
              >
                <DownloadIcon width={12} height={12} />
                Unduh JSON FHIR
              </button>
            </div>
            <pre className="mt-2.5 max-h-56 overflow-auto rounded-lg bg-black/50 p-2.5 font-mono text-[10px] leading-relaxed text-emerald-300">
              {JSON.stringify(fhirBundle, null, 2)}
            </pre>
          </div>
        )}

        {/* Form Tambah Riwayat Pemeriksaan Dokter Berbasis Pencarian Kode ICD-10 */}
        {allowDoctorForm && isAddingNote && (
          <form
            onSubmit={(e) => void handleSaveDoctorNote(e)}
            className="mt-3 space-y-3 rounded-xl border border-neutral-200 bg-neutral-50/90 p-3.5 text-xs"
          >
            <div className="flex items-center justify-between">
              <p className="font-semibold text-neutral-900">
                Input Pemeriksaan Dokter (Standar Pengkodean WHO ICD-10)
              </p>
              <span className="rounded bg-neutral-200/80 px-2 py-0.5 font-mono text-[10px] font-semibold text-neutral-700">
                ICD-10 · INA-CBGs
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input
                value={notePoli}
                onChange={(e) => setNotePoli(e.target.value)}
                placeholder="Poliklinik"
                className="h-8 rounded-lg border border-neutral-200 bg-white px-2.5 text-xs outline-none focus:border-neutral-900"
              />
              <input
                value={noteDoctor}
                onChange={(e) => setNoteDoctor(e.target.value)}
                placeholder="Nama Dokter (DPJP)"
                className="h-8 rounded-lg border border-neutral-200 bg-white px-2.5 text-xs outline-none focus:border-neutral-900"
              />
            </div>

            {/* Pencarian & Pemilih Kode Diagnosis ICD-10 */}
            <div className="relative space-y-1.5">
              <label className="block text-[11px] font-medium text-neutral-600">
                Cari & Pilih Kode Diagnosis ICD-10 *
              </label>
              <div className="relative flex items-center">
                <SearchIcon
                  width={13}
                  height={13}
                  className="pointer-events-none absolute left-2.5 text-neutral-400"
                />
                <input
                  value={icdSearchQuery}
                  onFocus={() => setShowIcdDropdown(true)}
                  onChange={(e) => {
                    setIcdSearchQuery(e.target.value);
                    setSelectedIcd(null);
                    setShowIcdDropdown(true);
                  }}
                  placeholder="Ketik kode (mis: I10, E11.9, J45.9, K29.7) atau nama diagnosis…"
                  className="h-8 w-full rounded-lg border border-neutral-200 bg-white pl-8 pr-20 text-xs outline-none focus:border-neutral-900"
                />
                {selectedIcd && (
                  <span className="absolute right-2 rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-800">
                    {selectedIcd.code} ✓
                  </span>
                )}
              </div>

              {showIcdDropdown && (
                <div className="max-h-48 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-1 shadow-md">
                  {icdSuggestions.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-neutral-400">
                      Tidak ditemukan kode ICD-10 yang cocok. Coba kata kunci lain.
                    </p>
                  ) : (
                    icdSuggestions.map((entry) => {
                      const isPoliRecommended = entry.poliklinik === notePoli;
                      return (
                        <button
                          key={entry.code}
                          type="button"
                          onClick={() => handleSelectIcdEntry(entry)}
                          className="flex w-full items-start justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-neutral-100"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="rounded bg-neutral-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                                {entry.code}
                              </span>
                              <span className="truncate font-semibold text-neutral-900">
                                {entry.nameId}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-[10px] italic text-neutral-500">
                              WHO: {entry.nameEn}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              isPoliRecommended
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-neutral-100 text-neutral-500'
                            }`}
                          >
                            {entry.poliklinik}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}

              {selectedIcd && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-2.5 py-1.5 text-[11px] text-emerald-950">
                  <span>
                    Terpilih: <strong>{formatIcd10Diagnosis(selectedIcd)}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setTreatment(selectedIcd.defaultTreatment)}
                    className="font-semibold text-emerald-700 underline hover:text-emerald-950"
                  >
                    Isi Resep Standar
                  </button>
                </div>
              )}
            </div>

            <input
              value={diagnosisCustomSuffix}
              onChange={(e) => setDiagnosisCustomSuffix(e.target.value)}
              placeholder="Keterangan klinis tambahan opsional (mis: Tekanan Darah 150/95 mmHg)"
              className="h-8 w-full rounded-lg border border-neutral-200 bg-white px-2.5 text-xs outline-none focus:border-neutral-900"
            />

            <input
              value={treatment}
              onChange={(e) => setTreatment(e.target.value)}
              placeholder="Tindakan & Resep Obat (contoh: Amlodipine 5mg 1x1, Diet rendah garam) *"
              className="h-8 w-full rounded-lg border border-neutral-200 bg-white px-2.5 text-xs outline-none focus:border-neutral-900"
              required
            />

            {noteError && (
              <p className="text-[11px] font-medium text-rose-600">{noteError}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setIsAddingNote(false);
                  setShowIcdDropdown(false);
                }}
                className="rounded-full px-3 py-1 text-xs text-neutral-500 hover:text-neutral-800"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isSavingNote}
                className="rounded-full bg-neutral-900 px-3.5 py-1 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
              >
                {isSavingNote ? 'Menyimpan…' : 'Simpan Diagnosis ICD-10'}
              </button>
            </div>
          </form>
        )}

        {patient.medicalHistory.length === 0 ? (
          <p className="mt-3 text-xs text-neutral-400">
            Belum ada riwayat kunjungan.
          </p>
        ) : (
          <ol className="mt-3 max-h-48 space-y-3 overflow-y-auto border-l border-neutral-200 pl-3.5 pr-1">
            {patient.medicalHistory.map((item, idx) => {
              const parsedIcd = parseIcd10FromText(item.diagnosis);
              return (
                <li key={`${item.date}-${idx}`} className="relative text-xs">
                  <span className="absolute -left-[18px] top-1.5 h-1.5 w-1.5 rounded-full bg-neutral-400" />
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] text-neutral-400">
                      {item.date} · {item.poliklinik}
                    </p>
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-neutral-700">
                      ICD-10: {parsedIcd.code}
                    </span>
                  </div>
                  <p className="mt-0.5 font-medium text-neutral-900">
                    {item.diagnosis}
                  </p>
                  <p className="text-neutral-600">{item.treatment}</p>
                  <p className="text-[11px] text-neutral-400">{item.doctor}</p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Komponen Utama Pemindai & Antrean                                         */
/* -------------------------------------------------------------------------- */

function AttendanceCamera({
  initialRoleMode = 'doctor',
}: {
  readonly initialRoleMode?: ViewRoleMode;
} = {}) {
  const frame = useFrameCapture();
  const verification = useAttendanceVerification();
  const [roleMode, setRoleMode] = useState<ViewRoleMode>(initialRoleMode);

  useEffect(() => {
    setRoleMode(initialRoleMode);
  }, [initialRoleMode]);
  const [poli, setPoli] = useState<string>(AUTO_POLI);
  const [queues, setQueues] = useState<readonly PoliQueueSnapshot[]>(
    DEFAULT_POLI_QUEUES,
  );
  const [monitorPoli, setMonitorPoli] = useState<string>('Poli Penyakit Dalam');
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [lastSpokenText, setLastSpokenText] = useState<string | null>(null);

  // State Pencarian Manual Fallback (NIK / No. RM / Nama)
  const [showManualSearch, setShowManualSearch] = useState(false);
  const [manualQuery, setManualQuery] = useState('');

  const camera = useWebCamera({
    enabled: roleMode !== 'tv' && frame.image === null,
  });

  const refreshQueues = useCallback(async () => {
    const data = await fetchPoliQueues();
    setQueues(data);
  }, []);

  useEffect(() => {
    void refreshQueues();
    const id = window.setInterval(() => {
      void refreshQueues();
    }, 3500);
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

  const handleManualLookup = async (e: FormEvent) => {
    e.preventDefault();
    if (!manualQuery.trim()) return;
    const ok = await verification.lookupManual(
      manualQuery.trim(),
      poli === AUTO_POLI ? undefined : poli,
    );
    if (ok) {
      setManualQuery('');
      setShowManualSearch(false);
      await refreshQueues();
    }
  };

  const detection = useFaceDetection({
    videoRef: camera.videoRef,
    enabled:
      roleMode !== 'tv' && camera.status === 'ready' && frame.image === null,
    onHoldComplete: captureAndIssue,
  });

  const hasFace = detection.trackingBox !== null;

  useEffect(() => {
    if (roleMode === 'tv' || camera.status !== 'ready' || !hasFace) {
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
  }, [
    roleMode,
    camera.status,
    camera.videoRef,
    hasFace,
    verification.identifyLive,
  ]);

  const live = verification.liveIdentity;
  const patient = verification.feedback?.person ?? (frame.image ? live : null);
  const error =
    verification.feedback?.type === 'error'
      ? verification.feedback.message
      : null;

  const effectivePoliName =
    patient?.queueTicket?.poliklinik ??
    (poli !== AUTO_POLI ? poli : live?.poliklinik ?? monitorPoli);

  const activePoliQueue =
    queues.find((q) => q.poliklinik === effectivePoliName) ??
    queues[0] ??
    DEFAULT_POLI_QUEUES[0];

  const handleQueueAction = async (
    targetPoli: string,
    action: QueueControlAction,
  ) => {
    setIsAdvancing(true);
    const result = await advancePoliQueue(targetPoli, action);
    const updatedQueues = result?.queues ?? queues;
    if (result?.queues) {
      setQueues(result.queues);
    } else {
      await refreshQueues();
    }

    const targetSnapshot =
      result?.queue ??
      updatedQueues.find((q) => q.poliklinik === targetPoli) ??
      activePoliQueue;

    if (action === 'call_next' || action === 'recall') {
      const matchedPatientName =
        patient?.queueTicket?.queueNumber === targetSnapshot.currentServingNumber
          ? patient.fullName
          : targetSnapshot.currentPatientName;

      const sentence = await speakQueueCall({
        queueNumber: targetSnapshot.currentServingNumber,
        patientName: matchedPatientName,
        poliklinik: targetSnapshot.poliklinik,
        room: targetSnapshot.room,
      });
      setLastSpokenText(sentence);
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
    if (frame.image || verification.feedback?.person) {
      if (verification.isSubmitting) return 'Memverifikasi identitas…';
      if (error) return error;
      if (patient?.alreadyQueued || patient?.queueTicket?.isExistingTicket) {
        return `Antrean aktif sudah ada (${patient.queueTicket?.queueNumber}) · Tidak dobel order`;
      }
      if (patient?.queueTicket) return 'Terverifikasi · Tiket antrean siap';
      return 'Foto wajah berhasil diambil';
    }
    if (error) return error;
    if (camera.status !== 'ready') return 'Menyiapkan kamera…';
    if (!hasFace) return 'Posisikan wajah menghadap kamera';
    if (detection.faceStatus === 'valid') return 'Tahan sebentar untuk memindai…';
    return detection.guidance;
  })();

  const allowStaffControls = roleMode === 'doctor';

  return (
    <div>
      {/* Struk Cetak Thermal 58mm/80mm (Hanya muncul saat window.print) */}
      {patient && (
        <ThermalPrintReceipt
          patient={patient}
          livePoliQueue={activePoliQueue}
        />
      )}

      {/* Selector Mode Tampilan Peran (Role-Based View Switcher) */}
      {initialRoleMode !== 'tv' && (
<div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200/80 bg-white px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span className="font-semibold text-neutral-800">Mode Terminal:</span>
          <span>
            {roleMode === 'kiosk'
              ? 'Anjungan Mandiri Pasien (Tanpa Tombol Admin)'
              : roleMode === 'doctor'
                ? 'Meja Dokter & Petugas (Kontrol Panggilan + Input SOAP)'
                : 'Layar TV Ruang Tunggu Poliklinik'}
          </span>
        </div>

        <div className="flex items-center gap-1 rounded-full bg-neutral-100 p-1">
          <button
            type="button"
            onClick={() => setRoleMode('kiosk')}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
              roleMode === 'kiosk'
                ? 'bg-white text-neutral-900 shadow-sm'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <ScanIcon width={12} height={12} />
            Kiosk Pasien
          </button>

          <button
            type="button"
            onClick={() => setRoleMode('doctor')}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
              roleMode === 'doctor'
                ? 'bg-white text-neutral-900 shadow-sm'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <StethoscopeIcon width={12} height={12} />
            Mode Dokter / Poli
          </button>

          <button
            type="button"
            onClick={() => setRoleMode('tv')}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
              roleMode === 'tv'
                ? 'bg-white text-neutral-900 shadow-sm'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <TvIcon width={12} height={12} />
            Layar TV Antrean
          </button>
        </div>
      </div>
      )}

      {roleMode === 'tv' ? (
        <WaitingRoomTvDisplay
          queues={queues}
          activePoliName={effectivePoliName}
          onSelectPoli={(selected) => setMonitorPoli(selected)}
          onQueueAction={(target, action) =>
            void handleQueueAction(target, action)
          }
          isAdvancing={isAdvancing}
          lastSpokenText={lastSpokenText}
        />
      ) : (
        <>
          {/* Panel Panggil Antrean + Suara TTS */}
          <MinimalQueuePanel
            queues={queues}
            activePoliName={effectivePoliName}
            onSelectPoli={(selected) => setMonitorPoli(selected)}
            onQueueAction={(target, action) =>
              void handleQueueAction(target, action)
            }
            isAdvancing={isAdvancing}
            lastSpokenText={lastSpokenText}
            allowStaffControls={allowStaffControls}
          />

          <div className="no-print grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-start">
            {/* Kolom Kiri: Kamera Biometrik + Fallback Manual NIK/No.RM */}
            <section className="rounded-2xl border border-neutral-200/80 bg-white p-4 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-neutral-900">
                  Kamera Pemindai Wajah
                </span>

                <div className="flex items-center gap-2">
                  <label htmlFor="poli-select" className="text-xs text-neutral-500">
                    Poli:
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
                    className="h-8 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 text-xs font-medium text-neutral-800 outline-none transition focus:border-neutral-900 focus:bg-white"
                  >
                    <option value={AUTO_POLI}>Otomatis (Sesuai Riwayat)</option>
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
                {verification.isSubmitting && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-black/55 backdrop-blur-sm">
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    <p className="text-xs font-medium text-white">
                      Memverifikasi data pasien & menerbitkan antrean…
                    </p>
                  </div>
                )}
              </CameraView>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      error
                        ? 'bg-rose-500'
                        : hasFace || frame.image || patient
                          ? 'bg-emerald-500'
                          : 'bg-neutral-300'
                    }`}
                  />
                  <span
                    className={`text-xs ${
                      error ? 'font-medium text-rose-600' : 'text-neutral-600'
                    }`}
                  >
                    {statusText}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowManualSearch((v) => !v)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-600 transition hover:bg-neutral-50"
                  >
                    <SearchIcon width={12} height={12} />
                    <span>{showManualSearch ? 'Tutup Cari' : 'Cari NIK / RM'}</span>
                  </button>

                  {frame.image || patient ? (
                    <button
                      type="button"
                      onClick={handleNext}
                      disabled={verification.isSubmitting}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
                    >
                      <RefreshIcon width={13} height={13} />
                      Pindai Ulang
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={captureAndIssue}
                      disabled={camera.status !== 'ready'}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-neutral-900 px-4 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-40"
                    >
                      <ScanIcon width={13} height={13} />
                      Ambil Antrean
                    </button>
                  )}
                </div>
              </div>

              {/* Fallback Pencarian Manual via NIK / No. RM / Nama */}
              {showManualSearch && (
                <form
                  onSubmit={(e) => void handleManualLookup(e)}
                  className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-2.5"
                >
                  <SearchIcon
                    width={14}
                    height={14}
                    className="ml-1.5 shrink-0 text-neutral-400"
                  />
                  <input
                    value={manualQuery}
                    onChange={(e) => setManualQuery(e.target.value)}
                    placeholder="Ketik No. RM (mis: RM-2026-001), NIK, atau Nama Pasien…"
                    className="h-8 flex-1 bg-transparent text-xs text-neutral-900 outline-none placeholder:text-neutral-400"
                  />
                  <button
                    type="submit"
                    disabled={verification.isSubmitting || !manualQuery.trim()}
                    className="h-8 rounded-lg bg-neutral-900 px-3 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-40"
                  >
                    Cari & Ambil Tiket
                  </button>
                </form>
              )}
            </section>

            {/* Kolom Kanan: Tiket Antrean & Rekam Medis */}
            <section className="space-y-4">
              {patient ? (
                <>
                  <QueueTicketCard
                    patient={patient}
                    livePoliQueue={activePoliQueue}
                    onQueueAction={(target, action) =>
                      void handleQueueAction(target, action)
                    }
                    isAdvancing={isAdvancing}
                    onNext={handleNext}
                    allowStaffControls={allowStaffControls}
                  />
                  <PatientDetails
                    patient={patient}
                    onAddHistory={verification.appendMedicalHistory}
                    allowDoctorForm={allowStaffControls}
                  />
                </>
              ) : (
                <EmptyState activePoliQueue={activePoliQueue} />
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

export default AttendanceCamera;
