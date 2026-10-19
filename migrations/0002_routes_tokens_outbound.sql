-- 收信前缀分流、外部令牌、以及已发送邮件的方向标记。
ALTER TABLE emails ADD COLUMN direction TEXT NOT NULL DEFAULT 'in';

CREATE TABLE IF NOT EXISTS mail_routes (
  id TEXT PRIMARY KEY,
  prefix TEXT NOT NULL UNIQUE, -- 收件地址的本地部分，小写，不含 +detail
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_routes_account_id ON mail_routes(account_id);

CREATE TABLE IF NOT EXISTS mail_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE, -- 只存 SHA-256，令牌明文仅创建时返回一次
  token_prefix TEXT NOT NULL,
  scopes TEXT NOT NULL, -- 逗号分隔：send,read
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE, -- 为空表示所有邮箱
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mail_tokens_account_id ON mail_tokens(account_id);
