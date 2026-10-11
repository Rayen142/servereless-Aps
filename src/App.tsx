import { useState } from 'react';
import AttendanceCamera from './components/AttendanceCamera';
import FaceRegistrationPage from './components/FaceRegistrationPage';

type ActivePage = 'attendance' | 'register';

function App() {
  const [activePage, setActivePage] = useState<ActivePage>('attendance');

  return (
    <div className="min-h-screen bg-[#fafafa] text-neutral-900 antialiased">
      {/* Top Bar Minimalis */}
      <header className="sticky top-0 z-20 border-b border-neutral-200/80 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-900 text-xs font-bold tracking-tight text-white">
              RS
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight text-neutral-900">
                SIMRS Biometrik
              </p>
              <p className="text-xs text-neutral-500">
                Rekam Medis & Antrean Wajah Otomatis
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
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
                activePage === 'attendance'
                  ? 'bg-white text-neutral-900 shadow-sm'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Pasien Lama
            </button>
            <button
              type="button"
              onClick={() => setActivePage('register')}
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
                activePage === 'register'
                  ? 'bg-white text-neutral-900 shadow-sm'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              + Pasien Baru
            </button>
          </nav>
        </div>
      </header>

      {/* Konten Utama */}
      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 sm:text-3xl">
              {activePage === 'attendance'
                ? 'Scan Wajah Pasien Lama'
                : 'Pendaftaran Pasien Baru'}
            </h1>
            <p className="mt-1 text-sm text-neutral-500">
              {activePage === 'attendance'
                ? 'Identifikasi wajah otomatis menampilkan riwayat berobat, alergi, dan mencetak nomor antrean poliklinik.'
                : 'Rekam wajah dan data medis pasien baru. Form otomatis dikosongkan setelah tersimpan.'}
            </p>
          </div>

          {activePage === 'attendance' ? (
            <button
              type="button"
              onClick={() => setActivePage('register')}
              className="rounded-full border border-neutral-200 bg-white px-4 py-2 text-xs font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50"
            >
              Pasien belum terdaftar? Daftar baru →
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setActivePage('attendance')}
              className="rounded-full border border-neutral-200 bg-white px-4 py-2 text-xs font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50"
            >
              ← Kembali ke Scan Pasien Lama
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