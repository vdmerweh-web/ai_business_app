// SQLite (better-sqlite3) on the /data volume. One file, WAL mode, no separate DB container (server RAM is tight).
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const FILE = process.env.DB_FILE || '/data/app.db';
const BACKUP_DIR = process.env.BACKUP_DIR || '/backups';
const SCHEMA = 3;

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

  // Schema 3 (25 Nov 2026): sites, modules, scheduler, webhooks, storage, change requests.
  db.exec(`
create table if not exists plans(id text primary key,name text not null,db_mb integer not null,files_mb integer not null,max_sites integer not null default 3);
insert or ignore into plans(id,name,db_mb,files_mb,max_sites) values('test','Test play plan',100,250,3),('base','Base plan',250,1024,1),('plus','Plus plan',1024,5120,3);
create table if not exists sites(id integer primary key,client_id integer not null references clients on delete cascade,slug text unique not null,name text not null,custom_domain text,created_by integer references users on delete set null,created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
create table if not exists site_copies(id integer primary key,site_id integer not null references sites on delete cascade,copy text not null check(copy in('live','test')),db_name text not null unique,db_user text not null unique,db_pass_enc text not null,status text not null default 'new',build_status text,build_error text,built_at text,updated_at text,unique(site_id,copy));
create table if not exists publish_requests(id integer primary key,site_id integer not null references sites on delete cascade,requested_by integer references users on delete set null,via text not null default 'app',note text,needs_admin integer not null default 0,client_ok_by integer,admin_ok_by integer,status text not null default 'pending',error text,created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),done_at text);
create table if not exists client_modules(client_id integer not null references clients on delete cascade,module_id text not null,enabled integer not null default 1,pinned_major integer,primary key(client_id,module_id));
create table if not exists client_caps(client_id integer primary key references clients on delete cascade,max_jobs_per_day integer not null default 50,max_active_jobs integer not null default 20,max_ai_zar_per_day real not null default 10);
create table if not exists sched_jobs(id integer primary key,client_id integer not null references clients on delete cascade,site_id integer references sites on delete set null,kind text not null,title text not null default '',payload text not null default '{}',schedule text not null default 'once',tz text not null default 'Africa/Johannesburg',next_run_at integer,jitter_sec integer not null default 0,status text not null default 'active',attempts integer not null default 0,max_attempts integer not null default 3,created_by text,created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),last_run_at integer,last_error text,locked_at integer);
create index if not exists sched_jobs_due on sched_jobs(status,next_run_at);
create table if not exists sched_runs(id integer primary key,job_id integer references sched_jobs on delete set null,client_id integer,kind text,attempt integer,status text not null,message text,cost_zar real not null default 0,started_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),finished_at text);
create index if not exists sched_runs_client on sched_runs(client_id,id);
create table if not exists flags(id integer primary key,source text not null,client_id integer,text text not null,sent_to_grid integer not null default 0,created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),resolved_at text);
create table if not exists webhook_log(id integer primary key,direction text not null,peer text not null,path text,status integer,sig_ok integer,summary text,created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
create table if not exists hook_nonces(nonce text primary key,seen_at integer not null);
create table if not exists hook_messages(id integer primary key,from_bot text not null,to_bot text not null,text text not null,meta text not null default '{}',delivered integer not null default 0,attempts integer not null default 0,last_status integer,created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),read_at text);
create table if not exists reserved_names(name text primary key,source text,points_to text);
create table if not exists storage_usage(id integer primary key,client_id integer not null,db_bytes integer not null default 0,files_bytes integer not null default 0,level text,measured_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
create table if not exists mail_outbox(id integer primary key,client_id integer,site_id integer,copy text,to_addr text,subject text,body text,status text not null default 'stubbed',created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
create table if not exists change_requests(id integer primary key,client_id integer not null references clients on delete cascade,module_id text,text text not null,requested_by text,via text not null default 'app',status text not null default 'open',decided_by text,note text,created_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),decided_at text);
`);
  if (!hasColumn('clients', 'plan_id')) db.exec("alter table clients add column plan_id text not null default 'base'");
  if (!hasColumn('clients', 'is_test')) db.exec('alter table clients add column is_test integer not null default 0');
  if (!hasColumn('clients', 'timezone')) db.exec("alter table clients add column timezone text not null default 'Africa/Johannesburg'");
  db.pragma(`user_version = ${SCHEMA}`);
}

backupIfNeeded();
migrate();
export const now = () => Date.now();
