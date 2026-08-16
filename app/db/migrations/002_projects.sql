CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idea TEXT,
  script TEXT,
  language TEXT NOT NULL DEFAULT 'ar',
  caption_style TEXT NOT NULL,
  timing_mode TEXT NOT NULL,
  words_per_segment INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  error_code TEXT,
  output_url TEXT,
  subtitle_srt_url TEXT,
  subtitle_ass_url TEXT,
  estimated_duration REAL,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX idx_projects_user_created ON projects(user_id, created_at DESC);