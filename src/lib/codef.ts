/**
 * Codef API 클라이언트
 * - OAuth2 토큰 발급
 * - Connected ID 등록/조회
 * - 거래내역 조회
 *
 * 주의: Codef API 응답은 URL-encoded 형태로 옵니다 → decodeURIComponent 필요
 */

import forge from "node-forge";

const BASE_URL = process.env.CODEF_BASE_URL ?? "https://api.codef.io";
const OAUTH_URL = process.env.CODEF_OAUTH_URL ?? "https://oauth.codef.io";
const CLIENT_ID = process.env.CODEF_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.CODEF_CLIENT_SECRET ?? "";
const PUBLIC_KEY = process.env.CODEF_PUBLIC_KEY ?? "";

// ─── RSA 암호화 (인증서 비밀번호 암호화용) ─────────────────────────────────
export function encryptRSA(plainText: string): string {
  if (!PUBLIC_KEY) throw new Error("CODEF_PUBLIC_KEY 환경변수가 설정되지 않았습니다");
  const pem = `-----BEGIN PUBLIC KEY-----\n${PUBLIC_KEY}\n-----END PUBLIC KEY-----`;
  const publicKey = forge.pki.publicKeyFromPem(pem);
  const encrypted = publicKey.encrypt(plainText, "RSAES-PKCS1-V1_5");
  return forge.util.encode64(encrypted);
}

// ─── 토큰 캐시 (프로세스 메모리, 만료 전 재사용) ────────────────────────────
let _tokenCache: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (_tokenCache && _tokenCache.expiresAt > now + 30_000) {
    return _tokenCache.token;
  }

  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${OAUTH_URL}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=read",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Codef 토큰 발급 실패: ${res.status} ${text}`);
  }

  const data = await res.json();
  _tokenCache = {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return _tokenCache.token;
}

// ─── Codef API 응답 파싱 (URL-encoded → JSON) ─────────────────────────────
// Codef API는 응답 본문을 URL-encode하여 반환합니다.
async function parseCodefResponse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    // URL-encoded 형식이면 디코딩 후 파싱
    const decoded = decodeURIComponent(text);
    return JSON.parse(decoded);
  } catch {
    // 디코딩 없이 바로 JSON 파싱 시도 (일부 엔드포인트는 순수 JSON 반환)
    return JSON.parse(text);
  }
}

// ─── Connected ID ─────────────────────────────────────────────────────────────
export interface AccountInput {
  countryCode: string;   // "KR"
  businessType: string;  // "BK" | "CD"
  clientType: string;    // "B" (법인)
  organization: string;  // 기관코드
  loginType: string;     // "0" (인증서) | "1" (아이디)
  id?: string;
  password: string;
  [key: string]: string | undefined;
}

export async function createConnectedId(accounts: AccountInput[]): Promise<string> {
  const token = await getAccessToken();

  const res = await fetch(`${BASE_URL}/v1/account/create`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ accountList: accounts }),
  });

  const data = await parseCodefResponse(res);
  const result = data.result as { code: string; message: string } | undefined;

  if (result?.code !== "CF-00000") {
    throw new Error(`Connected ID 생성 실패: ${result?.message}`);
  }

  const responseData = data.data as { connectedId?: string };
  return responseData.connectedId as string;
}

export async function addAccountToConnectedId(connectedId: string, accounts: AccountInput[]): Promise<void> {
  const token = await getAccessToken();

  const res = await fetch(`${BASE_URL}/v1/account/add`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ connectedId, accountList: accounts }),
  });

  const data = await parseCodefResponse(res);
  const result = data.result as { code: string; message: string } | undefined;

  if (result?.code !== "CF-00000") {
    throw new Error(`계정 추가 실패: ${result?.message}`);
  }
}

// ─── 자동 연결: 모든 기관에 인증서로 연결 시도 ──────────────────────────────
interface InstitutionDef {
  key: string;
  businessType: string;
  organization: string;
  label: string;
}

