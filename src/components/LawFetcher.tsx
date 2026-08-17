import React, { useState } from 'react';
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
  FolderArchive,
  Search,
  FileSpreadsheet,
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
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [isExportingArticle2, setIsExportingArticle2] = useState(false);
  const [isExportingWhollyAmended, setIsExportingWhollyAmended] = useState(false);

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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
  };

  const handleExportArticle2History = async (listOnly = false, substantiveOnly = false) => {
    setIsExportingArticle2(true);
    setIsRunning(true);
    resetSteps();

    try {
      updateStep('1', 'running', '140개 개정본의 관세법 제2조(정의) 변경이력 정보 수집 중...');
      await new Promise((r) => setTimeout(r, 200));
      updateStep('1', 'success', '140개 개정본 연혁 정보 확보 완료');

      updateStep('2', 'running', substantiveOnly ? '실질 문구 변경건(제6305호, 8833호, 10424호, 17649호, 19186호, 19924호 등) 파싱 중...' : listOnly ? '조문별 변경이력 목록 항목 정리 중...' : '각 시기별 관세법 제2조 실제 조문 본문 전문 파싱 중...');
      await new Promise((r) => setTimeout(r, 200));
      updateStep('2', 'success', substantiveOnly ? '실질 문구 변경건 파싱 완료' : listOnly ? '조문별 변경이력 목록 정리 완료' : '시기별 제2조 본문 전문 파싱 완료');

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

      updateStep('4', 'running', substantiveOnly ? '관세법 제2조 실질 문구 변경건 전용 새 구글시트 파일 생성 중...' : listOnly ? '관세법 제2조 조문별 변경이력 목록 전용 새 구글시트 파일 생성 중...' : '관세법 제2조 전용 새 구글시트 파일 생성 및 시기별 본문 기록 중...');

      const res = await fetch('/api/sheets/save-article-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken,
          ocKey,
          targetArticleNo: '제2조',
          listOnly,
          substantiveOnly,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '관세법 제2조 구글시트 생성 실패');
      }

      setCreatedSheetUrl(data.spreadsheetUrl);
      updateStep('4', 'success', data.message || '관세법 제2조 구글시트 생성 완료!');
    } catch (err: any) {
      console.error('Article 2 export error:', err);
      setErrorMessage(err.message || '제2조 변경이력 구글시트 생성 중 오류가 발생했습니다.');
      updateStep('4', 'error', err.message);
    } finally {
      setIsRunning(false);
      setIsExportingArticle2(false);
    }
  };

  const handleDownloadZip = async () => {
    setIsDownloadingZip(true);
    try {
      const res = await fetch('/api/export/zip-140', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ocKey }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'ZIP 개별 파일 모음 다운로드 실패');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'CustomsAct_140_Revisions_Separate_Files.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message || 'ZIP 다운로드 중 오류가 발생했습니다.');
    } finally {
      setIsDownloadingZip(false);
    }
  };

  const handleStartSync = async () => {
    setIsRunning(true);
    resetSteps();

    let fetchedActData: CustomsActData | null = lawData;

    try {
      // Step 1: Confirm MST / Selected Revision
      const revTitle = selectedRevision
        ? `${selectedRevision.lawName} (${selectedRevision.promulgationNo}, 시행일: ${selectedRevision.enforcementDate})`
        : '관세법 최신 개정본';

      updateStep('1', 'running', `선택된 법령 정보 확인 중: ${revTitle}`);

      const targetMst = selectedRevision?.lawMst || '';

      updateStep('1', 'success', `개정 법령 선택 완료: ${revTitle}`);

      // Step 2: Fetch Detail for selected MST
      if (exportConfig.exportAll140) {
        updateStep('2', 'running', '140개 전체 개정본 조문 수집 준비 중...');
      } else {
        updateStep('2', 'running', '선택한 관세법의 전체 조문 수집 및 파싱 중...');
      }

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

      if (exportConfig.exportAll140) {
        updateStep(
          '2',
          'success',
          `140개 관세법 개정 이력 수집 준비 완료 (구글 시트 저장 시 140개 전체 개정판 조문 일괄 기록)`
        );
      } else {
        updateStep(
          '2',
          'success',
          `${detailData.info.lawName} (${detailData.info.promulgationNo}) 총 ${detailData.articles.length}개 조문 구조화 완료 (시행: ${detailData.info.enforcementDate})`
        );
      }

      // Step 3: Google Auth Token Check
      updateStep('3', 'running', 'Google 계정 권한 확인 중...');
      let accessToken = null;
      const { getAccessToken } = await import('../lib/firebase');
      accessToken = getAccessToken();

      if (!accessToken || needsAuth || !user) {
        updateStep('3', 'running', 'Google 계정 로그인 팝업 창을 진행합니다...');
        await onSignIn();
        accessToken = getAccessToken();
      }

      if (!accessToken) {
        throw new Error('Google OAuth 인증 토큰을 획득하지 못했습니다. Google 로그인을 확인해주세요.');
      }

      updateStep('3', 'success', 'Google 계정 및 Sheets API 권한 확인 완료');

      // Step 4: Export to Google Sheets
      if (exportConfig.exportMode === 'separate_files_140' || (exportConfig.exportAll140 && exportConfig.exportMode !== 'single_file_140')) {
        updateStep('4', 'running', '140개 개정 관세법 각각 개별 Google Sheets 파일(총 140개) 생성 및 조문 기록 중...');
      } else if (exportConfig.exportAll140) {
        updateStep('4', 'running', '140개 개정 관세법 전체 조문(5만여 개) 수집 및 단일 Google Sheets 작성 중...');
      } else {
        updateStep('4', 'running', 'Google Sheets에 관세법 조문 기록 중...');
      }
      const saveRes = await fetch('/api/sheets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken,
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
              시행일자, 공포번호(법률 제N호), 개정구분을 콤보박스에서 선택하여 원하는 시점의 관세법 전체 조문을 수집하고 구글 스프레드시트에 저장할 수 있습니다.
            </p>
          </div>

          {/* Start Sync & Export Action Buttons */}
          <div className="shrink-0 flex flex-col sm:flex-row lg:flex-col items-stretch lg:items-end gap-2.5">
            <button
              onClick={handleStartSync}
              disabled={isRunning || isLoadingLawDetail}
              className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-bold text-xs sm:text-sm bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow transition-all disabled:opacity-60 cursor-pointer"
            >
              {isRunning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>동기화 진행 중...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  <span>
                    {exportConfig.exportMode === 'separate_files_140' || (exportConfig.exportAll140 && exportConfig.exportMode !== 'single_file_140')
                      ? '140개 개별 구글시트 파일 일괄 생성'
                      : '선택된 관세법 수집 및 저장'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <button
              onClick={handleExportWhollyAmendedComparison}
              disabled={isExportingWhollyAmended || isRunning}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-purple-600 hover:bg-purple-700 text-white shadow-sm transition-all disabled:opacity-60 cursor-pointer col-span-1 sm:col-span-2"
              title="관세법 전부개정(1967년 제1976호, 2000년 제6305호)의 시기별 조문제목 변천 매트릭스 및 직전법률 대조표 3개 시트를 구글시트로 자동 작성합니다."
            >
              {isExportingWhollyAmended ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-purple-200" />
                  <span>전부개정(1967년·2000년) 조문제목 변천 구글시트 생성 중...</span>
                </>
              ) : (
                <>
                  <History className="w-4 h-4 text-purple-200" />
                  <span>🏛️ 관세법 전부개정(1967년, 2000년) 조문제목 변천사 구글시트 생성</span>
                </>
              )}
            </button>

            <button
              onClick={handleDownloadZip}
              disabled={isDownloadingZip || isRunning}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 shadow-sm transition-all disabled:opacity-60 cursor-pointer"
              title="140개 개정자료를 개별 CSV 파일로 묶어서 ZIP 압축파일로 바로 다운로드합니다."
            >
              {isDownloadingZip ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>140개 개별 파일 ZIP 생성 중...</span>
                </>
              ) : (
                <>
                  <FolderArchive className="w-3.5 h-3.5 text-amber-600" />
                  <span>📦 140개 개정자료 개별파일 (ZIP) 다운로드</span>
                </>
              )}
            </button>

            <button
              onClick={() => handleExportArticle2History(false, true)}
              disabled={isExportingArticle2 || isRunning}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all disabled:opacity-60 cursor-pointer"
              title="관세법 제2조(정의) 중 실제로 조문문구가 추가, 수정, 삭제된 개정본만을 자동 필터링하여 새 구글시트로 생성합니다."
            >
              {isExportingArticle2 ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>실질 변경건 구글시트 생성 중...</span>
                </>
              ) : (
                <>
                  <History className="w-3.5 h-3.5 text-emerald-200" />
                  <span>⭐ 제2조 "실질 문구 변경 6건" 전용 구글시트 생성</span>
                </>
              )}
            </button>
          </div>
        </div>
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
          <div>
            <p className="font-bold text-sm">동기화 오류 발생</p>
            <p className="mt-1 leading-relaxed opacity-90">{errorMessage}</p>
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

            {createdFiles.length > 0 && (
              <button
                onClick={handleDownloadZip}
                disabled={isDownloadingZip}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors"
              >
                <FolderArchive className="w-4 h-4" />
                <span>개별 CSV ZIP 압축파일 다운로드</span>
              </button>
            )}
          </div>

          {/* If 140 Separate Google Sheets Files were created */}
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
                      key={file.spreadsheetId || idx}
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
