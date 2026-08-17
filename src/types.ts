export interface LawRevisionItem {
  lawId: string;
  lawMst: string;
  lawName: string;
  promulgationDate: string;
  promulgationNo: string;
  enforcementDate: string;
  revisionType: string; // e.g. 일부개정, 타법개정, 제정
  department: string; // 소관부처 (e.g. 기획재정부)
  lawType: string; // 법령종류 (e.g. 법률)
}

export interface LawInfo {
  lawId: string;
  lawMst: string;
  lawName: string;
  promulgationDate: string;
  promulgationNo: string;
  enforcementDate: string;
  revisionType: string; // e.g. 일부개정, 타법개정, 제정
  department: string; // 소관부처 (e.g. 기획재정부)
  lawType: string; // 법령종류 (e.g. 법률)
  articleCount?: number;
}

export interface LawArticle {
  articleNo: string; // e.g., "제1조"
  articleTitle: string; // e.g., "목적"
  articleContent: string; // Main text
  chapterName?: string; // e.g., "제1장 총칙"
  sectionName?: string; // e.g., "제1절 통칙"
  subsectionName?: string; // e.g., "제1관"
  effectiveDate?: string;
  isDeleted?: boolean;
}

export interface CustomsActData {
  info: LawInfo;
  articles: LawArticle[];
  fetchedAt: string;
}

export interface ExportConfig {
  targetType: 'new' | 'existing';
  spreadsheetIdOrUrl?: string;
  sheetName?: string;
  includeOverview: boolean;
  autoFormat: boolean;
  exportAll140?: boolean;
  exportMode?: 'selected' | 'separate_files_140' | 'single_file_140';
}

export interface ProcessStep {
  id: string;
  title: string;
  status: 'idle' | 'running' | 'success' | 'error';
  message?: string;
}

export interface UserProfile {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

export interface DecisionItem {
  id: string;
  year?: string;
  caseNo: string;
  title: string;
  decisionDate: string;
  department: string;
  targetType: string;
  relLaw?: string;
  itemDesc?: string;
  summary?: string;
  content?: string;
  category?: string;
}

export interface YearlyDecisionStat {
  year: string;
  committeeCount: number; // 위원회결정사항 (04)
  councilCount: number;   // 협의회결정사항 (03)
  caseCount: number;      // 품목분류사례 (01)
  totalCount: number;     // 합계
}

export interface HskItem {
  hskCode: string;
  pureCode: string;
  nameKo: string;
  nameEn: string;
  generalRate: string;
  agreementRate: string;
  unit1: string;
  unit2: string;
  remarks: string;
}

export interface HsExplanatoryItem {
  category: string;
  sectionChapter: string;
  hsHeading: string;
  titleKo: string;
  titleEn: string;
  scopeContent: string;
  guideline: string;
}

export interface HsOpinionItem {
  category: string;
  opinionNo: string;
  subheading: string;
  itemName: string;
  opinionText: string;
  rationale: string;
  remarks: string;
}

export type SearchTargetType = 'law' | 'admrul';

export interface UnifiedSearchItem {
  id: string;
  seq: string;
  name: string;
  targetType: SearchTargetType;
  department: string;
  promulgationDate: string;
  promulgationNo: string;
  enforcementDate: string;
  revisionType: string;
  ruleType?: string; // 법률, 대통령령, 기획재정부령, 훈령, 예규, 고시 등
  currentYn?: string;
}

export interface UnifiedRevisionItem {
  id: string;
  seq: string;
  name: string;
  targetType: SearchTargetType;
  promulgationDate: string;
  promulgationNo: string;
  enforcementDate: string;
  revisionType: string;
  department: string;
  ruleType: string;
  checked?: boolean;
}

export interface DriveFolderInfo {
  id: string;
  name: string;
  url: string;
  created: boolean;
  isExisting: boolean;
}

export interface DrivePermissionOption {
  type: 'private' | 'anyone' | 'user';
  role: 'reader' | 'writer';
  email?: string;
}

export interface SaveProgressState {
  isSaving: boolean;
  currentStep: number;
  totalSteps: number;
  percentage: number;
  message: string;
  folderInfo?: DriveFolderInfo | null;
  savedSheets?: Array<{ title: string; url: string; isExisting?: boolean }>;
  error?: string | null;
}


