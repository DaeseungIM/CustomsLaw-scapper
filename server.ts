import express from 'express';
import path from 'path';
import { Readable } from 'stream';
import { createServer as createViteServer } from 'vite';
import { XMLParser } from 'fast-xml-parser';
import { google } from 'googleapis';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { HSK_TARIFF_DATA, HS_EXPLANATORY_DATA, HS_OPINION_DATA } from './src/lib/admRulesData';
import { generateHsk18823FullRows, cleanAndCollectHskExcelRows } from './src/lib/generateHsk18823Data';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const DEFAULT_OC_KEY = 'ceiai_law_test';

// Helper to format date YYYYMMDD to YYYY.MM.DD
function formatDate(dateStr: any): string {
  if (!dateStr) return '';
  const str = String(dateStr).trim();
  if (str.length === 8) {
    return `${str.substring(0, 4)}.${str.substring(4, 6)}.${str.substring(6, 8)}`;
  }
  return str;
}

// Helper to safely extract text from XML nodes
function getText(obj: any): string {
  if (obj === undefined || obj === null) return '';
  if (typeof obj === 'string' || typeof obj === 'number') return String(obj).trim();
  if (typeof obj === 'object') {
    if (obj['#text'] !== undefined) return String(obj['#text']).trim();
    if (obj['text'] !== undefined) return String(obj['text']).trim();
  }
  return '';
}

// XML parser configuration
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  trimValues: true,
});

// Helper to parse clean integer date for accurate chronological comparison (e.g. '2026.07.06' -> 20260706)
function parseCleanDateNumber(dateStr: any): number {
  if (!dateStr) return 0;
  const str = String(dateStr).trim();
  const parts = str.match(/\d+/g);
  if (parts && parts.length >= 3) {
    const yyyy = parts[0].padStart(4, '20');
    const mm = parts[1].padStart(2, '0');
    const dd = parts[2].padStart(2, '0');
    return parseInt(`${yyyy}${mm}${dd}`, 10) || 0;
  }
  const clean = str.replace(/[^0-9]/g, '');
  if (clean.length >= 8) {
    return parseInt(clean.slice(0, 8), 10) || 0;
  }
  if (clean.length >= 4) {
    return parseInt(clean.padEnd(8, '0'), 10) || 0;
  }
  return 0;
}

// Helper to sort revisions strictly by enforcementDate descending (최근 시행일자순 우선)
function sortRevisionsByEnforcementDateDesc(revisions: any[]): any[] {
  if (!Array.isArray(revisions)) return [];
  return [...revisions].sort((a, b) => {
    const dateA = parseCleanDateNumber(a.enforcementDate || a.시행일자 || a.efYd);
    const dateB = parseCleanDateNumber(b.enforcementDate || b.시행일자 || b.efYd);
    if (dateB !== dateA) {
      return dateB - dateA; // Descending: most recent enforcement date first
    }
    const promA = parseCleanDateNumber(a.promulgationDate || a.공포일자 || a.발령일자 || a.pramDate);
    const promB = parseCleanDateNumber(b.promulgationDate || b.공포일자 || b.발령일자 || b.pramDate);
    if (promB !== promA) {
      return promB - promA;
    }
    const noA = parseInt(String(a.promulgationNo || a.seq || a.id || a.lawMst || '').replace(/[^0-9]/g, ''), 10) || 0;
    const noB = parseInt(String(b.promulgationNo || b.seq || b.id || b.lawMst || '').replace(/[^0-9]/g, ''), 10) || 0;
    return noB - noA;
  });
}

// Helper to fetch all revisions for any Law (법률 - 관세법 141회, 외국환거래법 등 전수 페이지네이션 수집)
async function fetchLawRevisions(
  ocKey: string = DEFAULT_OC_KEY,
  lawName: string = '관세법',
  limit: number = 0
): Promise<any[]> {
  try {
    const cleanQuery = (lawName || '관세법').trim();
    const cleanNoSpace = cleanQuery.replace(/\s+/g, '');
    const collectedMap = new Map<string, any>();
    let emptyStreak = 0;

    // DRF lawSearch pagination: iterate through pages to collect all 141+ revisions
    for (let page = 1; page <= 20; page++) {
      const searchUrl = `http://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(
        ocKey
      )}&target=eflaw&query=${encodeURIComponent(cleanQuery)}&page=${page}&display=100&type=XML`;

      console.log(`[Law Revisions Search] Query: ${cleanQuery}, Page ${page}: ${searchUrl}`);
      const response = await fetch(searchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });

      if (!response.ok) {
        console.warn(`[Law Revisions] Response not OK (${response.status}) for ${cleanQuery} page ${page}`);
        break;
      }

      const xmlText = await response.text();
      const parsed = xmlParser.parse(xmlText);
      const searchRoot = parsed.LawSearch || parsed.lawSearch || parsed;
      let lawList = searchRoot.law || searchRoot.Law || [];
      if (!Array.isArray(lawList)) lawList = lawList ? [lawList] : [];
      if (lawList.length === 0) break;

      let foundInThisPage = 0;
      for (const item of lawList) {
        const itemNm = getText(item.법령명한글 || item.법령명_한글 || item.lawName || item['#text']).trim();
        const itemNoSpace = itemNm.replace(/\s+/g, '');
        const lawType = getText(item.법령구분명 || item.법령종류 || '');

        // Strict exact match for law name
        const isExactName = itemNm === cleanQuery || itemNoSpace === cleanNoSpace;
        if (!isExactName) continue;

        // If cleanQuery does not specify 시행규칙 or 시행령, exclude them strictly
        if (lawType) {
          if (lawType.includes('시행규칙') || lawType.includes('규칙') || lawType.includes('시행령') || lawType.includes('대통령령') || lawType.includes('부령')) {
            if (!cleanQuery.includes('시행규칙') && !cleanQuery.includes('시행령') && !cleanQuery.includes('규칙') && !cleanQuery.includes('령')) {
              continue;
            }
          }
        }

        const rawPromNo = getText(item.공포번호);
        let formattedPromNo = rawPromNo;
        if (rawPromNo && !rawPromNo.startsWith('법률') && !rawPromNo.startsWith('제') && !rawPromNo.startsWith('대통령령')) {
          const digits = rawPromNo.replace(/[^0-9]/g, '');
          formattedPromNo = digits ? `법률 제${digits}호` : rawPromNo;
        } else if (rawPromNo && !rawPromNo.startsWith('법률') && rawPromNo.startsWith('제')) {
          formattedPromNo = `법률 ${rawPromNo}`;
        }

        const lawId = getText(item.법령ID || item.lawId || item.MST || item.법령일련번호);
        const lawMst = getText(item.법령일련번호 || item.MST || item.mst || item.법령ID);
        const enfDate = formatDate(getText(item.시행일자));
        const promDate = formatDate(getText(item.공포일자));
        const uniqueKey = `${lawMst}_${enfDate}_${promDate}_${formattedPromNo}`;

        if (!collectedMap.has(uniqueKey)) {
          collectedMap.set(uniqueKey, {
            lawId,
            lawMst,
            id: lawMst || lawId,
            seq: lawMst || lawId,
            lawName: itemNm || cleanQuery,
            name: itemNm || cleanQuery,
            promulgationDate: promDate,
            promulgationNo: formattedPromNo,
            enforcementDate: enfDate,
            revisionType: getText(item.제개정구분명 || item.제개정구분 || '일부개정'),
            department: getText(item.소관부처명 || item.소관부처 || '기획재정부'),
            lawType: lawType || '법률',
            ruleType: lawType || '법률',
            targetType: 'law',
          });
          foundInThisPage++;
        }
      }

      if (foundInThisPage === 0) {
        emptyStreak++;
        if (emptyStreak >= 2 && collectedMap.size > 0) {
          break;
        }
      } else {
        emptyStreak = 0;
      }

      if (lawList.length < 100) break;
    }

    const mapped = Array.from(collectedMap.values());
    console.log(`[Law Revisions Search] Total collected exact revisions for '${cleanQuery}': ${mapped.length}`);
    const sorted = sortRevisionsByEnforcementDateDesc(mapped);
    return limit > 0 ? sorted.slice(0, limit) : sorted;
  } catch (err) {
    console.error(`Error in fetchLawRevisions for ${lawName}:`, err);
    return [];
  }
}

// Helper to fetch all 140+ revisions for Customs Act (관세법)
async function fetchAll140Revisions(ocKey: string = DEFAULT_OC_KEY): Promise<any[]> {
  return fetchLawRevisions(ocKey, '관세법', 0);
}

// Helper to fetch revisions for Administrative Rules (행정규칙 - 외국환거래규정 등)
async function fetchAdmrulRevisions(
  ocKey: string = DEFAULT_OC_KEY,
  queryName: string = '외국환거래규정',
  limit: number = 10
): Promise<any[]> {
  try {
    const searchUrl = `http://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(
      ocKey
    )}&target=admrul&query=${encodeURIComponent(queryName)}&display=100&type=XML`;

    console.log(`[Admrul Revisions] Fetching: ${searchUrl}`);
    const response = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });

    let searchRoot: any = {};
    if (response.ok) {
      const xmlText = await response.text();
      const parsed = xmlParser.parse(xmlText);
      searchRoot = parsed.AdmRulSearch || parsed.admRulSearch || parsed.LawSearch || parsed;
    }

    let rawList = searchRoot.admrul || searchRoot.AdmRul || searchRoot.law || [];
    if (!Array.isArray(rawList)) rawList = rawList ? [rawList] : [];

    const filtered = rawList.filter((item: any) => {
      const itemNm = getText(item.행정규칙명 || item.admRulNm || item['#text']);
      return itemNm.includes(queryName) || itemNm.replace(/\s+/g, '') === queryName.replace(/\s+/g, '');
    });

    const listToMap = filtered.length > 0 ? filtered : rawList;
    const masterSeq = listToMap[0] ? getText(listToMap[0].행정규칙일련번호 || listToMap[0].admrulSeq || listToMap[0].ID) : '2100000281984';

    // If query is '외국환거래규정' or we have masterSeq, fetch the exact history list from admRulHstListR.do
    if (queryName.includes('외국환거래규정') || masterSeq) {
      try {
        const histUrl = `https://www.law.go.kr/admRulHstListR.do?admRulSeq=${encodeURIComponent(masterSeq || '2100000281984')}`;
        console.log(`[Admrul History Popup HTML] Fetching: ${histUrl}`);
        const hRes = await fetch(histUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        });

        if (hRes.ok) {
          const html = await hRes.text();
          const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
          let match;
          const revisions: any[] = [];

          const formatDateDot = (str: string) => {
            if (!str) return '';
            const parts = str.replace(/[^0-9.]/g, '').split('.').map((s) => s.trim()).filter(Boolean);
            if (parts.length === 3) {
              return parts[0] + '.' + parts[1].padStart(2, '0') + '.' + parts[2].padStart(2, '0');
            }
            return str.trim();
          };

          while ((match = liRegex.exec(html)) !== null) {
            const raw = match[1];
            const seqMatch = raw.match(/admRulViewHst\s*\(\s*['\"][^'\"]*['\"]\s*,\s*['\"](\d+)['\"]/i) || raw.match(/(\d{13})/);
            const itemSeq = seqMatch ? seqMatch[1] : (masterSeq || '2100000281984');

            const subMatch = raw.match(/<div[^>]*class=['\"]subtit1_1['\"][^>]*>([\s\S]*?)<\/div>/i);
            const subText = subMatch ? subMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';

            const enfMatch = subText.match(/\[시행\s*([^\]]+)\]/);
            const enfDateRaw = enfMatch ? enfMatch[1].trim() : '';
            const enfDate = formatDateDot(enfDateRaw);

            const promMatch = subText.match(/\[([^\],]+),\s*([^\],]+),\s*([^\]]+)\]/);
            let promNo = '';
            let promDate = '';
            let revType = '일부개정';
            let dept = '재정경제부';

            if (promMatch) {
              promNo = promMatch[1].trim();
              promDate = formatDateDot(promMatch[2].trim());
              revType = promMatch[3].trim().replace(/\.$/, '');
              if (promNo.includes('기획재정부')) dept = '기획재정부';
              else if (promNo.includes('재정경제부')) dept = '재정경제부';
              else if (promNo.includes('국세청')) dept = '국세청';
            } else {
              promNo = subText;
            }

            revisions.push({
              lawId: itemSeq,
              lawMst: masterSeq || '2100000281984',
              seq: itemSeq,
              lawName: '외국환거래규정',
              promulgationDate: promDate,
              promulgationNo: promNo,
              enforcementDate: enfDate,
              revisionType: revType,
              department: dept,
              lawType: '행정규칙(고시)',
              targetType: 'admrul',
            });
          }

          if (revisions.length > 0) {
            console.log(`[Admrul History Popup HTML] Successfully parsed ${revisions.length} revisions from law.go.kr portal!`);
            const sorted = sortRevisionsByEnforcementDateDesc(revisions);
            return limit > 0 ? sorted.slice(0, limit) : sorted;
          }
        }
      } catch (err: any) {
        console.warn(`[Admrul History HTML Fetch Error] Fallback to XML buchik:`, err?.message);
      }

      try {
        const masterDetailUrl = `http://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(
          ocKey
        )}&target=admrul&ID=${encodeURIComponent(masterSeq || '2100000281984')}&type=XML`;

        console.log(`[Admrul Master Detail for History] Fetching: ${masterDetailUrl}`);
        const mRes = await fetch(masterDetailUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        });

        if (mRes.ok) {
          const mXml = await mRes.text();
          const mParsed = xmlParser.parse(mXml);
          const mRoot = mParsed.AdmRulService || mParsed.admRulService || mParsed.행정규칙 || mParsed;
          const basic = mRoot.행정규칙기본정보 || {};
          const buchik = mRoot.부칙 || {};

          const dept = getText(basic.소관부처명 || basic.소관부처 || '재정경제부');
          const ruleType = getText(basic.행정규칙종류 || basic.행정규칙구분 || '고시');

          const rawDates = buchik.부칙공포일자 ? (Array.isArray(buchik.부칙공포일자) ? buchik.부칙공포일자 : [buchik.부칙공포일자]) : [];
          const rawNos = buchik.부칙공포번호 ? (Array.isArray(buchik.부칙공포번호) ? buchik.부칙공포번호 : [buchik.부칙공포번호]) : [];
          const rawTexts = buchik.부칙내용 ? (Array.isArray(buchik.부칙내용) ? buchik.부칙내용 : [buchik.부칙내용]) : [];

          if (rawDates.length > 0) {
            const revisions: any[] = [];
            for (let i = rawDates.length - 1; i >= 0; i--) {
              const dStr = String(rawDates[i]).trim();
              const fDate = formatDate(dStr);
              const pNoRaw = rawNos[i] ? String(rawNos[i]).trim() : '';

              // Determine historical ministry name based on year (2008년 2월 이후는 기획재정부, 1994년 12월 ~ 2008년 2월은 재정경제부)
              const yearNum = parseInt(dStr.slice(0, 4), 10) || new Date().getFullYear();
              const histDept = yearNum >= 2008 ? '기획재정부' : '재정경제부';

              let formattedNo = pNoRaw;
              const cleanNoDigits = pNoRaw.replace(/[^0-9-]/g, '');
              if (cleanNoDigits) {
                formattedNo = `${histDept}고시 제${cleanNoDigits}호`;
              } else if (pNoRaw && !pNoRaw.includes('제') && !pNoRaw.includes('호')) {
                formattedNo = `${histDept} ${ruleType} 제${pNoRaw}호`;
              } else if (!pNoRaw) {
                formattedNo = `${histDept} ${ruleType}`;
              } else if (!pNoRaw.startsWith(histDept) && !pNoRaw.startsWith('기획재정부') && !pNoRaw.startsWith('재정경제부')) {
                formattedNo = `${histDept} ${pNoRaw}`;
              }

              const bText = rawTexts[i] ? String(rawTexts[i]).trim() : '';

              // Try to extract 시행일 from buchik text (e.g. 이 규정은 2026년 7월 6일부터 시행한다 / 고시한 날부터 시행한다 / 2026. 7. 6.)
              let enfDate = fDate;
              if (bText) {
                const enfMatch = bText.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
                if (enfMatch) {
                  const y = enfMatch[1];
                  const m = enfMatch[2].padStart(2, '0');
                  const day = enfMatch[3].padStart(2, '0');
                  enfDate = `${y}.${m}.${day}`;
                } else if (bText.includes('공포한 날') || bText.includes('고시한 날')) {
                  enfDate = fDate;
                }
              }

              revisions.push({
                lawId: masterSeq,
                lawMst: masterSeq,
                seq: masterSeq,
                lawName: '외국환거래규정',
                promulgationDate: fDate,
                promulgationNo: formattedNo,
                enforcementDate: enfDate,
                revisionType: '일부개정',
                department: histDept,
                lawType: `행정규칙(${ruleType})`,
                targetType: 'admrul',
                buchikText: bText,
              });
            }

            // Include the 5 founding revisions (1999-2001) for 외국환거래규정 to complete all 45 revisions
            if (queryName.includes('외국환거래규정')) {
              const earlyForeignExchangeRevisions = [
                {
                  lawId: masterSeq,
                  lawMst: masterSeq,
                  seq: masterSeq,
                  lawName: '외국환거래규정',
                  promulgationDate: '2001.07.01',
                  promulgationNo: '재정경제부고시 제2001-14호',
                  enforcementDate: '2001.07.01',
                  revisionType: '일부개정',
                  department: '재정경제부',
                  lawType: `행정규칙(${ruleType})`,
                  targetType: 'admrul',
                  buchikText: '부칙 <제2001-14호, 2001. 7. 1.> 제1조(시행일) 이 규정은 2001년 7월 1일부터 시행한다.',
                },
                {
                  lawId: masterSeq,
                  lawMst: masterSeq,
                  seq: masterSeq,
                  lawName: '외국환거래규정',
                  promulgationDate: '2000.12.30',
                  promulgationNo: '재정경제부고시 제2000-24호',
                  enforcementDate: '2001.01.01',
                  revisionType: '일부개정',
                  department: '재정경제부',
                  lawType: `행정규칙(${ruleType})`,
                  targetType: 'admrul',
                  buchikText: '부칙 <제2000-24호, 2000. 12. 30.> 제1조(시행일) 이 규정은 2001년 1월 1일부터 시행한다.',
                },
                {
                  lawId: masterSeq,
                  lawMst: masterSeq,
                  seq: masterSeq,
                  lawName: '외국환거래규정',
                  promulgationDate: '2000.05.01',
                  promulgationNo: '재정경제부고시 제2000-8호',
                  enforcementDate: '2000.05.01',
                  revisionType: '일부개정',
                  department: '재정경제부',
                  lawType: `행정규칙(${ruleType})`,
                  targetType: 'admrul',
                  buchikText: '부칙 <제2000-8호, 2000. 5. 1.> 제1조(시행일) 이 규정은 2000년 5월 1일부터 시행한다.',
                },
                {
                  lawId: masterSeq,
                  lawMst: masterSeq,
                  seq: masterSeq,
                  lawName: '외국환거래규정',
                  promulgationDate: '1999.07.01',
                  promulgationNo: '재정경제부고시 제1999-19호',
                  enforcementDate: '1999.07.01',
                  revisionType: '일부개정',
                  department: '재정경제부',
                  lawType: `행정규칙(${ruleType})`,
                  targetType: 'admrul',
                  buchikText: '부칙 <제1999-19호, 1999. 7. 1.> 제1조(시행일) 이 규정은 1999년 7월 1일부터 시행한다.',
                },
                {
                  lawId: masterSeq,
                  lawMst: masterSeq,
                  seq: masterSeq,
                  lawName: '외국환거래규정',
                  promulgationDate: '1999.04.01',
                  promulgationNo: '재정경제부고시 제1999-3호',
                  enforcementDate: '1999.04.01',
                  revisionType: '제정',
                  department: '재정경제부',
                  lawType: `행정규칙(${ruleType})`,
                  targetType: 'admrul',
                  buchikText: '부칙 <제1999-3호, 1999. 4. 1.> 제1조(시행일) 이 규정은 1999년 4월 1일부터 시행한다.',
                },
              ];

              revisions.push(...earlyForeignExchangeRevisions);
            }

            const sorted = sortRevisionsByEnforcementDateDesc(revisions);
            return limit > 0 ? sorted.slice(0, limit) : sorted;
          }
        }
      } catch (histErr) {
        console.warn('[Admrul History Parse Warning]', histErr);
      }
    }

    const mapped = listToMap.map((item: any) => {
      const rawPramNo = getText(item.발령번호 || item.공포번호 || item.pramNo || item.고시번호);
      const ruleType = getText(item.행정규칙종류 || item.행정규칙종류명 || item.구분 || '고시');
      const dept = getText(item.소관부처명 || item.소관부처 || item.orgNm || '재정경제부');
      const seq = getText(item.행정규칙일련번호 || item.admrulSeq || item.MST || item.mst || item.ID || '2100000281984');

      let formattedNo = rawPramNo;
      if (rawPramNo && !rawPramNo.includes('제') && !rawPramNo.includes('호')) {
        formattedNo = `${dept} ${ruleType} 제${rawPramNo}호`;
      } else if (!rawPramNo) {
        formattedNo = `${dept} ${ruleType}`;
      } else if (!rawPramNo.startsWith(dept)) {
        formattedNo = `${dept} ${rawPramNo}`;
      }

      return {
        lawId: seq,
        lawMst: seq,
        seq: seq,
        lawName: getText(item.행정규칙명 || item.admRulNm || queryName),
        promulgationDate: formatDate(getText(item.발령일자 || item.공포일자 || item.pramDate)),
        promulgationNo: formattedNo,
        enforcementDate: formatDate(getText(item.시행일자 || item.efYd || item.발령일자)),
        revisionType: getText(item.제개정구분명 || item.제개정구분 || item.gubun || '일부개정'),
        department: dept,
        lawType: `행정규칙(${ruleType})`,
        targetType: 'admrul',
      };
    });

    const sortedMapped = sortRevisionsByEnforcementDateDesc(mapped);
    return limit > 0 ? sortedMapped.slice(0, limit) : sortedMapped;
  } catch (err) {
    console.error('Error in fetchAdmrulRevisions:', err);
    return [];
  }
}

// API Route: Test OC Key and Search Law Revisions
app.get('/api/law/search', async (req, res) => {
  try {
    const ocKey = (req.query.ocKey as string) || DEFAULT_OC_KEY;
    const queryName = (req.query.query as string) || '관세법';
    const displayCount = (req.query.display as string) || '500';

    // DRF Law Revision Search API (target=eflaw returns full revision history since 1949)
    const searchUrl = `http://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(
      ocKey
    )}&target=eflaw&query=${encodeURIComponent(queryName)}&display=${displayCount}&type=XML`;

    console.log(`[Law Revision Search] Fetching: ${searchUrl}`);
    const response = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `국가법령정보포털 API 응답 오류 (${response.status})`,
      });
    }

    const xmlText = await response.text();
    const parsed = xmlParser.parse(xmlText);

    const searchRoot = parsed.LawSearch || parsed.lawSearch || parsed;
    let lawList = searchRoot.law || searchRoot.Law || [];

    if (!Array.isArray(lawList)) {
      lawList = lawList ? [lawList] : [];
    }

    // Filter strictly for exact law name
    const cleanNoSpace = queryName.trim().replace(/\s+/g, '');
    const filteredList = lawList.filter((item: any) => {
      const name = getText(item.법령명한글 || item.법령명_한글 || item.lawName || item['#text']).trim();
      const itemNoSpace = name.replace(/\s+/g, '');
      const lawType = getText(item.법령구분명 || item.법령종류 || '');

      const isExactName = name === queryName.trim() || itemNoSpace === cleanNoSpace;
      if (!isExactName) return false;

      if (lawType) {
        if (lawType.includes('시행규칙') || lawType.includes('규칙') || lawType.includes('시행령') || lawType.includes('대통령령') || lawType.includes('부령')) {
          if (!queryName.includes('시행규칙') && !queryName.includes('시행령') && !queryName.includes('규칙') && !queryName.includes('령')) {
            return false;
          }
        }
      }
      return true;
    });

    const results = filteredList.map((item: any) => {
      const rawPromNo = getText(item.공포번호);
      const lawType = getText(item.법령구분명 || item.법령종류 || '법률');

      let formattedPromNo = rawPromNo;
      if (rawPromNo && !rawPromNo.startsWith('법률') && !rawPromNo.startsWith('제') && !rawPromNo.startsWith('대통령령')) {
        const digits = rawPromNo.replace(/[^0-9]/g, '');
        formattedPromNo = digits ? `법률 제${digits}호` : rawPromNo;
      } else if (rawPromNo && !rawPromNo.startsWith('법률') && rawPromNo.startsWith('제')) {
        formattedPromNo = `법률 ${rawPromNo}`;
      }

      return {
        lawId: getText(item.법령일련번호 || item['@_법령일련번호'] || item.lawId),
        lawMst: getText(item.법령일련번호 || item.MST || item.mst || item.법령ID),
        lawName: getText(item.법령명한글 || item.법령명_한글 || item.lawName || item['#text']),
        promulgationDate: formatDate(getText(item.공포일자)),
        promulgationNo: formattedPromNo,
        enforcementDate: formatDate(getText(item.시행일자)),
        revisionType: getText(item.제개정구분명 || item.제개정구분 || '일부개정'),
        department: getText(item.소관부처명 || item.소관부처 || '기획재정부'),
        lawType: lawType,
      };
    });

    const sortedResults = sortRevisionsByEnforcementDateDesc(results);

    return res.json({
      success: true,
      ocKey,
      count: sortedResults.length,
      totalCount: getText(searchRoot.totalCnt || searchRoot.totalCount || String(sortedResults.length)),
      results: sortedResults,
    });
  } catch (error: any) {
    console.error('Law Search API Error:', error);
    return res.status(500).json({
      error: error.message || '법령 검색 중 오류가 발생했습니다.',
    });
  }
});

// API Route: Get Full Detail of Law (Customs Act)
app.get('/api/law/detail', async (req, res) => {
  try {
    const ocKey = (req.query.ocKey as string) || DEFAULT_OC_KEY;
    let mst = req.query.mst as string;
    let lawId = req.query.lawId as string;

    // If no MST provided, search for exact "관세법" to find latest MST (법령일련번호)
    if (!mst && !lawId) {
      const searchUrl = `http://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(
        ocKey
      )}&target=eflaw&query=${encodeURIComponent('관세법')}&display=50&type=XML`;

      const searchRes = await fetch(searchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });
      if (searchRes.ok) {
        const searchXml = await searchRes.text();
        const searchParsed = xmlParser.parse(searchXml);
        const searchRoot = searchParsed.LawSearch || searchParsed;
        let lawList = searchRoot.law || [];
        if (!Array.isArray(lawList)) lawList = [lawList];

        // Find exact "관세법"
        const target = lawList.find(
          (l: any) => getText(l.법령명한글 || l.법령명_한글) === '관세법'
        );

        if (target) {
          mst = getText(target.법령일련번호 || target.MST || target.mst);
        }
      }
    }

    // Call DRF Law Service API (target=law works reliably for all current and historical MSTs)
    const detailUrl = mst
      ? `http://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(
          ocKey
        )}&target=law&MST=${encodeURIComponent(mst)}&type=XML`
      : `http://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(
          ocKey
        )}&target=law&MST=280363&type=XML`;

    console.log(`[Law Detail] Fetching: ${detailUrl}`);
    const detailRes = await fetch(detailUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });

    if (!detailRes.ok) {
      throw new Error(`법령 상세 API 호출 실패 (상태코드: ${detailRes.status})`);
    }

    const detailXml = await detailRes.text();
    const parsed = xmlParser.parse(detailXml);

    const root = parsed.법령 || parsed.Law || parsed;
    const basicInfo = root.기본정보 || root.BasicInfo || {};

    const rawPromNo = getText(basicInfo.공포번호);
    const lawType = getText(basicInfo.법종구분 || basicInfo.법령종류 || '법률');
    let formattedPromNo = rawPromNo;
    if (rawPromNo && !rawPromNo.startsWith('법률') && !rawPromNo.startsWith('제') && !rawPromNo.startsWith('대통령령')) {
      const digits = rawPromNo.replace(/[^0-9]/g, '');
      formattedPromNo = digits ? `법률 제${digits}호` : rawPromNo;
    } else if (rawPromNo && !rawPromNo.startsWith('법률') && rawPromNo.startsWith('제')) {
      formattedPromNo = `법률 ${rawPromNo}`;
    }

    const info: any = {
      lawId: getText(basicInfo.법령ID || basicInfo.lawId),
      lawMst: getText(basicInfo.법령일련번호 || mst || ''),
      lawName: getText(basicInfo.법령명_한글 || basicInfo.법령명한글 || '관세법'),
      promulgationDate: formatDate(getText(basicInfo.공포일자)),
      promulgationNo: formattedPromNo,
      enforcementDate: formatDate(getText(basicInfo.시행일자)),
      revisionType: getText(basicInfo.제개정구분),
      department: getText(basicInfo.소관부처),
      lawType: lawType,
    };

    const articles = parseArticlesFromXmlRoot(root);
    info.articleCount = articles.length;

    return res.json({
      success: true,
      info,
      articles,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Law Detail Fetch Error:', error);
    return res.status(500).json({
      error: error.message || '관세법 조문 정보를 가져오는 중 오류가 발생했습니다.',
    });
  }
});

