-- One JSON document per path. The page stores its whole list as the document `tracker/list`.
CREATE TABLE docs (
  path text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
