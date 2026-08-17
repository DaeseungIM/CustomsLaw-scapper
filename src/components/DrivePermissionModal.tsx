import React, { useState } from 'react';
import { Shield, Lock, Globe, Mail, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { DrivePermissionOption } from '../types';

interface DrivePermissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (option: DrivePermissionOption) => void;
  folderName: string;
  itemCount: number;
}

export const DrivePermissionModal: React.FC<DrivePermissionModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  folderName,
  itemCount,
}) => {
  const [selectedType, setSelectedType] = useState<'private' | 'anyone'>('private');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden transform transition-all">
        {/* Header */}
        <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-100">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Google Drive 접근 권한 설정</h3>
              <p className="text-xs text-slate-500">저장할 폴더 및 시트 파일의 공유 권한을 지정합니다.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs text-slate-700 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-600">대상 폴더:</span>
              <span className="font-mono font-medium text-indigo-700 bg-white px-2 py-0.5 rounded border border-slate-200">{folderName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-600">생성될 시트 파일:</span>
              <span className="font-medium text-slate-800">{itemCount}개 개정연혁 시트</span>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-semibold text-slate-700 block uppercase tracking-wider">
              공유 권한 모드 선택
            </label>

            {/* Option 1: Private (Default) */}
            <div
              onClick={() => setSelectedType('private')}
              className={`flex items-start p-4 rounded-xl border-2 cursor-pointer transition-all ${
                selectedType === 'private'
                  ? 'border-indigo-600 bg-indigo-50/50 shadow-sm'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div className="mt-0.5 mr-3 text-slate-700">
                <Lock className={`w-5 h-5 ${selectedType === 'private' ? 'text-indigo-600' : 'text-slate-400'}`} />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-900">비공개 (소유자 전용 - 권장)</span>
                  {selectedType === 'private' && <CheckCircle2 className="w-4 h-4 text-indigo-600" />}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  내 Google 계정 소유자만 안전하게 접근 및 열람할 수 있는 기본 비공개 상태로 저장합니다.
                </p>
              </div>
            </div>

            {/* Option 2: Anyone with Link (Reader) */}
            <div
              onClick={() => setSelectedType('anyone')}
              className={`flex items-start p-4 rounded-xl border-2 cursor-pointer transition-all ${
                selectedType === 'anyone'
                  ? 'border-indigo-600 bg-indigo-50/50 shadow-sm'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div className="mt-0.5 mr-3 text-slate-700">
                <Globe className={`w-5 h-5 ${selectedType === 'anyone' ? 'text-indigo-600' : 'text-slate-400'}`} />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-900">링크가 있는 모든 사용자 (뷰어)</span>
                  {selectedType === 'anyone' && <CheckCircle2 className="w-4 h-4 text-indigo-600" />}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  생성된 시트 및 폴더 링크를 가진 누구나 로그인 없이 문서를 조회할 수 있도록 권한을 설정합니다.
                </p>
              </div>
            </div>
          </div>

          <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 flex items-start space-x-2 text-xs text-amber-800">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              저장 후에도 언제든지 상단 화면의 <strong>'권한 설정 해제'</strong> 버튼을 통해 모든 외부 공유 권한을 즉시 비공개로 되돌릴 수 있습니다.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex items-center justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 bg-slate-100 rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ type: selectedType, role: 'reader' })}
            className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm hover:shadow transition-all flex items-center space-x-2"
          >
            <span>확인 및 저장 시작</span>
          </button>
        </div>
      </div>
    </div>
  );
};
