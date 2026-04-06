export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  PASSWORD_HASH: string;
  WORKER_NAME: string;
}