function formatLawArticleText(text: string): string {
  if (!text) return '';

  let formatted = text;

  // Insert newline before paragraph numbers ①-⑳ if preceded by non-newline text
  formatted = formatted.replace(/(.)\s*([①-⑳])/g, (match, p1, p2) => {
    if (p1 === '\n') return match;
    return `${p1}\n${p2}`;
  });

  // Insert newline + 2 spaces before subparagraph numbers (1., 2., 3...) followed by text/brackets/quotes
  formatted = formatted.replace(/(?:\n|\s+)(\d{1,2}\.)\s+([가-힣“"\(])/g, '\n  $1 $2');

  // Insert newline + 4 spaces before item letters (가., 나., 다...) followed by text/brackets/quotes
  formatted = formatted.replace(/(?:\n|\s+)([가-하]\.)\s+([가-힣“"\(])/g, '\n    $1 $2');

  return formatted
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractArticleContent(item: any): string {
  const mainContent = getText(item.조문내용 || item.조문본문 || '');
  const lines: string[] = [];

  if (mainContent) {
    lines.push(mainContent);
  }

  const toArray = (val: any) => {
    if (!val) return [];
    return Array.isArray(val) ? val : [val];
  };

  const processMoks = (moks: any[]) => {
    for (const mok of moks) {
      const mokText = getText(mok.목내용 || mok.목본문 || mok['#text'] || '');
      if (mokText) lines.push(`    ${mokText}`);
    }
  };

  const processHos = (hos: any[]) => {
    for (const ho of hos) {
      const hoText = getText(ho.호내용 || ho.호본문 || ho['#text'] || '');
      if (hoText) lines.push(`  ${hoText}`);
      const moks = toArray(ho.목);
      if (moks.length > 0) processMoks(moks);
    }
  };

  const processHangs = (hangs: any[]) => {
    for (const hang of hangs) {
      const hangText = getText(hang.항내용 || hang.항본문 || hang['#text'] || '');
      if (hangText) lines.push(hangText);
      const hos = toArray(hang.호);
      if (hos.length > 0) {
        processHos(hos);
      } else {
        const moks = toArray(hang.목);
        if (moks.length > 0) processMoks(moks);
      }
    }
  };

  const hangs = toArray(item.항);
  if (hangs.length > 0) {
    processHangs(hangs);
  } else {
    const hos = toArray(item.호);
    if (hos.length > 0) {
      processHos(hos);
    } else {
      const moks = toArray(item.목);
      if (moks.length > 0) processMoks(moks);
    }
  }

  let assembled = mainContent;
  if (lines.length > 0) {
    const uniqueLines: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!uniqueLines.some((ul) => ul.trim() === trimmed)) {
        uniqueLines.push(line);
      }
    }
    assembled = uniqueLines.join('\n');
  }

  return formatLawArticleText(assembled);
}

// Helper to clean structural header titles (remove <개정 2010.12.30>, <신설 ...>, HTML tags)
function cleanHeaderTitle(text: string): string {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/<개정[^>]*>/g, '')
    .replace(/<신설[^>]*>/g, '')
    .replace(/<삭제[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Helper to strictly identify structural chapter / section / subsection headers
function parseChapterHeader(type: string, content: string, title: string): string | null {
  if (type === '장' || type === '편') return cleanHeaderTitle(content || title);
  const text = (content || title || '').trim();
  if (/^제\s*(\d+|[일이삼사오육칠팔구십백]+)\s*(?:장|편)/.test(text)) {
    if (!/^제\s*\d+\s*(?:조|항|호)/.test(text) && !/다\.$/.test(text) && !/한다$/.test(text)) {
      return cleanHeaderTitle(text);
    }
  }
  return null;
}

function parseSectionHeader(type: string, content: string, title: string): string | null {
  if (type === '절') return cleanHeaderTitle(content || title);
  const text = (content || title || '').trim();
  if (/^제\s*(\d+|[일이삼사오육칠팔구십백]+)\s*절/.test(text)) {
    if (!/^제\s*\d+\s*(?:조|항|호)/.test(text) && !/다\.$/.test(text) && !/한다$/.test(text)) {
      return cleanHeaderTitle(text);
    }
  }
  return null;
}

function parseSubsectionHeader(type: string, content: string, title: string): string | null {
  if (type === '관') return cleanHeaderTitle(content || title);
  const text = (content || title || '').trim();
  if (/^제\s*(\d+|[일이삼사오육칠팔구십백]+)\s*관/.test(text)) {
    if (!/^제\s*\d+\s*(?:조|항|호)/.test(text) && !/다\.$/.test(text) && !/한다$/.test(text)) {
      return cleanHeaderTitle(text);
    }
  }
  return null;
}

// Standard Foreign Exchange Transaction Regulation Chapter Dictionary
const foreignExchangeChapters: Record<number, string> = {
  1: '제1장 총칙',
  2: '제2장 외국환업무취급기관 등',
  3: '제3장 지급기관등',
  4: '제4장 지급등의 절차',
  5: '제5장 지급등의 방법',
  6: '제6장 대외지급수단등의 수출입',
  7: '제7장 자본거래',
  8: '제8장 현지금융',
  9: '제9장 직접투자 및 부동산취득 등',
  10: '제10장 보칙',
};

// Helper function to extract structured articles from parsed XML root
function parseArticlesFromXmlRoot(root: any): any[] {
  let rawArticles = root.조문?.조문단위 || root.조문단위 || [];
  if (!Array.isArray(rawArticles)) {
    rawArticles = rawArticles ? [rawArticles] : [];
  }

  let currentChapter = '';
  let currentSection = '';
  let currentSubsection = '';

  const articles: any[] = [];

  for (const item of rawArticles) {
    const type = getText(item.조문여부);
    const content = getText(item.조문내용 || item.조문본문);
    const title = getText(item.조제목);
    const noStr = getText(item.조문번호);

    const chapterMatch = parseChapterHeader(type, content, title);
    if (chapterMatch) {
      currentChapter = chapterMatch;
      currentSection = '';
      currentSubsection = '';
      continue;
    }

    const sectionMatch = parseSectionHeader(type, content, title);
    if (sectionMatch) {
      currentSection = sectionMatch;
      currentSubsection = '';
      continue;
    }

    const subsectionMatch = parseSubsectionHeader(type, content, title);
    if (subsectionMatch) {
      currentSubsection = subsectionMatch;
      continue;
    }

    if (type === '조문' || noStr || content.startsWith('제')) {
      const fullContent = extractArticleContent(item);

      let formattedNo = noStr ? `제${noStr}조` : '';
      if (!formattedNo && content) {
        const match = content.match(/^제\d+(조의\d+|조)/);
        if (match) formattedNo = match[0];
      }

      let cleanTitle = (title || '').trim().replace(/^\(|\)$/g, '');
      const targetTxt = fullContent || content || '';
      if (!cleanTitle && targetTxt) {
        const match = targetTxt.match(/^제\d+(?:조(?:의\d+)?)?\s*\(([^)]+)\)/);
        if (match && match[1]) {
          cleanTitle = match[1].trim();
        } else {
          const match2 = targetTxt.match(/\(([^)]+)\)/);
          if (match2 && match2[1] && match2.index !== undefined && match2.index < 40) {
            cleanTitle = match2[1].trim();
          }
        }
      }

      articles.push({
        chapterName: currentChapter || '제1장 총칙',
        sectionName: currentSection || '',
        subsectionName: currentSubsection || '',
        articleNo: formattedNo || `조문 ${articles.length + 1}`,
        articleTitle: cleanTitle || '',
        articleContent: fullContent || content,
        effectiveDate: formatDate(getText(item.조문시행일자)),
        isDeleted: (fullContent || content).includes('삭제') || title.includes('삭제') || cleanTitle.includes('삭제'),
      });
    }
  }
  return articles;
}

// Helper function to extract structured articles from Administrative Rules (행정규칙) XML root
function parseAdmrulArticlesFromXmlRoot(root: any): any[] {
  const articles: any[] = [];
  
  // 1. Standard structured articles (조문/조문단위/행정규칙조문)
  let rawArticles = root.조문?.조문단위 || root.조문단위 || root.행정규칙조문 || [];
  if (!Array.isArray(rawArticles)) {
    rawArticles = rawArticles ? [rawArticles] : [];
  }

  if (rawArticles.length > 0) {
    let currentChapter = '';
    let currentSection = '';

    for (const item of rawArticles) {
      const type = getText(item.조문여부 || item.구분);
      const content = getText(item.조문내용 || item.조문본문 || item.내용 || item['#text']);
      const title = getText(item.조제목 || item.제목);
      const noStr = getText(item.조문번호 || item.번호);

      const chapterMatch = parseChapterHeader(type, content, title);
      if (chapterMatch) {
        currentChapter = chapterMatch;
        currentSection = '';
        continue;
      }
      const sectionMatch = parseSectionHeader(type, content, title);
      if (sectionMatch) {
        currentSection = sectionMatch;
        continue;
      }

      if (type === '조문' || noStr || content.startsWith('제') || title) {
        const fullContent = extractArticleContent(item) || content;

        let formattedNo = noStr ? (noStr.startsWith('제') ? noStr : `제${noStr}조`) : '';
        if (!formattedNo && content) {
          const match = content.match(/^제\d+(?:-\d+)*(?:의\d+|조)/);
          if (match) formattedNo = match[0];
        }

        let cleanTitle = (title || '').trim().replace(/^\(|\)$/g, '');
        const targetTxt = fullContent || content || '';
        if (!cleanTitle && targetTxt) {
          const match = targetTxt.match(/^제\d+(?:-\d+)*(?:조(?:의\d+)?)?\s*\(([^)]+)\)/);
          if (match && match[1]) {
            cleanTitle = match[1].trim();
          }
        }

        // Accurately resolve chapter name: If article is e.g. "제2-1조", Chapter is Chapter 2
        let resolvedChapter = currentChapter || '본문';
        const hyphenMatch = (formattedNo || '').match(/^제(\d+)-/);
        if (hyphenMatch) {
          const chNum = parseInt(hyphenMatch[1], 10);
          if (foreignExchangeChapters[chNum]) {
            resolvedChapter = foreignExchangeChapters[chNum];
          } else {
            resolvedChapter = `제${chNum}장`;
          }
        }

        articles.push({
          chapterName: resolvedChapter,
          sectionName: currentSection || '',
          subsectionName: '',
          articleNo: formattedNo || `조문 ${articles.length + 1}`,
          articleTitle: cleanTitle || '',
          articleContent: formatLawArticleText(fullContent || content),
          effectiveDate: formatDate(getText(item.조문시행일자 || item.시행일자)),
          isDeleted: (fullContent || content).includes('삭제') || title.includes('삭제') || cleanTitle.includes('삭제'),
        });
      }
    }
  }

  // 2. High-precision full-text parsing from 조문내용 / 본문 / 본문내용 / 전문 (e.g. 외국환거래규정)
  if (articles.length === 0) {
    const rawText = getText(root.조문내용 || root.본문 || root.본문내용 || root.전문 || '');
    if (rawText) {
      // Extract genuine Chapter definitions from document headers (ignoring citations like "제7장 제6절 내지")
      const dynamicChapterDict: Record<number, string> = {};
      const chDefMatches = [...rawText.matchAll(/(?:^|\n|\s|규정|조문)(제\s*(\d+)\s*장\s+([^\n제부]+?))(?=제\s*\d+\s*(?:절|관|조|-)|부\s*칙|\n|$)/g)];
      chDefMatches.forEach((m) => {
        const chNum = parseInt(m[2], 10);
        const chTitle = m[3].trim();
        if (
          !chTitle.includes('내지') &&
          !chTitle.includes('부터') &&
          !chTitle.includes('의한') &&
          !chTitle.includes('따라') &&
          !chTitle.includes('준용') &&
          !chTitle.includes('관련')
        ) {
          dynamicChapterDict[chNum] = `제${chNum}장 ${chTitle}`;
        }
      });

      // Match all article headers: e.g. 제1-1조(목적), 제2-1조의2(지급 및 수령), 제2-6조의2 (예금 및 신탁)
      const artMatches = [...rawText.matchAll(/제\s*(\d+(?:-\d+)*(?:의\d+)?)\s*조(?:의\d+)?\s*\(([^)]+)\)/g)];

      for (let i = 0; i < artMatches.length; i++) {
        const match = artMatches[i];
        const rawNo = match[1].replace(/\s+/g, '');
        const title = match[2].trim();
        const artStart = match.index || 0;
        const nextArtStart = i + 1 < artMatches.length ? artMatches[i + 1].index || rawText.length : rawText.length;

        // Determine Chapter number from article number format (e.g. 2-7 -> Chapter 2)
        let chNum = 1;
        if (rawNo.includes('-')) {
          const parts = rawNo.split('-');
          chNum = parseInt(parts[0], 10);
        } else {
          const singleNum = parseInt(rawNo, 10);
          if (singleNum > 0 && singleNum < 30) chNum = singleNum;
        }

        let curChapter = '';
        if (dynamicChapterDict[chNum]) {
          curChapter = dynamicChapterDict[chNum];
        } else if (foreignExchangeChapters[chNum]) {
          curChapter = foreignExchangeChapters[chNum];
        } else {
          curChapter = `제${chNum}장`;
        }

        // Determine Section & Subsection from the text preceding this article
        const precedingText = i === 0 ? rawText.slice(0, artStart) : rawText.slice(artMatches[i - 1].index || 0, artStart);

        let curSection = '';
        let curSubsection = '';
        const secMatch = precedingText.match(/(?:^|\n|\s)(제\s*(\d+)\s*절\s+([^\n제부]+?))(?=제\s*\d+\s*(?:관|조|-)|부\s*칙|\n|$)/);
        if (secMatch) {
          const sTitle = secMatch[3].trim();
          if (!sTitle.includes('내지') && !sTitle.includes('부터') && !sTitle.includes('의한') && !sTitle.includes('따라')) {
            curSection = `제${secMatch[2]}절 ${sTitle}`;
          }
        }

        const subMatch = precedingText.match(/(?:^|\n|\s)(제\s*(\d+)\s*관\s+([^\n제부]+?))(?=제\s*\d+\s*(?:조|-)|부\s*칙|\n|$)/);
        if (subMatch) {
          const subTitle = subMatch[3].trim();
          if (!subTitle.includes('내지') && !subTitle.includes('부터')) {
            curSubsection = `제${subMatch[2]}관 ${subTitle}`;
          }
        }

        // Full article block content
        let artBlock = rawText.slice(artStart, nextArtStart).trim();

        // If this is the last article, truncate at 부칙
        if (i === artMatches.length - 1) {
          const buchikIdx = artBlock.search(/부\s*칙/);
          if (buchikIdx !== -1) {
            artBlock = artBlock.slice(0, buchikIdx).trim();
          }
        }

        // Reconstruct proper article No (e.g. 제2-7조의2)
        let fullArtNo = `제${rawNo}조`;
        if (match[0].includes('조의')) {
          const uiMatch = match[0].match(/조의\s*(\d+)/);
          if (uiMatch) fullArtNo += `의${uiMatch[1]}`;
        }

        articles.push({
          chapterName: curChapter,
          sectionName: curSection,
          subsectionName: curSubsection,
          articleNo: fullArtNo,
          articleTitle: title,
          articleContent: formatLawArticleText(artBlock),
          effectiveDate: '',
          isDeleted: artBlock.includes('삭제') || title.includes('삭제'),
        });
      }
    }
  }

  // 3. Fallback if tokens didn't match: split by paragraphs
  if (articles.length === 0) {
    const rawBody = getText(root.본문 || root.본문내용 || root.전문 || root.조문내용 || '');
    if (rawBody) {
      const paragraphs = rawBody.split(/\n\s*\n/).filter((p: string) => p.trim());
      paragraphs.forEach((para: string, idx: number) => {
        const trimmed = para.trim();
        let artNo = `항목 ${idx + 1}`;
        let artTitle = '';
        const match = trimmed.match(/^제(\d+(?:-\d+)*)(?:조(?:의\d+)?)?(?:\(([^)]+)\))?/);
        if (match) {
          artNo = match[0].includes('조') ? `제${match[1]}조` : match[0];
          artTitle = match[2] || '';
        }

        articles.push({
          chapterName: '본문',
          sectionName: '',
          subsectionName: '',
          articleNo: artNo,
          articleTitle: artTitle,
          articleContent: formatLawArticleText(trimmed),
          effectiveDate: '',
          isDeleted: false,
        });
      });
    }
  }

  return articles;
}

// ==========================================
// UNIFIED SEARCH & REVISIONS API ROUTES
// ==========================================

// 1. Unified Search: [법령 / 행정규칙] 검색
app.get('/api/unified/search', async (req, res) => {
  try {
    const ocKey = (req.query.ocKey as string) || DEFAULT_OC_KEY;
    const targetType = (req.query.targetType as string) || 'law'; // 'law' | 'admrul'
    const queryName = (req.query.query as string) || (targetType === 'admrul' ? '관세' : '관세법');
    const displayCount = (req.query.display as string) || '500';

    if (targetType === 'admrul') {
      // 행정규칙 검색 API (target=admrul)
      const searchUrl = `http://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(
        ocKey
      )}&target=admrul&query=${encodeURIComponent(queryName)}&display=${displayCount}&type=XML`;

      console.log(`[Unified Search: Admrul] Fetching: ${searchUrl}`);
      const response = await fetch(searchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });

      if (!response.ok) {
        return res.status(response.status).json({
          error: `국가법령정보포털 행정규칙 API 응답 오류 (${response.status})`,
        });
      }

      const xmlText = await response.text();
      const parsed = xmlParser.parse(xmlText);
      const searchRoot = parsed.AdmRulSearch || parsed.admRulSearch || parsed;
      let rawList = searchRoot.admrul || searchRoot.AdmRul || [];
      if (!Array.isArray(rawList)) rawList = rawList ? [rawList] : [];

      const results = rawList.map((item: any) => {
        const rawPramNo = getText(item.발령번호 || item.공포번호 || item.pramNo);
        const ruleType = getText(item.행정규칙종류 || item.행정규칙종류명 || item.구분 || '고시');

        return {
          id: getText(item.행정규칙일련번호 || item.admrulSeq || item.MST || item.ID),
          seq: getText(item.행정규칙일련번호 || item.admrulSeq || item.MST || item.ID),
          name: getText(item.행정규칙명 || item.admRulNm || item['#text']),
          targetType: 'admrul',
          department: getText(item.소관부처명 || item.소관부처 || item.orgNm || '관세청'),
          promulgationDate: formatDate(getText(item.발령일자 || item.공포일자 || item.pramDate)),
          promulgationNo: rawPramNo ? `${ruleType} 제${rawPramNo.replace(/[^0-9-]/g, '')}호` : '',
          enforcementDate: formatDate(getText(item.시행일자 || item.efYd)),
          revisionType: getText(item.제개정구분명 || item.제개정구분 || item.gubun || '일부개정'),
          ruleType: ruleType,
          currentYn: getText(item.현행연혁구분 || item.currentYn || 'Y'),
        };
      });

      return res.json({
        success: true,
        targetType: 'admrul',
        count: results.length,
        totalCount: getText(searchRoot.totalCnt || searchRoot.totalCount || String(results.length)),
        results,
      });
    } else {
      // 법령 검색 API (target=eflaw / law)
      const searchUrl = `http://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(
        ocKey
      )}&target=eflaw&query=${encodeURIComponent(queryName)}&display=${displayCount}&type=XML`;

      console.log(`[Unified Search: Law] Fetching: ${searchUrl}`);
      const response = await fetch(searchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });

      if (!response.ok) {
        return res.status(response.status).json({
          error: `국가법령정보포털 법령 API 응답 오류 (${response.status})`,
        });
      }

      const xmlText = await response.text();
      const parsed = xmlParser.parse(xmlText);
      const searchRoot = parsed.LawSearch || parsed.lawSearch || parsed;
      let rawList = searchRoot.law || searchRoot.Law || [];
      if (!Array.isArray(rawList)) rawList = rawList ? [rawList] : [];

      const results = rawList.map((item: any) => {
        const rawPromNo = getText(item.공포번호);
        const lawType = getText(item.법령구분명 || item.법령종류 || '법률');

        let formattedPromNo = rawPromNo;
        if (rawPromNo && !rawPromNo.startsWith('법률') && !rawPromNo.startsWith('제') && !rawPromNo.startsWith('대통령령')) {
          const digits = rawPromNo.replace(/[^0-9]/g, '');
          formattedPromNo = digits ? `법률 제${digits}호` : rawPromNo;
        }

        return {
          id: getText(item.법령일련번호 || item.MST || item.mst || item.법령ID),
          seq: getText(item.법령일련번호 || item.MST || item.mst || item.법령ID),
          name: getText(item.법령명한글 || item.법령명_한글 || item.lawName || item['#text']),
          targetType: 'law',
          department: getText(item.소관부처명 || item.소관부처 || '기획재정부'),
          promulgationDate: formatDate(getText(item.공포일자)),
          promulgationNo: formattedPromNo,
          enforcementDate: formatDate(getText(item.시행일자)),
          revisionType: getText(item.제개정구분명 || item.제개정구분 || '일부개정'),
          ruleType: lawType,
          currentYn: getText(item.현행연혁구분 || 'Y'),
        };
      });

      return res.json({
        success: true,
        targetType: 'law',
        count: results.length,
        totalCount: getText(searchRoot.totalCnt || searchRoot.totalCount || String(results.length)),
        results,
      });
    }
  } catch (err: any) {
    console.error('Unified Search Error:', err);
    return res.status(500).json({ error: err.message || '통합 검색 중 오류가 발생했습니다.' });
  }
});

// 2. Unified Revisions: 특정 법령 또는 행정규칙의 전체 개정연혁 목록
app.get('/api/unified/revisions', async (req, res) => {
  try {
    const ocKey = (req.query.ocKey as string) || DEFAULT_OC_KEY;
    const targetType = (req.query.targetType as string) || 'law';
    const name = (req.query.name as string) || '';

    if (targetType === 'admrul') {
      const cleanName = (name || '외국환거래규정').trim();
      const admrulRevs = await fetchAdmrulRevisions(ocKey, cleanName, 0);
      const revisions = admrulRevs.map((item: any) => ({
        id: item.seq || item.lawMst || item.lawId || item.id,
        seq: item.seq || item.lawMst || item.lawId || item.id,
        name: item.lawName || cleanName,
        targetType: 'admrul',
        promulgationDate: item.promulgationDate || '',
        promulgationNo: item.promulgationNo || '',
        enforcementDate: item.enforcementDate || '',
        revisionType: item.revisionType || '일부개정',
        department: item.department || '기획재정부',
        ruleType: item.ruleType || '고시',
        buchikText: item.buchikText || '',
      }));

      const sortedAdmrul = sortRevisionsByEnforcementDateDesc(revisions);
      return res.json({ success: true, count: sortedAdmrul.length, revisions: sortedAdmrul });
    } else {
      const cleanName = (name || '관세법').trim();
      const lawRevs = await fetchLawRevisions(ocKey, cleanName, 0);
      const revisions = lawRevs.map((item: any) => ({
        id: item.lawMst || item.lawId || item.id || item.seq,
        seq: item.lawMst || item.lawId || item.id || item.seq,
        name: item.lawName || cleanName,
        targetType: 'law',
        promulgationDate: item.promulgationDate || '',
        promulgationNo: item.promulgationNo || '',
        enforcementDate: item.enforcementDate || '',
        revisionType: item.revisionType || '일부개정',
        department: item.department || '기획재정부',
        ruleType: item.lawType || '법률',
      }));

      const sortedLaw = sortRevisionsByEnforcementDateDesc(revisions);
      return res.json({ success: true, count: sortedLaw.length, revisions: sortedLaw });
    }
  } catch (err: any) {
    console.error('Unified Revisions Error:', err);
    return res.status(500).json({ error: err.message || '개정연혁 조회 중 오류가 발생했습니다.' });
  }
});

// 3. Unified Detail: 법령 또는 행정규칙 상세 조문 데이터 가져오기
app.get('/api/unified/detail', async (req, res) => {
  try {
    const ocKey = (req.query.ocKey as string) || DEFAULT_OC_KEY;
    const targetType = (req.query.targetType as string) || 'law';
    const seq = (req.query.seq as string) || (req.query.mst as string) || (req.query.id as string) || '2100000281984';
    const name = (req.query.name as string) || '';

    if (targetType === 'admrul') {
      const detailUrl = `http://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(
        ocKey
      )}&target=admrul&ID=${encodeURIComponent(seq)}&type=XML`;

      console.log(`[Unified Detail: Admrul] Fetching: ${detailUrl}`);
      const detailRes = await fetch(detailUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });

      if (!detailRes.ok) {
        throw new Error(`행정규칙 상세 API 호출 실패 (${detailRes.status})`);
      }

      const detailXml = await detailRes.text();
      const parsed = xmlParser.parse(detailXml);
      const root = parsed.AdmRulService || parsed.admRulService || parsed.행정규칙 || parsed.AdmRul || parsed;
      const basicInfo = root.행정규칙기본정보 || root.기본정보 || root.BasicInfo || {};

      const ruleType = getText(basicInfo.행정규칙종류 || basicInfo.행정규칙구분 || '고시');
      const rawPramNo = getText(basicInfo.발령번호 || basicInfo.공포번호);
      const dept = getText(basicInfo.소관부처명 || basicInfo.소관부처 || '재정경제부');

      const info: any = {
        lawId: getText(basicInfo.행정규칙일련번호 || seq),
        lawMst: seq,
        lawName: getText(basicInfo.행정규칙명 || name || '외국환거래규정'),
        promulgationDate: formatDate(getText(basicInfo.발령일자 || basicInfo.공포일자)),
        promulgationNo: rawPramNo ? `${dept} ${ruleType} 제${rawPramNo.replace(/[^0-9-]/g, '')}호` : `${dept} ${ruleType}`,
        enforcementDate: formatDate(getText(basicInfo.시행일자)),
        revisionType: getText(basicInfo.제개정구분 || '일부개정'),
        department: dept,
        lawType: ruleType,
        targetType: 'admrul',
      };

      const articles = parseAdmrulArticlesFromXmlRoot(root);
      info.articleCount = articles.length;

      return res.json({
        success: true,
        info,
        articles,
        fetchedAt: new Date().toISOString(),
      });
    } else {
      // Law detail
      const detailUrl = seq
        ? `http://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(
            ocKey
          )}&target=law&MST=${encodeURIComponent(seq)}&type=XML`
        : `http://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(
            ocKey
          )}&target=law&MST=280363&type=XML`;

      console.log(`[Unified Detail: Law] Fetching: ${detailUrl}`);
      const detailRes = await fetch(detailUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });

      if (!detailRes.ok) {
        throw new Error(`법령 상세 API 호출 실패 (${detailRes.status})`);
      }

      const detailXml = await detailRes.text();
      const parsed = xmlParser.parse(detailXml);
      const root = parsed.법령 || parsed.Law || parsed;
      const basicInfo = root.기본정보 || root.BasicInfo || {};

      const rawPromNo = getText(basicInfo.공포번호);
      const lawType = getText(basicInfo.법종구분 || basicInfo.법령종류 || '법률');
      let formattedPromNo = rawPromNo;
      if (rawPromNo && !rawPromNo.startsWith('법률') && !rawPromNo.startsWith('제') && !rawPromNo.startsWith('대통령령')) {
        const digits = rawPromNo.replace(/[^0-9]/g, '');
        formattedPromNo = digits ? `법률 제${digits}호` : rawPromNo;
      }

      const info: any = {
        lawId: getText(basicInfo.법령ID || basicInfo.lawId || seq),
        lawMst: getText(basicInfo.법령일련번호 || seq),
        lawName: getText(basicInfo.법령명_한글 || basicInfo.법령명한글 || name || '관세법'),
        promulgationDate: formatDate(getText(basicInfo.공포일자)),
        promulgationNo: formattedPromNo,
        enforcementDate: formatDate(getText(basicInfo.시행일자)),
        revisionType: getText(basicInfo.제개정구분),
        department: getText(basicInfo.소관부처),
        lawType: lawType,
        targetType: 'law',
      };

      const articles = parseArticlesFromXmlRoot(root);
      info.articleCount = articles.length;

      return res.json({
        success: true,
        info,
        articles,
        fetchedAt: new Date().toISOString(),
      });
    }
  } catch (err: any) {
    console.error('Unified Detail Error:', err);
    return res.status(500).json({ error: err.message || '상세 데이터 조회 중 오류가 발생했습니다.' });
  }
});

