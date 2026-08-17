import React, { useState } from 'react';
import { X, CheckCircle2, AlertCircle, RefreshCw, Key, ExternalLink } from 'lucide-react';
import { safeFetchJson } from '../lib/apiHelper';

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
      const data = await safeFetchJson<any>(`/api/law/search?ocKey=${encodeURIComponent(inputKey.trim())}&query=관세법`);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="bg-white border border-slate-200 text-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-600 rounded-xl">
            <Key className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-900">국가법령 Open API (OC) 인증키 설정</h2>
            <p className="text-xs text-slate-500">
              open.law.go.kr 국가법령정보포털 Open API 이용을 위한 사용자 OC 식별키입니다.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Open API OC Key (사용자 ID)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                placeholder="예: ceiai_law_test"
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
              />
              <button
                onClick={handleTestKey}
                disabled={testing || !inputKey.trim()}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl border border-slate-200 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
                <span>{testing ? '검증 중' : '키 검증'}</span>
              </button>
            </div>
          </div>

          {/* Test Result Message */}
          {testResult && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                testResult.success
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}

          {/* Information Notice */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs text-slate-600 space-y-1.5">
            <p className="font-bold text-slate-800">💡 국가법령정보 Open API 안내</p>
            <p>
              기본 제공되는 <code className="text-indigo-600 font-bold font-mono">ceiai_law_test</code> 키로 즉시 테스트가 가능합니다.
            </p>
            <p>
              개인 전용 인증키 발급은 국가법령정보 공동활용센터에서 무료로 신청하실 수 있습니다.
            </p>
            <a
              href="https://open.law.go.kr"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-semibold pt-1"
            >
              <span>open.law.go.kr 바로가기</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors"
            >
              닫기
            </button>
            <button
              onClick={handleSave}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-sm hover:shadow transition-all"
            >
              인증키 저장 및 적용
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
