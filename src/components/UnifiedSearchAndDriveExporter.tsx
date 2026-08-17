import React, { useState, useEffect } from 'react';
import {
  Search,
  BookOpen,
  FileSpreadsheet,
  FolderPlus,
  Shield,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  ChevronRight,
  Layers,
  Sparkles,
  Calendar,
  Building,
  FileText,
  RotateCcw,
  CheckSquare,
  Square,
  Lock,
  Globe,
  Share2
} from 'lucide-react';
import {
  SearchTargetType,
  UnifiedSearchItem,
  UnifiedRevisionItem,
  DriveFolderInfo,
  DrivePermissionOption,
  SaveProgressState,
  UserProfile
} from '../types';
import { getAccessToken } from '../lib/firebase';
import { DrivePermissionModal } from './DrivePermissionModal';

interface UnifiedSearchAndDriveExporterProps {
  ocKey: string;
  user: UserProfile | null;
  needsAuth: boolean;
  onSignIn: () => void;
  onOpenOcKeyModal: () => void;
}

export const UnifiedSearchAndDriveExporter: React.FC<UnifiedSearchAndDriveExporterProps> = ({
  ocKey,
  user,
  needsAuth,
  onSignIn,
  onOpenOcKeyModal,
}) => {
  // Search state
  const [targetType, setTargetType] = useState<SearchTargetType>('law');
  const [searchQuery, setSearchQuery] = useState<string>('관세법');
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<UnifiedSearchItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<UnifiedSearchItem | null>(null);

  // Revision state
  const [isLoadingRevisions, setIsLoadingRevisions] = useState<boolean>(false);
  const [revisions, setRevisions] = useState<UnifiedRevisionItem[]>([]);
  const [selectedRevisions, setSelectedRevisions] = useState<Record<string, boolean>>({});

  // Drive Export & Permission state
  const [isPermissionModalOpen, setIsPermissionModalOpen] = useState<boolean>(false);
  const [customFolderName, setCustomFolderName] = useState<string>('');
  const [isRevokingPermissions, setIsRevokingPermissions] = useState<boolean>(false);
  const [revokeSuccessMessage, setRevokeSuccessMessage] = useState<string | null>(null);

  // Progress state
  const [progress, setProgress] = useState<SaveProgressState>({
    isSaving: false,
    currentStep: 0,
    totalSteps: 0,
    percentage: 0,
    message: '',
    folderInfo: null,
    savedSheets: [],
    error: null,
  });

  // Calculate default folder name whenever selectedItem changes
  useEffect(() => {
    if (selectedItem) {
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const cleanName = selectedItem.name.replace(/[\/\\:*?"<>|]/g, '_');
      setCustomFolderName(`[${cleanName}_${today}]`);
    }
  }, [selectedItem]);

  // Initial Search on mount
  useEffect(() => {
    handleSearch();
  }, [targetType]);

  // Execute Search
  const handleSearch = async (overrideQuery?: string) => {
    const q = overrideQuery !== undefined ? overrideQuery : searchQuery;
    setIsSearching(true);
    setSearchResults([]);
    setSelectedItem(null);
    setRevisions([]);
    setSelectedRevisions({});
    setProgress((prev) => ({ ...prev, savedSheets: [], folderInfo: null, error: null }));

    try {
      const res = await fetch(
        `/api/unified/search?ocKey=${encodeURIComponent(ocKey)}&targetType=${targetType}&query=${encodeURIComponent(
          q || (targetType === 'admrul' ? '관세' : '관세법')
        )}&display=500`
      );
      const data = await res.json();

      if (res.ok && data.success) {
        setSearchResults(data.results || []);
        if (data.results && data.results.length > 0) {
          // Auto-select first item
          handleSelectItem(data.results[0]);
        }
      } else {
        console.warn('Search failed:', data.error);
      }
    } catch (err: any) {
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  // Select Item and Fetch its Full Revisions
  const handleSelectItem = async (item: UnifiedSearchItem) => {
    setSelectedItem(item);
    setIsLoadingRevisions(true);
    setRevisions([]);
    setSelectedRevisions({});
    setProgress((prev) => ({ ...prev, savedSheets: [], folderInfo: null, error: null }));

    try {
      const res = await fetch(
        `/api/unified/revisions?ocKey=${encodeURIComponent(ocKey)}&targetType=${item.targetType}&name=${encodeURIComponent(
          item.name
        )}`
      );
      const data = await res.json();

      if (res.ok && data.success) {
        const revList: UnifiedRevisionItem[] = data.revisions || [];
        setRevisions(revList);

        // By default, select all revisions
        const initialSelected: Record<string, boolean> = {};
        revList.forEach((r, idx) => {
          const revKey = `${r.id || r.seq || 'rev'}_${r.enforcementDate || ''}_${idx}`;
          initialSelected[revKey] = true;
        });
        setSelectedRevisions(initialSelected);
      }
    } catch (err: any) {
      console.error('Fetch revisions error:', err);
    } finally {
      setIsLoadingRevisions(false);
    }
  };

  // Toggle selection for a single revision
  const handleToggleRevision = (id: string) => {
    setSelectedRevisions((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // Toggle select all revisions
  const handleSelectAll = (check: boolean) => {
    const next: Record<string, boolean> = {};
    revisions.forEach((r, idx) => {
      const revKey = `${r.id || r.seq || 'rev'}_${r.enforcementDate || ''}_${idx}`;
      next[revKey] = check;
    });
    setSelectedRevisions(next);
  };

  const selectedCount = Object.values(selectedRevisions).filter(Boolean).length;
  const isAllSelected = revisions.length > 0 && selectedCount === revisions.length;

  // Open Permission Modal before starting Drive save
  const handleStartDriveExport = () => {
    if (needsAuth) {
      onSignIn();
      return;
    }
    if (selectedCount === 0) {
      alert('저장할 개정연혁을 최소 1개 이상 선택해 주세요.');
      return;
    }
    setIsPermissionModalOpen(true);
  };

  // Trigger Google Drive Export after permission confirmation
  const handleConfirmDriveExport = async (permissionOption: DrivePermissionOption) => {
    setIsPermissionModalOpen(false);

    const token = getAccessToken();
    if (!token) {
      alert('Google 인증 토큰이 만료되었습니다. 다시 로그인해 주세요.');
      onSignIn();
      return;
    }

    const chosenRevisions = revisions.filter((r, idx) => {
      const revKey = `${r.id || r.seq || 'rev'}_${r.enforcementDate || ''}_${idx}`;
      return selectedRevisions[revKey];
    });

    setProgress({
      isSaving: true,
      currentStep: 1,
      totalSteps: chosenRevisions.length + 1,
      percentage: 5,
      message: `Google Drive에서 '${customFolderName}' 폴더를 검색 및 확인 중입니다...`,
      folderInfo: null,
      savedSheets: [],
      error: null,
    });

    try {
      // Step 1: Call Drive export endpoint
      setProgress((prev) => ({
        ...prev,
        percentage: 15,
        message: `폴더를 확인하고 ${chosenRevisions.length}개의 개정본 데이터를 순차 생성합니다...`,
      }));

      const res = await fetch('/api/drive/export-revision-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: token,
          targetType: selectedItem?.targetType || targetType,
          selectedItem,
          revisions: chosenRevisions,
          folderName: customFolderName,
          permissionOption,
          ocKey,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Google Drive 저장 중 오류가 발생했습니다.');
      }

      setProgress({
        isSaving: false,
        currentStep: chosenRevisions.length + 1,
        totalSteps: chosenRevisions.length + 1,
        percentage: 100,
        message: data.message || '모든 구글 시트 저장이 완료되었습니다!',
        folderInfo: data.folder,
        savedSheets: data.savedSheets || [],
        error: null,
      });
    } catch (err: any) {
      console.error('Export error:', err);
      setProgress((prev) => ({
        ...prev,
        isSaving: false,
        error: err.message || '저장 중 문제가 발생했습니다.',
        message: '저장 실패',
      }));
    }
  };

  // Revoke all external permissions (Reset to Private / Owner Only)
  const handleRevokePermissions = async () => {
    const token = getAccessToken();
    if (!token) {
      alert('Google 인증 토큰이 필요합니다. 먼저 로그인해 주세요.');
      onSignIn();
      return;
    }

    const folderId = progress.folderInfo?.id;
    const sheetIds = (progress.savedSheets || []).map((s: any) => s.spreadsheetId).filter(Boolean);

    if (!folderId && sheetIds.length === 0) {
      alert('권한을 해제할 대상 폴더 또는 시트가 아직 생성되지 않았습니다.');
      return;
    }

    if (!window.confirm('해당 폴더 및 모든 시트 파일의 외부 공유 권한을 해제하고 소유자 전용 비공개로 전환하시겠습니까?')) {
      return;
    }

    setIsRevokingPermissions(true);
    setRevokeSuccessMessage(null);

    try {
      const res = await fetch('/api/drive/permissions/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: token,
          targetId: folderId,
          targetIds: sheetIds,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || '권한 해제 실패');
      }

      setRevokeSuccessMessage(data.message || '모든 외부 공유 권한이 성공적으로 해제되었습니다.');
      setTimeout(() => setRevokeSuccessMessage(null), 5000);
    } catch (err: any) {
      alert(`권한 해제 중 오류 발생: ${err.message}`);
    } finally {
      setIsRevokingPermissions(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Card */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center space-x-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/80">
                <Sparkles className="w-3.5 h-3.5 mr-1" />
                Google Drive API v3 연동
              </span>
              <span className="text-xs text-slate-500 font-medium">국가법령정보 오픈API (법령 & 행정규칙)</span>
            </div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">
              법령 · 행정규칙 개정연혁 구글 드라이브 통합 관리
            </h2>
            <p className="text-sm text-slate-600">
              관세법 및 관세청 행정규칙(고시/훈령/예규)의 개정연혁을 선택하여, 구글 드라이브 지정 폴더에 개별 시트로 일괄 구축 및 중복 방지 저장합니다.
            </p>
          </div>

          {/* Independent Revoke Button */}
          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={handleRevokePermissions}
              disabled={isRevokingPermissions || !progress.folderInfo}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center space-x-1.5 border transition-all ${
                progress.folderInfo
                  ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100 hover:border-rose-300 shadow-sm'
                  : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
              }`}
              title="현재 저장된 드라이브 폴더 및 파일의 모든 외부 공유 권한을 제거하고 비공개로 전환합니다"
            >
              {isRevokingPermissions ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
              )}
              <span>공유 권한 설정 해제 (비공개 전환)</span>
            </button>
          </div>
        </div>

        {revokeSuccessMessage && (
          <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center space-x-2 text-xs font-semibold text-emerald-800 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{revokeSuccessMessage}</span>
          </div>
        )}
      </div>

      {/* Search & Selection Controls Section */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6">
        {/* 1. Target Type Radio Switch & Query Input */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          {/* Target Type Selector */}
          <div className="md:col-span-4">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-2">
              수집 대상 선택
            </label>
            <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setTargetType('law');
                  setSearchQuery('관세법');
                }}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center space-x-1.5 ${
                  targetType === 'law'
                    ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/80 font-extrabold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>법령 (법률/시행령)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTargetType('admrul');
                  setSearchQuery('관세');
                }}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center space-x-1.5 ${
                  targetType === 'admrul'
                    ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/80 font-extrabold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>행정규칙 (고시/훈령)</span>
              </button>
            </div>
          </div>

          {/* Search Query Input */}
          <div className="md:col-span-8">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-2">
              {targetType === 'law' ? '법령명 검색' : '행정규칙명 / 키워드 검색 (target=admrul)'}
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSearch();
              }}
              className="flex items-center space-x-2"
            >
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={targetType === 'law' ? '예: 관세법, 자유무역협정' : '예: 보세, 관세, 통관, 품목분류'}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={isSearching}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl shadow-sm hover:shadow transition-all flex items-center space-x-1.5 shrink-0"
              >
                {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span>검색</span>
              </button>
            </form>
          </div>
        </div>

        {/* 2. Search Results List Cards */}
        {searchResults.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-600 font-semibold px-1">
              <span>검색된 {targetType === 'law' ? '법령' : '행정규칙'} 목록 ({searchResults.length}건)</span>
              <span className="text-slate-500">원하는 항목을 클릭하여 개정연혁을 조회하세요</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-56 overflow-y-auto p-1 bg-slate-50 rounded-xl border border-slate-200">
              {searchResults.map((item, idx) => {
                const isSelected = selectedItem?.id === item.id || selectedItem?.name === item.name;
                const uniqueKey = `${item.targetType}_${item.id || ''}_${item.seq || ''}_${item.name || ''}_${idx}`;
                return (
                  <div
                    key={uniqueKey}
                    onClick={() => handleSelectItem(item)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? 'bg-indigo-50/80 border-indigo-500 shadow-sm ring-1 ring-indigo-500'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-xs font-bold text-slate-900 truncate" title={item.name}>
                          {item.name}
                        </span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0 border border-slate-200">
                          {item.ruleType || item.targetType}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center space-x-2">
                        <span>{item.department}</span>
                        {item.promulgationNo && <span>· {item.promulgationNo}</span>}
                      </div>
                    </div>
                    <div className="mt-2 text-[10px] text-slate-400 flex items-center justify-between border-t border-slate-100 pt-1.5">
                      <span>시행일: {item.enforcementDate || '정보없음'}</span>
                      <span className="font-semibold text-indigo-600">{item.revisionType}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Revision Table & Google Drive Export Action Section */}
      {selectedItem && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-6">
          {/* Header of Selected Item */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between pb-4 border-b border-slate-200 gap-4">
            <div>
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 rounded text-[11px] font-extrabold bg-indigo-100 text-indigo-800">
                  {selectedItem.ruleType || (selectedItem.targetType === 'admrul' ? '행정규칙' : '법령')}
                </span>
                <h3 className="text-xl font-black text-slate-900">{selectedItem.name}</h3>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                소관부처: <span className="font-medium text-slate-700">{selectedItem.department}</span> | 전체 개정연혁:{' '}
                <span className="font-bold text-indigo-600">{revisions.length}건</span>
              </p>
            </div>

            {/* Folder Name Preview & Edit */}
            <div className="flex items-center space-x-2">
              <div className="text-right">
                <label className="text-[11px] font-bold text-slate-600 block">저장 대상 드라이브 폴더명</label>
                <input
                  type="text"
                  value={customFolderName}
                  onChange={(e) => setCustomFolderName(e.target.value)}
                  className="px-3 py-1.5 text-xs font-mono font-bold text-indigo-700 bg-indigo-50/50 border border-indigo-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Revision List Table Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={() => handleSelectAll(!isAllSelected)}
                className="flex items-center space-x-1.5 text-xs font-bold text-slate-700 hover:text-indigo-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors"
              >
                {isAllSelected ? <CheckSquare className="w-4 h-4 text-indigo-600" /> : <Square className="w-4 h-4" />}
                <span>{isAllSelected ? '전체 해제' : '전체 선택'}</span>
              </button>
              <span className="text-xs text-slate-600 font-semibold">
                선택됨:{' '}
                <strong className="text-indigo-600 font-extrabold text-sm">{selectedCount}</strong> / {revisions.length}개
              </span>
            </div>

            {/* Drive Export Button */}
            <button
              type="button"
              onClick={handleStartDriveExport}
              disabled={progress.isSaving || selectedCount === 0}
              className={`px-5 py-2.5 rounded-xl font-bold text-sm flex items-center space-x-2 transition-all shadow-sm ${
                progress.isSaving || selectedCount === 0
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white hover:shadow-md'
              }`}
            >
              {progress.isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-4 h-4" />
              )}
              <span>선택한 {selectedCount}개 개정연혁 구글 드라이브에 저장</span>
            </button>
          </div>

          {/* Progress Bar (Visual Async Feedback) */}
          {progress.isSaving && (
            <div className="p-4 bg-indigo-50/70 rounded-2xl border border-indigo-200 space-y-2 animate-fadeIn">
              <div className="flex items-center justify-between text-xs font-bold text-indigo-900">
                <span className="flex items-center space-x-1.5">
                  <Loader2 className="w-4 h-4 text-indigo-600 animate-spin" />
                  <span>{progress.message}</span>
                </span>
                <span className="font-mono text-indigo-700">{progress.percentage}%</span>
              </div>
              <div className="w-full bg-indigo-200/60 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${progress.percentage}%` }}
                />
              </div>
            </div>
          )}

          {/* Revisions Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            {isLoadingRevisions ? (
              <div className="py-12 flex flex-col items-center justify-center space-y-2 text-slate-500">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                <span className="text-xs font-semibold">전체 개정연혁 데이터를 조회하고 있습니다...</span>
              </div>
            ) : revisions.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400 font-medium">
                조회된 개정연혁이 없습니다.
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-100/80 sticky top-0 z-10 border-b border-slate-200 text-slate-700 font-bold">
                    <tr>
                      <th className="py-2.5 px-4 w-12 text-center">선택</th>
                      <th className="py-2.5 px-4">공포 / 발령번호</th>
                      <th className="py-2.5 px-4">시행일자</th>
                      <th className="py-2.5 px-4">공포 / 발령일자</th>
                      <th className="py-2.5 px-4">제개정구분</th>
                      <th className="py-2.5 px-4">소관부처</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {revisions.map((rev, idx) => {
                      const idKey = `${rev.id || rev.seq || 'rev'}_${rev.enforcementDate || ''}_${idx}`;
                      const isChecked = !!selectedRevisions[idKey];
                      return (
                        <tr
                          key={idKey}
                          onClick={() => handleToggleRevision(idKey)}
                          className={`hover:bg-slate-50 cursor-pointer transition-colors ${
                            isChecked ? 'bg-indigo-50/30' : ''
                          }`}
                        >
                          <td className="py-2 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleRevision(idKey)}
                              className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                            />
                          </td>
                          <td className="py-2 px-4 font-bold text-slate-900">
                            {rev.promulgationNo || `개정본 (${rev.enforcementDate})`}
                          </td>
                          <td className="py-2 px-4 font-semibold text-indigo-700 font-mono">
                            {rev.enforcementDate || '-'}
                          </td>
                          <td className="py-2 px-4 text-slate-600 font-mono">{rev.promulgationDate || '-'}</td>
                          <td className="py-2 px-4 font-medium text-slate-700">
                            <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px]">
                              {rev.revisionType}
                            </span>
                          </td>
                          <td className="py-2 px-4 text-slate-500">{rev.department}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Export Result Summary Card */}
      {progress.folderInfo && (
        <div className="bg-emerald-50/80 rounded-2xl p-6 border border-emerald-200 shadow-sm space-y-4 animate-fadeIn">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-emerald-100 text-emerald-700 rounded-xl border border-emerald-200">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-emerald-950">Google Drive 저장 완료</h3>
                <p className="text-xs text-emerald-700 mt-0.5">
                  총 <strong>{progress.savedSheets?.length || 0}개</strong> 개정본 시트 파일이 지정 폴더에 안전하게 구축되었습니다.
                </p>
              </div>
            </div>

            <a
              href={progress.folderInfo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm flex items-center space-x-1.5 shrink-0 transition-all"
            >
              <FolderPlus className="w-4 h-4" />
              <span>Google Drive 폴더 열기</span>
              <ExternalLink className="w-3 h-3 ml-0.5" />
            </a>
          </div>

          {/* Folder Details & Sheets List */}
          <div className="bg-white rounded-xl p-4 border border-emerald-200/80 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-700 font-semibold border-b border-slate-100 pb-2">
              <span>드라이브 폴더: <span className="font-mono text-indigo-700 font-bold">{progress.folderInfo.name}</span></span>
              <span className="text-emerald-700">중복 방지 넘버링 자동 적용됨</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
              {progress.savedSheets?.map((sheet, sIdx) => (
                <a
                  key={sIdx}
                  href={sheet.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2.5 bg-slate-50 hover:bg-indigo-50/60 rounded-lg border border-slate-200 flex items-center justify-between text-xs group transition-colors"
                >
                  <div className="flex items-center space-x-2 truncate">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="font-medium text-slate-800 group-hover:text-indigo-700 truncate">
                      {sheet.title}
                    </span>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 shrink-0 ml-2" />
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Permission Setup Modal */}
      <DrivePermissionModal
        isOpen={isPermissionModalOpen}
        onClose={() => setIsPermissionModalOpen(false)}
        onConfirm={handleConfirmDriveExport}
        folderName={customFolderName}
        itemCount={selectedCount}
      />
    </div>
  );
};