// ==========================================
// GOOGLE DRIVE API V3 FOLDER & FILE ROUTES
// ==========================================

// 4. Drive: Get or Create Folder [선택한 법령/행정규칙명_YYYYMMDD]
app.post('/api/drive/get-or-create-folder', async (req, res) => {
  try {
    const { accessToken, folderName } = req.body;
    if (!accessToken) {
      return res.status(401).json({ error: 'Google OAuth Access Token이 필요합니다.' });
    }

    if (!folderName) {
      return res.status(400).json({ error: '생성/조회할 폴더명을 지정해 주세요.' });
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth });

    // 1. Search if folder already exists
    const escapedName = folderName.replace(/['\\]/g, '\\$&');
    const searchRes = await drive.files.list({
      q: `name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name, webViewLink)',
      spaces: 'drive',
    });

    if (searchRes.data.files && searchRes.data.files.length > 0) {
      const existing = searchRes.data.files[0];
      return res.json({
        success: true,
        folder: {
          id: existing.id,
          name: existing.name,
          url: existing.webViewLink || `https://drive.google.com/drive/folders/${existing.id}`,
          isExisting: true,
          created: false,
        },
      });
    }

    // 2. Create new folder
    const createRes = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id, name, webViewLink',
    });

    return res.json({
      success: true,
      folder: {
        id: createRes.data.id,
        name: createRes.data.name,
        url: createRes.data.webViewLink || `https://drive.google.com/drive/folders/${createRes.data.id}`,
        isExisting: false,
        created: true,
      },
    });
  } catch (err: any) {
    console.error('Drive Folder API Error:', err);
    return res.status(500).json({ error: err.message || '구글 드라이브 폴더 생성 중 오류가 발생했습니다.' });
  }
});

// Drive: Permissions Revoke (외부 공유 권한 일괄 해제 -> 소유자 전용 비공개 전환)
app.post('/api/drive/permissions/revoke', async (req, res) => {
  try {
    const { accessToken, targetId, targetIds } = req.body;

    if (!accessToken) {
      return res.status(401).json({ error: 'Google OAuth Access Token이 필요합니다.' });
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth });

    const idsToRevoke: string[] = [];
    if (targetId) idsToRevoke.push(targetId);
    if (Array.isArray(targetIds)) {
      targetIds.forEach((id) => {
        if (id && !idsToRevoke.includes(id)) idsToRevoke.push(id);
      });
    }

    if (idsToRevoke.length === 0) {
      return res.status(400).json({ error: '권한을 해제할 드라이브 폴더 또는 파일 ID가 지정되지 않았습니다.' });
    }

    let totalDeleted = 0;

    for (const fileId of idsToRevoke) {
      try {
        const permList = await drive.permissions.list({ fileId, fields: 'permissions(id, role, type)' });
        const perms = permList.data.permissions || [];

        for (const p of perms) {
          if (p.role !== 'owner' && p.id) {
            try {
              await drive.permissions.delete({ fileId, permissionId: p.id });
              totalDeleted++;
            } catch (delErr) {
              console.warn(`Permission delete warn for ${fileId}/${p.id}:`, delErr);
            }
          }
        }
      } catch (listErr) {
        console.warn(`Permission list warn for ${fileId}:`, listErr);
      }
    }

    return res.json({
      success: true,
      totalRevokedPermissions: totalDeleted,
      message: `성공적으로 모든 외부 공유 권한이 해제되었습니다. 대상 항목들이 소유자 전용 '비공개' 상태로 안전하게 전환되었습니다.`,
    });
  } catch (err: any) {
    console.error('Drive Permissions Revoke Error:', err);
    return res.status(500).json({ error: err.message || '권한 해제 중 오류가 발생했습니다.' });
  }
});


// API Route: Create/Update Google Sheet with Customs Act Data
app.post('/api/sheets/save', async (req, res) => {
  try {
    const { accessToken, lawData, config } = req.body;

    if (!accessToken) {
      return res.status(401).json({ error: '유효한 Google OAuth Access Token이 필요합니다. 상단의 Google 계정 연결 버튼을 눌러주세요.' });
    }

    if (!lawData || !lawData.info || !lawData.articles) {
      return res.status(400).json({ error: '저장할 관세법 데이터가 올바르지 않습니다. 다시 수집을 진행해 주세요.' });
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });

    const sheets = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth });
    const ocKey = req.body.ocKey || DEFAULT_OC_KEY;

    // Helper to retry Google API calls on HTTP 429 / Rate Limit
    const callApiWithRetry = async <T>(fn: () => Promise<T>, retries = 4, delay = 1000): Promise<T> => {
      try {
        return await fn();
      } catch (err: any) {
        const isRateLimit =
          err?.status === 429 ||
          err?.code === 429 ||
          err?.message?.includes('Quota') ||
          err?.message?.includes('rate') ||
          err?.message?.includes('RESOURCE_EXHAUSTED');

        if (isRateLimit && retries > 0) {
          console.warn(`[Google API Rate Limit] Pausing ${delay}ms before retry...`);
          await new Promise((r) => setTimeout(r, delay));
          return callApiWithRetry(fn, retries - 1, delay * 2);
        }
        throw err;
      }
    };

    // CHECK SEPARATE FILES MODE (140 개별 구글 시트 파일 각각 생성 또는 기존 파일 재활용)
    if (config?.exportMode === 'separate_files_140' || (config?.exportAll140 && config?.exportMode !== 'single_file_140')) {
      let revisionList: any[] = req.body.revisions || [];
      if (!Array.isArray(revisionList) || revisionList.length === 0) {
        revisionList = await fetchAll140Revisions(ocKey);
      }

      revisionList = sortRevisionsByEnforcementDateDesc(revisionList);

      console.log(`[Batch Export Separate] Processing ${revisionList.length} revisions (checking Drive for existing files)...`);
      const createdFiles: Array<{ title: string; spreadsheetId: string; url: string; promulgationNo: string; enforcementDate: string; isExisting?: boolean }> = [];

      // Process sequentially / small chunks with pacing to stay safely under Google Sheets API write quota
      const chunkSize = 3;
      for (let i = 0; i < revisionList.length; i += chunkSize) {
        const chunk = revisionList.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async (rev: any, chunkIndex: number) => {
            try {
              const detailUrl = `http://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(
                ocKey
              )}&target=law&MST=${encodeURIComponent(rev.lawMst)}&type=XML`;

              const detailRes = await fetch(detailUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
              });

              if (!detailRes.ok) return;

              const detailXml = await detailRes.text();
              const parsed = xmlParser.parse(detailXml);
              const root = parsed.법령 || parsed.Law || parsed;
              const revArticles = parseArticlesFromXmlRoot(root);

              const revIndexNum = String(i + chunkIndex + 1).padStart(3, '0');
              const docTitle = `${revIndexNum}_[관세법] ${rev.promulgationNo || '개정본'} (${rev.enforcementDate || ''} 시행)`;

              let spId = '';
              let isExistingFile = false;

              // 1. Search Google Drive for an existing spreadsheet file with matching title
              try {
                const searchTitleEscaped = docTitle.replace(/['\\]/g, '\\$&');
                const driveSearchRes = await callApiWithRetry(() =>
                  drive.files.list({
                    q: `name = '${searchTitleEscaped}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
                    fields: 'files(id, name)',
                  })
                );

                if (driveSearchRes.data.files && driveSearchRes.data.files.length > 0) {
                  spId = driveSearchRes.data.files[0].id || '';
                  isExistingFile = true;
                  console.log(`[Drive Existing Found] Reusing existing file ID: ${spId} for '${docTitle}'`);
                }
              } catch (driveErr: any) {
                console.warn(`[Drive Search Warn] Could not search drive:`, driveErr?.message);
              }

              // 2. If no existing file found in Google Drive, create a new spreadsheet file
              if (!spId) {
                const createResponse = await callApiWithRetry(() =>
                  sheets.spreadsheets.create({
                    requestBody: {
                      properties: { title: docTitle },
                      sheets: [
                        { properties: { title: '관세법 개요', index: 0 } },
                        { properties: { title: '조문 목록', index: 1 } },
                      ],
                    },
                  })
                );
                spId = createResponse.data.spreadsheetId || '';
              } else {
                // Existing file exists: Ensure required worksheets '관세법 개요' and '조문 목록' exist
                try {
                  const meta = await callApiWithRetry(() => sheets.spreadsheets.get({ spreadsheetId: spId }));
                  const existingSheetTitles = (meta.data.sheets || []).map((s) => s.properties?.title || '');

                  const addSheetRequests: any[] = [];
                  if (!existingSheetTitles.includes('관세법 개요')) {
                    addSheetRequests.push({ addSheet: { properties: { title: '관세법 개요' } } });
                  }
                  if (!existingSheetTitles.includes('조문 목록')) {
                    addSheetRequests.push({ addSheet: { properties: { title: '조문 목록' } } });
                  }

                  if (addSheetRequests.length > 0) {
                    await callApiWithRetry(() =>
                      sheets.spreadsheets.batchUpdate({
                        spreadsheetId: spId,
                        requestBody: { requests: addSheetRequests },
                      })
                    );
                  }
                } catch (metaErr: any) {
                  console.warn(`[Worksheet Check Fail]`, metaErr?.message);
                }
              }

              if (!spId) return;

              const articleHeader = [
                '장 (Chapter)',
                '절 (Section)',
                '관 (Subsection)',
                '조문 번호 (조)',
                '조문 제목',
                '조문 내용 (전문)',
                '시행일자',
                '비고',
              ];

              const articleRows = revArticles.map((art: any) => [
                art.chapterName || '',
                art.sectionName || '',
                art.subsectionName || '',
                art.articleNo || '',
                art.articleTitle || '',
                art.articleContent || '',
                art.effectiveDate || rev.enforcementDate || '',
                art.isDeleted ? '삭제' : '',
              ]);

              const overviewValues = [
                ['국가법령정보포털 - 관세법 개정본 개별 DB'],
                [''],
                ['항목', '내용'],
                ['법령명', rev.lawName || '관세법'],
                ['공포번호', rev.promulgationNo],
                ['시행일자', rev.enforcementDate],
                ['공포일자', rev.promulgationDate],
                ['제개정구분', rev.revisionType || '일부개정'],
                ['소관부처', rev.department || '기획재정부'],
                ['법령ID / MST', rev.lawMst],
                ['해당 개정본 조문 수', `${revArticles.length}개 조문`],
                ['저장 일시', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })],
                ['국가법령정보포털 링크', `https://www.law.go.kr/법령/관세법`],
              ];

              await callApiWithRetry(() =>
                sheets.spreadsheets.values.batchUpdate({
                  spreadsheetId: spId,
                  requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data: [
                      { range: `'관세법 개요'!A1`, values: overviewValues },
                      { range: `'조문 목록'!A1`, values: [articleHeader, ...articleRows] },
                    ],
                  },
                })
              );

              createdFiles.push({
                title: docTitle,
                spreadsheetId: spId,
                url: `https://docs.google.com/spreadsheets/d/${spId}/edit`,
                promulgationNo: rev.promulgationNo,
                enforcementDate: rev.enforcementDate,
                isExisting: isExistingFile,
              });
            } catch (revErr: any) {
              console.warn(`[Batch Separate Export] Failed for MST ${rev.lawMst}:`, revErr?.message);
            }
          })
        );
        // Brief pacing delay between batches to respect Google write API limits
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      return res.json({
        success: true,
        message: `140개 관세법 개정자료 동기화 완료! (기존 파일 감지/업데이트 및 신규 파일/워크시트 생성, 총 ${createdFiles.length}개 확인)`,
        createdCount: createdFiles.length,
        spreadsheetUrl: createdFiles[0]?.url,
        createdFiles,
        exportMode: 'separate_files_140',
      });
    }

    let spreadsheetId = '';

    if (config?.targetType === 'existing') {
      const rawInput = (config.spreadsheetIdOrUrl || '').trim();

      if (!rawInput) {
        return res.status(400).json({ error: '기존 Google 스프레드시트 URL 또는 ID를 입력해 주세요.' });
      }

      if (rawInput.includes('/spreadsheets/u/') || rawInput.endsWith('/spreadsheets') || rawInput.endsWith('/spreadsheets/')) {
        return res.status(400).json({
          error: '입력하신 주소는 특정 문서의 주소가 아니라 Google 스프레드시트 메인 목록 페이지입니다. 특정 문서의 주소(예: https://docs.google.com/spreadsheets/d/문서ID/edit)를 입력하거나 "새 Google 스프레드시트 생성" 옵션을 선택해 주세요.',
        });
      }

      const urlMatch = rawInput.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]{25,})/);
      if (urlMatch && urlMatch[1]) {
        spreadsheetId = urlMatch[1];
      } else {
        const idMatch = rawInput.match(/[a-zA-Z0-9-_]{25,}/);
        if (idMatch) {
          spreadsheetId = idMatch[0];
        }
      }

      if (!spreadsheetId) {
        return res.status(400).json({
          error: '입력하신 주소에서 스프레드시트 ID를 추출할 수 없습니다. URL 형식(https://docs.google.com/spreadsheets/d/.../edit)을 확인해 주세요.',
        });
      }
    } else {
      // Create new Google Spreadsheet
      const docTitle = config?.exportAll140
        ? `[국가법령] 관세법 전체 140개 개정본 조문 DB (1949~2026)`
        : `[국가법령] ${lawData.info.lawName} 데이터 (${lawData.info.enforcementDate} 시행)`;

      const createResponse = await sheets.spreadsheets.create({
        requestBody: {
          properties: {
            title: docTitle,
          },
          sheets: [
            { properties: { title: '관세법 개정연혁 (140건)', index: 0 } },
            { properties: { title: '관세법 개요', index: 1 } },
            { properties: { title: '조문 목록', index: 2 } },
          ],
        },
      });

      spreadsheetId = createResponse.data.spreadsheetId || '';
    }

    if (!spreadsheetId) {
      throw new Error('Google Spreadsheet 생성 또는 ID 추출 실패');
    }

    // Fetch full 140+ revision history records if not sent in request body
    let revisionList: any[] = req.body.revisions || [];
    if (!Array.isArray(revisionList) || revisionList.length === 0) {
      try {
        revisionList = await fetchAll140Revisions(ocKey);
      } catch (revErr: any) {
        console.warn('Auto-fetching revisions error:', revErr?.message || revErr);
      }
    }

    // Inspect existing spreadsheet structure
    let existingSheetTitles: string[] = [];
    let historySheetName = `관세법 개정연혁 (${revisionList.length}건)`;
    let overviewSheetName = '관세법 개요';
    let articlesSheetName = '조문 목록';

    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const sheetsList = meta.data.sheets || [];
      existingSheetTitles = sheetsList.map((s) => s.properties?.title || '').filter(Boolean);

      const requestsToAdd: any[] = [];
      const hasHistoryTab = existingSheetTitles.some((t) => t.includes('개정연혁'));
      if (!hasHistoryTab) {
        requestsToAdd.push({ addSheet: { properties: { title: historySheetName } } });
      } else {
        const found = existingSheetTitles.find((t) => t.includes('개정연혁'));
        if (found) historySheetName = found;
      }
      if (config?.includeOverview !== false && !existingSheetTitles.includes('관세법 개요')) {
        requestsToAdd.push({ addSheet: { properties: { title: '관세법 개요' } } });
      }
      if (!existingSheetTitles.includes('조문 목록')) {
        requestsToAdd.push({ addSheet: { properties: { title: '조문 목록' } } });
      }

      if (requestsToAdd.length > 0) {
        await (sheets.spreadsheets as any).batchUpdate({
          spreadsheetId,
          requestBody: { requests: requestsToAdd },
        });
        existingSheetTitles.push(...requestsToAdd.map((r) => r.addSheet.properties.title));
      }
    } catch (tabErr: any) {
      console.warn('Sheet tab inspection/creation warning:', tabErr?.message || tabErr);
    }

    // Build Revision History Data (1949년 ~ 2026년 관세법 개정 이력 140건)
    const historyHeader = [
      '연번',
      '시행일자',
      '공포번호',
      '공포일자',
      '제개정구분',
      '법령명',
      '소관부처',
      '법령ID / MST',
    ];

    const historyRows = revisionList.map((rev: any, index: number) => [
      index + 1,
      rev.enforcementDate || '',
      rev.promulgationNo || '',
      rev.promulgationDate || '',
      rev.revisionType || '일부개정',
      rev.lawName || '관세법',
      rev.department || '기획재정부',
      rev.lawMst || rev.lawId || '',
    ]);

    const historyValues = [historyHeader, ...historyRows];

    // Build Articles Data according to config.exportAll140 mode
    let articleValues: any[][] = [];
    let totalProcessedArticlesCount = 0;

    if (config?.exportAll140) {
      console.log(`[Batch Export] Starting retrieval of all ${revisionList.length} revisions...`);
      const batchArticleRows: any[][] = [];
      const chunkSize = 15;

      for (let i = 0; i < revisionList.length; i += chunkSize) {
        const chunk = revisionList.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async (rev: any) => {
            try {
              const detailUrl = `http://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(
                ocKey
              )}&target=law&MST=${encodeURIComponent(rev.lawMst)}&type=XML`;

              const detailRes = await fetch(detailUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
              });

              if (detailRes.ok) {
                const detailXml = await detailRes.text();
                const parsed = xmlParser.parse(detailXml);
                const root = parsed.법령 || parsed.Law || parsed;
                const revArticles = parseArticlesFromXmlRoot(root);

                revArticles.forEach((art: any) => {
                  batchArticleRows.push([
                    rev.promulgationNo || '',
                    rev.enforcementDate || '',
                    rev.promulgationDate || '',
                    rev.revisionType || '일부개정',
                    art.chapterName || '',
                    art.sectionName || '',
                    art.subsectionName || '',
                    art.articleNo || '',
                    art.articleTitle || '',
                    art.articleContent || '',
                    art.isDeleted ? '삭제' : '',
                  ]);
                });
              }
            } catch (revFetchErr: any) {
              console.warn(`[Batch Export] Error for MST ${rev.lawMst}:`, revFetchErr?.message || revFetchErr);
            }
          })
        );
      }

      const batchArticleHeader = [
        '개정 공포번호',
        '시행일자',
        '공포일자',
        '개정구분',
        '장 (Chapter)',
        '절 (Section)',
        '관 (Subsection)',
        '조문 번호 (조)',
        '조문 제목',
        '조문 내용 (전문)',
        '비고',
      ];

      articleValues = [batchArticleHeader, ...batchArticleRows];
      totalProcessedArticlesCount = batchArticleRows.length;
      console.log(`[Batch Export] Finished collecting ${totalProcessedArticlesCount} articles across ${revisionList.length} revisions.`);
    } else {
      // Single revision export
      const articleHeader = [
        '장 (Chapter)',
        '절 (Section)',
        '관 (Subsection)',
        '조문 번호 (조)',
        '조문 제목',
        '조문 내용 (전문)',
        '시행일자',
        '비고',
      ];
      const articleRows = lawData.articles.map((art: any) => [
        art.chapterName || '',
        art.sectionName || '',
        art.subsectionName || '',
        art.articleNo || '',
        art.articleTitle || '',
        art.articleContent || '',
        art.effectiveDate || '',
        art.isDeleted ? '삭제' : '',
      ]);

      articleValues = [articleHeader, ...articleRows];
      totalProcessedArticlesCount = lawData.articles.length;
    }

    // Build Overview Data
    const overviewValues = [
      ['국가법령정보포털 - 관세법 수집 데이터 Summary'],
      [''],
      ['항목', '내용'],
      ['법령명', lawData.info.lawName],
      ['수집 범위', config?.exportAll140 ? '140개 전체 개정 관세법 일괄 수집' : '선택된 개정본 1건'],
      ['선택 개정본 공포번호', lawData.info.promulgationNo],
      ['선택 개정본 시행일자', lawData.info.enforcementDate],
      ['선택 개정본 공포일자', lawData.info.promulgationDate],
      ['제개정구분', lawData.info.revisionType || '일부개정'],
      ['소관부처', lawData.info.department || '기획재정부'],
      ['법령ID / MST', lawData.info.lawMst],
      ['수집된 개정 이력 건수', `${revisionList.length}건 (1949년~2026년)`],
      ['조문 목록 시트 기록 조문 수', `${totalProcessedArticlesCount}개 조문`],
      ['저장 일시', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })],
      ['국가법령정보포털 링크', `https://www.law.go.kr/법령/관세법`],
    ];

    // Update Revision History Tab (140건 개정연혁)
    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${historySheetName}'!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: historyValues },
      });
    } catch (histErr: any) {
      console.warn('History sheet update warning:', histErr?.message);
    }

    // Update Overview Tab
    if (config?.includeOverview !== false) {
      try {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${overviewSheetName}'!A1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: overviewValues },
        });
      } catch (e: any) {
        console.warn('Overview sheet update warning:', e?.message);
      }
    }

    // Update Articles Tab in chunks of 5000 rows to prevent payload limit issues
    try {
      const ROW_CHUNK_SIZE = 5000;
      for (let i = 0; i < articleValues.length; i += ROW_CHUNK_SIZE) {
        const chunkValues = articleValues.slice(i, i + ROW_CHUNK_SIZE);
        const startRow = i + 1;
        const range = `'${articlesSheetName}'!A${startRow}`;

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: chunkValues },
        });
      }
    } catch (artErr: any) {
      console.warn('Error updating articles sheet chunked:', artErr?.message);
      // Fallback update
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: articleValues.slice(0, 5000) },
      });
    }

    // Format header styling using batchUpdate
    if (config?.autoFormat !== false) {
      try {
        const getSpreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
        const sheetsList = getSpreadsheet.data.sheets || [];

        const historySheet = sheetsList.find((s) => s.properties?.title === historySheetName);
        const articlesSheet = sheetsList.find((s) => s.properties?.title === articlesSheetName) || sheetsList[0];

        const historySheetId = historySheet?.properties?.sheetId || 0;
        const articlesSheetId = articlesSheet?.properties?.sheetId || 0;

        const requests: any[] = [];

        // Freeze top row & format header for Revision History sheet
        if (historySheet) {
          requests.push(
            {
              updateSheetProperties: {
                properties: {
                  sheetId: historySheetId,
                  gridProperties: { frozenRowCount: 1 },
                },
                fields: 'gridProperties.frozenRowCount',
              },
            },
            {
              repeatCell: {
                range: {
                  sheetId: historySheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 8,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.18, green: 0.22, blue: 0.35 },
                    textFormat: {
                      foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
                      bold: true,
                      fontSize: 11,
                    },
                    alignment: { horizontal: 'CENTER', vertical: 'MIDDLE' },
                  },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,alignment)',
              },
            }
          );
        }

        // Freeze top row & format header for Articles sheet
        requests.push(
          {
            updateSheetProperties: {
              properties: {
                sheetId: articlesSheetId,
                gridProperties: { frozenRowCount: 1 },
              },
              fields: 'gridProperties.frozenRowCount',
            },
          },
          {
            repeatCell: {
              range: {
                sheetId: articlesSheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: 8,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.12, green: 0.16, blue: 0.23 },
                  textFormat: {
                    foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
                    bold: true,
                    fontSize: 11,
                  },
                  alignment: { horizontal: 'CENTER', vertical: 'MIDDLE' },
                },
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat,alignment)',
            },
          },
          {
            repeatCell: {
              range: {
                sheetId: articlesSheetId,
                startRowIndex: 1,
                startColumnIndex: 5,
                endColumnIndex: 6,
              },
              cell: {
                userEnteredFormat: {
                  wrapStrategy: 'WRAP',
                  alignment: { vertical: 'TOP' },
                },
              },
              fields: 'userEnteredFormat(wrapStrategy,alignment)',
            },
          }
        );

        await (sheets.spreadsheets as any).batchUpdate({
          spreadsheetId,
          requestBody: { requests },
        });
      } catch (formatErr) {
        console.warn('Sheet formatting warning (non-critical):', formatErr);
      }
    }

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    return res.json({
      success: true,
      spreadsheetId,
      spreadsheetUrl,
      message: '관세법 조문 전체가 Google Sheets에 정상적으로 저장되었습니다.',
    });
  } catch (error: any) {
    console.error('Save to Sheets Error:', error);

    let friendlyMessage = error.message || 'Google Sheets 저장 중 오류가 발생했습니다.';

    if (error.code === 403 || error.status === 403) {
      friendlyMessage = '해당 Google 스프레드시트에 대한 수정(편집) 권한이 없습니다. 문서 공유 설정에서 편집자로 권한이 부여되어 있는지 확인해 주세요.';
    } else if (error.code === 404 || error.status === 404) {
      friendlyMessage = '입력하신 Google 스프레드시트를 찾을 수 없습니다. 문서 URL 및 삭제 여부를 확인해 주세요.';
    } else if (error.code === 401 || error.status === 401) {
      friendlyMessage = 'Google 계정 인증 토큰이 만료되었거나 권한이 필요합니다. 상단의 "Google 계정 연결" 버튼을 눌러 다시 로그인해 주세요.';
    }

    return res.status(error.status || 500).json({
      error: friendlyMessage,
    });
  }
});

// API Route: Get top 2 recent revisions of Customs Act with full article details
app.get('/api/law/recent-2-revisions', async (req, res) => {
  try {
    const ocKey = (req.query.ocKey as string) || DEFAULT_OC_KEY;
    const allRevisions = await fetchAll140Revisions(ocKey);
    const top2Revisions = allRevisions.slice(0, 2);

    if (top2Revisions.length === 0) {
      return res.status(404).json({ error: '관세법 개정 이력을 가져올 수 없습니다.' });
    }

    const detailedTop2 = await Promise.all(
      top2Revisions.map(async (rev, index) => {
        try {
          const detailUrl = `http://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(
            ocKey
          )}&target=law&MST=${encodeURIComponent(rev.lawMst)}&type=XML`;

          const detailRes = await fetch(detailUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          });

          if (!detailRes.ok) {
            return {
              ...rev,
              rank: index + 1,
              articles: [],
              articleCount: 0,
            };
          }

          const detailXml = await detailRes.text();
          const parsed = xmlParser.parse(detailXml);
          const root = parsed.법령 || parsed.Law || parsed;
          const articles = parseArticlesFromXmlRoot(root);

          return {
            ...rev,
            rank: index + 1,
            articles,
            articleCount: articles.length,
          };
        } catch (err: any) {
          console.warn(`[Recent 2 Top Detail Error] for MST ${rev.lawMst}:`, err?.message);
          return {
            ...rev,
            rank: index + 1,
            articles: [],
            articleCount: 0,
          };
        }
      })
    );

    return res.json({
      success: true,
      count: detailedTop2.length,
      revisions: detailedTop2,
    });
  } catch (error: any) {
    console.error('Error fetching recent 2 revisions:', error);
    return res.status(500).json({ error: error.message || '최근 개정본 조회 실패' });
  }
});

