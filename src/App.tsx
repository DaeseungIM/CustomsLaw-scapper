import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { OcKeyModal } from './components/OcKeyModal';
import { LawFetcher } from './components/LawFetcher';
import { GoogleSheetsExporter } from './components/GoogleSheetsExporter';
import { LawViewer } from './components/LawViewer';
import { Decisions2026Exporter } from './components/Decisions2026Exporter';
import { AdmRulesExporter } from './components/AdmRulesExporter';
import { CustomsActData, ExportConfig, UserProfile, LawRevisionItem } from './types';
import { initAuth, googleSignIn, logout } from './lib/firebase';
import { User } from 'firebase/auth';
import { FileSpreadsheet, BookOpen, Sparkles, Shield, Info, Gavel, Building2 } from 'lucide-react';

export default function App() {
  const [ocKey, setOcKey] = useState('ceiai_law_test');
  const [isOcKeyModalOpen, setIsOcKeyModalOpen] = useState(false);

  // Auth State
  const [user, setUser] = useState<UserProfile | null>(null);
  const [needsAuth, setNeedsAuth] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Active View Tab
  const [activeTab, setActiveTab] = useState<'sync' | 'viewer' | 'decisions2026' | 'admRules'>('sync');

  // Selected Revision & Law Data
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
      if (selectedRevision) return; // Handled by revision select handler
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
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased flex flex-col selection:bg-indigo-500 selection:text-white">
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
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-2 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab('sync')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'sync'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>동기화 & Google Sheets 저장</span>
            </button>

            <button
              onClick={() => setActiveTab('viewer')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'viewer'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>관세법 조문 조회/검색</span>
              {lawData && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-950 text-indigo-300 font-mono">
                  {lawData.articles.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('decisions2026')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'decisions2026'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Gavel className="w-4 h-4 text-amber-400" />
              <span>2026년 결정사례 (구글시트)</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-950 text-amber-300 font-bold">
                2026
              </span>
            </button>

            <button
              onClick={() => setActiveTab('admRules')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'admRules'
                  ? 'bg-teal-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Building2 className="w-4 h-4 text-teal-300" />
              <span>행정규칙 관세 고시별표 (구글시트)</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-950 text-teal-300 font-bold">
                law.go.kr
              </span>
            </button>
          </div>

          <div className="hidden md:flex items-center gap-2 text-xs text-slate-400">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span>국가법령 Open API v1.0 준수</span>
          </div>
        </div>

        {/* Tab 1: Sync & Sheets Export */}
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

              {/* Service Info Note */}
              <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 space-y-3 text-xs text-slate-400">
                <div className="flex items-center gap-2 text-slate-200 font-bold">
                  <Info className="w-4 h-4 text-indigo-400" />
                  <span>서비스 동작 원리 및 보안</span>
                </div>
                <ul className="space-y-1.5 list-disc list-inside leading-relaxed text-slate-400">
                  <li>
                    <span className="text-slate-300">Open API 인증:</span> 입력하신 API 키(<code className="text-amber-300 font-mono">{ocKey}</code>)를 통해 법제처 서버에서 실시간 호출합니다.
                  </li>
                  <li>
                    <span className="text-slate-300">보안 권한:</span> Google OAuth 인증 토큰은 메모리에만 안전하게 유지되며, 오직 지정하신 구글 스프레드시트 기록에만 활용됩니다.
                  </li>
                  <li>
                    <span className="text-slate-300">자동 표 서식:</span> 조문 내용 자동 줄바꿈, 헤더 서식 및 틀 고정이 자동 적용되어 최적의 가독성을 제공합니다.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Law Articles Interactive Viewer */}
        {activeTab === 'viewer' && <LawViewer lawData={lawData} />}

        {/* Tab 3: 2026 Decision Cases Exporter */}
        {activeTab === 'decisions2026' && (
          <Decisions2026Exporter
            ocKey={ocKey}
            user={user}
            needsAuth={needsAuth}
            onSignIn={handleSignIn}
          />
        )}

        {/* Tab 4: Administrative Rules Notices & Annex Exporter */}
        {activeTab === 'admRules' && (
          <AdmRulesExporter
            ocKey={ocKey}
            user={user}
            needsAuth={needsAuth}
            onSignIn={handleSignIn}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-6 mt-12 bg-slate-950 text-slate-500 text-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 대한민국 국가법령정보포털 Open API 연동 자동화 시스템</p>
          <div className="flex items-center space-x-4">
            <a
              href="https://open.law.go.kr/LSO/usr/usrOcInfoMod.do"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-300 transition-colors"
            >
              국가법령 Open API 센터
            </a>
            <span>•</span>
            <button
              onClick={() => setIsOcKeyModalOpen(true)}
              className="hover:text-slate-300 transition-colors"
            >
              API Key 변경 ({ocKey})
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
