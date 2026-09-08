import { neon } from '@neondatabase/serverless';

let client = null;

/**
 * 태그드 템플릿으로 씁니다:  sql`select * from events where id = ${id}`
 * 첫 호출 때만 연결을 만듭니다. Neon은 HTTP 드라이버라 연결 유지 비용이 없습니다.
 */
export function sql(...args) {
  if (!client) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('DATABASE_URL 환경변수가 없습니다');
    client = neon(url);
  }
  return client(...args);
}

/** 테스트에서 가짜 클라이언트를 끼워 넣을 때만 씁니다. */
export function useClient(fn) {
  client = fn;
}