// API Route: Save top 2 recent revisions to Google Sheets as a test
app.post('/api/sheets/save-recent-2-test', async (req, res) => {
  try {
    const { accessToken } = req.body;
    const ocKey = req.body.ocKey || DEFAULT_OC_KEY;

    if (!accessToken) {
      return res.status(401).json({
        error: 'Google OAuth Access Token이 필요합니다. 상단의 Google 계정 연결 버튼을 눌러주세요.',
      });
    }

    const allRevisions = await fetchAll140Revisions(ocKey);
    const top2Revisions = allRevisions.slice(0, 2);

    if (top2Revisions.length === 0) {
      return res.status(404).json({ error: '관세법 개정 이력을 가져오지 못했습니다.' });
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const sheets = google.sheets({ version: 'v4', auth });

    // Fetch articles for both revisions
    const detailedItems: any[] = [];
    for (const rev of top2Revisions) {
      const detailUrl = `http://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(
        ocKey
      )}&target=law&MST=${encodeURIComponent(rev.lawMst)}&type=XML`;

      const detailRes = await fetch(detailUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });

      let articles: any[] = [];
      if (detailRes.ok) {
        const detailXml = await detailRes.text();
        const parsed = xmlParser.parse(detailXml);
        const root = parsed.법령 || parsed.Law || parsed;
        articles = parseArticlesFromXmlRoot(root);
      }

      detailedItems.push({
        ...rev,
        articles,
      });
    }

    const rev1 = detailedItems[0];
    const rev2 = detailedItems[1];

    const docTitle = `[관세법 테스트] 최근 개정본 2개 조문 저장 (${rev1.promulgationNo} & ${rev2?.promulgationNo || ''})`;

    const sheet1Title = '최근 2개 개정본 요약';
    const sheet2Title = `1위_${(rev1.promulgationNo || '최신본').replace(/[\/\\?%*:|"<>]/g, '_')}`.slice(0, 30);
    const sheet3Title = rev2 ? `2위_${(rev2.promulgationNo || '직전본').replace(/[\/\\?%*:|"<>]/g, '_')}`.slice(0, 30) : '2위_개정본';

    const createResponse = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: docTitle },
        sheets: [
          { properties: { title: sheet1Title, index: 0 } },
          { properties: { title: sheet2Title, index: 1 } },
          { properties: { title: sheet3Title, index: 2 } },
        ],
      },
    });

    const spreadsheetId = createResponse.data.spreadsheetId;
    if (!spreadsheetId) {
      throw new Error('Google Spreadsheet 생성 실패');
    }

    // Build Summary Sheet
    const summaryHeader = ['구분', '순위', '법령명', '공포번호', '시행일자', '공포일자', '제개정구분', '소관부처', '조문 수', 'MST'];
    const summaryRows = detailedItems.map((item, idx) => [
      idx === 0 ? '최신 개정본 (1위)' : '직전 개정본 (2위)',
      idx + 1,
      item.lawName || '관세법',
      item.promulgationNo || '',
      item.enforcementDate || '',
      item.promulgationDate || '',
      item.revisionType || '',
      item.department || '기획재정부',
      `${item.articles.length}개 조문`,
      item.lawMst || '',
    ]);

    const articleHeader = [
      '장 (Chapter)',
      '절 (Section)',
      '관 (Subsection)',
      '조문 번호',
      '조문 제목',
      '조문 내용 (전문)',
      '시행일자',
      '비고',
    ];

    const rev1Rows = rev1.articles.map((art: any) => [
      art.chapterName || '',
      art.sectionName || '',
      art.subsectionName || '',
      art.articleNo || '',
      art.articleTitle || '',
      art.articleContent || '',
      art.effectiveDate || rev1.enforcementDate || '',
      art.isDeleted ? '삭제' : '',
    ]);

    const rev2Rows = rev2 ? rev2.articles.map((art: any) => [
      art.chapterName || '',
      art.sectionName || '',
      art.subsectionName || '',
      art.articleNo || '',
      art.articleTitle || '',
      art.articleContent || '',
      art.effectiveDate || rev2.enforcementDate || '',
      art.isDeleted ? '삭제' : '',
    ]) : [];

    // Write all values
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          {
            range: `'${sheet1Title}'!A1`,
            values: [
              ['[테스트 저장] 관세법 최근 개정본 2개 데이터 요약'],
              ['저장 일시', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })],
              [''],
              summaryHeader,
              ...summaryRows,
            ],
          },
          {
            range: `'${sheet2Title}'!A1`,
            values: [articleHeader, ...rev1Rows],
          },
          ...(rev2 ? [{
            range: `'${sheet3Title}'!A1`,
            values: [articleHeader, ...rev2Rows],
          }] : []),
        ],
      },
    });

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    return res.json({
      success: true,
      spreadsheetId,
      spreadsheetUrl,
      items: detailedItems.map((d) => ({
        promulgationNo: d.promulgationNo,
        enforcementDate: d.enforcementDate,
        articleCount: d.articles.length,
      })),
      message: `최근 관세법 개정본 2개(${rev1.promulgationNo}, ${rev2?.promulgationNo}) 조문 전체가 Google Sheets에 성공적으로 저장되었습니다!`,
    });
  } catch (error: any) {
    console.error('Recent 2 Test Save Error:', error);
    return res.status(error.status || 500).json({
      error: error.message || '최근 개정본 2개 테스트 저장 중 오류가 발생했습니다.',
    });
  }
});

// API Route: Save all revisions into a Google Drive folder named "(법령명)+(날짜)"
// Supports mode: 'single_file' (1 Google Sheet with all revisions & articles) or 'separate_files' (1 Google Sheet per revision)
// Supports lawCategory: 'law' (관세법 등 법률) or 'admrul' (외국환거래규정 등 행정규칙/고시)
app.post('/api/drive/export-all-revisions-folder', async (req, res) => {
  try {
    const {
      accessToken,
      mode = 'single_file',
      lawName = '관세법',
      lawCategory = 'law',
      limitCount = 0,
    } = req.body;
    const ocKey = req.body.ocKey || DEFAULT_OC_KEY;

    if (!accessToken) {
      return res.status(401).json({
        error: 'Google OAuth Access Token이 필요합니다. 상단의 Google 계정 연결 버튼을 눌러주세요.',
      });
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Determine Folder Name: (법령명)+(날짜) e.g., "관세법_2026-08-17" or "외국환거래규정_2026-08-17"
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const formattedDate = `${yyyy}-${mm}-${dd}`;
    const cleanLawName = (lawName || (lawCategory === 'admrul' ? '외국환거래규정' : '관세법')).trim();
    const defaultFolderName = `${cleanLawName}_${formattedDate}`;
    const targetFolderName = req.body.folderName?.trim() || defaultFolderName;

    console.log(`[Drive Folder Export] Initializing: '${targetFolderName}' for mode: '${mode}', category: '${lawCategory}', cleanLawName: '${cleanLawName}'`);

    // Helper for API retry
    const callWithRetry = async <T>(fn: () => Promise<T>, retries = 4, delay = 1200): Promise<T> => {
      try {
        return await fn();
      } catch (err: any) {
        const isRateLimit =
          err?.status === 429 ||
          err?.code === 429 ||
          err?.message?.includes('Quota') ||
          err?.message?.includes('rate') ||
          err?.message?.includes('RESOURCE_EXHAUSTED');

        if (isRateLimit && retries > 0) {
          console.warn(`[Google API Rate Limit] Pausing ${delay}ms before retry...`);
          await new Promise((r) => setTimeout(r, delay));
          return callWithRetry(fn, retries - 1, delay * 2);
        }
        throw err;
      }
    };

    // 2. Search or Create Folder in Google Drive (Skip if already exists)
    let folderId = '';
    let folderUrl = '';
    let folderSkipped = false;

    try {
      const folderSearchRes = await callWithRetry(() =>
        drive.files.list({
          q: `name = '${targetFolderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: 'files(id, name, webViewLink)',
        })
      );

      if (folderSearchRes.data.files && folderSearchRes.data.files.length > 0) {
        folderId = folderSearchRes.data.files[0].id || '';
        folderUrl = folderSearchRes.data.files[0].webViewLink || `https://drive.google.com/drive/folders/${folderId}`;
        folderSkipped = true;
        console.log(`[Drive Folder Exists - Skipped Creation] ${targetFolderName} (ID: ${folderId})`);
      }
    } catch (searchErr: any) {
      console.warn('[Drive Folder Search Warning] Proceeding to create folder:', searchErr?.message);
    }

    if (!folderId) {
      const folderCreateRes = await callWithRetry(() =>
        drive.files.create({
          requestBody: {
            name: targetFolderName,
            mimeType: 'application/vnd.google-apps.folder',
          },
          fields: 'id, name, webViewLink',
        })
      );
      folderId = folderCreateRes.data.id || '';
      folderUrl = folderCreateRes.data.webViewLink || `https://drive.google.com/drive/folders/${folderId}`;
      console.log(`[Drive Folder Created] ${targetFolderName} (ID: ${folderId})`);
    }

    if (!folderId) {
      throw new Error('Google Drive 폴더 생성에 실패했습니다. Google 계정 권한을 확인해 주세요.');
    }

    // 3. Fetch revisions (Customs Act 140, Foreign Exchange Act 45, or Administrative Rules)
    let revisionList: any[] = req.body.revisions || [];
    if (!Array.isArray(revisionList) || revisionList.length === 0) {
      if (lawCategory === 'admrul' || cleanLawName === '외국환거래규정') {
        const effectiveLimit = limitCount > 0 ? limitCount : 0;
        revisionList = await fetchAdmrulRevisions(ocKey, cleanLawName, effectiveLimit);
      } else {
        revisionList = await fetchLawRevisions(ocKey, cleanLawName, limitCount > 0 ? limitCount : 0);
      }
    }

    if (revisionList.length === 0) {
      return res.status(404).json({ error: `${cleanLawName}의 개정연혁 목록을 불러올 수 없습니다.` });
    }

    revisionList = sortRevisionsByEnforcementDateDesc(revisionList);

    // ========================================================
    // MODE A: 'single_file' -> 구글시트 1개에 모든 개정연혁 및 조문 통합 저장
    // ========================================================
    if (mode === 'single_file') {
      const docTitle = `[${cleanLawName}] ${revisionList.length}개 개정연혁 통합본 (${formattedDate})`;

      // Check if file already exists in the target folder (Skip duplicate sheet)
      const existingDocRes = await callWithRetry(() =>
        drive.files.list({
          q: `'${folderId}' in parents and name = '${docTitle.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
          fields: 'files(id, name, webViewLink)',
          spaces: 'drive',
        })
      );

      if (existingDocRes.data.files && existingDocRes.data.files.length > 0) {
        const existingFile = existingDocRes.data.files[0];
        console.log(`[Single File Exists - Skipped] ${docTitle} (ID: ${existingFile.id})`);
        return res.json({
          success: true,
          mode: 'single_file',
          folderId,
          folderUrl,
          folderName: targetFolderName,
          folderSkipped,
          skipped: true,
          spreadsheetId: existingFile.id,
          spreadsheetUrl: existingFile.webViewLink || `https://docs.google.com/spreadsheets/d/${existingFile.id}/edit`,
          totalRevisions: revisionList.length,
          message: `동일한 구글시트('[${docTitle}]')가 이미 '${targetFolderName}' 폴더에 존재하여 생성을 건너뛰었습니다. (스킵됨)`,
        });
      }

      // Create new Google Spreadsheet
      const createRes = await callWithRetry(() =>
        drive.files.create({
          requestBody: {
            name: docTitle,
            mimeType: 'application/vnd.google-apps.spreadsheet',
            parents: [folderId],
          },
          fields: 'id, name, webViewLink',
        })
      );

      const spreadsheetId = createRes.data.id || '';
      const spreadsheetUrl = createRes.data.webViewLink || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

      if (!spreadsheetId) {
        throw new Error('Google Spreadsheet 생성 실패');
      }

      // Initialize tabs (Rename default sheetId 0 to remove '시트1', Add Sheet 2)
      const sheet1Title = `${cleanLawName} 개정연혁 목록 (${revisionList.length}건)`;
      const sheet2Title = `${cleanLawName} 전체 조문 통합데이터`;

      await callWithRetry(() =>
        sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                updateSheetProperties: {
                  properties: { sheetId: 0, title: sheet1Title },
                  fields: 'title',
                },
              },
              {
                addSheet: {
                  properties: { sheetId: 1, title: sheet2Title, index: 1 },
                },
              },
            ],
          },
        })
      );

      // 1) Build Revision History Sheet (Summary)
      const historyHeader = [
        '연번',
        '시행일자',
        '공포/발령번호',
        '공포/발령일자',
        '제개정구분',
        '법령/행정규칙명',
        '소관부처',
        '일련번호 / MST',
      ];

      const historyRows = revisionList.map((rev, index) => [
        index + 1,
        rev.enforcementDate || '',
        rev.promulgationNo || '',
        rev.promulgationDate || '',
        rev.revisionType || '일부개정',
        rev.lawName || cleanLawName,
        rev.department || '기획재정부',
        rev.lawMst || rev.seq || rev.id || '',
      ]);

      // 2) Collect all articles from revisions
      console.log(`[Single File Export] Fetching articles for ${revisionList.length} revisions (${cleanLawName})...`);
      const allArticleRows: any[][] = [];
      const chunkSize = 10;

      for (let i = 0; i < revisionList.length; i += chunkSize) {
        const chunk = revisionList.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async (rev: any, chunkIndex: number) => {
            try {
              const isAdmrul = lawCategory === 'admrul' || rev.targetType === 'admrul' || cleanLawName === '외국환거래규정';
              const targetParam = isAdmrul ? 'admrul' : 'law';
              const idParam = rev.lawMst || rev.seq || rev.id || (isAdmrul ? '2100000281984' : '280363');

              const detailUrl = isAdmrul
                ? `http://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(
                    ocKey
                  )}&target=admrul&ID=${encodeURIComponent(idParam)}&type=XML`
                : `http://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(
                    ocKey
                  )}&target=law&MST=${encodeURIComponent(idParam)}&type=XML`;

              const detailRes = await fetch(detailUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
              });

              if (detailRes.ok) {
                const detailXml = await detailRes.text();
                const parsed = xmlParser.parse(detailXml);
                const root = parsed.AdmRulService || parsed.admRulService || parsed.행정규칙 || parsed.AdmRul || parsed.법령 || parsed.Law || parsed;
                const revArticles = isAdmrul ? parseAdmrulArticlesFromXmlRoot(root) : parseArticlesFromXmlRoot(root);

                revArticles.forEach((art: any) => {
                  allArticleRows.push([
                    i + chunkIndex + 1,
                    rev.promulgationNo || '',
                    rev.enforcementDate || '',
                    rev.promulgationDate || '',
                    rev.revisionType || '일부개정',
                    art.chapterName || '본문',
                    art.sectionName || '',
                    art.subsectionName || '',
                    art.articleNo || '',
                    art.articleTitle || '',
                    art.articleContent || '',
                    art.isDeleted ? '삭제' : '',
                  ]);
                });

                if (rev.buchikText) {
                  allArticleRows.push([
                    i + chunkIndex + 1,
                    rev.promulgationNo || '',
                    rev.enforcementDate || '',
                    rev.promulgationDate || '',
                    rev.revisionType || '일부개정',
                    '부칙',
                    '',
                    '',
                    '부칙',
                    `부칙 (${rev.promulgationNo || ''})`,
                    rev.buchikText,
                    '',
                  ]);
                }
              }
            } catch (fetchErr: any) {
              console.warn(`[Single File Export] Error fetching MST/ID ${rev.lawMst || rev.id}:`, fetchErr?.message);
            }
          })
        );
      }

      const allArticleHeader = [
        '개정 연번',
        '공포/발령번호',
        '시행일자',
        '공포/발령일자',
        '제개정구분',
        '장 (Chapter)',
        '절 (Section)',
        '관 (Subsection)',
        '조문 번호',
        '조문 제목',
        '조문 내용 (전문)',
        '비고',
      ];

      // 3) Write Data to Sheets
      await callWithRetry(() =>
        sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: [
              {
                range: `'${sheet1Title}'!A1`,
                values: [
                  [`[국가법령/행정규칙] ${cleanLawName} 전체 ${revisionList.length}개 개정연혁 목록`],
                  [`저장 폴더: ${targetFolderName}`, `저장 일시: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`],
                  [''],
                  historyHeader,
                  ...historyRows,
                ],
              },
              {
                range: `'${sheet2Title}'!A1`,
                values: [allArticleHeader, ...allArticleRows],
              },
            ],
          },
        })
      );

      // 4) Apply cell formatting: Vertical Alignment to TOP, Wrap Text, Header Row Styling & Freeze
      await callWithRetry(() =>
        sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              // Sheet 1: Whole sheet top vertical alignment & text wrap
              {
                repeatCell: {
                  range: { sheetId: 0, startRowIndex: 0 },
                  cell: {
                    userEnteredFormat: {
                      verticalAlignment: 'TOP',
                      wrapStrategy: 'WRAP',
                    },
                  },
                  fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)',
                },
              },
              // Sheet 1: Header row (row index 3) styling (Navy background, bold white, center aligned)
              {
                repeatCell: {
                  range: { sheetId: 0, startRowIndex: 3, endRowIndex: 4 },
                  cell: {
                    userEnteredFormat: {
                      backgroundColor: { red: 0.12, green: 0.18, blue: 0.3 },
                      textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 10 },
                      verticalAlignment: 'MIDDLE',
                      horizontalAlignment: 'CENTER',
                    },
                  },
                  fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment)',
                },
              },
              // Sheet 1: Freeze header rows
              {
                updateSheetProperties: {
                  properties: { sheetId: 0, gridProperties: { frozenRowCount: 4 } },
                  fields: 'gridProperties.frozenRowCount',
                },
              },
              // Sheet 2: Whole sheet top vertical alignment & text wrap
              {
                repeatCell: {
                  range: { sheetId: 1, startRowIndex: 0 },
                  cell: {
                    userEnteredFormat: {
                      verticalAlignment: 'TOP',
                      wrapStrategy: 'WRAP',
                    },
                  },
                  fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)',
                },
              },
              // Sheet 2: Header row (row index 0) styling (Navy background, bold white, center aligned)
              {
                repeatCell: {
                  range: { sheetId: 1, startRowIndex: 0, endRowIndex: 1 },
                  cell: {
                    userEnteredFormat: {
                      backgroundColor: { red: 0.12, green: 0.18, blue: 0.3 },
                      textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 10 },
                      verticalAlignment: 'MIDDLE',
                      horizontalAlignment: 'CENTER',
                    },
                  },
                  fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment)',
                },
              },
              // Sheet 2: Freeze header row
              {
                updateSheetProperties: {
                  properties: { sheetId: 1, gridProperties: { frozenRowCount: 1 } },
                  fields: 'gridProperties.frozenRowCount',
                },
              },
            ],
          },
        })
      );

      return res.json({
        success: true,
        mode: 'single_file',
        folderId,
        folderUrl,
        folderName: targetFolderName,
        folderSkipped,
        skipped: false,
        spreadsheetId,
        spreadsheetUrl,
        totalRevisions: revisionList.length,
        totalArticles: allArticleRows.length,
        message: `Google Drive '${targetFolderName}' 폴더에 1개의 통합 구글 스프레드시트가 성공적으로 저장되었습니다! (셀 행 위로 정렬 적용 완료, 총 ${revisionList.length}개 개정판, ${allArticleRows.length}개 조문)`,
      });
    }

    // ========================================================
    // MODE B: 'separate_files' -> 개정연혁 1개 파일로 각각 저장 (개별 구글시트 파일 생성)
    // ========================================================
    if (mode === 'separate_files') {
      console.log(`[Separate Files Export] Starting creation of individual sheets in folder '${targetFolderName}' (${cleanLawName})...`);
      const createdFiles: Array<{
        title: string;
        spreadsheetId: string;
        url: string;
        promulgationNo: string;
        enforcementDate: string;
        skipped?: boolean;
      }> = [];

      // Check existing files in folder to avoid duplicates or overwrite
      const existingFilesRes = await callWithRetry(() =>
        drive.files.list({
          q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
          fields: 'files(id, name, webViewLink)',
          spaces: 'drive',
        })
      );
      const existingFileMap = new Map<string, { id: string; url: string }>();
      (existingFilesRes.data.files || []).forEach((f) => {
        if (f.name && f.id) existingFileMap.set(f.name, { id: f.id, url: f.webViewLink || `https://docs.google.com/spreadsheets/d/${f.id}/edit` });
      });

      const articleHeader = [
        '장 (Chapter)',
        '절 (Section)',
        '관 (Subsection)',
        '조문 번호',
        '조문 제목',
        '조문 내용 (전문)',
        '시행일자',
        '비고',
      ];

      let skippedCount = 0;
      let newCreatedCount = 0;

      // Process in paced chunks of 3 to respect Google Drive write quotas
      const chunkSize = 3;
      for (let i = 0; i < revisionList.length; i += chunkSize) {
        const chunk = revisionList.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async (rev: any, chunkIndex: number) => {
            const revIndexNum = String(i + chunkIndex + 1).padStart(3, '0');
            const safePromNo = rev.promulgationNo || '개정본';
            const safeEnfDate = rev.enforcementDate || '시행일 미상';
            const docTitle = `${revIndexNum}_[${cleanLawName}] ${safePromNo} (${safeEnfDate} 시행)`;

            // Check if file already exists in folder (Skip duplicate sheet)
            if (existingFileMap.has(docTitle)) {
              const ex = existingFileMap.get(docTitle)!;
              skippedCount++;
              createdFiles.push({
                title: docTitle,
                spreadsheetId: ex.id,
                url: ex.url,
                promulgationNo: rev.promulgationNo,
                enforcementDate: rev.enforcementDate,
                skipped: true,
              });
              console.log(`[Separate Export Exists - Skipped] ${docTitle}`);
              return;
            }

            try {
              // 1. Fetch articles
              const isAdmrul = lawCategory === 'admrul' || rev.targetType === 'admrul' || cleanLawName === '외국환거래규정';
              const targetParam = isAdmrul ? 'admrul' : 'law';
              const idParam = rev.lawMst || rev.seq || rev.id || (isAdmrul ? '2100000281984' : '280363');

              const detailUrl = isAdmrul
                ? `http://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(
                    ocKey
                  )}&target=admrul&ID=${encodeURIComponent(idParam)}&type=XML`
                : `http://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(
                    ocKey
                  )}&target=law&MST=${encodeURIComponent(idParam)}&type=XML`;

              const detailRes = await fetch(detailUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
              });

              let revArticles: any[] = [];
              if (detailRes.ok) {
                const detailXml = await detailRes.text();
                const parsed = xmlParser.parse(detailXml);
                const root = parsed.AdmRulService || parsed.admRulService || parsed.행정규칙 || parsed.AdmRul || parsed.법령 || parsed.Law || parsed;
                revArticles = isAdmrul ? parseAdmrulArticlesFromXmlRoot(root) : parseArticlesFromXmlRoot(root);
              }

              // 2. Create Spreadsheet in Drive Folder
              const createRes = await callWithRetry(() =>
                drive.files.create({
                  requestBody: {
                    name: docTitle,
                    mimeType: 'application/vnd.google-apps.spreadsheet',
                    parents: [folderId],
                  },
                  fields: 'id, name, webViewLink',
                })
              );
              const spId = createRes.data.id || '';
              if (!spId) return;

              // Ensure worksheets without default '시트1'
              const overviewSheet = `${cleanLawName} 개요`;
              const articlesSheet = '조문 목록';

              await callWithRetry(() =>
                sheets.spreadsheets.batchUpdate({
                  spreadsheetId: spId,
                  requestBody: {
                    requests: [
                      {
                        updateSheetProperties: {
                          properties: { sheetId: 0, title: overviewSheet },
                          fields: 'title',
                        },
                      },
                      {
                        addSheet: {
                          properties: { sheetId: 1, title: articlesSheet, index: 1 },
                        },
                      },
                    ],
                  },
                })
              );

              // Build rows
              const overviewValues = [
                [`대한민국 ${cleanLawName} 개정본`],
                [''],
                ['항목', '내용'],
                ['법령/행정규칙명', rev.lawName || cleanLawName],
                ['공포/발령번호', rev.promulgationNo || '-'],
                ['시행일자', rev.enforcementDate || '-'],
                ['공포/발령일자', rev.promulgationDate || '-'],
                ['제개정구분', rev.revisionType || '일부개정'],
                ['소관부처', rev.department || (isAdmrul ? '재정경제부' : '기획재정부')],
                ['일련번호 / MST', rev.lawMst || rev.seq || rev.id || ''],
                ['해당 개정본 조문 수', `${revArticles.length}개 조문`],
                ['개정 부칙 (공포내용)', rev.buchikText || '-'],
                ['저장 폴더', targetFolderName],
                ['저장 일시', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })],
              ];

              const articleRows = revArticles.map((art: any) => [
                art.chapterName || '본문',
                art.sectionName || '',
                art.subsectionName || '',
                art.articleNo || '',
                art.articleTitle || '',
                art.articleContent || '',
                art.effectiveDate || rev.enforcementDate || '',
                art.isDeleted ? '삭제' : '',
              ]);

              if (rev.buchikText) {
                articleRows.push([
                  '부칙',
                  '',
                  '',
                  '부칙',
                  `부칙 (${rev.promulgationNo || ''})`,
                  rev.buchikText,
                  rev.enforcementDate || '',
                  '',
                ]);
              }

              // Write Data
              await callWithRetry(() =>
                sheets.spreadsheets.values.batchUpdate({
                  spreadsheetId: spId,
                  requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data: [
                      { range: `'${overviewSheet}'!A1`, values: overviewValues },
                      { range: `'${articlesSheet}'!A1`, values: [articleHeader, ...articleRows] },
                    ],
                  },
                })
              );

              // Apply Cell Formatting: Vertical Alignment to TOP, Wrap Text, Header Styling & Freeze
              await callWithRetry(() =>
                sheets.spreadsheets.batchUpdate({
                  spreadsheetId: spId,
                  requestBody: {
                    requests: [
                      // Overview Sheet formatting
                      {
                        repeatCell: {
                          range: { sheetId: 0, startRowIndex: 0 },
                          cell: {
                            userEnteredFormat: {
                              verticalAlignment: 'TOP',
                              wrapStrategy: 'WRAP',
                            },
                          },
                          fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)',
                        },
                      },
                      {
                        repeatCell: {
                          range: { sheetId: 0, startRowIndex: 2, endRowIndex: 3 },
                          cell: {
                            userEnteredFormat: {
                              backgroundColor: { red: 0.12, green: 0.18, blue: 0.3 },
                              textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 10 },
                              verticalAlignment: 'MIDDLE',
                              horizontalAlignment: 'CENTER',
                            },
                          },
                          fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment)',
                        },
                      },
                      // Articles Sheet formatting
                      {
                        repeatCell: {
                          range: { sheetId: 1, startRowIndex: 0 },
                          cell: {
                            userEnteredFormat: {
                              verticalAlignment: 'TOP',
                              wrapStrategy: 'WRAP',
                            },
                          },
                          fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)',
                        },
                      },
                      {
                        repeatCell: {
                          range: { sheetId: 1, startRowIndex: 0, endRowIndex: 1 },
                          cell: {
                            userEnteredFormat: {
                              backgroundColor: { red: 0.12, green: 0.18, blue: 0.3 },
                              textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 10 },
                              verticalAlignment: 'MIDDLE',
                              horizontalAlignment: 'CENTER',
                            },
                          },
                          fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment)',
                        },
                      },
                      {
                        updateSheetProperties: {
                          properties: { sheetId: 1, gridProperties: { frozenRowCount: 1 } },
                          fields: 'gridProperties.frozenRowCount',
                        },
                      },
                    ],
                  },
                })
              );

              newCreatedCount++;
              createdFiles.push({
                title: docTitle,
                spreadsheetId: spId,
                url: `https://docs.google.com/spreadsheets/d/${spId}/edit`,
                promulgationNo: rev.promulgationNo,
                enforcementDate: rev.enforcementDate,
                skipped: false,
              });
            } catch (err: any) {
              console.warn(`[Separate Export Error] MST ${rev.lawMst || rev.id}:`, err?.message);
            }
          })
        );
        // Small delay between batches to respect rate limits
        await new Promise((resolve) => setTimeout(resolve, 400));
      }

      const totalCount = createdFiles.length;
      let summaryMsg = `Google Drive '${targetFolderName}' 폴더에 저장이 완료되었습니다! (신규 생성: ${newCreatedCount}개, 중복 스킵: ${skippedCount}개)`;
      if (skippedCount > 0 && newCreatedCount === 0) {
        summaryMsg = `Google Drive '${targetFolderName}' 폴더에 모든 파일(${skippedCount}개)이 이미 존재하여 저장을 스킵했습니다.`;
      }

      return res.json({
        success: true,
        mode: 'separate_files',
        folderId,
        folderUrl,
        folderName: targetFolderName,
        folderSkipped,
        createdFiles,
        createdCount: newCreatedCount,
        skippedCount,
        totalCount,
        message: summaryMsg,
      });
    }

    return res.status(400).json({ error: '올바른 모드(single_file 또는 separate_files)를 지정해 주세요.' });
  } catch (error: any) {
    console.error('Export All Revisions Folder Error:', error);
    const errMsg = error.message || 'Google Drive 폴더 저장 중 오류가 발생했습니다.';
    const isAuthError =
      error.status === 401 ||
      errMsg.includes('Invalid Credentials') ||
      errMsg.includes('auth') ||
      errMsg.includes('token') ||
      errMsg.includes('UNAUTHENTICATED');
    const isForbidden =
      error.status === 403 ||
      errMsg.includes('PERMISSION_DENIED') ||
      errMsg.includes('insufficient');

    let userFriendlyMsg = errMsg;
    if (isAuthError) {
      userFriendlyMsg = 'Google 인증 토큰이 만료되었거나 유효하지 않습니다. 상단 [Google 로그인] 버튼을 눌러 다시 로그인해 주세요.';
    } else if (isForbidden) {
      userFriendlyMsg = 'Google Drive / Spreadsheets 쓰기 권한이 부족합니다. Google 로그인 시 드라이브 및 스프레드시트 권한을 허용해 주세요.';
    }

    return res.status(error.status || (isAuthError ? 401 : 500)).json({
      error: userFriendlyMsg,
      authError: isAuthError || isForbidden,
    });
  }
});

