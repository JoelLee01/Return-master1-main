/**
 * 옵션 매칭 유틸
 * - (~55), (~66), (~77) 제거
 * - 버전/색상/사이즈/기장 그룹별 파싱 후 그룹 기준 매칭
 */

/** 매칭 시 무시할 괄호 패턴: (~55), (~66), (~77) */
const IGNORE_SIZE_BRACKETS = /\(\s*~?\s*55\s*\)|\(\s*~?\s*66\s*\)|\(\s*~?\s*77\s*\)/gi;

export function normalizeOptionForMatching(option: string): string {
  if (!option || typeof option !== 'string') return '';
  return option.replace(IGNORE_SIZE_BRACKETS, '').replace(/\s+/g, ' ').trim();
}

export interface OptionGroups {
  versions: string[];
  colors: string[];
  sizes: string[];
  lengths: string[];
}

const VERSION_KEYWORDS = [
  '코듀ver', '코듀로이ver', '벨벳코듀로이ver', '니트지ver', '[없음]',
  '헤라니트', '요요융기모프릴스커트', '돌돌이원피스', '120셔츠ops', '유니벌ops'
];

const COLOR_KEYWORDS = [
  '크림아이보리', '아이보리', '브라운', '블랙', '베이지', '그레이', '핑크', '밤색', '오트밀', '차콜',
  '네이비', '화이트', '레드', '블루', '그린', '옐로우', '퍼플', '오렌지', '카멜', '민트', '소라', '곤색',
  '연두', '다크그레이', '연핑크', '회색', '검정', '아쿠아블루', '메란지', '라이트민트', '연겨자', '샌드', '타우프', '로즈', '라벤더', '코랄', '터콰이즈', '버건디', '마린', '올리브', '인디고', '골드', '실버'
];

const LENGTH_KEYWORDS = ['기본', '숏', '롱', '미니', '맥시', '기장'];

/**
 * 옵션 문자열을 버전/색상/사이즈/기장 그룹으로 파싱
 */
export function parseOptionGroups(option: string): OptionGroups {
  const result: OptionGroups = { versions: [], colors: [], sizes: [], lengths: [] };
  if (!option || typeof option !== 'string') return result;

  const normalized = normalizeOptionForMatching(option);
  const lower = normalized.toLowerCase();
  const parts = normalized.split(/[,/\-\s]+/).map(p => p.trim()).filter(Boolean);

  for (const part of parts) {
    const p = part.toLowerCase();
    if (!p) continue;

    // 버전 (코듀ver, [없음], *ver, *ops 등)
    if (/ver\s*$|ops\s*$|^\[없음\]$/i.test(p) || VERSION_KEYWORDS.some(v => p.includes(v.toLowerCase()))) {
      const ver = part.trim();
      if (ver && !result.versions.includes(ver)) result.versions.push(ver);
      continue;
    }

    // 기장 (숏, 기본, 롱 등) - "2숏", "3기본" 형태에서도 추출
    const lengthMatch = p.match(new RegExp(`(${LENGTH_KEYWORDS.join('|')})`, 'i'));
    if (lengthMatch) {
      const len = lengthMatch[1];
      if (!result.lengths.includes(len)) result.lengths.push(len);
    }
    if (LENGTH_KEYWORDS.some(l => p === l.toLowerCase())) {
      if (!result.lengths.includes(part.trim())) result.lengths.push(part.trim());
      continue;
    }

    // 사이즈 숫자 (1, 2, 3 또는 1숏->1, 2기본->2)
    const numMatch = p.match(/^(\d+)(숏|기본|롱)?$/);
    if (numMatch) {
      const num = numMatch[1];
      if (!result.sizes.includes(num)) result.sizes.push(num);
      if (numMatch[2] && !result.lengths.includes(numMatch[2])) result.lengths.push(numMatch[2]);
      continue;
    }
    if (/^\d+$/.test(p)) {
      if (!result.sizes.includes(p)) result.sizes.push(p);
      continue;
    }

    // 색상
    const colorFound = COLOR_KEYWORDS.find(c => p.includes(c.toLowerCase()) || p === c.toLowerCase());
    if (colorFound) {
      if (!result.colors.some(c => c.toLowerCase() === colorFound.toLowerCase())) result.colors.push(colorFound);
      continue;
    }

    // 버전 패턴 (앞에서 안 걸린 *ver 등)
    if (/ver|ops/i.test(p) && !result.versions.some(v => v.toLowerCase() === p)) {
      result.versions.push(part.trim());
    }
  }

  // 전체 문자열에서 색상/버전 추가 검사 (연결된 경우 예: 코듀ver블랙)
  for (const color of COLOR_KEYWORDS) {
    if (lower.includes(color.toLowerCase()) && !result.colors.some(c => c.toLowerCase() === color.toLowerCase())) {
      result.colors.push(color);
    }
  }
  for (const ver of VERSION_KEYWORDS) {
    if (lower.includes(ver.toLowerCase()) && !result.versions.some(v => v.toLowerCase() === ver.toLowerCase())) {
      result.versions.push(ver);
    }
  }

  return result;
}

/**
 * 그룹 기준 옵션 매칭 점수 (0~100)
 * - 각 그룹별로 반품 옵션 값이 상품 옵션 그룹에 있으면 가산
 */
export function optionMatchScoreByGroups(returnOption: string, productOption: string): number {
  const r = parseOptionGroups(returnOption);
  const p = parseOptionGroups(productOption);

  let matchedGroups = 0;
  let totalGroups = 0;

  if (r.versions.length > 0 || p.versions.length > 0) {
    totalGroups++;
    const rSet = new Set(r.versions.map(v => v.toLowerCase()));
    const pSet = new Set(p.versions.map(v => v.toLowerCase()));
    const anyMatch = r.versions.some(rv => pSet.has(rv.toLowerCase())) || p.versions.some(pv => rSet.has(pv.toLowerCase()));
    if (r.versions.length === 0 || p.versions.length === 0) {
      if (r.versions.length === 0 && p.versions.length === 0) matchedGroups++;
      else if (anyMatch) matchedGroups++;
    } else if (anyMatch) matchedGroups++;
  }

  if (r.colors.length > 0 || p.colors.length > 0) {
    totalGroups++;
    const pColorSet = new Set(p.colors.map(c => c.toLowerCase()));
    const colorMatch = r.colors.length === 0 || r.colors.some(rc => pColorSet.has(rc.toLowerCase()));
    if (colorMatch) matchedGroups++;
  }

  if (r.sizes.length > 0 || p.sizes.length > 0) {
    totalGroups++;
    const pSizeSet = new Set(p.sizes.map(s => s.toLowerCase()));
    const sizeMatch = r.sizes.length === 0 || r.sizes.some(rs => pSizeSet.has(rs.toLowerCase()));
    if (sizeMatch) matchedGroups++;
  }

  if (r.lengths.length > 0 || p.lengths.length > 0) {
    totalGroups++;
    const pLenSet = new Set(p.lengths.map(l => l.toLowerCase()));
    const lenMatch = r.lengths.length === 0 || r.lengths.some(rl => pLenSet.has(rl.toLowerCase()));
    if (lenMatch) matchedGroups++;
  }

  if (totalGroups === 0) return 0;
  return Math.round((matchedGroups / totalGroups) * 100);
}
