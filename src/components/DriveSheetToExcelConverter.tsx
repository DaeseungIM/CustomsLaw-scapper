import React, { useState, useEffect } from 'react';
import { UserProfile } from '../types';
import { getAccessToken } from '../lib/firebase';
import {
  FileSpreadsheet,
  FolderSync,
  HardDrive,
  Download,
  FolderArchive,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Search,
  ExternalLink,
  ArrowRight,
  Sparkles,
  FileCheck,
  FolderOpen,
  FolderPlus,
  LogIn,
  Check,
  FileDown,
  Layers,
  Clock,
  ShieldCheck
} from 'lucide-react';

interface DriveSheetToExcelConverterProps {
  user: UserProfile | null;
  needsAuth: boolean;
  onSignIn: () => void;
}

interface DriveFolder {
  id: string;
  name: string;
  url: string;
  modifiedTime: string;
  createdTime: string;
}

interface SheetItem {
  id: string;
  name: string;
  url: string;
  modifiedTime: string;
  hasConvertedExcel: boolean;
  expectedExcelName: string;
}

interface ExcelFileItem {
  id: string;
  name: string;
  url: string;
  modifiedTime: string;
  size: string;
}

interface ConvertResultItem {
  sheetId: string;
  sheetName: string;
  excelId: string;
  excelName: string;
  excelUrl: string;
  sizeKb: number;
  status: 'converted' | 'updated' | 'skipped' | 'failed';
  error?: string;
}

