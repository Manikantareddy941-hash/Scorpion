export default function Footer() {
  return (
    <footer className="w-full py-12 flex flex-col items-center justify-center border-t border-border bg-surface/20">
      <div className="logo-mark opacity-20 mb-6 !w-10 !h-10 !text-sm">SP</div>
      <div className="flex flex-col items-center gap-2">
        <span className="text-[11px] font-semibold text-text-subtle uppercase tracking-[0.2em] select-none">
          StackPilot Security Platform
        </span>
        <span className="text-[13px] font-medium text-text-muted select-none">
          Built with precision by <span className="text-text font-semibold">MANIKANT REDDY</span>
        </span>
      </div>
      <div className="mt-8 text-[11px] text-text-subtle opacity-60">
        &copy; {new Date().getFullYear()} StackPilot Inc. All rights reserved.
      </div>
    </footer>
  );
}