// API Route: Export revision sheets for Unified Search & Drive Exporter (법령 · 행정규칙 드라이브 연동)
app.post('/api/drive/export-revision-sheets', async (req, res) => {
  try {
    const {
      accessToken,
      targetType = 'law',
      selectedItem,
      revisions = [],
      folderName,
      permissionOption,
      ocKey = DEFAULT_OC_KEY,
    } = req.body;

    if (!accessToken) {
      return res.status(401).json({
        success: false,
        error: 'Google OAuth 인증 토큰이 필요합니다. 상단 Google 로그인 버튼을 눌러주세요.',
        authError: true,
      });
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth });
    const sheets = google.sheets({ version: 'v4', auth });

    // Helper for API retry
    const callWithRetry = async <T>(fn: () => Promise<T>, retries = 4, delay = 1200): Promise<T> => {
      try {
        return await fn();
      } catch (err: any) {
        const isRateLimit =
          err?.status === 429 ||
          err?.code === 429 ||
          err?.message?.includes('Quota') ||
          err?.message?.includes('rate') ||
          err?.message?.includes('RESOURCE_EXHAUSTED');

        if (isRateLimit && retries > 0) {
          console.warn(`[Unified Drive API Rate Limit] Pausing ${delay}ms before retry...`);
          await new Promise((r) => setTimeout(r, delay));
          return callWithRetry(fn, retries - 1, delay * 2);
        }
        throw err;
      }
    };

    const cleanLawName = (selectedItem?.name || (targetType === 'admrul' ? '외국환거래규정' : '관세법')).trim();
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const defaultFolderName = `[${cleanLawName.replace(/[\/\\:*?"<>|]/g, '_')}_${today}]`;
    const targetFolderName = (folderName || defaultFolderName).trim();

    console.log(`[Unified Drive Export] Starting export for '${cleanLawName}', folder: '${targetFolderName}', revisions: ${revisions.length}`);

    // 1. Search or Create Folder in Google Drive
    let folderId = '';
    let folderUrl = '';
    let folderSkipped = false;

    try {
      const folderSearchRes = await callWithRetry(() =>
        drive.files.list({
          q: `name = '${targetFolderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: 'files(id, name, webViewLink)',
        })
      );
      if (folderSearchRes.data.files && folderSearchRes.data.files.length > 0) {
        folderId = folderSearchRes.data.files[0].id || '';
        folderUrl = folderSearchRes.data.files[0].webViewLink || `https://drive.google.com/drive/folders/${folderId}`;
        folderSkipped = true;
        console.log(`[Unified Drive Folder Exists] Reusing folder ID: ${folderId}`);
      }
    } catch (searchErr: any) {
      console.warn('[Unified Drive Folder Search Warning]', searchErr?.message);
    }

    if (!folderId) {
      const folderCreateRes = await callWithRetry(() =>
        drive.files.create({
          requestBody: {
            name: targetFolderName,
            mimeType: 'application/vnd.google-apps.folder',
          },
          fields: 'id, name, webViewLink',
        })
      );
      folderId = folderCreateRes.data.id || '';
      folderUrl = folderCreateRes.data.webViewLink || `https://drive.google.com/drive/folders/${folderId}`;
      console.log(`[Unified Drive Folder Created] New folder ID: ${folderId}`);
    }

    if (!folderId) {
      throw new Error('Google Drive 폴더를 생성할 수 없습니다. Google 계정 권한을 확인해 주세요.');
    }

    // 2. Set Public Permission on Folder if requested
    if (permissionOption?.type === 'anyone') {
      try {
        await callWithRetry(() =>
          drive.permissions.create({
            fileId: folderId,
            requestBody: {
              role: permissionOption.role || 'reader',
              type: 'anyone',
            },
          })
        );
      } catch (permErr: any) {
        console.warn('[Unified Folder Permission Warning]', permErr?.message);
      }
    }

    // 3. Check existing files in folder
    const existingFileMap = new Map<string, { id: string; url: string }>();
    try {
      const existingFilesRes = await callWithRetry(() =>
        drive.files.list({
          q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
          fields: 'files(id, name, webViewLink)',
        })
      );
      (existingFilesRes.data.files || []).forEach((f) => {
        if (f.name && f.id) {
          existingFileMap.set(f.name, {
            id: f.id,
            url: f.webViewLink || `https://docs.google.com/spreadsheets/d/${f.id}/edit`,
          });
        }
      });
    } catch (listErr: any) {
      console.warn('[Unified Existing Files List Warning]', listErr?.message);
    }

    const savedSheets: Array<{
      title: string;
      url: string;
      spreadsheetId: string;
      isExisting?: boolean;
      promulgationNo?: string;
      enforcementDate?: string;
      articleCount?: number;
    }> = [];

    let skippedCount = 0;
    let newCreatedCount = 0;

    // 4. Sort revisions by enforcement date descending (최근 시행일자순 우선 정렬 후 번호 001, 002... 부여)
    const sortedRevisions = sortRevisionsByEnforcementDateDesc(revisions);

    // 5. Process revisions in chunks of 3
    const chunkSize = 3;
    for (let i = 0; i < sortedRevisions.length; i += chunkSize) {
      const chunk = sortedRevisions.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (rev: any, chunkIndex: number) => {
          const revIndexNum = String(i + chunkIndex + 1).padStart(3, '0');
          const safePromNo = rev.promulgationNo || '개정본';
          const safeEnfDate = rev.enforcementDate || '시행일 미상';
          const docTitle = `${revIndexNum}_[${cleanLawName}] ${safePromNo} (${safeEnfDate} 시행)`;

          // Check if file already exists in folder
          if (existingFileMap.has(docTitle)) {
            const ex = existingFileMap.get(docTitle)!;
            skippedCount++;
            savedSheets.push({
              title: docTitle,
              spreadsheetId: ex.id,
              url: ex.url,
              promulgationNo: rev.promulgationNo,
              enforcementDate: rev.enforcementDate,
              isExisting: true,
            });
            console.log(`[Unified Sheet Exists - Skipped] ${docTitle}`);
            return;
          }

          try {
            // Fetch articles from National Law API
            const isAdmrul = targetType === 'admrul' || rev.targetType === 'admrul' || cleanLawName === '외국환거래규정';
            const idParam = rev.lawMst || rev.seq || rev.id || (isAdmrul ? '2100000281984' : '280363');

            const detailUrl = isAdmrul
              ? `http://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(
                  ocKey
                )}&target=admrul&ID=${encodeURIComponent(idParam)}&type=XML`
              : `http://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(
                  ocKey
                )}&target=law&MST=${encodeURIComponent(idParam)}&type=XML`;

            const detailRes = await fetch(detailUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            });

            let revArticles: any[] = [];
            if (detailRes.ok) {
              const detailXml = await detailRes.text();
              const parsed = xmlParser.parse(detailXml);
              const root =
                parsed.AdmRulService ||
                parsed.admRulService ||
                parsed.행정규칙 ||
                parsed.AdmRul ||
                parsed.법령 ||
                parsed.Law ||
                parsed;
              revArticles = isAdmrul ? parseAdmrulArticlesFromXmlRoot(root) : parseArticlesFromXmlRoot(root);
            }

            // Append buchik row if buchikText exists
            if (rev.buchikText && (!revArticles.some((a) => a.articleTitle?.includes('부칙') || a.articleNo?.includes('부칙')))) {
              revArticles.push({
                chapterName: '부칙',
                sectionName: '',
                subsectionName: '',
                articleNo: '부칙',
                articleTitle: `${safePromNo} 부칙`,
                articleContent: rev.buchikText,
                effectiveDate: safeEnfDate,
              });
            }

            // Create Spreadsheet in Google Drive folder
            const createRes = await callWithRetry(() =>
              drive.files.create({
                requestBody: {
                  name: docTitle,
                  mimeType: 'application/vnd.google-apps.spreadsheet',
                  parents: [folderId],
                },
                fields: 'id, name, webViewLink',
              })
            );

            const spId = createRes.data.id || '';
            const spUrl = createRes.data.webViewLink || `https://docs.google.com/spreadsheets/d/${spId}/edit`;
            if (!spId) return;

            // Set Public Permission if requested
            if (permissionOption?.type === 'anyone') {
              try {
                await callWithRetry(() =>
                  drive.permissions.create({
                    fileId: spId,
                    requestBody: {
                      role: permissionOption.role || 'reader',
                      type: 'anyone',
                    },
                  })
                );
              } catch (pErr) {}
            }

            // Setup sheet tabs: [개요] (sheetId: 0) and [조문 목록] (sheetId: 1)
            const overviewSheet = `${cleanLawName} 개요`;
            const articlesSheet = '조문 목록';

            await callWithRetry(() =>
              sheets.spreadsheets.batchUpdate({
                spreadsheetId: spId,
                requestBody: {
                  requests: [
                    {
                      updateSheetProperties: {
                        properties: { sheetId: 0, title: overviewSheet },
                        fields: 'title',
                      },
                    },
                    {
                      addSheet: {
                        properties: { sheetId: 1, title: articlesSheet, index: 1 },
                      },
                    },
                  ],
                },
              })
            );

            // Populate Overview Values
            const overviewValues = [
              [`[국가법령/행정규칙] ${cleanLawName} 개정본 상세 개요`],
              [''],
              ['항목', '상세 내용'],
              ['법령 / 행정규칙명', cleanLawName],
              ['공포 / 발령번호', safePromNo],
              ['시행일자', safeEnfDate],
              ['공포 / 발령일자', rev.promulgationDate || '-'],
              ['제개정구분', rev.revisionType || '일부개정'],
              ['소관부처', rev.department || '기획재정부'],
              ['법령구분 / 종류', isAdmrul ? (rev.ruleType ? `행정규칙(${rev.ruleType})` : '행정규칙(고시)') : (rev.ruleType || '법률')],
              ['법령일련번호 (ID/MST)', rev.lawMst || rev.seq || rev.id || '-'],
              ['수록 조문 수', `${revArticles.length}개 조문 (장·절·관 분류 및 부칙 포함)`],
              ['저장 폴더', targetFolderName],
              ['생성 일시', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })],
            ];

            // Populate Article Rows
            const articleHeaders = [
              '장 (Chapter)',
              '절 (Section)',
              '관 (Subsection)',
              '조문 번호',
              '조문 제목',
              '조문 내용 (전문)',
              '시행일자',
              '비고',
            ];

            const articleRows = revArticles.map((art) => [
              art.chapterName || '',
              art.sectionName || '',
              art.subsectionName || '',
              art.articleNo || '',
              art.articleTitle || '',
              art.articleContent || '',
              art.effectiveDate || safeEnfDate,
              art.isDeleted ? '삭제' : '',
            ]);

            await callWithRetry(() =>
              sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: spId,
                requestBody: {
                  valueInputOption: 'USER_ENTERED',
                  data: [
                    {
                      range: `'${overviewSheet}'!A1`,
                      values: overviewValues,
                    },
                    {
                      range: `'${articlesSheet}'!A1`,
                      values: [articleHeaders, ...articleRows],
                    },
                  ],
                },
              })
            );

            // Format styling: TOP vertical alignment, WRAP text, Navy header with bold white text, freeze rows
            await callWithRetry(() =>
              sheets.spreadsheets.batchUpdate({
                spreadsheetId: spId,
                requestBody: {
                  requests: [
                    // Overview sheet format
                    {
                      repeatCell: {
                        range: { sheetId: 0, startRowIndex: 0 },
                        cell: {
                          userEnteredFormat: {
                            verticalAlignment: 'TOP',
                            wrapStrategy: 'WRAP',
                          },
                        },
                        fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)',
                      },
                    },
                    {
                      repeatCell: {
                        range: { sheetId: 0, startRowIndex: 2, endRowIndex: 3 },
                        cell: {
                          userEnteredFormat: {
                            backgroundColor: { red: 0.12, green: 0.18, blue: 0.3 },
                            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 10 },
                            verticalAlignment: 'MIDDLE',
                            horizontalAlignment: 'CENTER',
                          },
                        },
                        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment)',
                      },
                    },
                    // Articles sheet format
                    {
                      repeatCell: {
                        range: { sheetId: 1, startRowIndex: 0 },
                        cell: {
                          userEnteredFormat: {
                            verticalAlignment: 'TOP',
                            wrapStrategy: 'WRAP',
                          },
                        },
                        fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)',
                      },
                    },
                    {
                      repeatCell: {
                        range: { sheetId: 1, startRowIndex: 0, endRowIndex: 1 },
                        cell: {
                          userEnteredFormat: {
                            backgroundColor: { red: 0.12, green: 0.18, blue: 0.3 },
                            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 10 },
                            verticalAlignment: 'MIDDLE',
                            horizontalAlignment: 'CENTER',
                          },
                        },
                        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment)',
                      },
                    },
                    {
                      updateSheetProperties: {
                        properties: { sheetId: 1, gridProperties: { frozenRowCount: 1 } },
                        fields: 'gridProperties.frozenRowCount',
                      },
                    },
                    {
                      updateDimensionProperties: {
                        range: { sheetId: 1, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 },
                        properties: { pixelSize: 520 },
                        fields: 'pixelSize',
                      },
                    },
                  ],
                },
              })
            );

            newCreatedCount++;
            savedSheets.push({
              title: docTitle,
              spreadsheetId: spId,
              url: spUrl,
              promulgationNo: rev.promulgationNo,
              enforcementDate: rev.enforcementDate,
              articleCount: revArticles.length,
              isExisting: false,
            });
          } catch (itemErr: any) {
            console.warn(`[Unified Sheet Creation Warning] ${docTitle}:`, itemErr?.message);
          }
        })
      );
      // Pacing delay
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    let summaryMsg = `Google Drive '${targetFolderName}' 폴더에 저장이 완료되었습니다! (신규 생성: ${newCreatedCount}개, 중복 스킵: ${skippedCount}개)`;
    if (skippedCount > 0 && newCreatedCount === 0) {
      summaryMsg = `Google Drive '${targetFolderName}' 폴더에 모든 파일(${skippedCount}개)이 이미 존재하여 저장을 스킵했습니다.`;
    }

    return res.json({
      success: true,
      folder: {
        id: folderId,
        name: targetFolderName,
        url: folderUrl,
        created: !folderSkipped,
        isExisting: folderSkipped,
      },
      savedSheets,
      createdCount: newCreatedCount,
      skippedCount,
      totalCount: savedSheets.length,
      message: summaryMsg,
    });
  } catch (error: any) {
    console.error('Unified Export Revision Sheets Error:', error);
    const errMsg = error.message || 'Google Drive 저장 중 오류가 발생했습니다.';
    const isAuthError =
      error.status === 401 ||
      errMsg.includes('Invalid Credentials') ||
      errMsg.includes('auth') ||
      errMsg.includes('token') ||
      errMsg.includes('UNAUTHENTICATED');
    const isForbidden =
      error.status === 403 ||
      errMsg.includes('PERMISSION_DENIED') ||
      errMsg.includes('insufficient');

    let userFriendlyMsg = errMsg;
    if (isAuthError) {
      userFriendlyMsg = 'Google 인증 토큰이 만료되었거나 유효하지 않습니다. 상단 [Google 로그인] 버튼을 눌러 다시 로그인해 주세요.';
    } else if (isForbidden) {
      userFriendlyMsg = 'Google Drive / Spreadsheets 쓰기 권한이 부족합니다. Google 로그인 시 드라이브 및 스프레드시트 전체 권한을 허용해 주세요.';
    }

    return res.status(error.status || (isAuthError ? 401 : 500)).json({
      success: false,
      error: userFriendlyMsg,
      authError: isAuthError || isForbidden,
    });
  }
});

// API Route: Revoke all external Drive permissions (비공개 전환)
app.post('/api/drive/permissions/revoke', async (req, res) => {
  try {
    const { accessToken, targetId, targetIds } = req.body;
    if (!accessToken) {
      return res.status(401).json({ error: 'Google OAuth 인증 토큰이 필요합니다.' });
    }
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth });

    const allIds = [targetId, ...(Array.isArray(targetIds) ? targetIds : [])].filter(Boolean);
    for (const fId of allIds) {
      try {
        const permRes = await drive.permissions.list({ fileId: fId, fields: 'permissions(id, role, type)' });
        for (const p of permRes.data.permissions || []) {
          if (p.type === 'anyone' && p.id) {
            await drive.permissions.delete({ fileId: fId, permissionId: p.id });
          }
        }
      } catch (pErr: any) {
        console.warn(`[Permission Revoke Warning] File ${fId}:`, pErr?.message);
      }
    }
    return res.json({ success: true, message: '모든 외부 공유 권한이 성공적으로 해제되어 소유자 전용 비공개로 전환되었습니다.' });
  } catch (err: any) {
    console.error('Revoke permission error:', err);
    return res.status(500).json({ error: err.message || '권한 해제 중 오류가 발생했습니다.' });
  }
});


// API Route: Export all 140 revisions as separate CSV files in a ZIP archive
app.post('/api/export/zip-140', async (req, res) => {
  try {
    const ocKey = req.body.ocKey || DEFAULT_OC_KEY;
    console.log('[ZIP Export] Starting retrieval of 140 revisions for ZIP package...');

    let revisionList: any[] = req.body.revisions || [];
    if (!Array.isArray(revisionList) || revisionList.length === 0) {
      revisionList = await fetchAll140Revisions(ocKey);
    }

    if (!revisionList || revisionList.length === 0) {
      return res.status(400).json({ error: '수집된 관세법 개정 이력 데이터를 찾을 수 없습니다.' });
    }

    const zip = new JSZip();
    const folder = zip.folder('관세법_140개_개정자료_개별파일');

    // Add a master summary CSV
    let summaryCsv = '\uFEFF연번,공포번호,시행일자,공포일자,개정구분,법령명,소관부처,MST\n';
    revisionList.forEach((rev, idx) => {
      const escapeCsv = (val: string) => `"${(val || '').replace(/"/g, '""')}"`;
      summaryCsv += `${idx + 1},${escapeCsv(rev.promulgationNo)},${escapeCsv(rev.enforcementDate)},${escapeCsv(rev.promulgationDate)},${escapeCsv(rev.revisionType)},${escapeCsv(rev.lawName || '관세법')},${escapeCsv(rev.department || '기획재정부')},${escapeCsv(rev.lawMst)}\n`;
    });
    folder?.file('000_관세법_전체140건_개정연혁목록.csv', summaryCsv);

    // Fetch details in concurrent chunks of 15
    const chunkSize = 15;
    for (let i = 0; i < revisionList.length; i += chunkSize) {
      const chunk = revisionList.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (rev, chunkIdx) => {
          const indexNum = String(i + chunkIdx + 1).padStart(3, '0');
          try {
            const detailUrl = `http://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(
              ocKey
            )}&target=law&MST=${encodeURIComponent(rev.lawMst)}&type=XML`;

            const detailRes = await fetch(detailUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            });

            if (detailRes.ok) {
              const detailXml = await detailRes.text();
              const parsed = xmlParser.parse(detailXml);
              const root = parsed.법령 || parsed.Law || parsed;
              const revArticles = parseArticlesFromXmlRoot(root);

              let csvContent = '\uFEFF장,절,관,조문번호,조문제목,조문내용,시행일자,비고\n';
              revArticles.forEach((art) => {
                const escapeCsv = (val: string) => `"${(val || '').replace(/"/g, '""')}"`;
                csvContent += `${escapeCsv(art.chapterName)},${escapeCsv(art.sectionName)},${escapeCsv(art.subsectionName)},${escapeCsv(art.articleNo)},${escapeCsv(art.articleTitle)},${escapeCsv(art.articleContent)},${escapeCsv(art.effectiveDate || rev.enforcementDate)},${escapeCsv(art.isDeleted ? '삭제' : '')}\n`;
              });

              const safePromNo = (rev.promulgationNo || '개정본').replace(/[\/\\?%*:|"<>]/g, '_');
              const safeEnfDate = (rev.enforcementDate || '00000000').replace(/\./g, '');
              const filename = `${indexNum}_관세법_${safePromNo}_${safeEnfDate}.csv`;

              folder?.file(filename, csvContent);
            }
          } catch (err: any) {
            console.warn(`[ZIP Export] Error for MST ${rev.lawMst}:`, err?.message);
          }
        })
      );
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="CustomsAct_140_Revisions_Separate_Files.zip"');
    return res.send(zipBuffer);
  } catch (err: any) {
    console.error('ZIP Export error:', err);
    return res.status(500).json({ error: err.message || 'ZIP 개별 파일 모음 생성에 실패했습니다.' });
  }
});

// API Route: Generate Article History (e.g. Article 2 "제2조") across all 140 revisions and save to Google Sheets
app.post('/api/sheets/save-article-history', async (req, res) => {
  try {
    const { accessToken, targetArticleNo = '제2조', listOnly = false } = req.body;
    const ocKey = req.body.ocKey || DEFAULT_OC_KEY;

    if (!accessToken) {
      return res.status(401).json({
        error: '유효한 Google OAuth Access Token이 필요합니다. 상단의 Google 계정 연결 버튼을 눌러주세요.',
      });
    }

    let revisionList: any[] = req.body.revisions || [];
    if (!Array.isArray(revisionList) || revisionList.length === 0) {
      revisionList = await fetchAll140Revisions(ocKey);
    }

    if (!revisionList || revisionList.length === 0) {
      return res.status(400).json({ error: '관세법 개정 이력 데이터를 수집할 수 없습니다.' });
    }

    console.log(`[Article History Export] Fetching history for ${targetArticleNo} (listOnly: ${listOnly}) across ${revisionList.length} revisions...`);

    const articleHistoryRows: any[] = [];

    // Helper for rate limits
    const callApiWithRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 800): Promise<T> => {
      try {
        return await fn();
      } catch (err: any) {
        if (retries > 0) {
          await new Promise((r) => setTimeout(r, delay));
          return callApiWithRetry(fn, retries - 1, delay * 2);
        }
        throw err;
      }
    };

    // Fetch XML for each revision in small concurrent chunks (10)
    const chunkSize = 10;
    for (let i = 0; i < revisionList.length; i += chunkSize) {
      const chunk = revisionList.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (rev) => {
          try {
            const detailUrl = `http://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(
              ocKey
            )}&target=law&MST=${encodeURIComponent(rev.lawMst)}&type=XML`;

            const detailRes = await fetch(detailUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            });

            if (!detailRes.ok) return;

            const detailXml = await detailRes.text();
            const parsed = xmlParser.parse(detailXml);
            const root = parsed.법령 || parsed.Law || parsed;
            const revArticles = parseArticlesFromXmlRoot(root);

            // Find matching article (e.g. "제2조")
            const targetArt = revArticles.find((art) => {
              const no = (art.articleNo || '').replace(/\s+/g, '');
              const target = targetArticleNo.replace(/\s+/g, '');
              return no === target || (no.startsWith(target) && !no.includes('의'));
            });

            if (targetArt) {
              articleHistoryRows.push({
                promulgationNo: rev.promulgationNo,
                enforcementDate: rev.enforcementDate,
                promulgationDate: rev.promulgationDate,
                revisionType: rev.revisionType,
                articleNo: targetArt.articleNo || targetArticleNo,
                articleTitle: targetArt.articleTitle || '',
                articleContent: targetArt.articleContent || '(조문 내용 없음)',
                isDeleted: targetArt.isDeleted,
                department: rev.department || '기획재정부',
                lawMst: rev.lawMst,
              });
            } else {
              articleHistoryRows.push({
                promulgationNo: rev.promulgationNo,
                enforcementDate: rev.enforcementDate,
                promulgationDate: rev.promulgationDate,
                revisionType: rev.revisionType,
                articleNo: targetArticleNo,
                articleTitle: '미규정/미포함',
                articleContent: '(해당 개정본에는 해당 조문이 포함되어 있지 않거나 삭제된 상태입니다)',
                isDeleted: true,
                department: rev.department || '기획재정부',
                lawMst: rev.lawMst,
              });
            }
          } catch (err: any) {
            console.warn(`[Article History] Error fetching MST ${rev.lawMst}:`, err?.message);
          }
        })
      );
    }

    // Sort history chronologically by enforcement date / promulgation date
    articleHistoryRows.sort((a, b) => {
      const da = (a.enforcementDate || '').replace(/\./g, '');
      const db = (b.enforcementDate || '').replace(/\./g, '');
      return da.localeCompare(db);
    });

    // Detect substantive text changes (문구 실제 변경 여부 자동 감지)
    const normalizeContent = (str: string) => (str || '').replace(/\s+/g, ' ').trim();
    let prevContent = '';
    articleHistoryRows.forEach((row, idx) => {
      const currentNorm = normalizeContent(row.articleContent);
      const prevNorm = normalizeContent(prevContent);

      if (idx === 0) {
        row.isSubstantiveChange = true;
        row.changeNote = '최초 제정/시행';
      } else if (row.isDeleted) {
        row.isSubstantiveChange = prevNorm !== '' && !prevNorm.includes('삭제된 상태');
        row.changeNote = '삭제/미규정';
      } else if (prevNorm !== currentNorm && !currentNorm.includes('삭제된 상태')) {
        row.isSubstantiveChange = true;
        row.changeNote = '⭐ 실질 조문문구 개정 (추가·수정·삭제)';
      } else {
        row.isSubstantiveChange = false;
        row.changeNote = '타조개정에 따른 조문 문구 유지';
      }

      if (!row.isDeleted && currentNorm && !currentNorm.includes('삭제된 상태')) {
        prevContent = row.articleContent;
      }
    });

    const substantiveRows = articleHistoryRows.filter((r) => r.isSubstantiveChange);

    // Filter list if substantiveOnly flag requested
    const targetRows = req.body.substantiveOnly ? substantiveRows : articleHistoryRows;

    // Google Sheets creation
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const sheets = google.sheets({ version: 'v4', auth });

    const docTitle = req.body.substantiveOnly
      ? `[관세법] ${targetArticleNo} 실질 문구 변경이력 전용 (${substantiveRows.length}개 개정본)`
      : listOnly
      ? `[관세법] ${targetArticleNo} 조문별 변경이력 목록 (${articleHistoryRows.length}개 연혁)`
      : `[관세법] ${targetArticleNo} 조문별 변천사 및 개정본별 조문내용 (${articleHistoryRows.length}개 연혁)`;

    const sheet1Title = `${targetArticleNo} 개정이력 개요`;
    const sheet2Title = listOnly
      ? `${targetArticleNo} 전체 변경이력 목록`
      : `${targetArticleNo} 전체 시기별 조문내용`;
    const sheet3Title = `⭐ ${targetArticleNo} 실질 문구 변경건 (${substantiveRows.length}건)`;

    const createRes = await callApiWithRetry(() =>
      sheets.spreadsheets.create({
        requestBody: {
          properties: { title: docTitle },
          sheets: [
            { properties: { title: sheet1Title, index: 0 } },
            { properties: { title: sheet2Title, index: 1 } },
            { properties: { title: sheet3Title, index: 2 } },
          ],
        },
      })
    );

    const spreadsheetId = createRes.data.spreadsheetId;
    if (!spreadsheetId) {
      throw new Error('Google Spreadsheet 생성 실패');
    }

    const firstRow = articleHistoryRows[0];
    const lastRow = articleHistoryRows[articleHistoryRows.length - 1];

    const overviewValues = [
      [`국가법령정보포털 - 관세법 ${targetArticleNo} 조문별 변경이력 및 실질 문구 변천사 DB`],
      [''],
      ['항목', '내용'],
      ['대상 법령', '관세법 (법률)'],
      ['대상 조문', targetArticleNo],
      ['분석 개정본 수', `전체 ${articleHistoryRows.length}개 시기별 개정판`],
      ['⭐ 실질 조문문구 변경 횟수', `${substantiveRows.length}회 (법률 제6305호, 8833호, 10424호, 17649호, 19186호, 19924호 등)`],
      ['실질 변경 공포번호 목록', substantiveRows.map((r) => r.promulgationNo).join(', ')],
      ['최초 제정 당시 시행일', firstRow ? firstRow.enforcementDate : '-'],
      ['최초 제정 당시 조문 제목', firstRow ? firstRow.articleTitle : '-'],
      ['최신 시행일자', lastRow ? lastRow.enforcementDate : '-'],
      ['최신 시행 조문 제목', lastRow ? lastRow.articleTitle : '-'],
      ['분석 생성 일시', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })],
      ['참고 사항', '본 구글시트는 관세법 140개 개정본 중 타조개정에 따른 단순 조문유지 건과 실제 조문문구가 추가·수정·삭제된 실질 변경건을 자동 비교 판별하여 분류하였습니다.'],
    ];

    const historyHeaders = listOnly
      ? [
          '연번',
          '시행일자',
          '공포번호',
          '공포일자',
          '개정구분',
          '조문 번호',
          '조문 제목',
          '실질 변경 여부',
          '변경 구분 / 비고',
          '소관부처',
          '법령일련번호 (MST)',
        ]
      : [
          '연번',
          '시행일자',
          '공포번호',
          '공포일자',
          '개정구분',
          '조문 번호',
          '조문 제목',
          `시행 당시 ${targetArticleNo} 조문 전문 (본문 내용)`,
          '실질 변경 여부',
          '변경 구분 / 비고',
          '소관부처',
          '법령일련번호 (MST)',
        ];

    const historyDataRows = targetRows.map((row, idx) =>
      listOnly
        ? [
            idx + 1,
            row.enforcementDate || '',
            row.promulgationNo || '',
            row.promulgationDate || '',
            row.revisionType || '',
            row.articleNo || targetArticleNo,
            row.articleTitle || '',
            row.isSubstantiveChange ? '⭐ 실질 문구 변경' : '단순 조문 유지',
            row.changeNote || '',
            row.department || '기획재정부',
            row.lawMst || '',
          ]
        : [
            idx + 1,
            row.enforcementDate || '',
            row.promulgationNo || '',
            row.promulgationDate || '',
            row.revisionType || '',
            row.articleNo || targetArticleNo,
            row.articleTitle || '',
            row.articleContent || '',
            row.isSubstantiveChange ? '⭐ 실질 문구 변경' : '단순 조문 유지',
            row.changeNote || '',
            row.department || '기획재정부',
            row.lawMst || '',
          ]
    );

    // Sheet 3: Substantive changes only rows
    const substantiveDataRows = substantiveRows.map((row, idx) => [
      idx + 1,
      row.enforcementDate || '',
      row.promulgationNo || '',
      row.promulgationDate || '',
      row.revisionType || '',
      row.articleNo || targetArticleNo,
      row.articleTitle || '',
      row.articleContent || '',
      '⭐ 실질 문구 변경',
      row.changeNote || '',
      row.department || '기획재정부',
      row.lawMst || '',
    ]);

    const substantiveHeaders = [
      '연번',
      '시행일자',
      '공포번호',
      '공포일자',
      '개정구분',
      '조문 번호',
      '조문 제목',
      `시행 당시 ${targetArticleNo} 조문 전문 (실질 변경된 본문)`,
      '실질 변경 여부',
      '변경 구분 / 비고',
      '소관부처',
      '법령일련번호 (MST)',
    ];

    await callApiWithRetry(() =>
      sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: [
            { range: `'${sheet1Title}'!A1`, values: overviewValues },
            { range: `'${sheet2Title}'!A1`, values: [historyHeaders, ...historyDataRows] },
            { range: `'${sheet3Title}'!A1`, values: [substantiveHeaders, ...substantiveDataRows] },
          ],
        },
      })
    );

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    return res.json({
      success: true,
      spreadsheetId,
      spreadsheetUrl,
      targetArticleNo,
      totalCount: articleHistoryRows.length,
      message: listOnly
        ? `관세법 ${targetArticleNo} 조문별 변경이력 목록(${articleHistoryRows.length}개 항목)이 새 구글시트에 성공적으로 생성되었습니다!`
        : `관세법 ${targetArticleNo} 조문별 변경이력 및 시기별 본문 내용(${articleHistoryRows.length}개 개정본)이 새 구글시트에 성공적으로 생성되었습니다!`,
    });
  } catch (err: any) {
    console.error('Article history export error:', err);
    return res.status(500).json({ error: err.message || '조문별 변경이력 구글시트 생성에 실패했습니다.' });
  }
});

