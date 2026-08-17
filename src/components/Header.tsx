import React from 'react';
import { UserProfile } from '../types';
import { Key, FileSpreadsheet, LogIn, LogOut, ShieldCheck, HardDrive } from 'lucide-react';

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
    <header className="bg-white text-slate-900 border-b border-slate-200 sticky top-0 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand & Logo */}
        <div className="flex items-center space-x-3">
          <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-sm flex items-center justify-center">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-black tracking-tight text-slate-900">
                관세법령 & 행정규칙 Google Sheets 자동화
              </h1>
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/80">
                <HardDrive className="w-3 h-3" />
                Drive API v3
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium">
              국가법령정보 오픈API (법령 & 행정규칙) 개정연혁 구글 드라이브 통합 관리 도구
            </p>
          </div>
        </div>

        {/* Right Action Bar */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* OC Key Config Button */}
          <button
            onClick={onOpenOcKeyModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition-colors shadow-2xs"
            title="국가법령 Open API 키 설정"
          >
            <Key className="w-3.5 h-3.5 text-amber-500" />
            <span className="hidden md:inline">API 인증키:</span>
            <span className="font-mono text-indigo-600 font-bold">{ocKey}</span>
          </button>

          {/* Google Auth Status */}
          {user ? (
            <div className="flex items-center space-x-2 pl-2 border-l border-slate-200">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'Google User'}
                  className="w-7 h-7 rounded-full border border-slate-200 shadow-2xs"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-bold">
                  {user.displayName?.[0] || 'G'}
                </div>
              )}
              <div className="hidden lg:block text-left">
                <p className="text-xs font-bold text-slate-800 leading-tight">
                  {user.displayName || 'Google 사용자'}
                </p>
                <p className="text-[10px] text-slate-400 leading-tight">{user.email}</p>
              </div>
              <button
                onClick={onSignOut}
                className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors"
                title="로그아웃"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={onSignIn}
              disabled={isLoggingIn}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow transition-all disabled:opacity-50"
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
