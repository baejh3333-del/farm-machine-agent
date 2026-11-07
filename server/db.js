import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

// DATE 컬럼은 'YYYY-MM-DD' 문자열 그대로 받는다. pg 기본값은 서버 시간대 기준 Date라 하루가 밀릴 수 있다.
const DATE_OID = 1082;
pg.types.setTypeParser(DATE_OID, (value) => value);

let pool;

// 앱 데이터와 better-auth 계정이 함께 쓰는 연결 풀.
// 배포(Vercel)는 DATABASE_URL의 Postgres, 로컬 개발·테스트는 내장 Postgres(PGlite)를 쓴다.
export function getPool() {
  if (pool) return pool;
  if (process.env.DATABASE_URL) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10_000 });
    pool.on("error", (error) => console.warn("database pool error", error.message));
  } else if (process.env.VERCEL) {
    throw new Error("DATABASE_URL must be configured on Vercel");
  } else {
    pool = createPglitePool(localDataDir());
  }
  return pool;
}

export function usesLocalDatabase() {
  return !process.env.DATABASE_URL;
}

function localDataDir() {
  if (process.env.MOA_LOCAL_DB) return process.env.MOA_LOCAL_DB;
  // node --test가 띄운 프로세스에서는 파일을 남기지 않도록 메모리 DB를 쓴다.
  if (process.env.NODE_TEST_CONTEXT) return "memory://";
  return fileURLToPath(new URL("../data/pglite", import.meta.url));
}

// PGlite를 pg.Pool처럼 쓰게 하는 어댑터. 연결이 하나뿐이라 connect()부터 release()까지 잠근다.
// better-auth(Kysely)는 connect()가 있으면 Postgres 풀로 인식한다.
export function createPglitePool(dataDir) {
  let opening;
  let tail = Promise.resolve();
  const open = () => (opening ??= (async () => {
    // 배포 번들에 포함되지 않도록 모듈 이름을 변수로 넘긴다(로컬 개발 의존성).
    const name = "@electric-sql/pglite";
    const [{ PGlite }, { btree_gist }] = await Promise.all([import(name), import(`${name}/contrib/btree_gist`)]);
    if (!dataDir.startsWith("memory://")) mkdirSync(dataDir, { recursive: true });
    return PGlite.create(dataDir, { extensions: { btree_gist }, parsers: { [DATE_OID]: (value) => value } });
  })());
  const lock = () => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const ready = tail.then(() => release);
    tail = tail.then(() => held);
    return ready;
  };
  async function run(db, sql, params) {
    const command = /^\s*(\w+)/.exec(sql)?.[1]?.toUpperCase();
    if (params?.length) {
      const result = await db.query(sql, params);
      return { command, rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    }
    // 매개변수가 없으면 pg의 단순 질의처럼 여러 문장을 한 번에 실행한다.
    const results = await db.exec(sql);
    const last = results.at(-1) ?? { rows: [], affectedRows: 0 };
    return { command, rows: last.rows, rowCount: last.affectedRows ?? last.rows.length };
  }
  const adapter = {
    async connect() {
      const db = await open();
      const release = await lock();
      let released = false;
      return {
        query: (sql, params) => run(db, sql, params),
        release() {
          if (released) return;
          released = true;
          release();
        },
      };
    },
    async query(sql, params) {
      const client = await adapter.connect();
      try {
        return await client.query(sql, params);
      } finally {
        client.release();
      }
    },
    async end() {
      if (!opening) return;
      const db = await opening;
      await db.close();
    },
  };
  return adapter;
}

// 테스트에서 프로세스가 끝나기 전에 연결을 닫을 때 쓴다.
export async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  await current.end();
}
