/**
 * Codef 연동 기관 메타데이터
 */

export interface InstitutionConfig {
  key: string;
  label: string;
  shortLabel: string;
  description: string;
  businessType: "BK" | "CD";
  organization: string;
  color: string;
  needsAccount: boolean;
}

export const INSTITUTIONS: InstitutionConfig[] = [
  {
    key: "ibk",
    label: "기업은행 (IBK)",
    shortLabel: "기업은행",
    description: "법인 계좌 잔액 및 거래내역 조회",
    businessType: "BK",
    organization: "0003",
    color: "#0066B3",
    needsAccount: true,
  },
  {
    key: "samsungCard",
    label: "삼성카드",
    shortLabel: "삼성카드",
    description: "법인카드 승인내역 조회",
    businessType: "CD",
    organization: "0325",
    color: "#034EA2",
    needsAccount: false,
  },
  {
    key: "bcCard",
    label: "BC카드",
    shortLabel: "BC카드",
    description: "법인카드 승인내역 조회",
    businessType: "CD",
    organization: "0301",
    color: "#E60012",
    needsAccount: false,
  },
];

export const INSTITUTION_MAP = Object.fromEntries(
  INSTITUTIONS.map((inst) => [inst.key, inst])
);

// 동기화 기간 프리셋
export const SYNC_PRESETS = [
  { label: "최근 1개월", months: 1 },
  { label: "최근 3개월", months: 3 },
  { label: "최근 6개월", months: 6 },
  { label: "최근 1년", months: 12 },
  { label: "최근 3년", months: 36 },
  { label: "전체 (5년)", months: 60 },
];

export function getDateRange(months: number): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - months);
  return {
    startDate: fmt(start),
    endDate: fmt(end),
  };
}

function fmt(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
