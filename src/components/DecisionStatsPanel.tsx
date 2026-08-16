import React, { useState, useEffect } from 'react';
import { YearlyDecisionStat } from '../types';
import {
  BarChart3,
  RefreshCw,
  Loader2,
  Calendar,
  Gavel,
  Users,
  Box,
  Copy,
  Download,
  Check,
  Building2,
  TrendingUp,
} from 'lucide-react';

export function DecisionStatsPanel() {
  const [startYear, setStartYear] = useState('1988');
  const [endYear, setEndYear] = useState('2026');
  const [stats, setStats] = useState<YearlyDecisionStat[]>([]);
  const [totals, setTotals] = useState({
    committeeCount: 0,
    councilCount: 0,
    caseCount: 0,
    totalCount: 0,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const yearOptions = Array.from({ length: 2026 - 1988 + 1 }, (_, i) => String(2026 - i));

  const fetchStats = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/decisions/stats?startYear=${startYear}&endYear=${endYear}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setStats(data.stats || []);
        setTotals(
          data.totals || {
            committeeCount: 0,
            councilCount: 0,
            caseCount: 0,
            totalCount: 0,
          }
        );
      } else {
        setErrorMsg(data.error || '통계 데이터를 불러오지 못했습니다.');
      }
    } catch (err: any) {
      console.error('Failed to fetch stats:', err);
      setErrorMsg('서버와 통신 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [startYear, endYear]);

  const handleQuickPreset = (s: string, e: string) => {
    setStartYear(s);
    setEndYear(e);
  };

  const handleCopyTable = () => {
    if (!stats || stats.length === 0) return;
    let text = '연도\t위원회결정사항(04)\t협의회결정사항(03)\t품목분류사례(01)\t합계\n';
    stats.forEach((s) => {
      text += `${s.year}년\t${s.committeeCount.toLocaleString()}건\t${s.councilCount.toLocaleString()}건\t${s.caseCount.toLocaleString()}건\t${s.totalCount.toLocaleString()}건\n`;
    });
    text += `총계\t${totals.committeeCount.toLocaleString()}건\t${totals.councilCount.toLocaleString()}건\t${totals.caseCount.toLocaleString()}건\t${totals.totalCount.toLocaleString()}건`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadCSV = () => {
    if (!stats || stats.length === 0) return;
    const escapeCsv = (val: any) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const headers = ['연도', '위원회결정사항(04)', '협의회결정사항(03)', '품목분류사례(01)', '합계'];
    const rows = stats.map((s) => [
      `${s.year}년`,
      s.committeeCount,
      s.councilCount,
      s.caseCount,
      s.totalCount,
    ]);
    rows.push([
      '총계',
      totals.committeeCount,
      totals.councilCount,
      totals.caseCount,
      totals.totalCount,
    ]);

    const csvLines = [headers.map(escapeCsv).join(','), ...rows.map((r) => r.map(escapeCsv).join(','))];
    const csvContent = '\uFEFF' + csvLines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `관세청_품목분류_연도별_수집통계_${startYear}~${endYear}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-xl">
      {/* Panel Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg border border-indigo-500/20">
              <BarChart3 className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              연도별 / 구분별 수집 현황 통계
            </h2>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800/50">
              UNIPASS 실시간
            </span>
          </div>
          <p className="text-xs text-slate-400">
            관세청 UNIPASS 데이터베이스의 위원회결정사항, 협의회결정사항, 품목분류사례 연도별 정확한 수집 건수 분석입니다.
          </p>
        </div>

        {/* Controls & Presets */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Quick Presets */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => handleQuickPreset('1988', '2026')}
              className={`px-3 py-1 rounded-lg font-bold transition-colors ${
                startYear === '1988' && endYear === '2026'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              전체 Archive (1988~2026년)
            </button>
            <button
              onClick={() => handleQuickPreset('2018', '2026')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                startYear === '2018' && endYear === '2026'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              2018~2026년 (9년)
            </button>
            <button
              onClick={() => handleQuickPreset('2022', '2026')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                startYear === '2022' && endYear === '2026'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              최근 5년
            </button>
          </div>

          {/* Custom Year Range Selectors */}
          <div className="flex items-center gap-1.5 text-xs text-slate-300 bg-slate-950 px-2.5 py-1 rounded-xl border border-slate-800">
            <select
              value={startYear}
              onChange={(e) => setStartYear(e.target.value)}
              className="bg-slate-900 text-indigo-300 font-bold border border-slate-700 rounded-lg px-2 py-0.5 focus:outline-none focus:border-indigo-500"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
            <span className="text-slate-500 font-bold">~</span>
            <select
              value={endYear}
              onChange={(e) => setEndYear(e.target.value)}
              className="bg-slate-900 text-indigo-300 font-bold border border-slate-700 rounded-lg px-2 py-0.5 focus:outline-none focus:border-indigo-500"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={fetchStats}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl border border-slate-700 transition-colors disabled:opacity-50"
            title="통계 새로고침"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />
            <span>새로고침</span>
          </button>
        </div>
      </div>

      {/* Top Summary Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Committee Decisions Card */}
        <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-4 space-y-2 relative overflow-hidden group hover:border-indigo-500/50 transition-colors">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold text-slate-300">위원회결정사항</span>
            <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400">
              <Gavel className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-purple-300 font-mono">
              {isLoading ? '...' : totals.committeeCount.toLocaleString()}
            </span>
            <span className="text-xs text-slate-400 font-medium">건</span>
          </div>
          <p className="text-[11px] text-slate-500">관세품목분류위원회 (구분코드 04)</p>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-500/30" />
        </div>

        {/* Council Decisions Card */}
        <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-4 space-y-2 relative overflow-hidden group hover:border-amber-500/50 transition-colors">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold text-slate-300">협의회결정사항</span>
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-amber-300 font-mono">
              {isLoading ? '...' : totals.councilCount.toLocaleString()}
            </span>
            <span className="text-xs text-slate-400 font-medium">건</span>
          </div>
          <p className="text-[11px] text-slate-500">품목분류협의회 (구분코드 03)</p>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500/30" />
        </div>

        {/* Classification Cases Card */}
        <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-4 space-y-2 relative overflow-hidden group hover:border-emerald-500/50 transition-colors">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold text-slate-300">품목분류사례</span>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
              <Box className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-emerald-300 font-mono">
              {isLoading ? '...' : totals.caseCount.toLocaleString()}
            </span>
            <span className="text-xs text-slate-400 font-medium">건</span>
          </div>
          <p className="text-[11px] text-slate-500">국내품목분류사례 (구분코드 01)</p>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500/30" />
        </div>

        {/* Total Grand Cumulative Card */}
        <div className="bg-indigo-950/30 border border-indigo-800/50 rounded-xl p-4 space-y-2 relative overflow-hidden group">
          <div className="flex items-center justify-between text-xs text-indigo-300">
            <span className="font-bold">전체 수집 총계</span>
            <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-300">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-indigo-200 font-mono">
              {isLoading ? '...' : totals.totalCount.toLocaleString()}
            </span>
            <span className="text-xs text-indigo-300/80 font-medium">건</span>
          </div>
          <p className="text-[11px] text-indigo-300/60">{startYear}~{endYear}년 총 누적 건수</p>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-indigo-500" />
        </div>
      </div>

      {/* Error Banner */}
      {errorMsg && (
        <div className="p-3 bg-rose-950/50 border border-rose-800/80 rounded-xl text-rose-300 text-xs flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={fetchStats} className="underline font-semibold hover:text-white">
            다시 시도
          </button>
        </div>
      )}

      {/* Main Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-indigo-400" />
            <span>연도별 상세 수집 건수 비교표 ({startYear}~{endYear}년)</span>
          </h3>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyTable}
              disabled={isLoading || stats.length === 0}
              className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg border border-slate-700 transition-colors disabled:opacity-50"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
              <span>{copied ? '복사됨' : '표 복사'}</span>
            </button>

            <button
              onClick={handleDownloadCSV}
              disabled={isLoading || stats.length === 0}
              className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg border border-slate-700 transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5 text-slate-400" />
              <span>CSV 다운로드</span>
            </button>
          </div>
        </div>

        <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/60">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-900 border-b border-slate-800 text-slate-300 font-semibold">
                  <th className="py-3 px-4 w-28">연도</th>
                  <th className="py-3 px-4 text-right">
                    <span className="text-purple-300">위원회결정사항</span>
                    <span className="block text-[10px] text-slate-500 font-normal">코드 04</span>
                  </th>
                  <th className="py-3 px-4 text-right">
                    <span className="text-amber-300">협의회결정사항</span>
                    <span className="block text-[10px] text-slate-500 font-normal">코드 03</span>
                  </th>
                  <th className="py-3 px-4 text-right">
                    <span className="text-emerald-300">품목분류사례</span>
                    <span className="block text-[10px] text-slate-500 font-normal">코드 01</span>
                  </th>
                  <th className="py-3 px-4 text-right">
                    <span className="text-indigo-300">연도별 합계</span>
                    <span className="block text-[10px] text-slate-500 font-normal">총 건수</span>
                  </th>
                  <th className="py-3 px-4 w-48 text-center">비율 및 비중</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {isLoading && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                        <span>UNIPASS 실시간 수집 건수를 분석하는 중입니다...</span>
                      </div>
                    </td>
                  </tr>
                )}

                {!isLoading && stats.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      조회된 통계 데이터가 없습니다.
                    </td>
                  </tr>
                )}

                {!isLoading &&
                  stats.map((row) => {
                    const maxTotal = Math.max(...stats.map((s) => s.totalCount), 1);
                    const pct = Math.round((row.totalCount / maxTotal) * 100);

                    return (
                      <tr
                        key={row.year}
                        className="hover:bg-slate-900/80 transition-colors font-mono text-xs"
                      >
                        <td className="py-3 px-4 font-bold text-white flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-indigo-500"></span>
                          <span>{row.year}년</span>
                        </td>
                        <td className="py-3 px-4 text-right font-medium text-purple-300">
                          {row.committeeCount.toLocaleString()}건
                        </td>
                        <td className="py-3 px-4 text-right font-medium text-amber-300">
                          {row.councilCount.toLocaleString()}건
                        </td>
                        <td className="py-3 px-4 text-right font-medium text-emerald-300">
                          {row.caseCount.toLocaleString()}건
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-indigo-200">
                          {row.totalCount.toLocaleString()}건
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800 flex">
                              <div
                                className="bg-purple-500 h-full"
                                style={{
                                  width: `${(row.committeeCount / (row.totalCount || 1)) * pct}%`,
                                }}
                                title={`위원회: ${row.committeeCount}건`}
                              />
                              <div
                                className="bg-amber-500 h-full"
                                style={{
                                  width: `${(row.councilCount / (row.totalCount || 1)) * pct}%`,
                                }}
                                title={`협의회: ${row.councilCount}건`}
                              />
                              <div
                                className="bg-emerald-500 h-full"
                                style={{
                                  width: `${(row.caseCount / (row.totalCount || 1)) * pct}%`,
                                }}
                                title={`사례: ${row.caseCount}건`}
                              />
                            </div>
                            <span className="text-[11px] text-slate-400 w-8 text-right">
                              {pct}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
              {!isLoading && stats.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-900/90 font-bold text-white border-t-2 border-slate-700 font-mono text-xs">
                    <td className="py-3 px-4 text-indigo-400">총계</td>
                    <td className="py-3 px-4 text-right text-purple-300">
                      {totals.committeeCount.toLocaleString()}건
                    </td>
                    <td className="py-3 px-4 text-right text-amber-300">
                      {totals.councilCount.toLocaleString()}건
                    </td>
                    <td className="py-3 px-4 text-right text-emerald-300">
                      {totals.caseCount.toLocaleString()}건
                    </td>
                    <td className="py-3 px-4 text-right text-indigo-200 text-sm">
                      {totals.totalCount.toLocaleString()}건
                    </td>
                    <td className="py-3 px-4 text-center text-slate-400 font-sans font-normal text-[11px]">
                      {stats.length}개 연도 누적
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
