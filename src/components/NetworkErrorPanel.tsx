import React from 'react';

export default function NetworkErrorPanel({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="w-full max-w-md mx-auto bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-700 rounded-xl p-6 flex flex-col items-center text-center shadow-lg animate-fade-slide-up">
      <div className="mb-3">
        <svg width="40" height="40" fill="none" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="20" fill="#fee2e2" />
          <path d="M20 12v8" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="20" cy="27" r="1.5" fill="#dc2626" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">Connection Issue Detected</h2>
      <p className="text-sm text-red-700 dark:text-red-100 mb-4">
        StackPilot cannot reach the authentication server. This is usually caused by DNS blocking, firewall rules, or network restrictions.
      </p>
      <ul className="text-xs text-red-700 dark:text-red-100 mb-4 space-y-1">
        <li>• Try switching DNS to <span className="font-mono">8.8.8.8</span> or <span className="font-mono">1.1.1.1</span></li>
        <li>• Try using a VPN</li>
      </ul>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-semibold shadow hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-200"
        >
          Retry
        </button>
      )}
    </div>
  );
}
