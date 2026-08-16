import React from 'react';
import { UserProfile } from '../types';
import { Key, FileSpreadsheet, LogIn, LogOut, ShieldCheck } from 'lucide-react';

interface HeaderProps {
  user: UserProfile | null;
  needsAuth: boolean;
  ocKey: string;
  onOpenOcKeyModal: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  isLoggingIn: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  needsAuth,
  ocKey,
  onOpenOcKeyModal,
  onSignIn,
  onSignOut,
  isLoggingIn,
}) => {
  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand & Logo */}
        <div className="flex items-center space-x-3">
          <div className="bg-gradient-to-tr from-blue-600 to-indigo-500 p-2 rounded-lg text-white shadow-sm flex items-center justify-center">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-slate-100">
                관세법 Google Sheets 자동 동기화
              </h1>
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-950/80 text-emerald-400 border border-emerald-800/50">
                <ShieldCheck className="w-3 h-3" />
                국가법령 Open API
              </span>
            </div>
            <p className="text-xs text-slate-400">
              최신 관세법 전체 조문 수집 및 구글 스프레드시트 연동 도구
            </p>
          </div>
        </div>

        {/* Right Action Bar */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* OC Key Config Button */}
          <button
            onClick={onOpenOcKeyModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
            title="국가법령 Open API 키 설정"
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden md:inline">API 인증키:</span>
            <span className="font-mono text-amber-300 font-semibold">{ocKey}</span>
          </button>

          {/* Google Auth Status */}
          {user ? (
            <div className="flex items-center space-x-2 pl-2 border-l border-slate-800">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'Google User'}
                  className="w-7 h-7 rounded-full border border-slate-700"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold">
                  {user.displayName?.[0] || 'G'}
                </div>
              )}
              <div className="hidden lg:block text-left">
                <p className="text-xs font-medium text-slate-200 leading-tight">
                  {user.displayName || 'Google 사용자'}
                </p>
                <p className="text-[10px] text-slate-400 leading-tight">{user.email}</p>
              </div>
              <button
                onClick={onSignOut}
                className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition-colors"
                title="로그아웃"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={onSignIn}
              disabled={isLoggingIn}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-colors disabled:opacity-50"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>{isLoggingIn ? '로그인 중...' : 'Google 계정 연결'}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
