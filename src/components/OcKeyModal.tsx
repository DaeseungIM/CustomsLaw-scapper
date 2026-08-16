import React, { useState } from 'react';
import { X, CheckCircle2, AlertCircle, RefreshCw, Key, ExternalLink } from 'lucide-react';

interface OcKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentOcKey: string;
  onSaveOcKey: (newKey: string) => void;
}

export const OcKeyModal: React.FC<OcKeyModalProps> = ({
  isOpen,
  onClose,
  currentOcKey,
  onSaveOcKey,
}) => {
  const [inputKey, setInputKey] = useState(currentOcKey);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  if (!isOpen) return null;

  const handleTestKey = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch(`/api/law/search?ocKey=${encodeURIComponent(inputKey.trim())}&query=관세법`);
      const data = await response.json();

      if (data.success && data.results && data.results.length > 0) {
        setTestResult({
          success: true,
          message: `인증 성공! '관세법' 검색결과 ${data.results.length}건 확인되었습니다.`,
        });
      } else if (data.error) {
        setTestResult({
          success: false,
          message: `오류: ${data.error}`,
        });
      } else {
        setTestResult({
          success: false,
          message: '검색결과가 존재하지 않거나 OC 인증키가 올바르지 않습니다.',
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: `연결 테스트 실패: ${err.message}`,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    if (inputKey.trim()) {
      onSaveOcKey(inputKey.trim());
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
      <div className="bg-slate-900 border border-slate-800 text-slate-100 rounded-xl max-w-lg w-full p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg">
            <Key className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">국가법령 Open API (OC) 인증키 설정</h2>
            <p className="text-xs text-slate-400">
              open.law.go.kr 국가법령정보포털 Open API 이용을 위한 사용자 OC 식별키입니다.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Open API OC Key (사용자 ID)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                placeholder="예: ceiai_law_test"
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
              <button
                onClick={handleTestKey}
                disabled={testing || !inputKey.trim()}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
              >
                {testing ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
                )}
                <span>테스트</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">
              기본 제공 테스트 키: <code className="text-amber-300 font-mono">ceiai_law_test</code>
            </p>
          </div>

          {testResult && (
            <div
              className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${
                testResult.success
                  ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="font-semibold">{testResult.success ? '인증 성공' : '연결 오류'}</p>
                <p className="text-[11px] mt-0.5 opacity-90">{testResult.message}</p>
              </div>
            </div>
          )}

          <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-800 text-xs text-slate-400 space-y-1">
            <p className="font-semibold text-slate-300">💡 국가법령 Open API 서비스 안내</p>
            <p className="leading-relaxed">
              본 앱은 대한민국 국가법령정보포털 DRF (Data Requirement Format) 표준 API를 사용하여 최신 관세법 법령 정보를 수집합니다.
            </p>
            <a
              href="https://open.law.go.kr/LSO/usr/usrOcInfoMod.do"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 mt-1 underline"
            >
              <span>국가법령 Open API 신청 및 안내 페이지 바로가기</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors"
          >
            적용 및 저장
          </button>
        </div>
      </div>
    </div>
  );
};
