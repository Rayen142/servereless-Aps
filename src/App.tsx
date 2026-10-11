import AttendanceCamera from './components/AttendanceCamera';

function App() {
  return (
    <main className="min-h-screen bg-[#f4f7f8] px-5 py-6 text-slate-950 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex items-center justify-between border-b border-slate-200/80 pb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-sm font-bold text-teal-300 shadow-lg shadow-slate-950/10">
              RA
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight text-slate-950">Real-time Attendance</p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">Secure identity verification</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3.5 py-2 text-xs font-semibold text-slate-600 shadow-sm sm:flex">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            System ready
          </div>
        </header>

        <div className="grid gap-8 py-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)] lg:items-center lg:gap-14 lg:py-16">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-teal-700">Daily check-in</p>
            <h1 className="mt-4 max-w-xl text-4xl font-semibold leading-tight tracking-[-0.03em] text-slate-950 sm:text-5xl">
              Hadir dengan satu pandangan.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-slate-600">
              Pastikan wajah terlihat jelas dan berada di area panduan. Kamera akan digunakan untuk proses verifikasi kehadiran.
            </p>
          </div>

          <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/75 p-3 shadow-[0_20px_60px_-35px_rgba(15,23,42,0.45)] backdrop-blur-sm sm:p-4">
            <AttendanceCamera />
          </div>
        </div>

        <footer className="flex flex-col gap-2 border-t border-slate-200/80 py-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>Attendance workspace</span>
          <span>Camera access is protected by your browser permissions.</span>
        </footer>
      </div>
    </main>
  );
}

export default App;