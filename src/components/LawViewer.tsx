import React, { useState, useMemo } from 'react';
import { CustomsActData, LawArticle } from '../types';
import { Search, Filter, BookOpen, ChevronDown, ChevronUp, Copy, Check, Info } from 'lucide-react';

interface LawViewerProps {
  lawData: CustomsActData | null;
}

export const LawViewer: React.FC<LawViewerProps> = ({ lawData }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChapter, setSelectedChapter] = useState('ALL');
  const [expandedArticles, setExpandedArticles] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Extract unique chapter list
  const chapters = useMemo(() => {
    if (!lawData) return [];
    const set = new Set<string>();
    lawData.articles.forEach((art) => {
      if (art.chapterName) set.add(art.chapterName);
    });
    return Array.from(set);
  }, [lawData]);

  // Filter articles
  const filteredArticles = useMemo(() => {
    if (!lawData) return [];
    return lawData.articles.filter((art) => {
      // Chapter filter
      if (selectedChapter !== 'ALL' && art.chapterName !== selectedChapter) {
        return false;
      }
      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchNo = art.articleNo.toLowerCase().includes(q);
        const matchTitle = art.articleTitle.toLowerCase().includes(q);
        const matchContent = art.articleContent.toLowerCase().includes(q);
        return matchNo || matchTitle || matchContent;
      }
      return true;
    });
  }, [lawData, searchQuery, selectedChapter]);

  const toggleExpand = (articleNo: string) => {
    setExpandedArticles((prev) => ({
      ...prev,
      [articleNo]: !prev[articleNo],
    }));
  };

  const handleCopy = (art: LawArticle) => {
    const text = `${art.articleNo} (${art.articleTitle})\n${art.articleContent}`;
    navigator.clipboard.writeText(text);
    setCopiedId(art.articleNo);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!lawData) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 text-slate-900 shadow-sm space-y-6">
      {/* Top Header & Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-50 border border-indigo-200 text-indigo-600 rounded-xl">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <span>{lawData.info.lawName} 조문 미리보기</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-mono font-bold">
                총 {lawData.articles.length}개 조문
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              공포번호: {lawData.info.promulgationNo} | 시행일자: {lawData.info.enforcementDate} ({lawData.info.revisionType})
            </p>
          </div>
        </div>

        {/* Search & Chapter Filter */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {/* Search Input */}
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="조문 검색 (예: 제38조, 통관, 관세)"
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-400"
            />
          </div>

          {/* Chapter Select */}
          {chapters.length > 0 && (
            <div className="relative">
              <Filter className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400 pointer-events-none" />
              <select
                value={selectedChapter}
                onChange={(e) => setSelectedChapter(e.target.value)}
                className="pl-8 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none cursor-pointer"
              >
                <option value="ALL">전체 장/절 보기</option>
                {chapters.map((ch, idx) => (
                  <option key={idx} value={ch}>
                    {ch.length > 25 ? `${ch.substring(0, 25)}...` : ch}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Filter Info Bar */}
      <div className="flex items-center justify-between text-xs text-slate-600 bg-slate-50 px-4 py-2.5 rounded-xl border border-slate-200">
        <div className="flex items-center gap-2">
          <Info className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
          <span>
            {searchQuery || selectedChapter !== 'ALL'
              ? `검색 조건 적용 결과: 총 ${filteredArticles.length}건 검색됨`
              : '전체 조문 목록이 나열되어 있습니다. 클릭하여 상세 내용을 확인하세요.'}
          </span>
        </div>
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="text-indigo-600 hover:underline text-[11px] font-bold"
          >
            검색 초기화
          </button>
        )}
      </div>

      {/* Articles List */}
      <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
        {filteredArticles.length === 0 ? (
          <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-400">
            <Search className="w-8 h-8 mx-auto mb-2 text-slate-400" />
            <p className="text-sm font-bold text-slate-700">검색 조건에 맞는 관세법 조문이 없습니다.</p>
            <p className="text-xs text-slate-500 mt-1">다른 검색어나 장/절을 선택해 보세요.</p>
          </div>
        ) : (
          filteredArticles.map((art, idx) => {
            const isExpanded = expandedArticles[art.articleNo] ?? false;
            return (
              <div
                key={art.articleNo + idx}
                className="bg-white border border-slate-200 rounded-xl p-4 transition-all hover:border-indigo-300 shadow-2xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-extrabold text-indigo-600">
                        {art.articleNo}
                      </span>
                      {art.articleTitle && (
                        <span className="text-sm font-bold text-slate-900">
                          ({art.articleTitle})
                        </span>
                      )}
                      {art.chapterName && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 font-semibold">
                          {art.chapterName}
                        </span>
                      )}
                      {art.sectionName && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 font-medium">
                          {art.sectionName}
                        </span>
                      )}
                      {art.subsectionName && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200 font-medium">
                          {art.subsectionName}
                        </span>
                      )}
                      {art.isDeleted && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-bold">
                          삭제
                        </span>
                      )}
                    </div>

                    <p
                      className={`text-xs text-slate-700 leading-relaxed font-sans whitespace-pre-wrap ${
                        !isExpanded ? 'line-clamp-3' : ''
                      }`}
                    >
                      {art.articleContent}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleCopy(art)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                      title="조문 복사"
                    >
                      {copiedId === art.articleNo ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => toggleExpand(art.articleNo)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                      title={isExpanded ? '접기' : '전체보기'}
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