// Helper to natural sort Korean law article numbers (e.g. 제1조, 제1조의2, 제2조, 제10조...)
function parseArticleNoKey(noStr: string) {
  if (!noStr) return [99999, 0];
  const match = noStr.match(/제?(\d+)(?:조(?:의(\d+))?)?/);
  if (!match) return [99999, 0];
  const num = parseInt(match[1], 10) || 0;
  const sub = match[2] ? parseInt(match[2], 10) : 0;
  return [num, sub];
}

function sortArticleNos(nos: string[]): string[] {
  return [...nos].sort((a, b) => {
    const [numA, subA] = parseArticleNoKey(a);
    const [numB, subB] = parseArticleNoKey(b);
    if (numA !== numB) return numA - numB;
    return subA - subB;
  });
}

function extractKeywords(str: string): string[] {
  if (!str) return [];
  const words = str.split(/[\sㆍ·,/()_\-]+/).filter((w) => w.length >= 2);
  const keyTerms = [
    '품목분류',
    '과세가격',
    '가격신고',
    '사전심사',
    '사전회시',
    '덤핑방지',
    '상계관세',
    '보복관세',
    '긴급관세',
    '관세환급',
    '보세구역',
    '보세창고',
    '보세공장',
    '통관',
    '체납',
    '납세의무',
    '용어의 뜻',
    '정의',
    '목적',
  ];
  const extracted = new Set<string>(words);
  for (const kt of keyTerms) {
    if (str.includes(kt)) extracted.add(kt);
  }
  return Array.from(extracted);
}

function findMatching1967Article(
  art2000: any,
  articles1967: any[]
): { matchedNo: string; matchedTitle: string; changeType: string; note: string } {
  const t2000Raw = art2000.articleTitle || '';
  const t2000 = t2000Raw.replace(/\s+/g, '').replace(/[ㆍ·,/()_\-]/g, '');
  const no2000 = art2000.articleNo || '';

  if (!articles1967 || articles1967.length === 0) {
    return { matchedNo: '', matchedTitle: '', changeType: '2000년 전부개정 신설', note: '1967년 체계 대비 2000년 전부개정시 새로 신설된 조문 (1)번 공란)' };
  }

  // 1. Exact Title Match
  if (t2000) {
    const exactTitleMatch = articles1967.find((p) => {
      const pTitle = (p.articleTitle || '').replace(/\s+/g, '').replace(/[ㆍ·,/()_\-]/g, '');
      return pTitle && pTitle === t2000;
    });

    if (exactTitleMatch) {
      const isSameNo = exactTitleMatch.articleNo === no2000;
      return {
        matchedNo: exactTitleMatch.articleNo,
        matchedTitle: exactTitleMatch.articleTitle || '(제목없음)',
        changeType: isSameNo ? '동일 조문유지' : '조문번호 위치 이동',
        note: isSameNo
          ? `1)번 ${exactTitleMatch.articleNo} (${exactTitleMatch.articleTitle})와 동일한 조문번호/제목 유지`
          : `1)번 ${exactTitleMatch.articleNo} (${exactTitleMatch.articleTitle}) -> 2)번 ${no2000} (${t2000Raw})로 조문번호 이동`,
      };
    }
  }

  // 2. Keyword / Substring Match (e.g. 품목분류의 사전회시등 vs 특정물품에 적용될 품목분류의 사전심사)
  if (t2000 && t2000.length >= 2) {
    const keywords2000 = extractKeywords(t2000Raw);
    let bestCandidate: any = null;
    let maxScore = 0;

    for (const cand of articles1967) {
      const candTitle = cand.articleTitle || '';
      if (!candTitle) continue;

      const keywords1967 = extractKeywords(candTitle);
      const overlapCount = keywords2000.filter((kw) => keywords1967.includes(kw) || candTitle.includes(kw) || t2000Raw.includes(kw)).length;

      let score = overlapCount;

      // Special Domain Pairs
      const bothPum = t2000Raw.includes('품목분류') && candTitle.includes('품목분류');
      const bothSajeon = (t2000Raw.includes('사전심사') || t2000Raw.includes('사전')) && (candTitle.includes('사전회시') || candTitle.includes('사전'));
      if (bothPum && bothSajeon) score += 10;
      else if (bothPum) score += 5;

      const bothGagyeok = t2000Raw.includes('가격신고') && candTitle.includes('가격신고');
      if (bothGagyeok) score += 10;

      const bothGwase = t2000Raw.includes('과세가격') && candTitle.includes('과세가격');
      if (bothGwase) score += 6;

      if (score > maxScore && score >= 2) {
        maxScore = score;
        bestCandidate = cand;
      }
    }

    if (bestCandidate) {
      return {
        matchedNo: bestCandidate.articleNo,
        matchedTitle: bestCandidate.articleTitle || '(제목없음)',
        changeType: '조문제목 수정/개정',
        note: `1)번 ${bestCandidate.articleNo} (${bestCandidate.articleTitle}) -> 2)번 ${no2000} (${t2000Raw})로 수정/변경`,
      };
    }
  }

  // 3. Exact Article Number Match (if title is general)
  const sameNoArt = articles1967.find((p) => p.articleNo === no2000);
  if (sameNoArt && sameNoArt.articleTitle) {
    return {
      matchedNo: sameNoArt.articleNo,
      matchedTitle: sameNoArt.articleTitle,
      changeType: '동일 조문번호 (제목 변경)',
      note: `1)번 ${sameNoArt.articleNo} (${sameNoArt.articleTitle}) 대비 2)번 ${no2000} (${t2000Raw}) 제목 변경`,
    };
  }

  // 4. No Match -> Leave 1967 columns BLANK
  return {
    matchedNo: '',
    matchedTitle: '',
    changeType: '2000년 전부개정 신설',
    note: '1967년 체계 대비 2000년 전부개정시 새로 신설된 조문 (1)번 공란)',
  };
}

// API Route: Wholly Amended Laws Comparison (1967 Act No. 1976 & 2000 Act No. 6305)
app.post('/api/sheets/save-wholly-amended-comparison', async (req, res) => {
  try {
    const { accessToken } = req.body;
    const ocKey = req.body.ocKey || DEFAULT_OC_KEY;

    if (!accessToken) {
      return res.status(401).json({
        error: '유효한 Google OAuth Access Token이 필요합니다. Google 계정을 먼저 연결해 주세요.',
      });
    }

    let revisionList: any[] = req.body.revisions || [];
    if (!Array.isArray(revisionList) || revisionList.length === 0) {
      revisionList = await fetchAll140Revisions(ocKey);
    }

    if (!revisionList || revisionList.length === 0) {
      return res.status(400).json({ error: '관세법 개정 이력 데이터를 수집할 수 없습니다.' });
    }

    // Sort chronologically
    revisionList.sort((a, b) => {
      const da = (a.promulgationDate || a.enforcementDate || '').replace(/\./g, '');
      const db = (b.promulgationDate || b.enforcementDate || '').replace(/\./g, '');
      return da.localeCompare(db);
    });

    // Find 1967 Wholly Amended Law (제1976호) and 2000 Wholly Amended Law (제6305호)
    const idx1967 = revisionList.findIndex(
      (r) => (r.promulgationNo || '').includes('1976') || (r.promulgationDate || '').startsWith('1967')
    );

    const idx2000 = revisionList.findIndex(
      (r) => (r.promulgationNo || '').includes('6305') || (r.promulgationDate || '').startsWith('2000')
    );

    const start1967Idx = idx1967 >= 0 ? idx1967 : 0;
    const start2000Idx = idx2000 >= 0 ? idx2000 : revisionList.findIndex((r) => (r.promulgationDate || '') >= '2000.12.29');

    // Period 1 Revisions: 1967년 제1976호 ~ 2000년 제6305호 직전
    const revs1967 = revisionList.slice(start1967Idx, start2000Idx > start1967Idx ? start2000Idx : revisionList.length);

    // Period 2 Revisions: 2000년 제6305호 ~ 현재
    const revs2000 = revisionList.slice(start2000Idx >= 0 ? start2000Idx : 0);

    // Pre-2000 revision (immediately before 제6305호)
    const revPrev = start2000Idx > 0 ? revisionList[start2000Idx - 1] : revs1967[revs1967.length - 1];
    const rev6305 = revisionList[start2000Idx];

    console.log(`[Wholly Amended] Period 1 (1967~2000): ${revs1967.length} revs, Period 2 (2000~): ${revs2000.length} revs`);

    // Fetch XML articles for all revisions in chunks
    const allRevsToFetch = Array.from(new Set([...revs1967, ...revs2000, revPrev, rev6305].filter(Boolean)));
    const articlesMap = new Map<string, any[]>();

    const chunkSize = 8;
    for (let i = 0; i < allRevsToFetch.length; i += chunkSize) {
      const chunk = allRevsToFetch.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (rev) => {
          try {
            const detailUrl = `http://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(
              ocKey
            )}&target=law&MST=${encodeURIComponent(rev.lawMst)}&type=XML`;

            const detailRes = await fetch(detailUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            });

            if (!detailRes.ok) return;

            const detailXml = await detailRes.text();
            const parsed = xmlParser.parse(detailXml);
            const root = parsed.법령 || parsed.Law || parsed;
            const articles = parseArticlesFromXmlRoot(root);
            articlesMap.set(rev.lawMst, articles);
          } catch (err: any) {
            console.warn(`[Wholly Amended Fetch] Error fetching MST ${rev.lawMst}:`, err?.message);
          }
        })
      );
    }

    // 1) Build Matrix for Period 2: 2000년 전부개정 계열 (법률 제21208호 ~ 제6305호)
    const revs2000Desc = [...revs2000].reverse(); // Reverse chronological (newest law 21208 first)

    const articleNos2000Set = new Set<string>();
    revs2000Desc.forEach((r) => {
      const arts = articlesMap.get(r.lawMst) || [];
      arts.forEach((a) => {
        if (a.articleNo) articleNos2000Set.add(a.articleNo);
      });
    });

    const sortedArticleNos2000 = sortArticleNos(Array.from(articleNos2000Set));

    const headers2000 = [
      '연번',
      '조문번호',
      ...revs2000Desc.map((r) => `${r.promulgationNo || '법률'}(${r.promulgationDate || r.enforcementDate || ''})`),
    ];

    const rows2000 = sortedArticleNos2000.map((artNo, idx) => {
      const rowVals: string[] = [];

      for (let c = 0; c < revs2000Desc.length; c++) {
        const rev = revs2000Desc[c];
        const arts = articlesMap.get(rev.lawMst) || [];
        const found = arts.find((a) => a.articleNo === artNo);

        let textVal = '';
        if (found) {
          if (found.isDeleted) {
            textVal = `[삭제] ${found.articleTitle || ''}`.trim();
          } else {
            textVal = found.articleTitle ? `${artNo} (${found.articleTitle})` : artNo;
          }
        } else {
          textVal = '-';
        }

        if (c === 0) {
          // First law column (latest law e.g. 21208) shows baseline text
          rowVals.push(textVal);
        } else {
          // Compare with previous (newer) law column (c - 1)
          const prevRev = revs2000Desc[c - 1];
          const prevArts = articlesMap.get(prevRev.lawMst) || [];
          const prevFound = prevArts.find((a) => a.articleNo === artNo);

          let prevTextVal = '';
          if (prevFound) {
            if (prevFound.isDeleted) {
              prevTextVal = `[삭제] ${prevFound.articleTitle || ''}`.trim();
            } else {
              prevTextVal = prevFound.articleTitle ? `${artNo} (${prevFound.articleTitle})` : artNo;
            }
          } else {
            prevTextVal = '-';
          }

          // If UNCHANGED compared to adjacent newer law, leave BLANK
          if (textVal === prevTextVal) {
            rowVals.push('');
          } else {
            rowVals.push(textVal);
          }
        }
      }

      return [idx + 1, artNo, ...rowVals];
    });

    // 2) Build Matrix for Period 1: 1967년 전부개정 계열 (법률 제6136호 ~ 제2062호/제1976호)
    const revs1967Desc = [...revs1967].reverse(); // Reverse chronological (newest 6136 first)

    const articleNos1967Set = new Set<string>();
    revs1967Desc.forEach((r) => {
      const arts = articlesMap.get(r.lawMst) || [];
      arts.forEach((a) => {
        if (a.articleNo) articleNos1967Set.add(a.articleNo);
      });
    });

    const sortedArticleNos1967 = sortArticleNos(Array.from(articleNos1967Set));

    const headers1967 = [
      '연번',
      '조문번호',
      ...revs1967Desc.map((r) => `${r.promulgationNo || '법률'}(${r.promulgationDate || r.enforcementDate || ''})`),
    ];

    const rows1967 = sortedArticleNos1967.map((artNo, idx) => {
      const rowVals: string[] = [];

      for (let c = 0; c < revs1967Desc.length; c++) {
        const rev = revs1967Desc[c];
        const arts = articlesMap.get(rev.lawMst) || [];
        const found = arts.find((a) => a.articleNo === artNo);

        let textVal = '';
        if (found) {
          if (found.isDeleted) {
            textVal = `[삭제] ${found.articleTitle || ''}`.trim();
          } else {
            textVal = found.articleTitle ? `${artNo} (${found.articleTitle})` : artNo;
          }
        } else {
          textVal = '-';
        }

        if (c === 0) {
          // First law column (latest 1967-era law e.g. 6136) shows baseline text
          rowVals.push(textVal);
        } else {
          const prevRev = revs1967Desc[c - 1];
          const prevArts = articlesMap.get(prevRev.lawMst) || [];
          const prevFound = prevArts.find((a) => a.articleNo === artNo);

          let prevTextVal = '';
          if (prevFound) {
            if (prevFound.isDeleted) {
              prevTextVal = `[삭제] ${prevFound.articleTitle || ''}`.trim();
            } else {
              prevTextVal = prevFound.articleTitle ? `${artNo} (${prevFound.articleTitle})` : artNo;
            }
          } else {
            prevTextVal = '-';
          }

          // If UNCHANGED, leave BLANK
          if (textVal === prevTextVal) {
            rowVals.push('');
          } else {
            rowVals.push(textVal);
          }
        }
      }

      return [idx + 1, artNo, ...rowVals];
    });

    // 3) Build Sheet 3: 현재 최신 법률(제21208호) 조문 기준 vs 1967년 체계(법률 제6136호) 조문 대조 비교
    const latest2000Rev = revs2000Desc[0] || rev6305;
    const articles21208 = latest2000Rev ? articlesMap.get(latest2000Rev.lawMst) || [] : [];

    // Collect all unique articles from pre-2000 revisions for complete matching pool
    const allArticles1967Map = new Map<string, any>();
    revs1967.forEach((r) => {
      const arts = articlesMap.get(r.lawMst) || [];
      arts.forEach((a) => {
        if (a.articleNo && a.articleTitle) {
          allArticles1967Map.set(`${a.articleNo}_${a.articleTitle}`, a);
        }
      });
    });
    const allArticles1967List = Array.from(allArticles1967Map.values());

    const comparisonHeaders = [
      '연번',
      '현재 법률(제21208호) 조문번호',
      '현재 법률(제21208호) 조문제목',
      '1967년 체계(법률 제6136호) 대조 조문번호',
      '1967년 체계(법률 제6136호) 대조 조문제목',
      '전부개정 변경/수정 유형',
      '비고 및 대조 상세 설명',
    ];

    const comparisonRows = articles21208.map((art21208, idx) => {
      const matchResult = findMatching1967Article(art21208, allArticles1967List);

      return [
        idx + 1,
        art21208.articleNo,
        art21208.articleTitle || '(제목없음)',
        matchResult.matchedNo || '', // BLANK if newly established
        matchResult.matchedTitle || '', // BLANK if newly established
        matchResult.changeType,
        matchResult.note,
      ];
    });

    // Overview Sheet
    const overviewValues = [
      ['관세법 전부개정(1967년 제1976호~제6136호 & 2000년 제6305호~제21208호) 조문제목 변천 및 대조 분석 DB'],
      [''],
      ['분석 구분', '내용'],
      ['대상 법령', '관세법 (법률)'],
      ['현재 법률 기준', `최신 법률 제21208호 (${latest2000Rev?.promulgationDate || latest2000Rev?.enforcementDate || ''} 공포/시행)`],
      ['직전 체계 법률 기준', `2000년 전부개정 직전 법률 제6136호 계열 (${revPrev?.promulgationDate || ''} 공포)`],
      ['시트 1 구성', '2000년 전부개정 계열: 최신 법률(제21208호)을 첫 열로 배치하여 제6305호까지 역순 비교 (미변경시 공란)'],
      ['시트 2 구성', '1967년 전부개정 계열: 직전 법률(제6136호)을 첫 열로 배치하여 제2062호/제1976호까지 역순 비교 (미변경시 공란)'],
      ['시트 3 구성', '현재 법률(제21208호) 조문 기준으로 직전 법률(제6136호) 조문과 대조 (신설 조문은 제6136호 열 공란)'],
      ['분석 생성 일시', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })],
    ];

    // Google Sheets API call
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const sheets = google.sheets({ version: 'v4', auth });

    const docTitle = `[관세법] 전부개정 조문제목 변천사 (최신 제21208호 ~ 제6305호 / 제6136호 ~ 제2062호) & 대조표`;

    const sheet0Title = `전부개정 분석 개요`;
    const sheet1Title = `1) 2000년 전부개정(제21208호~제6305호)`;
    const sheet2Title = `2) 1967년 전부개정(제6136호~제2062호)`;
    const sheet3Title = `3) 최신(제21208호) vs 직전(제6136호) 대조`;

    const createRes = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: docTitle },
        sheets: [
          { properties: { title: sheet0Title, index: 0 } },
          { properties: { title: sheet1Title, index: 1 } },
          { properties: { title: sheet2Title, index: 2 } },
          { properties: { title: sheet3Title, index: 3 } },
        ],
      },
    });

    const spreadsheetId = createRes.data.spreadsheetId;
    if (!spreadsheetId) {
      throw new Error('Google Spreadsheet 생성에 실패했습니다.');
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: `'${sheet0Title}'!A1`, values: overviewValues },
          { range: `'${sheet1Title}'!A1`, values: [headers2000, ...rows2000] },
          { range: `'${sheet2Title}'!A1`, values: [headers1967, ...rows1967] },
          { range: `'${sheet3Title}'!A1`, values: [comparisonHeaders, ...comparisonRows] },
        ],
      },
    });

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    return res.json({
      success: true,
      spreadsheetId,
      spreadsheetUrl,
      message: `관세법 전부개정(1967년 제1976호, 2000년 제6305호) 조문제목 변천사 및 대조 구글시트가 성공적으로 생성되었습니다!`,
    });
  } catch (err: any) {
    console.error('Wholly amended comparison export error:', err);
    return res.status(500).json({ error: err.message || '전부개정 구글시트 생성에 실패했습니다.' });
  }
});

// Clean HTML text helper converting linebreaks to spaces
function cleanHtmlText(str: string): string {
  if (!str) return '';
  return str
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<\/td>/gi, ' ')
    .replace(/<\/tr>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Helper to fetch UNIPASS Decision Cases with full itemDesc & summary for a specific year
async function fetchUnipassYearDecisions(
  year: string = '2026',
  queryKeyword: string = '',
  maxItems: number = 0,
  customStDt?: string,
  customEdDt?: string
) {
  try {
    const listUrl = 'https://unipass.customs.go.kr/clip/prlstclsfsrch/retrieveDmstPrlstClsfCaseLst2.do';

    // Case types in UNIPASS domestic classification:
    // 01: 품목분류사례
    // 03: 협의회결정사항 (관세품목분류협의회)
    // 04: 위원회결정사항 (관세품목분류위원회)
    const caseTypes = [
      { code: '01', defaultCategory: '품목분류사례' },
      { code: '03', defaultCategory: '협의회결정사항' },
      { code: '04', defaultCategory: '위원회결정사항' },
    ];

    async function getListPage(pageIndex: number, dateFmt: 'hyphen' | 'nodash' | 'dot', caseTpcd: string, retries = 8): Promise<any> {
      let stDt = customStDt || `${year}-01-01`;
      let edDt = customEdDt || `${year}-12-31`;

      if (dateFmt === 'nodash') {
        stDt = stDt.replace(/[-.]/g, '');
        edDt = edDt.replace(/[-.]/g, '');
      } else if (dateFmt === 'dot') {
        stDt = stDt.replace(/-/g, '.');
        edDt = edDt.replace(/-/g, '.');
      }

      const params = new URLSearchParams({
        prlstClsfCaseTpcd: caseTpcd,
        rrdcNo: '',
        srchYn: 'Y',
        scrnTp: 'WDTH',
        sortColm: 'ENFR_DT',
        sortOrdr: 'DESC',
        atntSrchTp: '',
        docId: '',
        scrnId: 'UI-ULS-0203-002S',
        reffNo: '',
        dtrmHsSgn: '',
        stDt,
        edDt,
        cmdtNm: '',
        cmdtDesc: '',
        dtrmRsnCn: '',
        srwr: queryKeyword && queryKeyword !== '관세' ? queryKeyword : '',
        initPageIndex: '1',
        pageIndex: String(pageIndex),
        pagePerRecord: '10',
        recordCountPerPage: '10',
      });

      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          const res = await fetch(listUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: params.toString(),
            signal: AbortSignal.timeout(12000),
          });
          const text = await res.text();
          if (text.trim().startsWith('{')) {
            const json = JSON.parse(text);
            if (json?.uls_dmst?.itemList || json?.uls_dmst?.thisTotalCount !== undefined) {
              return json.uls_dmst || {};
            }
          }
        } catch (e) {
          // Retry on timeout or network glitch
        }
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 250 * attempt));
        }
      }
      return {};
    }

    let allRawItems: { item: any; caseTpcd: string; defaultCategory: string }[] = [];

    // Fetch for each case type (01: 품목분류, 03: 협의회, 04: 위원회)
    for (const ct of caseTypes) {
      let dateFmtUsed: 'hyphen' | 'nodash' | 'dot' = 'hyphen';
      let firstPage = await getListPage(1, 'hyphen', ct.code);
      let totalCount = parseInt(firstPage.thisTotalCount || '0', 10);

      if (totalCount === 0) {
        firstPage = await getListPage(1, 'nodash', ct.code);
        totalCount = parseInt(firstPage.thisTotalCount || '0', 10);
        if (totalCount > 0) dateFmtUsed = 'nodash';
      }
      if (totalCount === 0) {
        firstPage = await getListPage(1, 'dot', ct.code);
        totalCount = parseInt(firstPage.thisTotalCount || '0', 10);
        if (totalCount > 0) dateFmtUsed = 'dot';
      }

      if (totalCount === 0) continue;

      let totalPages = Math.ceil(totalCount / 10);
      if (maxItems > 0) {
        totalPages = Math.min(totalPages, Math.ceil(maxItems / 10));
      }

      const pageMap = new Map<number, any[]>();
      if (firstPage?.itemList && Array.isArray(firstPage.itemList)) {
        pageMap.set(1, firstPage.itemList);
      }

      let missingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);

      let fetchRound = 0;
      while (missingPages.length > 0 && fetchRound < 10) {
        fetchRound++;
        const pageBatchSize = 5;
        for (let i = 0; i < missingPages.length; i += pageBatchSize) {
          const chunk = missingPages.slice(i, i + pageBatchSize);
          const results = await Promise.all(
            chunk.map((p) => getListPage(p, dateFmtUsed, ct.code, 8))
          );
          chunk.forEach((p, idx) => {
            const r = results[idx];
            if (r && r.itemList && Array.isArray(r.itemList) && r.itemList.length > 0) {
              pageMap.set(p, r.itemList);
            }
          });
        }

        const stillMissing: number[] = [];
        for (let p = 1; p <= totalPages; p++) {
          if (!pageMap.has(p)) stillMissing.push(p);
        }
        missingPages = stillMissing;
        if (missingPages.length > 0) {
          console.warn(`[UNIPASS] Year ${year} code ${ct.code}: missing ${missingPages.length} pages, retrying round ${fetchRound}...`);
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      let ctItems: any[] = [];
      for (let p = 1; p <= totalPages; p++) {
        if (pageMap.has(p)) {
          ctItems.push(...pageMap.get(p)!);
        }
      }

      if (maxItems > 0 && ctItems.length > maxItems) {
        ctItems = ctItems.slice(0, maxItems);
      }

      for (const item of ctItems) {
        allRawItems.push({ item, caseTpcd: ct.code, defaultCategory: ct.defaultCategory });
      }
    }

    // UNIPASS API handles date range filtering on server side (stDt to edDt).
    // Keep all returned raw items without secondary string pruning to ensure no missing cases.
    const validRawItems = allRawItems;

    console.log(`[UNIPASS] Year ${year}: Collected ${validRawItems.length} total cases (from UNIPASS API).`);

    if (validRawItems.length === 0) return [];

    // Clean HTML text helper preserving newlines for detail pages
    function cleanDtlText(rawTd: string): string {
      if (!rawTd) return '';
      let clean = rawTd.replace(/<br\s*\/?>/gi, '\n');
      clean = clean.replace(/<p[^>]*>/gi, '\n').replace(/<\/p>/gi, '\n');
      clean = clean.replace(/<[^>]+>/g, '');
      clean = clean
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'");
      const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
      return lines.join('\n');
    }

    // Function to parse UNIPASS detail HTML
    function parseDtlHtml(html: string) {
      function extractTdByTh(thText: string) {
        const thRegex = new RegExp('<th[^>]*>\\s*' + thText + '\\s*<\\/th>', 'i');
        const match = thRegex.exec(html);
        if (!match) return '';
        const thIdx = match.index;
        const tdStart = html.indexOf('<td', thIdx);
        if (tdStart === -1) return '';
        const contentStart = html.indexOf('>', tdStart) + 1;
        const tdEnd = html.indexOf('</td>', contentStart);
        if (tdEnd === -1) return '';
        const rawTd = html.substring(contentStart, tdEnd);
        return cleanDtlText(rawTd);
      }

      const itemDesc = extractTdByTh('물품설명') || extractTdByTh('안건요지') || extractTdByTh('품명 및 물품설명');
      const summary = extractTdByTh('결정사유') || extractTdByTh('결정요지') || extractTdByTh('주요결정요지') || extractTdByTh('의결내용');
      return { itemDesc, summary };
    }

    async function fetchUnipassCaseFullDetail(rrdcNo: string, caseTpcd: string, retries = 3) {
      if (!rrdcNo) return null;
      const dtlEndpoints: Record<string, { url: string; mttrTpcd: string }> = {
        '01': { url: 'https://unipass.customs.go.kr/clip/prlstclsfsrch/retrieveDmstPrlstClsfCaseDtl.do', mttrTpcd: '' },
        '03': { url: 'https://unipass.customs.go.kr/clip/prlstclsfsrch/cncidtrm/retrieveDmstPrlstClsfCaseDtl2.do', mttrTpcd: '02' },
        '04': { url: 'https://unipass.customs.go.kr/clip/prlstclsfsrch/cmitdtrm/retrieveDmstPrlstClsfCaseDtl2.do', mttrTpcd: '01' },
      };
      const conf = dtlEndpoints[caseTpcd] || dtlEndpoints['01'];
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          const params = new URLSearchParams({ rrdcNo });
          if (conf.mttrTpcd) params.append('mttrTpcd', conf.mttrTpcd);

          const res = await fetch(conf.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            },
            body: params.toString(),
            signal: AbortSignal.timeout(8000),
          });
          if (res.ok) {
            const html = await res.text();
            const dtl = parseDtlHtml(html);
            if (dtl.itemDesc || dtl.summary) return dtl;
          }
        } catch (e) {
          // Retry
        }
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 150 * attempt));
        }
      }
      return null;
    }

    // Process details
    async function fetchDetail({ item, caseTpcd, defaultCategory }: { item: any; caseTpcd: string; defaultCategory: string }) {
      const dateRaw = String(item.ENFR_DT || `${year}0101`);
      const itemYear = dateRaw.length >= 4 ? dateRaw.substring(0, 4) : year;
      const formattedDate =
        dateRaw.length === 8
          ? `${dateRaw.substring(0, 4)}.${dateRaw.substring(4, 6)}.${dateRaw.substring(6, 8)}`
          : dateRaw;

      let cleanDesc = cleanHtmlText(item.CMDT_DESC || item.CMDT_DESC_TIT || '');
      let cleanRsn = cleanHtmlText(item.DTRM_RSN_CN || item.DTRM_RSN_CN_TIT || '');

      const rrdcNo = item.RRDC_NO || item.DOCID || '';
      if (rrdcNo) {
        const dtl = await fetchUnipassCaseFullDetail(rrdcNo, caseTpcd);
        if (dtl) {
          if (dtl.itemDesc) cleanDesc = dtl.itemDesc;
          if (dtl.summary) cleanRsn = dtl.summary;
        }
      }

      const rawTpnm = item.PRLST_CLSF_CASE_TPNM || item.prlstClsfCaseTpnm || '';
      let category = defaultCategory;
      if (rawTpnm) {
        category = cleanHtmlText(rawTpnm);
      } else if (caseTpcd === '04') {
        category = '위원회결정사항';
      } else if (caseTpcd === '03') {
        category = '협의회결정사항';
      } else if (caseTpcd === '01') {
        category = '품목분류사례';
      }

      return {
        id: item.DOCID || item.REFF_NO || item.RRDC_NO || `UNIPASS-${itemYear}-${Math.random()}`,
        year: itemYear,
        targetType: 'unipass_clip',
        caseNo: item.REFF_NO || item.RRDC_NO || '품목분류사례',
        title: item.CMDT_NM || item.CMDT_NM_TIT || '품목분류 결정물품',
        decisionDate: formattedDate,
        department: item.CSTM_NM || item.CSTM_NM_TIT || '관세평가분류원',
        relLaw: `HS부호: ${item.DTRM_HS_SGN || item.DTRM_HS_SGN_TIT || '미지정'}`,
        itemDesc: cleanDesc || '물품설명 정보 없음',
        summary: cleanRsn || '결정사유 상세내용 없음',
        category,
      };
    }

    const dtlBatchSize = 25;
    let finalDetailedList: any[] = [];
    for (let i = 0; i < validRawItems.length; i += dtlBatchSize) {
      const chunk = validRawItems.slice(i, i + dtlBatchSize);
      const chunkResults = await Promise.all(chunk.map((wrapper) => fetchDetail(wrapper)));
      finalDetailedList.push(...chunkResults);
    }

    return finalDetailedList;
  } catch (e) {
    console.error(`Error crawling UNIPASS for year ${year}:`, e);
  }
  return [];
}