const ALL_INSTITUTIONS: InstitutionDef[] = [
  { key: "ibk", businessType: "BK", organization: "0003", label: "기업은행" },
  { key: "samsungCard", businessType: "CD", organization: "0325", label: "삼성카드" },
  { key: "bcCard", businessType: "CD", organization: "0301", label: "BC카드" },
];

export interface AutoConnectResult {
  connectedId: string;
  succeeded: { key: string; label: string; accounts?: { number: string; name: string }[] }[];
  failed: { key: string; label: string; reason: string }[];
}

/**
 * 모든 지원 기관에 인증서로 자동 연결 시도
 * 성공한 기관만 Connected ID에 등록, 은행은 계좌 목록도 자동 조회
 */
export async function autoConnectAll(
  certFile: string,
  keyFile: string,
  encryptedPassword: string
): Promise<AutoConnectResult> {
  const token = await getAccessToken();

  // 모든 기관을 한번에 등록 시도
  const accountList = ALL_INSTITUTIONS.map(inst => ({
    countryCode: "KR",
    businessType: inst.businessType,
    clientType: "B",
    organization: inst.organization,
    loginType: "0",
    certFile,
    keyFile,
    password: encryptedPassword,
  }));

  const res = await fetch(`${BASE_URL}/v1/account/create`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ accountList }),
  });

  const data = await parseCodefResponse(res);
  const result = data.result as { code: string; message: string };

  // CF-04012: 부분 성공 (일부 기관만 등록됨) → 정상 처리
  // CF-00000: 전체 성공
  if (result.code !== "CF-00000" && result.code !== "CF-04012") {
    throw new Error(`금융기관 연결 실패: ${result.message}`);
  }

  const responseData = data.data as {
    connectedId?: string;
    successList?: { organization: string }[];
    errorList?: { organization: string; message: string }[];
  };

  const connectedId = responseData.connectedId;
  if (!connectedId) {
    throw new Error("Connected ID를 받지 못했습니다. 인증서 비밀번호를 확인해주세요.");
  }

  const successOrgs = new Set(
    (responseData.successList ?? []).map(s => s.organization)
  );

  const succeeded: AutoConnectResult["succeeded"] = [];
  const failed: AutoConnectResult["failed"] = [];

  for (const inst of ALL_INSTITUTIONS) {
    if (successOrgs.has(inst.organization)) {
      const entry: AutoConnectResult["succeeded"][0] = { key: inst.key, label: inst.label };

      // 은행이면 계좌 목록 자동 조회
      if (inst.businessType === "BK") {
        try {
          entry.accounts = await fetchBankAccountList(connectedId, inst.organization);
        } catch {
          // 계좌 조회 실패해도 연결 자체는 성공
        }
      }

      succeeded.push(entry);
    } else {
      const errItem = (responseData.errorList ?? []).find(e => e.organization === inst.organization);
      failed.push({
        key: inst.key,
        label: inst.label,
        reason: errItem?.message ?? "연결 실패",
      });
    }
  }

  return { connectedId, succeeded, failed };
}

// ─── 은행 계좌 목록 자동 조회 ───────────────────────────────────────────────
async function fetchBankAccountList(
  connectedId: string,
  organization: string
): Promise<{ number: string; name: string }[]> {
  const token = await getAccessToken();

  const res = await fetch(`${BASE_URL}/v1/kr/bank/b/account/account-list`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ connectedId, organization }),
  });

  const data = await parseCodefResponse(res);
  const result = data.result as { code: string; message: string };

  if (result.code !== "CF-00000") return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data.data ?? []) as any[]).map(row => ({
    number: row.resAccount ?? row.account ?? "",
    name: row.resAccountName ?? row.accountName ?? "법인계좌",
  }));
}

// ─── 기업은행 법인 계좌 거래내역 조회 ────────────────────────────────────────
export interface IbkTransactionParams {
  connectedId: string;
  account: string;       // 계좌번호 (하이픈 없이)
  startDate: string;     // "YYYYMMDD"
  endDate: string;       // "YYYYMMDD"
}

