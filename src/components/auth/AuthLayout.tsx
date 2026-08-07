import { ReactNode } from 'react';

export default function AuthLayout({
  children,
  headline = 'Welcome to StackPilot',
  subtext = 'Modern DevOps, Secure by Default.',
  icon,
}: {
  children: ReactNode;
  headline?: string;
  subtext?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-gradient-to-br from-indigo-500 via-blue-500 to-purple-500">
      {/* Left Panel */}
      <div className="hidden md:flex md:w-2/5 lg:w-[45%] relative items-center justify-center">
        <div className="absolute inset-0 z-0 bg-gradient-to-br from-indigo-500 via-blue-500 to-cyan-400 opacity-80" />
        <div className="absolute inset-0 z-10 backdrop-blur-[6px] bg-white/10" />
        <div className="relative z-20 flex flex-col items-center justify-center h-full px-10 py-16 text-center">
          <div className="mb-8 animate-float">
            {icon || (
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none" className="mx-auto drop-shadow-xl">
                <circle cx="32" cy="32" r="32" fill="url(#paint0_radial)" fillOpacity="0.7" />
                <defs>
                  <radialGradient id="paint0_radial" cx="0" cy="0" r="1" gradientTransform="translate(32 32) rotate(90) scale(32)">
                    <stop stopColor="#fff" stopOpacity="0.7" />
                    <stop offset="1" stopColor="#a5b4fc" stopOpacity="0.2" />
                  </radialGradient>
                </defs>
              </svg>
            )}
          </div>
          <h1 className="text-3xl font-bold text-white drop-shadow-lg mb-4">{headline}</h1>
          <p className="text-lg text-white/80 font-medium mb-2">{subtext}</p>
        </div>
      </div>
      {/* Right Panel */}
      <div className="flex-1 flex items-center justify-center min-h-screen bg-white dark:bg-[#0f172a] transition-colors duration-200">
        <div className="w-full max-w-md mx-auto p-8 rounded-2xl shadow-xl border border-white/10 backdrop-blur bg-white/90 dark:bg-[#0f172a]/90 transition-all duration-200 animate-fade-slide-up">
          {children}
        </div>
      </div>
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-12px); }
        }
        .animate-float { animation: float 3.5s ease-in-out infinite; }
        @keyframes fade-slide-up {
          0% { opacity: 0; transform: translateY(32px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-slide-up { animation: fade-slide-up 0.7s cubic-bezier(.4,0,.2,1); }
      `}</style>
    </div>
  );
}