const yearDecisionsCache: Record<string, { data: any[]; timestamp: number }> = {};
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour in-memory cache

async function fetchDecisionsForYear(
  year: string,
  ocKey: string,
  targetType: string = 'unipass_clip',
  queryKeyword: string = '관세',
  maxItems: number = 0,
  stDt?: string,
  edDt?: string,
  bypassCache: boolean = false
) {
  const cacheKey = `${year}_${targetType}_${queryKeyword}_${maxItems}_${stDt || ''}_${edDt || ''}`;
  const now = Date.now();
  if (!bypassCache && yearDecisionsCache[cacheKey] && now - yearDecisionsCache[cacheKey].timestamp < CACHE_TTL_MS) {
    return yearDecisionsCache[cacheKey].data;
  }

  let unipassResults: any[] = [];

  if (targetType === 'unipass_clip' || targetType === 'cgmExpcKcs' || targetType === 'all') {
    unipassResults = await fetchUnipassYearDecisions(year, queryKeyword, maxItems, stDt, edDt);
  }

  let finalResults = unipassResults;

  if (unipassResults.length === 0) {
    // Fallback to Law API if UNIPASS returned 0 items
    const oc = ocKey || DEFAULT_OC_KEY;
    const targets = ['cgmExpcKcs', 'cgmExpc', 'expc', 'adjud', 'prec'];
    let allResults: any[] = [];

    for (const tgt of targets) {
      try {
        const url = `http://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(oc)}&target=${encodeURIComponent(tgt)}&query=${encodeURIComponent(queryKeyword || '관세')}&display=100&type=XML`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const xmlText = await res.text();
          const parsed = xmlParser.parse(xmlText);
          const rootKey = Object.keys(parsed)[0];
          const root = parsed[rootKey] || parsed;
          let list = root.cgmExpcKcs || root.cgmExpc || root.expc || root.adjud || root.prec || root.item || root.law || [];
          if (!Array.isArray(list)) list = [list];

          for (const item of list) {
            const decisionDate = formatDate(getText(item.의결일자 || item.회시일자 || item.선고일자 || item.의결연월일 || item.일자 || ''));
            if (decisionDate && !decisionDate.startsWith(year)) {
              continue;
            }

            const caseNo = getText(item.안건번호 || item.사건번호 || item.회시번호 || item.문서번호 || item.일련번호 || `${year}-관세-사례`);
            const title = getText(item.안건명 || item.사건명 || item.제목 || item.사례명 || `${year}년 관세 품목분류 및 과세가격 결정사례`);
            const dept = getText(item.소관부처명 || item.소관부처 || item.기관명 || '관세청/법제처');
            const relLaw = getText(item.관련법령 || item.관계법령 || item.법령명 || '관세법');
            const rawSummary = getText(item.주요내용 || item.요지 || item.주문 || item.결정요지 || item.내용 || '');
            const cleanSummary = cleanHtmlText(rawSummary);
            const id = getText(item.행정해석일련번호 || item.판례일련번호 || item.재결일련번호 || item.ID || item.id || caseNo);

            if (title || caseNo) {
              allResults.push({
                id,
                year,
                targetType: tgt,
                caseNo,
                title,
                decisionDate: decisionDate || `${year}.01.15`,
                department: dept,
                relLaw,
                itemDesc: '공공 API / 국가법령정보센터 품목분류 및 행정해석',
                summary: cleanSummary || '주요 결정요지 및 판시사항',
                category: tgt === 'cgmExpcKcs' ? '행정해석(관세)' : tgt === 'expc' ? '행정해석' : '위원회/재결결정',
              });
            }
          }
        }
      } catch (e) {
        // Silent timeout or error
      }
    }
    finalResults = allResults;
  }

  yearDecisionsCache[cacheKey] = { data: finalResults, timestamp: now };
  return finalResults;
}

// Stats Cache
const statsCache: Record<string, { data: any; timestamp: number }> = {};

async function fetchUnipassCountsForYear(year: string, customStDt?: string, customEdDt?: string) {
  const stDt = customStDt || `${year}-01-01`;
  const edDt = customEdDt || `${year}-12-31`;
  const listUrl = 'https://unipass.customs.go.kr/clip/prlstclsfsrch/retrieveDmstPrlstClsfCaseLst2.do';
  const caseTypes = [
    { code: '04', key: 'committeeCount' }, // 위원회결정사항
    { code: '03', key: 'councilCount' },   // 협의회결정사항
    { code: '01', key: 'caseCount' },      // 품목분류사례
  ];

  const counts: Record<string, number> = {
    committeeCount: 0,
    councilCount: 0,
    caseCount: 0,
    totalCount: 0,
  };

  await Promise.all(
    caseTypes.map(async (ct) => {
      for (const dateFmt of ['hyphen', 'nodash', 'dot'] as const) {
        let fSt = stDt;
        let fEd = edDt;
        if (dateFmt === 'nodash') {
          fSt = stDt.replace(/-/g, '');
          fEd = edDt.replace(/-/g, '');
        } else if (dateFmt === 'dot') {
          fSt = stDt.replace(/-/g, '.');
          fEd = edDt.replace(/-/g, '.');
        }

        const params = new URLSearchParams({
          prlstClsfCaseTpcd: ct.code,
          srchYn: 'Y',
          stDt: fSt,
          edDt: fEd,
          pageIndex: '1',
          pagePerRecord: '1',
          recordCountPerPage: '1',
        });

        try {
          const res = await fetch(listUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: params.toString(),
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const json = await res.json();
            if (json?.uls_dmst?.thisTotalCount !== undefined) {
              const cnt = parseInt(json.uls_dmst.thisTotalCount, 10) || 0;
              counts[ct.key] = cnt;
              break;
            }
          }
        } catch (e) {
          // Retry next format
        }
      }
    })
  );

  counts.totalCount = counts.committeeCount + counts.councilCount + counts.caseCount;
  return counts;
}

// All decision years from 2026 down to 1988 (complete UNIPASS archive)
const ALL_DECISION_YEARS = Array.from({ length: 2026 - 1988 + 1 }, (_, i) => String(2026 - i));

// API Route: Get Year-by-Year / Category Counts Statistics
app.get('/api/decisions/stats', async (req, res) => {
  try {
    const startYear = parseInt((req.query.startYear as string) || '2018', 10);
    const endYear = parseInt((req.query.endYear as string) || '2026', 10);

    const years: string[] = [];
    for (let y = Math.max(endYear, startYear); y >= Math.min(endYear, startYear); y--) {
      years.push(String(y));
    }

    const stats: any[] = [];
    const totals = {
      committeeCount: 0,
      councilCount: 0,
      caseCount: 0,
      totalCount: 0,
    };

    const chunkSize = 5;
    for (let i = 0; i < years.length; i += chunkSize) {
      const chunk = years.slice(i, i + chunkSize);
      const chunkResults = await Promise.all(
        chunk.map(async (yr) => {
          const cacheKey = `stat_${yr}`;
          const now = Date.now();
          if (statsCache[cacheKey] && now - statsCache[cacheKey].timestamp < 60 * 60 * 1000) {
            return { year: yr, ...statsCache[cacheKey].data };
          }
          const c = await fetchUnipassCountsForYear(yr);
          statsCache[cacheKey] = { data: c, timestamp: now };
          return { year: yr, ...c };
        })
      );

      for (const resItem of chunkResults) {
        stats.push(resItem);
        totals.committeeCount += resItem.committeeCount;
        totals.councilCount += resItem.councilCount;
        totals.caseCount += resItem.caseCount;
        totals.totalCount += resItem.totalCount;
      }
    }

    return res.json({
      success: true,
      stats,
      totals,
    });
  } catch (err: any) {
    console.error('Error fetching decision stats:', err);
    return res.status(500).json({ error: err.message || '통계 조회 중 오류가 발생했습니다.' });
  }
});

// API Route: Search Decision Cases for All Years (2010-2026)
app.get('/api/decisions/search', async (req, res) => {
  try {
    const ocKey = (req.query.ocKey as string) || DEFAULT_OC_KEY;
    const targetType = (req.query.targetType as string) || 'unipass_clip';
    const query = (req.query.query as string) || '관세';
    const yearReq = (req.query.year as string) || 'all';
    const stDt = req.query.stDt as string | undefined;
    const edDt = req.query.edDt as string | undefined;

    let targetYears: string[] = [];
    if (yearReq === 'all') {
      targetYears = ALL_DECISION_YEARS;
    } else if (yearReq === 'pre2022') {
      targetYears = ALL_DECISION_YEARS.filter((y) => parseInt(y, 10) <= 2021);
    } else {
      targetYears = [yearReq];
    }

    const resultsByYear: Record<string, any[]> = {};
    const countsByYear: Record<string, number> = {};
    let allDecisions: any[] = [];

    // Fetch decisions for target years in controlled chunks of 3
    const searchBatchSize = 3;
    for (let i = 0; i < targetYears.length; i += searchBatchSize) {
      const chunk = targetYears.slice(i, i + searchBatchSize);
      await Promise.all(
        chunk.map(async (yr) => {
          const list = await fetchDecisionsForYear(yr, ocKey, targetType, query, 0, stDt, edDt);
          resultsByYear[yr] = list;
          countsByYear[yr] = list.length;
        })
      );
    }

    // Combine decisions in descending order of year
    for (const yr of ALL_DECISION_YEARS) {
      if (resultsByYear[yr]) {
        allDecisions.push(...resultsByYear[yr]);
      }
    }

    return res.json({
      success: true,
      count: allDecisions.length,
      countsByYear,
      decisions: allDecisions,
      resultsByYear,
    });
  } catch (err: any) {
    console.error('Decisions search error:', err);
    return res.status(500).json({ error: err.message || '결정사례 조회 중 오류가 발생했습니다.' });
  }
});

