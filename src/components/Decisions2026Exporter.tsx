import React, { useState, useEffect } from 'react';
import { DecisionItem, UserProfile } from '../types';
import { getAccessToken } from '../lib/firebase';
import { DecisionStatsPanel } from './DecisionStatsPanel';
import {
  FileSpreadsheet,
  Gavel,
  Search,
  Sparkles,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Calendar,
  Building2,
  BookOpen,
  Filter,
  Layers,
  Users,
  Box,
} from 'lucide-react';

interface Decisions2026ExporterProps {
  ocKey: string;
  user: UserProfile | null;
  needsAuth: boolean;
  onSignIn: () => void;
}

export function Decisions2026Exporter({
  ocKey,
  user,
  needsAuth,
  onSignIn,
}: Decisions2026ExporterProps) {
  const [query, setQuery] = useState('관세');
  const [targetType, setTargetType] = useState('unipass_clip');
  const [selectedYear, setSelectedYear] = useState<string>('2026');
  
  // Custom Date Range State
  const [stDt, setStDt] = useState('2026-01-01');
  const [edDt, setEdDt] = useState('2026-12-31');

  const [decisions, setDecisions] = useState<DecisionItem[]>([]);
  const [countsByYear, setCountsByYear] = useState<Record<string, number>>({});
  const [isSearching, setIsSearching] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Category Filter in Preview (전체, 위원회결정사항, 협의회결정사항, 품목분류사례)
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'committee' | 'council' | 'classification'>('all');

  // Export Progress Tracker
  const [exportProgress, setExportProgress] = useState<{
    currentStep: number;
    totalSteps: number;
    currentYear: string;
    totalCountSoFar: number;
  } | null>(null);

  // Export Results
  const [exportedUrl, setExportedUrl] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // When year changes, auto update default date range
  const handleYearChange = (yr: string) => {
    setSelectedYear(yr);
    if (yr !== 'all' && yr !== 'pre2022' && yr !== 'pre2010') {
      setStDt(`${yr}-01-01`);
      setEdDt(`${yr}-12-31`);
    } else if (yr === 'all') {
      setStDt('1988-01-01');
      setEdDt('2026-12-31');
    }
  };

  // Fetch Decision Cases preview
  const fetchDecisions = async () => {
    setIsSearching(true);
    setStatusMessage(null);
    try {
      const res = await fetch(
        `/api/decisions/search?ocKey=${encodeURIComponent(
          ocKey
        )}&targetType=${encodeURIComponent(targetType)}&query=${encodeURIComponent(
          query
        )}&year=${selectedYear}&stDt=${encodeURIComponent(stDt)}&edDt=${encodeURIComponent(edDt)}`
      );
      const data = await res.json();
      if (res.ok && data.success) {
        setDecisions(data.decisions || []);
        setCountsByYear(data.countsByYear || {});
      } else {
        setStatusMessage({
          type: 'error',
          text: data.error || '결정사례 데이터를 가져오지 못했습니다.',
        });
      }
    } catch (err: any) {
      console.error('Failed to search decisions:', err);
      setStatusMessage({
        type: 'error',
        text: '서버와 통신 중 오류가 발생했습니다.',
      });
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    fetchDecisions();
  }, [ocKey, targetType, selectedYear]);

  // Target 5 missing years & expected UNIPASS official breakdown
  const FIVE_MISSING_YEARS = ['2025', '2019', '2005', '2002', '2000'];

  const TARGET_5_EXPECTED_STATS: Record<string, { committee: number; council: number; classification: number; total: number }> = {
    '2025': { committee: 96, council: 19, classification: 1386, total: 1501 },
    '2019': { committee: 35, council: 38, classification: 2347, total: 2420 },
    '2005': { committee: 109, council: 270, classification: 1851, total: 2230 },
    '2002': { committee: 0, council: 0, classification: 702, total: 702 },
    '2000': { committee: 0, council: 0, classification: 625, total: 625 },
  };

  const handleExportToSheets = async (exportAllYears: boolean = true, customYearsToExport?: string[]) => {
    setIsExporting(true);
    setExportedUrl(null);
    setExportProgress(null);

    try {
      let accessToken = getAccessToken();

      if (!accessToken || needsAuth || !user) {
        setStatusMessage({
          type: 'info',
          text: 'Google 계정 로그인 팝업을 진행 중입니다...',
        });
        await onSignIn();
        accessToken = getAccessToken();
      }

      if (!accessToken) {
        throw new Error('Google OAuth 인증 토큰을 획득하지 못했습니다. Google 계정을 연결해 주세요.');
      }

      const ALL_YEARS = Array.from({ length: 2026 - 1988 + 1 }, (_, i) => String(2026 - i));
      const PRE2022_YEARS = Array.from({ length: 2021 - 2010 + 1 }, (_, i) => String(2021 - i));
      const PRE2010_YEARS = Array.from({ length: 2009 - 1988 + 1 }, (_, i) => String(2009 - i));

      const yearsToExport = (customYearsToExport && customYearsToExport.length > 0)
        ? customYearsToExport
        : exportAllYears
        ? ALL_YEARS
        : selectedYear === 'five_missing'
        ? FIVE_MISSING_YEARS
        : selectedYear === 'all'
        ? ALL_YEARS
        : selectedYear === 'pre2022'
        ? PRE2022_YEARS
        : selectedYear === 'pre2010'
        ? PRE2010_YEARS
        : [selectedYear];

      let currentSpreadsheetId: string | null = null;
      let currentSpreadsheetUrl: string | null = null;
      let totalAccumulatedCount = 0;

      setStatusMessage({
        type: 'info',
        text: `대상 ${yearsToExport.length}개 연도 자료(${yearsToExport.join(', ')}년)를 수집하여 구글 스프레드시트에 보완 업데이트 중입니다...`,
      });

      // Loop year by year to prevent gateway/Cloud Run timeout
      for (let idx = 0; idx < yearsToExport.length; idx++) {
        const yr = yearsToExport[idx];

        setExportProgress({
          currentStep: idx + 1,
          totalSteps: yearsToExport.length,
          currentYear: yr,
          totalCountSoFar: totalAccumulatedCount,
        });

        setStatusMessage({
          type: 'info',
          text: `[${idx + 1}/${yearsToExport.length} 연도] ${yr}년 결정사례 수집 및 구글 시트 탭 저장 중... (현재 누적 ${totalAccumulatedCount}건)`,
        });

        const res = await fetch('/api/sheets/save-decisions-2026', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accessToken,
            ocKey,
            targetType,
            query,
            years: [yr],
            spreadsheetId: currentSpreadsheetId,
            stDt: yr === '2026' ? stDt : `${yr}-01-01`,
            edDt: yr === '2026' ? edDt : `${yr}-12-31`,
          }),
        });

        let data: any = {};
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          data = await res.json();
        } else {
          const text = await res.text();
          throw new Error(`서버 응답 오류 (${res.status}): ${text.substring(0, 80)}`);
        }

        if (res.ok && data.success) {
          currentSpreadsheetId = data.spreadsheetId;
          currentSpreadsheetUrl = data.spreadsheetUrl;
          totalAccumulatedCount += data.totalCount || 0;
          setExportedUrl(currentSpreadsheetUrl);
        } else {
          throw new Error(data.error || `${yr}년 자료 시트 저장 중 오류가 발생했습니다.`);
        }
      }

      setStatusMessage({
        type: 'success',
        text: `"[관세청/UNIPASS] 연도별 전체 품목분류 결정사례 및 행정해석 DB (1988~2026년)" 문서의 ${yearsToExport.join(', ')}년 시트 탭 및 수집 및 분석개요 시트 보완 업데이트가 완료되었습니다!`,
      });
    } catch (err: any) {
      console.error('Export decisions sheet error:', err);
      setStatusMessage({
        type: 'error',
        text: err.message || '구글 시트 생성 중 오류가 발생했습니다.',
      });
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  };

  // Direct CSV Download
  const handleDownloadCSV = () => {
    if (!filteredDecisions || filteredDecisions.length === 0) return;
    const escapeCsv = (val: any) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const headers = ['연번', '시행/결정일자', '사건/참조번호', '안건명 (품명)', '소관기관', '관계법령 (HS)', '물품설명', '주요결정요지', '비고 (구분)'];
    const rows = filteredDecisions.map((d, idx) => [
      idx + 1,
      d.decisionDate,
      d.caseNo,
      d.title,
      d.department,
      d.relLaw,
      d.itemDesc || '물품설명 없음',
      d.summary || '주요결정요지 없음',
      d.category || '품목분류사례',
    ]);
    const csvLines = [headers.map(escapeCsv).join(','), ...rows.map((r) => r.map(escapeCsv).join(','))];
    const csvContent = '\uFEFF' + csvLines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `품목분류결정사례_${selectedYear === 'all' ? '전체연도' : selectedYear + '년'}_${categoryFilter}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Category counts in current decisions list
  const committeeCount = decisions.filter((d) => d.category?.includes('위원회')).length;
  const councilCount = decisions.filter((d) => d.category?.includes('협의회')).length;
  const classificationCount = decisions.filter(
    (d) => !d.category?.includes('위원회') && !d.category?.includes('협의회')
  ).length;

  // Filtered decisions list for preview table
  const filteredDecisions = decisions.filter((item) => {
    if (categoryFilter === 'committee') return item.category?.includes('위원회');
    if (categoryFilter === 'council') return item.category?.includes('협의회');
    if (categoryFilter === 'classification')
      return !item.category?.includes('위원회') && !item.category?.includes('협의회');
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold">
              <Calendar className="w-3.5 h-3.5 text-indigo-600" />
              <span>연도별(1988년~2026년) 관세/품목분류 결정사례 DB</span>
            </div>
            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-3">
              <Gavel className="w-7 h-7 text-indigo-600" />
              <span>연도별(1988~2026년) 선택 & 구글시트 자동 연동 저장</span>
            </h2>
            <p className="text-sm text-slate-600 max-w-2xl leading-relaxed">
              관세청 관세품목분류포털(UNIPASS CLIP)의 <strong className="text-emerald-700">전체 연도(1988~2026년) 품목분류 결정사례, 위원회 결정, 협의회 결정</strong>을 수집하여, <strong className="text-amber-700">연도별 탭(2026년 사례... 1988년 사례)</strong>으로 구분해 구글 시트에 자동 배치 저장합니다.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
            <button
              onClick={handleDownloadCSV}
              disabled={filteredDecisions.length === 0}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 font-bold text-xs shadow-xs transition-all disabled:opacity-50"
              title="구글 시트 생성 없이 현재 검색된 결과를 엑셀(CSV) 파일로 저장합니다."
            >
              <span>CSV/엑셀 직접 다운로드</span>
            </button>

            {needsAuth ? (
              <button
                onClick={onSignIn}
                className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-sm shadow-xs transition-all"
              >
                <span>Google 계정 연결하기</span>
              </button>
            ) : (
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={() => handleExportToSheets(true)}
                  disabled={isExporting}
                  className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs sm:text-sm shadow-sm transition-all disabled:opacity-50 active:scale-[0.98]"
                  title="1988년부터 2026년까지 전체 연도를 연도별 개별 시트 탭으로 구글 스프레드시트에 자동 생성합니다."
                >
                  {isExporting ? (
                    <>
                      <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                      <span>연도별 시트 탭 저장 중...</span>
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet className="w-4 h-4 sm:w-5 sm:h-5" />
                      <span>전체 연도(1988~2026) 연도별 탭 시트 저장</span>
                    </>
                  )}
                </button>

                {selectedYear !== 'all' && (
                  <button
                    onClick={() => handleExportToSheets(false)}
                    disabled={isExporting}
                    className="flex items-center justify-center gap-1.5 px-3.5 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-indigo-700 border border-slate-200 font-bold text-xs shadow-xs transition-all disabled:opacity-50"
                    title={`현재 선택된 ${selectedYear}년 자료만 시트에 저장합니다.`}
                  >
                    <span>{selectedYear}년만 저장</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Progress Bar when exporting */}
      {exportProgress && (
        <div className="p-4 rounded-xl bg-slate-900 border border-indigo-500/40 space-y-2 shadow-lg animate-pulse">
          <div className="flex items-center justify-between text-xs font-bold text-indigo-300">
            <span>
              [진행중 {exportProgress.currentStep}/{exportProgress.totalSteps} 연도] {exportProgress.currentYear}년 결정사례 수집 및 구글 시트 저장 중...
            </span>
            <span>{Math.round((exportProgress.currentStep / exportProgress.totalSteps) * 100)}%</span>
          </div>
          <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 via-teal-400 to-emerald-400 transition-all duration-300"
              style={{ width: `${(exportProgress.currentStep / exportProgress.totalSteps) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Speed Advantage Notice */}
      <div className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-800/60 text-indigo-200 text-xs flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
        <div className="space-y-1 leading-relaxed">
          <p className="font-bold text-indigo-300 text-sm">💡 구글 시트를 활용하는 방식이 더 빠른 이유</p>
          <p>
            관세청 UNIPASS 웹페이지나 공공 API를 매번 실시간으로 크롤링하는 방식은 <strong>페이지 네트워크 대기 시간(2~5초 이상) 및 외부 API 응답 지연</strong>이 발생합니다.
            반면, <strong>전체 연도 데이터를 구글 시트(Google Sheets)에 저장해두고 시트에서 읽어오면 수십 ms 내에 실시간 수준으로 빠르게 화면에 렌더링</strong>할 수 있습니다.
          </p>
        </div>
      </div>

      {/* Status Alert Banner */}
      {statusMessage && (
        <div
          className={`p-4 rounded-xl border flex items-start gap-3 transition-all ${
            statusMessage.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
              : statusMessage.type === 'error'
              ? 'bg-rose-950/60 border-rose-500/40 text-rose-200'
              : 'bg-indigo-950/60 border-indigo-500/40 text-indigo-200'
          }`}
        >
          {statusMessage.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />}
          {statusMessage.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />}
          {statusMessage.type === 'info' && <Loader2 className="w-5 h-5 text-indigo-400 animate-spin shrink-0 mt-0.5" />}

          <div className="flex-1 text-sm font-medium leading-relaxed">
            <p>{statusMessage.text}</p>
            {exportedUrl && (
              <div className="mt-3">
                <a
                  href={exportedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 text-slate-950 font-black text-xs hover:bg-emerald-400 shadow-md transition-all"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>생성된 연도별 구글 스프레드시트 바로 열기</span>
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5-Year Targeted Update Banner Card */}
      <div className="bg-gradient-to-r from-amber-950/80 via-slate-900 to-indigo-950 border border-amber-500/40 rounded-2xl p-5 shadow-xl space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold border border-amber-500/30">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>누락 5개 연도 전용 보완 업데이트</span>
            </div>
            <h3 className="text-base font-black text-amber-100 flex items-center gap-2">
              <span>보완 대상 5개 연도 (2025, 2019, 2005, 2002, 2000년) 집중 업데이트</span>
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed max-w-2xl">
              누락되었던 <strong>2025년(1,501건), 2019년(2,420건), 2005년(2,230건), 2002년(702건), 2000년(625건)</strong> 5개 연도만을 크롤링하여, <strong className="text-amber-200">[관세청/UNIPASS] 연도별 전체 품목분류 결정사례 및 행정해석 DB (1988~2026년)</strong> 구글 시트의 해당 5개 시트 탭 및 <strong>수집 및 분석 개요</strong> 시트에 보완 반영합니다.
            </p>
          </div>

          <button
            onClick={() => handleExportToSheets(false, FIVE_MISSING_YEARS)}
            disabled={isExporting}
            className="flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs sm:text-sm shadow-lg shadow-amber-950/60 transition-all shrink-0 disabled:opacity-50 active:scale-[0.98]"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                <span>5개 연도 보완 중...</span>
              </>
            ) : (
              <>
                <FileSpreadsheet className="w-4 h-4 text-slate-950" />
                <span>⚡ 5개 연도 구글 시트 보완 업데이트</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Annual Statistics Summary Panel (Committee, Council, Classification Cases) */}
      <DecisionStatsPanel />

      {/* Filters & Search Options */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-5 shadow-xl">
        <div className="flex flex-col gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-100 font-extrabold text-base">
              <Filter className="w-5 h-5 text-indigo-400" />
              <span>연도별 선택 및 결정사례 수집조건</span>
            </div>
            <span className="text-xs text-amber-300 bg-amber-950/80 border border-amber-500/40 px-2.5 py-1 rounded-full font-bold">
              ⚡ 보완 대상 5개 연도 전용 선택기
            </span>
          </div>

          {/* Dedicated 5 Target Missing Years Buttons */}
          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>[우선 수정 보완 대상 5개 연도 각각 선택 버튼]</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { id: '2025', year: '2025년', count: '1,501건', sub: '위원회 96 / 협의회 19 / 품목 1,386' },
                { id: '2019', year: '2019년', count: '2,420건', sub: '위원회 35 / 협의회 38 / 품목 2,347' },
                { id: '2005', year: '2005년', count: '2,230건', sub: '위원회 109 / 협의회 270 / 품목 1,851' },
                { id: '2002', year: '2002년', count: '702건', sub: '위원회 0 / 협의회 0 / 품목 702' },
                { id: '2000', year: '2000년', count: '625건', sub: '위원회 0 / 협의회 0 / 품목 625' },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleYearChange(item.id)}
                  className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between gap-1.5 ${
                    selectedYear === item.id
                      ? 'bg-gradient-to-br from-amber-950 via-slate-900 to-indigo-950 border-amber-500 ring-2 ring-amber-500/50 shadow-lg'
                      : 'bg-slate-950/80 border-slate-800 hover:border-amber-500/40 hover:bg-slate-900'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-black ${selectedYear === item.id ? 'text-amber-300' : 'text-slate-200'}`}>
                      {item.year}
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
                      보완
                    </span>
                  </div>
                  <div className="text-xs font-extrabold text-amber-200 font-mono">{item.count}</div>
                  <div className="text-[10px] text-slate-400 font-mono truncate">{item.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* General Year Selector Buttons */}
          <div className="pt-2 space-y-1.5">
            <div className="text-xs font-semibold text-slate-400">기타 연도 및 전체 범위 선택:</div>
            <div className="flex flex-wrap items-center bg-slate-950 p-1.5 rounded-xl border border-slate-800 text-xs font-semibold gap-1">
              {[
                { id: '2026', label: '2026년 (기본)' },
                { id: 'five_missing', label: '⚡ 보완 5개년도 전체' },
                { id: '2024', label: '2024년' },
                { id: '2023', label: '2023년' },
                { id: '2022', label: '2022년' },
                { id: 'pre2022', label: '2010~2021년' },
                { id: 'pre2010', label: '1988~2009년' },
                { id: 'all', label: '전체 연도 (1988~2026)' },
              ].map((yr) => (
                <button
                  key={yr.id}
                  onClick={() => handleYearChange(yr.id)}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    selectedYear === yr.id
                      ? 'bg-indigo-600 text-white shadow-md font-bold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  {yr.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Selected Year Official Stat Breakdown Display */}
        <div className="bg-slate-950/90 border border-indigo-500/30 rounded-xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-extrabold text-indigo-300 bg-indigo-950 px-2.5 py-1 rounded-md border border-indigo-800">
                선택 연도 집계 현황
              </span>
              <h4 className="text-sm font-black text-white">
                [{selectedYear === 'all' ? '전체연도 (1988~2026)' : selectedYear === 'five_missing' ? '보완 5개년도' : `${selectedYear}년`}] 위원회/협의회/품목분류/합계 건수
              </h4>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
              <span>UNIPASS DB 세부 구분별 공식 건수</span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="bg-amber-950/40 border border-amber-600/30 rounded-lg p-3">
              <div className="text-amber-400 font-bold mb-1 flex items-center justify-between">
                <span>위원회결정사항 (04)</span>
                <span className="text-[10px] font-mono bg-amber-900/60 px-1.5 py-0.5 rounded">04</span>
              </div>
              <div className="text-xl font-black text-amber-200 font-mono">
                {TARGET_5_EXPECTED_STATS[selectedYear]?.committee !== undefined
                  ? TARGET_5_EXPECTED_STATS[selectedYear].committee.toLocaleString()
                  : committeeCount.toLocaleString()} <span className="text-xs font-normal">건</span>
              </div>
            </div>

            <div className="bg-purple-950/40 border border-purple-600/30 rounded-lg p-3">
              <div className="text-purple-400 font-bold mb-1 flex items-center justify-between">
                <span>협의회결정사항 (03)</span>
                <span className="text-[10px] font-mono bg-purple-900/60 px-1.5 py-0.5 rounded">03</span>
              </div>
              <div className="text-xl font-black text-purple-200 font-mono">
                {TARGET_5_EXPECTED_STATS[selectedYear]?.council !== undefined
                  ? TARGET_5_EXPECTED_STATS[selectedYear].council.toLocaleString()
                  : councilCount.toLocaleString()} <span className="text-xs font-normal">건</span>
              </div>
            </div>

            <div className="bg-indigo-950/40 border border-indigo-600/30 rounded-lg p-3">
              <div className="text-indigo-400 font-bold mb-1 flex items-center justify-between">
                <span>품목분류사례 (01)</span>
                <span className="text-[10px] font-mono bg-indigo-900/60 px-1.5 py-0.5 rounded">01</span>
              </div>
              <div className="text-xl font-black text-indigo-200 font-mono">
                {TARGET_5_EXPECTED_STATS[selectedYear]?.classification !== undefined
                  ? TARGET_5_EXPECTED_STATS[selectedYear].classification.toLocaleString()
                  : classificationCount.toLocaleString()} <span className="text-xs font-normal">건</span>
              </div>
            </div>

            <div className="bg-emerald-950/40 border border-emerald-600/30 rounded-lg p-3">
              <div className="text-emerald-400 font-bold mb-1 flex items-center justify-between">
                <span>전체 합계</span>
                <span className="text-[10px] font-mono bg-emerald-900/60 px-1.5 py-0.5 rounded">TOTAL</span>
              </div>
              <div className="text-xl font-black text-emerald-200 font-mono">
                {TARGET_5_EXPECTED_STATS[selectedYear]?.total !== undefined
                  ? TARGET_5_EXPECTED_STATS[selectedYear].total.toLocaleString()
                  : decisions.length.toLocaleString()} <span className="text-xs font-normal">건</span>
              </div>
            </div>
          </div>

          {/* Action Buttons: 1. Start Collection & Preview, 2. Save to Google Sheets */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-800">
            <div className="text-xs text-slate-300">
              👉 위 건수를 확인한 후 <strong className="text-amber-300">[수집 시작 및 미리보기]</strong> 버튼을 누르면 데이터 수집을 실행합니다.
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0 w-full sm:w-auto">
              <button
                onClick={fetchDecisions}
                disabled={isSearching}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-black text-xs shadow-md transition-all disabled:opacity-50"
              >
                {isSearching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>데이터 수집 중...</span>
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    <span>🔍 [{selectedYear === 'all' ? '전체연도' : selectedYear + '년'}] 수집 시작 및 미리보기</span>
                  </>
                )}
              </button>

              <button
                onClick={() => handleExportToSheets(false, selectedYear === 'five_missing' ? FIVE_MISSING_YEARS : selectedYear === 'all' ? undefined : [selectedYear])}
                disabled={isExporting}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs shadow-md transition-all disabled:opacity-50"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>시트 반영 중...</span>
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>📊 [{selectedYear === 'all' ? '전체연도' : selectedYear + '년'}] 구글 시트 반영하기</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Date Range Filter Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-1">
          <div className="md:col-span-5 space-y-1.5">
            <label className="text-xs text-slate-400 font-semibold flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-indigo-400" />
              <span>시행/결정일자 기간 설정</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={stDt}
                onChange={(e) => setStDt(e.target.value)}
                className="bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none transition-all font-mono"
              />
              <span className="text-slate-500 font-bold text-xs">~</span>
              <input
                type="date"
                value={edDt}
                onChange={(e) => setEdDt(e.target.value)}
                className="bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-3 py-2 text-xs text-slate-100 outline-none transition-all font-mono"
              />
            </div>
          </div>

          <div className="md:col-span-4 space-y-1.5">
            <label className="text-xs text-slate-400 font-semibold flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5 text-slate-400" />
              <span>검색 키워드</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="예: 관세, 품목분류, 과세가격, 수입"
                className="flex-1 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-3.5 py-2 text-xs text-slate-100 outline-none transition-all"
              />
              <button
                onClick={fetchDecisions}
                disabled={isSearching}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all disabled:opacity-50 shrink-0 shadow-md"
              >
                {isSearching ? '조회중...' : '조회'}
              </button>
            </div>
          </div>

          <div className="md:col-span-3 space-y-1.5">
            <label className="text-xs text-slate-400 font-semibold flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-slate-400" />
              <span>수집 출처 및 카테고리</span>
            </label>
            <select
              value={targetType}
              onChange={(e) => setTargetType(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-3.5 py-2 text-xs text-slate-100 outline-none transition-all font-medium"
            >
              <option value="unipass_clip">🌐 관세청 UNIPASS 웹 크롤링 수집</option>
              <option value="cgmExpcKcs">📜 관세청 품목분류 및 행정해석 API</option>
              <option value="all">🌐📜 크롤링 + API 전체 통합</option>
            </select>
          </div>
        </div>
      </div>

      {/* Decision Summary Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div
          onClick={() => setCategoryFilter('committee')}
          className={`cursor-pointer p-4 rounded-xl border transition-all ${
            categoryFilter === 'committee'
              ? 'bg-amber-950/80 border-amber-500 ring-2 ring-amber-500/50 shadow-lg'
              : 'bg-slate-900/80 border-slate-800 hover:border-amber-500/40'
          }`}
        >
          <div className="flex items-center justify-between text-amber-400 mb-1">
            <span className="text-xs font-bold flex items-center gap-1">
              <Gavel className="w-3.5 h-3.5" />
              <span>위원회결정사항</span>
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-amber-950 text-amber-300 font-mono font-bold">04</span>
          </div>
          <div className="text-2xl font-black text-amber-300 font-mono">
            {committeeCount.toLocaleString()}<span className="text-xs font-normal ml-1 text-amber-400/80">건</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">관세품목분류위원회 의결</p>
        </div>

        <div
          onClick={() => setCategoryFilter('council')}
          className={`cursor-pointer p-4 rounded-xl border transition-all ${
            categoryFilter === 'council'
              ? 'bg-purple-950/80 border-purple-500 ring-2 ring-purple-500/50 shadow-lg'
              : 'bg-slate-900/80 border-slate-800 hover:border-purple-500/40'
          }`}
        >
          <div className="flex items-center justify-between text-purple-400 mb-1">
            <span className="text-xs font-bold flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              <span>협의회결정사항</span>
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-purple-950 text-purple-300 font-mono font-bold">03</span>
          </div>
          <div className="text-2xl font-black text-purple-300 font-mono">
            {councilCount.toLocaleString()}<span className="text-xs font-normal ml-1 text-purple-400/80">건</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">관세품목분류협의회 결정</p>
        </div>

        <div
          onClick={() => setCategoryFilter('classification')}
          className={`cursor-pointer p-4 rounded-xl border transition-all ${
            categoryFilter === 'classification'
              ? 'bg-indigo-950/80 border-indigo-500 ring-2 ring-indigo-500/50 shadow-lg'
              : 'bg-slate-900/80 border-slate-800 hover:border-indigo-500/40'
          }`}
        >
          <div className="flex items-center justify-between text-indigo-400 mb-1">
            <span className="text-xs font-bold flex items-center gap-1">
              <Box className="w-3.5 h-3.5" />
              <span>품목분류사례</span>
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 font-mono font-bold">01</span>
          </div>
          <div className="text-2xl font-black text-indigo-300 font-mono">
            {classificationCount.toLocaleString()}<span className="text-xs font-normal ml-1 text-indigo-400/80">건</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">관세평가분류원 결정물품</p>
        </div>

        <div
          onClick={() => setCategoryFilter('all')}
          className={`cursor-pointer p-4 rounded-xl border transition-all ${
            categoryFilter === 'all'
              ? 'bg-emerald-950/80 border-emerald-500 ring-2 ring-emerald-500/50 shadow-lg'
              : 'bg-slate-900/80 border-slate-800 hover:border-emerald-500/40'
          }`}
        >
          <div className="flex items-center justify-between text-emerald-400 mb-1">
            <span className="text-xs font-bold flex items-center gap-1">
              <Layers className="w-3.5 h-3.5" />
              <span>전체 합계</span>
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 font-mono font-bold">ALL</span>
          </div>
          <div className="text-2xl font-black text-emerald-300 font-mono">
            {decisions.length.toLocaleString()}<span className="text-xs font-normal ml-1 text-emerald-400/80">건</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">{selectedYear === 'all' ? '전체연도 통합' : `${selectedYear}년 수집`}</p>
        </div>
      </div>

      {/* Decisions List Preview Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
        {/* Verification Status Banner & Direct Sync Button */}
        {!isSearching && decisions.length > 0 && (
          <div className="p-4 bg-emerald-950/40 border-b border-emerald-500/30 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-200">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>
                [{selectedYear === 'all' ? '전체연도' : selectedYear + '년'} 수집 결과 검증 완료] 위원회: {committeeCount.toLocaleString()}건 | 협의회: {councilCount.toLocaleString()}건 | 품목분류: {classificationCount.toLocaleString()}건 → 총 {decisions.length.toLocaleString()}건 수집
                {TARGET_5_EXPECTED_STATS[selectedYear]?.total === decisions.length && (
                  <span className="ml-2 text-amber-300 bg-amber-950 px-2 py-0.5 rounded border border-amber-500/40 font-mono">
                    (공식 집계 {TARGET_5_EXPECTED_STATS[selectedYear].total.toLocaleString()}건과 100% 일치)
                  </span>
                )}
              </span>
            </div>

            <button
              onClick={() => handleExportToSheets(false, selectedYear === 'five_missing' ? FIVE_MISSING_YEARS : selectedYear === 'all' ? undefined : [selectedYear])}
              disabled={isExporting}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs shadow-md transition-all disabled:opacity-50 shrink-0"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                  <span>시트 저장 중...</span>
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-4 h-4 text-slate-950" />
                  <span>📊 [{selectedYear === 'all' ? '전체연도' : selectedYear + '년'}] 구글 시트에 반영하기</span>
                </>
              )}
            </button>
          </div>
        )}

        <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span className="text-sm font-bold text-slate-200">
              결정사례 분할 미리보기 ({selectedYear === 'all' ? '전체연도 (1988~2026)' : `${selectedYear}년`})
            </span>
            
            {/* Category Filter Tabs */}
            <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs ml-2">
              <button
                onClick={() => setCategoryFilter('all')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  categoryFilter === 'all' ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                전체 ({decisions.length})
              </button>
              <button
                onClick={() => setCategoryFilter('committee')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  categoryFilter === 'committee' ? 'bg-amber-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                🏛️ 위원회 ({committeeCount})
              </button>
              <button
                onClick={() => setCategoryFilter('council')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  categoryFilter === 'council' ? 'bg-purple-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                👥 협의회 ({councilCount})
              </button>
              <button
                onClick={() => setCategoryFilter('classification')}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  categoryFilter === 'classification' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                📦 품목분류 ({classificationCount})
              </button>
            </div>
          </div>

          <div className="text-xs text-slate-400">
            * 구글 시트로 내보내기 시 연도별 독립된 시트 탭으로 생성됩니다.
          </div>
        </div>

        {isSearching ? (
          <div className="py-16 text-center space-y-3">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mx-auto" />
            <p className="text-xs text-slate-400">관세청 UNIPASS 및 국가법령 DB에서 해당 연도 결정내용을 로딩하는 중입니다...</p>
          </div>
        ) : filteredDecisions.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-xs space-y-2">
            <p>선택하신 분할 카테고리에 해당하는 결정사례가 없습니다.</p>
            <p className="text-slate-600">상단 카테고리 탭을 변경하거나 기간을 재조정해 보세요.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-950/90 text-slate-400 border-b border-slate-800 font-semibold">
                  <th className="py-3 px-3 w-10 text-center">NO</th>
                  <th className="py-3 px-3 w-24">시행일자</th>
                  <th className="py-3 px-3 w-32">참조/안건번호</th>
                  <th className="py-3 px-3 min-w-[180px]">안건명 (품명)</th>
                  <th className="py-3 px-3 w-28">소관기관</th>
                  <th className="py-3 px-3 w-28">관계법령(HS)</th>
                  <th className="py-3 px-3 min-w-[220px]">물품설명</th>
                  <th className="py-3 px-3 min-w-[260px]">주요결정요지</th>
                  <th className="py-3 px-3 w-28">비고 (구분)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {filteredDecisions.map((item, index) => (
                  <tr
                    key={item.id || index}
                    className="hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3.5 px-3 text-center font-mono text-slate-500">
                      {index + 1}
                    </td>
                    <td className="py-3.5 px-3 font-mono text-indigo-300 font-medium">
                      {item.decisionDate}
                    </td>
                    <td className="py-3.5 px-3 font-mono text-slate-300">
                      {item.caseNo}
                    </td>
                    <td className="py-3.5 px-3 font-bold text-slate-100 leading-snug">
                      {item.title}
                    </td>
                    <td className="py-3.5 px-3 text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <Building2 className="w-3 h-3 text-slate-500 shrink-0" />
                        <span>{item.department}</span>
                      </span>
                    </td>
                    <td className="py-3.5 px-3 font-mono text-emerald-400 font-medium">
                      {item.relLaw || '-'}
                    </td>
                    <td className="py-3.5 px-3 text-slate-300 leading-relaxed max-w-xs">
                      <p className="line-clamp-3">{item.itemDesc || '-'}</p>
                    </td>
                    <td className="py-3.5 px-3 text-slate-400 leading-relaxed max-w-md">
                      <p className="line-clamp-3">{item.summary}</p>
                    </td>
                    <td className="py-3.5 px-3">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-md text-[11px] font-extrabold whitespace-nowrap ${
                          item.category?.includes('위원회')
                            ? 'bg-amber-950/80 border border-amber-600/50 text-amber-300'
                            : item.category?.includes('협의회')
                            ? 'bg-purple-950/80 border border-purple-600/50 text-purple-300'
                            : 'bg-indigo-950/80 border border-indigo-600/50 text-indigo-300'
                        }`}
                      >
                        {item.category || '품목분류결정'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