export interface CodefTransaction {
  date: string;
  time: string;
  description: string;
  amount_in: number;
  amount_out: number;
  balance: number;
}

export async function fetchIbkTransactions(
  params: IbkTransactionParams
): Promise<CodefTransaction[]> {
  const token = await getAccessToken();

  const res = await fetch(`${BASE_URL}/v1/kr/bank/b/transaction-list/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      connectedId: params.connectedId,
      organization: "0003",
      account: params.account,
      startDate: params.startDate,
      endDate: params.endDate,
      orderBy: "0",
    }),
  });

  const data = await parseCodefResponse(res);
  const result = data.result as { code: string; message: string } | undefined;

  if (result?.code !== "CF-00000") {
    const extra = result?.code === "CF-00003" ? " (developer.codef.io에서 해당 상품 구독 필요)" : "";
    throw new Error(`기업은행 조회 실패: ${result?.message}${extra}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data.data ?? []) as any[]).map((row) => ({
    date: `${row.tranDate.slice(0, 4)}-${row.tranDate.slice(4, 6)}-${row.tranDate.slice(6, 8)}`,
    time: row.tranTime ?? "",
    description: row.briefs ?? row.remark ?? "",
    amount_in: Number(row.tranCrAmt ?? 0),
    amount_out: Number(row.tranDrAmt ?? 0),
    balance: Number(row.curBal ?? 0),
  }));
}

// ─── 삼성카드 법인카드 승인내역 조회 ──────────────────────────────────────────
export interface CardTransactionParams {
  connectedId: string;
  startDate: string;  // "YYYYMMDD"
  endDate: string;    // "YYYYMMDD"
}

export async function fetchSamsungCardTransactions(
  params: CardTransactionParams
): Promise<CodefTransaction[]> {
  const token = await getAccessToken();

  const res = await fetch(`${BASE_URL}/v1/kr/card/b/approval-list/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      connectedId: params.connectedId,
      organization: "0325",
      startDate: params.startDate,
      endDate: params.endDate,
    }),
  });

  const data = await parseCodefResponse(res);
  const result = data.result as { code: string; message: string } | undefined;

  if (result?.code !== "CF-00000") {
    const extra = result?.code === "CF-00003" ? " (developer.codef.io에서 해당 상품 구독 필요)" : "";
    throw new Error(`삼성카드 조회 실패: ${result?.message}${extra}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data.data ?? []) as any[]).map((row) => ({
    date: `${row.approvalDate.slice(0, 4)}-${row.approvalDate.slice(4, 6)}-${row.approvalDate.slice(6, 8)}`,
    time: row.approvalTime ?? "",
    description: row.storeName ?? row.merchantName ?? "",
    amount_in: 0,
    amount_out: Number(row.approvalAmt ?? 0),
    balance: 0,
  }));
}

// ─── BC카드 법인카드 승인내역 조회 ────────────────────────────────────────────
export async function fetchBcCardTransactions(
  params: CardTransactionParams
): Promise<CodefTransaction[]> {
  const token = await getAccessToken();

  const res = await fetch(`${BASE_URL}/v1/kr/card/b/approval-list/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      connectedId: params.connectedId,
      organization: "0301",
      startDate: params.startDate,
      endDate: params.endDate,
    }),
  });

  const data = await parseCodefResponse(res);
  const result = data.result as { code: string; message: string } | undefined;

  if (result?.code !== "CF-00000") {
    const extra = result?.code === "CF-00003" ? " (developer.codef.io에서 해당 상품 구독 필요)" : "";
    throw new Error(`BC카드 조회 실패: ${result?.message}${extra}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data.data ?? []) as any[]).map((row) => ({
    date: `${row.approvalDate.slice(0, 4)}-${row.approvalDate.slice(4, 6)}-${row.approvalDate.slice(6, 8)}`,
    time: row.approvalTime ?? "",
    description: row.storeName ?? row.merchantName ?? "",
    amount_in: 0,
    amount_out: Number(row.approvalAmt ?? 0),
    balance: 0,
  }));
}
