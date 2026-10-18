-- =============================================
-- ZERNFLOW - COMBINED MIGRATIONS
-- Generated from supabase/migrations/*.sql, in order.
-- Paste this entire file into Supabase SQL Editor
-- https://supabase.com/dashboard/project/_/sql/new
-- =============================================

-- ============================================================
-- MIGRATION 1: INITIAL SCHEMA
-- ============================================================
-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- WORKSPACES
-- ============================================================
create table workspaces (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text not null unique,
  late_api_key_encrypted text,
  global_keywords jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index idx_workspace_members_user on workspace_members(user_id);

-- ============================================================
-- CHANNELS
-- ============================================================
create table channels (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  platform text not null check (platform in ('facebook', 'instagram', 'twitter', 'telegram', 'bluesky', 'reddit')),
  late_account_id text not null,
  username text,
  display_name text,
  profile_picture text,
  webhook_id text,
  webhook_secret text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, late_account_id)
);

create index idx_channels_workspace on channels(workspace_id);

-- ============================================================
-- CONTACTS (CRM)
-- ============================================================
create table contacts (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  display_name text,
  email text,
  avatar_url text,
  is_subscribed boolean not null default true,
  last_interaction_at timestamptz,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_contacts_workspace on contacts(workspace_id);
create index idx_contacts_last_interaction on contacts(workspace_id, last_interaction_at desc);

create table contact_channels (
  id uuid primary key default uuid_generate_v4(),
  contact_id uuid not null references contacts(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  platform_sender_id text not null,
  platform_username text,
  created_at timestamptz not null default now(),
  unique (channel_id, platform_sender_id)
);

create index idx_contact_channels_contact on contact_channels(contact_id);

create table tags (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  color text default '#6366f1',
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table contact_tags (
  contact_id uuid not null references contacts(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contact_id, tag_id)
);

create table custom_field_definitions (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  slug text not null,
  type text not null default 'text' check (type in ('text', 'number', 'boolean', 'date', 'url', 'email')),
  created_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table contact_custom_fields (
  contact_id uuid not null references contacts(id) on delete cascade,
  field_id uuid not null references custom_field_definitions(id) on delete cascade,
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (contact_id, field_id)
);

-- ============================================================
-- FLOWS
-- ============================================================
create table flows (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  nodes jsonb not null default '[]'::jsonb,
  edges jsonb not null default '[]'::jsonb,
  viewport jsonb,
  version integer not null default 1,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_flows_workspace on flows(workspace_id);
create index idx_flows_status on flows(workspace_id, status);

create table triggers (
  id uuid primary key default uuid_generate_v4(),
  flow_id uuid not null references flows(id) on delete cascade,
  channel_id uuid references channels(id) on delete set null,
  type text not null check (type in ('keyword', 'postback', 'quick_reply', 'welcome', 'default', 'comment_keyword')),
  config jsonb not null default '{}'::jsonb,
  priority integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_triggers_channel_type on triggers(channel_id, type, is_active);
create index idx_triggers_flow on triggers(flow_id);

create table flow_sessions (
  id uuid primary key default uuid_generate_v4(),
  contact_id uuid not null references contacts(id) on delete cascade,
  flow_id uuid not null references flows(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'completed', 'expired', 'cancelled')),
  current_node_id text,
  variables jsonb not null default '{}'::jsonb,
  flow_stack jsonb not null default '[]'::jsonb,
  waiting_until timestamptz,
  waiting_for_input boolean not null default false,
  human_takeover_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_flow_sessions_contact_active on flow_sessions(contact_id, channel_id) where status = 'active';

-- ============================================================
-- CONVERSATIONS & MESSAGES
-- ============================================================
create table conversations (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  late_conversation_id text,
  platform text not null,
  status text not null default 'open' check (status in ('open', 'closed', 'snoozed')),
  assigned_to uuid references auth.users(id) on delete set null,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count integer not null default 0,
  is_automation_paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, contact_id)
);

create index idx_conversations_workspace on conversations(workspace_id, last_message_at desc);
create index idx_conversations_status on conversations(workspace_id, status);

create table messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  text text,
  attachments jsonb,
  quick_reply_payload text,
  postback_payload text,
  callback_data text,
  platform_message_id text,
  sent_by_flow_id uuid references flows(id) on delete set null,
  sent_by_node_id text,
  sent_by_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'sent' check (status in ('pending', 'sent', 'delivered', 'failed')),
  created_at timestamptz not null default now()
);

create index idx_messages_conversation on messages(conversation_id, created_at);

-- ============================================================
-- BROADCASTS
-- ============================================================
create table broadcasts (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'completed', 'cancelled')),
  message_content jsonb not null default '{}'::jsonb,
  segment_filter jsonb,
  scheduled_for timestamptz,
  total_recipients integer not null default 0,
  sent integer not null default 0,
  delivered integer not null default 0,
  failed integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_broadcasts_workspace on broadcasts(workspace_id);

create table broadcast_recipients (
  id uuid primary key default uuid_generate_v4(),
  broadcast_id uuid not null references broadcasts(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  status text not null default 'pending',
  sent_at timestamptz,
  error_message text
);

create index idx_broadcast_recipients_broadcast on broadcast_recipients(broadcast_id, status);

-- ============================================================
-- JOBS & ANALYTICS
-- ============================================================
create table scheduled_jobs (
  id uuid primary key default uuid_generate_v4(),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  run_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);

create index idx_scheduled_jobs_pending on scheduled_jobs(run_at) where status = 'pending';

create table analytics_events (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  flow_id uuid references flows(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  event_type text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index idx_analytics_workspace on analytics_events(workspace_id, created_at desc);
create index idx_analytics_flow on analytics_events(flow_id, created_at desc);

-- ============================================================
-- ENABLE REALTIME
-- ============================================================
alter publication supabase_realtime add table conversations;
alter publication supabase_realtime add table messages;

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at before update on workspaces for each row execute function update_updated_at();
create trigger set_updated_at before update on channels for each row execute function update_updated_at();
create trigger set_updated_at before update on contacts for each row execute function update_updated_at();
create trigger set_updated_at before update on flows for each row execute function update_updated_at();
create trigger set_updated_at before update on flow_sessions for each row execute function update_updated_at();
create trigger set_updated_at before update on conversations for each row execute function update_updated_at();
create trigger set_updated_at before update on broadcasts for each row execute function update_updated_at();

-- ============================================================
-- AUTO-CREATE WORKSPACE ON SIGNUP
-- ============================================================
create or replace function handle_new_user()
returns trigger as $$
declare
  ws_id uuid;
  user_name text;
  workspace_slug text;
begin
  user_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1)
  );
  workspace_slug := lower(regexp_replace(user_name, '[^a-zA-Z0-9]', '-', 'g')) || '-' || substr(new.id::text, 1, 8);

  insert into public.workspaces (name, slug)
  values (user_name || '''s Workspace', workspace_slug)
  returning id into ws_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_id, new.id, 'owner');

  return new;
exception when others then
  raise log 'handle_new_user error: % %', sqlerrm, sqlstate;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- MIGRATION 2: RLS POLICIES
-- ============================================================
-- ============================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================
-- All tables are filtered by workspace_id.
-- Users can only access rows in workspaces they belong to.
-- Service role key bypasses RLS (used in webhook handler).
-- ============================================================

-- Helper function: check if user belongs to workspace
create or replace function is_workspace_member(ws_id uuid)
returns boolean as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
  );
$$ language sql security definer stable;

-- ============================================================
-- WORKSPACES
-- ============================================================
alter table workspaces enable row level security;

create policy "Users can view their workspaces"
  on workspaces for select
  using (is_workspace_member(id));

create policy "Users can update their workspaces"
  on workspaces for update
  using (is_workspace_member(id));

-- ============================================================
-- WORKSPACE MEMBERS
-- ============================================================
alter table workspace_members enable row level security;

-- SELECT uses direct user_id check to avoid infinite recursion
-- (is_workspace_member queries workspace_members, which would trigger RLS again)
create policy "Members can view their workspace memberships"
  on workspace_members for select
  using (user_id = auth.uid());

create policy "Owners can insert members"
  on workspace_members for insert
  with check (
    exists (
      select 1 from workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'owner'
    )
  );

create policy "Owners can update members"
  on workspace_members for update
  using (
    exists (
      select 1 from workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'owner'
    )
  );

create policy "Owners can delete members"
  on workspace_members for delete
  using (
    exists (
      select 1 from workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'owner'
    )
  );

-- ============================================================
-- CHANNELS
-- ============================================================
alter table channels enable row level security;

create policy "Users can view channels in their workspaces"
  on channels for select
  using (is_workspace_member(workspace_id));

create policy "Users can manage channels in their workspaces"
  on channels for all
  using (is_workspace_member(workspace_id));

-- ============================================================
-- CONTACTS
-- ============================================================
alter table contacts enable row level security;

create policy "Users can view contacts in their workspaces"
  on contacts for select
  using (is_workspace_member(workspace_id));

create policy "Users can manage contacts in their workspaces"
  on contacts for all
  using (is_workspace_member(workspace_id));

-- ============================================================
-- CONTACT CHANNELS
-- ============================================================
alter table contact_channels enable row level security;

create policy "Users can view contact channels via contact"
  on contact_channels for select
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_channels.contact_id
        and is_workspace_member(c.workspace_id)
    )
  );

create policy "Users can manage contact channels"
  on contact_channels for all
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_channels.contact_id
        and is_workspace_member(c.workspace_id)
    )
  );

-- ============================================================
-- TAGS
-- ============================================================
alter table tags enable row level security;

create policy "Users can view tags in their workspaces"
  on tags for select
  using (is_workspace_member(workspace_id));

create policy "Users can manage tags in their workspaces"
  on tags for all
  using (is_workspace_member(workspace_id));

-- ============================================================
-- CONTACT TAGS
-- ============================================================
alter table contact_tags enable row level security;

create policy "Users can view contact tags"
  on contact_tags for select
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_tags.contact_id
        and is_workspace_member(c.workspace_id)
    )
  );

create policy "Users can manage contact tags"
  on contact_tags for all
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_tags.contact_id
        and is_workspace_member(c.workspace_id)
    )
  );

-- ============================================================
-- CUSTOM FIELD DEFINITIONS
-- ============================================================
alter table custom_field_definitions enable row level security;

create policy "Users can view custom fields in their workspaces"
  on custom_field_definitions for select
  using (is_workspace_member(workspace_id));

create policy "Users can manage custom fields in their workspaces"
  on custom_field_definitions for all
  using (is_workspace_member(workspace_id));

-- ============================================================
-- CONTACT CUSTOM FIELDS
-- ============================================================
alter table contact_custom_fields enable row level security;

create policy "Users can view contact custom fields"
  on contact_custom_fields for select
  using (
    exists (
      select 1 from contacts c
      join contact_custom_fields ccf on ccf.contact_id = c.id
      where c.id = contact_custom_fields.contact_id
        and is_workspace_member(c.workspace_id)
    )
  );

create policy "Users can manage contact custom fields"
  on contact_custom_fields for all
  using (
    exists (
      select 1 from contacts c
      where c.id = contact_custom_fields.contact_id
        and is_workspace_member(c.workspace_id)
    )
  );

-- ============================================================
-- FLOWS
-- ============================================================
alter table flows enable row level security;

create policy "Users can view flows in their workspaces"
  on flows for select
  using (is_workspace_member(workspace_id));

create policy "Users can manage flows in their workspaces"
  on flows for all
  using (is_workspace_member(workspace_id));

-- ============================================================
-- TRIGGERS
-- ============================================================
alter table triggers enable row level security;

create policy "Users can view triggers via flow"
  on triggers for select
  using (
    exists (
      select 1 from flows f
      where f.id = triggers.flow_id
        and is_workspace_member(f.workspace_id)
    )
  );

create policy "Users can manage triggers via flow"
  on triggers for all
  using (
    exists (
      select 1 from flows f
      where f.id = triggers.flow_id
        and is_workspace_member(f.workspace_id)
    )
  );

-- ============================================================
-- FLOW SESSIONS
-- ============================================================
alter table flow_sessions enable row level security;

create policy "Users can view flow sessions via flow"
  on flow_sessions for select
  using (
    exists (
      select 1 from flows f
      where f.id = flow_sessions.flow_id
        and is_workspace_member(f.workspace_id)
    )
  );

-- ============================================================
-- CONVERSATIONS
-- ============================================================
alter table conversations enable row level security;

create policy "Users can view conversations in their workspaces"
  on conversations for select
  using (is_workspace_member(workspace_id));

create policy "Users can manage conversations in their workspaces"
  on conversations for all
  using (is_workspace_member(workspace_id));

-- ============================================================
-- MESSAGES
-- ============================================================
alter table messages enable row level security;

create policy "Users can view messages via conversation"
  on messages for select
  using (
    exists (
      select 1 from conversations conv
      where conv.id = messages.conversation_id
        and is_workspace_member(conv.workspace_id)
    )
  );

create policy "Users can insert messages via conversation"
  on messages for insert
  with check (
    exists (
      select 1 from conversations conv
      where conv.id = messages.conversation_id
        and is_workspace_member(conv.workspace_id)
    )
  );

-- ============================================================
-- BROADCASTS
-- ============================================================
alter table broadcasts enable row level security;

create policy "Users can view broadcasts in their workspaces"
  on broadcasts for select
  using (is_workspace_member(workspace_id));

create policy "Users can manage broadcasts in their workspaces"
  on broadcasts for all
  using (is_workspace_member(workspace_id));

-- ============================================================
-- BROADCAST RECIPIENTS
-- ============================================================
alter table broadcast_recipients enable row level security;

create policy "Users can view broadcast recipients"
  on broadcast_recipients for select
  using (
    exists (
      select 1 from broadcasts b
      where b.id = broadcast_recipients.broadcast_id
        and is_workspace_member(b.workspace_id)
    )
  );

-- ============================================================
-- SCHEDULED JOBS (service role only, no user RLS needed)
-- ============================================================
alter table scheduled_jobs enable row level security;

-- ============================================================
-- ANALYTICS EVENTS
-- ============================================================
alter table analytics_events enable row level security;

create policy "Users can view analytics in their workspaces"
  on analytics_events for select
  using (is_workspace_member(workspace_id));

create policy "Users can insert analytics in their workspaces"
  on analytics_events for insert
  with check (is_workspace_member(workspace_id));

-- ============================================================
-- MIGRATION 3: RPC FUNCTIONS
-- ============================================================
-- ============================================================
-- RPC FUNCTIONS
-- ============================================================

-- Increment unread count and update conversation preview
create or replace function increment_unread(conv_id uuid, preview text)
returns void as $$
begin
  update conversations
  set unread_count = unread_count + 1,
      last_message_at = now(),
      last_message_preview = preview,
      status = 'open'
  where id = conv_id;
end;
$$ language plpgsql security definer;

-- Increment broadcast sent counter
create or replace function increment_broadcast_sent(b_id uuid)
returns void as $$
begin
  update broadcasts
  set sent = sent + 1,
      delivered = delivered + 1
  where id = b_id;
end;
$$ language plpgsql security definer;

-- Increment broadcast failed counter
create or replace function increment_broadcast_failed(b_id uuid)
returns void as $$
begin
  update broadcasts
  set failed = failed + 1
  where id = b_id;
end;
$$ language plpgsql security definer;

-- ============================================================
-- MIGRATION 4: COMMENT AUTOMATION
-- ============================================================
-- ============================================================
-- COMMENT AUTOMATION
-- ============================================================

-- Add comment polling cursor to channels
alter table channels
  add column if not exists last_comment_cursor text,
  add column if not exists comment_rules jsonb default '[]'::jsonb;

-- Comment processing log
create table if not exists comment_logs (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  post_id text, -- Late post ID the comment belongs to
  platform_comment_id text not null,
  author_id text,
  author_name text,
  author_username text,
  comment_text text not null,
  matched_trigger_id uuid references triggers(id) on delete set null,
  dm_sent boolean not null default false,
  reply_sent boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);

-- Indexes for efficient lookups
create index if not exists idx_comment_logs_channel_id on comment_logs(channel_id);
create index if not exists idx_comment_logs_workspace_id on comment_logs(workspace_id);
create index if not exists idx_comment_logs_platform_comment_id on comment_logs(platform_comment_id);
create index if not exists idx_comment_logs_created_at on comment_logs(created_at desc);

-- Unique constraint to avoid processing the same comment twice
create unique index if not exists idx_comment_logs_unique_comment
  on comment_logs(channel_id, platform_comment_id);

-- RLS policies for comment_logs
alter table comment_logs enable row level security;

create policy "Users can view comment logs in their workspace"
  on comment_logs for select
  using (
    workspace_id in (
      select workspace_id from workspace_members where user_id = auth.uid()
    )
  );

-- ============================================================
-- MIGRATION 5: SEQUENCES
-- ============================================================
-- Sequences: drip campaigns
CREATE TABLE IF NOT EXISTS sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  steps JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sequences_workspace" ON sequences
  FOR ALL USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

CREATE TABLE IF NOT EXISTS sequence_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id),
  current_step_index INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  next_step_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE(sequence_id, contact_id)
);

ALTER TABLE sequence_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "enrollments_via_sequence" ON sequence_enrollments
  FOR ALL USING (
    sequence_id IN (
      SELECT id FROM sequences WHERE workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
      )
    )
  );

-- ============================================================
-- MIGRATION 6: WORKSPACE INVITES
-- ============================================================
-- ============================================================
-- WORKSPACE INVITES
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + interval '7 days'
);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace ON workspace_invites(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_email ON workspace_invites(email);

ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;

-- Members of the workspace can view invites
CREATE POLICY "workspace_invites_select" ON workspace_invites
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- Only workspace owners can create invites
CREATE POLICY "workspace_invites_insert" ON workspace_invites
  FOR INSERT WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Only workspace owners can delete invites
CREATE POLICY "workspace_invites_delete" ON workspace_invites
  FOR DELETE USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- Only workspace owners can update invite status
CREATE POLICY "workspace_invites_update" ON workspace_invites
  FOR UPDATE USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role = 'owner'
    )
    OR
    -- Allow the invited user to accept their own invite
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- ============================================================
-- MIGRATION 7: OPENAI API KEY
-- ============================================================
-- Add OpenAI API key column to workspaces
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS openai_api_key TEXT;

-- ============================================================
-- MIGRATION 8: AI PROVIDER
-- ============================================================
-- Rename openai_api_key to ai_api_key and add ai_provider column
ALTER TABLE workspaces RENAME COLUMN openai_api_key TO ai_api_key;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS ai_provider TEXT NOT NULL DEFAULT 'openai';

-- ============================================================
-- MIGRATION 9: FIX BROADCAST RLS
-- ============================================================
-- Fix broadcast_recipients: add INSERT/UPDATE/DELETE policies
CREATE POLICY "Users can insert broadcast recipients" ON broadcast_recipients
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM broadcasts b
      WHERE b.id = broadcast_recipients.broadcast_id
        AND is_workspace_member(b.workspace_id)
    )
  );

CREATE POLICY "Users can update broadcast recipients" ON broadcast_recipients
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM broadcasts b
      WHERE b.id = broadcast_recipients.broadcast_id
        AND is_workspace_member(b.workspace_id)
    )
  );

-- Fix scheduled_jobs: add full CRUD policies for workspace members
-- Jobs are workspace-agnostic (system-level), so allow authenticated users
CREATE POLICY "Authenticated users can insert jobs" ON scheduled_jobs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can read jobs" ON scheduled_jobs
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update jobs" ON scheduled_jobs
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ============================================================
-- MIGRATION 10: FLOW VERSIONS
-- ============================================================
-- Flow version history: stores a snapshot of nodes/edges on each publish
create table flow_versions (
  id uuid primary key default uuid_generate_v4(),
  flow_id uuid not null references flows(id) on delete cascade,
  version integer not null,
  nodes jsonb not null,
  edges jsonb not null,
  viewport jsonb,
  name text not null,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (flow_id, version)
);

create index idx_flow_versions_flow on flow_versions(flow_id, version desc);

-- RLS
alter table flow_versions enable row level security;

create policy "flow_versions_select" on flow_versions for select
  using (exists (
    select 1 from flows f
    join workspace_members wm on wm.workspace_id = f.workspace_id
    where f.id = flow_versions.flow_id
      and wm.user_id = auth.uid()
  ));

create policy "flow_versions_insert" on flow_versions for insert
  with check (exists (
    select 1 from flows f
    join workspace_members wm on wm.workspace_id = f.workspace_id
    where f.id = flow_versions.flow_id
      and wm.user_id = auth.uid()
  ));

-- ============================================================
-- MIGRATION 11: WORKSPACE WEBHOOK SECRET
-- ============================================================
-- Add workspace-level webhook secret for Zernio HMAC signature verification.
-- Zernio exposes a single webhook per profile/API key, so the secret lives at the
-- workspace level (not per-channel). Used by /api/webhooks/late to verify signatures.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS webhook_secret TEXT;

-- ============================================================
-- MIGRATION 12: WEBHOOK EVENTS
-- ============================================================
-- Idempotency ledger for inbound Zernio webhook deliveries. Zernio retries a
-- delivery with the same event id whenever our 200 doesn't arrive within its 5s
-- timeout; /api/webhooks/late claims the id here before processing so retries
-- and redeliveries never re-run a flow (which was double-sending DMs).
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rows are only needed for the retry window (hours); allow cheap pruning.
CREATE INDEX IF NOT EXISTS webhook_events_received_at_idx ON webhook_events (received_at);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- MIGRATION 13: SEQUENCE ENROLLMENTS CHANNEL CASCADE
-- ============================================================
-- sequence_enrollments.channel_id was declared without an ON DELETE action
-- (00005_sequences.sql), so deleting a channel with enrollments failed with a
-- 23503 FK violation. Every other channel FK cascades (or sets null); align
-- this one so channel deletion works.
ALTER TABLE sequence_enrollments
  DROP CONSTRAINT sequence_enrollments_channel_id_fkey,
  ADD CONSTRAINT sequence_enrollments_channel_id_fkey
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE;

-- ============================================================
-- MIGRATION 14: SCHEDULED JOBS CLAIMED AT
-- ============================================================
-- The cron claims a job by flipping status to 'processing'. If that UPDATE
-- commits but the response is lost, the job is stranded: the fetch only read
-- 'pending' rows. claimed_at lets the cron reclaim 'processing' jobs whose
-- claim is older than a few minutes.
ALTER TABLE scheduled_jobs ADD COLUMN claimed_at timestamptz;

CREATE INDEX idx_scheduled_jobs_processing ON scheduled_jobs(claimed_at)
  WHERE status = 'processing';

-- ============================================================
-- MIGRATION 15: BACKFILL CLAIMED AT
-- ============================================================
-- 00014 added claimed_at but did not backfill rows already stuck in
-- 'processing', and old-code invocations claim without stamping it. Stamp
-- existing NULL claims so the cron's staleness clock (claimed_at older than
-- 5 minutes) applies to them; genuinely stranded rows become reclaimable
-- shortly after this runs, while a claim still live at migration time gets
-- the full window to finish before being reclaimed.
UPDATE scheduled_jobs
SET claimed_at = now()
WHERE status = 'processing' AND claimed_at IS NULL;

-- ============================================================
-- MIGRATION 16: WHATSAPP CHANNEL PLATFORM
-- ============================================================
-- WhatsApp was advertised on the site, offered in the channel picker and
-- already handled by the flow engine, but 00001's platform check constraint
-- never listed it, so the channel row could not be stored (issue #16).
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_platform_check;

ALTER TABLE channels ADD CONSTRAINT channels_platform_check
  CHECK (platform IN ('facebook', 'instagram', 'twitter', 'telegram', 'bluesky', 'reddit', 'whatsapp'));

-- ============================================================
-- MIGRATION 17: WORKSPACE CREATION AND INVITE ONLY SIGNUP
-- ============================================================
-- Creación segura de espacios de trabajo y registro solo por invitación.
--
-- 1. create_workspace(p_name): crear un segundo espacio desde el selector
--    fallaba porque `workspaces` no tiene política INSERT y la política INSERT
--    de `workspace_members` exige ser dueño de un espacio que aún no existe.
--    La función lo hace todo en una transacción, como el usuario autenticado.
-- 2. handle_new_user(): el registro deja de crear un espacio para cualquiera.
--    Solo se permite crear una cuenta si hay una invitación pendiente y
--    vigente para ese correo, o si es la primera persona de la instalación.
-- 3. auth_user_exists(p_email): para que la página de invitación sepa si
--    ofrecer "Iniciar sesión" o "Crea tu cuenta". Solo service_role.
--
-- Aplicar en cada base (tienda y gimnasio).

-- ------------------------------------------------------------
-- 1. create_workspace
-- ------------------------------------------------------------
create or replace function public.create_workspace(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_base text;
  v_slug text;
  v_ws_id uuid;
  v_try int := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'workspace_name_required' using errcode = '22023';
  end if;

  if char_length(v_name) > 100 then
    raise exception 'workspace_name_too_long' using errcode = '22023';
  end if;

  -- Slug a partir del nombre: minúsculas, sin tildes, solo [a-z0-9-].
  v_base := translate(
    lower(v_name),
    'áàäâãéèëêíìïîóòöôõúùüûñç',
    'aaaaaeeeeiiiiooooouuuunc'
  );
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  v_base := btrim(left(btrim(v_base, '-'), 50), '-');
  if v_base = '' then
    v_base := 'espacio';
  end if;

  -- Si el slug ya existe se agrega un sufijo numérico (-2, -3, ...). El
  -- bloque con excepción también cubre dos creaciones simultáneas.
  loop
    v_slug := case when v_try = 0 then v_base else v_base || '-' || (v_try + 1) end;
    if v_try >= 50 then
      v_slug := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    end if;

    begin
      insert into public.workspaces (name, slug)
      values (v_name, v_slug)
      returning id into v_ws_id;
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 60 then
        raise;
      end if;
    end;
  end loop;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws_id, v_uid, 'owner');

  return v_ws_id;
end;
$$;

revoke all on function public.create_workspace(text) from public;
revoke all on function public.create_workspace(text) from anon;
grant execute on function public.create_workspace(text) to authenticated;

-- ------------------------------------------------------------
-- 2. handle_new_user: registro solo por invitación
-- ------------------------------------------------------------
create index if not exists idx_workspace_invites_pending_email_lower
  on public.workspace_invites (lower(email))
  where status = 'pending';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_id uuid;
  user_name text;
  workspace_slug text;
begin
  -- a) Persona invitada: no se crea espacio propio. La membresía la agrega el
  --    flujo de invitación (/invite/<id>) con el rol de la invitación.
  if exists (
    select 1
    from public.workspace_invites wi
    where lower(wi.email) = lower(new.email)
      and wi.status = 'pending'
      and wi.expires_at > now()
  ) then
    return new;
  end if;

  -- b) Primera persona de la instalación: se crea su espacio y queda de dueña.
  --    El bloqueo evita que dos registros simultáneos pasen ambos este control.
  perform pg_advisory_xact_lock(hashtext('public.handle_new_user:first_workspace'));

  if not exists (select 1 from public.workspaces) then
    user_name := coalesce(
      nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data->>'name'), ''),
      split_part(new.email, '@', 1)
    );
    workspace_slug := lower(regexp_replace(user_name, '[^a-zA-Z0-9]', '-', 'g'))
      || '-' || substr(new.id::text, 1, 8);

    insert into public.workspaces (name, slug)
    values ('Espacio de ' || user_name, workspace_slug)
    returning id into ws_id;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (ws_id, new.id, 'owner');

    return new;
  end if;

  -- c) Cualquier otro caso: se rechaza el registro. Sin bloque EXCEPTION a
  --    propósito, para que el error llegue a Supabase Auth y la cuenta no se
  --    cree. (Auth suele responder "Database error saving new user".)
  raise exception 'signup_requires_invite'
    using errcode = 'P0001',
          hint = 'El registro es solo por invitación.';
end;
$$;

-- El trigger on_auth_user_created (00001) ya apunta a esta función; create or
-- replace la actualiza sin tener que recrearlo.

-- ------------------------------------------------------------
-- 3. auth_user_exists (solo service_role)
-- ------------------------------------------------------------
create or replace function public.auth_user_exists(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    where lower(u.email) = lower(btrim(coalesce(p_email, '')))
  );
$$;

revoke all on function public.auth_user_exists(text) from public;
revoke all on function public.auth_user_exists(text) from anon;
revoke all on function public.auth_user_exists(text) from authenticated;
grant execute on function public.auth_user_exists(text) to service_role;

-- ============================================================
-- MIGRATION 18: APP MAIL SETTINGS
-- ============================================================
-- Configuración del correo saliente de la app (SMTP propio).
--
-- Una sola fila (id = 1) por instalación. La edita el Dueño o un Administrador
-- desde Configuración → Correo; el servidor valida el rol y escribe con la
-- clave de servicio. RLS activado sin políticas: anon y authenticated no
-- pueden leer ni escribir nada, solo service_role (que ignora RLS).
--
-- password_encrypted guarda la contraseña o token SMTP cifrado con
-- AES-256-GCM (clave derivada por HKDF de SUPABASE_SERVICE_ROLE_KEY, ver
-- lib/mail/crypto.ts). Nunca se guarda en claro.
--
-- Aplicar en cada base (tienda y gimnasio).

create table if not exists public.app_mail_settings (
  id smallint primary key default 1 check (id = 1),
  host text,
  port integer check (port is null or port between 1 and 65535),
  security text check (security is null or security in ('starttls', 'ssl')),
  username text,
  password_encrypted text,
  from_email text,
  from_name text,
  last_error text,
  last_error_at timestamptz,
  last_success_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_mail_settings enable row level security;

revoke all on table public.app_mail_settings from public;
revoke all on table public.app_mail_settings from anon;
revoke all on table public.app_mail_settings from authenticated;
grant select, insert, update, delete on table public.app_mail_settings to service_role;

-- ============================================================
-- MIGRATION 19: FASE 1 CASES TEAMS PERMISSIONS
-- ============================================================
-- Fase 1: gestiones, equipos, permisos y secretos (docs/FASE-1-TECNICO.md 1, 2 y 2.4).
--
-- 1. Modelo de datos: tipos de contacto, tipos de gestión con etapas,
--    categorías, motivos y reglas; equipos y miembros de equipo; gestiones
--    (cases), notas internas, registro de actividad, notificaciones,
--    respuestas guardadas y columnas nuevas en contacts, workspaces y
--    workspace_members.
-- 2. Permisos: funciones security definer (sin recursión de RLS) y políticas
--    nuevas por rol (Dueño/Administrador, supervisor de equipo, asesor).
-- 3. Secretos: late_api_key_encrypted, ai_api_key y webhook_secret pasan de
--    workspaces (legible por cualquier miembro) a workspace_secrets (solo
--    service_role). Las columnas viejas quedan vacías, sin borrarse.
--
-- Idempotente en lo posible: se puede volver a ejecutar sin romper nada.
-- Aplicar en cada base (tienda y gimnasio), junto con el despliegue del código
-- que lee los secretos desde workspace_secrets (lib/workspace-secrets.ts).

-- ============================================================
-- 0. Funciones base
-- ============================================================

-- Se redefine con search_path fijo (misma firma y nombre de parámetro que 00002).
create or replace function public.is_workspace_member(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
  );
$$;

-- ============================================================
-- 1.2 Equipos (antes que 1.1 porque case_types.fixed_team_id los referencia)
-- ============================================================

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  is_default boolean not null default false,
  assignment_mode text not null default 'round_robin'
    check (assignment_mode in ('round_robin', 'least_load', 'manual')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_teams_workspace on public.teams(workspace_id);
-- Un solo equipo por defecto activo por espacio.
create unique index if not exists uq_teams_one_default
  on public.teams(workspace_id) where is_default and archived_at is null;

create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'agent' check (role in ('supervisor', 'agent')),
  -- null = atiende todos los tipos de gestión
  case_type_ids uuid[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists idx_team_members_user on public.team_members(user_id);

-- ============================================================
-- 1.1 Configuración
-- ============================================================

create table if not exists public.contact_types (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  color text,
  position integer not null default 0,
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_contact_types_workspace on public.contact_types(workspace_id, position);
create unique index if not exists uq_contact_types_one_default
  on public.contact_types(workspace_id) where is_default and archived_at is null;

create table if not exists public.case_types (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  color text,
  icon text,
  position integer not null default 0,
  is_proactive boolean not null default false,
  -- tipo sugerido al abrir una gestión entrante según el tipo de contacto
  suggested_for_contact_type_ids uuid[] not null default '{}',
  routing text not null default 'contact_owner'
    check (routing in ('contact_owner', 'contact_team', 'fixed_team')),
  fixed_team_id uuid references public.teams(id) on delete set null,
  sla_first_response_minutes integer check (sla_first_response_minutes is null or sla_first_response_minutes > 0),
  sla_resolution_hours integer check (sla_resolution_hours is null or sla_resolution_hours > 0),
  require_category boolean not null default false,
  require_outcome_reason boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_case_types_workspace on public.case_types(workspace_id, position);
create index if not exists idx_case_types_fixed_team on public.case_types(fixed_team_id);

create table if not exists public.case_stages (
  id uuid primary key default gen_random_uuid(),
  case_type_id uuid not null references public.case_types(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  color text,
  position integer not null default 0,
  kind text not null default 'open' check (kind in ('open', 'won', 'lost', 'resolved')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_case_stages_type on public.case_stages(case_type_id, position);

create table if not exists public.case_categories (
  id uuid primary key default gen_random_uuid(),
  case_type_id uuid not null references public.case_types(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  position integer not null default 0,
  is_high_priority boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_case_categories_type on public.case_categories(case_type_id, position);

create table if not exists public.case_outcome_reasons (
  id uuid primary key default gen_random_uuid(),
  case_type_id uuid not null references public.case_types(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  kind text not null check (kind in ('won', 'lost', 'resolved')),
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_case_outcome_reasons_type on public.case_outcome_reasons(case_type_id, position);

create table if not exists public.case_rules (
  id uuid primary key default gen_random_uuid(),
  case_type_id uuid not null references public.case_types(id) on delete cascade,
  position integer not null default 0,
  enabled boolean not null default true,
  trigger text not null check (trigger in ('on_open', 'on_stage', 'on_won', 'on_lost', 'on_resolved')),
  trigger_stage_id uuid references public.case_stages(id) on delete cascade,
  -- { category_id?, outcome_reason_id?, contact_type_id? }
  condition jsonb not null default '{}'::jsonb check (jsonb_typeof(condition) = 'object'),
  action text not null check (action in ('set_contact_type', 'schedule_case', 'ask_key_date')),
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_rules_stage_trigger_check
    check (trigger <> 'on_stage' or trigger_stage_id is not null)
);

create index if not exists idx_case_rules_type on public.case_rules(case_type_id, position);
create index if not exists idx_case_rules_stage on public.case_rules(trigger_stage_id);

-- ============================================================
-- 1.2 Columnas nuevas en workspace_members y workspaces
-- ============================================================

-- Normaliza los roles existentes antes de poner el check. Valores conocidos
-- en migraciones previas: 'owner' (00001, 00017), 'member' (00006) y 'admin'
-- (lib/actions/team.ts). Cualquier otro valor pasa a 'member' (el menor).
update public.workspace_members
  set role = lower(btrim(role))
  where role <> lower(btrim(role));

update public.workspace_members
  set role = 'member'
  where role is null or role not in ('owner', 'admin', 'member');

alter table public.workspace_members
  drop constraint if exists workspace_members_role_check;
alter table public.workspace_members
  add constraint workspace_members_role_check check (role in ('owner', 'admin', 'member'));

-- 'owner' por defecto era peligroso: quien insertara sin rol quedaba de dueño.
-- create_workspace, handle_new_user y lib/actions/team.ts pasan el rol explícito.
alter table public.workspace_members alter column role set default 'member';

alter table public.workspace_members
  add column if not exists availability text not null default 'available',
  add column if not exists last_assigned_at timestamptz;

alter table public.workspace_members
  drop constraint if exists workspace_members_availability_check;
alter table public.workspace_members
  add constraint workspace_members_availability_check check (availability in ('available', 'away'));

alter table public.workspaces
  add column if not exists settings jsonb not null default '{}'::jsonb;

-- { agent_visibility, assignment_mode, business_template, key_date_label }
alter table public.workspaces drop constraint if exists workspaces_settings_check;
alter table public.workspaces
  add constraint workspaces_settings_check check (
    jsonb_typeof(settings) = 'object'
    and coalesce(settings->>'agent_visibility', 'own') in ('own', 'own_and_unassigned', 'team')
    and coalesce(settings->>'assignment_mode', 'round_robin') in ('round_robin', 'least_load', 'manual')
    and coalesce(settings->>'business_template', 'blank') in ('ecommerce', 'gym', 'general', 'blank')
  );

-- ============================================================
-- 1.3 Contactos, gestiones y registro
-- ============================================================

alter table public.contacts
  add column if not exists contact_type_id uuid references public.contact_types(id) on delete set null,
  add column if not exists team_id uuid references public.teams(id) on delete set null,
  add column if not exists owner_id uuid references auth.users(id) on delete set null,
  add column if not exists source jsonb not null default '{}'::jsonb,
  add column if not exists phone text,
  add column if not exists key_date date;

create index if not exists idx_contacts_contact_type on public.contacts(contact_type_id);
create index if not exists idx_contacts_team on public.contacts(team_id);
create index if not exists idx_contacts_owner on public.contacts(owner_id);
create index if not exists idx_contacts_key_date on public.contacts(workspace_id, key_date) where key_date is not null;

create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  -- null = "Sin clasificar"
  case_type_id uuid references public.case_types(id) on delete set null,
  stage_id uuid references public.case_stages(id) on delete set null,
  category_id uuid references public.case_categories(id) on delete set null,
  status text not null default 'open'
    check (status in ('scheduled', 'open', 'won', 'lost', 'resolved', 'cancelled')),
  team_id uuid references public.teams(id) on delete set null,
  assignee_id uuid references auth.users(id) on delete set null,
  origin text not null default 'inbound' check (origin in ('inbound', 'proactive', 'manual')),
  -- proactivas: se activan en esta fecha
  scheduled_for timestamptz,
  opened_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  waiting_since timestamptz,
  first_response_at timestamptz,
  next_action_at timestamptz,
  next_action_note text,
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  outcome_reason_id uuid references public.case_outcome_reasons(id) on delete set null,
  outcome_note text,
  legal_due_at timestamptz,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cases_scheduled_requires_date
    check (status <> 'scheduled' or scheduled_for is not null),
  constraint cases_closed_requires_closed_at
    check (status not in ('won', 'lost', 'resolved', 'cancelled') or closed_at is not null)
);

create index if not exists idx_cases_workspace_status on public.cases(workspace_id, status);
create index if not exists idx_cases_assignee_status on public.cases(assignee_id, status);
create index if not exists idx_cases_contact_status on public.cases(contact_id, status);
create index if not exists idx_cases_status_scheduled on public.cases(status, scheduled_for);
create index if not exists idx_cases_next_action on public.cases(next_action_at) where next_action_at is not null;
create index if not exists idx_cases_team_status on public.cases(team_id, status);
create index if not exists idx_cases_case_type on public.cases(case_type_id);
create index if not exists idx_cases_stage on public.cases(stage_id);
create index if not exists idx_cases_category on public.cases(category_id);
create index if not exists idx_cases_outcome_reason on public.cases(outcome_reason_id);
create index if not exists idx_cases_waiting on public.cases(workspace_id, waiting_since) where status = 'open';

create table if not exists public.case_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  author_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(btrim(body)) > 0),
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_case_notes_case on public.case_notes(case_id, created_at);
create index if not exists idx_case_notes_contact on public.case_notes(contact_id, created_at);
create index if not exists idx_case_notes_conversation on public.case_notes(conversation_id);

create table if not exists public.activity (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  type text not null,
  -- null = sistema o bot
  actor_id uuid references auth.users(id) on delete set null,
  from_value text,
  to_value text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_activity_workspace_created on public.activity(workspace_id, created_at desc);
create index if not exists idx_activity_case on public.activity(case_id);
create index if not exists idx_activity_contact on public.activity(contact_id, created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_read on public.notifications(user_id, read_at);
create index if not exists idx_notifications_user_created on public.notifications(user_id, created_at desc);
create index if not exists idx_notifications_workspace on public.notifications(workspace_id);

create table if not exists public.saved_replies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  scope text not null check (scope in ('workspace', 'team', 'personal')),
  team_id uuid references public.teams(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  case_type_id uuid references public.case_types(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  shortcut text,
  body text not null,
  attachment_url text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_replies_scope_target_check check (
    (scope <> 'team' or team_id is not null)
    and (scope <> 'personal' or user_id is not null)
  )
);

create index if not exists idx_saved_replies_workspace on public.saved_replies(workspace_id, scope);
create index if not exists idx_saved_replies_team on public.saved_replies(team_id);
create index if not exists idx_saved_replies_user on public.saved_replies(user_id);
create index if not exists idx_saved_replies_case_type on public.saved_replies(case_type_id);

-- ============================================================
-- 2.4 Secretos
-- ============================================================

create table if not exists public.workspace_secrets (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  late_api_key text,
  ai_api_key text,
  webhook_secret text,
  updated_at timestamptz not null default now()
);

-- RLS activado sin políticas y sin privilegios para anon/authenticated:
-- solo service_role (que ignora RLS) lee y escribe.
alter table public.workspace_secrets enable row level security;
revoke all on table public.workspace_secrets from public;
revoke all on table public.workspace_secrets from anon;
revoke all on table public.workspace_secrets from authenticated;
grant select, insert, update, delete on table public.workspace_secrets to service_role;

-- Copia los datos actuales. Si ya existe la fila (re-ejecución), no pisa un
-- valor ya guardado en workspace_secrets.
insert into public.workspace_secrets (workspace_id, late_api_key, ai_api_key, webhook_secret)
select w.id, w.late_api_key_encrypted, w.ai_api_key, w.webhook_secret
from public.workspaces w
on conflict (workspace_id) do update set
  late_api_key = coalesce(public.workspace_secrets.late_api_key, excluded.late_api_key),
  ai_api_key = coalesce(public.workspace_secrets.ai_api_key, excluded.ai_api_key),
  webhook_secret = coalesce(public.workspace_secrets.webhook_secret, excluded.webhook_secret),
  updated_at = now();

-- Vacía las columnas viejas (no se borran todavía).
update public.workspaces
  set late_api_key_encrypted = null, ai_api_key = null, webhook_secret = null
  where late_api_key_encrypted is not null or ai_api_key is not null or webhook_secret is not null;

-- Impide que vuelvan a llenarse: cualquier miembro puede leer workspaces.
-- (Para revertir hay que quitar este constraint.)
alter table public.workspaces drop constraint if exists workspaces_legacy_secrets_empty;
alter table public.workspaces
  add constraint workspaces_legacy_secrets_empty check (
    late_api_key_encrypted is null and ai_api_key is null and webhook_secret is null
  );

-- Cada espacio nuevo (create_workspace, handle_new_user) nace con su fila de
-- secretos. El helper del servidor también hace upsert al guardar.
create or replace function public.create_workspace_secrets_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspace_secrets (workspace_id)
  values (new.id)
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

revoke all on function public.create_workspace_secrets_row() from public, anon, authenticated;

drop trigger if exists create_workspace_secrets_row on public.workspaces;
create trigger create_workspace_secrets_row
  after insert on public.workspaces
  for each row execute function public.create_workspace_secrets_row();

-- ============================================================
-- updated_at
-- ============================================================

drop trigger if exists set_updated_at on public.teams;
create trigger set_updated_at before update on public.teams for each row execute function update_updated_at();
drop trigger if exists set_updated_at on public.team_members;
create trigger set_updated_at before update on public.team_members for each row execute function update_updated_at();
drop trigger if exists set_updated_at on public.contact_types;
create trigger set_updated_at before update on public.contact_types for each row execute function update_updated_at();
drop trigger if exists set_updated_at on public.case_types;
create trigger set_updated_at before update on public.case_types for each row execute function update_updated_at();
drop trigger if exists set_updated_at on public.case_stages;
create trigger set_updated_at before update on public.case_stages for each row execute function update_updated_at();
drop trigger if exists set_updated_at on public.case_categories;
create trigger set_updated_at before update on public.case_categories for each row execute function update_updated_at();
drop trigger if exists set_updated_at on public.case_outcome_reasons;
create trigger set_updated_at before update on public.case_outcome_reasons for each row execute function update_updated_at();
drop trigger if exists set_updated_at on public.case_rules;
create trigger set_updated_at before update on public.case_rules for each row execute function update_updated_at();
drop trigger if exists set_updated_at on public.cases;
create trigger set_updated_at before update on public.cases for each row execute function update_updated_at();
drop trigger if exists set_updated_at on public.saved_replies;
create trigger set_updated_at before update on public.saved_replies for each row execute function update_updated_at();
drop trigger if exists set_updated_at on public.workspace_secrets;
create trigger set_updated_at before update on public.workspace_secrets for each row execute function update_updated_at();

-- ============================================================
-- Realtime
-- ============================================================

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['cases', 'case_notes', 'notifications'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

-- ============================================================
-- 2.1 Funciones de permisos
-- ============================================================
-- Todas security definer + stable + search_path fijo. Leen las tablas como
-- su dueño (sin RLS), así que usarlas dentro de políticas no provoca
-- recursión, incluida la de workspace_members.

-- Rol del usuario actual en el espacio, o null si no es miembro.
create or replace function public.ws_role(ws uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = ws and wm.user_id = auth.uid();
$$;

-- Dueño o Administrador del espacio.
create or replace function public.is_ws_admin(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = ws
      and wm.user_id = auth.uid()
      and wm.role in ('owner', 'admin')
  );
$$;

-- ¿El espacio tiene equipos activos (no archivados)?
create or replace function public.ws_has_teams(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.teams t
    where t.workspace_id = ws and t.archived_at is null
  );
$$;

-- ¿Soy miembro (supervisor o asesor) de este equipo activo? Exige además
-- seguir siendo miembro del espacio del equipo.
create or replace function public.is_team_member(team uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    join public.workspace_members wm
      on wm.workspace_id = t.workspace_id and wm.user_id = tm.user_id
    where tm.team_id = team
      and tm.user_id = auth.uid()
      and t.archived_at is null
  );
$$;

create or replace function public.is_team_supervisor(team uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    join public.workspace_members wm
      on wm.workspace_id = t.workspace_id and wm.user_id = tm.user_id
    where tm.team_id = team
      and tm.user_id = auth.uid()
      and tm.role = 'supervisor'
      and t.archived_at is null
  );
$$;

-- Regla 2.1 a partir de los datos de la fila del contacto. La usa la política
-- de contacts (evita volver a leer el contacto y funciona en INSERT ...
-- RETURNING, donde la fila nueva aún no es visible para una función stable).
-- Replicada en TypeScript en lib/permissions.ts (contactVisibilityReason).
create or replace function public.can_see_contact_row(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_owner_id uuid,
  p_team_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_visibility text;
  v_has_teams boolean;
begin
  if v_uid is null or p_workspace_id is null then
    return false;
  end if;

  select wm.role into v_role
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id and wm.user_id = v_uid;

  if v_role is null then
    return false;
  end if;

  -- 1. Administrador del espacio.
  if v_role in ('owner', 'admin') then
    return true;
  end if;

  -- 2. Tiene una gestión no cerrada asignada a mí.
  if p_contact_id is not null and exists (
    select 1 from public.cases c
    where c.contact_id = p_contact_id
      and c.assignee_id = v_uid
      and c.status in ('scheduled', 'open')
  ) then
    return true;
  end if;

  -- 3. Soy su responsable.
  if p_owner_id is not null and p_owner_id = v_uid then
    return true;
  end if;

  -- 4. Soy supervisor del equipo del contacto, o del equipo de una de sus
  --    gestiones no cerradas (p. ej. una Postventa enviada a un equipo fijo).
  if exists (
    select 1
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.user_id = v_uid
      and tm.role = 'supervisor'
      and t.workspace_id = p_workspace_id
      and t.archived_at is null
      and (
        t.id = p_team_id
        or exists (
          select 1 from public.cases c
          where c.contact_id = p_contact_id
            and c.team_id = t.id
            and c.status in ('scheduled', 'open')
        )
      )
  ) then
    return true;
  end if;

  -- 5. Según la visibilidad configurada para asesores.
  select coalesce(w.settings->>'agent_visibility', 'own') into v_visibility
  from public.workspaces w
  where w.id = p_workspace_id;

  if v_visibility is null or v_visibility not in ('own_and_unassigned', 'team') then
    return false; -- 'own': nada más
  end if;

  v_has_teams := exists (
    select 1 from public.teams t
    where t.workspace_id = p_workspace_id and t.archived_at is null
  );

  if v_visibility = 'own_and_unassigned' then
    if v_has_teams then
      -- Gestión abierta sin asignar cuyo equipo es uno de los míos.
      return exists (
        select 1
        from public.cases c
        join public.teams t on t.id = c.team_id and t.archived_at is null
        join public.team_members tm on tm.team_id = t.id and tm.user_id = v_uid
        where c.contact_id = p_contact_id
          and c.status = 'open'
          and c.assignee_id is null
      );
    end if;
    -- Sin equipos: cualquier gestión abierta sin asignar del espacio.
    return exists (
      select 1 from public.cases c
      where c.contact_id = p_contact_id
        and c.status = 'open'
        and c.assignee_id is null
    );
  end if;

  -- 'team'
  if not v_has_teams then
    return true; -- sin equipos: todo el espacio (como antes de la fase 1)
  end if;

  return exists (
    select 1
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.user_id = v_uid
      and t.workspace_id = p_workspace_id
      and t.archived_at is null
      and (
        t.id = p_team_id
        or exists (
          select 1 from public.cases c
          where c.contact_id = p_contact_id
            and c.team_id = t.id
            and c.status in ('scheduled', 'open')
        )
      )
  );
end;
$$;

-- Versión por id, para las tablas hijas (conversaciones, gestiones, notas...).
create or replace function public.can_see_contact(contact_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.can_see_contact_row(c.workspace_id, c.id, c.owner_id, c.team_id)
    from public.contacts c
    where c.id = can_see_contact.contact_id
  ), false);
$$;

-- ============================================================
-- Triggers de integridad y permisos por columna
-- ============================================================

-- Un miembro de equipo tiene que ser miembro del espacio del equipo.
create or replace function public.check_team_member_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.teams t
    join public.workspace_members wm on wm.workspace_id = t.workspace_id
    where t.id = new.team_id and wm.user_id = new.user_id
  ) then
    raise exception 'team_member_not_in_workspace'
      using errcode = '23514',
            hint = 'La persona debe ser miembro del espacio de trabajo del equipo.';
  end if;
  return new;
end;
$$;

revoke all on function public.check_team_member_workspace() from public, anon, authenticated;

drop trigger if exists check_team_member_workspace on public.team_members;
create trigger check_team_member_workspace
  before insert or update of team_id, user_id on public.team_members
  for each row execute function public.check_team_member_workspace();

-- Quien sale del espacio sale también de sus equipos.
create or replace function public.cleanup_team_members_on_member_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.team_members tm
  using public.teams t
  where t.id = tm.team_id
    and t.workspace_id = old.workspace_id
    and tm.user_id = old.user_id;
  return old;
end;
$$;

revoke all on function public.cleanup_team_members_on_member_delete() from public, anon, authenticated;

drop trigger if exists cleanup_team_members_on_member_delete on public.workspace_members;
create trigger cleanup_team_members_on_member_delete
  after delete on public.workspace_members
  for each row execute function public.cleanup_team_members_on_member_delete();

-- workspace_members: con el cliente del usuario, cada uno solo cambia su
-- disponibilidad; un administrador además puede cambiar el rol de otros
-- (nunca a 'owner' ni el del dueño). El cliente de servicio (sin auth.uid())
-- no tiene restricciones.
create or replace function public.guard_workspace_member_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return new;
  end if;

  if new.workspace_id is distinct from old.workspace_id
     or new.user_id is distinct from old.user_id
     or new.created_at is distinct from old.created_at
     or new.last_assigned_at is distinct from old.last_assigned_at then
    raise exception 'workspace_member_column_not_editable' using errcode = '42501';
  end if;

  if new.role is distinct from old.role then
    if not public.is_ws_admin(old.workspace_id)
       or old.role = 'owner'
       or new.role = 'owner' then
      raise exception 'workspace_member_role_not_editable' using errcode = '42501';
    end if;
  end if;

  if new.availability is distinct from old.availability
     and old.user_id <> v_uid
     and not public.is_ws_admin(old.workspace_id) then
    raise exception 'workspace_member_availability_not_editable' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_workspace_member_update() from public, anon, authenticated;

drop trigger if exists guard_workspace_member_update on public.workspace_members;
create trigger guard_workspace_member_update
  before update on public.workspace_members
  for each row execute function public.guard_workspace_member_update();

-- contacts: el responsable y el equipo definen quién ve el contacto. Con el
-- cliente del usuario solo los cambia un administrador; las acciones del
-- servidor (cliente de servicio) validan permisos en código.
create or replace function public.guard_contact_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'contact_workspace_not_editable' using errcode = '42501';
  end if;

  if (new.owner_id is distinct from old.owner_id or new.team_id is distinct from old.team_id)
     and not public.is_ws_admin(old.workspace_id) then
    raise exception 'contact_owner_team_admin_only'
      using errcode = '42501',
            hint = 'Solo un administrador puede cambiar el responsable o el equipo del contacto.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_contact_update() from public, anon, authenticated;

drop trigger if exists guard_contact_update on public.contacts;
create trigger guard_contact_update
  before update on public.contacts
  for each row execute function public.guard_contact_update();

-- ============================================================
-- 2.2 Políticas
-- ============================================================

-- ---------- workspaces: leer miembros, escribir administrador ----------
alter table public.workspaces enable row level security;
drop policy if exists "Users can view their workspaces" on public.workspaces;
drop policy if exists "Users can update their workspaces" on public.workspaces;
drop policy if exists workspaces_select on public.workspaces;
drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_select on public.workspaces
  for select using (public.is_workspace_member(id));
create policy workspaces_update on public.workspaces
  for update using (public.is_ws_admin(id)) with check (public.is_ws_admin(id));

-- ---------- workspace_members ----------
alter table public.workspace_members enable row level security;
drop policy if exists "Members can view their workspace memberships" on public.workspace_members;
drop policy if exists "Owners can insert members" on public.workspace_members;
drop policy if exists "Owners can update members" on public.workspace_members;
drop policy if exists "Owners can delete members" on public.workspace_members;
drop policy if exists workspace_members_select on public.workspace_members;
drop policy if exists workspace_members_insert on public.workspace_members;
drop policy if exists workspace_members_update on public.workspace_members;
drop policy if exists workspace_members_delete on public.workspace_members;
-- user_id = auth.uid() primero: camino barato y sin funciones para la fila propia.
create policy workspace_members_select on public.workspace_members
  for select using (user_id = auth.uid() or public.is_workspace_member(workspace_id));
create policy workspace_members_insert on public.workspace_members
  for insert with check (public.is_ws_admin(workspace_id) and role <> 'owner');
-- Cada uno su fila (solo availability, ver guard_workspace_member_update);
-- el administrador las de los demás salvo la del dueño.
create policy workspace_members_update on public.workspace_members
  for update
  using (user_id = auth.uid() or (public.is_ws_admin(workspace_id) and role <> 'owner'))
  with check (user_id = auth.uid() or (public.is_ws_admin(workspace_id) and role <> 'owner'));
create policy workspace_members_delete on public.workspace_members
  for delete using (
    public.is_ws_admin(workspace_id) and role <> 'owner' and user_id <> auth.uid()
  );

-- ---------- workspace_secrets: sin políticas (solo service_role) ----------

-- ---------- channels: leer miembros, escribir administrador ----------
alter table public.channels enable row level security;
drop policy if exists "Users can view channels in their workspaces" on public.channels;
drop policy if exists "Users can manage channels in their workspaces" on public.channels;
drop policy if exists channels_select on public.channels;
drop policy if exists channels_insert on public.channels;
drop policy if exists channels_update on public.channels;
drop policy if exists channels_delete on public.channels;
create policy channels_select on public.channels
  for select using (public.is_workspace_member(workspace_id));
create policy channels_insert on public.channels
  for insert with check (public.is_ws_admin(workspace_id));
create policy channels_update on public.channels
  for update using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));
create policy channels_delete on public.channels
  for delete using (public.is_ws_admin(workspace_id));

-- ---------- contacts ----------
alter table public.contacts enable row level security;
drop policy if exists "Users can view contacts in their workspaces" on public.contacts;
drop policy if exists "Users can manage contacts in their workspaces" on public.contacts;
drop policy if exists contacts_select on public.contacts;
drop policy if exists contacts_insert on public.contacts;
drop policy if exists contacts_update on public.contacts;
drop policy if exists contacts_delete on public.contacts;
create policy contacts_select on public.contacts
  for select using (public.can_see_contact_row(workspace_id, id, owner_id, team_id));
create policy contacts_insert on public.contacts
  for insert with check (public.is_ws_admin(workspace_id));
create policy contacts_update on public.contacts
  for update
  using (public.can_see_contact_row(workspace_id, id, owner_id, team_id))
  with check (public.can_see_contact_row(workspace_id, id, owner_id, team_id));
create policy contacts_delete on public.contacts
  for delete using (public.is_ws_admin(workspace_id));

-- ---------- contact_channels: leer y actualizar si veo el contacto; crear y borrar administrador ----------
alter table public.contact_channels enable row level security;
drop policy if exists "Users can view contact channels via contact" on public.contact_channels;
drop policy if exists "Users can manage contact channels" on public.contact_channels;
drop policy if exists contact_channels_select on public.contact_channels;
drop policy if exists contact_channels_insert on public.contact_channels;
drop policy if exists contact_channels_update on public.contact_channels;
drop policy if exists contact_channels_delete on public.contact_channels;
create policy contact_channels_select on public.contact_channels
  for select using (public.can_see_contact(contact_id));
create policy contact_channels_insert on public.contact_channels
  for insert with check (
    exists (
      select 1
      from public.contacts c
      join public.channels ch on ch.workspace_id = c.workspace_id
      where c.id = contact_channels.contact_id
        and ch.id = contact_channels.channel_id
        and public.is_ws_admin(c.workspace_id)
    )
  );
create policy contact_channels_update on public.contact_channels
  for update
  using (public.can_see_contact(contact_id))
  with check (
    public.can_see_contact(contact_id)
    and exists (
      select 1
      from public.contacts c
      join public.channels ch on ch.workspace_id = c.workspace_id
      where c.id = contact_channels.contact_id and ch.id = contact_channels.channel_id
    )
  );
create policy contact_channels_delete on public.contact_channels
  for delete using (
    exists (
      select 1 from public.contacts c
      where c.id = contact_channels.contact_id and public.is_ws_admin(c.workspace_id)
    )
  );

-- ---------- contact_tags: quien ve el contacto puede poner y quitar etiquetas existentes ----------
alter table public.contact_tags enable row level security;
drop policy if exists "Users can view contact tags" on public.contact_tags;
drop policy if exists "Users can manage contact tags" on public.contact_tags;
drop policy if exists contact_tags_select on public.contact_tags;
drop policy if exists contact_tags_insert on public.contact_tags;
drop policy if exists contact_tags_update on public.contact_tags;
drop policy if exists contact_tags_delete on public.contact_tags;
create policy contact_tags_select on public.contact_tags
  for select using (public.can_see_contact(contact_id));
create policy contact_tags_insert on public.contact_tags
  for insert with check (
    public.can_see_contact(contact_id)
    and exists (
      select 1
      from public.contacts c
      join public.tags t on t.workspace_id = c.workspace_id
      where c.id = contact_tags.contact_id and t.id = contact_tags.tag_id
    )
  );
create policy contact_tags_update on public.contact_tags
  for update
  using (public.can_see_contact(contact_id))
  with check (
    public.can_see_contact(contact_id)
    and exists (
      select 1
      from public.contacts c
      join public.tags t on t.workspace_id = c.workspace_id
      where c.id = contact_tags.contact_id and t.id = contact_tags.tag_id
    )
  );
create policy contact_tags_delete on public.contact_tags
  for delete using (public.can_see_contact(contact_id));

-- ---------- contact_custom_fields: quien ve el contacto edita sus valores ----------
alter table public.contact_custom_fields enable row level security;
drop policy if exists "Users can view contact custom fields" on public.contact_custom_fields;
drop policy if exists "Users can manage contact custom fields" on public.contact_custom_fields;
drop policy if exists contact_custom_fields_select on public.contact_custom_fields;
drop policy if exists contact_custom_fields_insert on public.contact_custom_fields;
drop policy if exists contact_custom_fields_update on public.contact_custom_fields;
drop policy if exists contact_custom_fields_delete on public.contact_custom_fields;
create policy contact_custom_fields_select on public.contact_custom_fields
  for select using (public.can_see_contact(contact_id));
create policy contact_custom_fields_insert on public.contact_custom_fields
  for insert with check (
    public.can_see_contact(contact_id)
    and exists (
      select 1
      from public.contacts c
      join public.custom_field_definitions f on f.workspace_id = c.workspace_id
      where c.id = contact_custom_fields.contact_id and f.id = contact_custom_fields.field_id
    )
  );
create policy contact_custom_fields_update on public.contact_custom_fields
  for update
  using (public.can_see_contact(contact_id))
  with check (
    public.can_see_contact(contact_id)
    and exists (
      select 1
      from public.contacts c
      join public.custom_field_definitions f on f.workspace_id = c.workspace_id
      where c.id = contact_custom_fields.contact_id and f.id = contact_custom_fields.field_id
    )
  );
create policy contact_custom_fields_delete on public.contact_custom_fields
  for delete using (public.can_see_contact(contact_id));

-- ---------- tags y custom_field_definitions: leer miembros, escribir administrador ----------
alter table public.tags enable row level security;
drop policy if exists "Users can view tags in their workspaces" on public.tags;
drop policy if exists "Users can manage tags in their workspaces" on public.tags;
drop policy if exists tags_select on public.tags;
drop policy if exists tags_insert on public.tags;
drop policy if exists tags_update on public.tags;
drop policy if exists tags_delete on public.tags;
create policy tags_select on public.tags
  for select using (public.is_workspace_member(workspace_id));
create policy tags_insert on public.tags
  for insert with check (public.is_ws_admin(workspace_id));
create policy tags_update on public.tags
  for update using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));
create policy tags_delete on public.tags
  for delete using (public.is_ws_admin(workspace_id));

alter table public.custom_field_definitions enable row level security;
drop policy if exists "Users can view custom fields in their workspaces" on public.custom_field_definitions;
drop policy if exists "Users can manage custom fields in their workspaces" on public.custom_field_definitions;
drop policy if exists custom_field_definitions_select on public.custom_field_definitions;
drop policy if exists custom_field_definitions_insert on public.custom_field_definitions;
drop policy if exists custom_field_definitions_update on public.custom_field_definitions;
drop policy if exists custom_field_definitions_delete on public.custom_field_definitions;
create policy custom_field_definitions_select on public.custom_field_definitions
  for select using (public.is_workspace_member(workspace_id));
create policy custom_field_definitions_insert on public.custom_field_definitions
  for insert with check (public.is_ws_admin(workspace_id));
create policy custom_field_definitions_update on public.custom_field_definitions
  for update using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));
create policy custom_field_definitions_delete on public.custom_field_definitions
  for delete using (public.is_ws_admin(workspace_id));

-- ---------- flows, triggers, flow_versions: leer miembros, escribir administrador ----------
alter table public.flows enable row level security;
drop policy if exists "Users can view flows in their workspaces" on public.flows;
drop policy if exists "Users can manage flows in their workspaces" on public.flows;
drop policy if exists flows_select on public.flows;
drop policy if exists flows_insert on public.flows;
drop policy if exists flows_update on public.flows;
drop policy if exists flows_delete on public.flows;
create policy flows_select on public.flows
  for select using (public.is_workspace_member(workspace_id));
create policy flows_insert on public.flows
  for insert with check (public.is_ws_admin(workspace_id));
create policy flows_update on public.flows
  for update using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));
create policy flows_delete on public.flows
  for delete using (public.is_ws_admin(workspace_id));

alter table public.triggers enable row level security;
drop policy if exists "Users can view triggers via flow" on public.triggers;
drop policy if exists "Users can manage triggers via flow" on public.triggers;
drop policy if exists triggers_select on public.triggers;
drop policy if exists triggers_insert on public.triggers;
drop policy if exists triggers_update on public.triggers;
drop policy if exists triggers_delete on public.triggers;
create policy triggers_select on public.triggers
  for select using (
    exists (select 1 from public.flows f where f.id = triggers.flow_id and public.is_workspace_member(f.workspace_id))
  );
create policy triggers_insert on public.triggers
  for insert with check (
    exists (select 1 from public.flows f where f.id = triggers.flow_id and public.is_ws_admin(f.workspace_id))
  );
create policy triggers_update on public.triggers
  for update
  using (exists (select 1 from public.flows f where f.id = triggers.flow_id and public.is_ws_admin(f.workspace_id)))
  with check (exists (select 1 from public.flows f where f.id = triggers.flow_id and public.is_ws_admin(f.workspace_id)));
create policy triggers_delete on public.triggers
  for delete using (
    exists (select 1 from public.flows f where f.id = triggers.flow_id and public.is_ws_admin(f.workspace_id))
  );

alter table public.flow_versions enable row level security;
drop policy if exists flow_versions_select on public.flow_versions;
drop policy if exists flow_versions_insert on public.flow_versions;
create policy flow_versions_select on public.flow_versions
  for select using (
    exists (select 1 from public.flows f where f.id = flow_versions.flow_id and public.is_workspace_member(f.workspace_id))
  );
create policy flow_versions_insert on public.flow_versions
  for insert with check (
    exists (select 1 from public.flows f where f.id = flow_versions.flow_id and public.is_ws_admin(f.workspace_id))
  );

-- flow_sessions guarda variables del contacto: administrador o quien ve el contacto.
alter table public.flow_sessions enable row level security;
drop policy if exists "Users can view flow sessions via flow" on public.flow_sessions;
drop policy if exists flow_sessions_select on public.flow_sessions;
create policy flow_sessions_select on public.flow_sessions
  for select using (
    exists (
      select 1 from public.flows f
      where f.id = flow_sessions.flow_id
        and (public.is_ws_admin(f.workspace_id) or public.can_see_contact(flow_sessions.contact_id))
    )
  );

-- ---------- conversations y messages ----------
alter table public.conversations enable row level security;
drop policy if exists "Users can view conversations in their workspaces" on public.conversations;
drop policy if exists "Users can manage conversations in their workspaces" on public.conversations;
drop policy if exists conversations_select on public.conversations;
drop policy if exists conversations_insert on public.conversations;
drop policy if exists conversations_update on public.conversations;
drop policy if exists conversations_delete on public.conversations;
create policy conversations_select on public.conversations
  for select using (public.can_see_contact(contact_id));
-- Crear: administrador (sincronización de la bandeja); el webhook usa el cliente de servicio.
create policy conversations_insert on public.conversations
  for insert with check (public.is_ws_admin(workspace_id));
create policy conversations_update on public.conversations
  for update
  using (public.can_see_contact(contact_id))
  with check (public.can_see_contact(contact_id) and public.is_workspace_member(workspace_id));
create policy conversations_delete on public.conversations
  for delete using (public.is_ws_admin(workspace_id));

alter table public.messages enable row level security;
drop policy if exists "Users can view messages via conversation" on public.messages;
drop policy if exists "Users can insert messages via conversation" on public.messages;
drop policy if exists messages_select on public.messages;
drop policy if exists messages_insert on public.messages;
create policy messages_select on public.messages
  for select using (
    exists (
      select 1 from public.conversations conv
      where conv.id = messages.conversation_id and public.can_see_contact(conv.contact_id)
    )
  );
create policy messages_insert on public.messages
  for insert with check (
    exists (
      select 1 from public.conversations conv
      where conv.id = messages.conversation_id and public.can_see_contact(conv.contact_id)
    )
  );

-- ---------- cases y case_notes: leer si veo el contacto; escribir vía servidor ----------
alter table public.cases enable row level security;
drop policy if exists cases_select on public.cases;
create policy cases_select on public.cases
  for select using (public.can_see_contact(contact_id));
-- Sin políticas de escritura: el motor (lib/cases) escribe con el cliente de servicio.

alter table public.case_notes enable row level security;
drop policy if exists case_notes_select on public.case_notes;
drop policy if exists case_notes_insert on public.case_notes;
create policy case_notes_select on public.case_notes
  for select using (public.can_see_contact(contact_id));
create policy case_notes_insert on public.case_notes
  for insert with check (
    author_id = auth.uid()
    and public.can_see_contact(contact_id)
    and exists (
      select 1 from public.cases c
      where c.id = case_notes.case_id
        and c.contact_id = case_notes.contact_id
        and c.workspace_id = case_notes.workspace_id
    )
  );

-- ---------- activity: administrador o quien ve el contacto; escribe solo el servidor ----------
alter table public.activity enable row level security;
drop policy if exists activity_select on public.activity;
create policy activity_select on public.activity
  for select using (
    public.is_ws_admin(workspace_id)
    or (contact_id is not null and public.can_see_contact(contact_id))
  );

-- ---------- notifications: cada uno las suyas; solo puede marcar read_at ----------
alter table public.notifications enable row level security;
drop policy if exists notifications_select on public.notifications;
drop policy if exists notifications_update on public.notifications;
create policy notifications_select on public.notifications
  for select using (user_id = auth.uid());
create policy notifications_update on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, update, delete on table public.notifications from anon, authenticated;
grant update (read_at) on table public.notifications to authenticated;

-- ---------- configuración de gestiones y equipos: leer miembros, escribir administrador ----------
alter table public.contact_types enable row level security;
drop policy if exists contact_types_select on public.contact_types;
drop policy if exists contact_types_insert on public.contact_types;
drop policy if exists contact_types_update on public.contact_types;
drop policy if exists contact_types_delete on public.contact_types;
create policy contact_types_select on public.contact_types
  for select using (public.is_workspace_member(workspace_id));
create policy contact_types_insert on public.contact_types
  for insert with check (public.is_ws_admin(workspace_id));
create policy contact_types_update on public.contact_types
  for update using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));
create policy contact_types_delete on public.contact_types
  for delete using (public.is_ws_admin(workspace_id));

alter table public.case_types enable row level security;
drop policy if exists case_types_select on public.case_types;
drop policy if exists case_types_insert on public.case_types;
drop policy if exists case_types_update on public.case_types;
drop policy if exists case_types_delete on public.case_types;
create policy case_types_select on public.case_types
  for select using (public.is_workspace_member(workspace_id));
create policy case_types_insert on public.case_types
  for insert with check (public.is_ws_admin(workspace_id));
create policy case_types_update on public.case_types
  for update using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));
create policy case_types_delete on public.case_types
  for delete using (public.is_ws_admin(workspace_id));

-- Hijas de case_types (vía case_type_id).
do $$
declare
  t text;
begin
  foreach t in array array['case_stages', 'case_categories', 'case_outcome_reasons', 'case_rules'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for select using (exists (select 1 from public.case_types ct where ct.id = %I.case_type_id and public.is_workspace_member(ct.workspace_id)))',
      t || '_select', t, t);
    execute format(
      'create policy %I on public.%I for insert with check (exists (select 1 from public.case_types ct where ct.id = %I.case_type_id and public.is_ws_admin(ct.workspace_id)))',
      t || '_insert', t, t);
    execute format(
      'create policy %I on public.%I for update using (exists (select 1 from public.case_types ct where ct.id = %I.case_type_id and public.is_ws_admin(ct.workspace_id))) with check (exists (select 1 from public.case_types ct where ct.id = %I.case_type_id and public.is_ws_admin(ct.workspace_id)))',
      t || '_update', t, t, t);
    execute format(
      'create policy %I on public.%I for delete using (exists (select 1 from public.case_types ct where ct.id = %I.case_type_id and public.is_ws_admin(ct.workspace_id)))',
      t || '_delete', t, t);
  end loop;
end;
$$;

alter table public.teams enable row level security;
drop policy if exists teams_select on public.teams;
drop policy if exists teams_insert on public.teams;
drop policy if exists teams_update on public.teams;
drop policy if exists teams_delete on public.teams;
create policy teams_select on public.teams
  for select using (public.is_workspace_member(workspace_id));
create policy teams_insert on public.teams
  for insert with check (public.is_ws_admin(workspace_id));
create policy teams_update on public.teams
  for update using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));
create policy teams_delete on public.teams
  for delete using (public.is_ws_admin(workspace_id));

alter table public.team_members enable row level security;
drop policy if exists team_members_select on public.team_members;
drop policy if exists team_members_insert on public.team_members;
drop policy if exists team_members_update on public.team_members;
drop policy if exists team_members_delete on public.team_members;
create policy team_members_select on public.team_members
  for select using (
    exists (select 1 from public.teams t where t.id = team_members.team_id and public.is_workspace_member(t.workspace_id))
  );
create policy team_members_insert on public.team_members
  for insert with check (
    exists (select 1 from public.teams t where t.id = team_members.team_id and public.is_ws_admin(t.workspace_id))
  );
create policy team_members_update on public.team_members
  for update
  using (exists (select 1 from public.teams t where t.id = team_members.team_id and public.is_ws_admin(t.workspace_id)))
  with check (exists (select 1 from public.teams t where t.id = team_members.team_id and public.is_ws_admin(t.workspace_id)));
create policy team_members_delete on public.team_members
  for delete using (
    exists (select 1 from public.teams t where t.id = team_members.team_id and public.is_ws_admin(t.workspace_id))
  );

-- ---------- saved_replies ----------
-- workspace: leen miembros, escribe administrador.
-- team: leen miembros del equipo (y administradores), escriben supervisor del equipo y administradores.
-- personal: solo el autor.
alter table public.saved_replies enable row level security;
drop policy if exists saved_replies_select on public.saved_replies;
drop policy if exists saved_replies_insert on public.saved_replies;
drop policy if exists saved_replies_update on public.saved_replies;
drop policy if exists saved_replies_delete on public.saved_replies;
create policy saved_replies_select on public.saved_replies
  for select using (
    public.is_workspace_member(workspace_id)
    and (
      scope = 'workspace'
      or (scope = 'team' and (public.is_team_member(team_id) or public.is_ws_admin(workspace_id)))
      or (scope = 'personal' and user_id = auth.uid())
    )
  );
create policy saved_replies_insert on public.saved_replies
  for insert with check (
    public.is_workspace_member(workspace_id)
    and (team_id is null or exists (
      select 1 from public.teams t where t.id = saved_replies.team_id and t.workspace_id = saved_replies.workspace_id
    ))
    and (
      (scope = 'workspace' and public.is_ws_admin(workspace_id))
      or (scope = 'team' and (public.is_team_supervisor(team_id) or public.is_ws_admin(workspace_id)))
      or (scope = 'personal' and user_id = auth.uid())
    )
  );
create policy saved_replies_update on public.saved_replies
  for update
  using (
    (scope = 'workspace' and public.is_ws_admin(workspace_id))
    or (scope = 'team' and (public.is_team_supervisor(team_id) or public.is_ws_admin(workspace_id)))
    or (scope = 'personal' and user_id = auth.uid())
  )
  with check (
    public.is_workspace_member(workspace_id)
    and (team_id is null or exists (
      select 1 from public.teams t where t.id = saved_replies.team_id and t.workspace_id = saved_replies.workspace_id
    ))
    and (
      (scope = 'workspace' and public.is_ws_admin(workspace_id))
      or (scope = 'team' and (public.is_team_supervisor(team_id) or public.is_ws_admin(workspace_id)))
      or (scope = 'personal' and user_id = auth.uid())
    )
  );
create policy saved_replies_delete on public.saved_replies
  for delete using (
    (scope = 'workspace' and public.is_ws_admin(workspace_id))
    or (scope = 'team' and (public.is_team_supervisor(team_id) or public.is_ws_admin(workspace_id)))
    or (scope = 'personal' and user_id = auth.uid())
  );

-- ---------- broadcasts, broadcast_recipients, sequences, sequence_enrollments: solo administrador ----------
alter table public.broadcasts enable row level security;
drop policy if exists "Users can view broadcasts in their workspaces" on public.broadcasts;
drop policy if exists "Users can manage broadcasts in their workspaces" on public.broadcasts;
drop policy if exists broadcasts_admin on public.broadcasts;
create policy broadcasts_admin on public.broadcasts
  for all using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));

alter table public.broadcast_recipients enable row level security;
drop policy if exists "Users can view broadcast recipients" on public.broadcast_recipients;
drop policy if exists "Users can insert broadcast recipients" on public.broadcast_recipients;
drop policy if exists "Users can update broadcast recipients" on public.broadcast_recipients;
drop policy if exists broadcast_recipients_admin on public.broadcast_recipients;
create policy broadcast_recipients_admin on public.broadcast_recipients
  for all
  using (
    exists (select 1 from public.broadcasts b where b.id = broadcast_recipients.broadcast_id and public.is_ws_admin(b.workspace_id))
  )
  with check (
    exists (
      select 1
      from public.broadcasts b
      join public.contacts c on c.workspace_id = b.workspace_id
      join public.channels ch on ch.workspace_id = b.workspace_id
      where b.id = broadcast_recipients.broadcast_id
        and c.id = broadcast_recipients.contact_id
        and ch.id = broadcast_recipients.channel_id
        and public.is_ws_admin(b.workspace_id)
    )
  );

alter table public.sequences enable row level security;
drop policy if exists sequences_workspace on public.sequences;
drop policy if exists sequences_admin on public.sequences;
create policy sequences_admin on public.sequences
  for all using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));

alter table public.sequence_enrollments enable row level security;
drop policy if exists enrollments_via_sequence on public.sequence_enrollments;
drop policy if exists sequence_enrollments_admin on public.sequence_enrollments;
create policy sequence_enrollments_admin on public.sequence_enrollments
  for all
  using (
    exists (select 1 from public.sequences s where s.id = sequence_enrollments.sequence_id and public.is_ws_admin(s.workspace_id))
  )
  with check (
    exists (
      select 1
      from public.sequences s
      join public.contacts c on c.workspace_id = s.workspace_id
      join public.channels ch on ch.workspace_id = s.workspace_id
      where s.id = sequence_enrollments.sequence_id
        and c.id = sequence_enrollments.contact_id
        and ch.id = sequence_enrollments.channel_id
        and public.is_ws_admin(s.workspace_id)
    )
  );

-- ---------- scheduled_jobs: solo service_role ----------
-- 00009 dejaba a cualquier usuario autenticado leer, crear y modificar
-- trabajos de todas las empresas (el cron los ejecuta con la clave de
-- servicio). La difusión ahora programa sus envíos con el cliente de servicio
-- después de validar que quien llama es administrador.
drop policy if exists "Authenticated users can insert jobs" on public.scheduled_jobs;
drop policy if exists "Authenticated users can read jobs" on public.scheduled_jobs;
drop policy if exists "Authenticated users can update jobs" on public.scheduled_jobs;

-- ---------- RPC de contadores: solo service_role ----------
-- Son security definer sin validación: cualquiera podía alterar contadores
-- ajenos. Solo las llaman el webhook y el cron con la clave de servicio.
revoke all on function public.increment_unread(uuid, text) from public, anon, authenticated;
revoke all on function public.increment_broadcast_sent(uuid) from public, anon, authenticated;
revoke all on function public.increment_broadcast_failed(uuid) from public, anon, authenticated;
grant execute on function public.increment_unread(uuid, text) to service_role;
grant execute on function public.increment_broadcast_sent(uuid) to service_role;
grant execute on function public.increment_broadcast_failed(uuid) to service_role;
