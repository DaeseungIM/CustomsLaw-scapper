import React, { useState, useEffect, useMemo, useRef } from 'react';
import { LawRevisionItem } from '../types';
import {
  ChevronDown,
  Search,
  History,
  Calendar,
  FileText,
  Check,
  RefreshCw,
  Sparkles,
  Layers,
  Filter,
} from 'lucide-react';

interface LawRevisionComboboxProps {
  ocKey: string;
  selectedRevision: LawRevisionItem | null;
  onSelectRevision: (revision: LawRevisionItem) => void;
  isLoadingLawDetail?: boolean;
}

export const LawRevisionCombobox: React.FC<LawRevisionComboboxProps> = ({
  ocKey,
  selectedRevision,
  onSelectRevision,
  isLoadingLawDetail = false,
}) => {
  const [revisions, setRevisions] = useState<LawRevisionItem[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'exactLaw' | '2020s' | '2010s'>('exactLaw');
  const [fetchError, setFetchError] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch all revisions on mount or ocKey change
  const loadRevisions = async () => {
    setIsFetching(true);
    setFetchError(null);

    try {
      const res = await fetch(`/api/law/search?ocKey=${encodeURIComponent(ocKey)}&query=관세법&display=500`);
      const data = await res.json();

      if (res.ok && data.success && Array.isArray(data.results)) {
        // Strictly filter for exact '관세법' only (removing unrelated laws like 한국해양수산연수원법)
        const exactRevisions = data.results.filter((r: LawRevisionItem) => r.lawName === '관세법');
        setRevisions(exactRevisions);
        
        // Automatically select the first/latest exact "관세법" if none selected yet
        if (!selectedRevision && exactRevisions.length > 0) {
          onSelectRevision(exactRevisions[0]);
        }
      } else {
        setFetchError(data.error || '개정 이력을 불러올 수 없습니다.');
      }
    } catch (err: any) {
      console.error('Failed to load law revisions:', err);
      setFetchError(err.message || '네트워크 오류로 개정 이력을 불러오지 못했습니다.');
    } finally {
      setIsFetching(false);
    }
  };

  useEffect(() => {
    loadRevisions();
  }, [ocKey]);

  // Filter & Search Logic
  const filteredRevisions = useMemo(() => {
    return revisions.filter((rev) => {
      // Filter by law type / name category
      if (filterMode === 'exactLaw' && rev.lawName !== '관세법') return false;
      if (filterMode === '2020s' && (!rev.enforcementDate || !rev.enforcementDate.startsWith('202'))) return false;
      if (filterMode === '2010s' && (!rev.enforcementDate || !rev.enforcementDate.startsWith('201'))) return false;

      // Filter by search query
      if (!searchTerm.trim()) return true;
      const q = searchTerm.toLowerCase().trim();
      return (
        rev.enforcementDate.toLowerCase().includes(q) ||
        rev.promulgationNo.toLowerCase().includes(q) ||
        rev.promulgationDate.toLowerCase().includes(q) ||
        rev.revisionType.toLowerCase().includes(q) ||
        rev.lawName.toLowerCase().includes(q)
      );
    });
  }, [revisions, searchTerm, filterMode]);

  const exactLawCount = useMemo(() => {
    return revisions.filter((r) => r.lawName === '관세법').length;
  }, [revisions]);

  return (
    <div className="relative w-full space-y-2" ref={dropdownRef}>
      {/* Label and Badge */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
          <History className="w-4 h-4 text-indigo-400" />
          <span>관세법 개정 이력 선택 (시행일자 · 공포번호 · 개정구분)</span>
        </label>
        <div className="flex items-center gap-2">
          {revisions.length > 0 && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 font-medium border border-indigo-800/60 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span>총 {exactLawCount || revisions.length}건 개정본 수집됨</span>
            </span>
          )}
          <button
            onClick={loadRevisions}
            disabled={isFetching}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
            title="개정 이력 새로고침"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin text-indigo-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Combobox Trigger Button */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={isFetching}
          className={`w-full text-left bg-slate-900 border rounded-xl p-3.5 flex items-center justify-between transition-all cursor-pointer shadow-md ${
            isOpen
              ? 'border-indigo-500 ring-2 ring-indigo-500/20 shadow-indigo-500/10'
              : 'border-slate-800 hover:border-slate-700'
          }`}
        >
          {selectedRevision ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 w-full pr-3 overflow-hidden">
              {/* Left Column: Enforcement Date & Act Number */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="shrink-0 px-2.5 py-1 rounded-md text-xs font-bold bg-indigo-600 text-white shadow-sm flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>시행 {selectedRevision.enforcementDate}</span>
                </span>
                <span className="font-bold text-sm text-slate-100 truncate">
                  {selectedRevision.promulgationNo || '공포번호 정보 없음'}
                </span>
              </div>

              {/* Right Column: Revision Type & Promulgation Date */}
              <div className="flex items-center gap-2 text-xs text-slate-400 shrink-0">
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  {selectedRevision.revisionType}
                </span>
                <span>(공포 {selectedRevision.promulgationDate})</span>
              </div>
            </div>
          ) : (
            <span className="text-sm text-slate-400">
              {isFetching ? '관세법 개정 이력 목록 조회 중...' : '원하는 관세법 개정본을 선택해 주세요'}
            </span>
          )}

          <div className="shrink-0 flex items-center gap-2 pl-2 border-l border-slate-800">
            {isLoadingLawDetail && <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />}
            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180 text-indigo-400' : ''}`} />
          </div>
        </button>

        {/* Dropdown Popup Combobox Menu */}
        {isOpen && (
          <div className="absolute z-50 mt-2 w-full bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-xl space-y-2 p-3 animate-in fade-in slide-in-from-top-2 duration-150">
            {/* Search Input Box */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="시행일자(2024), 공포번호(19921), 개정구분(일부개정) 검색..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-8 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                autoFocus
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-3 text-xs text-slate-500 hover:text-slate-300"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Quick Category Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] scrollbar-none border-b border-slate-800/80">
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all shrink-0 ${
                  filterMode === 'all' || filterMode === 'exactLaw'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                전체 관세법 ({revisions.length}건)
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('2020s')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all shrink-0 ${
                  filterMode === '2020s'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                2020년대
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('2010s')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all shrink-0 ${
                  filterMode === '2010s'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                2010년대
              </button>
            </div>

            {/* Revision Option List */}
            <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1 text-xs">
              {filteredRevisions.length === 0 ? (
                <div className="p-6 text-center text-slate-400 space-y-1">
                  <p className="font-semibold">검색 조건에 해당되는 관세법 개정 이력이 없습니다.</p>
                  <p className="text-[11px] text-slate-500">시행일자나 공포번호 키워드를 변경해 보세요.</p>
                </div>
              ) : (
                filteredRevisions.map((rev, index) => {
                  const isSelected = selectedRevision?.lawMst === rev.lawMst;
                  const isLatest = index === 0 && rev.lawName === '관세법';

                  return (
                    <button
                      key={`${rev.lawMst}-${index}`}
                      type="button"
                      onClick={() => {
                        onSelectRevision(rev);
                        setIsOpen(false);
                      }}
                      className={`w-full text-left p-3 rounded-xl transition-all border flex items-center justify-between gap-3 cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-950/80 border-indigo-500/80 text-white shadow-md'
                          : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-800/80 hover:border-slate-700 text-slate-200'
                      }`}
                    >
                      <div className="space-y-1.5 min-w-0 flex-1">
                        {/* Top Line: Enforcement Date & Act Number */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                              isSelected
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-800 text-emerald-400 border border-slate-700'
                            }`}
                          >
                            시행 {rev.enforcementDate}
                          </span>

                          <span className="font-bold text-slate-100">{rev.promulgationNo}</span>

                          {isLatest && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 font-bold border border-emerald-800">
                              최신 시행본
                            </span>
                          )}

                          {rev.lawName !== '관세법' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">
                              {rev.lawName}
                            </span>
                          )}
                        </div>

                        {/* Bottom Line: Promulgation Date, Type, Department */}
                        <div className="flex items-center gap-2 text-[11px] text-slate-400">
                          <span>공포일자: {rev.promulgationDate}</span>
                          <span>•</span>
                          <span className="text-slate-300">{rev.revisionType}</span>
                          <span>•</span>
                          <span>{rev.department}</span>
                        </div>
                      </div>

                      {isSelected && (
                        <div className="shrink-0 w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-white">
                          <Check className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {fetchError && (
        <p className="text-xs text-rose-400 flex items-center gap-1 mt-1">
          <span>⚠️ {fetchError}</span>
        </p>
      )}
    </div>
  );
};
