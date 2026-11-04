-- /api/auth/login のレート制限（同一 IP から 1 分に 10 回まで）。古い行は定期的に消す。
CREATE TABLE login_attempts (
  id          TEXT PRIMARY KEY,
  ip          TEXT NOT NULL,
  ok          INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_login_attempts_ip_time ON login_attempts(ip, created_at);
