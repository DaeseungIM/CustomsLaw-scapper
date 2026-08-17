/**
 * Robust API Helper to prevent "Unexpected token '<', "<!doctype "... is not valid JSON" errors.
 * Inspects Content-Type, HTTP status, and handles both JSON and non-JSON responses safely.
 */

export interface ApiResponse<T = any> {
  success?: boolean;
  error?: string;
  message?: string;
  [key: string]: any;
}

/**
 * Parses a Fetch Response safely, ensuring non-JSON responses (e.g. HTML error pages)
 * do not trigger a SyntaxError.
 */
export async function parseResponseSafely<T = any>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      const data = await res.json();
      if (!res.ok) {
        const errorMsg = data?.error || data?.message || `서버 오류 발생 (상태 코드: ${res.status})`;
        throw new Error(errorMsg);
      }
      return data as T;
    } catch (parseErr: any) {
      if (parseErr.message && !parseErr.message.includes('Unexpected token')) {
        throw parseErr;
      }
      throw new Error(`JSON 응답 파싱 실패 (상태 코드: ${res.status})`);
    }
  }

  // Non-JSON response received (HTML page, plaintext, 404 SPA fallback, 502/504 gateway error)
  const rawText = await res.text().catch(() => '');
  let friendlyMsg = `서버 응답 오류 (HTTP ${res.status})`;

  if (rawText.includes('<!DOCTYPE') || rawText.includes('<html') || rawText.includes('<body')) {
    if (res.status === 404) {
      friendlyMsg = `요청한 API 주소를 찾을 수 없습니다. (404 Not Found)`;
    } else if (res.status === 502 || res.status === 504) {
      friendlyMsg = `서버 통신 지연 또는 일시적 중단 (HTTP ${res.status})`;
    } else if (res.status === 500) {
      friendlyMsg = `서버 내부 오류 (HTTP 500)`;
    } else {
      friendlyMsg = `서버가 JSON 데이터 대신 웹페이지(HTML)를 반환했습니다. (상태 코드: ${res.status})`;
    }
  } else if (rawText && rawText.trim().length > 0) {
    friendlyMsg = rawText.slice(0, 150);
  }

  throw new Error(friendlyMsg);
}

/**
 * Universal safe fetch that handles JSON requests, Content-Type verification,
 * and clear user-facing error messages.
 */
export async function safeFetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  try {
    const res = await fetch(input, init);
    return await parseResponseSafely<T>(res);
  } catch (err: any) {
    console.error(`[safeFetchJson Error] ${typeof input === 'string' ? input : 'Request'}:`, err);
    throw err;
  }
}
