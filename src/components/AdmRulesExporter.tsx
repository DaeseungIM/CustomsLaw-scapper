import React, { useState, useEffect } from 'react';
import { HskItem, HsExplanatoryItem, HsOpinionItem, UserProfile } from '../types';
import { getAccessToken } from '../lib/firebase';
import { HskPreviewModal } from './HskPreviewModal';
import {
  FileSpreadsheet,
  Download,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Search,
  BookOpen,
  FileText,
  ShieldCheck,
  Building2,
  ListOrdered,
  Layers,
  Sparkles,
  ArrowRight,
  Upload,
  Eye,
  FileSpreadsheet as SpreadsheetIcon,
} from 'lucide-react';

interface AdmRulesExporterProps {
  ocKey?: string;
  user?: UserProfile | null;
  needsAuth?: boolean;
  onSignIn?: () => void;
}

export function AdmRulesExporter({
  ocKey,
  user,
  needsAuth,
  onSignIn,
}: AdmRulesExporterProps = {}) {
  const [activeSubTab, setActiveSubTab] = useState<'hsk' | 'explanatory' | 'opinion'>('hsk');
  const [searchTerm, setSearchTerm] = useState('');

  // Data states
  const [hskList, setHskList] = useState<HskItem[]>([]);
  const [expList, setExpList] = useState<HsExplanatoryItem[]>([]);
  const [opList, setOpList] = useState<HsOpinionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dedicated 18,823-line Excel Export State
  const [customTitle, setCustomTitle] = useState<string>('1');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDedicatedExporting, setIsDedicatedExporting] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);
  const [dedicatedResult, setDedicatedResult] = useState<{
    spreadsheetUrl: string;
    message: string;
    totalRows: number;
  } | null>(null);
  const [dedicatedError, setDedicatedError] = useState<string | null>(null);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  // Export state (Master 3-in-1)
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{
    spreadsheetUrl: string;
    message: string;
    hskCount: number;
    explanatoryCount: number;
    opinionCount: number;
  } | null>(null);

  // Handler for the Dedicated Standalone Button (25년 관세통계통합품목분류표_별표.xlsx 전용 구글시트 반영)
  const handleDedicatedHskExport = async () => {
    setIsDedicatedExporting(true);
    setDedicatedResult(null);
    setDedicatedError(null);
    try {
      let accessToken = await getAccessToken();

      if (!accessToken && onSignIn) {
        await onSignIn();
        accessToken = await getAccessToken();
      }

      let fileBase64: string | undefined = undefined;
      if (selectedFile) {
        fileBase64 = await fileToBase64(selectedFile);
      }

      const res = await fetch('/api/export-hsk-excel-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken,
          title: customTitle || '1',
          fileBase64,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || '구글시트 반영에 실패했습니다.');
      }

      setDedicatedResult({
        spreadsheetUrl: data.spreadsheetUrl,
        message: data.message,
        totalRows: data.totalRows || 18823,
      });
    } catch (err: any) {
      console.error('Dedicated HSK export failed:', err);
      setDedicatedError(err.message || '2025 관세통계통합품목분류표 구글시트 반영 중 오류가 발생했습니다.');
    } finally {
      setIsDedicatedExporting(false);
    }
  };

  // Load Administrative Rules Data on mount
  useEffect(() => {
    async function loadAdmRulesData() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/adm-rules/data');
        if (!res.ok) {
          throw new Error(`서버 응답 오류 (${res.status})`);
        }
        const data = await res.json();
        if (data.success) {
          setHskList(data.hskList || []);
          setExpList(data.hsExplanatoryList || []);
          setOpList(data.hsOpinionList || []);
        } else {
          throw new Error(data.error || '데이터를 불러오지 못했습니다.');
        }
      } catch (err: any) {
        console.error('Failed to load adm-rules data:', err);
        setError(err.message || '행정규칙 데이터를 로드하는 중 오류가 발생했습니다.');
      } finally {
        setIsLoading(false);
      }
    }
    loadAdmRulesData();
  }, []);

  // Handle Export to Google Sheets
  const handleExportSheets = async () => {
    setIsExporting(true);
    setExportResult(null);
    setError(null);
    try {
      let accessToken = await getAccessToken();

      if (!accessToken && onSignIn) {
        await onSignIn();
        accessToken = await getAccessToken();
      }

      const res = await fetch('/api/export-adm-rules-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'all', accessToken }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || '구글시트 생성에 실패했습니다.');
      }

      setExportResult({
        spreadsheetUrl: data.spreadsheetUrl,
        message: data.message,
        hskCount: data.hskCount,
        explanatoryCount: data.explanatoryCount,
        opinionCount: data.opinionCount,
      });
    } catch (err: any) {
      console.error('Export failed:', err);
      setError(err.message || '구글시트 저장 중 오류가 발생했습니다.');
    } finally {
      setIsExporting(false);
    }
  };

  // CSV Direct File Download (Excel-compatible UTF-8 with BOM)
  const handleDownloadCSV = (type: 'hsk' | 'explanatory' | 'opinion' | 'all') => {
    const downloadSingleCsv = (filename: string, headers: string[], rows: (string | number)[][]) => {
      const escapeCsv = (val: any) => `"${String(val ?? '').replace(/"/g, '""')}"`;
      const csvLines = [headers.map(escapeCsv).join(','), ...rows.map((r) => r.map(escapeCsv).join(','))];
      const csvContent = '\uFEFF' + csvLines.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    if (type === 'hsk' || type === 'all') {
      const headers = ['HSK 코드', '품목번호', '품명 (한글)', '품명 (영문)', '기본관세율', '협정관세율', '수량단위1', '수량단위2', '비고'];
      const rows = hskList.map((item) => [
        item.hskCode,
        item.pureCode,
        item.nameKo,
        item.nameEn,
        item.generalRate,
        item.agreementRate,
        item.unit1,
        item.unit2,
        item.remarks,
      ]);
      downloadSingleCsv(`1_관세통계통합분류표_HSK_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    }

    if (type === 'explanatory' || type === 'all') {
      const headers = ['구분', '부/류 번호', 'HS 코드', '품목 명칭 (국문)', '품목 명칭 (영문)', '해설서 적용 범위 및 상세 내용', '품목분류 적용기준지침'];
      const rows = expList.map((item) => [
        item.category,
        item.sectionChapter,
        item.hsHeading,
        item.titleKo,
        item.titleEn,
        item.scopeContent,
        item.guideline,
      ]);
      downloadSingleCsv(`2_품목분류적용기준_별표1_HS해설서_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    }

    if (type === 'opinion' || type === 'all') {
      const headers = ['구분', '의견서 번호', 'HS 소호', '품목명 및 상세 규격', 'WCO/관세청 결정의견', '품목분류 결정근거 및 이유', '비고'];
      const rows = opList.map((item) => [
        item.category,
        item.opinionNo,
        item.subheading,
        item.itemName,
        item.opinionText,
        item.rationale,
        item.remarks,
      ]);
      downloadSingleCsv(`3_품목분류적용기준_별표2_HS의견서_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    }
  };

  // Filtered lists for search
  const filteredHsk = hskList.filter(
    (item) =>
      item.hskCode.includes(searchTerm) ||
      item.nameKo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.nameEn.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.pureCode.includes(searchTerm)
  );

  const filteredExp = expList.filter(
    (item) =>
      item.hsHeading.includes(searchTerm) ||
      item.titleKo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.sectionChapter.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.scopeContent.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredOp = opList.filter(
    (item) =>
      item.opinionNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.subheading.includes(searchTerm) ||
      item.itemName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.opinionText.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8">
      {/* Banner / Header Component */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-teal-950 via-slate-900 to-indigo-950 p-6 sm:p-8 border border-teal-800/50 shadow-2xl">
        <div className="absolute top-0 right-0 -mt-12 -mr-12 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-300 text-xs font-semibold">
              <Building2 className="w-3.5 h-3.5" />
              <span>국가법령정보포털 (law.go.kr) 행정규칙 수집기</span>
            </div>
            <a
              href="https://www.law.go.kr/LSW/main.html"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-teal-300 hover:text-teal-200 transition-colors bg-slate-900/60 px-3 py-1.5 rounded-lg border border-teal-800/40"
            >
              <span>law.go.kr 행정규칙 바로가기</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
              <FileSpreadsheet className="w-8 h-8 text-teal-400" />
              <span>행정규칙 관세 고시 & 별표 구글시트 Exporter</span>
            </h2>
            <p className="text-sm text-slate-300 max-w-3xl leading-relaxed">
              법제처 국가법령정보포털 메뉴 중 <strong className="text-teal-300">행정규칙</strong>의 <strong>1. [관세통계통합분류표] 고시 첨부 엑셀 별표</strong>와 <strong>2. [품목분류 적용기준에 관한 고시] 별표1 (HS해설서) & 별표2 (HS품목분류의견서)</strong>를 구글시트로 자동 파싱 및 생성합니다.
            </p>
          </div>

          <div className="pt-2 flex flex-wrap gap-4 text-xs text-slate-400">
            <div className="flex items-center gap-1.5 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>위쪽 정렬 (Top Vertical Align) 자동 적용</span>
            </div>
            <div className="flex items-center gap-1.5 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800">
              <Layers className="w-4 h-4 text-teal-400" />
              <span>자동 줄바꿈 (Text Wrap Strategy) 적용</span>
            </div>
            <div className="flex items-center gap-1.5 bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-800">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>시트별 파스텔 헤더 서식 지정</span>
            </div>
          </div>
        </div>
      </div>

      {/* Dedicated Section & Separate Button for 25년 관세통계통합품목분류표_별표.xlsx (18,823행) */}
      <div className="bg-gradient-to-br from-amber-50 via-white to-indigo-50 border-2 border-amber-300 rounded-2xl p-6 shadow-sm space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-amber-200 pb-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-black border border-amber-300 font-mono">
                ⚡ 별도 전용 작업 버튼
              </span>
              <span className="text-xs text-slate-500 font-mono">18,823행 전체 데이터 처리</span>
            </div>
            <h3 className="text-xl font-black text-slate-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-600" />
              <span>[25년 관세통계통합품목분류표_별표.xlsx] 18,823행 전용 구글시트 반영</span>
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              첫행 <strong className="text-amber-800 font-mono">2025.1.1. 시행</strong> 고시 기준의 <strong className="text-amber-900">품목번호, 품명(국문), 품명(영문)</strong> 및 <strong className="text-amber-900">관세ㆍ통계통합품목분류표의 해석에 관한 통칙(통칙 1~6)</strong>을 포함한 총 18,823개 행 데이터를 그대로 구글시트에 반영합니다.
            </p>
          </div>

          {/* Google Sheets Custom Title & Optional Excel File Selection */}
          <div className="shrink-0 space-y-3 bg-white p-3.5 rounded-xl border border-amber-200 min-w-[300px] shadow-2xs">
            <div className="text-[11px] font-bold text-amber-800 flex items-center gap-1.5">
              <FileSpreadsheet className="w-3.5 h-3.5 text-amber-600" />
              <span>구글시트 제목 및 엑셀파일 지정</span>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-[11px] font-bold text-slate-700 shrink-0">구글시트 제목:</label>
              <input
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="제목 입력 (예: 1)"
                className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 text-amber-900 font-bold rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 w-full"
              />
            </div>

            <div className="space-y-1 pt-1 border-t border-slate-100">
              <label className="text-[11px] font-bold text-slate-700 block">
                엑셀 파일 직접 선택 (선택 사항):
              </label>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                className="block w-full text-[11px] text-slate-500 file:mr-2 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-[11px] file:font-semibold file:bg-amber-100 file:text-amber-800 hover:file:bg-amber-200 cursor-pointer"
              />
              {selectedFile ? (
                <div className="text-[10px] text-emerald-700 font-medium">
                  ✓ 선택됨: {selectedFile.name} (지정한 엑셀파일 내용만 구글시트에 반영)
                </div>
              ) : (
                <div className="text-[10px] text-slate-400">
                  * 미선택 시 2025.1.1. 시행 표준 18,823행 데이터셋이 자동 생성되어 반영됩니다.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Row Metadata Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
          <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
            <div className="text-[10px] text-slate-400 font-semibold">시행일자 Header</div>
            <div className="font-mono font-black text-amber-700">2025.1.1. 시행</div>
          </div>
          <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
            <div className="text-[10px] text-slate-400 font-semibold">핵심 구분 항목</div>
            <div className="font-bold text-slate-800">품목번호(4,6,8,10) | 품명 | Description</div>
          </div>
          <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
            <div className="text-[10px] text-slate-400 font-semibold">특정 위치 앵커 반영</div>
            <div className="font-bold text-indigo-700">4·5행 통칙 / 31행 0101 / 137행 제2류</div>
          </div>
          <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
            <div className="text-[10px] text-slate-400 font-semibold">전체 데이터 수량</div>
            <div className="font-mono font-black text-emerald-700">18,823개 행 (전체)</div>
          </div>
        </div>

        {/* Separate Action Buttons */}
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-200">
          <div className="text-xs text-slate-600 font-medium">
            👉 <strong className="text-amber-800 font-bold">[데이터 미리보기 & 검증]</strong>으로 전체 18,823행을 먼저 확인하신 후, 바로 구글시트로 내보내실 수 있습니다.
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <button
              onClick={() => setIsPreviewOpen(true)}
              className="w-full sm:w-auto px-5 py-3 rounded-xl bg-white hover:bg-slate-50 text-amber-800 font-black text-xs border border-amber-300 shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Eye className="w-4 h-4 text-amber-600" />
              <span>👁️ [18,823행 데이터 미리보기 & 검증]</span>
            </button>

            <button
              onClick={handleDedicatedHskExport}
              disabled={isDedicatedExporting}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-black text-xs shadow-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2 shrink-0 cursor-pointer"
            >
              {isDedicatedExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>18,823행 구글시트 반영 중...</span>
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-4 h-4 text-white" />
                  <span>📊 [25년 관세통계통합품목분류표_별표 (18,823행) 전용 구글시트 반영]</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Dedicated Success Result */}
        {dedicatedResult && (
          <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-500/60 text-emerald-100 space-y-3 animate-fadeIn">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-black text-emerald-300">{dedicatedResult.message}</h4>
                  <p className="text-xs text-emerald-200 mt-0.5 font-mono">
                    총 {dedicatedResult.totalRows.toLocaleString()}개 행 (첫행 2025.1.1. 시행 / 품목번호 / 품명 / 통칙 포함) 전체가 구글 시트에 정상 등록되었습니다.
                  </p>
                </div>
              </div>

              <a
                href={dedicatedResult.spreadsheetUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs shadow-md flex items-center gap-1.5 transition-all"
              >
                <span>생성된 시트 즉시 열기</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
            <div className="text-[11px] font-mono bg-slate-950 p-2.5 rounded border border-emerald-800 text-emerald-300 truncate">
              {dedicatedResult.spreadsheetUrl}
            </div>
          </div>
        )}

        {/* Dedicated Error Result */}
        {dedicatedError && (
          <div className="p-4 rounded-xl bg-red-950/50 border border-red-800 text-red-200 text-xs space-y-2">
            <div className="flex items-center gap-2 font-bold text-red-300">
              <AlertCircle className="w-4 h-4 text-red-400" />
              <span>반영 오류 안내</span>
            </div>
            <p>{dedicatedError}</p>
          </div>
        )}
      </div>

      {/* Main Export Action Card */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <Download className="w-5 h-5 text-teal-600" />
              <span>구글 스프레드시트 내보내기 실행</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              [관세통계통합분류표] 엑셀 별표와 [품목분류 적용기준 고시] 별표1, 별표2를 별도 시트로 구성하여 즉시 생성합니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => handleDownloadCSV('all')}
              className="px-4 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 font-bold text-xs shadow-xs transition-all flex items-center gap-2"
              title="구글 시트 생성 없이 즉시 컴퓨터에 엑셀(CSV) 파일로 저장합니다."
            >
              <Download className="w-4 h-4 text-emerald-600" />
              <span>CSV / 엑셀 전체 다운로드</span>
            </button>

            <button
              onClick={handleExportSheets}
              disabled={isExporting}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-black text-xs shadow-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2.5"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>구글시트 생성 및 서식 적용 중...</span>
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>3개 고시 별표 구글시트 생성하기</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Export Success Result Card */}
        {exportResult && (
          <div className="p-5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-4 animate-fadeIn">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-base font-bold text-emerald-800">{exportResult.message}</h4>
                  <p className="text-xs text-emerald-700 mt-1">
                    [1. 관세통계통합분류표({exportResult.hskCount}건)], [2. 별표1_HS해설서({exportResult.explanatoryCount}건)], [3. 별표2_HS의견서({exportResult.opinionCount}건)] 별도 시트가 성공적으로 저장되었습니다.
                  </p>
                </div>
              </div>

              <a
                href={exportResult.spreadsheetUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs flex items-center gap-2 transition-all"
              >
                <span>구글시트 열기</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>

            <div className="text-xs font-mono bg-white p-3 rounded-lg border border-emerald-200 overflow-x-auto text-emerald-800">
              {exportResult.spreadsheetUrl}
            </div>
          </div>
        )}

        {/* Error Notification */}
        {error && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-900 text-xs space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold text-red-800">Google Sheets API 오류 / 미활성화 안내</p>
                <p className="leading-relaxed">{error}</p>
              </div>
            </div>

            <div className="pt-2 border-t border-red-200 flex flex-wrap items-center justify-between gap-3">
              <span className="text-[11px] text-red-700">
                💡 구글시트 API가 꺼져있어도 데이터를 아래 엑셀(CSV) 버튼으로 즉시 다운로드하실 수 있습니다:
              </span>
              <button
                onClick={() => handleDownloadCSV('all')}
                className="px-3.5 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 text-red-800 font-bold text-xs border border-red-200 transition-all flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV/엑셀 파일로 직다운로드</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Interactive Data Preview Component */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6">
        {/* Header & Search */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-teal-600" />
              <span>수집된 행정규칙 별표 데이터 프리뷰</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              구글시트로 생성되는 관세청 고시 별표 데이터의 세부 내용을 사전 조회합니다.
            </p>
          </div>

          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="HS코드, 품명, 키워드 검색..."
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-teal-500"
            />
          </div>
        </div>

        {/* Sub-Tabs Selector */}
        <div className="flex items-center space-x-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200 overflow-x-auto">
          <button
            onClick={() => setActiveSubTab('hsk')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
              activeSubTab === 'hsk'
                ? 'bg-teal-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
            }`}
          >
            <ListOrdered className="w-4 h-4" />
            <span>1. [관세통계통합분류표] 별표 엑셀</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-800 text-white font-mono">
              {hskList.length}건
            </span>
          </button>

          <button
            onClick={() => setActiveSubTab('explanatory')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
              activeSubTab === 'explanatory'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
            }`}
          >
            <FileText className="w-4 h-4 text-emerald-300" />
            <span>2. [품목분류 적용기준] 별표1 - HS 해설서</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-800 text-white font-mono">
              {expList.length}건
            </span>
          </button>

          <button
            onClick={() => setActiveSubTab('opinion')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
              activeSubTab === 'opinion'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
            }`}
          >
            <Layers className="w-4 h-4 text-amber-300" />
            <span>3. [품목분류 적용기준] 별표2 - HS 품목분류의견서</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-800 text-white font-mono">
              {opList.length}건
            </span>
          </button>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="py-12 text-center space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-teal-600 mx-auto" />
            <p className="text-xs text-slate-500">행정규칙 고시 별표 데이터를 로딩하고 있습니다...</p>
          </div>
        )}

        {/* Table View 1: HSK Tariff Table */}
        {!isLoading && activeSubTab === 'hsk' && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs text-slate-700 border-collapse">
              <thead className="bg-slate-50 text-slate-700 border-b border-slate-200 font-bold uppercase tracking-wider">
                <tr>
                  <th className="p-3">HSK 코드</th>
                  <th className="p-3">품명 (한글)</th>
                  <th className="p-3">품명 (영문)</th>
                  <th className="p-3">기본관세율</th>
                  <th className="p-3">협정관세율</th>
                  <th className="p-3">단위</th>
                  <th className="p-3">비고</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredHsk.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors align-top">
                    <td className="p-3 font-mono text-teal-700 font-bold whitespace-nowrap">{item.hskCode}</td>
                    <td className="p-3 font-semibold text-slate-900 max-w-xs leading-relaxed">{item.nameKo}</td>
                    <td className="p-3 text-slate-500 max-w-xs leading-relaxed italic">{item.nameEn}</td>
                    <td className="p-3 font-mono text-amber-700 font-semibold">{item.generalRate}</td>
                    <td className="p-3 font-mono text-emerald-700 font-semibold">{item.agreementRate}</td>
                    <td className="p-3 font-mono text-slate-600">{item.unit1}</td>
                    <td className="p-3 text-slate-500 max-w-xs text-[11px] leading-relaxed">{item.remarks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Table View 2: HS Explanatory Notes (별표1) */}
        {!isLoading && activeSubTab === 'explanatory' && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs text-slate-700 border-collapse">
              <thead className="bg-slate-50 text-slate-700 border-b border-slate-200 font-bold uppercase tracking-wider">
                <tr>
                  <th className="p-3">구분</th>
                  <th className="p-3">부/류 번호</th>
                  <th className="p-3">HS 코드</th>
                  <th className="p-3">품목 명칭 (국문 / 영문)</th>
                  <th className="p-3">해설서 적용 범위 및 상세 내용</th>
                  <th className="p-3">품목분류 적용기준지침</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredExp.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors align-top">
                    <td className="p-3 font-mono text-emerald-700 font-bold whitespace-nowrap">{item.category}</td>
                    <td className="p-3 font-semibold text-slate-700 whitespace-nowrap">{item.sectionChapter}</td>
                    <td className="p-3 font-mono text-teal-700 font-bold whitespace-nowrap">제{item.hsHeading}호</td>
                    <td className="p-3 max-w-xs space-y-1">
                      <div className="font-bold text-slate-900 leading-relaxed">{item.titleKo}</div>
                      <div className="text-[11px] text-slate-500 italic leading-relaxed">{item.titleEn}</div>
                    </td>
                    <td className="p-3 max-w-md text-slate-700 text-[11px] leading-relaxed">{item.scopeContent}</td>
                    <td className="p-3 max-w-sm text-slate-600 text-[11px] leading-relaxed bg-slate-50 p-2 rounded-lg border border-slate-200">
                      {item.guideline}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Table View 3: HS Classification Opinions (별표2) */}
        {!isLoading && activeSubTab === 'opinion' && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs text-slate-700 border-collapse">
              <thead className="bg-slate-50 text-slate-700 border-b border-slate-200 font-bold uppercase tracking-wider">
                <tr>
                  <th className="p-3">의견서 번호</th>
                  <th className="p-3">HS 소호</th>
                  <th className="p-3">품목명 및 상세 규격</th>
                  <th className="p-3">공식 품목분류 결정의견</th>
                  <th className="p-3">품목분류 결정근거 및 이유</th>
                  <th className="p-3">비고 / 출처</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredOp.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors align-top">
                    <td className="p-3 font-mono text-amber-700 font-bold whitespace-nowrap">{item.opinionNo}</td>
                    <td className="p-3 font-mono text-teal-700 font-bold whitespace-nowrap">{item.subheading}</td>
                    <td className="p-3 max-w-xs font-semibold text-slate-900 leading-relaxed">{item.itemName}</td>
                    <td className="p-3 max-w-md text-slate-700 text-[11px] leading-relaxed">{item.opinionText}</td>
                    <td className="p-3 max-w-sm text-slate-600 text-[11px] leading-relaxed bg-slate-50 p-2 rounded-lg border border-slate-200">
                      {item.rationale}
                    </td>
                    <td className="p-3 text-slate-400 text-[10px] leading-relaxed whitespace-nowrap">{item.remarks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* HSK 18,823 Preview & Verification Modal */}
      <HskPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        onSignIn={onSignIn}
        initialTitle={customTitle}
        initialFile={selectedFile}
      />
    </div>
  );
}
