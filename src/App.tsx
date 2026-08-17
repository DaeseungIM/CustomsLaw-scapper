import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { OcKeyModal } from './components/OcKeyModal';
import { UnifiedSearchAndDriveExporter } from './components/UnifiedSearchAndDriveExporter';
import { DriveSheetToExcelConverter } from './components/DriveSheetToExcelConverter';
import { LawFetcher } from './components/LawFetcher';
import { GoogleSheetsExporter } from './components/GoogleSheetsExporter';
import { LawViewer } from './components/LawViewer';
import { Decisions2026Exporter } from './components/Decisions2026Exporter';
import { AdmRulesExporter } from './components/AdmRulesExporter';
import { CustomsActData, ExportConfig, UserProfile, LawRevisionItem } from './types';
import { initAuth, googleSignIn, logout } from './lib/firebase';
import { User } from 'firebase/auth';
import {
  FileSpreadsheet,
  BookOpen,
  FolderSync,
  Gavel,
  Building2,
  HardDrive,
  FolderArchive,
  Sparkles,
  ShieldCheck,
  Search
} from 'lucide-react';

export default function App() {
  const [ocKey, setOcKey] = useState('ceiai_law_test');
  const [isOcKeyModalOpen, setIsOcKeyModalOpen] = useState(false);

  // Auth State
  const [user, setUser] = useState<UserProfile | null>(null);
  const [needsAuth, setNeedsAuth] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Active View Tab (Default to new Google Drive unified manager)
  const [activeTab, setActiveTab] = useState<'unified' | 'excelConverter' | 'sync' | 'admRules' | 'decisions2026' | 'viewer'>('unified');

  // Selected Revision & Law Data for classic tabs
  const [selectedRevision, setSelectedRevision] = useState<LawRevisionItem | null>(null);
  const [isLoadingLawDetail, setIsLoadingLawDetail] = useState(false);
  const [lawData, setLawData] = useState<CustomsActData | null>(null);

  // Export Settings
  const [exportConfig, setExportConfig] = useState<ExportConfig>({
    targetType: 'new',
    includeOverview: true,
    autoFormat: true,
  });

  // Initialize Auth
  useEffect(() => {
    const unsubscribe = initAuth(
      (fbUser: User) => {
        setUser({
          displayName: fbUser.displayName,
          email: fbUser.email,
          photoURL: fbUser.photoURL,
        });
        setNeedsAuth(false);
      },
      () => {
        setUser(null);
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, []);

  // Pre-fetch Customs Act basic info preview on load if no specific revision is selected yet
  useEffect(() => {
    let isMounted = true;
    async function loadPreview() {
      if (selectedRevision) return;
      try {
        const res = await fetch(`/api/law/detail?ocKey=${encodeURIComponent(ocKey)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && isMounted) {
            setLawData({
              info: data.info,
              articles: data.articles,
              fetchedAt: data.fetchedAt,
            });
          }
        }
      } catch (err) {
        console.warn('Initial preview load warning:', err);
      }
    }
    loadPreview();
    return () => {
      isMounted = false;
    };
  }, [ocKey, selectedRevision]);

  // Handle Revision Selection from Combobox
  const handleSelectRevision = async (rev: LawRevisionItem) => {
    setSelectedRevision(rev);
    setIsLoadingLawDetail(true);
    try {
      const res = await fetch(
        `/api/law/detail?ocKey=${encodeURIComponent(ocKey)}&mst=${encodeURIComponent(rev.lawMst)}`
      );
      const data = await res.json();
      if (res.ok && data.success) {
        setLawData({
          info: data.info,
          articles: data.articles,
          fetchedAt: data.fetchedAt,
        });
      }
    } catch (err) {
      console.error('Failed to fetch law detail for revision:', err);
    } finally {
      setIsLoadingLawDetail(false);
    }
  };

  const handleSignIn = async () => {
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser({
          displayName: result.user.displayName,
          email: result.user.email,
          photoURL: result.user.photoURL,
        });
        setNeedsAuth(false);
      }
    } catch (err: any) {
      console.error('Sign in failed:', err);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setUser(null);
    setNeedsAuth(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased flex flex-col selection:bg-indigo-600 selection:text-white">
      {/* Top Header */}
      <Header
        user={user}
        needsAuth={needsAuth}
        ocKey={ocKey}
        onOpenOcKeyModal={() => setIsOcKeyModalOpen(true)}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        isLoggingIn={isLoggingIn}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Navigation Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200 pb-4 gap-4">
          <div className="flex items-center space-x-1.5 bg-slate-200/70 p-1.5 rounded-2xl border border-slate-200 overflow-x-auto">
            {/* Tab 1: New Drive Unified Manager */}
            <button
              onClick={() => setActiveTab('unified')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                activeTab === 'unified'
                  ? 'bg-indigo-600 text-white shadow-sm font-extrabold'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <HardDrive className="w-4 h-4" />
              <span>법령 · 행정규칙 드라이브 연동</span>
            </button>

            {/* Tab 2: Drive Sheets to Excel Converter */}
            <button
              onClick={() => setActiveTab('excelConverter')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                activeTab === 'excelConverter'
                  ? 'bg-emerald-600 text-white shadow-sm font-extrabold'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <FolderArchive className="w-4 h-4 text-emerald-300" />
              <span>드라이브 시트 ➔ 엑셀 일괄 변환</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/30 text-white font-extrabold">
                XLSX
              </span>
            </button>

            {/* Tab 3: Classic Sync & Sheets */}
            <button
              onClick={() => setActiveTab('sync')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                activeTab === 'sync'
                  ? 'bg-indigo-600 text-white shadow-sm font-extrabold'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>관세법 140회 동기화</span>
            </button>

            {/* Tab 3: Administrative Rules Notices & HSK 18,823 */}
            <button
              onClick={() => setActiveTab('admRules')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                activeTab === 'admRules'
                  ? 'bg-indigo-600 text-white shadow-sm font-extrabold'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span>고시·별표 & HSK 18,823</span>
            </button>

            {/* Tab 4: 2026 Decision Cases Exporter */}
            <button
              onClick={() => setActiveTab('decisions2026')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                activeTab === 'decisions2026'
                  ? 'bg-indigo-600 text-white shadow-sm font-extrabold'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <Gavel className="w-4 h-4" />
              <span>품목분류 결정사례</span>
            </button>

            {/* Tab 5: Law Articles Viewer */}
            <button
              onClick={() => setActiveTab('viewer')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                activeTab === 'viewer'
                  ? 'bg-indigo-600 text-white shadow-sm font-extrabold'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>조문 뷰어</span>
              {lawData && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-800 font-mono">
                  {lawData.articles.length}
                </span>
              )}
            </button>
          </div>

          <div className="hidden lg:flex items-center gap-2 text-xs text-slate-500 font-medium">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>국가법령 Open API & Drive API v3</span>
          </div>
        </div>

        {/* Tab 1: New Unified Search & Drive Exporter */}
        {activeTab === 'unified' && (
          <UnifiedSearchAndDriveExporter
            ocKey={ocKey}
            user={user}
            needsAuth={needsAuth}
            onSignIn={handleSignIn}
            onOpenOcKeyModal={() => setIsOcKeyModalOpen(true)}
          />
        )}

        {/* Tab 2: Drive Sheets to Excel Converter */}
        {activeTab === 'excelConverter' && (
          <DriveSheetToExcelConverter
            user={user}
            needsAuth={needsAuth}
            onSignIn={handleSignIn}
          />
        )}

        {/* Tab 3: Classic Sync & Sheets Export */}
        {activeTab === 'sync' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-7 space-y-8">
              <LawFetcher
                ocKey={ocKey}
                user={user}
                needsAuth={needsAuth}
                onSignIn={handleSignIn}
                exportConfig={exportConfig}
                onLawDataLoaded={setLawData}
                lawData={lawData}
                selectedRevision={selectedRevision}
                onSelectRevision={handleSelectRevision}
                isLoadingLawDetail={isLoadingLawDetail}
              />
            </div>

            <div className="lg:col-span-5 space-y-8">
              <GoogleSheetsExporter
                config={exportConfig}
                onChangeConfig={setExportConfig}
                lawData={lawData}
              />
            </div>
          </div>
        )}

        {/* Tab 3: Administrative Rules Notices & Annex Exporter */}
        {activeTab === 'admRules' && (
          <AdmRulesExporter
            ocKey={ocKey}
            user={user}
            needsAuth={needsAuth}
            onSignIn={handleSignIn}
          />
        )}

        {/* Tab 4: 2026 Decision Cases Exporter */}
        {activeTab === 'decisions2026' && (
          <Decisions2026Exporter
            ocKey={ocKey}
            user={user}
            needsAuth={needsAuth}
            onSignIn={handleSignIn}
          />
        )}

        {/* Tab 5: Law Articles Interactive Viewer */}
        {activeTab === 'viewer' && <LawViewer lawData={lawData} />}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 py-6 mt-12 bg-white text-slate-500 text-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 대한민국 관세법령 & 행정규칙 Google Drive / Sheets 자동화 시스템</p>
          <div className="flex items-center space-x-4">
            <a
              href="https://open.law.go.kr/LSO/usr/usrOcInfoMod.do"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-indigo-600 transition-colors font-medium"
            >
              국가법령 Open API 센터
            </a>
            <span>•</span>
            <button
              onClick={() => setIsOcKeyModalOpen(true)}
              className="hover:text-indigo-600 transition-colors font-mono font-bold text-slate-700"
            >
              API Key ({ocKey})
            </button>
          </div>
        </div>
      </footer>

      {/* OC Key Modal */}
      <OcKeyModal
        isOpen={isOcKeyModalOpen}
        onClose={() => setIsOcKeyModalOpen(false)}
        currentOcKey={ocKey}
        onSaveOcKey={setOcKey}
      />
    </div>
  );
}
