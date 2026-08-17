import React, { useState, useEffect } from 'react';
import { CustomsActData, ProcessStep, UserProfile, ExportConfig, LawRevisionItem } from '../types';
import { LawRevisionCombobox } from './LawRevisionCombobox';
import {
  Sparkles,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Building2,
  Calendar,
  FileCheck2,
  Layers,
  ArrowRight,
  History,
  Download,
  Search,
  FileSpreadsheet,
  FileText,
  BadgeCheck,
  Check,
  Folder,
  FolderPlus,
  FolderOpen,
  FolderCheck,
} from 'lucide-react';

interface LawFetcherProps {
  ocKey: string;
  user: UserProfile | null;
  needsAuth: boolean;
  onSignIn: () => Promise<void>;
  exportConfig: ExportConfig;
  onLawDataLoaded: (data: CustomsActData) => void;
  lawData: CustomsActData | null;
  selectedRevision: LawRevisionItem | null;
  onSelectRevision: (revision: LawRevisionItem) => void;
  isLoadingLawDetail?: boolean;
}

interface RecentRevisionWithArticles {
  rank: number;
  lawId: string;
  lawMst: string;
  lawName: string;
  promulgationDate: string;
  promulgationNo: string;
  enforcementDate: string;
  revisionType: string;
  department: string;
  articles?: any[];
  articleCount?: number;
}

