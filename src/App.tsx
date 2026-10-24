import { useEffect, useState } from 'react';
import AttendanceCamera from './components/AttendanceCamera';
import FaceRegistrationPage from './components/FaceRegistrationPage';
import { ScanIcon, UserPlusIcon } from './components/icons';

type ActivePage = 'attendance' | 'register';

function App() {
  const [activePage, setActivePage] = useState<ActivePage>('attendance');
  const [currentTime, setCurrentTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
        }) + ' WIB',
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-[#fafafa] text-neutral-900 antialiased">
      {/* Header Minimalis */}
      <header className="no-print sticky top-0 z-30 border-b border-neutral-200/80 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-xs font-semibold tracking-tight text-white">
              RS
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-tight text-neutral-900">
                  SIMRS Biometrik
                </span>
                {currentTime && (
                  <span className="hidden sm:inline-block text-xs text-neutral-400">
                    · {currentTime}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-neutral-500">
                Identifikasi Wajah, Antrean & Rekam Medis
              </p>
            </div>
          </div>

          <nav
            aria-label="Navigasi layanan"
            className="flex items-center gap-1 rounded-full bg-neutral-100 p-1"
          >
            <button
              type="button"
              onClick={() => setActivePage('attendance')}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                activePage === 'attendance'
                  ? 'bg-white text-neutral-900 shadow-sm'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <ScanIcon width={13} height={13} />
              Pasien Lama
            </button>
            <button
              type="button"
              onClick={() => setActivePage('register')}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                activePage === 'register'
                  ? 'bg-white text-neutral-900 shadow-sm'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <UserPlusIcon width={13} height={13} />
              Pasien Baru
            </button>
          </nav>
        </div>
      </header>

      {/* Konten Utama */}
      <main className="mx-auto max-w-6xl px-5 py-7 sm:px-8">
        <div className="no-print mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-neutral-900 sm:text-2xl">
              {activePage === 'attendance'
                ? 'Verifikasi Wajah & Antrean Poliklinik'
                : 'Pendaftaran Pasien Baru'}
            </h1>
            <p className="mt-1 text-xs text-neutral-500 sm:text-sm">
              {activePage === 'attendance'
                ? 'Pindai wajah pasien untuk membuka rekam medis, menerbitkan tiket antrean, atau memanggil antrean poli.'
                : 'Rekam biometrik wajah dan identitas medis awal pasien baru ke dalam sistem.'}
            </p>
          </div>

          {activePage === 'attendance' ? (
            <button
              type="button"
              onClick={() => setActivePage('register')}
              className="rounded-full border border-neutral-200 bg-white px-4 py-1.5 text-xs font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50"
            >
              Belum terdaftar? Daftar baru →
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setActivePage('attendance')}
              className="rounded-full border border-neutral-200 bg-white px-4 py-1.5 text-xs font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50"
            >
              ← Kembali ke pemindai
            </button>
          )}
        </div>

        {activePage === 'attendance' ? (
          <AttendanceCamera />
        ) : (
          <FaceRegistrationPage
            onGoToAttendance={() => setActivePage('attendance')}
          />
        )}
      </main>
    </div>
  );
}

export default App;
