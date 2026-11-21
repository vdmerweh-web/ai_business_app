// SQLite (better-sqlite3) on the /data volume. One file, WAL mode, no separate DB container (server RAM is tight).
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const FILE = process.env.DB_FILE || '/data/app.db';
const BACKUP_DIR = process.env.BACKUP_DIR || '/backups';
const SCHEMA = 2;

fs.mkdirSync(path.dirname(FILE), {recursive: true});
export const db = new Database(FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('cache_size = -8000');

function userVersion() {
  return db.pragma('user_version', {simple: true});
}

function backupIfNeeded() {
  if (userVersion() >= SCHEMA) return;
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, {recursive: true});
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(BACKUP_DIR, `app-db-before-schema${SCHEMA}-${stamp}.db`);
    // VACUUM INTO is a consistent snapshot, including WAL changes.
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    console.log('db backup written', dest);
  } catch (e) {
    console.error('db backup failed:', e.message);
  }
}

function hasColumn(table, col) {
  return db.prepare(`pragma table_info(${table})`).all().some(c => c.name === col);
}

function migrate() {
  db.exec(`
create table if not exists users(id integer primary key,email text unique not null,name text,picture text,google_sub text unique,role text not null default 'admin',created_at text default (datetime('now')),last_login_at text);
create table if not exists sessions(token_hash text primary key,user_id integer not null references users on delete cascade,expires_at integer not null,created_at text default (datetime('now')));
create table if not exists oauth_states(state text primary key,verifier text not null,nonce text not null,expires_at integer not null);
create table if not exists conversations(id integer primary key,user_id integer not null references users on delete cascade,section text not null default 'server-admin',title text not null default 'New chat',created_at text default (datetime('now')),last_user_at integer,last_bot_at integer,user_read_at integer default (unixepoch()*1000));
create table if not exists files(id text primary key,conversation_id integer references conversations on delete cascade,user_id integer,name text not null,mime text not null,size integer not null,created_at text default (datetime('now')));
create table if not exists chat_messages(id integer primary key,conversation_id integer not null references conversations on delete cascade,sender text not null check(sender in('user','bot')),user_id integer,text text not null default '',files text not null default '[]',delivered integer,attempts integer not null default 0,next_attempt_at integer,last_status integer,created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
create index if not exists chat_messages_conv on chat_messages(conversation_id,id);
create table if not exists inventory_snapshots(id integer primary key,source text not null,sha text not null unique,data text not null,fetched_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')));

create table if not exists clients(
  id integer primary key,
  slug text unique not null,
  name text not null,
  domain text,
  site_url text,
  agent_name text not null default 'Bobby',
  credit_allowance_zar real not null default 100,
  zar_per_usd real not null default 17.50,
  created_at text default (datetime('now'))
);
create table if not exists client_features(
  client_id integer not null references clients on delete cascade,
  feature_id text not null,
  enabled integer not null default 1,
  primary key (client_id, feature_id)
);
create table if not exists credit_usage(
  id integer primary key,
  client_id integer not null references clients on delete cascade,
  month text not null,
  model text,
  input_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd real not null default 0,
  cost_zar real not null default 0,
  conversation_id integer,
  message_id integer,
  created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists credit_usage_client_month on credit_usage(client_id, month);

create table if not exists bobby_conversations(
  id integer primary key,
  client_id integer not null references clients on delete cascade,
  title text not null default 'New chat',
  created_at text default (datetime('now')),
  last_at text,
  created_by integer references users on delete set null,
  user_read_at integer default (unixepoch()*1000)
);
create index if not exists bobby_conversations_client on bobby_conversations(client_id, last_at);

create table if not exists bobby_messages(
  id integer primary key,
  conversation_id integer not null references bobby_conversations on delete cascade,
  client_id integer not null references clients on delete cascade,
  role text not null check(role in ('user','assistant','system','tool')),
  content text not null default '',
  tool_name text,
  tool_call_id text,
  tool_calls text,
  prompt_tokens integer,
  completion_tokens integer,
  cost_zar real,
  created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists bobby_messages_conv on bobby_messages(conversation_id, id);

create table if not exists client_files(
  id text primary key,
  client_id integer not null references clients on delete cascade,
  conversation_id integer references bobby_conversations on delete set null,
  user_id integer references users on delete set null,
  name text not null,
  mime text not null,
  size integer not null,
  created_at text default (datetime('now'))
);
create index if not exists client_files_client on client_files(client_id, created_at);
`);

  if (!hasColumn('users', 'client_id')) db.exec('alter table users add column client_id integer references clients');
  if (!hasColumn('users', 'password_hash')) db.exec('alter table users add column password_hash text');
  if (!hasColumn('users', 'welcome_seen')) db.exec("alter table users add column welcome_seen integer not null default 0");
  db.pragma(`user_version = ${SCHEMA}`);
}

backupIfNeeded();
migrate();
export const now = () => Date.now();
