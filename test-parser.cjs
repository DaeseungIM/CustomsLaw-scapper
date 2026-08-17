const { XMLParser } = require('fast-xml-parser');

async function test() {
  const url = 'http://www.law.go.kr/DRF/lawService.do?OC=ceiai_law_test&target=admrul&ID=2100000281984&type=XML';
  const r = await fetch(url);
  const t = await r.text();
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  const p = parser.parse(t);
  const root = p.AdmRulService || p.admRulService || p.행정규칙 || p;
  const rawText = root.조문내용 || '';

  // 1. Let's see what happens if we find all structural headings and articles.
  // Look at 외국환거래규정:
  // Every article starts with: 제\s*(\d+(?:-\d+)*(?:의\d+)?)\s*조(?:의\d+)?\s*\(([^)]+)\)
  // Let's capture the whole structure!
  
  // Notice in 외국환거래규정:
  // The Chapter is directly encoded in the article number:
  // e.g. 제1-1조 -> Chapter 1 (총칙)
  // e.g. 제2-1조 -> Chapter 2 (외국환업무취급기관 등)
  // e.g. 제3-1조 -> Chapter 3 (지급기관등)
  // e.g. 제4-1조 -> Chapter 4 (지급등의 절차)
  // e.g. 제5-1조 -> Chapter 5 (지급등의 방법)
  // e.g. 제6-1조 -> Chapter 6 (대외지급수단등의 수출입)
  // e.g. 제7-1조 -> Chapter 7 (자본거래)
  // e.g. 제8-1조 -> Chapter 8 (현지금융)
  // e.g. 제9-1조 -> Chapter 9 (직접투자 및 부동산취득 등)
  // e.g. 제10-1조 -> Chapter 10 (보칙)

  // Also let's extract the actual Chapter, Section, Subsection names directly from the text before each article!
  
  const artMatches = [...rawText.matchAll(/제\s*(\d+(?:-\d+)*(?:의\d+)?)\s*조(?:의\d+)?\s*\(([^)]+)\)/g)];
  console.log('Total articles found:', artMatches.length);

  // Let's also extract all Chapter definitions from the text:
  // e.g. "제1장 총칙", "제2장 외국환업무취급기관 등", "제3장 지급기관등", ...
  const chapterDict = {};
  const chDefMatches = [...rawText.matchAll(/(?:^|\n|\s|규정|조문|부칙)(제\s*(\d+)\s*장\s+([^\n제부]+?))(?=제\s*\d+\s*(?:절|관|조|-)|부\s*칙|\n|$)/g)];
  chDefMatches.forEach(m => {
    const chNum = parseInt(m[2], 10);
    const chTitle = m[3].trim();
    // Filter out false positives that contain citation words like "내지", "부터", "의한", "규정"
    if (!chTitle.includes('내지') && !chTitle.includes('부터') && !chTitle.includes('의한') && !chTitle.includes('따라') && !chTitle.includes('준용')) {
      chapterDict[chNum] = `제${chNum}장 ${chTitle}`;
    }
  });

  console.log('Detected Chapter Dictionary:', chapterDict);

  // Also fallback chapter map for 외국환거래규정:
  const foreignExchangeChapters = {
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

  // Section dictionary:
  const secDefMatches = [...rawText.matchAll(/(?:^|\n|\s)(제\s*(\d+)\s*절\s+([^\n제부]+?))(?=제\s*\d+\s*(?:관|조|-)|부\s*칙|\n|$)/g)];
  const detectedSections = secDefMatches.map(m => ({
    index: m.index,
    secNum: m[2],
    secText: `제${m[2]}절 ${m[3].trim()}`
  })).filter(s => !s.secText.includes('내지') && !s.secText.includes('부터') && !s.secText.includes('의한'));

  console.log('Detected Sections count:', detectedSections.length);

  let curChapter = chapterDict[1] || '제1장 총칙';
  let curSection = '';
  let curSubsection = '';

  const parsedArticles = [];

  for (let i = 0; i < artMatches.length; i++) {
    const match = artMatches[i];
    const rawNo = match[1].replace(/\s+/g, '');
    const title = match[2].trim();
    const artStart = match.index;
    const nextArtStart = (i + 1 < artMatches.length) ? artMatches[i + 1].index : rawText.length;

    // Full article block
    let artBlock = rawText.slice(artStart, nextArtStart).trim();

    // Determine Chapter:
    // If article number has format "X-Y", then X is chapter number (e.g. 2-7조 -> 2 -> 제2장 외국환업무취급기관 등)
    let chNum = 1;
    if (rawNo.includes('-')) {
      const parts = rawNo.split('-');
      chNum = parseInt(parts[0], 10);
    } else {
      const singleNum = parseInt(rawNo, 10);
      if (singleNum > 0 && singleNum < 20) chNum = singleNum;
    }

    if (chapterDict[chNum]) {
      curChapter = chapterDict[chNum];
    } else if (foreignExchangeChapters[chNum]) {
      curChapter = foreignExchangeChapters[chNum];
    }

    // Determine Section based on location or prefix:
    const precedingText = i === 0 ? rawText.slice(0, artStart) : rawText.slice(artMatches[i - 1].index, artStart);
    const secMatch = precedingText.match(/(?:^|\n|\s)(제\s*(\d+)\s*절\s+([^\n제부]+?))(?=제\s*\d+\s*(?:관|조|-)|부\s*칙|\n|$)/);
    if (secMatch) {
      const sTitle = secMatch[3].trim();
      if (!sTitle.includes('내지') && !sTitle.includes('부터') && !sTitle.includes('의한') && !sTitle.includes('따라')) {
        curSection = `제${secMatch[2]}절 ${sTitle}`;
        curSubsection = '';
      }
    }

    // Determine Subsection (관)
    const subMatch = precedingText.match(/(?:^|\n|\s)(제\s*(\d+)\s*관\s+([^\n제부]+?))(?=제\s*\d+\s*(?:조|-)|부\s*칙|\n|$)/);
    if (subMatch) {
      const subTitle = subMatch[3].trim();
      if (!subTitle.includes('내지') && !subTitle.includes('부터')) {
        curSubsection = `제${subMatch[2]}관 ${subTitle}`;
      }
    }

    // Reconstruct proper article No (e.g. 제2-7조의2)
    let fullArtNo = `제${rawNo}조`;
    if (match[0].includes('조의')) {
      const uiMatch = match[0].match(/조의\s*(\d+)/);
      if (uiMatch) fullArtNo += `의${uiMatch[1]}`;
    }

    parsedArticles.push({
      row: i + 1,
      chapter: curChapter,
      section: curSection,
      subsection: curSubsection,
      articleNo: fullArtNo,
      title: title,
      contentPreview: artBlock.slice(0, 80).replace(/\n/g, ' ')
    });
  }

  console.log('--- Sample Parsed Articles 10 to 22 ---');
  for (let i = 9; i < 22; i++) {
    console.log(parsedArticles[i]);
  }

  console.log('--- Sample Parsed Articles 30 to 45 (Chapter transitions) ---');
  for (let i = 28; i < 45; i++) {
    console.log(parsedArticles[i]);
  }
}

test();
