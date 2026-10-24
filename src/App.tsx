import { useEffect, useState } from 'react';
import AttendanceCamera from './components/AttendanceCamera';
import FaceRegistrationPage from './components/FaceRegistrationPage';
import {
  HospitalIcon,
  ScanIcon,
  ShieldCheckIcon,
  UserPlusIcon,
} from './components/icons';

type ActivePage = 'attendance' | 'register';

function App() {
  const [activePage, setActivePage] = useState<ActivePage>('attendance');
  const [currentTime, setCurrentTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleDateString('id-ID', {
          weekday: 'long',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }) +
          ' · ' +
          now.toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }) +
          ' WIB'
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50/75 text-slate-800 antialiased selection:bg-teal-500 selection:text-white">
      {/* Top Bar Header SIMRS */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          {/* Logo & Identitas Rumah Sakit */}
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-700 to-slate-900 text-white shadow-sm ring-1 ring-black/5">
              <HospitalIcon width={22} height={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold tracking-tight text-slate-900">
                  SIMRS BIOMETRIK
                </span>
                <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-bold text-teal-700 border border-teal-200/70">
                  v2.0 On-Premise
                </span>
              </div>
              <p className="text-[11px] font-medium text-slate-500">
                Sistem Identifikasi Wajah & Tiket Antrean Otomatis
              </p>
            </div>
          </div>

          {/* Status & Jam Operasional */}
          <div className="hidden md:flex items-center gap-4 text-xs">
            <div className="flex items-center gap-2 rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1 font-mono text-[11px] text-slate-600">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>{currentTime || 'Memuat waktu…'}</span>
            </div>
          </div>

          {/* Navigasi Tab Segmented */}
          <nav
            aria-label="Navigasi Menu Utama"
            className="flex items-center rounded-xl bg-slate-100 p-1 border border-slate-200/70"
          >
            <button
              type="button"
              onClick={() => setActivePage('attendance')}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition ${
                activePage === 'attendance'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ScanIcon width={14} height={14} className={activePage === 'attendance' ? 'text-teal-700' : ''} />
              Pasien Lama (Scan)
            </button>
            <button
              type="button"
              onClick={() => setActivePage('register')}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition ${
                activePage === 'register'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserPlusIcon width={14} height={14} className={activePage === 'register' ? 'text-teal-700' : ''} />
              Daftar Pasien Baru
            </button>
          </nav>
        </div>
      </header>

      {/* Konten Utama */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Banner Navigasi Kontekstual */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/60 pb-5">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
              {activePage === 'attendance'
                ? 'Identifikasi Biometrik & Penerbitan Tiket Antrean'
                : 'Pendaftaran Pasien Baru & Perekaman Wajah'}
            </h1>
            <p className="mt-1 text-xs text-slate-500 max-w-2xl leading-relaxed">
              {activePage === 'attendance'
                ? 'Sistem secara otomatis mendeteksi wajah pasien lama, menampilkan riwayat diagnosis, peringatan alergi, dan langsung menerbitkan nomor antrean poliklinik tujuan.'
                : 'Perekaman dataset wajah pasien baru beserta identitas NIK, jaminan, dan anamnesis awal untuk dimasukkan ke dalam basis data rekam medis SIMRS.'}
            </p>
          </div>

          <div>
            {activePage === 'attendance' ? (
              <button
                type="button"
                onClick={() => setActivePage('register')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 hover:border-slate-300 shadow-sm active:scale-[0.98]"
              >
                <UserPlusIcon width={14} height={14} className="text-teal-600" />
                Pasien Belum Terdaftar? Tambah Pasien Baru →
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActivePage('attendance')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 hover:border-slate-300 shadow-sm active:scale-[0.98]"
              >
                ← Kembali ke Pemindai Wajah Pasien Lama
              </button>
            )}
          </div>
        </div>

        {/* Dynamic Page Component */}
        {activePage === 'attendance' ? (
          <AttendanceCamera />
        ) : (
          <FaceRegistrationPage
            onGoToAttendance={() => setActivePage('attendance')}
          />
        )}

        {/* Footer Berstandar Medis */}
        <footer className="mt-12 border-t border-slate-200/80 pt-6 pb-8 text-center text-xs text-slate-400">
          <div className="flex flex-wrap items-center justify-center gap-6">
            <span className="flex items-center gap-1.5">
              <ShieldCheckIcon width={14} height={14} className="text-teal-600" />
              Sistem Keamanan Data Biometrik Terenkripsi
            </span>
            <span>·</span>
            <span>SIMRS Biometrik Mandiri</span>
            <span>·</span>
            <span>Terintegrasi Standar Rekam Medis Elektronik (RME)</span>
          </div>
        </footer>
      </main>
    </div>
  );
}

export default App;
