import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';

interface PWAInstallButtonProps {
  compact?: boolean;
  showGuideWhenUnavailable?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  compact = false,
  showGuideWhenUnavailable = false,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [guideMode, setGuideMode] = useState<'ios' | 'chrome' | null>(null);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className={
          compact
            ? 'min-h-[36px] px-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors'
            : 'min-h-[40px] px-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-md inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors'
        }
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>{compact ? 'Install' : 'Install App'}</span>
      </button>
    );
  }

  if (isIOS || showGuideWhenUnavailable) {
    return (
      <>
        <button
          type="button"
          onClick={() => setGuideMode(isIOS ? 'ios' : 'chrome')}
          className={
            compact
              ? 'min-h-[36px] px-3 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors'
              : 'min-h-[40px] px-4 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-medium rounded-md inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors'
          }
        >
          <Smartphone className="w-3.5 h-3.5 shrink-0" />
          <span>{isIOS ? 'Add to Home' : 'Install Shortcut'}</span>
        </button>

        {guideMode && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="w-full max-w-sm rounded-lg bg-white border border-slate-200 p-5 shadow-xl space-y-3 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  {guideMode === 'ios'
                    ? 'Add to iPhone / iPad Home Screen'
                    : 'Install Chrome Home Screen Shortcut'}
                </h3>
                <button
                  type="button"
                  onClick={() => setGuideMode(null)}
                  className="text-slate-400 hover:text-slate-700 cursor-pointer"
                  aria-label="Close install instructions"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {guideMode === 'ios' ? (
                <ol className="text-xs text-slate-600 space-y-2 list-decimal pl-4 leading-relaxed">
                  <li>
                    Tap the <strong className="text-slate-900">Share</strong> icon in Safari&apos;s
                    toolbar.
                  </li>
                  <li>
                    Scroll down and tap <strong className="text-slate-900">Add to Home Screen</strong>
                    .
                  </li>
                  <li>
                    Tap <strong className="text-slate-900">Add</strong> to launch Outreach like a
                    native app.
                  </li>
                </ol>
              ) : (
                <ol className="text-xs text-slate-600 space-y-2 list-decimal pl-4 leading-relaxed">
                  <li>
                    Open this app directly in Chrome (not inside an embedded preview frame).
                  </li>
                  <li>
                    Tap Chrome&apos;s <strong className="text-slate-900">⋮ Menu</strong> (or the
                    install icon in the address bar on desktop).
                  </li>
                  <li>
                    Tap <strong className="text-slate-900">Add to Home screen</strong> →{' '}
                    <strong className="text-slate-900">Install</strong>.
                  </li>
                </ol>
              )}

              <button
                type="button"
                onClick={() => setGuideMode(null)}
                className="w-full min-h-[38px] rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
