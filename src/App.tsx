import { useEffect, useState } from 'react';
import AttendanceCamera from './components/AttendanceCamera';
import EvaluationDashboardPage from './components/EvaluationDashboardPage';
import FaceRegistrationPage from './components/FaceRegistrationPage';
import { ChartBarIcon, ScanIcon, UserPlusIcon } from './components/icons';
import { getConfiguredApiBaseUrl } from './lib/hospital';

type ActivePage = 'attendance' | 'register' | 'analytics';

function App() {
  const [activePage, setActivePage] = useState<ActivePage>('attendance');
  const [currentTime, setCurrentTime] = useState<string>('');
  const apiBaseUrl = getConfiguredApiBaseUrl();

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

  const pageHeader = {
    attendance: {
      title: 'SIMRS Biometric Queue — Pindai Wajah & Bypass Manual No. RM',
      subtitle:
        'Ekstraksi vektor biometrik FaceNet (512-D) dan pencocokan Cosine Similarity untuk penerbitan nomor antrean poliklinik real-time.',
    },
    register: {
      title: 'Daftar Pasien Baru (Face Enrollment)',
      subtitle:
        'Akuisisi citra wajah subjek baru untuk ekstraksi dan registrasi embedding vektor biometrik pada basis data.',
    },
    analytics: {
      title: 'Evaluasi Akurasi Cosine Similarity, Latensi (Cold/Warm Start) & Biaya Cloud',
      subtitle:
        'Testbed komparatif arsitektur Serverless (AWS Lambda) vs Dedicated Server (Local/EC2) untuk pengujian beban JMeter/Artillery.',
    },
  }[activePage];

  return (
    <div className="min-h-screen bg-[#fafafa] text-neutral-900 antialiased">
      {/* Header SIMRS Biometric Queue */}
      <header className="no-print sticky top-0 z-30 border-b border-neutral-200/80 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-xs font-semibold tracking-tight text-white">
              SB
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-tight text-neutral-900">
                  SIMRS Biometric Queue
                </span>
                {currentTime && (
                  <span className="hidden sm:inline-block text-xs text-neutral-400">
                    · {currentTime}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-neutral-500">
                FaceNet Cosine Similarity · Endpoint:{' '}
                <code className="font-mono text-neutral-700">{apiBaseUrl}</code>
              </p>
            </div>
          </div>

          <nav
            aria-label="Navigasi testbed biometrik"
            className="flex flex-wrap items-center gap-1 rounded-full bg-neutral-100 p-1"
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
              Pindai Wajah
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
              Daftar Pasien Baru
            </button>
            <button
              type="button"
              onClick={() => setActivePage('analytics')}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                activePage === 'analytics'
                  ? 'bg-white text-neutral-900 shadow-sm'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <ChartBarIcon width={13} height={13} />
              Evaluasi Latensi & Biaya
            </button>
          </nav>
        </div>
      </header>

      {/* Konten Utama */}
      <main className="mx-auto max-w-6xl px-5 py-7 sm:px-8">
        <div className="no-print mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-neutral-900 sm:text-2xl">
              {pageHeader.title}
            </h1>
            <p className="mt-1 text-xs text-neutral-500 sm:text-sm">
              {pageHeader.subtitle}
            </p>
          </div>

          {activePage === 'attendance' ? (
            <button
              type="button"
              onClick={() => setActivePage('register')}
              className="rounded-full border border-neutral-200 bg-white px-4 py-1.5 text-xs font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50"
            >
              + Daftar Pasien Baru →
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setActivePage('attendance')}
              className="rounded-full border border-neutral-200 bg-white px-4 py-1.5 text-xs font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50"
            >
              ← Kembali ke Pindai Wajah
            </button>
          )}
        </div>

        {activePage === 'attendance' && (
          <AttendanceCamera onGoToRegister={() => setActivePage('register')} />
        )}
        {activePage === 'register' && (
          <FaceRegistrationPage
            onGoToAttendance={() => setActivePage('attendance')}
          />
        )}
        {activePage === 'analytics' && <EvaluationDashboardPage />}
      </main>
    </div>
  );
}

export default App;
