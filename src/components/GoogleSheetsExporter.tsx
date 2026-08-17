import React from 'react';
import { ExportConfig, CustomsActData } from '../types';
import {
  FileSpreadsheet,
  Download,
  PlusCircle,
  Link2,
  CheckSquare,
  FileJson,
  FileText,
} from 'lucide-react';

interface GoogleSheetsExporterProps {
  config: ExportConfig;
  onChangeConfig: (newConfig: ExportConfig) => void;
  lawData: CustomsActData | null;
}

export const GoogleSheetsExporter: React.FC<GoogleSheetsExporterProps> = ({
  config,
  onChangeConfig,
  lawData,
}) => {
  const handleDownloadCSV = () => {
    if (!lawData) return;
    const headers = [
      '장 (Chapter)',
      '절 (Section)',
      '관 (Subsection)',
      '조문 번호 (조)',
      '조문 제목',
      '조문 내용 (전문)',
      '시행일자',
      '비고',
    ];
    const rows = lawData.articles.map((art) => [
      `"${(art.chapterName || '').replace(/"/g, '""')}"`,
      `"${(art.sectionName || '').replace(/"/g, '""')}"`,
      `"${(art.subsectionName || '').replace(/"/g, '""')}"`,
      `"${(art.articleNo || '').replace(/"/g, '""')}"`,
      `"${(art.articleTitle || '').replace(/"/g, '""')}"`,
      `"${(art.articleContent || '').replace(/"/g, '""')}"`,
      `"${(art.effectiveDate || '').replace(/"/g, '""')}"`,
      `"${art.isDeleted ? '삭제' : ''}"`,
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `관세법_조문전체_${lawData.info.enforcementDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadJSON = () => {
    if (!lawData) return;
    const jsonString = JSON.stringify(lawData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `관세법_조문전체_${lawData.info.enforcementDate}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 text-slate-900 shadow-sm space-y-6">
      <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
        <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-600 rounded-xl">
          <FileSpreadsheet className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-lg font-black text-slate-900">Google Sheets 저장 설정</h2>
          <p className="text-xs text-slate-500">
            수집된 관세법 조문 데이터를 구글 스프레드시트에 저장할 대상 및 서식을 지정합니다.
          </p>
        </div>
      </div>

      {/* Export Scope Selection */}
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
          수집 범위 및 파일 생성 방식 (Export Scope & Mode)
        </label>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          <label
            className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-all ${
              (!config.exportMode || config.exportMode === 'selected') && !config.exportAll140
                ? 'bg-indigo-50 border-indigo-500 text-indigo-950 font-semibold'
                : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
          >
            <input
              type="radio"
              name="exportScope"
              checked={(!config.exportMode || config.exportMode === 'selected') && !config.exportAll140}
              onChange={() =>
                onChangeConfig({
                  ...config,
                  exportAll140: false,
                  exportMode: 'selected',
                })
              }
              className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <div className="font-bold text-xs text-slate-900">
                선택된 개정본 1건 동기화
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                드롭다운에서 선택된 1개 시행일자 개정본의 조문만 내보냅니다.
              </p>
            </div>
          </label>

          <label
            className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-all ${
              config.exportMode === 'separate_files_140' || (config.exportAll140 && config.exportMode !== 'single_file_140')
                ? 'bg-indigo-50 border-indigo-500 text-indigo-950 font-semibold shadow-xs'
                : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
          >
            <input
              type="radio"
              name="exportScope"
              checked={
                config.exportMode === 'separate_files_140' || (config.exportAll140 && config.exportMode !== 'single_file_140')
              }
              onChange={() =>
                onChangeConfig({
                  ...config,
                  exportAll140: true,
                  exportMode: 'separate_files_140',
                })
              }
              className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <div className="font-bold text-xs text-amber-700 flex items-center gap-1">
                <span>140개 개별 파일로 각각 생성</span>
                <span className="bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0.2 rounded font-mono">추천</span>
              </div>
              <p className="text-[11px] text-slate-600 mt-0.5">
                140개 전체 개정자료를 개정본별 각각 140개 개별 파일로 생성합니다.
              </p>
            </div>
          </label>

          <label
            className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-all ${
              config.exportMode === 'single_file_140'
                ? 'bg-indigo-50 border-indigo-500 text-indigo-950 font-semibold'
                : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
            }`}
          >
            <input
              type="radio"
              name="exportScope"
              checked={config.exportMode === 'single_file_140'}
              onChange={() =>
                onChangeConfig({
                  ...config,
                  exportAll140: true,
                  exportMode: 'single_file_140',
                })
              }
              className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <div className="font-bold text-xs text-indigo-700">
                140개 개정본 단일 통합 파일
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                140개 개정판의 조문을 1개의 구글 시트 파일에 차례대로 합쳐서 저장합니다.
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Target Type Selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label
          className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
            config.targetType === 'new'
              ? 'bg-indigo-50/50 border-indigo-500 text-indigo-950 font-semibold'
              : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300'
          }`}
        >
          <input
            type="radio"
            name="targetType"
            checked={config.targetType === 'new'}
            onChange={() => onChangeConfig({ ...config, targetType: 'new' })}
            className="mt-1 text-indigo-600 focus:ring-indigo-500"
          />
          <div>
            <div className="flex items-center gap-2 font-bold text-sm text-slate-900">
              <PlusCircle className="w-4 h-4 text-emerald-600" />
              <span>새 Google 스프레드시트 생성</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              내 Google Drive에 '관세법 전체 조문' 제목의 새 문서가 자동으로 생성됩니다.
            </p>
          </div>
        </label>

        <label
          className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
            config.targetType === 'existing'
              ? 'bg-indigo-50/50 border-indigo-500 text-indigo-950 font-semibold'
              : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300'
          }`}
        >
          <input
            type="radio"
            name="targetType"
            checked={config.targetType === 'existing'}
            onChange={() => onChangeConfig({ ...config, targetType: 'existing' })}
            className="mt-1 text-indigo-600 focus:ring-indigo-500"
          />
          <div>
            <div className="flex items-center gap-2 font-bold text-sm text-slate-900">
              <Link2 className="w-4 h-4 text-amber-600" />
              <span>기존 Google 스프레드시트에 추가</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              기존 스프레드시트 URL 또는 ID를 지정하여 '조문 목록' 탭에 덮어씁니다.
            </p>
          </div>
        </label>
      </div>

      {/* Existing Spreadsheet Input */}
      {config.targetType === 'existing' && (
        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
          <label className="block text-xs font-bold text-slate-700">
            기존 Google Sheets URL 또는 Spreadsheet ID
          </label>
          <input
            type="text"
            value={config.spreadsheetIdOrUrl || ''}
            onChange={(e) =>
              onChangeConfig({ ...config, spreadsheetIdOrUrl: e.target.value })
            }
            placeholder="https://docs.google.com/spreadsheets/d/1ABC123.../edit"
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-400 font-mono"
          />
          <p className="text-[11px] text-slate-500">
            문서에 대한 편집 권한(Edit Permission)이 있는 Google 계정으로 로그인되어 있어야 합니다.
          </p>
        </div>
      )}

      {/* Formatting & Tab Options */}
      <div className="space-y-3 pt-2">
        <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={config.includeOverview}
            onChange={(e) =>
              onChangeConfig({ ...config, includeOverview: e.target.checked })
            }
            className="rounded text-indigo-600 bg-white border-slate-300 focus:ring-indigo-500"
          />
          <span>'관세법 개요' 탭 자동 생성 (공포번호, 시행일자, 총 조문수, 타임스탬프)</span>
        </label>

        <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={config.autoFormat}
            onChange={(e) =>
              onChangeConfig({ ...config, autoFormat: e.target.checked })
            }
            className="rounded text-indigo-600 bg-white border-slate-300 focus:ring-indigo-500"
          />
          <span>표 스타일링 적용 (헤더 스타일, 조문 내용 자동 줄바꿈, 1행 틀 고정)</span>
        </label>
      </div>

      {/* Local File Downloads */}
      {lawData && (
        <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5 text-slate-400" />
            <span>오프라인 다운로드 옵션:</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-lg text-xs font-semibold transition-colors"
            >
              <FileText className="w-3.5 h-3.5 text-emerald-600" />
              <span>CSV 내보내기</span>
            </button>
            <button
              onClick={handleDownloadJSON}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-lg text-xs font-semibold transition-colors"
            >
              <FileJson className="w-3.5 h-3.5 text-amber-600" />
              <span>JSON 내보내기</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