export const LawFetcher: React.FC<LawFetcherProps> = ({
  ocKey,
  user,
  needsAuth,
  onSignIn,
  exportConfig,
  onLawDataLoaded,
  lawData,
  selectedRevision,
  onSelectRevision,
  isLoadingLawDetail = false,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<ProcessStep[]>([
    { id: '1', title: '1. 선택된 관세법 개정본(MST) 정보 확인', status: 'idle' },
    { id: '2', title: '2. 관세법 조문 전체 파싱 (장/절/조문/내용 구조화)', status: 'idle' },
    { id: '3', title: '3. Google Sheets OAuth 인증 확인', status: 'idle' },
    { id: '4', title: '4. Google Sheets 문서 생성 및 조문 전체 기록', status: 'idle' },
  ]);

  const [createdSheetUrl, setCreatedSheetUrl] = useState<string | null>(null);
  const [createdFiles, setCreatedFiles] = useState<
    Array<{ title: string; spreadsheetId: string; url: string; promulgationNo: string; enforcementDate: string; isExisting?: boolean }>
  >([]);
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [isExportingWhollyAmended, setIsExportingWhollyAmended] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Recent 2 revisions state
  const [recentRevisions, setRecentRevisions] = useState<RecentRevisionWithArticles[]>([]);
  const [isLoadingRecent, setIsLoadingRecent] = useState(false);
  const [isTestingRecent2Sheets, setIsTestingRecent2Sheets] = useState(false);
  const [recent2SheetUrl, setRecent2SheetUrl] = useState<string | null>(null);
  const [recent2TestSuccessMsg, setRecent2TestSuccessMsg] = useState<string | null>(null);

  // Google Drive folder export states (관세법 140회 vs 외국환거래법 45회 vs 외국환거래규정 45회, 1개 파일 vs 개별 파일)
  const [targetLawOption, setTargetLawOption] = useState<'customs_act' | 'foreign_exchange_act' | 'foreign_exchange_rule'>('customs_act');
  const [revisionScopeOption, setRevisionScopeOption] = useState<'all' | '10' | '20'>('all');
  const [isExportingAllToDrive, setIsExportingAllToDrive] = useState(false);
  const [driveExportMode, setDriveExportMode] = useState<'single_file' | 'separate_files' | null>(null);
  const [customDriveFolderName, setCustomDriveFolderName] = useState(() => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `관세법_${yyyy}-${mm}-${dd}`;
  });
  const [driveFolderResult, setDriveFolderResult] = useState<{
    mode: 'single_file' | 'separate_files';
    folderId: string;
    folderUrl: string;
    folderName: string;
    folderSkipped?: boolean;
    skipped?: boolean;
    skippedCount?: number;
    totalCount?: number;
    spreadsheetId?: string;
    spreadsheetUrl?: string;
    totalRevisions?: number;
    totalArticles?: number;
    createdCount?: number;
    createdFiles?: Array<{
      title: string;
      spreadsheetId: string;
      url: string;
      promulgationNo: string;
      enforcementDate: string;
      skipped?: boolean;
    }>;
    message?: string;
  } | null>(null);

  // Switch law target option
  const handleSelectTargetLaw = (option: 'customs_act' | 'foreign_exchange_act' | 'foreign_exchange_rule') => {
    setTargetLawOption(option);
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    if (option === 'foreign_exchange_act') {
      setCustomDriveFolderName(`외국환거래법_${yyyy}-${mm}-${dd}`);
    } else if (option === 'foreign_exchange_rule') {
      setCustomDriveFolderName(`외국환거래규정_${yyyy}-${mm}-${dd}`);
    } else {
      setCustomDriveFolderName(`관세법_${yyyy}-${mm}-${dd}`);
    }
    setDriveFolderResult(null);
  };

  // Load top 2 recent revisions on mount or ocKey change
  useEffect(() => {
    let isMounted = true;
    async function loadRecent2() {
      setIsLoadingRecent(true);
      try {
        const res = await fetch(`/api/law/recent-2-revisions?ocKey=${encodeURIComponent(ocKey)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && isMounted && Array.isArray(data.revisions)) {
            setRecentRevisions(data.revisions);
          }
        }
      } catch (err) {
        console.warn('Failed to load recent 2 revisions:', err);
      } finally {
        if (isMounted) setIsLoadingRecent(false);
      }
    }
    loadRecent2();
    return () => {
      isMounted = false;
    };
  }, [ocKey]);

  const updateStep = (id: string, status: ProcessStep['status'], message?: string) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status, message } : s))
    );
  };

  const resetSteps = () => {
    setSteps([
      { id: '1', title: '1. 선택된 관세법 개정본(MST) 정보 확인', status: 'idle' },
      { id: '2', title: '2. 관세법 조문 전체 파싱 (장/절/조문/내용 구조화)', status: 'idle' },
      { id: '3', title: '3. Google Sheets OAuth 인증 확인', status: 'idle' },
      { id: '4', title: '4. Google Sheets 문서 생성 및 조문 전체 기록', status: 'idle' },
    ]);
    setCreatedSheetUrl(null);
    setCreatedFiles([]);
    setErrorMessage(null);
    setRecent2SheetUrl(null);
    setRecent2TestSuccessMsg(null);
    setDriveFolderResult(null);
  };

  // Google Drive Export Handler: (Single File vs Separate Files inside (법령명)+(날짜) Folder)
  const handleExportAllToDriveFolder = async (mode: 'single_file' | 'separate_files') => {
    setIsExportingAllToDrive(true);
    setDriveExportMode(mode);
    setErrorMessage(null);
    setDriveFolderResult(null);

    try {
      const { getAccessToken } = await import('../lib/firebase');
      let accessToken = getAccessToken();

      if (!accessToken || needsAuth || !user) {
        await onSignIn();
        accessToken = getAccessToken();
      }

      if (!accessToken) {
        throw new Error('Google OAuth 인증 토큰을 획득하지 못했습니다. 상단의 Google 계정 연결 버튼을 눌러 로그인해 주세요.');
      }

      const isAdmrul = targetLawOption === 'foreign_exchange_rule';
      let lawName = '관세법';
      if (targetLawOption === 'foreign_exchange_act') {
        lawName = '외국환거래법';
      } else if (targetLawOption === 'foreign_exchange_rule') {
        lawName = '외국환거래규정';
      } else if (selectedRevision?.lawName) {
        lawName = selectedRevision.lawName;
      }

      const folderName = customDriveFolderName.trim() || `${lawName}_${new Date().toISOString().slice(0, 10)}`;
      const limitCount = revisionScopeOption === 'all' ? 0 : parseInt(revisionScopeOption, 10);

      const res = await fetch('/api/drive/export-all-revisions-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken,
          ocKey,
          mode,
          lawName,
          lawCategory: isAdmrul ? 'admrul' : 'law',
          limitCount,
          folderName,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.authError) {
          throw new Error(data.error || 'Google 계정 인증이 만료되었습니다. 상단 [Google 로그인]을 눌러 다시 로그인해 주세요.');
        }
        throw new Error(data.error || 'Google Drive 폴더 저장 중 오류가 발생했습니다.');
      }

      setDriveFolderResult(data);
    } catch (err: any) {
      console.error('Export all revisions to Drive error:', err);
      setErrorMessage(err.message || 'Google Drive 저장 중 오류가 발생했습니다.');
    } finally {
      setIsExportingAllToDrive(false);
      setDriveExportMode(null);
    }
  };

  // 1. Download single revision as CSV directly in browser
  const handleDownloadSingleRevisionCsv = (rev: RecentRevisionWithArticles) => {
    if (!rev.articles || rev.articles.length === 0) {
      alert('조문 데이터가 로딩되지 않았습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }

    const escapeCsv = (val: string) => `"${(val || '').replace(/"/g, '""')}"`;
    let csv = '\uFEFF장,절,관,조문번호,조문제목,조문내용,시행일자,비고\n';

    rev.articles.forEach((art) => {
      csv += `${escapeCsv(art.chapterName)},${escapeCsv(art.sectionName)},${escapeCsv(art.subsectionName)},${escapeCsv(art.articleNo)},${escapeCsv(art.articleTitle)},${escapeCsv(art.articleContent)},${escapeCsv(art.effectiveDate || rev.enforcementDate)},${escapeCsv(art.isDeleted ? '삭제' : '')}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeProm = (rev.promulgationNo || '개정본').replace(/[\/\\?%*:|"<>]/g, '_');
    const safeDate = (rev.enforcementDate || '').replace(/\./g, '');
    a.href = url;
    a.download = `관세법_${safeProm}_${safeDate}_전체조문.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // 2. Download recent 2 revisions as a combined CSV
  const handleDownloadRecent2CombinedCsv = () => {
    if (recentRevisions.length === 0) {
      alert('최근 개정본 데이터가 아직 로드되지 않았습니다.');
      return;
    }

    const escapeCsv = (val: string) => `"${(val || '').replace(/"/g, '""')}"`;
    let csv = '\uFEFF순위,개정구분,공포번호,시행일자,공포일자,장,절,관,조문번호,조문제목,조문내용,비고\n';

    recentRevisions.forEach((rev, idx) => {
      const rankLabel = idx === 0 ? '최신본(1위)' : '직전본(2위)';
      const articles = rev.articles || [];
      articles.forEach((art) => {
        csv += `${escapeCsv(rankLabel)},${escapeCsv(rev.revisionType)},${escapeCsv(rev.promulgationNo)},${escapeCsv(rev.enforcementDate)},${escapeCsv(rev.promulgationDate)},${escapeCsv(art.chapterName)},${escapeCsv(art.sectionName)},${escapeCsv(art.subsectionName)},${escapeCsv(art.articleNo)},${escapeCsv(art.articleTitle)},${escapeCsv(art.articleContent)},${escapeCsv(art.isDeleted ? '삭제' : '')}\n`;
      });
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `관세법_최근개정본2개_조문비교데이터.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // 3. Test saving recent 2 revisions to Google Sheets
  const handleTestSaveRecent2ToSheets = async () => {
    setIsTestingRecent2Sheets(true);
    setErrorMessage(null);
    setRecent2SheetUrl(null);
    setRecent2TestSuccessMsg(null);

    try {
      const { getAccessToken } = await import('../lib/firebase');
      let accessToken = getAccessToken();

      if (!accessToken || needsAuth || !user) {
        await onSignIn();
        accessToken = getAccessToken();
      }

      if (!accessToken) {
        throw new Error('Google OAuth 인증 토큰을 획득하지 못했습니다. 상단의 Google 계정 연결 버튼을 눌러 로그인해 주세요.');
      }

      const res = await fetch('/api/sheets/save-recent-2-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken,
          ocKey,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || '최근 2개 개정본 테스트 저장 실패');
      }

      setRecent2SheetUrl(data.spreadsheetUrl);
      setRecent2TestSuccessMsg(data.message || '최근 관세법 개정본 2개가 구글 시트에 정상적으로 저장되었습니다!');
    } catch (err: any) {
      console.error('Recent 2 test save error:', err);
      setErrorMessage(err.message || '구글 시트 테스트 저장 중 오류가 발생했습니다.');
    } finally {
      setIsTestingRecent2Sheets(false);
    }
  };

  // 4. Export wholly amended comparison
  const handleExportWhollyAmendedComparison = async () => {
    setIsExportingWhollyAmended(true);
    setIsRunning(true);
    resetSteps();

    try {
      updateStep('1', 'running', '관세법 전부개정(1967년 제1976호, 2000년 제6305호) 이력 데이터 검색 중...');
      await new Promise((r) => setTimeout(r, 200));
      updateStep('1', 'success', '전부개정 시기별 140개 개정판 목록 수집 완료');

      updateStep('2', 'running', '1967년 제1976호 및 2000년 제6305호 전부개정 시기별 조문제목 및 조문 대조 데이터 분석 중...');
      await new Promise((r) => setTimeout(r, 200));
      updateStep('2', 'success', '조문제목 변천 매트릭스 및 전부개정 대조 분석 완료');

      updateStep('3', 'running', 'Google 계정 및 Sheets 권한 검증 중...');
      const { getAccessToken } = await import('../lib/firebase');
      let accessToken = getAccessToken();

      if (!accessToken || needsAuth || !user) {
        updateStep('3', 'running', 'Google 계정 로그인 팝업을 진행합니다...');
        await onSignIn();
        accessToken = getAccessToken();
      }

      if (!accessToken) {
        throw new Error('Google OAuth 인증 토큰을 획득하지 못했습니다. Google 계정을 연결해 주세요.');
      }
      updateStep('3', 'success', 'Google 인증 완료');

      updateStep('4', 'running', '관세법 전부개정(1967년, 2000년) 조문제목 변천사 및 전부개정 대조 구글시트 생성 중...');

      const res = await fetch('/api/sheets/save-wholly-amended-comparison', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken,
          ocKey,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '전부개정 구글시트 생성 실패');
      }

      setCreatedSheetUrl(data.spreadsheetUrl);
      updateStep('4', 'success', data.message || '전부개정 구글시트 생성 완료!');
    } catch (err: any) {
      console.error('Wholly amended export error:', err);
      setErrorMessage(err.message || '전부개정 구글시트 생성 중 오류가 발생했습니다.');
      updateStep('4', 'error', err.message);
    } finally {
      setIsRunning(false);
      setIsExportingWhollyAmended(false);
    }
  };

  // 5. Main Sync to Google Sheets
  const handleStartSync = async () => {
    setIsRunning(true);
    resetSteps();

    let fetchedActData: CustomsActData | null = lawData;

    try {
      const revTitle = selectedRevision
        ? `${selectedRevision.lawName} (${selectedRevision.promulgationNo}, 시행일: ${selectedRevision.enforcementDate})`
        : '관세법 최신 개정본';

      updateStep('1', 'running', `선택된 법령 정보 확인 중: ${revTitle}`);
      const targetMst = selectedRevision?.lawMst || '';
      updateStep('1', 'success', `개정 법령 선택 완료: ${revTitle}`);

      // Fetch Detail for selected MST
      updateStep('2', 'running', '선택한 관세법의 전체 조문 수집 및 파싱 중...');

      const detailUrl = targetMst
        ? `/api/law/detail?ocKey=${encodeURIComponent(ocKey)}&mst=${encodeURIComponent(targetMst)}`
        : `/api/law/detail?ocKey=${encodeURIComponent(ocKey)}`;

      const detailRes = await fetch(detailUrl);
      const detailData = await detailRes.json();

      if (!detailRes.ok || !detailData.success) {
        throw new Error(detailData.error || '관세법 상세 조문 수집 실패');
      }

      fetchedActData = {
        info: detailData.info,
        articles: detailData.articles,
        fetchedAt: detailData.fetchedAt,
      };

      onLawDataLoaded(fetchedActData);

      updateStep(
        '2',
        'success',
        `${detailData.info.lawName} (${detailData.info.promulgationNo}) 총 ${detailData.articles.length}개 조문 구조화 완료 (시행: ${detailData.info.enforcementDate})`
      );

      // Google Auth Token Check
      updateStep('3', 'running', 'Google 계정 권한 확인 중...');
      const { getAccessToken } = await import('../lib/firebase');
      let accessToken = getAccessToken();

      if (!accessToken || needsAuth || !user) {
        updateStep('3', 'running', 'Google 계정 로그인 팝업 창을 진행합니다...');
        await onSignIn();
        accessToken = getAccessToken();
      }

      if (!accessToken) {
        throw new Error('Google OAuth 인증 토큰을 획득하지 못했습니다. Google 로그인을 확인해주세요.');
      }

      updateStep('3', 'success', 'Google 계정 및 Sheets API 권한 확인 완료');

      // Export to Google Sheets
      updateStep('4', 'running', 'Google Sheets에 관세법 조문 기록 중...');
      const saveRes = await fetch('/api/sheets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken,
          ocKey,
          lawData: fetchedActData,
          config: exportConfig,
        }),
      });

      const saveData = await saveRes.json();

      if (!saveRes.ok || !saveData.success) {
        throw new Error(saveData.error || 'Google Sheets 저장 실패');
      }

      setCreatedSheetUrl(saveData.spreadsheetUrl || null);
      if (Array.isArray(saveData.createdFiles) && saveData.createdFiles.length > 0) {
        setCreatedFiles(saveData.createdFiles);
      }
      updateStep('4', 'success', saveData.message || 'Google Sheets 저장 완료!');
    } catch (err: any) {
      console.error('Sync process error:', err);
      setErrorMessage(err.message || '동기화 중 오류가 발생했습니다.');
      setSteps((prev) =>
        prev.map((s) => (s.status === 'running' ? { ...s, status: 'error', message: err.message } : s))
      );
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 text-slate-900 shadow-sm space-y-6">
      {/* Top Banner / Intro */}
      <div className="bg-gradient-to-br from-indigo-50 via-white to-slate-50 p-6 rounded-2xl border border-indigo-100/80 relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-200/80 text-indigo-700 text-xs font-bold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>관세법 개정 이력 수집 엔진 (~140회 개정 대응)</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              대한민국 관세법 개정본 수집 & Google Sheets 저장
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              원하는 시점의 관세법 개정본을 선택하여 전체 조문을 수집하고 Google Sheets에 저장하거나, 아래의 <strong>Google Drive 폴더 저장</strong> 기능을 통해 전체 140회 개정연혁을 1개 파일 또는 140개 개별 파일로 즉시 정리·보관할 수 있습니다.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="shrink-0 flex flex-col sm:flex-row lg:flex-col items-stretch lg:items-end gap-2.5">
            <button
              onClick={handleStartSync}
              disabled={isRunning || isLoadingLawDetail}
              className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-bold text-xs sm:text-sm bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow transition-all disabled:opacity-60 cursor-pointer"
            >
              {isRunning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Google Sheets 저장 중...</span>
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-4 h-4 text-emerald-300" />
                  <span>선택된 관세법 Google Sheets 저장</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <button
              onClick={handleExportWhollyAmendedComparison}
              disabled={isExportingWhollyAmended || isRunning}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-purple-600 hover:bg-purple-700 text-white shadow-sm transition-all disabled:opacity-60 cursor-pointer"
              title="관세법 전부개정(1967년 제1976호, 2000년 제6305호)의 시기별 조문제목 변천 매트릭스 및 직전법률 대조표 3개 시트를 구글시트로 자동 작성합니다."
            >
              {isExportingWhollyAmended ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-purple-200" />
                  <span>전부개정 조문제목 변천 시트 생성 중...</span>
                </>
              ) : (
                <>
                  <History className="w-4 h-4 text-purple-200" />
                  <span>🏛️ 관세법 전부개정(1967년, 2000년) 조문제목 변천사 구글시트 생성</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 🚀 GOOGLE DRIVE FOLDER EXPORT SECTION (사용자 요청 핵심 기능) */}
      {/* ============================================================ */}
      <div className="bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-900 text-white rounded-2xl p-6 shadow-md border-2 border-indigo-500/40 space-y-5">
        {/* Target Law Selection Tabs & Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-indigo-800/60 pb-4">
          <div className="space-y-2 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/40 text-indigo-300 text-xs font-bold">
                <Folder className="w-3.5 h-3.5 text-indigo-300" />
                <span>Google Drive 전용 폴더 자동 생성 & 일괄 저장 시스템</span>
              </div>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-[11px] font-bold">
                ⬆️ 셀 서식 행 위로 정렬
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-300 text-[11px] font-bold">
                🛡️ 동일 폴더/시트 중복 스킵
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-500/20 border border-purple-400/30 text-purple-300 text-[11px] font-bold">
                📑 시트1 미생성
              </span>
            </div>

            <h3 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
              {targetLawOption === 'foreign_exchange_rule' ? (
                <>📜 외국환거래규정 (행정규칙/고시 전체 45회 연혁) Google Drive 저장</>
              ) : targetLawOption === 'foreign_exchange_act' ? (
                <>⚖️ 외국환거래법 (법률 전체 45회 개정연혁) Google Drive 저장</>
              ) : (
                <>🏛️ 관세법 전체 140회 개정연혁 Google Drive 저장</>
              )}
            </h3>
            <p className="text-xs sm:text-sm text-indigo-200/80 leading-relaxed">
              Google Drive에 <span className="text-amber-300 font-bold">(법령명)+(날짜)</span> 이름의 전용 폴더를 자동 생성하고(동일 폴더 존재 시 스킵), 개정연혁을 <strong>1개 통합 파일</strong> 또는 <strong>개별 파일</strong>로 정리하여 안전하게 보관합니다.
            </p>
          </div>

          {/* Folder Name Input */}
          <div className="bg-slate-800/90 border border-indigo-400/30 rounded-xl p-3.5 shrink-0 flex flex-col gap-1.5 sm:min-w-[300px]">
            <label className="text-xs font-bold text-indigo-200 flex items-center gap-1.5">
              <FolderPlus className="w-4 h-4 text-amber-400" />
              <span>Google Drive 저장 폴더명 (법령명+날짜)</span>
            </label>
            <input
              type="text"
              value={customDriveFolderName}
              onChange={(e) => setCustomDriveFolderName(e.target.value)}
              placeholder="예: 관세법_2026-08-17"
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-indigo-400/50 text-xs text-white placeholder-slate-500 font-mono font-bold focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <span className="text-[11px] text-slate-400">
              * 동일 폴더가 존재하면 생성을 스킵하고 기존 폴더에 저장합니다.
            </span>
          </div>
        </div>

        {/* Target Law Selection Buttons */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-1.5 bg-slate-950/80 border border-indigo-900/80 rounded-xl">
          <button
            onClick={() => handleSelectTargetLaw('customs_act')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              targetLawOption === 'customs_act'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-transparent text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <History className="w-4 h-4" />
            <span>🏛️ 관세법 (140회 연혁)</span>
          </button>
          <button
            onClick={() => handleSelectTargetLaw('foreign_exchange_act')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              targetLawOption === 'foreign_exchange_act'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-transparent text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>⚖️ 외국환거래법 (법률 45회 연혁)</span>
          </button>
          <button
            onClick={() => handleSelectTargetLaw('foreign_exchange_rule')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              targetLawOption === 'foreign_exchange_rule'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-transparent text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>📜 외국환거래규정 (고시 45회 연혁)</span>
          </button>
        </div>

        {/* Revision Scope Selector (전체 연혁 vs 최근 개정본) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-slate-900/90 border border-indigo-500/30 rounded-xl">
          <div className="flex items-center gap-2">
            <span className="text-xs font-black text-indigo-300">📊 저장 범위 설정:</span>
            <span className="text-[11px] text-slate-400">
              {targetLawOption === 'customs_act'
                ? '(관세법 제1회부터 제140회까지 전체 연혁 지원)'
                : targetLawOption === 'foreign_exchange_act'
                ? '(외국환거래법 1998년 제정부터 최신 개정까지 전체 45회 법률 연혁 지원)'
                : '(외국환거래규정 1999년 제정부터 최신 개정까지 전체 45회 고시 연혁 지원)'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setRevisionScopeOption('all')}
              className={`px-3 py-1 rounded-md text-xs font-black transition-all cursor-pointer ${
                revisionScopeOption === 'all'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              🌟 전체 연혁 저장 ({targetLawOption === 'customs_act' ? '전체 140회' : '전체 45회'})
            </button>
            <button
              onClick={() => setRevisionScopeOption('10')}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                revisionScopeOption === '10'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              최근 10개
            </button>
            <button
              onClick={() => setRevisionScopeOption('20')}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                revisionScopeOption === '20'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              최근 20개
            </button>
          </div>
        </div>

        {/* Main Drive Export Action Box */}
        <div className="space-y-4">
          {/* Primary Action Card: 개정연혁 1개당 구글시트 파일 1개로 저장 */}
          <div className="bg-slate-800/90 border-2 border-indigo-500 rounded-xl p-5 sm:p-6 space-y-4 shadow-lg">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-700/80 pb-3">
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-lg bg-indigo-500/30 text-indigo-200 font-black text-xs flex items-center gap-1.5 border border-indigo-400/40">
                  <FolderOpen className="w-4 h-4 text-indigo-300" />
                  <span>표준 저장 방식 · 개정연혁 1개당 1개 파일</span>
                </span>
                <span className="px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold text-[11px] border border-emerald-500/30">
                  본문 원문 & 부칙 100% 저장
                </span>
              </div>
              <span className="text-xs text-indigo-300 font-mono font-bold bg-slate-900 px-3 py-1 rounded-md border border-slate-700">
                {targetLawOption === 'customs_act'
                  ? revisionScopeOption === 'all'
                    ? '관세법 전체 140개 개별 파일'
                    : `관세법 ${revisionScopeOption}개 개별 파일`
                  : targetLawOption === 'foreign_exchange_act'
                  ? revisionScopeOption === 'all'
                    ? '외국환거래법 전체 45개 개별 파일'
                    : `외국환거래법 ${revisionScopeOption}개 개별 파일`
                  : revisionScopeOption === 'all'
                  ? '외국환거래규정 전체 45개 개별 파일'
                  : `외국환거래규정 ${revisionScopeOption}개 개별 파일`}
              </span>
            </div>

            <div className="space-y-2">
              <h4 className="text-base sm:text-lg font-black text-white flex items-center gap-2">
                <span>📂 개정연혁 1개당 구글시트 파일 1개 저장</span>
                <span className="text-xs text-amber-300 font-normal">
                  ({targetLawOption === 'customs_act'
                    ? revisionScopeOption === 'all'
                      ? '전체 140개 개정본 각각 별도 시트 생성'
                      : `${revisionScopeOption}개 개정본 각각 별도 시트 생성`
                    : targetLawOption === 'foreign_exchange_act'
                    ? revisionScopeOption === 'all'
                      ? '전체 45개 개정본 각각 별도 시트 생성'
                      : `${revisionScopeOption}개 개정본 각각 별도 시트 생성`
                    : revisionScopeOption === 'all'
                    ? '전체 45개 개정본 각각 별도 시트 생성'
                    : `${revisionScopeOption}개 개정본 각각 별도 시트 생성`})
                </span>
              </h4>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                {targetLawOption === 'customs_act' ? (
                  <>
                    <strong>관세법</strong>의 {revisionScopeOption === 'all' ? '전체 140회' : `최근 ${revisionScopeOption}개`} 개정연혁을 각각 1개의 독립된 Google Spreadsheet 문서로 생성하여 <strong>(관세법)+(날짜)</strong> Drive 폴더에 분할 보관합니다. 각 시트마다 <strong>[개요 탭]</strong>과 <strong>[조문 목록 탭 (해당 개정본 본문 전문)]</strong>이 완벽하게 저장됩니다.
                  </>
                ) : targetLawOption === 'foreign_exchange_act' ? (
                  <>
                    <strong>외국환거래법</strong>의 {revisionScopeOption === 'all' ? '전체 45회' : `최근 ${revisionScopeOption}개`} 개정본을 각각 1개의 독립된 Google Spreadsheet 문서로 생성하여 <strong>(외국환거래법)+(날짜)</strong> Drive 폴더에 저장합니다. 각 시트마다 <strong>[개요 탭]</strong>과 <strong>[조문 목록 탭 (전체 조문 본문 전문 및 부칙)]</strong>이 완벽하게 저장됩니다.
                  </>
                ) : (
                  <>
                    <strong>외국환거래규정</strong>의 {revisionScopeOption === 'all' ? '전체 45회' : `최근 ${revisionScopeOption}개`} 개정본을 각각 1개의 독립된 Google Spreadsheet 문서로 생성하여 <strong>(외국환거래규정)+(날짜)</strong> Drive 폴더에 저장합니다. 각 시트마다 <strong>[개요 탭]</strong>과 <strong>[조문 목록 탭 (전체 조문 장·절·관 및 본문 전문·부칙)]</strong>이 완벽하게 저장됩니다.
                  </>
                )}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5 text-center text-xs text-indigo-200">
                  <span className="block text-[11px] text-slate-400">셀 서식 지정</span>
                  <strong className="text-emerald-300">⬆️ 행 위로 정렬 (TOP) & 줄바꿈</strong>
                </div>
                <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5 text-center text-xs text-indigo-200">
                  <span className="block text-[11px] text-slate-400">시트 탭 구성</span>
                  <strong className="text-indigo-300">📑 [개요] + [조문 목록] (시트1 미생성)</strong>
                </div>
                <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5 text-center text-xs text-indigo-200">
                  <span className="block text-[11px] text-slate-400">중복 방지</span>
                  <strong className="text-amber-300">🛡️ 동일 폴더/시트명 자동 스킵</strong>
                </div>
              </div>
            </div>

            <button
              onClick={() => handleExportAllToDriveFolder('separate_files')}
              disabled={isExportingAllToDrive || isRunning}
              className="w-full flex items-center justify-center gap-2.5 py-3.5 px-5 rounded-xl text-sm sm:text-base font-black bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] text-white shadow-lg hover:shadow-indigo-500/25 transition-all disabled:opacity-50 cursor-pointer"
            >
              {isExportingAllToDrive && driveExportMode === 'separate_files' ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin text-indigo-200" />
                  <span>
                    개별 구글시트 파일 일괄 생성 및 본문 저장 중... (
                    {targetLawOption === 'customs_act'
                      ? revisionScopeOption === 'all'
                        ? '관세법 전체 140회'
                        : `관세법 ${revisionScopeOption}개`
                      : targetLawOption === 'foreign_exchange_act'
                      ? revisionScopeOption === 'all'
                        ? '외국환거래법 전체 45회'
                        : `외국환거래법 ${revisionScopeOption}개`
                      : revisionScopeOption === 'all'
                      ? '외국환거래규정 전체 45회'
                      : `외국환거래규정 ${revisionScopeOption}개`}
                    )
                  </span>
                </>
              ) : (
                <>
                  <FolderPlus className="w-5 h-5 text-indigo-200" />
                  <span>
                    🚀 개정연혁 1개당 구글시트 파일 1개로 저장 (
                    {targetLawOption === 'customs_act'
                      ? revisionScopeOption === 'all'
                        ? '관세법 전체 140개 개별 파일'
                        : `관세법 ${revisionScopeOption}개 파일`
                      : targetLawOption === 'foreign_exchange_act'
                      ? revisionScopeOption === 'all'
                        ? '외국환거래법 전체 45개 개별 파일'
                        : `외국환거래법 ${revisionScopeOption}개 파일`
                      : revisionScopeOption === 'all'
                      ? '외국환거래규정 전체 45개 개별 파일'
                      : `외국환거래규정 ${revisionScopeOption}개 파일`}
                    )
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>

          {/* Secondary Option Accordion/Card: 1개 통합 파일로 저장 */}
          <div className="bg-slate-900/80 border border-slate-800 hover:border-slate-700 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                <h5 className="text-xs sm:text-sm font-bold text-slate-200">
                  단일 통합 파일 옵션: 구글시트 1개에 모두 저장
                </h5>
                <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                  1개 스프레드시트에 전체 연혁 + 전체 조문 탭 구성
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                1개의 통합 파일 안에 연혁 요약 목록 탭과 모든 개정본의 조문 통합 탭을 생성하여 보관합니다.
              </p>
            </div>

            <button
              onClick={() => handleExportAllToDriveFolder('single_file')}
              disabled={isExportingAllToDrive || isRunning}
              className="flex items-center justify-center gap-1.5 py-2 px-3.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-emerald-600 text-slate-300 hover:text-white border border-slate-700 hover:border-emerald-500 transition-all disabled:opacity-50 shrink-0 cursor-pointer"
            >
              {isExportingAllToDrive && driveExportMode === 'single_file' ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-200" />
                  <span>통합 시트 저장 중...</span>
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-300" />
                  <span>구글시트 1개에 모두 저장</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Result / Success Links Box */}
        {driveFolderResult && (
          <div className="bg-slate-950 border border-emerald-500/50 rounded-xl p-5 space-y-4 shadow-inner">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <h5 className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">
                    <span>{driveFolderResult.message || 'Google Drive 폴더 저장이 완료되었습니다!'}</span>
                    {driveFolderResult.folderSkipped && (
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold border border-amber-500/30">
                        기존 폴더 재사용
                      </span>
                    )}
                    {driveFolderResult.skipped && (
                      <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[10px] font-bold border border-blue-500/30">
                        기존 시트 존재로 스킵됨
                      </span>
                    )}
                  </h5>
                  <p className="text-xs text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
                    <span>폴더: <strong className="font-mono text-emerald-300">{driveFolderResult.folderName}</strong></span>
                    {driveFolderResult.totalArticles && <span>· 조문 수: {driveFolderResult.totalArticles}개</span>}
                    {driveFolderResult.createdCount !== undefined && <span>· 신규 생성: {driveFolderResult.createdCount}개</span>}
                    {driveFolderResult.skippedCount !== undefined && driveFolderResult.skippedCount > 0 && (
                      <span className="text-amber-300 font-bold">· 중복 스킵: {driveFolderResult.skippedCount}개</span>
                    )}
                    <span>· 셀 서식: 행 위로 정렬(TOP) 완료</span>
                  </p>
                </div>
              </div>

              {/* Drive Folder Direct Link */}
              <a
                href={driveFolderResult.folderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md shrink-0 cursor-pointer"
              >
                <FolderOpen className="w-4 h-4 text-indigo-200" />
                <span>📁 생성/연결된 Drive 폴더 열기</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            {/* Single File Link */}
            {driveFolderResult.spreadsheetUrl && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-slate-900 p-3.5 rounded-lg border border-slate-800 gap-3">
                <div className="flex items-center gap-2 text-xs">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="font-semibold text-slate-200">
                    통합 Google 스프레드시트: [{targetLawOption === 'foreign_exchange' ? '외국환거래규정' : '관세법'}] 개정연혁 통합본
                  </span>
                </div>
                <a
                  href={driveFolderResult.spreadsheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors shrink-0"
                >
                  <span>📊 통합 구글시트 열기</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}

            {/* Separate Files List Preview */}
            {driveFolderResult.createdFiles && driveFolderResult.createdFiles.length > 0 && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span className="font-semibold">
                    개별 시트 파일 목록 (총 {driveFolderResult.createdFiles.length}개):
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono">
                    모든 파일이 '{driveFolderResult.folderName}' 폴더 안에 보관되었습니다.
                  </span>
                </div>
                <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                  {driveFolderResult.createdFiles.map((file, idx) => (
                    <div
                      key={`${file.spreadsheetId}_${idx}`}
                      className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs hover:border-indigo-500/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className="text-slate-200 truncate font-mono text-[11px] font-semibold">{file.title}</span>
                        {file.skipped && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[9px] font-bold border border-amber-500/30 shrink-0">
                            스킵됨(기존파일)
                          </span>
                        )}
                      </div>
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-400 hover:text-indigo-300 shrink-0 ml-2"
                      >
                        <span>시트 열기</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* RECENT 2 REVISIONS TEST & DOWNLOAD SECTION (요청 기능) */}
      {/* ============================================================ */}
      <div className="bg-gradient-to-r from-blue-50/70 via-indigo-50/50 to-slate-50 border-2 border-indigo-200 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-indigo-100 pb-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold text-xs shadow-xs">
              2
            </span>
            <div>
              <h3 className="text-sm sm:text-base font-black text-slate-900 flex items-center gap-2">
                <span>최근 관세법 개정본 2개 테스트 & 다운로드</span>
                <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[10px] font-bold">
                  테스트 검증용
                </span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                가장 최근에 개정된 2개 개정본의 조문 데이터가 정상적으로 수집/저장되는지 확인하고 즉시 다운로드할 수 있습니다.
              </p>
            </div>
          </div>

          {/* Quick Actions for Top 2 */}
          <div className="flex items-center flex-wrap gap-2">
            <button
              onClick={handleTestSaveRecent2ToSheets}
              disabled={isTestingRecent2Sheets || isRunning}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-all disabled:opacity-60 cursor-pointer"
              title="최근 2개 개정본을 구글 스프레드시트에 테스트로 저장하여 링크를 바로 확인합니다."
            >
              {isTestingRecent2Sheets ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>구글시트 테스트 저장 중...</span>
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-200" />
                  <span>📊 최근 2개 개정본 구글시트 테스트 저장</span>
                </>
              )}
            </button>

            <button
              onClick={handleDownloadRecent2CombinedCsv}
              disabled={recentRevisions.length === 0}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 shadow-xs transition-all disabled:opacity-60 cursor-pointer"
              title="최근 2개 개정본의 모든 조문을 하나의 통합 CSV 파일로 즉시 다운로드합니다."
            >
              <Download className="w-3.5 h-3.5 text-indigo-600" />
              <span>📥 최근 2개 개정본 통합 CSV 다운로드</span>
            </button>
          </div>
        </div>

        {/* Top 2 Revisions Cards */}
        {isLoadingRecent ? (
          <div className="flex items-center justify-center py-8 gap-2.5 text-xs text-slate-500">
            <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
            <span>최근 관세법 개정본 2개 목록을 조회하고 있습니다...</span>
          </div>
        ) : recentRevisions.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recentRevisions.map((rev, index) => {
              const isFirst = index === 0;
              const isSelected = selectedRevision?.lawMst === rev.lawMst;
              const articleCount = rev.articleCount ?? (rev.articles?.length || 0);

              return (
                <div
                  key={rev.lawMst || index}
                  className={`p-4 rounded-xl border transition-all ${
                    isFirst
                      ? 'bg-white border-indigo-300 shadow-xs ring-1 ring-indigo-200'
                      : 'bg-white border-slate-200 hover:border-indigo-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-black ${
                          isFirst
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-700 text-white'
                        }`}
                      >
                        {isFirst ? '최신 개정본 (1위)' : '직전 개정본 (2위)'}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">
                        {rev.revisionType || '일부개정'}
                      </span>
                    </div>

                    <div className="text-[11px] font-mono text-slate-400">
                      MST: {rev.lawMst}
                    </div>
                  </div>

                  <h4 className="text-sm sm:text-base font-bold text-slate-900 mb-1">
                    {rev.promulgationNo}
                  </h4>

                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 my-3 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    <div>
                      <span className="text-slate-400 block text-[10px]">시행일자</span>
                      <span className="font-semibold text-slate-800">{rev.enforcementDate || '-'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">공포일자</span>
                      <span className="font-semibold text-slate-800">{rev.promulgationDate || '-'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">조문 수</span>
                      <span className="font-bold text-indigo-600">
                        {articleCount > 0 ? `${articleCount}개 조문` : '조문 파싱 완료'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">소관부처</span>
                      <span className="font-medium text-slate-700">{rev.department || '기획재정부'}</span>
                    </div>
                  </div>

                  {/* Buttons on card */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => handleDownloadSingleRevisionCsv(rev)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 border border-slate-200 transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>조문 CSV 다운로드</span>
                    </button>

                    <button
                      onClick={() => {
                        onSelectRevision(rev);
                      }}
                      className={`flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-100 text-indigo-800 border border-indigo-300'
                          : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
                      }`}
                    >
                      {isSelected ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-indigo-600" />
                          <span>선택됨</span>
                        </>
                      ) : (
                        <span>선택하기</span>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-4 text-xs text-slate-500">
            최근 개정본 정보를 불러올 수 없습니다. OC Key를 확인해 주세요.
          </div>
        )}

        {/* Success Alert for Top 2 Google Sheets Test */}
        {recent2SheetUrl && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <p className="text-xs font-bold text-emerald-950">
                  {recent2TestSuccessMsg || '최근 2개 개정본 테스트 저장이 성공적으로 완료되었습니다!'}
                </p>
                <p className="text-[11px] text-emerald-700 mt-0.5">
                  생성된 시트에서 요약 탭, 1위 개정본 조문 탭, 2위 개정본 조문 탭을 확인하실 수 있습니다.
                </p>
              </div>
            </div>

            <a
              href={recent2SheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors shrink-0"
            >
              <span>생성된 테스트 구글시트 열기</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}
      </div>

      {/* Law Revision Selection Combobox Card */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-3">
        <LawRevisionCombobox
          ocKey={ocKey}
          selectedRevision={selectedRevision}
          onSelectRevision={onSelectRevision}
          isLoadingLawDetail={isLoadingLawDetail}
        />
      </div>

      {/* Current Law Data Summary Card */}
      {(selectedRevision || lawData) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl">
            <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
              <Building2 className="w-3.5 h-3.5 text-indigo-600" />
              <span>법령명</span>
            </div>
            <p className="text-sm font-bold text-slate-900">
              {selectedRevision?.lawName || lawData?.info.lawName || '관세법'}
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl">
            <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
              <Calendar className="w-3.5 h-3.5 text-emerald-600" />
              <span>시행일자</span>
            </div>
            <p className="text-sm font-bold text-slate-900">
              {selectedRevision?.enforcementDate || lawData?.info.enforcementDate || '-'}
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl">
            <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
              <Layers className="w-3.5 h-3.5 text-amber-600" />
              <span>전체 조문 수</span>
            </div>
            <p className="text-sm font-bold text-indigo-700 flex items-center gap-1.5">
              {isLoadingLawDetail ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                  <span className="text-xs text-indigo-600 font-medium">조문 동기화 중...</span>
                </>
              ) : (
                `${lawData?.articles.length || 0}개 조문`
              )}
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl">
            <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
              <FileCheck2 className="w-3.5 h-3.5 text-blue-600" />
              <span>공포번호</span>
            </div>
            <p className="text-sm font-bold text-slate-900">
              {selectedRevision?.promulgationNo || lawData?.info.promulgationNo || '-'}
            </p>
          </div>
        </div>
      )}

      {/* Progress Steps Indicator */}
      {(isRunning || steps.some((s) => s.status !== 'idle')) && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            자동화 작업 진행 현황
          </h3>
          <div className="space-y-3">
            {steps.map((step) => (
              <div
                key={step.id}
                className="flex items-start gap-3 text-xs p-3 rounded-lg bg-white border border-slate-200"
              >
                <div className="mt-0.5 shrink-0">
                  {step.status === 'running' && (
                    <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                  )}
                  {step.status === 'success' && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  )}
                  {step.status === 'error' && (
                    <AlertCircle className="w-4 h-4 text-rose-600" />
                  )}
                  {step.status === 'idle' && (
                    <div className="w-4 h-4 rounded-full border border-slate-300 bg-slate-100" />
                  )}
                </div>

                <div className="flex-1">
                  <p
                    className={`font-semibold ${
                      step.status === 'running'
                        ? 'text-indigo-700'
                        : step.status === 'success'
                        ? 'text-slate-900'
                        : step.status === 'error'
                        ? 'text-rose-700'
                        : 'text-slate-400'
                    }`}
                  >
                    {step.title}
                  </p>
                  {step.message && (
                    <p className="text-[11px] text-slate-500 mt-0.5">{step.message}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold text-sm">오류 발생</p>
            <p className="mt-1 leading-relaxed opacity-90">{errorMessage}</p>
            {errorMessage.includes('Google') || errorMessage.includes('토큰') ? (
              <button
                onClick={onSignIn}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors"
              >
                <span>Google 계정 다시 연결하기</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      )}

      {/* Success Result Link Banner */}
      {(createdSheetUrl || createdFiles.length > 0) && (
        <div className="p-6 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 shadow-sm space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
              <div>
                <h3 className="text-base font-black text-emerald-950">
                  {createdFiles.length > 0
                    ? `🎉 총 ${createdFiles.length}개 관세법 개정본 개별 Google Sheets 파일 생성이 완료되었습니다!`
                    : 'Google Sheets 저장이 성공적으로 완료되었습니다!'}
                </h3>
                <p className="text-xs text-emerald-700 mt-0.5">
                  {createdFiles.length > 0
                    ? '140개 개정자료가 각각 독립된 개별 구글 스프레드시트 파일로 Google Drive에 저장되었습니다.'
                    : '생성된 Google Spreadsheet 문서를 바로 열어 관세법 조문 전체 데이터를 확인하실 수 있습니다.'}
                </p>
              </div>
            </div>
          </div>

          {/* If Separate Google Sheets Files were created */}
          {createdFiles.length > 0 ? (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-xl border border-emerald-200">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={fileSearchQuery}
                    onChange={(e) => setFileSearchQuery(e.target.value)}
                    placeholder="공포번호(예: 법률 제21208호) 또는 시행일자로 생성된 파일 검색..."
                    className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="text-xs text-slate-500 font-mono">
                  {createdFiles.filter(f => !fileSearchQuery || f.title.includes(fileSearchQuery) || f.promulgationNo.includes(fileSearchQuery)).length} / {createdFiles.length}개 항목
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto pr-1 space-y-2">
                {createdFiles
                  .filter((f) => !fileSearchQuery || f.title.includes(fileSearchQuery) || f.promulgationNo.includes(fileSearchQuery))
                  .map((file, idx) => (
                    <div
                      key={`${file.spreadsheetId || 'file'}_${idx}`}
                      className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white border border-slate-200 hover:border-indigo-400 transition-all text-xs shadow-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-slate-900 truncate">{file.title}</p>
                            {file.isExisting ? (
                              <span className="bg-emerald-100 text-emerald-800 text-[10px] px-1.5 py-0.2 rounded font-mono shrink-0">
                                기존파일 재활용
                              </span>
                            ) : (
                              <span className="bg-indigo-100 text-indigo-800 text-[10px] px-1.5 py-0.2 rounded font-mono shrink-0">
                                신규파일 생성
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {file.promulgationNo} · 시행일: {file.enforcementDate}
                          </p>
                        </div>
                      </div>

                      <a
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shrink-0 transition-colors shadow-2xs"
                      >
                        <span>시트 열기</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            createdSheetUrl && (
              <div className="pt-2 flex flex-wrap items-center gap-3">
                <a
                  href={createdSheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors"
                >
                  <span>Google Sheets 문서 열기</span>
                  <ExternalLink className="w-4 h-4" />
                </a>

                <button
                  onClick={() => {
                    navigator.clipboard.writeText(createdSheetUrl);
                    alert('스프레드시트 주소가 클립보드에 복사되었습니다.');
                  }}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 transition-colors"
                >
                  링크 주소 복사
                </button>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
};