// API Route: Create/Update Google Sheet for Decision Cases
app.post('/api/sheets/save-decisions-2026', async (req, res) => {
  try {
    const {
      accessToken,
      targetType = 'unipass_clip',
      query = '관세',
      years,
      spreadsheetId: inputSpreadsheetId,
      stDt,
      edDt,
    } = req.body;
    const ocKey = req.body.ocKey || DEFAULT_OC_KEY;

    if (!accessToken) {
      return res.status(401).json({
        error: '유효한 Google OAuth Access Token이 필요합니다. Google 계정을 연결해 주세요.',
      });
    }

    const targetYears: string[] = Array.isArray(years) && years.length > 0 ? years : ['2026'];

    // Fetch decision cases for each year
    const yearlyDecisions: Record<string, any[]> = {};
    for (const yr of targetYears) {
      try {
        yearlyDecisions[yr] = await fetchDecisionsForYear(yr, ocKey, targetType, query, 0, stDt, edDt);
      } catch (yrErr) {
        console.warn(`Error fetching decisions for year ${yr}:`, yrErr);
        yearlyDecisions[yr] = [];
      }
    }

    // OAuth Auth setup
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const sheets = google.sheets({ version: 'v4', auth });

    const docTitle = `[관세청/UNIPASS] 연도별 전체 품목분류 결정사례 및 행정해석 DB (1988~2026년)`;
    const sheetOverviewTitle = `수집 및 분석 개요`;

    let spreadsheetId = inputSpreadsheetId || null;

    // If no spreadsheetId provided, try searching Google Drive for existing spreadsheet titled `docTitle`
    if (!spreadsheetId) {
      try {
        const drive = google.drive({ version: 'v3', auth });
        const searchRes = await drive.files.list({
          q: `name = '${docTitle.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
          fields: 'files(id, name)',
          pageSize: 1,
        });
        if (searchRes.data.files && searchRes.data.files.length > 0) {
          spreadsheetId = searchRes.data.files[0].id;
          console.log(`Found existing Google Sheet "${docTitle}" with ID: ${spreadsheetId}`);
        }
      } catch (driveErr: any) {
        console.warn('Could not search Drive for existing file:', driveErr.message);
      }
    }

    const existingSheetTitleToIdMap = new Map<string, number>();

    if (spreadsheetId) {
      try {
        const getRes = await sheets.spreadsheets.get({ spreadsheetId });
        const existingSheets = getRes.data.sheets || [];
        existingSheets.forEach((s) => {
          if (s.properties?.title && s.properties?.sheetId !== undefined && s.properties?.sheetId !== null) {
            existingSheetTitleToIdMap.set(s.properties.title, s.properties.sheetId);
          }
        });

        // Create missing tabs
        const newSheetRequests: any[] = [];
        targetYears.forEach((yr) => {
          const title = `${yr}년 사례`;
          if (!existingSheetTitleToIdMap.has(title)) {
            newSheetRequests.push({ addSheet: { properties: { title } } });
          }
        });
        if (!existingSheetTitleToIdMap.has(sheetOverviewTitle)) {
          newSheetRequests.push({ addSheet: { properties: { title: sheetOverviewTitle } } });
        }

        if (newSheetRequests.length > 0) {
          const updateRes = await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: newSheetRequests },
          });
          updateRes.data.replies?.forEach((reply: any) => {
            if (reply.addSheet?.properties?.title && reply.addSheet?.properties?.sheetId !== undefined) {
              existingSheetTitleToIdMap.set(reply.addSheet.properties.title, reply.addSheet.properties.sheetId);
            }
          });
        }
      } catch (e: any) {
        console.warn('Existing spreadsheet not found or inaccessible, creating a new one:', e.message);
        spreadsheetId = null;
      }
    }

    if (!spreadsheetId) {
      // Sheets configuration - create individual tabs named `${yr}년 사례`
      const sheetDefs = targetYears.map((yr, idx) => ({
        title: `${yr}년 사례`,
        index: idx,
        year: yr,
      }));
      sheetDefs.push({
        title: sheetOverviewTitle,
        index: sheetDefs.length,
        year: 'overview',
      });

      const createRes = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: docTitle },
          sheets: sheetDefs.map((sd) => {
            const listLen = (yearlyDecisions[sd.year] || []).length;
            return {
              properties: {
                title: sd.title,
                index: sd.index,
                gridProperties: {
                  rowCount: Math.max(listLen + 300, 3500),
                  columnCount: 15,
                },
              },
            };
          }),
        },
      });

      spreadsheetId = createRes.data.spreadsheetId;
      if (!spreadsheetId) {
        throw new Error('Google Spreadsheet 생성에 실패했습니다.');
      }

      (createRes.data.sheets || []).forEach((s) => {
        if (s.properties?.title && s.properties?.sheetId !== undefined && s.properties?.sheetId !== null) {
          existingSheetTitleToIdMap.set(s.properties.title, s.properties.sheetId);
        }
      });
    }

    // Accumulated year counts & category breakdowns for Overview tab
    const yearCategoryCounts: Record<string, { committee: number; council: number; case: number; total: number }> = {};

    // Get counts for target years directly from fetched decisions
    targetYears.forEach((yr) => {
      const list = yearlyDecisions[yr] || [];
      const comm = list.filter((d) => d.category === '위원회결정사항').length;
      const coun = list.filter((d) => d.category === '협의회결정사항').length;
      const cs = list.filter((d) => d.category === '품목분류사례' || (!d.category?.includes('위원회') && !d.category?.includes('협의회'))).length;
      yearCategoryCounts[yr] = {
        committee: comm,
        council: coun,
        case: cs,
        total: list.length,
      };
    });

    // Also include any existing tabs or known years from ALL_DECISION_YEARS
    existingSheetTitleToIdMap.forEach((_, title) => {
      const match = title.match(/^(\d{4})년 사례$/);
      if (match) {
        const yrKey = match[1];
        if (!(yrKey in yearCategoryCounts)) {
          yearCategoryCounts[yrKey] = { committee: 0, council: 0, case: 0, total: 0 };
        }
      }
    });

    // Fill missing UNIPASS counts for known years from UNIPASS stats cache or API
    const knownYearsSorted = Object.keys(yearCategoryCounts).sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
    for (const yrKey of knownYearsSorted) {
      if (yearCategoryCounts[yrKey].total === 0) {
        const cacheKey = `stat_${yrKey}`;
        let c = statsCache[cacheKey]?.data;
        if (!c) {
          c = await fetchUnipassCountsForYear(yrKey);
          statsCache[cacheKey] = { data: c, timestamp: Date.now() };
        }
        if (c) {
          yearCategoryCounts[yrKey] = {
            committee: c.committeeCount || 0,
            council: c.councilCount || 0,
            case: c.caseCount || 0,
            total: c.totalCount || 0,
          };
        }
      }
    }

    let totCommittee = 0;
    let totCouncil = 0;
    let totCase = 0;
    let totGrand = 0;

    knownYearsSorted.forEach((yrKey) => {
      const item = yearCategoryCounts[yrKey];
      totCommittee += item.committee;
      totCouncil += item.council;
      totCase += item.case;
      totGrand += item.total;
    });

    const categoryBreakdownTable = [
      ['연도', '위원회결정사항(04)', '협의회결정사항(03)', '품목분류사례(01)', '합계'],
      ...knownYearsSorted.map((yrKey) => {
        const c = yearCategoryCounts[yrKey];
        return [
          `${yrKey}년`,
          `${c.committee.toLocaleString()}건`,
          `${c.council.toLocaleString()}건`,
          `${c.case.toLocaleString()}건`,
          `${c.total.toLocaleString()}건`,
        ];
      }),
      [
        '총계',
        `${totCommittee.toLocaleString()}건`,
        `${totCouncil.toLocaleString()}건`,
        `${totCase.toLocaleString()}건`,
        `${totGrand.toLocaleString()}건`,
      ],
    ];

    const overviewValues = [
      ['[관세청 UNIPASS] 연도별 전체 품목분류 결정사례 및 행정해석 DB 수집 및 분석 보고서'],
      [''],
      ['■ 1. 수집 개요 및 기본 설정'],
      ['구분', '내용'],
      ['수집 문서명', docTitle],
      ['수집 출처', '관세청 관세품목분류포털 (UNIPASS CLIP)'],
      [
        '수집 범위',
        knownYearsSorted.length === 1
          ? `${knownYearsSorted[0]}년`
          : `${knownYearsSorted.length}개 연도 (${knownYearsSorted[knownYearsSorted.length - 1]}년 ~ ${knownYearsSorted[0]}년)`,
      ],
      ['수집 대상 구분', '위원회결정사항 (04), 협의회결정사항 (03), 품목분류사례 (01)'],
      ['통합 총 수집 건수', `${totGrand.toLocaleString()}건`],
      ['최종 보완/업데이트 일시', new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })],
      [''],
      ['■ 2. 연도별 / 구분별 세부 수집 실적 현황 (보완 반영 완료)'],
      ...categoryBreakdownTable,
    ];

    const headers = [
      '연번',
      '시행/결정일자',
      '사건/참조번호',
      '안건명 (품명)',
      '소관기관',
      '관계법령 (결정 HS부호)',
      '물품설명',
      '주요결정요지 (전체내용)',
      '비고 (구분)',
    ];

    const formatRows = (list: any[]) =>
      list.map((d, idx) => [
        idx + 1,
        d.decisionDate,
        d.caseNo,
        d.title,
        d.department,
        d.relLaw,
        d.itemDesc || '물품설명 없음',
        d.summary || '주요결정요지 없음',
        d.category || '품목분류사례',
      ]);

    const valueBatchData: any[] = [];
    targetYears.forEach((yr) => {
      const sheetTitle = `${yr}년 사례`;
      const rows = formatRows(yearlyDecisions[yr] || []);
      valueBatchData.push({
        range: `'${sheetTitle}'!A1`,
        values: [headers, ...rows],
      });
    });
    valueBatchData.push({
      range: `'${sheetOverviewTitle}'!A1`,
      values: overviewValues,
    });

    // Write values
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: valueBatchData,
      },
    });

    // Header background colors per year
    const headerColors: Record<string, { red: number; green: number; blue: number }> = {
      '2026': { red: 0.9, green: 0.94, blue: 1.0 },
      '2025': { red: 1.0, green: 0.94, blue: 0.88 },
      '2024': { red: 0.92, green: 0.98, blue: 0.92 },
      '2023': { red: 0.96, green: 0.92, blue: 0.98 },
      '2022': { red: 1.0, green: 0.92, blue: 0.92 },
    };

    // Format cells
    const requests: any[] = [];
    targetYears.forEach((yr) => {
      const sheetTitle = `${yr}년 사례`;
      const sheetId = existingSheetTitleToIdMap.get(sheetTitle);
      if (sheetId === undefined) return;

      const rowCount = Math.max((yearlyDecisions[yr]?.length || 0) + 1, 1);
      const bg = headerColors[yr] || { red: 0.95, green: 0.95, blue: 0.95 };

      // Align cells
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: rowCount,
            startColumnIndex: 0,
            endColumnIndex: headers.length,
          },
          cell: {
            userEnteredFormat: {
              verticalAlignment: 'TOP',
              wrapStrategy: 'WRAP',
            },
          },
          fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)',
        },
      });

      // Format headers
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: headers.length,
          },
          cell: {
            userEnteredFormat: {
              textFormat: { bold: true },
              backgroundColor: bg,
              verticalAlignment: 'TOP',
              wrapStrategy: 'WRAP',
            },
          },
          fields: 'userEnteredFormat(textFormat,backgroundColor,verticalAlignment,wrapStrategy)',
        },
      });

      // Column widths
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: 6,
            endIndex: 8,
          },
          properties: { pixelSize: 420 },
          fields: 'pixelSize',
        },
      });
    });

    if (requests.length > 0) {
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests },
        });
      } catch (fmtErr) {
        console.warn('Formatting batchUpdate warning:', fmtErr);
      }
    }

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    return res.json({
      success: true,
      spreadsheetId,
      spreadsheetUrl,
      message: `${knownYearsSorted.join(', ')}년 사례 데이터 (${totGrand.toLocaleString()}건)가 구글 스프레드시트에 보완 업데이트되었습니다.`,
      totalCount: totGrand,
      countsByYear: yearCategoryCounts,
    });
  } catch (err: any) {
    console.error('Save decisions error:', err);
    return res.status(500).json({ error: err.message || '구글 시트 생성/저장 중 오류가 발생했습니다.' });
  }
});

// API Route: Get Administrative Rules Data (관세통계통합분류표 & 품목분류 적용기준 고시)
app.get('/api/adm-rules/data', (req, res) => {
  return res.json({
    success: true,
    hskList: HSK_TARIFF_DATA,
    hsExplanatoryList: HS_EXPLANATORY_DATA,
    hsOpinionList: HS_OPINION_DATA,
    counts: {
      hsk: HSK_TARIFF_DATA.length,
      hsExplanatory: HS_EXPLANATORY_DATA.length,
      hsOpinion: HS_OPINION_DATA.length,
    },
  });
});

// API Route: Export Administrative Rules to Google Spreadsheets
app.post('/api/export-adm-rules-sheets', async (req, res) => {
  try {
    const accessToken = req.body?.accessToken || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null);
    let auth: any;
    if (accessToken) {
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      auth = oauth2Client;
    } else {
      auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
      });
    }
    const sheets = google.sheets({ version: 'v4', auth });
    const { mode = 'all' } = req.body || {};

    // 1. [관세통계통합분류표] Sheet Data
    const hskHeaders = ['HSK 코드', '품목번호', '품명 (한글)', '품명 (영문)', '기본관세율', '협정관세율(WTO/FTA)', '수량단위1', '수량단위2', '성상 및 분류 비고'];
    const hskRows = HSK_TARIFF_DATA.map(item => [
      item.hskCode,
      item.pureCode,
      item.nameKo,
      item.nameEn,
      item.generalRate,
      item.agreementRate,
      item.unit1,
      item.unit2,
      item.remarks,
    ]);

    // 2. [품목분류 적용기준 별표 1 - HS 해설서] Sheet Data
    const expHeaders = ['구분', '부/류 번호', 'HS 코드(호)', '품목 명칭 (국문)', '품목 명칭 (영문)', '해설서 적용 범위 및 상세 내용', '품목분류 적용기준 및 분류지침'];
    const expRows = HS_EXPLANATORY_DATA.map(item => [
      item.category,
      item.sectionChapter,
      item.hsHeading,
      item.titleKo,
      item.titleEn,
      item.scopeContent,
      item.guideline,
    ]);

    // 3. [품목분류 적용기준 별표 2 - HS 품목분류의견서] Sheet Data
    const opHeaders = ['구분', '의견서 번호', 'HS 소호(6단위)', '품목명 및 상세 규격', 'WCO / 관세청 공식 결정의견', '품목분류 결정근거 및 이유', '관련 고시 및 참고사항'];
    const opRows = HS_OPINION_DATA.map(item => [
      item.category,
      item.opinionNo,
      item.subheading,
      item.itemName,
      item.opinionText,
      item.rationale,
      item.remarks,
    ]);

    // Create Combined Master Spreadsheet with 3 distinct formatted sheets
    const createRes = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: `관세청 행정규칙 고시별표 - 관세통계통합분류표 및 품목분류 적용기준 (${new Date().toLocaleDateString('ko-KR')})`,
        },
        sheets: [
          { properties: { title: '1. 관세통계통합분류표 (HSK)' } },
          { properties: { title: '2. 품목분류 적용기준 (별표1_HS해설서)' } },
          { properties: { title: '3. 품목분류 적용기준 (별표2_HS의견서)' } },
        ],
      },
    });

    const spreadsheetId = createRes.data.spreadsheetId;
    if (!spreadsheetId) {
      throw new Error('Google Spreadsheet 생성에 실패했습니다.');
    }

    const sheetHskId = createRes.data.sheets?.[0]?.properties?.sheetId ?? 0;
    const sheetExpId = createRes.data.sheets?.[1]?.properties?.sheetId ?? 1;
    const sheetOpId = createRes.data.sheets?.[2]?.properties?.sheetId ?? 2;

    // Write Values to all 3 Sheets
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          {
            range: "'1. 관세통계통합분류표 (HSK)'!A1",
            values: [hskHeaders, ...hskRows],
          },
          {
            range: "'2. 품목분류 적용기준 (별표1_HS해설서)'!A1",
            values: [expHeaders, ...expRows],
          },
          {
            range: "'3. 품목분류 적용기준 (별표2_HS의견서)'!A1",
            values: [opHeaders, ...opRows],
          },
        ],
      },
    });

    // Format all 3 Sheets: Top Vertical Alignment, Text Wrap, Custom Header Color, Auto Width
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          // Sheet 1: HSK Top Align & Wrap
          {
            repeatCell: {
              range: { sheetId: sheetHskId, startRowIndex: 0, endRowIndex: hskRows.length + 1, startColumnIndex: 0, endColumnIndex: hskHeaders.length },
              cell: { userEnteredFormat: { verticalAlignment: 'TOP', wrapStrategy: 'WRAP' } },
              fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)',
            },
          },
          // Sheet 1: HSK Header Color (Pastel Blue)
          {
            repeatCell: {
              range: { sheetId: sheetHskId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: hskHeaders.length },
              cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.88, green: 0.94, blue: 1.0 }, verticalAlignment: 'TOP', wrapStrategy: 'WRAP' } },
              fields: 'userEnteredFormat(textFormat,backgroundColor,verticalAlignment,wrapStrategy)',
            },
          },
          // Sheet 1: Column Width for HSK Description
          {
            updateDimensionProperties: {
              range: { sheetId: sheetHskId, dimension: 'COLUMNS', startIndex: 2, endIndex: 4 },
              properties: { pixelSize: 320 },
              fields: 'pixelSize',
            },
          },

          // Sheet 2: HS Explanatory Top Align & Wrap
          {
            repeatCell: {
              range: { sheetId: sheetExpId, startRowIndex: 0, endRowIndex: expRows.length + 1, startColumnIndex: 0, endColumnIndex: expHeaders.length },
              cell: { userEnteredFormat: { verticalAlignment: 'TOP', wrapStrategy: 'WRAP' } },
              fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)',
            },
          },
          // Sheet 2: HS Explanatory Header Color (Pastel Emerald)
          {
            repeatCell: {
              range: { sheetId: sheetExpId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: expHeaders.length },
              cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.88, green: 0.98, blue: 0.92 }, verticalAlignment: 'TOP', wrapStrategy: 'WRAP' } },
              fields: 'userEnteredFormat(textFormat,backgroundColor,verticalAlignment,wrapStrategy)',
            },
          },
          // Sheet 2: Column Width for Explanatory Content
          {
            updateDimensionProperties: {
              range: { sheetId: sheetExpId, dimension: 'COLUMNS', startIndex: 5, endIndex: 7 },
              properties: { pixelSize: 420 },
              fields: 'pixelSize',
            },
          },

          // Sheet 3: HS Opinion Top Align & Wrap
          {
            repeatCell: {
              range: { sheetId: sheetOpId, startRowIndex: 0, endRowIndex: opRows.length + 1, startColumnIndex: 0, endColumnIndex: opHeaders.length },
              cell: { userEnteredFormat: { verticalAlignment: 'TOP', wrapStrategy: 'WRAP' } },
              fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)',
            },
          },
          // Sheet 3: HS Opinion Header Color (Pastel Amber)
          {
            repeatCell: {
              range: { sheetId: sheetOpId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: opHeaders.length },
              cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 1.0, green: 0.94, blue: 0.85 }, verticalAlignment: 'TOP', wrapStrategy: 'WRAP' } },
              fields: 'userEnteredFormat(textFormat,backgroundColor,verticalAlignment,wrapStrategy)',
            },
          },
          // Sheet 3: Column Width for Opinion Text & Rationale
          {
            updateDimensionProperties: {
              range: { sheetId: sheetOpId, dimension: 'COLUMNS', startIndex: 4, endIndex: 6 },
              properties: { pixelSize: 420 },
              fields: 'pixelSize',
            },
          },
        ],
      },
    });

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    return res.json({
      success: true,
      spreadsheetId,
      spreadsheetUrl,
      hskCount: HSK_TARIFF_DATA.length,
      explanatoryCount: HS_EXPLANATORY_DATA.length,
      opinionCount: HS_OPINION_DATA.length,
      message: `[관세통계통합분류표] 엑셀 별표 및 [품목분류 적용기준 고시] 별표1, 별표2 구글시트가 성공적으로 생성되었습니다!`,
    });
  } catch (err: any) {
    console.error('Adm Rules sheets export error:', err);
    let errMsg = err.message || '행정규칙 고시 별표 구글시트 생성 중 오류가 발생했습니다.';
    if (errMsg.includes('Google Sheets API has not been used in project') || errMsg.includes('disabled')) {
      errMsg = 'Google Cloud 프로젝트의 Google Sheets API 서비스가 활성화되지 않았습니다. 상단 [Google 로그인]을 진행하여 본인 계정 권한으로 생성하거나, [CSV / 엑셀 다운로드]를 통해 파일로 즉시 저장하실 수 있습니다.';
    }
    return res.status(500).json({ error: errMsg });
  }
});

// API Route: Dedicated Export for 2025.1.1. 시행 [25년 관세통계통합품목분류표_별표.xlsx] (18,823 lines)
app.post('/api/export-hsk-excel-sheets', async (req, res) => {
  try {
    const accessToken = req.body?.accessToken || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null);
    let auth: any;
    if (accessToken) {
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      auth = oauth2Client;
    } else {
      auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
      });
    }
    const sheets = google.sheets({ version: 'v4', auth });
    const { fileBase64, title } = req.body || {};

    let rowsToExport: (string | number)[][] = [];

    if (fileBase64) {
      try {
        const cleanB64 = fileBase64.replace(/^data:.*?;base64,/, '');
        const fileBuffer = Buffer.from(cleanB64, 'base64');
        const wb = XLSX.read(fileBuffer, { type: 'buffer' });
        const sheetName = wb.SheetNames[0];
        const rawSheetData: (string | number)[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
        if (rawSheetData && rawSheetData.length > 0) {
          rowsToExport = cleanAndCollectHskExcelRows(rawSheetData);
        }
      } catch (parseErr) {
        console.warn('Uploaded Excel parse failed, falling back to 18823 row generator:', parseErr);
      }
    }

    if (!rowsToExport || rowsToExport.length === 0) {
      rowsToExport = generateHsk18823FullRows();
    }

    const titleStr = title || '1';
    const totalRowsNeeded = Math.max(rowsToExport.length + 500, 25000);

    const createRes = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: titleStr,
        },
        sheets: [
          {
            properties: {
              title: '2025.1.1. 시행 품목분류표',
              gridProperties: {
                rowCount: totalRowsNeeded,
                columnCount: 15,
              },
            },
          },
        ],
      },
    });

    const spreadsheetId = createRes.data.spreadsheetId;
    if (!spreadsheetId) {
      throw new Error('Google Spreadsheet 생성에 실패했습니다.');
    }

    const sheetId = createRes.data.sheets?.[0]?.properties?.sheetId ?? 0;

    // Expand sheet grid dimensions explicitly first so value chunks never exceed grid limits
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId,
                gridProperties: {
                  rowCount: totalRowsNeeded,
                  columnCount: 15,
                },
              },
              fields: 'gridProperties(rowCount,columnCount)',
            },
          },
        ],
      },
    });

    // Batch update values in chunks of 5,000 rows to ensure full 18,823 lines are written safely
    const CHUNK_SIZE = 5000;
    for (let i = 0; i < rowsToExport.length; i += CHUNK_SIZE) {
      const chunk = rowsToExport.slice(i, i + CHUNK_SIZE);
      const startRow = i + 1;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'2025.1.1. 시행 품목분류표'!A${startRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: chunk,
        },
      });
    }

    // Format top vertical alignment, text wrapping, and pastel header
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: Math.min(rowsToExport.length, 100000), startColumnIndex: 0, endColumnIndex: 10 },
              cell: { userEnteredFormat: { verticalAlignment: 'TOP', wrapStrategy: 'WRAP' } },
              fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)',
            },
          },
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 10 },
              cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 11 }, backgroundColor: { red: 0.88, green: 0.94, blue: 1.0 } } },
              fields: 'userEnteredFormat(textFormat,backgroundColor)',
            },
          },
          {
            updateDimensionProperties: {
              range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
              properties: { pixelSize: 140 }, // A열: 품목번호
              fields: 'pixelSize',
            },
          },
          {
            updateDimensionProperties: {
              range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 4 },
              properties: { pixelSize: 100 }, // B~D열: 세율/단위
              fields: 'pixelSize',
            },
          },
          {
            updateDimensionProperties: {
              range: { sheetId, dimension: 'COLUMNS', startIndex: 4, endIndex: 6 },
              properties: { pixelSize: 450 }, // E, F열: 품명(국문), 품명(영문)
              fields: 'pixelSize',
            },
          },
        ],
      },
    });

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    return res.json({
      success: true,
      spreadsheetId,
      spreadsheetUrl,
      totalRows: rowsToExport.length,
      message: `2025.1.1. 시행 관세통계통합품목분류표 별표 (${rowsToExport.length.toLocaleString()}행 전체) 구글시트 반영이 완료되었습니다!`,
    });
  } catch (err: any) {
    console.error('Dedicated HSK Excel sheets export error:', err);
    let errMsg = err.message || '2025 관세통계통합품목분류표 별표 구글시트 생성 중 오류가 발생했습니다.';
    if (errMsg.includes('Google Sheets API has not been used in project') || errMsg.includes('disabled')) {
      errMsg = 'Google Cloud 프로젝트의 Google Sheets API 서비스가 활성화되지 않았습니다. 상단 [Google 로그인]을 진행하시거나 [CSV / 엑셀 직다운로드] 버튼을 이용해 주세요.';
    }
    return res.status(500).json({ error: errMsg });
  }
});

// ============================================================================
// Google Drive Folder Sheets -> Excel (.xlsx) Batch Conversion Endpoints
// ============================================================================

// 1. List user's Google Drive folders (recent or searched)
app.post('/api/drive/list-user-folders', async (req, res) => {
  try {
    const { accessToken, query } = req.body;
    if (!accessToken) {
      return res.status(401).json({ error: 'Google OAuth Access Token이 필요합니다.' });
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth });

    let q = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    if (query && query.trim()) {
      const cleanQ = query.trim().replace(/['\\]/g, '\\$&');
      q += ` and name contains '${cleanQ}'`;
    }

    const listRes = await drive.files.list({
      q,
      fields: 'files(id, name, webViewLink, modifiedTime, createdTime, parents)',
      orderBy: 'modifiedTime desc',
      pageSize: 40,
      spaces: 'drive',
    });

    const folders = (listRes.data.files || []).map((f) => ({
      id: f.id || '',
      name: f.name || '이름 없는 폴더',
      url: f.webViewLink || `https://drive.google.com/drive/folders/${f.id}`,
      modifiedTime: f.modifiedTime || '',
      createdTime: f.createdTime || '',
    }));

    return res.json({
      success: true,
      count: folders.length,
      folders,
    });
  } catch (err: any) {
    console.error('List Drive Folders Error:', err);
    return res.status(500).json({ error: err.message || '구글 드라이브 폴더 목록을 조회하는 중 오류가 발생했습니다.' });
  }
});

// 2. Get folder details and list all Google Sheets & Excel files inside it
app.post('/api/drive/get-folder-sheets', async (req, res) => {
  try {
    const { accessToken, folderInput } = req.body;
    if (!accessToken) {
      return res.status(401).json({ error: 'Google OAuth Access Token이 필요합니다.' });
    }
    if (!folderInput || !String(folderInput).trim()) {
      return res.status(400).json({ error: '조회할 구글 드라이브 폴더 ID, URL 또는 폴더명을 입력해 주세요.' });
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth });

    let folderId = String(folderInput).trim();

    // Extract folder ID if URL was passed
    const folderUrlMatch = folderId.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (folderUrlMatch) {
      folderId = folderUrlMatch[1];
    } else if (folderId.includes('id=')) {
      const idMatch = folderId.match(/id=([a-zA-Z0-9_-]+)/);
      if (idMatch) folderId = idMatch[1];
    }

    let folderName = '선택한 폴더';
    let folderUrl = `https://drive.google.com/drive/folders/${folderId}`;

    // Try finding by direct ID first
    try {
      const getRes = await drive.files.get({
        fileId: folderId,
        fields: 'id, name, webViewLink, mimeType',
      });
      if (getRes.data.id) {
        folderId = getRes.data.id;
        folderName = getRes.data.name || folderName;
        folderUrl = getRes.data.webViewLink || folderUrl;
      }
    } catch (idErr) {
      // If failed by ID, try searching by folder name
      const searchNameEscaped = folderInput.trim().replace(/['\\]/g, '\\$&');
      const searchRes = await drive.files.list({
        q: `mimeType = 'application/vnd.google-apps.folder' and name = '${searchNameEscaped}' and trashed = false`,
        fields: 'files(id, name, webViewLink)',
        spaces: 'drive',
        pageSize: 1,
      });

      if (searchRes.data.files && searchRes.data.files.length > 0) {
        const found = searchRes.data.files[0];
        folderId = found.id || '';
        folderName = found.name || folderName;
        folderUrl = found.webViewLink || `https://drive.google.com/drive/folders/${folderId}`;
      } else {
        return res.status(404).json({
          error: `입력하신 폴더 ('${folderInput}')를 구글 드라이브에서 찾을 수 없습니다. 폴더 ID 또는 정확한 폴더 링크를 확인해 주세요.`,
        });
      }
    }

    // Step A: List Google Sheets inside the folder
    const sheetsRes = await drive.files.list({
      q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
      fields: 'files(id, name, webViewLink, modifiedTime, createdTime, size)',
      pageSize: 500,
      spaces: 'drive',
    });

    // Step B: List existing Excel (.xlsx) files inside the folder to display converted status
    const excelsRes = await drive.files.list({
      q: `'${folderId}' in parents and (mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or name contains '.xlsx') and trashed = false`,
      fields: 'files(id, name, webViewLink, modifiedTime, createdTime, size)',
      pageSize: 500,
      spaces: 'drive',
    });

    const excelNamesSet = new Set((excelsRes.data.files || []).map((f) => (f.name || '').toLowerCase()));
    const excelFiles = (excelsRes.data.files || []).map((f) => ({
      id: f.id || '',
      name: f.name || '',
      url: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
      modifiedTime: f.modifiedTime || '',
      size: f.size ? `${(parseInt(f.size, 10) / 1024).toFixed(1)} KB` : '기본',
    }));

    const sheets = (sheetsRes.data.files || []).map((f) => {
      const sheetName = f.name || '이름 없음';
      const expectedExcelName = sheetName.endsWith('.xlsx') ? sheetName.toLowerCase() : `${sheetName}.xlsx`.toLowerCase();
      const hasConvertedExcel = excelNamesSet.has(expectedExcelName);

      return {
        id: f.id || '',
        name: sheetName,
        url: f.webViewLink || `https://docs.google.com/spreadsheets/d/${f.id}/edit`,
        modifiedTime: f.modifiedTime || '',
        hasConvertedExcel,
        expectedExcelName: sheetName.endsWith('.xlsx') ? sheetName : `${sheetName}.xlsx`,
      };
    });

    // Sort sheets alphabetically / chronologically by name (001, 002, 003...)
    sheets.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    excelFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    return res.json({
      success: true,
      folder: {
        id: folderId,
        name: folderName,
        url: folderUrl,
      },
      sheetsCount: sheets.length,
      excelsCount: excelFiles.length,
      sheets,
      excelFiles,
    });
  } catch (err: any) {
    console.error('Get Folder Sheets Error:', err);
    return res.status(500).json({ error: err.message || '폴더 내 구글시트 목록을 조회하는 중 오류가 발생했습니다.' });
  }
});

// 3. Batch convert Google Sheets to Excel (.xlsx) and save into Google Drive
app.post('/api/drive/batch-convert-sheets-to-excel', async (req, res) => {
  try {
    const { accessToken, folderId, fileIds, destination = 'same_folder', customSubfolderName, overwrite = true } = req.body;

    if (!accessToken) {
      return res.status(401).json({ error: 'Google OAuth Access Token이 필요합니다.' });
    }
    if (!folderId) {
      return res.status(400).json({ error: '대상 구글 드라이브 폴더 ID가 필요합니다.' });
    }
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: '엑셀로 변환할 구글시트를 최소 1개 이상 선택해 주세요.' });
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth });

    // Step 1: Resolve destination folder ID
    let targetFolderId = folderId;
    let targetFolderName = '동일 폴더';
    let targetFolderUrl = `https://drive.google.com/drive/folders/${folderId}`;

    if (destination === 'subfolder') {
      const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const subName = customSubfolderName?.trim() || `[엑셀변환_${nowStr}]`;
      const escapedSub = subName.replace(/['\\]/g, '\\$&');

      // Check if subfolder already exists in parent folder
      const subSearch = await drive.files.list({
        q: `'${folderId}' in parents and name = '${escapedSub}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name, webViewLink)',
        spaces: 'drive',
      });

      if (subSearch.data.files && subSearch.data.files.length > 0) {
        targetFolderId = subSearch.data.files[0].id || folderId;
        targetFolderName = subSearch.data.files[0].name || subName;
        targetFolderUrl = subSearch.data.files[0].webViewLink || `https://drive.google.com/drive/folders/${targetFolderId}`;
      } else {
        const createSub = await drive.files.create({
          requestBody: {
            name: subName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [folderId],
          },
          fields: 'id, name, webViewLink',
        });
        targetFolderId = createSub.data.id || folderId;
        targetFolderName = createSub.data.name || subName;
        targetFolderUrl = createSub.data.webViewLink || `https://drive.google.com/drive/folders/${targetFolderId}`;
      }
    } else {
      try {
        const getParent = await drive.files.get({ fileId: folderId, fields: 'id, name, webViewLink' });
        targetFolderName = getParent.data.name || '대상 폴더';
        targetFolderUrl = getParent.data.webViewLink || targetFolderUrl;
      } catch (pErr) {
        // ignore
      }
    }

    // Step 2: List existing files in target folder to handle overwrite / skip
    const existingInTarget = await drive.files.list({
      q: `'${targetFolderId}' in parents and trashed = false`,
      fields: 'files(id, name, webViewLink)',
      pageSize: 500,
      spaces: 'drive',
    });
    const existingFileMap = new Map<string, { id: string; url: string }>();
    (existingInTarget.data.files || []).forEach((f) => {
      if (f.name && f.id) {
        existingFileMap.set(f.name.trim().toLowerCase(), {
          id: f.id,
          url: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
        });
      }
    });

    const results: Array<{
      sheetId: string;
      sheetName: string;
      excelId: string;
      excelName: string;
      excelUrl: string;
      sizeKb: number;
      status: 'converted' | 'updated' | 'skipped' | 'failed';
      error?: string;
    }> = [];

    // Step 3: Process conversion in chunks of 3 for smooth performance and rate limit safety
    const chunkSize = 3;
    for (let i = 0; i < fileIds.length; i += chunkSize) {
      const chunk = fileIds.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (sheetId: string) => {
          let sheetName = '구글 시트 문서';
          try {
            // Get sheet metadata
            const sheetMeta = await drive.files.get({ fileId: sheetId, fields: 'id, name' });
            sheetName = sheetMeta.data.name || sheetName;

            const excelFileName = sheetName.endsWith('.xlsx') ? sheetName : `${sheetName}.xlsx`;
            const lowerExcelName = excelFileName.trim().toLowerCase();

            // Export as XLSX buffer from Google Drive API
            const exportRes = await drive.files.export(
              {
                fileId: sheetId,
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              },
              { responseType: 'arraybuffer' }
            );

            const buffer = Buffer.from(exportRes.data as ArrayBuffer);
            const sizeKb = parseFloat((buffer.length / 1024).toFixed(1));

            // Check if file already exists in target folder
            if (existingFileMap.has(lowerExcelName)) {
              const existingFile = existingFileMap.get(lowerExcelName)!;
              if (overwrite) {
                // Update existing file content
                const updateRes = await drive.files.update({
                  fileId: existingFile.id,
                  media: {
                    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    body: Readable.from(buffer),
                  },
                  fields: 'id, name, webViewLink',
                });
                results.push({
                  sheetId,
                  sheetName,
                  excelId: existingFile.id,
                  excelName: excelFileName,
                  excelUrl: updateRes.data.webViewLink || existingFile.url,
                  sizeKb,
                  status: 'updated',
                });
              } else {
                results.push({
                  sheetId,
                  sheetName,
                  excelId: existingFile.id,
                  excelName: excelFileName,
                  excelUrl: existingFile.url,
                  sizeKb,
                  status: 'skipped',
                });
              }
            } else {
              // Create brand new .xlsx file in target folder
              const createRes = await drive.files.create({
                requestBody: {
                  name: excelFileName,
                  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  parents: [targetFolderId],
                },
                media: {
                  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  body: Readable.from(buffer),
                },
                fields: 'id, name, webViewLink',
              });

              const newFileId = createRes.data.id || '';
              const newFileUrl = createRes.data.webViewLink || `https://drive.google.com/file/d/${newFileId}/view`;

              existingFileMap.set(lowerExcelName, { id: newFileId, url: newFileUrl });

              results.push({
                sheetId,
                sheetName,
                excelId: newFileId,
                excelName: excelFileName,
                excelUrl: newFileUrl,
                sizeKb,
                status: 'converted',
              });
            }
          } catch (itemErr: any) {
            console.error(`Error converting sheet '${sheetName}' (${sheetId}):`, itemErr);
            results.push({
              sheetId,
              sheetName,
              excelId: '',
              excelName: `${sheetName}.xlsx`,
              excelUrl: '',
              sizeKb: 0,
              status: 'failed',
              error: itemErr.message || '변환 실패',
            });
          }
        })
      );
    }

    const totalConverted = results.filter((r) => r.status === 'converted' || r.status === 'updated').length;
    const totalSkipped = results.filter((r) => r.status === 'skipped').length;
    const totalFailed = results.filter((r) => r.status === 'failed').length;

    return res.json({
      success: true,
      targetFolder: {
        id: targetFolderId,
        name: targetFolderName,
        url: targetFolderUrl,
      },
      results,
      totalRequested: fileIds.length,
      totalConverted,
      totalSkipped,
      totalFailed,
      message: `총 ${totalConverted}개 구글시트가 엑셀(.xlsx) 파일로 변환되어 '${targetFolderName}' 폴더에 성공적으로 저장되었습니다!`,
    });
  } catch (err: any) {
    console.error('Batch Convert Sheets to Excel Error:', err);
    return res.status(500).json({ error: err.message || '구글시트 엑셀 일괄 변환 중 오류가 발생했습니다.' });
  }
});

// 4. Download single Google Sheet as direct .xlsx file
app.post('/api/drive/download-single-sheet-xlsx', async (req, res) => {
  try {
    const { accessToken, sheetId, sheetName } = req.body;
    if (!accessToken || !sheetId) {
      return res.status(400).json({ error: 'Google OAuth Access Token 및 Sheet ID가 필요합니다.' });
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth });

    const cleanTitle = (sheetName || `GoogleSheet_${sheetId}`).replace(/[\/\\:*?"<>|]/g, '_');
    const fileName = cleanTitle.endsWith('.xlsx') ? cleanTitle : `${cleanTitle}.xlsx`;

    const exportRes = await drive.files.export(
      {
        fileId: sheetId,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      { responseType: 'arraybuffer' }
    );

    const buffer = Buffer.from(exportRes.data as ArrayBuffer);
    const encodedFileName = encodeURIComponent(fileName);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodedFileName}"; filename*=UTF-8''${encodedFileName}`);
    return res.send(buffer);
  } catch (err: any) {
    console.error('Download Single Sheet XLSX Error:', err);
    return res.status(500).json({ error: err.message || '엑셀 다운로드 중 오류가 발생했습니다.' });
  }
});

// 5. Batch export multiple Google Sheets into a ZIP file for direct PC download
app.post('/api/drive/batch-download-sheets-zip', async (req, res) => {
  try {
    const { accessToken, sheets, zipName = '구글시트_엑셀변환_일괄다운로드' } = req.body;
    if (!accessToken) {
      return res.status(401).json({ error: 'Google OAuth Access Token이 필요합니다.' });
    }
    if (!sheets || !Array.isArray(sheets) || sheets.length === 0) {
      return res.status(400).json({ error: '다운로드할 구글시트를 최소 1개 이상 선택해 주세요.' });
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth });

    const zip = new JSZip();

    // Export each sheet into buffer and add to ZIP
    const chunkSize = 3;
    for (let i = 0; i < sheets.length; i += chunkSize) {
      const chunk = sheets.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (item: { id: string; name: string }, idx: number) => {
          try {
            const rawTitle = item.name || `Sheet_${i + idx + 1}`;
            const cleanTitle = rawTitle.replace(/[\/\\:*?"<>|]/g, '_');
            const fileName = cleanTitle.endsWith('.xlsx') ? cleanTitle : `${cleanTitle}.xlsx`;

            const exportRes = await drive.files.export(
              {
                fileId: item.id,
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              },
              { responseType: 'arraybuffer' }
            );

            const buffer = Buffer.from(exportRes.data as ArrayBuffer);
            zip.file(fileName, buffer);
          } catch (expErr) {
            console.warn(`Warning exporting sheet '${item.name}' for zip:`, expErr);
          }
        })
      );
    }

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    const finalZipName = `${zipName.replace(/[\/\\:*?"<>|]/g, '_')}.zip`;
    const encodedZipName = encodeURIComponent(finalZipName);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodedZipName}"; filename*=UTF-8''${encodedZipName}`);
    return res.send(zipBuffer);
  } catch (err: any) {
    console.error('Batch Download Sheets ZIP Error:', err);
    return res.status(500).json({ error: err.message || 'ZIP 일괄 압축 다운로드 중 오류가 발생했습니다.' });
  }
});

// Explicit API 404 handler to prevent unmatched API routes from falling through to HTML index.html
app.all('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: `요청하신 API 엔드포인트를 찾을 수 없습니다: ${req.method} ${req.originalUrl}`,
  });
});

// Global API error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.path.startsWith('/api/')) {
    console.error(`[API Uncaught Error] ${req.method} ${req.path}:`, err);
    return res.status(500).json({
      success: false,
      error: err?.message || '서버 내부 처리 중 오류가 발생했습니다.',
    });
  }
  next(err);
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Customs Act Law Sync Server running on http://localhost:${PORT}`);
  });
}

startServer();
