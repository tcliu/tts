create table if not exists users (
  id bigserial primary key,
  username text unique not null,
  email text unique not null,
  password_hash text not null,
  status text not null default 'active',
  created_at timestamptz not null default current_timestamp
);

create table if not exists login_attempts (
  ip text primary key,
  count integer not null,
  reset_at bigint not null
);

create table if not exists user_documents (
  user_id bigint not null references users(id) on delete cascade,
  id text not null,
  name text not null,
  content text not null default '',
  updated_at bigint not null default 0,
  primary key (user_id, id)
);

create index if not exists idx_user_documents_user_id_updated_at on user_documents (user_id, updated_at desc);