export const DriveSheetToExcelConverter: React.FC<DriveSheetToExcelConverterProps> = ({
  user,
  needsAuth,
  onSignIn,
}) => {
  // Folder search / selection state
  const [folderInput, setFolderInput] = useState('');
  const [folderSearchQuery, setFolderSearchQuery] = useState('');
  const [recentFolders, setRecentFolders] = useState<DriveFolder[]>([]);
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);

  // Selected folder and files state
  const [currentFolder, setCurrentFolder] = useState<{ id: string; name: string; url: string } | null>(null);
  const [sheets, setSheets] = useState<SheetItem[]>([]);
  const [excelFiles, setExcelFiles] = useState<ExcelFileItem[]>([]);
  const [selectedSheetIds, setSelectedSheetIds] = useState<string[]>([]);
  const [isLoadingSheets, setIsLoadingSheets] = useState(false);
  const [filterKeyword, setFilterKeyword] = useState('');

  // Conversion options
  const [destinationMode, setDestinationMode] = useState<'same_folder' | 'subfolder'>('same_folder');
  const [customSubfolderName, setCustomSubfolderName] = useState('');
  const [overwrite, setOverwrite] = useState(true);

  // Conversion execution state
  const [isConverting, setIsConverting] = useState(false);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [downloadingSingleId, setDownloadingSingleId] = useState<string | null>(null);
  const [conversionProgress, setConversionProgress] = useState<{ current: number; total: number; percent: number }>({
    current: 0,
    total: 0,
    percent: 0,
  });
  const [conversionResults, setConversionResults] = useState<ConvertResultItem[] | null>(null);
  const [resultFolder, setResultFolder] = useState<{ id: string; name: string; url: string } | null>(null);

  // Error & notification state
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Load user's recent Google Drive folders on login
  useEffect(() => {
    if (!needsAuth && user) {
      loadUserFolders();
    }
  }, [needsAuth, user]);

  // Set default subfolder name when current folder changes
  useEffect(() => {
    if (currentFolder) {
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      setCustomSubfolderName(`[엑셀변환_${currentFolder.name}_${today}]`);
    }
  }, [currentFolder]);

  // Function to load folders from Google Drive
  const loadUserFolders = async (query = '') => {
    const token = getAccessToken();
    if (!token) return;

    setIsLoadingFolders(true);
    try {
      const res = await fetch('/api/drive/list-user-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: token, query }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setRecentFolders(data.folders || []);
      } else {
        console.warn('Folder list warning:', data.error);
      }
    } catch (err) {
      console.error('Error fetching folders:', err);
    } finally {
      setIsLoadingFolders(false);
    }
  };

  // Function to load Google Sheets inside the targeted folder
  const handleLoadFolderSheets = async (targetInput?: string) => {
    const token = getAccessToken();
    if (!token) {
      setStatusMessage({ type: 'error', text: 'Google 계정 로그인이 필요합니다.' });
      return;
    }

    const inputToUse = targetInput || folderInput;
    if (!inputToUse.trim()) {
      setStatusMessage({ type: 'error', text: '조회할 구글 드라이브 폴더명, ID 또는 링크를 입력해 주세요.' });
      return;
    }

    setIsLoadingSheets(true);
    setStatusMessage(null);
    setConversionResults(null);

    try {
      const res = await fetch('/api/drive/get-folder-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: token,
          folderInput: inputToUse.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setCurrentFolder(data.folder);
        setSheets(data.sheets || []);
        setExcelFiles(data.excelFiles || []);
        // Select all sheets by default
        setSelectedSheetIds((data.sheets || []).map((s: SheetItem) => s.id));
        setStatusMessage({
          type: 'success',
          text: `'${data.folder.name}' 폴더에서 총 ${data.sheetsCount}개의 구글시트 문서를 성공적으로 불러왔습니다.`,
        });
      } else {
        setStatusMessage({ type: 'error', text: data.error || '폴더 내 구글시트 목록을 가져오지 못했습니다.' });
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || '네트워크 오류가 발생했습니다.' });
    } finally {
      setIsLoadingSheets(false);
    }
  };

  // Quick select a folder from the recent folders list
  const handleSelectRecentFolder = (folder: DriveFolder) => {
    setFolderInput(folder.name);
    handleLoadFolderSheets(folder.id);
  };

  // Checkbox toggle handlers
  const handleToggleSelectAll = () => {
    const visibleIds = filteredSheets.map((s) => s.id);
    const allSelected = visibleIds.every((id) => selectedSheetIds.includes(id));

    if (allSelected) {
      setSelectedSheetIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedSheetIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const handleToggleSheet = (sheetId: string) => {
    setSelectedSheetIds((prev) =>
      prev.includes(sheetId) ? prev.filter((id) => id !== sheetId) : [...prev, sheetId]
    );
  };

  // 1. Execute Batch Convert to Excel and save in Google Drive
  const handleBatchConvertInDrive = async () => {
    const token = getAccessToken();
    if (!token || !currentFolder) {
      setStatusMessage({ type: 'error', text: '구글 로그인 및 대상 폴더 조회가 필요합니다.' });
      return;
    }

    if (selectedSheetIds.length === 0) {
      setStatusMessage({ type: 'error', text: '변환할 구글시트를 최소 1개 이상 선택해 주세요.' });
      return;
    }

    setIsConverting(true);
    setStatusMessage(null);
    setConversionProgress({ current: 0, total: selectedSheetIds.length, percent: 0 });

    try {
      const res = await fetch('/api/drive/batch-convert-sheets-to-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: token,
          folderId: currentFolder.id,
          fileIds: selectedSheetIds,
          destination: destinationMode,
          customSubfolderName,
          overwrite,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setConversionResults(data.results || []);
        setResultFolder(data.targetFolder || currentFolder);
        setStatusMessage({
          type: 'success',
          text: data.message || `총 ${data.totalConverted}개 파일이 엑셀(.xlsx)로 변환되었습니다.`,
        });
        // Reload folder file counts
        handleLoadFolderSheets(currentFolder.id);
      } else {
        setStatusMessage({ type: 'error', text: data.error || '엑셀 일괄 변환 처리 중 오류가 발생했습니다.' });
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || '엑셀 변환 요청 중 네트워크 오류가 발생했습니다.' });
    } finally {
      setIsConverting(false);
    }
  };

  // 2. Batch Download as ZIP to user PC
  const handleBatchDownloadZip = async () => {
    const token = getAccessToken();
    if (!token || !currentFolder) {
      setStatusMessage({ type: 'error', text: '구글 로그인 및 대상 폴더 조회가 필요합니다.' });
      return;
    }

    const selectedSheets = sheets.filter((s) => selectedSheetIds.includes(s.id));
    if (selectedSheets.length === 0) {
      setStatusMessage({ type: 'error', text: '다운로드할 구글시트를 최소 1개 이상 선택해 주세요.' });
      return;
    }

    setIsDownloadingZip(true);
    setStatusMessage(null);

    try {
      const zipName = `[엑셀일괄변환]_${currentFolder.name}_${selectedSheets.length}건`;
      const res = await fetch('/api/drive/batch-download-sheets-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: token,
          sheets: selectedSheets.map((s) => ({ id: s.id, name: s.name })),
          zipName,
        }),
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${zipName}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        setStatusMessage({
          type: 'success',
          text: `총 ${selectedSheets.length}개 파일의 엑셀 ZIP 압축 파일('${zipName}.zip')이 다운로드되었습니다.`,
        });
      } else {
        const errData = await res.json();
        setStatusMessage({ type: 'error', text: errData.error || 'ZIP 파일 생성 중 오류가 발생했습니다.' });
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'ZIP 다운로드 중 오류가 발생했습니다.' });
    } finally {
      setIsDownloadingZip(false);
    }
  };

  // 3. Download a single sheet as .xlsx
  const handleDownloadSingleXlsx = async (sheet: SheetItem) => {
    const token = getAccessToken();
    if (!token) return;

    setDownloadingSingleId(sheet.id);
    try {
      const res = await fetch('/api/drive/download-single-sheet-xlsx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: token,
          sheetId: sheet.id,
          sheetName: sheet.name,
        }),
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const cleanName = sheet.name.endsWith('.xlsx') ? sheet.name : `${sheet.name}.xlsx`;
        a.download = cleanName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } else {
        const errData = await res.json();
        alert(errData.error || '엑셀 다운로드에 실패했습니다.');
      }
    } catch (err: any) {
      alert('다운로드 중 오류: ' + err.message);
    } finally {
      setDownloadingSingleId(null);
    }
  };

  // Filter sheets by keyword
  const filteredSheets = sheets.filter((s) =>
    s.name.toLowerCase().includes(filterKeyword.toLowerCase().trim())
  );

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-emerald-900 via-teal-900 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-emerald-500/10 blur-3xl pointer-events-none rounded-full" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-xs font-semibold">
              <FolderArchive className="w-3.5 h-3.5" />
              <span>Google Drive ↔ Microsoft Excel (.xlsx) 연동 자동화</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              구글 드라이브 시트 ➔ 엑셀(.xlsx) 일괄 변환
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              구글 드라이브 내 지정한 폴더(예: 관세법 140회, 외국환거래규정 45회 등)에 보관된 수십~수백 개의 구글시트 파일들을 클릭 한 번으로 **Microsoft Excel (.xlsx)** 파일로 일괄 변환하여 드라이브에 저장하거나 PC로 즉시 압축 다운로드합니다.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
            {needsAuth ? (
              <button
                onClick={onSignIn}
                className="flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-white text-slate-900 hover:bg-slate-100 font-bold text-sm shadow-md transition-all active:scale-95"
              >
                <LogIn className="w-4 h-4 text-emerald-600" />
                <span>Google 계정 로그인</span>
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-white/15">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-semibold text-slate-200">{user?.email}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Step 1: Folder Selection & Search Box */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-sm">
              1
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">구글 드라이브 폴더 지정 및 시트 조회</h2>
              <p className="text-xs text-slate-500">
                변환할 구글시트가 저장된 드라이브 폴더명, 폴더 ID 또는 폴더 공유 URL을 입력하세요.
              </p>
            </div>
          </div>

          {!needsAuth && (
            <button
              onClick={() => loadUserFolders()}
              disabled={isLoadingFolders}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors self-start sm:self-auto"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFolders ? 'animate-spin' : ''}`} />
              <span>드라이브 폴더 새로고침</span>
            </button>
          )}
        </div>

        {/* Input Bar */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <FolderOpen className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={folderInput}
              onChange={(e) => setFolderInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLoadFolderSheets()}
              placeholder="예: [외국환거래규정_20260817] 또는 [관세법_...] 또는 폴더 ID / URL 입력"
              className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-slate-50/70 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white font-mono"
            />
          </div>

          <button
            onClick={() => handleLoadFolderSheets()}
            disabled={isLoadingSheets || needsAuth || !folderInput.trim()}
            className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-sm shadow-sm transition-all shrink-0 active:scale-95"
          >
            {isLoadingSheets ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>폴더 조회 중...</span>
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                <span>폴더 내 시트 조회</span>
              </>
            )}
          </button>
        </div>

        {/* Recent Folders Chip List */}
        {!needsAuth && recentFolders.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
              <span>최근 생성 및 수정된 드라이브 폴더 ({recentFolders.length}개)</span>
            </div>
            <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto p-1">
              {recentFolders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => handleSelectRecentFolder(f)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border transition-all ${
                    currentFolder?.id === f.id
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-700 font-bold shadow-xs'
                      : 'bg-slate-50/80 border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300'
                  }`}
                >
                  <FolderSync className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="truncate max-w-[200px]">{f.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Status / Alert Banner */}
      {statusMessage && (
        <div
          className={`flex items-start gap-3 p-4 rounded-2xl border text-xs sm:text-sm font-medium ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : statusMessage.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-indigo-50 border-indigo-200 text-indigo-800'
          }`}
        >
          {statusMessage.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          )}
          <div className="flex-1">{statusMessage.text}</div>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-slate-400 hover:text-slate-600 font-bold text-xs"
          >
            닫기
          </button>
        </div>
      )}

      {/* Step 2 & 3: Main Folder Workspace when folder is loaded */}
      {currentFolder && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Files Table & Selection (8 cols) */}
          <div className="lg:col-span-8 space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
              {/* Folder Summary & Quick Info */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <FolderSync className="w-5 h-5 text-emerald-600" />
                      <span>{currentFolder.name}</span>
                    </h3>
                    <a
                      href={currentFolder.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-slate-100 transition-colors"
                      title="구글 드라이브에서 폴더 열기"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500 font-medium">
                    <span>구글시트: <strong className="text-emerald-600 font-bold">{sheets.length}개</strong></span>
                    <span>•</span>
                    <span>기존 엑셀파일: <strong className="text-slate-700 font-bold">{excelFiles.length}개</strong></span>
                    <span>•</span>
                    <span>선택됨: <strong className="text-indigo-600 font-bold">{selectedSheetIds.length}개</strong></span>
                  </div>
                </div>

                {/* Search Filter inside sheet list */}
                <div className="relative w-full sm:w-60">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={filterKeyword}
                    onChange={(e) => setFilterKeyword(e.target.value)}
                    placeholder="문서명 검색..."
                    className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-slate-50 focus:bg-white"
                  />
                </div>
              </div>

              {/* Selection Bar */}
              <div className="flex items-center justify-between bg-slate-50 px-4 py-2.5 rounded-xl text-xs text-slate-600 font-medium">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={
                      filteredSheets.length > 0 &&
                      filteredSheets.every((s) => selectedSheetIds.includes(s.id))
                    }
                    onChange={handleToggleSelectAll}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300"
                  />
                  <span>
                    전체 선택 ({selectedSheetIds.length}/{filteredSheets.length})
                  </span>
                </label>

                <div className="text-slate-500">
                  시행일자 최신순(001~) 정렬됨
                </div>
              </div>

              {/* Sheets List Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[460px] overflow-y-auto">
                {filteredSheets.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs">
                    검색 결과와 일치하는 구글시트 파일이 없습니다.
                  </div>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0 z-10 border-b border-slate-200">
                      <tr>
                        <th className="p-3 w-10 text-center">선택</th>
                        <th className="p-3">구글시트 문서명 (파일명)</th>
                        <th className="p-3 w-28 text-center">변환 상태</th>
                        <th className="p-3 w-24 text-center">단일 다운로드</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {filteredSheets.map((sheet, index) => {
                        const isSelected = selectedSheetIds.includes(sheet.id);
                        return (
                          <tr
                            key={sheet.id}
                            className={`hover:bg-slate-50 transition-colors ${
                              isSelected ? 'bg-emerald-50/30' : ''
                            }`}
                          >
                            <td className="p-3 text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleSheet(sheet.id)}
                                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 cursor-pointer"
                              />
                            </td>
                            <td className="p-3 font-sans">
                              <div className="flex items-center gap-2">
                                <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                                <a
                                  href={sheet.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-medium text-slate-900 hover:text-emerald-600 transition-colors line-clamp-1"
                                >
                                  {sheet.name}
                                </a>
                              </div>
                            </td>
                            <td className="p-3 text-center">
                              {sheet.hasConvertedExcel ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-semibold">
                                  <Check className="w-3 h-3" />
                                  <span>XLSX 존재</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[11px]">
                                  미변환
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-center">
                              <button
                                onClick={() => handleDownloadSingleXlsx(sheet)}
                                disabled={downloadingSingleId === sheet.id}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-700 text-[11px] font-medium transition-colors"
                                title="이 시트만 즉시 엑셀로 다운로드"
                              >
                                {downloadingSingleId === sheet.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin text-emerald-600" />
                                ) : (
                                  <FileDown className="w-3 h-3 text-emerald-600" />
                                )}
                                <span>다운로드</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Execution & Options Panel (4 cols) */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">
                  2
                </div>
                <h3 className="text-sm font-bold text-slate-900">엑셀 변환 설정 및 실행</h3>
              </div>

              {/* Option 1: Destination Folder */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 block">
                  저장 위치 (Google Drive)
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setDestinationMode('same_folder')}
                    className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-all ${
                      destinationMode === 'same_folder'
                        ? 'border-emerald-500 bg-emerald-50/50 text-emerald-900 font-bold ring-1 ring-emerald-500'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <FolderSync className="w-4 h-4 text-emerald-600" />
                    <span>동일 폴더 내</span>
                    <span className="text-[10px] text-slate-500 font-normal">시트 옆에 .xlsx 생성</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDestinationMode('subfolder')}
                    className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-all ${
                      destinationMode === 'subfolder'
                        ? 'border-emerald-500 bg-emerald-50/50 text-emerald-900 font-bold ring-1 ring-emerald-500'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <FolderPlus className="w-4 h-4 text-emerald-600" />
                    <span>하위 폴더 생성</span>
                    <span className="text-[10px] text-slate-500 font-normal">별도 폴더 분리 보관</span>
                  </button>
                </div>

                {destinationMode === 'subfolder' && (
                  <div className="pt-2">
                    <label className="text-[11px] text-slate-500 block mb-1">하위 폴더명</label>
                    <input
                      type="text"
                      value={customSubfolderName}
                      onChange={(e) => setCustomSubfolderName(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                )}
              </div>

              {/* Option 2: Overwrite */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700">기존 엑셀파일 덮어쓰기</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overwrite}
                    onChange={(e) => setOverwrite(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                </label>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2.5 pt-2">
                {/* 1. Batch Save to Drive */}
                <button
                  onClick={handleBatchConvertInDrive}
                  disabled={isConverting || isDownloadingZip || selectedSheetIds.length === 0}
                  className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs sm:text-sm shadow-md transition-all active:scale-95"
                >
                  {isConverting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>드라이브 엑셀 변환 중...</span>
                    </>
                  ) : (
                    <>
                      <HardDrive className="w-4 h-4" />
                      <span>Google Drive 내 엑셀 일괄 생성 ({selectedSheetIds.length}건)</span>
                    </>
                  )}
                </button>

                {/* 2. Direct ZIP Download */}
                <button
                  onClick={handleBatchDownloadZip}
                  disabled={isConverting || isDownloadingZip || selectedSheetIds.length === 0}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-emerald-600 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 font-bold text-xs sm:text-sm transition-all"
                >
                  {isDownloadingZip ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>ZIP 압축 파일 생성 중...</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      <span>PC로 엑셀 ZIP 일괄 다운로드</span>
                    </>
                  )}
                </button>
              </div>

              {/* Security & API note */}
              <div className="text-[11px] text-slate-400 flex items-start gap-1.5 pt-2 border-t border-slate-100">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Google Drive Export API를 통해 원본 수식 및 다중 시트 구조가 100% 보존된 표준 XLSX 포맷으로 변환됩니다.
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Live Conversion Results Card */}
      {conversionResults && conversionResults.length > 0 && (
        <div className="bg-white rounded-2xl border border-emerald-200 p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <h3 className="text-base font-bold text-slate-900">
                엑셀 변환 완료 결과 ({conversionResults.length}개 파일)
              </h3>
            </div>

            {resultFolder && (
              <a
                href={resultFolder.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-bold transition-colors"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>'{resultFolder.name}' 드라이브 폴더 열기</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          <div className="border border-slate-200 rounded-xl overflow-hidden max-h-80 overflow-y-auto">
            <table className="w-full text-left text-xs font-sans">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3 w-12 text-center">번호</th>
                  <th className="p-3">변환된 엑셀 파일명</th>
                  <th className="p-3 w-24 text-center">용량</th>
                  <th className="p-3 w-28 text-center">결과</th>
                  <th className="p-3 w-32 text-center">바로가기</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {conversionResults.map((item, idx) => (
                  <tr key={item.sheetId + idx} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 text-center text-slate-400">{idx + 1}</td>
                    <td className="p-3 font-sans">
                      <div className="flex items-center gap-2">
                        <FileCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span className="font-medium text-slate-900 line-clamp-1">{item.excelName}</span>
                      </div>
                    </td>
                    <td className="p-3 text-center text-slate-500">{item.sizeKb > 0 ? `${item.sizeKb} KB` : '-'}</td>
                    <td className="p-3 text-center">
                      {item.status === 'converted' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold">
                          생성 완료
                        </span>
                      ) : item.status === 'updated' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[11px] font-bold">
                          갱신 완료
                        </span>
                      ) : item.status === 'skipped' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px]">
                          기존 유지
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[11px] font-bold">
                          실패
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-center font-sans">
                      {item.excelUrl ? (
                        <a
                          href={item.excelUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-800 font-semibold text-xs"
                        >
                          <span>드라이브 열기</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
