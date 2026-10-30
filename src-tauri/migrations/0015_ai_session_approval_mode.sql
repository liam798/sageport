ALTER TABLE ai_sessions
ADD COLUMN approval_mode TEXT NOT NULL DEFAULT 'request';
