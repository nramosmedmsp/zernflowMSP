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

-- ============================================================
-- MIGRATION 20: FASE 1 CASE ENGINE
-- ============================================================
-- Fase 1, tanda 2: motor de gestiones (docs/FASE-1-TECNICO.md 3).
--
-- 1. cases.next_action_notified_at: el cron avisa una sola vez cada próximo
--    contacto vencido (se vuelve a null al cambiar la fecha).
-- 2. open_inbound_case: abre la gestión entrante de un contacto sin duplicarla
--    cuando llegan dos mensajes a la vez (bloqueo por contacto).
-- 3. assign_case_pick: reparto atómico. Bajo un bloqueo por espacio elige
--    entre los candidatos (por turnos o menor carga), asigna la gestión y
--    sella last_assigned_at, para que dos mensajes simultáneos no asignen dos
--    veces seguidas a la misma persona. La misma regla de orden está en
--    TypeScript (lib/cases/routing.ts, pickAssignee) para las pruebas.
-- 4. check_case_refs: contacto, equipo, responsable, tipo, etapa, categoría y
--    motivo de una gestión pertenecen a su mismo espacio (no hay FK
--    compuestas). El motor ya lo valida en código; esto es la red de seguridad.
--
-- Las funciones solo las ejecuta service_role (el motor corre en el servidor
-- con el cliente de servicio después de validar permisos en código).
-- Idempotente: se puede volver a ejecutar.

-- ============================================================
-- 1. Aviso único de próximo contacto vencido
-- ============================================================

alter table public.cases
  add column if not exists next_action_notified_at timestamptz;

create index if not exists idx_cases_next_action_pending
  on public.cases(next_action_at)
  where status = 'open' and next_action_at is not null and next_action_notified_at is null;

-- Cola sin asignar (reintento del reparto en el cron).
create index if not exists idx_cases_open_unassigned
  on public.cases(workspace_id, id)
  where status = 'open' and assignee_id is null;

-- ============================================================
-- 2. Apertura de la gestión entrante
-- ============================================================

create or replace function public.open_inbound_case(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_case_type_id uuid,
  p_stage_id uuid,
  p_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case_id uuid;
  v_at timestamptz := coalesce(p_at, now());
begin
  if not exists (
    select 1 from public.contacts c
    where c.id = p_contact_id and c.workspace_id = p_workspace_id
  ) then
    raise exception 'contact_not_in_workspace' using errcode = '23514';
  end if;

  -- Serializa por contacto hasta el fin de la transacción: el segundo mensaje
  -- espera y, al seguir, ya ve la gestión que abrió el primero.
  perform pg_advisory_xact_lock(hashtextextended('open_inbound_case:' || p_contact_id::text, 0));

  select c.id into v_case_id
  from public.cases c
  where c.contact_id = p_contact_id and c.status = 'open'
  order by c.opened_at desc nulls last, c.created_at desc
  limit 1;

  if v_case_id is not null then
    return jsonb_build_object('case_id', v_case_id, 'created', false);
  end if;

  insert into public.cases (
    workspace_id, contact_id, case_type_id, stage_id, status, origin,
    opened_at, last_inbound_at, waiting_since
  )
  values (
    p_workspace_id, p_contact_id, p_case_type_id, p_stage_id, 'open', 'inbound',
    v_at, v_at, v_at
  )
  returning id into v_case_id;

  return jsonb_build_object('case_id', v_case_id, 'created', true);
end;
$$;

revoke all on function public.open_inbound_case(uuid, uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.open_inbound_case(uuid, uuid, uuid, uuid, timestamptz) to service_role;

-- ============================================================
-- 3. Reparto atómico
-- ============================================================
-- p_candidates: elegibles ya filtrados en código (equipo, tipo que atienden,
-- rol). Aquí se vuelve a exigir que sean miembros del espacio y estén
-- disponibles. Orden:
--   round_robin: last_assigned_at más antiguo (null primero), luego user_id;
--   least_load:  menos gestiones 'open' asignadas, luego lo mismo.
-- Devuelve { status: 'assigned' | 'already_assigned' | 'no_candidate' |
-- 'not_assignable' | 'not_found', assignee_id? }.

create or replace function public.assign_case_pick(
  p_case_id uuid,
  p_candidates uuid[],
  p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_status text;
  v_assignee uuid;
  v_pick uuid;
begin
  if p_mode is null or p_mode not in ('round_robin', 'least_load') then
    raise exception 'invalid_assignment_mode' using errcode = '22023';
  end if;

  select c.workspace_id into v_workspace_id
  from public.cases c
  where c.id = p_case_id;

  if v_workspace_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Un reparto a la vez por espacio hasta el fin de la transacción.
  perform pg_advisory_xact_lock(hashtextextended('assign_case:' || v_workspace_id::text, 0));

  -- Relee bajo el bloqueo: otra llamada pudo asignarla mientras esperábamos.
  select c.status, c.assignee_id into v_status, v_assignee
  from public.cases c
  where c.id = p_case_id
  for update;

  if v_status is null or v_status not in ('open', 'scheduled') then
    return jsonb_build_object('status', 'not_assignable');
  end if;

  if v_assignee is not null then
    return jsonb_build_object('status', 'already_assigned', 'assignee_id', v_assignee);
  end if;

  if p_candidates is null or cardinality(p_candidates) = 0 then
    return jsonb_build_object('status', 'no_candidate');
  end if;

  select wm.user_id into v_pick
  from public.workspace_members wm
  left join lateral (
    select count(*) as open_count
    from public.cases oc
    where oc.workspace_id = wm.workspace_id
      and oc.assignee_id = wm.user_id
      and oc.status = 'open'
  ) load on p_mode = 'least_load'
  where wm.workspace_id = v_workspace_id
    and wm.user_id = any(p_candidates)
    and wm.availability = 'available'
  order by
    coalesce(load.open_count, 0) asc,
    wm.last_assigned_at asc nulls first,
    wm.user_id asc
  limit 1;

  if v_pick is null then
    return jsonb_build_object('status', 'no_candidate');
  end if;

  update public.cases set assignee_id = v_pick where id = p_case_id;

  update public.workspace_members
    set last_assigned_at = now()
    where workspace_id = v_workspace_id and user_id = v_pick;

  return jsonb_build_object('status', 'assigned', 'assignee_id', v_pick);
end;
$$;

revoke all on function public.assign_case_pick(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.assign_case_pick(uuid, uuid[], text) to service_role;

-- ============================================================
-- 4. Referencias de una gestión dentro de su espacio
-- ============================================================
-- Solo revisa las columnas que cambian. Si el tipo es null (gestión sin
-- clasificar o tipo borrado) no revisa etapa, categoría ni motivo: así los
-- "on delete set null" de las FK nunca fallan.

create or replace function public.check_case_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_insert boolean := tg_op = 'INSERT';
  v_type_changed boolean;
begin
  if v_insert
     or new.contact_id is distinct from old.contact_id
     or new.workspace_id is distinct from old.workspace_id then
    if not exists (
      select 1 from public.contacts c
      where c.id = new.contact_id and c.workspace_id = new.workspace_id
    ) then
      raise exception 'case_contact_other_workspace' using errcode = '23514';
    end if;
  end if;

  if new.team_id is not null and (v_insert or new.team_id is distinct from old.team_id) then
    if not exists (
      select 1 from public.teams t
      where t.id = new.team_id and t.workspace_id = new.workspace_id
    ) then
      raise exception 'case_team_other_workspace' using errcode = '23514';
    end if;
  end if;

  if new.assignee_id is not null and (v_insert or new.assignee_id is distinct from old.assignee_id) then
    if not exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = new.workspace_id and wm.user_id = new.assignee_id
    ) then
      raise exception 'case_assignee_not_member' using errcode = '23514';
    end if;
  end if;

  if new.case_type_id is null then
    return new;
  end if;

  v_type_changed := v_insert or new.case_type_id is distinct from old.case_type_id;

  if v_type_changed and not exists (
    select 1 from public.case_types ct
    where ct.id = new.case_type_id and ct.workspace_id = new.workspace_id
  ) then
    raise exception 'case_type_other_workspace' using errcode = '23514';
  end if;

  if new.stage_id is not null
     and (v_type_changed or new.stage_id is distinct from old.stage_id)
     and not exists (
       select 1 from public.case_stages s
       where s.id = new.stage_id and s.case_type_id = new.case_type_id
     ) then
    raise exception 'case_stage_other_type' using errcode = '23514';
  end if;

  if new.category_id is not null
     and (v_type_changed or new.category_id is distinct from old.category_id)
     and not exists (
       select 1 from public.case_categories cc
       where cc.id = new.category_id and cc.case_type_id = new.case_type_id
     ) then
    raise exception 'case_category_other_type' using errcode = '23514';
  end if;

  if new.outcome_reason_id is not null
     and (v_type_changed or new.outcome_reason_id is distinct from old.outcome_reason_id)
     and not exists (
       select 1 from public.case_outcome_reasons r
       where r.id = new.outcome_reason_id and r.case_type_id = new.case_type_id
     ) then
    raise exception 'case_outcome_reason_other_type' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.check_case_refs() from public, anon, authenticated;

drop trigger if exists check_case_refs on public.cases;
create trigger check_case_refs
  before insert or update on public.cases
  for each row execute function public.check_case_refs();

-- ============================================================
-- MIGRATION 21: FASE 2 HOURS AUTOMATION
-- ============================================================
-- Fase 2, tanda 1: horarios, feriados y automatización de gestiones
-- (docs/FASE-2-TECNICO.md 1).
--
-- 1. is_valid_business_hours: formato de los horarios (lo usan los checks).
-- 2. teams.business_hours y workspaces.settings (business_hours,
--    off_hours_reply, reassign_after_minutes): horario por equipo / empresa.
-- 3. holidays: feriados de la empresa o de un equipo.
-- 4. case_types.auto_template: plantilla que se envía al activarse una
--    gestión proactiva.
-- 5. cases: sellos de la respuesta fuera de horario, de la plantilla
--    automática, de la reasignación por espera (reassigned_count,
--    assigned_at, wait_alerted_at) y del disparador client_no_reply.
-- 6. triggers.type: 'case_stage_changed', 'case_closed' y 'client_no_reply'.
-- 7. import_batches: historial de importaciones de contactos.
-- 8. cases_pending_no_reply: candidatas a client_no_reply para el cron.
--
-- Todo es opcional: sin configurar, el CRM se comporta como en la fase 1.
-- Idempotente: se puede volver a ejecutar. La hora de los horarios es la de
-- Lima (la interpreta el código, no la base). Requiere Postgres 15 o superior
-- (índice único con nulls not distinct en holidays).

-- ============================================================
-- 1. Formato de business_hours
-- ============================================================
-- { "mon": [["09:00","13:00"],["14:00","19:00"]], ..., "sun": [] }
-- Inicio HH:MM (00:00 a 23:59); fin HH:MM o "24:00"; inicio distinto de fin
-- (si el fin es menor, el tramo cruza la medianoche). Hasta 6 tramos por día.
-- null (o JSON null) es válido: significa "sin horario" (24 horas).

create or replace function public.is_valid_business_hours(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  k text;
  v jsonb;
  r jsonb;
begin
  if p is null or jsonb_typeof(p) = 'null' then
    return true;
  end if;
  if jsonb_typeof(p) <> 'object' then
    return false;
  end if;
  for k, v in select key, value from jsonb_each(p) loop
    if k not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun') then
      return false;
    end if;
    if jsonb_typeof(v) = 'null' then
      continue;
    end if;
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 6 then
      return false;
    end if;
    for r in select value from jsonb_array_elements(v) loop
      if jsonb_typeof(r) <> 'array' or jsonb_array_length(r) <> 2 then
        return false;
      end if;
      if jsonb_typeof(r -> 0) <> 'string' or jsonb_typeof(r -> 1) <> 'string' then
        return false;
      end if;
      if (r ->> 0) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or (r ->> 1) !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
         or (r ->> 0) = (r ->> 1) then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

-- ============================================================
-- 2. Horarios de equipos y de la empresa
-- ============================================================

alter table public.teams
  add column if not exists business_hours jsonb;

alter table public.teams drop constraint if exists teams_business_hours_check;
alter table public.teams
  add constraint teams_business_hours_check
  check (business_hours is null or public.is_valid_business_hours(business_hours));

-- workspaces.settings: { agent_visibility, assignment_mode, business_template,
-- key_date_label, business_hours, off_hours_reply, reassign_after_minutes }
alter table public.workspaces drop constraint if exists workspaces_settings_check;
alter table public.workspaces
  add constraint workspaces_settings_check check (
    jsonb_typeof(settings) = 'object'
    and coalesce(settings->>'agent_visibility', 'own') in ('own', 'own_and_unassigned', 'team')
    and coalesce(settings->>'assignment_mode', 'round_robin') in ('round_robin', 'least_load', 'manual')
    and coalesce(settings->>'business_template', 'blank') in ('ecommerce', 'gym', 'general', 'blank')
    and public.is_valid_business_hours(settings->'business_hours')
    and coalesce(jsonb_typeof(settings->'off_hours_reply'), 'object') in ('object', 'null')
    and coalesce(jsonb_typeof(settings->'reassign_after_minutes'), 'number') in ('number', 'null')
  );

-- ============================================================
-- 3. Feriados
-- ============================================================
-- team_id null = toda la empresa. Único por (espacio, equipo, fecha); los
-- null cuentan como iguales.

create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  date date not null,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  created_at timestamptz not null default now()
);

create unique index if not exists uq_holidays_workspace_team_date
  on public.holidays(workspace_id, team_id, date) nulls not distinct;
create index if not exists idx_holidays_workspace_date on public.holidays(workspace_id, date);

-- El equipo de un feriado pertenece a su mismo espacio.
create or replace function public.check_holiday_team_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.team_id is not null and not exists (
    select 1 from public.teams t where t.id = new.team_id and t.workspace_id = new.workspace_id
  ) then
    raise exception 'team_not_in_workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.check_holiday_team_workspace() from public, anon, authenticated;

drop trigger if exists check_holiday_team_workspace on public.holidays;
create trigger check_holiday_team_workspace
  before insert or update on public.holidays
  for each row execute function public.check_holiday_team_workspace();

alter table public.holidays enable row level security;
drop policy if exists holidays_select on public.holidays;
drop policy if exists holidays_insert on public.holidays;
drop policy if exists holidays_update on public.holidays;
drop policy if exists holidays_delete on public.holidays;
create policy holidays_select on public.holidays
  for select using (public.is_workspace_member(workspace_id));
create policy holidays_insert on public.holidays
  for insert with check (public.is_ws_admin(workspace_id));
create policy holidays_update on public.holidays
  for update using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));
create policy holidays_delete on public.holidays
  for delete using (public.is_ws_admin(workspace_id));

-- ============================================================
-- 4. Plantilla automática de las gestiones proactivas
-- ============================================================
-- { template_name, language, params: ["{nombre}", "{fecha_clave}", ...] }

alter table public.case_types
  add column if not exists auto_template jsonb;

alter table public.case_types drop constraint if exists case_types_auto_template_check;
alter table public.case_types
  add constraint case_types_auto_template_check
  check (auto_template is null or jsonb_typeof(auto_template) = 'object');

-- ============================================================
-- 5. Sellos en las gestiones
-- ============================================================

alter table public.cases
  add column if not exists off_hours_reply_sent_at timestamptz,
  add column if not exists auto_template_sent_at timestamptz,
  add column if not exists reassigned_count integer not null default 0,
  -- Cuándo se asignó al responsable actual (lo mantiene el trigger de abajo).
  add column if not exists assigned_at timestamptz,
  -- Último aviso de espera excedida sin a quién reasignar.
  add column if not exists wait_alerted_at timestamptz,
  -- client_no_reply: last_outbound_at y umbral (minutos) del último evento.
  add column if not exists no_reply_event_outbound_at timestamptz,
  add column if not exists no_reply_event_minutes integer;

alter table public.cases drop constraint if exists cases_reassigned_count_check;
alter table public.cases
  add constraint cases_reassigned_count_check check (reassigned_count >= 0);

-- assigned_at sigue al responsable: se sella al asignar y se limpia al quitarlo.
create or replace function public.set_case_assigned_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.assignee_id is not null and new.assigned_at is null then
      new.assigned_at := now();
    end if;
  elsif new.assignee_id is distinct from old.assignee_id then
    new.assigned_at := case when new.assignee_id is null then null else now() end;
  end if;
  return new;
end;
$$;

drop trigger if exists set_case_assigned_at on public.cases;
create trigger set_case_assigned_at
  before insert or update of assignee_id on public.cases
  for each row execute function public.set_case_assigned_at();

-- Reasignación por espera: abiertas con responsable y cliente esperando.
create index if not exists idx_cases_open_assigned_waiting
  on public.cases(workspace_id, waiting_since)
  where status = 'open' and assignee_id is not null and waiting_since is not null;

-- client_no_reply: abiertas con el último mensaje saliente sin respuesta.
create index if not exists idx_cases_open_awaiting_reply
  on public.cases(workspace_id, id)
  where status = 'open' and waiting_since is null and last_outbound_at is not null;

-- ============================================================
-- 6. Disparadores de flujos por eventos de gestión
-- ============================================================
-- El check de 00001 no tiene nombre explícito: Postgres lo llamó
-- triggers_type_check. config: { case_type_id?, stage_id?, outcome?, minutes? }

alter table public.triggers drop constraint if exists triggers_type_check;
alter table public.triggers
  add constraint triggers_type_check check (type in (
    'keyword', 'postback', 'quick_reply', 'welcome', 'default', 'comment_keyword',
    'case_stage_changed', 'case_closed', 'client_no_reply'
  ));

-- ============================================================
-- 7. Importaciones de contactos
-- ============================================================

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  file_name text not null default '',
  total integer not null default 0,
  created integer not null default 0,
  updated integer not null default 0,
  skipped integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  options jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_import_batches_workspace on public.import_batches(workspace_id, created_at desc);

alter table public.import_batches enable row level security;
drop policy if exists import_batches_select on public.import_batches;
drop policy if exists import_batches_insert on public.import_batches;
drop policy if exists import_batches_update on public.import_batches;
drop policy if exists import_batches_delete on public.import_batches;
create policy import_batches_select on public.import_batches
  for select using (public.is_workspace_member(workspace_id));
create policy import_batches_insert on public.import_batches
  for insert with check (public.is_ws_admin(workspace_id));
create policy import_batches_update on public.import_batches
  for update using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));
create policy import_batches_delete on public.import_batches
  for delete using (public.is_ws_admin(workspace_id));

-- ============================================================
-- 8. Candidatas a client_no_reply (cron)
-- ============================================================
-- Gestiones abiertas del espacio cuyo último mensaje saliente (humano o bot)
-- es de p_older_than o antes, es posterior al último entrante y no tiene
-- espera del cliente (waiting_since null), y a las que aún les falta algún
-- umbral: no se emitió ninguno para ese mensaje, o el último emitido es menor
-- que p_max_minutes. Paginado por id. Solo service_role.

create or replace function public.cases_pending_no_reply(
  p_workspace_id uuid,
  p_older_than timestamptz,
  p_max_minutes integer,
  p_after_id uuid,
  p_limit integer
)
returns table (
  id uuid,
  workspace_id uuid,
  contact_id uuid,
  case_type_id uuid,
  stage_id uuid,
  last_outbound_at timestamptz,
  no_reply_event_outbound_at timestamptz,
  no_reply_event_minutes integer
)
language sql
stable
set search_path = public
as $$
  select c.id, c.workspace_id, c.contact_id, c.case_type_id, c.stage_id,
         c.last_outbound_at, c.no_reply_event_outbound_at, c.no_reply_event_minutes
  from public.cases c
  where c.workspace_id = p_workspace_id
    and c.status = 'open'
    and c.waiting_since is null
    and c.last_outbound_at is not null
    and c.last_outbound_at <= p_older_than
    and (c.last_inbound_at is null or c.last_inbound_at < c.last_outbound_at)
    and (
      c.no_reply_event_outbound_at is distinct from c.last_outbound_at
      or coalesce(c.no_reply_event_minutes, 0) < p_max_minutes
    )
    and (p_after_id is null or c.id > p_after_id)
  order by c.id
  limit greatest(coalesce(p_limit, 100), 1);
$$;

revoke all on function public.cases_pending_no_reply(uuid, timestamptz, integer, uuid, integer) from public, anon, authenticated;
grant execute on function public.cases_pending_no_reply(uuid, timestamptz, integer, uuid, integer) to service_role;

-- ============================================================
-- MIGRATION 22: CASE OPENED TRIGGER + NO REPLY ON OUTBOUND
-- ============================================================
-- Laboratorio de flujos: correcciones del motor de flujos de gestiones.
--
-- 1. triggers.type: agrega 'case_opened' (Gestión nueva). config:
--    { only_unclassified?: boolean, contact_type_ids?: uuid[], case_type_id? }.
-- 2. cases_pending_no_reply: "cliente sin responder" ya no exige
--    waiting_since null. Basta con que el último mensaje saliente (de bot o de
--    persona) sea posterior al último entrante y tenga p_older_than o más de
--    antigüedad. waiting_since sigue significando "el cliente espera una
--    respuesta humana" y no se toca. Un evento por umbral y por mensaje
--    saliente (no_reply_event_outbound_at / no_reply_event_minutes).
-- 3. Índice de apoyo para esa función (reemplaza al de 00021, que exigía
--    waiting_since null).

-- ============================================================
-- 1. Disparador "Gestión nueva"
-- ============================================================

alter table public.triggers drop constraint if exists triggers_type_check;
alter table public.triggers
  add constraint triggers_type_check check (type in (
    'keyword', 'postback', 'quick_reply', 'welcome', 'default', 'comment_keyword',
    'case_opened', 'case_stage_changed', 'case_closed', 'client_no_reply'
  ));

-- ============================================================
-- 2. Candidatas a client_no_reply (cron)
-- ============================================================

create or replace function public.cases_pending_no_reply(
  p_workspace_id uuid,
  p_older_than timestamptz,
  p_max_minutes integer,
  p_after_id uuid,
  p_limit integer
)
returns table (
  id uuid,
  workspace_id uuid,
  contact_id uuid,
  case_type_id uuid,
  stage_id uuid,
  last_outbound_at timestamptz,
  no_reply_event_outbound_at timestamptz,
  no_reply_event_minutes integer
)
language sql
stable
set search_path = public
as $$
  select c.id, c.workspace_id, c.contact_id, c.case_type_id, c.stage_id,
         c.last_outbound_at, c.no_reply_event_outbound_at, c.no_reply_event_minutes
  from public.cases c
  where c.workspace_id = p_workspace_id
    and c.status = 'open'
    and c.last_outbound_at is not null
    and c.last_outbound_at <= p_older_than
    and (c.last_inbound_at is null or c.last_inbound_at < c.last_outbound_at)
    and (
      c.no_reply_event_outbound_at is distinct from c.last_outbound_at
      or coalesce(c.no_reply_event_minutes, 0) < p_max_minutes
    )
    and (p_after_id is null or c.id > p_after_id)
  order by c.id
  limit greatest(coalesce(p_limit, 100), 1);
$$;

revoke all on function public.cases_pending_no_reply(uuid, timestamptz, integer, uuid, integer) from public, anon, authenticated;
grant execute on function public.cases_pending_no_reply(uuid, timestamptz, integer, uuid, integer) to service_role;

-- ============================================================
-- 3. Índice
-- ============================================================

drop index if exists public.idx_cases_open_awaiting_reply;
create index if not exists idx_cases_open_with_outbound
  on public.cases(workspace_id, id)
  where status = 'open' and last_outbound_at is not null;

-- ============================================================
-- MIGRATION 23: LAB SCENARIOS
-- ============================================================
-- Laboratorio de flujos: escenarios guardados.
--
-- Un escenario es una conversación de prueba (pasos del simulador) con lo que
-- debe cumplirse (expectativas), para volver a probar todos los flujos de un clic
-- después de editarlos. Se corre en el navegador con el catálogo actual; aquí solo
-- se guarda la definición y el último resultado.
--
-- definition: JSON del escenario (lib/flow-lab/scenarios/types.ts), con tipos de
--   gestión, etapas, motivos, equipos, miembros y flujos POR NOMBRE.
-- last_result: JSON con el resultado de la última corrida (sin trazas).
--
-- Permisos: leen los miembros del espacio; crean, editan y borran el Dueño y los
-- Administradores (is_ws_admin, 00019).
--
-- Idempotente: se puede volver a ejecutar sin romper nada.

create table if not exists public.lab_scenarios (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  definition jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_run_at timestamptz,
  last_result jsonb
);

create index if not exists idx_lab_scenarios_workspace on public.lab_scenarios(workspace_id, created_at);

-- Un nombre por espacio (sin importar mayúsculas ni espacios de los bordes).
create unique index if not exists uq_lab_scenarios_name
  on public.lab_scenarios(workspace_id, lower(btrim(name)));

alter table public.lab_scenarios enable row level security;

drop policy if exists lab_scenarios_select on public.lab_scenarios;
create policy lab_scenarios_select on public.lab_scenarios
  for select using (public.is_workspace_member(workspace_id));

drop policy if exists lab_scenarios_insert on public.lab_scenarios;
create policy lab_scenarios_insert on public.lab_scenarios
  for insert with check (public.is_ws_admin(workspace_id));

drop policy if exists lab_scenarios_update on public.lab_scenarios;
create policy lab_scenarios_update on public.lab_scenarios
  for update using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));

drop policy if exists lab_scenarios_delete on public.lab_scenarios;
create policy lab_scenarios_delete on public.lab_scenarios
  for delete using (public.is_ws_admin(workspace_id));

drop trigger if exists set_updated_at on public.lab_scenarios;
create trigger set_updated_at before update on public.lab_scenarios
  for each row execute function update_updated_at();

-- ============================================================
-- MIGRATION 24: FASE 3 METRICAS
-- ============================================================
-- Fase 3: métricas. Sellos de alerta por objetivo de tiempo (SLA).
--
-- El cron de gestiones sella la columna la primera vez que una gestión abierta
-- supera el objetivo (primera respuesta o resolución) para avisar una sola vez
-- por gestión y tipo de alerta.

alter table public.cases
  add column if not exists sla_first_response_breached_at timestamptz;
alter table public.cases
  add column if not exists sla_resolution_breached_at timestamptz;

-- Apoyo del cron: gestiones abiertas aún sin alertar, por tipo y antigüedad.
create index if not exists idx_cases_sla_first_response_pending
  on public.cases(case_type_id, waiting_since)
  where status = 'open'
    and first_response_at is null
    and waiting_since is not null
    and sla_first_response_breached_at is null;

create index if not exists idx_cases_sla_resolution_pending
  on public.cases(case_type_id, opened_at)
  where status = 'open'
    and opened_at is not null
    and sla_resolution_breached_at is null;

-- ============================================================
-- MIGRATION 25: CHAT MEDIA
-- ============================================================
-- Fotos, PDF, audios y videos del chat (docs/PLAN-BANDEJA-CHAT.md, etapa C).
--
-- Los archivos van a un bucket privado sin políticas de acceso directo: el
-- servidor comprueba que la persona ve el chat (RLS de message_media o de
-- saved_replies) y recién entonces entrega un enlace firmado de pocos minutos.
-- Las subidas también pasan por el servidor (enlace de subida firmado).
--
-- Los archivos de los chats se borran a los 2 meses (cron
-- /api/cron/media-cleanup, decisión del dueño); los de las respuestas guardadas
-- se conservan mientras exista la respuesta.
--
-- Aplicar en cada base (tienda y gimnasio).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media',
  'chat-media',
  false,
  26214400, -- 25 MB
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'video/mp4', 'video/3gpp', 'video/quicktime',
    'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr', 'audio/webm'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Un archivo de un mensaje, enviado o recibido. platform_message_id es el id de
-- la plataforma (wamid, mid), el mismo que devuelve la lista de Zernio.
create table if not exists public.message_media (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  platform_message_id text not null,
  attachment_index smallint not null default 0,
  direction text not null check (direction in ('inbound', 'outbound')),
  kind text not null check (kind in ('image', 'video', 'audio', 'file', 'sticker')),
  storage_path text,
  mime_type text,
  file_name text,
  size_bytes bigint,
  status text not null default 'stored' check (status in ('stored', 'too_large', 'failed', 'expired')),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint message_media_message_unique unique (conversation_id, platform_message_id, attachment_index)
);

create index if not exists idx_message_media_conversation on public.message_media(conversation_id, created_at desc);
-- Apoyo de la limpieza de los 2 meses.
create index if not exists idx_message_media_stored_age on public.message_media(created_at) where status = 'stored';

alter table public.message_media enable row level security;
drop policy if exists message_media_select on public.message_media;
create policy message_media_select on public.message_media
  for select using (
    exists (
      select 1 from public.conversations conv
      where conv.id = message_media.conversation_id and public.can_see_contact(conv.contact_id)
    )
  );
-- Sin políticas de escritura: solo el servidor (clave de servicio) registra archivos.

-- Archivo de una respuesta guardada: attachment_url (ya existía) guarda la ruta
-- dentro del bucket chat-media.
alter table public.saved_replies add column if not exists attachment_name text;
alter table public.saved_replies add column if not exists attachment_mime text;
alter table public.saved_replies add column if not exists attachment_size bigint;

-- ============================================================
-- MIGRATION 26: MESSAGE STATUS AND AUTHOR
-- ============================================================

-- Control de la bandeja (docs/PLAN-BANDEJA-CHAT.md, etapa D): quién envió cada
-- mensaje y su estado de entrega en vivo.
--
-- Cada envío de un asesor (mensaje o plantilla) queda en `messages` con su
-- autor y el id de la plataforma; el webhook de Zernio (message.delivered,
-- message.read, message.failed) actualiza su estado y la bandeja lo recibe por
-- Realtime (messages ya está en la publicación supabase_realtime).
--
-- Aplicar en cada base (tienda y gimnasio).

alter table public.messages drop constraint if exists messages_status_check;
alter table public.messages add constraint messages_status_check
  check (status in ('pending', 'sent', 'delivered', 'read', 'failed'));

alter table public.messages add column if not exists client_message_id text;
alter table public.messages add column if not exists status_at timestamptz;
alter table public.messages add column if not exists error_code integer;
alter table public.messages add column if not exists error_text text;

-- Búsqueda por id de plataforma (unir con la lista de Zernio y el webhook).
create index if not exists idx_messages_platform_id
  on public.messages(conversation_id, platform_message_id)
  where platform_message_id is not null;

-- Nadie puede registrar un mensaje a nombre de otra persona.
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert with check (
    (sent_by_user_id is null or sent_by_user_id = auth.uid())
    and exists (
      select 1 from public.conversations conv
      where conv.id = messages.conversation_id and public.can_see_contact(conv.contact_id)
    )
  );

-- ============================================================
-- MIGRATION 27: SPELL WORDS
-- ============================================================

-- Diccionario de la tienda para el corrector de la Bandeja: marcas, productos
-- y palabras propias que el diccionario de español no conoce (whey, isolate,
-- Yape…). Las agrega cualquier miembro desde el chat ("Agregar al diccionario
-- de la tienda"); las quita el Dueño o un Administrador en Configuración.
--
-- Aplicar en cada base (tienda y gimnasio).

create table if not exists public.spell_words (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  word text not null check (char_length(btrim(word)) between 1 and 60),
  -- En minúsculas: "Yape" y "yape" son la misma palabra.
  normalized text not null check (normalized = lower(normalized)),
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint spell_words_unique unique (workspace_id, normalized)
);

alter table public.spell_words enable row level security;

drop policy if exists spell_words_select on public.spell_words;
create policy spell_words_select on public.spell_words
  for select using (public.is_workspace_member(workspace_id));

drop policy if exists spell_words_insert on public.spell_words;
create policy spell_words_insert on public.spell_words
  for insert with check (public.is_workspace_member(workspace_id) and added_by = auth.uid());

drop policy if exists spell_words_delete on public.spell_words;
create policy spell_words_delete on public.spell_words
  for delete using (public.is_ws_admin(workspace_id));

-- Lista inicial (added_by vacío): palabras de una tienda de suplementos.
insert into public.spell_words (workspace_id, word, normalized)
select w.id, x.word, lower(x.word)
from public.workspaces w
cross join (values
  ('whey'), ('isolate'), ('gainer'), ('scoop'), ('scoops'), ('shaker'), ('preworkout'), ('workout'),
  ('creatine'), ('protein'), ('gym'), ('fitness'), ('delivery'), ('stock'), ('ok'), ('okey'),
  ('wsp'), ('whatsapp'), ('instagram'), ('facebook'), ('link'), ('online'), ('promo'), ('promos'),
  ('combo'), ('combos'), ('Yape'), ('yapeo'), ('Plin'), ('Olva'), ('Shalom'), ('lb'), ('lbs'), ('kg'), ('mg'),
  ('kcal'), ('porfa'), ('cel'), ('celu'), ('dni'), ('ruc')
) as x(word)
on conflict (workspace_id, normalized) do nothing;

-- ============================================================
-- MIGRATION 28: SPELL WORD REQUESTS
-- ============================================================

-- Diccionario de la tienda: solo el Dueño o un Administrador agrega palabras.
-- Los demás miembros piden agregarlas ("pending"); un administrador las aprueba
-- (pasan a "approved") o las rechaza (se borran). El corrector solo usa las
-- aprobadas.
--
-- Aplicar en cada base (tienda y gimnasio).

alter table public.spell_words
  add column if not exists status text not null default 'approved' check (status in ('approved', 'pending'));
alter table public.spell_words add column if not exists approved_by uuid references auth.users(id) on delete set null;
alter table public.spell_words add column if not exists approved_at timestamptz;

create index if not exists idx_spell_words_pending on public.spell_words(workspace_id) where status = 'pending';

-- Miembros: solo pedidos a su nombre. Administradores: también aprobadas.
drop policy if exists spell_words_insert on public.spell_words;
create policy spell_words_insert on public.spell_words
  for insert with check (
    public.is_workspace_member(workspace_id)
    and added_by = auth.uid()
    and (status = 'pending' or public.is_ws_admin(workspace_id))
  );

-- Aprobar: solo administradores.
drop policy if exists spell_words_update on public.spell_words;
create policy spell_words_update on public.spell_words
  for update using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));


-- ============================================================
-- MIGRATION 29: CONTROL DE RECLAMOS
-- ============================================================

-- Control de reclamos (Postventa): tipos protegidos, plazo para registrar la
-- solución, pedido de cierre con aprobación, detector de reclamos sin
-- clasificar y ventana de reapertura por tipo.
--
-- Todo es opcional y genérico por tipo de gestión: con las columnas en sus
-- valores por defecto (protected = false y plazos vacíos) nada cambia. Las
-- escrituras siguen pasando por las acciones del servidor (cliente de
-- servicio), como el resto del motor; las políticas RLS existentes de
-- case_types, cases y conversations cubren las columnas nuevas.
--
-- Aplicar en cada base (tienda y gimnasio).

-- ---------- case_types ----------
-- protected: solo el supervisor del equipo (o un administrador) cambia el tipo
--   de la gestión o la cierra como perdida; un asesor pide la aprobación.
-- solution_deadline_hours: horas desde que se abre para cerrarla como
--   resuelta/ganada o registrar una "solución en proceso". null = sin plazo.
-- reopen_window_days: días tras el cierre en que un mensaje del cliente
--   reabre la gestión. null = 24 horas (comportamiento anterior).
alter table public.case_types
  add column if not exists protected boolean not null default false;
alter table public.case_types
  add column if not exists solution_deadline_hours integer;
alter table public.case_types
  add column if not exists reopen_window_days integer;

alter table public.case_types drop constraint if exists case_types_solution_deadline_hours_check;
alter table public.case_types
  add constraint case_types_solution_deadline_hours_check
  check (solution_deadline_hours is null or solution_deadline_hours between 1 and 720);

alter table public.case_types drop constraint if exists case_types_reopen_window_days_check;
alter table public.case_types
  add constraint case_types_reopen_window_days_check
  check (reopen_window_days is null or reopen_window_days between 1 and 365);

-- ---------- cases ----------
-- solution_status: 'in_progress' cuando alguien registró la solución en curso
--   (null = nada registrado). solution_note / solution_at / solution_by: qué
--   se está haciendo, cuándo y quién lo registró. La fecha compromiso es
--   next_action_at.
-- solution_clock_at: desde cuándo corre el plazo (null = opened_at); la
--   reapertura lo reinicia.
-- deadline_alerted_at: el cron ya avisó a los supervisores que venció el plazo.
-- commitment_alerted_at: el cron ya avisó que venció la fecha compromiso
--   (setNextAction lo vuelve a null cuando cambia la fecha).
-- close_request: pedido de cierre "sin solución" de un asesor, a la espera de
--   un supervisor: { stage_id, reason_id, note, category_id?, requested_by,
--   requested_at }.
alter table public.cases
  add column if not exists solution_status text;
alter table public.cases drop constraint if exists cases_solution_status_check;
alter table public.cases
  add constraint cases_solution_status_check check (solution_status is null or solution_status in ('in_progress'));
alter table public.cases add column if not exists solution_note text;
alter table public.cases add column if not exists solution_at timestamptz;
alter table public.cases add column if not exists solution_by uuid references auth.users(id) on delete set null;
alter table public.cases add column if not exists solution_clock_at timestamptz;
alter table public.cases add column if not exists deadline_alerted_at timestamptz;
alter table public.cases add column if not exists commitment_alerted_at timestamptz;
alter table public.cases add column if not exists close_request jsonb;

-- Apoyo del cron: gestiones abiertas, sin solución y sin alertar, por tipo y antigüedad.
create index if not exists idx_cases_solution_deadline_pending
  on public.cases(case_type_id, opened_at)
  where status = 'open'
    and solution_status is null
    and deadline_alerted_at is null;

-- Apoyo del cron: compromisos vencidos sin avisar.
create index if not exists idx_cases_commitment_pending
  on public.cases(next_action_at)
  where status = 'open'
    and solution_status = 'in_progress'
    and commitment_alerted_at is null;

-- Pedidos de cierre pendientes (lista y avisos).
create index if not exists idx_cases_close_request_pending
  on public.cases(workspace_id)
  where close_request is not null;

-- ---------- conversations ----------
-- Detector de reclamos: el webhook marca la conversación cuando el cliente
-- escribe algo que parece un reclamo y no hay una gestión protegida abierta.
alter table public.conversations add column if not exists complaint_flagged_at timestamptz;
alter table public.conversations add column if not exists complaint_excerpt text;
alter table public.conversations add column if not exists complaint_alerted_at timestamptz;
alter table public.conversations add column if not exists complaint_dismissed_at timestamptz;

-- Apoyo del cron: marcadas y sin avisar.
create index if not exists idx_conversations_complaint_pending
  on public.conversations(complaint_flagged_at)
  where complaint_flagged_at is not null
    and complaint_alerted_at is null;


-- ============================================================
-- MIGRATION 30: RESTRINGIR create_workspace
-- ============================================================

-- ============================================================
-- 00030: solo el Dueño de un espacio (o la primera instalación) crea espacios
-- ============================================================
-- Revisión de seguridad C-1/C-2: la función create_workspace (00017) la podía
-- llamar cualquier usuario con sesión, que quedaba como Dueño de un espacio
-- propio. Ahora exige que quien llama ya sea Dueño de algún espacio, o que no
-- exista ningún espacio todavía (instalación nueva). Se mantiene
-- security definer con search_path fijo.
--
-- La tienda usa un solo espacio; el gimnasio corre como app aparte con su
-- propia base: su primer espacio nace en handle_new_user (00017, primera
-- persona de la instalación) o, si no hay ninguno, con esta función.
--
-- app_mail_settings (00018) ya tiene RLS sin políticas y sin permisos para
-- anon/authenticated: no se alcanza desde el cliente. La restricción "solo el
-- Dueño" se aplica en el servidor (lib/actions/mail.ts).

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

  -- Mismo bloqueo que handle_new_user: evita dos "primeras instalaciones"
  -- simultáneas.
  perform pg_advisory_xact_lock(hashtext('public.handle_new_user:first_workspace'));

  if not (
    exists (
      select 1 from public.workspace_members wm
      where wm.user_id = v_uid and wm.role = 'owner'
    )
    or not exists (select 1 from public.workspaces)
  ) then
    raise exception 'workspace_creation_not_allowed'
      using errcode = '42501',
            hint = 'Solo el Dueño de un espacio de trabajo puede crear otros espacios.';
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

-- Solo usuarios con sesión pueden ejecutarla (la función se niega por dentro
-- si no son Dueños); anon y public no.
revoke all on function public.create_workspace(text) from public;
revoke all on function public.create_workspace(text) from anon;
grant execute on function public.create_workspace(text) to authenticated;


-- ============================================================
-- MIGRATION 31: ENDURECER RLS (revisión de seguridad, tanda 1)
-- ============================================================

-- ============================================================
-- 00031: endurecer las reglas de la base (revisión de seguridad, tanda 1)
-- ============================================================
-- Hallazgos A-1, A-2, A-3, A-4, M-1 y B-1 a B-4 de la revisión general.
--
-- Principio: los usuarios (anon y authenticated, o sea quien escribe desde el
-- navegador con su sesión) conservan solo los permisos de escritura que la app
-- usa de verdad con su cliente. Todo lo demás lo escribe el servidor con la
-- clave de servicio (service_role, que no pasa por RLS ni por estos permisos),
-- después de validar el rol en código.
--
-- Lo que SÍ escribe el navegador hoy (revisado con grep en components/ y app/):
--   * conversations.unread_count (poner en 0 al abrir el chat).
--   * Tablas de configuración de administradores (flows, channels.is_active,
--     triggers, broadcasts...): no se tocan aquí, siguen con sus políticas.
--   * Subida de archivos al bucket chat-media con enlace firmado (no usa
--     políticas de storage.objects; ver el comentario al final).
--
-- No borra ni modifica datos, salvo que el índice único de canales (A-4)
-- detecte duplicados: en ese caso la migración se detiene con un mensaje claro
-- para resolverlos a mano. En producción hay 2 canales demo y ningún duplicado.
-- Se puede volver a ejecutar sin errores (idempotente).

-- ------------------------------------------------------------
-- Helper: ¿supervisor de algún equipo activo de este espacio?
-- ------------------------------------------------------------
-- La usa analytics_events (B-2): administradores y supervisores leen los
-- eventos (las Métricas de supervisor cuentan mensajes entrantes); asesores no.
create or replace function public.is_ws_supervisor(ws uuid)
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
    where t.workspace_id = ws
      and tm.user_id = auth.uid()
      and tm.role = 'supervisor'
      and t.archived_at is null
  );
$$;

revoke all on function public.is_ws_supervisor(uuid) from public, anon;
grant execute on function public.is_ws_supervisor(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- A-1: contact_channels, nadie mueve un número de WhatsApp/Instagram de contacto
-- ------------------------------------------------------------
-- Ninguna pantalla actualiza esta tabla. Crear y borrar siguen siendo del
-- administrador (políticas de 00019); el servidor usa la clave de servicio.
drop policy if exists contact_channels_update on public.contact_channels;
revoke update on public.contact_channels from anon, authenticated;

-- ------------------------------------------------------------
-- A-3: conversations, el usuario solo puede poner en cero "no leídos"
-- ------------------------------------------------------------
-- Se quita el UPDATE de toda la tabla y se concede solo la columna unread_count
-- (inbox-view.tsx). Asignación, reclamo, contacto, espacio, bot pausado, etc.
-- pasan por las acciones del servidor.
-- Crear conversaciones lo hace el servidor (webhook y sincronización de la
-- bandeja con la clave de servicio): se quita el INSERT de usuarios.
drop policy if exists conversations_insert on public.conversations;
revoke insert, update on public.conversations from anon, authenticated;
grant update (unread_count) on public.conversations to authenticated;

-- ------------------------------------------------------------
-- M-1: messages, solo el servidor registra mensajes
-- ------------------------------------------------------------
-- messages_insert (00026) dejaba a cualquiera que ve el chat crear filas con
-- cualquier dirección, estado y id de plataforma. Los mensajes los escribe el
-- servidor (lib/outbound-log.ts, webhook, demo, secuencias); el navegador solo
-- lee (y recibe por Realtime, que usa la política de lectura).
drop policy if exists messages_insert on public.messages;
revoke insert, update, delete on public.messages from anon, authenticated;

-- ------------------------------------------------------------
-- B-1: contacts, el usuario no edita contactos por la base
-- ------------------------------------------------------------
-- Las acciones del servidor (lib/actions/contacts.ts, cases.ts, import.ts, el
-- webhook) escriben con la clave de servicio y validan permisos en código.
-- Crear y borrar siguen siendo del administrador (políticas de 00019).
drop policy if exists contacts_update on public.contacts;
revoke update on public.contacts from anon, authenticated;

-- Etiquetas y campos personalizados del contacto: solo administradores por la
-- base (la pantalla ya los cambia por acciones del servidor).
drop policy if exists contact_tags_insert on public.contact_tags;
drop policy if exists contact_tags_update on public.contact_tags;
drop policy if exists contact_tags_delete on public.contact_tags;
create policy contact_tags_insert on public.contact_tags
  for insert with check (
    exists (
      select 1
      from public.contacts c
      join public.tags t on t.workspace_id = c.workspace_id
      where c.id = contact_tags.contact_id
        and t.id = contact_tags.tag_id
        and public.is_ws_admin(c.workspace_id)
    )
  );
create policy contact_tags_delete on public.contact_tags
  for delete using (
    exists (
      select 1 from public.contacts c
      where c.id = contact_tags.contact_id and public.is_ws_admin(c.workspace_id)
    )
  );
revoke update on public.contact_tags from anon, authenticated;

drop policy if exists contact_custom_fields_insert on public.contact_custom_fields;
drop policy if exists contact_custom_fields_update on public.contact_custom_fields;
drop policy if exists contact_custom_fields_delete on public.contact_custom_fields;
create policy contact_custom_fields_insert on public.contact_custom_fields
  for insert with check (
    exists (
      select 1
      from public.contacts c
      join public.custom_field_definitions f on f.workspace_id = c.workspace_id
      where c.id = contact_custom_fields.contact_id
        and f.id = contact_custom_fields.field_id
        and public.is_ws_admin(c.workspace_id)
    )
  );
create policy contact_custom_fields_update on public.contact_custom_fields
  for update
  using (
    exists (
      select 1 from public.contacts c
      where c.id = contact_custom_fields.contact_id and public.is_ws_admin(c.workspace_id)
    )
  )
  with check (
    exists (
      select 1
      from public.contacts c
      join public.custom_field_definitions f on f.workspace_id = c.workspace_id
      where c.id = contact_custom_fields.contact_id
        and f.id = contact_custom_fields.field_id
        and public.is_ws_admin(c.workspace_id)
    )
  );
create policy contact_custom_fields_delete on public.contact_custom_fields
  for delete using (
    exists (
      select 1 from public.contacts c
      where c.id = contact_custom_fields.contact_id and public.is_ws_admin(c.workspace_id)
    )
  );

-- ------------------------------------------------------------
-- A-2: saved_replies, el archivo adjunto solo lo escribe el servidor
-- ------------------------------------------------------------
-- Un usuario podía poner como adjunto de su respuesta personal la ruta de
-- cualquier archivo del bucket; al borrarla, la app borraba ese archivo, y al
-- abrirla, lo entregaba. Ahora:
--  1) con sesión de usuario no se puede crear ni cambiar ninguna columna
--     attachment_* (las escribe el servidor con la clave de servicio, que
--     antes valida la ruta y que el archivo exista);
--  2) la ruta debe ser {espacio de la fila}/replies/{uuid}.{ext};
--  3) un mismo archivo no lo puede usar más de una respuesta.
create or replace function public.guard_saved_reply_attachment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Clave de servicio o conexión directa: sin usuario.
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.attachment_url is not null
       or new.attachment_name is not null
       or new.attachment_mime is not null
       or new.attachment_size is not null then
      raise exception 'saved_reply_attachment_server_only'
        using errcode = '42501',
              hint = 'El archivo de una respuesta guardada solo lo registra el servidor.';
    end if;
  elsif (new.attachment_url, new.attachment_name, new.attachment_mime, new.attachment_size)
        is distinct from
        (old.attachment_url, old.attachment_name, old.attachment_mime, old.attachment_size) then
    raise exception 'saved_reply_attachment_server_only'
      using errcode = '42501',
            hint = 'El archivo de una respuesta guardada solo lo registra el servidor.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_saved_reply_attachment() from public, anon, authenticated;

drop trigger if exists guard_saved_reply_attachment on public.saved_replies;
create trigger guard_saved_reply_attachment
  before insert or update on public.saved_replies
  for each row execute function public.guard_saved_reply_attachment();

-- NOT VALID: las filas que ya existen no se revisan al agregarla (no se
-- bloquea la migración); abajo se intenta validar y, si alguna fila vieja no
-- cumple, solo se avisa.
alter table public.saved_replies drop constraint if exists saved_replies_attachment_path_check;
alter table public.saved_replies
  add constraint saved_replies_attachment_path_check
  check (
    attachment_url is null
    or attachment_url ~ ('^' || workspace_id::text || '/replies/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,5}$')
  ) not valid;

do $$
begin
  alter table public.saved_replies validate constraint saved_replies_attachment_path_check;
exception when check_violation then
  raise notice 'saved_replies: hay respuestas con una ruta de adjunto fuera de {espacio}/replies/; revisarlas a mano (la regla ya aplica a lo nuevo).';
end $$;

create unique index if not exists saved_replies_attachment_url_key
  on public.saved_replies(attachment_url)
  where attachment_url is not null;

-- ------------------------------------------------------------
-- A-4: un identificador de cuenta de Zernio, un solo canal en toda la base
-- ------------------------------------------------------------
-- El webhook identifica el canal por late_account_id. Hasta ahora era único
-- solo dentro de un espacio, así que otro espacio podía registrar el mismo.
-- Los canales de prueba ("demo-...", lib/demo.ts) se crean en cada espacio con
-- el mismo id y no existen en Zernio: quedan fuera del índice global.
do $$
declare
  v_dups text;
begin
  select string_agg(late_account_id || ' (' || n || ' canales)', ', ')
    into v_dups
  from (
    select late_account_id, count(*) n
    from public.channels
    where late_account_id is not null and late_account_id not like 'demo-%'
    group by late_account_id
    having count(*) > 1
  ) d;

  if v_dups is not null then
    raise exception 'channels: cuentas de Zernio repetidas en varios canales: %. Quedarse con un canal por cuenta (borrar o cambiar los demás) y volver a ejecutar esta migración.', v_dups
      using errcode = '23505';
  end if;
end $$;

create unique index if not exists channels_late_account_id_real_key
  on public.channels(late_account_id)
  where late_account_id is not null and late_account_id not like 'demo-%';

-- ------------------------------------------------------------
-- B-2: analytics_events y comment_logs, solo el servidor escribe
-- ------------------------------------------------------------
-- Los eventos los escribe el servidor (motor de flujos, webhook, cron). Leen
-- administradores y supervisores (Métricas); los comentarios procesados, solo
-- administradores (pantalla Crecimiento).
drop policy if exists "Users can insert analytics in their workspaces" on public.analytics_events;
drop policy if exists "Users can view analytics in their workspaces" on public.analytics_events;
drop policy if exists "Users can manage analytics in their workspaces" on public.analytics_events;
drop policy if exists analytics_events_select on public.analytics_events;
create policy analytics_events_select on public.analytics_events
  for select using (public.is_ws_admin(workspace_id) or public.is_ws_supervisor(workspace_id));
revoke insert, update, delete on public.analytics_events from anon, authenticated;

drop policy if exists "Users can view comment logs in their workspace" on public.comment_logs;
drop policy if exists comment_logs_select on public.comment_logs;
create policy comment_logs_select on public.comment_logs
  for select using (public.is_ws_admin(workspace_id));
revoke insert, update, delete on public.comment_logs from anon, authenticated;

-- ------------------------------------------------------------
-- B-3: workspace_invites, solo administradores leen; las maneja el servidor
-- ------------------------------------------------------------
-- La política de update (00006) comparaba el correo del invitado y no tenía
-- with check: un invitado podía cambiar su propia invitación (rol, espacio).
-- Las invitaciones las crean, aceptan y borran las acciones del servidor
-- (lib/actions/team.ts, trigger handle_new_user).
drop policy if exists workspace_invites_update on public.workspace_invites;
drop policy if exists workspace_invites_select on public.workspace_invites;
drop policy if exists workspace_invites_insert on public.workspace_invites;
drop policy if exists workspace_invites_delete on public.workspace_invites;
create policy workspace_invites_select on public.workspace_invites
  for select using (public.is_ws_admin(workspace_id));
create policy workspace_invites_insert on public.workspace_invites
  for insert with check (public.ws_role(workspace_id) = 'owner' and role <> 'owner');
create policy workspace_invites_delete on public.workspace_invites
  for delete using (public.ws_role(workspace_id) = 'owner');
revoke update on public.workspace_invites from anon, authenticated;

-- ------------------------------------------------------------
-- Higiene de permisos de las tablas tocadas aquí
-- ------------------------------------------------------------
-- anon (sin sesión) no usa ninguna de estas tablas desde el navegador.
-- TRUNCATE, REFERENCES y TRIGGER no los usa nadie con su sesión (y TRUNCATE no
-- pasa por RLS).
revoke all on public.conversations, public.contact_channels, public.contacts,
  public.messages, public.saved_replies, public.analytics_events,
  public.comment_logs, public.workspace_invites,
  public.contact_tags, public.contact_custom_fields
  from anon;
revoke truncate, references, trigger on public.conversations, public.contact_channels,
  public.contacts, public.messages, public.saved_replies, public.analytics_events,
  public.comment_logs, public.workspace_invites,
  public.contact_tags, public.contact_custom_fields
  from authenticated;

-- ------------------------------------------------------------
-- B-4: funciones security definer, permisos mínimos y ruta fija
-- ------------------------------------------------------------
-- Las funciones auxiliares de las políticas las usa quien tiene sesión; anon
-- y public no las necesitan (los lints 0028/0029 de Supabase). authenticated
-- y service_role las conservan: las políticas se evalúan con el permiso de
-- quien consulta.
revoke all on function public.can_see_contact(uuid) from public, anon;
revoke all on function public.can_see_contact_row(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.is_team_member(uuid) from public, anon;
revoke all on function public.is_team_supervisor(uuid) from public, anon;
revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.is_ws_admin(uuid) from public, anon;
revoke all on function public.ws_has_teams(uuid) from public, anon;
revoke all on function public.ws_role(uuid) from public, anon;
grant execute on function public.can_see_contact(uuid) to authenticated, service_role;
grant execute on function public.can_see_contact_row(uuid, uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.is_team_member(uuid) to authenticated, service_role;
grant execute on function public.is_team_supervisor(uuid) to authenticated, service_role;
grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function public.is_ws_admin(uuid) to authenticated, service_role;
grant execute on function public.ws_has_teams(uuid) to authenticated, service_role;
grant execute on function public.ws_role(uuid) to authenticated, service_role;

-- Trigger de alta de usuarios: lo dispara auth.users, nadie lo llama.
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Contadores (ya restringidos a service_role en 00019): ruta de búsqueda fija.
alter function public.increment_unread(uuid, text) set search_path = public;
alter function public.increment_broadcast_sent(uuid) set search_path = public;
alter function public.increment_broadcast_failed(uuid) set search_path = public;

-- Funciones de trigger / validación sin ruta fija.
alter function public.update_updated_at() set search_path = public;
alter function public.set_case_assigned_at() set search_path = public;
alter function public.is_valid_business_hours(jsonb) set search_path = public;

-- rls_auto_enable existe en la base de producción (la creó la plataforma) y no
-- estaba en el repo. Es el disparador de eventos que activa RLS en cada tabla
-- nueva de public. Se deja la misma definición, solo para que las bases
-- nuevas la tengan, y se le quita el permiso de ejecución a los usuarios: la
-- ejecuta el motor al crear tablas, nadie debe llamarla.
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  cmd record;
  tbl name;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is not null and cmd.schema_name in ('public')
       and cmd.schema_name not in ('pg_catalog', 'information_schema')
       and cmd.schema_name not like 'pg_toast%' and cmd.schema_name not like 'pg_temp%' then
      begin
        select c.relname into tbl from pg_catalog.pg_class c where c.oid = cmd.objid;
        execute format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    else
      raise log 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
    end if;
  end loop;
end;
$$;

revoke all on function public.rls_auto_enable() from public, anon, authenticated, service_role;

-- El disparador ya existe en producción (ensure_rls). Si falta en otra base se
-- crea; si el rol que aplica la migración no puede crear disparadores de
-- eventos, solo se avisa.
do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls
      on ddl_command_end
      when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      execute function public.rls_auto_enable();
  end if;
exception when insufficient_privilege then
  raise notice 'No se pudo crear el disparador ensure_rls (falta permiso); crearlo con un rol con permisos.';
end $$;

-- ------------------------------------------------------------
-- storage.objects (chat-media)
-- ------------------------------------------------------------
-- El bucket chat-media es privado y storage.objects no tiene ninguna política
-- de acceso para usuarios (comprobado en producción: 0 políticas, RLS activo),
-- así que un usuario no puede listar, leer, escribir ni borrar archivos por la
-- API de storage. Las subidas usan enlace firmado (uploadToSignedUrl) y las
-- lecturas, enlaces firmados que crea el servidor tras revisar la RLS de
-- message_media / saved_replies. No se agrega ninguna política: no crear una
-- es la protección. El hueco real era la ruta guardada en saved_replies
-- (arriba) y el código que borraba o entregaba archivos sin validarla
-- (lib/actions/saved-replies.ts y app/api/v1/media/reply/[id]/route.ts).


-- ============================================================
-- MIGRATION 32: ANTES DE CONECTAR CANALES REALES (revisión, tanda 3)
-- ============================================================
-- Revisión general, tanda 3: antes de conectar el WhatsApp e Instagram reales.
--
-- Cambios (solo aditivos; sin ellos el código nuevo falla al leer las columnas,
-- así que se aplica ANTES de desplegar el código; el código anterior sigue
-- funcionando con la migración ya aplicada):
--
--  * conversations.last_inbound_at (A-8): fecha del último mensaje del cliente.
--    En los canales reales los mensajes los guarda Zernio, no la tabla
--    `messages`; sin esta columna la ventana de 24 h de WhatsApp (difusiones de
--    texto, secuencias) siempre sale cerrada. El webhook la sella con cada
--    mensaje entrante y la simulación de los canales de prueba también.
--  * message_media.fetch_attempts (M-13): cuántas veces se intentó copiar el
--    archivo; permite reintentar los que quedaron "fallidos" con un límite.

alter table public.conversations
  add column if not exists last_inbound_at timestamptz;

-- Relleno para lo que ya existe: el último mensaje entrante guardado (canales
-- de prueba) o, si no hay, el último mensaje entrante registrado en las
-- gestiones del contacto (cases.last_inbound_at, que sí se sella en canales reales).
update public.conversations c
set last_inbound_at = coalesce(
  (select max(m.created_at) from public.messages m
    where m.conversation_id = c.id and m.direction = 'inbound'),
  (select max(k.last_inbound_at) from public.cases k
    where k.contact_id = c.contact_id and k.workspace_id = c.workspace_id)
)
where c.last_inbound_at is null;

alter table public.message_media
  add column if not exists fetch_attempts smallint not null default 1;

-- ============================================================
-- MIGRATION 33: DIFUSIONES SIN DUPLICADOS (revisión, tanda 4)
-- ============================================================
-- Tanda 4: difusiones sin duplicados (A-9) y motivos de fallo en español (B-21).
--
-- 1. Un contacto solo puede ser destinatario una vez por difusión. Si algún
--    envío anterior ya dejó destinatarios repetidos, se conserva uno por
--    contacto (el que ya salió, si lo hay) y se borran los demás antes de crear
--    la restricción. Los contadores de la difusión (sent_count / failed_count)
--    no se recalculan.
-- 2. Los motivos de fallo que el cron guardó en inglés pasan a español.

delete from broadcast_recipients br
using (
  select id,
         row_number() over (
           partition by broadcast_id, contact_id
           order by case status when 'sent' then 0 when 'sending' then 1 when 'failed' then 2 else 3 end,
                    sent_at nulls last,
                    id
         ) as rn
  from broadcast_recipients
) ranked
where br.id = ranked.id and ranked.rn > 1;

create unique index if not exists uq_broadcast_recipients_contact
  on broadcast_recipients (broadcast_id, contact_id);

update broadcast_recipients
set error_message = 'El envío se interrumpió y no se sabe si el mensaje llegó. Revisa el chat del contacto antes de volver a enviarlo.'
where error_message = 'Interrupted mid-send; delivery outcome unknown';

-- ============================================================
-- MIGRATION 34: EQUIPOS (SUPERVISOR) Y AJUSTES (revisión, tanda 7A)
-- ============================================================
-- Tanda 7A: configuración de equipos y ajustes del espacio (R2-17 y ajustes JSON).
--
-- 1. teams.supervisor_skips_chats: "El supervisor no recibe chats". Con true, los
--    supervisores del equipo quedan fuera del reparto automático (la asignación
--    a mano sigue permitida). Por defecto false: los supervisores siguen
--    entrando al reparto como hasta ahora.
-- 2. merge_workspace_settings: mezcla claves en workspaces.settings en una sola
--    instrucción, para que dos administradores que guardan secciones distintas
--    a la vez no se pisen. Es SECURITY INVOKER: rige la misma RLS que un UPDATE
--    normal de workspaces (solo Dueño/Administrador).
--
-- Orden de despliegue: ambas piezas son aditivas y el código las tolera
-- ausentes (lee los equipos con select *, y si la función no existe guarda los
-- ajustes como antes). Lo ideal es aplicar esta migración ANTES de desplegar;
-- si se despliega primero, solo faltan el interruptor del supervisor (no se
-- puede guardar hasta migrar) y la mezcla atómica de ajustes.

alter table public.teams
  add column if not exists supervisor_skips_chats boolean not null default false;

create or replace function public.merge_workspace_settings(
  p_workspace_id uuid,
  p_set jsonb,
  p_remove text[] default '{}'
) returns void
language sql
security invoker
set search_path = public
as $$
  update public.workspaces
     set settings = (coalesce(settings, '{}'::jsonb) - coalesce(p_remove, '{}'::text[])) || coalesce(p_set, '{}'::jsonb)
   where id = p_workspace_id;
$$;

revoke all on function public.merge_workspace_settings(uuid, jsonb, text[]) from public, anon;
grant execute on function public.merge_workspace_settings(uuid, jsonb, text[]) to authenticated, service_role;

-- Tanda 7B: secuencias robustas (R2-B1, R2-B3).
--
-- Cada paso de una secuencia pasa a tener un id estable (dentro del JSON de
-- `sequences.steps`), y la inscripción guarda el id del paso en el que va.
-- Así, editar los pasos de una secuencia activa (agregar, quitar o reordenar)
-- no desordena a quienes ya están dentro. Aditiva: no borra nada. Las
-- inscripciones que ya existan quedan con NULL y siguen usando el número de paso.
--
-- Orden de despliegue: aplicar esta migración ANTES de desplegar el código de la
-- tanda 7B (el código escribe esta columna; sin ella, las inscripciones y los
-- avances de paso fallan). Es segura de aplicar con el código anterior.

alter table public.sequence_enrollments
  add column if not exists current_step_id text;

-- Tanda 9: tipo de contacto visible y confirmado en el chat.
--
-- 1. contacts.contact_type_confirmed_at / _by: cuándo y quién confirmó el tipo
--    (una persona, al responder la pregunta del chat o al cambiarlo a mano).
--    NULL = "Sin confirmar": se asignó solo al llegar. Un cambio automático (regla,
--    inactividad, importación) NO confirma.
-- 2. contacts.contact_type_prompt_snoozed_until: "Preguntar después" (7 días).
-- 3. contact_types.description: texto corto que se muestra en el menú del chip.
-- 4. Ajuste de inactividad automática: workspaces.settings.contact_type_inactivity
--    = { "enabled": bool, "type_id": uuid, "days": int }. Se enciende solo en los
--    espacios que ya tienen un tipo activo llamado "Inactivo" (90 días); el resto
--    lo activa el dueño en Configuración → Tipos de contacto.
-- 5. Historial: se reutiliza `activity` (type = 'contact_type_changed'), que ya
--    guarda de/a (from_value/to_value), quién (actor_id, NULL = automático) y la
--    fecha. El origen y el motivo van en meta: { source, reason_text }.
--    No hay tabla nueva: su RLS (activity_select) ya sigue la visibilidad del
--    contacto y solo escribe el servidor.
-- 6. Índices para la tarea diaria de inactividad y el historial de la ficha.
--
-- Aditiva: no borra ni cambia datos existentes salvo el relleno de abajo.
-- Escrituras: solo por acciones del servidor con el cliente de servicio (00031 ya
-- retiró el UPDATE directo de contacts a los usuarios; las columnas nuevas lo heredan).
--
-- Orden de despliegue: aplicar esta migración ANTES de desplegar el código de la
-- tanda 9. Es segura con el código anterior: las columnas nuevas son opcionales
-- y el código viejo no las lee ni las escribe. Si el código se desplegara primero,
-- la bandeja seguiría funcionando (lee contactos con select *), pero la pregunta
-- del chat, "Preguntar después", la descripción y la inactividad automática no
-- guardarían nada hasta migrar.

alter table public.contacts
  add column if not exists contact_type_confirmed_at timestamptz,
  add column if not exists contact_type_confirmed_by uuid references auth.users(id) on delete set null,
  add column if not exists contact_type_prompt_snoozed_until timestamptz;

alter table public.contact_types
  add column if not exists description text;

alter table public.contact_types
  drop constraint if exists contact_types_description_len;
alter table public.contact_types
  add constraint contact_types_description_len
  check (description is null or char_length(description) <= 200);

-- Tarea diaria de inactividad: gestiones ganadas por fecha de cierre.
create index if not exists idx_cases_won_closed
  on public.cases(workspace_id, closed_at)
  where status = 'won';

-- Historial del tipo por contacto (últimos cambios en la ficha).
create index if not exists idx_activity_contact_type_changes
  on public.activity(contact_id, created_at desc)
  where type = 'contact_type_changed';

-- Relleno: quien ya compró (gestión ganada) o ya tiene un tipo distinto del de
-- por defecto, queda confirmado. La fecha es la de su última venta ganada (o
-- la del alta), NO la de hoy: así la inactividad automática no queda frenada
-- por este relleno. confirmed_by queda NULL (no hay una persona detrás).
update public.contacts c
   set contact_type_confirmed_at = coalesce(
         (select max(k.closed_at) from public.cases k where k.contact_id = c.id and k.status = 'won'),
         c.created_at
       )
 where c.contact_type_confirmed_at is null
   and (
     exists (select 1 from public.cases k where k.contact_id = c.id and k.status = 'won')
     or (
       c.contact_type_id is not null
       and not exists (
         select 1 from public.contact_types t
          where t.id = c.contact_type_id and t.is_default
       )
     )
   );

-- Inactividad automática: encendida solo donde ya existe el tipo "Inactivo".
update public.workspaces w
   set settings = coalesce(w.settings, '{}'::jsonb) || jsonb_build_object(
         'contact_type_inactivity',
         jsonb_build_object('enabled', true, 'type_id', t.id, 'days', 90)
       )
  from (
    select distinct on (workspace_id) workspace_id, id
      from public.contact_types
     where archived_at is null and lower(btrim(name)) = 'inactivo'
     order by workspace_id, position
  ) t
 where t.workspace_id = w.id
   and not (coalesce(w.settings, '{}'::jsonb) ? 'contact_type_inactivity');

-- ============================================================
-- MIGRATION 37: GUIA DE LA GESTION
-- ============================================================
-- Tanda 10: "Guía de la gestión" en el chat.
--
-- Reemplaza el selector libre de etapas de la tarjeta de gestión por una guía
-- que dice qué hacer ahora y ofrece el siguiente paso. Todo es configurable por
-- tipo de gestión y por etapa en Configuración → Gestiones:
--
--   case_stages.guide_text  texto "Ahora:" de la etapa (hasta 200 caracteres).
--   case_stages.next_steps  pasos siguientes permitidos, en orden: arreglo JSON de
--                           { "stage_id": uuid, "label": texto opcional } (etapa
--                           abierta o final) o { "action": "remind_tomorrow",
--                           "label": texto } (ayuda: fija el próximo contacto
--                           para mañana sin cambiar la etapa). NULL o vacío =
--                           predeterminado: la siguiente etapa abierta + todas
--                           las etapas finales.
--   case_stages.requires    lo que se pide en la etapa antes de avanzar:
--                           NULL | 'category' | 'solution' | 'note'.
--   case_types.strict_order "Orden estricto para asesores" (predeterminado NO).
--                           Si está activo, un asesor solo puede pasar a los pasos
--                           siguientes configurados o volver un paso; lo exige el
--                           servidor. Supervisores, administradores y la
--                           automatización (flujos, reglas, cron) quedan exentos.
--
-- Aditiva: solo agrega columnas opcionales (o con valor predeterminado) y rellena
-- los textos y pasos de la tienda por NOMBRE de tipo y de etapa; donde un nombre
-- no existe (p. ej. el gimnasio) no hace nada. No pisa lo que ya tenga contenido.
--
-- RLS: sin cambios. case_stages y case_types ya permiten leer según el espacio y
-- escribir solo a administradores; las columnas nuevas heredan esas políticas.
--
-- Orden de despliegue: aplicar esta migración ANTES de desplegar el código. Es
-- segura con el código anterior (las columnas nuevas son opcionales y el código
-- viejo no las lee). Si el código se desplegara primero, la tarjeta de gestión
-- seguiría funcionando (lee las etapas con select *), pero Configuración no
-- podría guardar textos, pasos ni el orden estricto hasta migrar.

alter table public.case_stages
  add column if not exists guide_text text,
  add column if not exists next_steps jsonb,
  add column if not exists requires text;

alter table public.case_stages drop constraint if exists case_stages_guide_text_len;
alter table public.case_stages
  add constraint case_stages_guide_text_len
  check (guide_text is null or char_length(guide_text) <= 200);

alter table public.case_stages drop constraint if exists case_stages_requires_check;
alter table public.case_stages
  add constraint case_stages_requires_check
  check (requires is null or requires in ('category', 'solution', 'note'));

alter table public.case_stages drop constraint if exists case_stages_next_steps_array;
alter table public.case_stages
  add constraint case_stages_next_steps_array
  check (next_steps is null or jsonb_typeof(next_steps) = 'array');

alter table public.case_types
  add column if not exists strict_order boolean not null default false;

-- ── Relleno de la tienda: por nombre de tipo y de etapa ──────────────────────
-- Cada elemento: tipo, etapa, texto, requires y pasos [{ to: nombre de etapa,
-- label: texto opcional }] o [{ action: 'remind_tomorrow', label }].
do $seed$
declare
  seeds jsonb := $json$[
    {"type":"Venta","stage":"Nuevo interesado","guide":"Saluda y pregunta qué producto busca.","requires":null,
     "steps":[{"to":"Asesorando","label":"Ya sé qué busca"}]},
    {"type":"Venta","stage":"Asesorando","guide":"Recomienda el producto y confirma sabor, tamaño y dirección.","requires":null,
     "steps":[{"to":"Pedido o enlace de pago enviado","label":"Ya envié el pedido o enlace de pago"},{"to":"No compró"}]},
    {"type":"Venta","stage":"Pedido o enlace de pago enviado","guide":"Confirma que el cliente recibió el enlace y cómo va a pagar.","requires":null,
     "steps":[{"to":"Esperando pago"}]},
    {"type":"Venta","stage":"Esperando pago","guide":"Espera la confirmación del pago (Yape, Plin o transferencia).","requires":null,
     "steps":[{"to":"Pagado","label":"Pagó"},{"action":"remind_tomorrow","label":"Aún no, recordarle mañana"},{"to":"No compró"}]},
    {"type":"Postventa","stage":"Nueva","guide":"Pregunta qué pasó y elige la categoría.","requires":"category",
     "steps":[{"to":"En gestión"}]},
    {"type":"Postventa","stage":"En gestión","guide":"Registra la solución antes del plazo y coordina con almacén o courier.","requires":"solution",
     "steps":[{"to":"Esperando al cliente"},{"to":"Esperando almacén o courier"},{"to":"Resuelta"}]},
    {"type":"Postventa","stage":"Esperando al cliente","guide":"Espera la respuesta del cliente; si no responde, recuérdale.","requires":null,
     "steps":[{"to":"En gestión"},{"to":"Resuelta"},{"to":"Sin solución"}]},
    {"type":"Postventa","stage":"Esperando almacén o courier","guide":"Haz seguimiento al almacén o courier y avisa al cliente.","requires":null,
     "steps":[{"to":"En gestión"},{"to":"Resuelta"}]},
    {"type":"Recompra","stage":"Recordatorio enviado","guide":"Espera su respuesta; si no contesta, insiste una vez.","requires":null,
     "steps":[{"to":"Interesado"},{"to":"No compró"}]},
    {"type":"Recompra","stage":"Interesado","guide":"Arma el pedido como en una venta.","requires":null,
     "steps":[{"to":"Compró"},{"to":"No compró"}]},
    {"type":"Consulta","stage":"Abierta","guide":"Responde la consulta.","requires":null,
     "steps":[{"to":"Resuelta"}]}
  ]$json$::jsonb;
  seed jsonb;
  st record;
  step jsonb;
  steps jsonb;
  target uuid;
begin
  for seed in select * from jsonb_array_elements(seeds) loop
    for st in
      select s.id, s.case_type_id
        from public.case_stages s
        join public.case_types t on t.id = s.case_type_id
       where lower(btrim(t.name)) = lower(seed->>'type')
         and lower(btrim(s.name)) = lower(seed->>'stage')
         and s.archived_at is null
         and s.guide_text is null
         and s.next_steps is null
         and s.requires is null
    loop
      steps := '[]'::jsonb;
      for step in select * from jsonb_array_elements(seed->'steps') loop
        if step ? 'action' then
          steps := steps || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
            'action', step->>'action',
            'label', step->>'label')));
        else
          select x.id into target
            from public.case_stages x
           where x.case_type_id = st.case_type_id
             and x.archived_at is null
             and lower(btrim(x.name)) = lower(step->>'to')
           order by x.position
           limit 1;
          if target is not null then
            steps := steps || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
              'stage_id', target,
              'label', step->>'label')));
          end if;
        end if;
        target := null;
      end loop;

      update public.case_stages
         set guide_text = seed->>'guide',
             requires = seed->>'requires',
             next_steps = case when jsonb_array_length(steps) > 0 then steps else null end
       where id = st.id;
    end loop;
  end loop;
end
$seed$;


-- ============================================================
-- MIGRATION 38: UNICA SIN CLASIFICAR
-- ============================================================
-- Tanda 10 (cierre): una sola gestión "Sin clasificar" activa por contacto.
--
-- La acción manual de "Nueva gestión" ya bloquea crear una gestión sin tipo
-- (case_type_id nulo) si el contacto tiene otra abierta o programada, pero
-- la comprobación y el insert no son atómicos: dos pedidos simultáneos (doble
-- clic, dos asesores) podían crear dos "Sin clasificar". Esta migración cierra
-- el hueco en la base:
--
-- 1. Índice único parcial en public.cases sobre (contact_id) para las gestiones
--    sin tipo que están abiertas o programadas. No lleva workspace_id: un
--    contacto pertenece a un solo espacio (check_case_refs lo garantiza), así
--    que contact_id ya basta. Las gestiones con tipo y las cerradas quedan
--    fuera del índice, y no cambia nada para ellas (se pueden seguir abriendo
--    varias del mismo tipo cuando el tipo lo permite).
--    Un segundo insert sin tipo para el mismo contacto falla con 23505
--    (unique_violation) y el código lo traduce: la acción manual devuelve
--    "Ya tiene una gestión abierta: clasifícala en vez de crear otra.".
--
-- 2. open_inbound_case (00020, única versión vigente) se redefine igual que
--    antes más un manejo de 23505: la función serializa a los mensajes entrantes
--    con un bloqueo por contacto, pero no a una apertura manual simultánea.
--    Si el insert choca con el índice, devuelve la gestión sin clasificar que
--    ya existe ({ created: false }) en vez de fallar, como cuando la encuentra
--    al principio. Misma firma y mismos permisos (solo service_role).
--
-- Aditiva e idempotente: se puede volver a ejecutar. Crear el índice falla si
-- ya hubiera dos gestiones sin tipo activas del mismo contacto; en producción
-- se revisó y no hay duplicados. Para comprobarlo antes:
--   select contact_id, count(*) from public.cases
--    where case_type_id is null and status in ('open','scheduled')
--    group by 1 having count(*) > 1;
--
-- Orden de despliegue: aplicar esta migración ANTES de desplegar el código; es
-- segura con el código anterior (solo puede hacer fallar un insert que ya era
-- un duplicado que el código nuevo bloquea).

-- ============================================================
-- 1. Una sola "Sin clasificar" activa por contacto
-- ============================================================

create unique index if not exists uq_cases_one_unclassified_active
  on public.cases (contact_id)
  where case_type_id is null and status in ('open', 'scheduled');

-- ============================================================
-- 2. open_inbound_case: reutiliza la sin clasificar si otra apertura se adelanta
-- ============================================================

create or replace function public.open_inbound_case(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_case_type_id uuid,
  p_stage_id uuid,
  p_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case_id uuid;
  v_at timestamptz := coalesce(p_at, now());
begin
  if not exists (
    select 1 from public.contacts c
    where c.id = p_contact_id and c.workspace_id = p_workspace_id
  ) then
    raise exception 'contact_not_in_workspace' using errcode = '23514';
  end if;

  -- Serializa por contacto hasta el fin de la transacción: el segundo mensaje
  -- espera y, al seguir, ya ve la gestión que abrió el primero.
  perform pg_advisory_xact_lock(hashtextextended('open_inbound_case:' || p_contact_id::text, 0));

  select c.id into v_case_id
  from public.cases c
  where c.contact_id = p_contact_id and c.status = 'open'
  order by c.opened_at desc nulls last, c.created_at desc
  limit 1;

  if v_case_id is not null then
    return jsonb_build_object('case_id', v_case_id, 'created', false);
  end if;

  begin
    insert into public.cases (
      workspace_id, contact_id, case_type_id, stage_id, status, origin,
      opened_at, last_inbound_at, waiting_since
    )
    values (
      p_workspace_id, p_contact_id, p_case_type_id, p_stage_id, 'open', 'inbound',
      v_at, v_at, v_at
    )
    returning id into v_case_id;
  exception when unique_violation then
    -- Una apertura manual sin clasificar se coló entre el select y el insert
    -- (no toma el bloqueo de arriba): se usa esa gestión.
    select c.id into v_case_id
    from public.cases c
    where c.contact_id = p_contact_id
      and c.case_type_id is null
      and c.status in ('open', 'scheduled')
    order by c.opened_at desc nulls last, c.created_at desc
    limit 1;
    if v_case_id is null then
      raise; -- otra violación única: no es la que se sabe resolver
    end if;
    return jsonb_build_object('case_id', v_case_id, 'created', false);
  end;

  return jsonb_build_object('case_id', v_case_id, 'created', true);
end;
$$;

revoke all on function public.open_inbound_case(uuid, uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.open_inbound_case(uuid, uuid, uuid, uuid, timestamptz) to service_role;


-- ============================================================
-- MIGRATION 39: VARIOS DUENOS
-- ============================================================
-- Parte 1 de "Ver como": varios Dueños por espacio, y siempre al menos uno.
--
-- Hasta ahora cada espacio tenía un solo Dueño (role = 'owner' en
-- workspace_members) y el código lo daba por hecho. Ahora un Dueño puede
-- nombrar a otros Dueños y quitarles el rol (Configuración → Equipo → Editar).
-- La regla "nunca queda un espacio sin Dueño" no puede depender solo de la
-- pantalla ni de la acción del servidor: dos Dueños que se degradan o se quitan
-- a la vez pasarían ambos la comprobación y dejarían el espacio sin Dueño. Por
-- eso la regla vive en la base:
--
-- Un trigger BEFORE UPDATE/DELETE en public.workspace_members (función
-- guard_last_workspace_owner) rechaza, con el error 'last_owner_required'
-- (errcode 23514), cualquier cambio que deje a un espacio sin Dueño:
--   - quitar a un Dueño (delete),
--   - cambiarle el rol a otro distinto de 'owner',
--   - moverlo a otro espacio o a otro usuario (cambiar workspace_id o user_id).
-- Aplica a todos los clientes (también al de servicio): es la regla de datos.
--
-- Atomicidad: antes de contar los otros Dueños, la función toma un bloqueo
-- consultivo por espacio (pg_advisory_xact_lock) hasta el fin de la
-- transacción. De dos Dueños que se degradan a la vez, el segundo espera al
-- primero, ve que ya no queda otro Dueño y falla.
--
-- No rompe los borrados en cascada:
--   - Borrar un espacio: cuando se borran sus miembros, la fila de
--     public.workspaces ya no existe en la transacción, y la función lo deja
--     pasar.
--   - Borrar un usuario de Auth (auth.users): cuando se borra su membresía, el
--     usuario ya no existe, y la función lo deja pasar. Es una operación
--     deliberada de quien administra la base; la app nunca borra cuentas con
--     membresía (solo revierte una cuenta que acaba de crear). Si un espacio
--     se queda sin Dueño por esta vía, hay que nombrar uno con SQL o con
--     scripts/crear-admin.mjs.
--   - Crear un espacio (create_workspace de 00017/00030, handle_new_user) solo
--     inserta al Dueño: los inserts no se tocan.
--
-- Revisión de lo que suponía "un solo Dueño": las políticas de claves y de
-- invitaciones (00002, 00006, 00031) usan "existe una fila con rol owner" y
-- funcionan igual con varios; create_workspace comprueba "es Dueño de algún
-- espacio" (exists). Ninguna función SQL usa select ... into sobre el Dueño.
--
-- guard_workspace_member_update (00019) no cambia: con el cliente del usuario
-- sigue prohibido tocar roles de/hacia 'owner'; los cambios de rol los hace el
-- servidor (cliente de servicio) tras comprobar que quien llama es Dueño.
--
-- Aditiva e idempotente: se puede volver a ejecutar. No cambia datos. Si algún
-- espacio ya estuviera sin Dueño, esta migración no lo arregla ni lo bloquea
-- (la regla solo mira cambios nuevos); para revisarlo:
--   select w.id, w.name from public.workspaces w
--    where not exists (select 1 from public.workspace_members m
--                      where m.workspace_id = w.id and m.role = 'owner');
--
-- Orden de despliegue: aplicar esta migración ANTES de desplegar el código. Es
-- segura con el código anterior (que nunca quita ni degrada a un Dueño).

create or replace function public.guard_last_workspace_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_others integer;
begin
  -- Solo importa si la fila que se cambia o se borra es de un Dueño.
  if old.role is distinct from 'owner' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Update que lo deja igual de Dueño en el mismo espacio y con el mismo usuario.
  if tg_op = 'UPDATE'
     and new.role = 'owner'
     and new.workspace_id is not distinct from old.workspace_id
     and new.user_id is not distinct from old.user_id then
    return new;
  end if;

  -- Borrado en cascada de un espacio: ya no existe, no hay Dueño que proteger.
  if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Borrado en cascada de una cuenta de Auth: la cuenta ya no existe.
  if tg_op = 'DELETE'
     and not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;

  -- Serializa los cambios de Dueños de este espacio hasta el fin de la
  -- transacción: el segundo en llegar espera y cuenta con el cambio del primero.
  perform pg_advisory_xact_lock(hashtextextended('workspace_owners:' || old.workspace_id::text, 0));

  select count(*) into v_others
  from public.workspace_members m
  where m.workspace_id = old.workspace_id
    and m.role = 'owner'
    and m.user_id <> old.user_id;

  if v_others = 0 then
    raise exception 'last_owner_required'
      using errcode = '23514',
            hint = 'Siempre debe quedar al menos un Dueño en el espacio de trabajo.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.guard_last_workspace_owner() from public, anon, authenticated;

drop trigger if exists guard_last_workspace_owner on public.workspace_members;
create trigger guard_last_workspace_owner
  before update of role, workspace_id, user_id or delete on public.workspace_members
  for each row execute function public.guard_last_workspace_owner();


-- ============================================================
-- MIGRATION 40: VER COMO
-- ============================================================
-- Parte 2 de "Ver como": el Dueño ve el CRM tal como lo ve otra persona (o un
-- rol de ejemplo), SOLO LECTURA, con registro y caducidad de 30 minutos.
--
-- Cómo funciona (cambio de identidad dentro de la base, atado a la sesión del
-- Dueño):
--   * PostgREST ejecuta una función "pre-request" antes de CADA petición a la
--     API de datos (pgrst.db_pre_request). La nuestra es
--     crm_private.view_as_pre_request(). Si el JWT de la petición (sub +
--     session_id) tiene una fila ACTIVA en public.view_as_sessions, el sub del
--     JWT pasa a ser el de la persona mirada y la transacción queda en SOLO
--     LECTURA (transaction_read_only = on). Desde ahí auth.uid(), todas las
--     políticas RLS y can_see_contact*, is_ws_admin, is_ws_supervisor... corren
--     como esa persona, sin tocar ninguna política. Cualquier INSERT/UPDATE/
--     DELETE (o RPC que escriba) falla con el error 25006.
--   * No se crea ningún token ni se inicia sesión como la persona: el JWT sigue
--     siendo el del Dueño. last_sign_in_at y el estado "Pendiente" de una
--     persona invitada no cambian.
--   * "Por rol" (Administrador, Supervisor/Asesor de un equipo) no usa cuentas
--     reales: la fila de la sesión lleva un id inventado (que no existe en
--     auth.users) y dos vistas internas de "membresías efectivas"
--     (crm_private.effective_workspace_members / effective_team_members =
--     tabla real + las sesiones de rol activas) hacen que ese id parezca
--     miembro. Las 7 funciones de permisos leen esas vistas; para personas
--     reales el resultado es idéntico al de antes.
--   * Cabecera x-crm-read-only: 1. Los clientes del servidor de la app la envían
--     mientras hay una vista activa; el pre-request deja entonces la
--     transacción en solo lectura también para el cliente de servicio.
--   * Tras caducar (o con la fila sin cerrar) la identidad vuelve a ser la del
--     Dueño, pero la base mantiene el solo lectura 5 minutos más, hasta que el
--     Dueño pulse "Volver a mi vista" (stop) o pase ese margen.
--
-- Piezas:
--   * public.view_as_sessions: estado y REGISTRO (no se borra nunca). RLS activada
--     sin políticas y sin permisos para anon/authenticated (como
--     workspace_secrets): solo el servidor (service_role) la lee.
--   * crm_private (esquema NO expuesto por la API): el pre-request y las dos
--     vistas. El pre-request vive aquí y no en public para que "ninguna
--     función security definer de public sea ejecutable por anon" (B-4 de
--     rls_endurecer_check.sql) siga siendo cierto.
--   * public.view_as_start / view_as_stop / view_as_touch: solo service_role.
--     view_as_start valida en la base: quien mira es Dueño del espacio, no se
--     mira a sí mismo, la persona es miembro del espacio y no pertenece a
--     ningún espacio donde quien mira no sea Dueño (evita fugas entre
--     espacios), el equipo del rol está activo y es del espacio. Cierra la vista
--     anterior de esa misma sesión de Auth.
--   * public.view_as_current(): lo que la base aplicó a esta petición (para
--     authenticated).
--   * Las 7 funciones de permisos se reescriben con un bloque DO que toma el
--     cuerpo VIGENTE (pg_get_functiondef), cambia public.workspace_members /
--     public.team_members por las vistas efectivas y ABORTA si algo no cuadra.
--
-- Costes conocidos: Realtime y Storage no pasan por el pre-request (Realtime
-- entrega eventos con nivel de Dueño; Storage no tiene políticas de usuario).
--
-- INTERRUPTOR DE APAGADO (deja la API exactamente como antes de esta migración;
-- no borra nada ni hace falta redeploy):
--     alter role authenticator reset pgrst.db_pre_request;
--     notify pgrst, 'reload config';
-- Para volver a encenderlo:
--     alter role authenticator set pgrst.db_pre_request = 'crm_private.view_as_pre_request';
--     notify pgrst, 'reload config';
-- (Con el interruptor apagado las vistas efectivas siguen devolviendo lo mismo
-- que las tablas reales, porque solo añaden filas cuando el pre-request ha
-- cambiado la identidad a un id de ejemplo.)
--
-- Aditiva e idempotente: se puede volver a ejecutar. No cambia datos. Orden de
-- despliegue: aplicar ANTES del código; es inerte sin sesiones activas.

-- ============================================================
-- 1. Esquema privado
-- ============================================================

create schema if not exists crm_private;
revoke all on schema crm_private from public;
-- Solo USAGE: hace falta para que los roles de la API puedan llamar al
-- pre-request. No se concede nada sobre las vistas ni otras funciones.
grant usage on schema crm_private to anon, authenticated, service_role;

-- ============================================================
-- 2. Estado y registro de las vistas
-- ============================================================

create table if not exists public.view_as_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  viewer_id uuid not null,           -- Dueño que mira (sin FK: el registro no se borra)
  viewer_name text,
  auth_session_id uuid not null,     -- session_id del JWT del Dueño
  target_kind text not null check (target_kind in ('person', 'role')),
  target_user_id uuid not null,      -- persona real, o id inventado si es por rol
  target_label text not null,
  target_detail text,
  role_ws text check (role_ws in ('admin', 'member')),
  role_team_id uuid,                 -- sin FK: el registro sobrevive al equipo
  role_team_role text check (role_team_role in ('supervisor', 'agent')),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason in ('manual', 'expired', 'replaced', 'revoked')),
  sections text[] not null default '{}',
  constraint view_as_sessions_kind_ck check (
    (target_kind = 'role' and role_ws is not null)
    or (target_kind = 'person' and role_ws is null and role_team_id is null and role_team_role is null)
  ),
  constraint view_as_sessions_team_ck check (
    (role_team_id is null) = (role_team_role is null)
  )
);

-- Una sola vista activa por sesión de Auth.
create unique index if not exists uq_view_as_active_per_session
  on public.view_as_sessions (auth_session_id) where ended_at is null;
create index if not exists idx_view_as_active_role_target
  on public.view_as_sessions (target_user_id) where target_kind = 'role' and ended_at is null;
create index if not exists idx_view_as_ws_started
  on public.view_as_sessions (workspace_id, started_at desc);
create index if not exists idx_view_as_viewer
  on public.view_as_sessions (viewer_id, started_at desc);

alter table public.view_as_sessions enable row level security;
-- Sin políticas a propósito. Sin permisos para usuarios ni anónimos.
revoke all on public.view_as_sessions from public, anon, authenticated;
grant select on public.view_as_sessions to service_role;

comment on table public.view_as_sessions is
  '"Ver como": estado y registro de las vistas del Dueño. Sin políticas RLS; solo el servidor (service_role) lee. No se borra.';

-- ============================================================
-- 3. Membresías efectivas (tabla real + identidades de ejemplo activas)
-- ============================================================
-- Solo añaden filas cuando auth.uid() ES el id inventado de una vista por rol
-- activa: ese id solo lo adopta el pre-request, y solo para el Dueño de esa
-- sesión. Para cualquier otra persona devuelven exactamente la tabla real.

create or replace view crm_private.effective_workspace_members as
  select m.workspace_id, m.user_id, m.role
  from public.workspace_members m
  union all
  select s.workspace_id, s.target_user_id, s.role_ws
  from public.view_as_sessions s
  where s.target_kind = 'role'
    and s.ended_at is null
    and s.expires_at > now()
    and s.target_user_id = auth.uid();

create or replace view crm_private.effective_team_members as
  select t.team_id, t.user_id, t.role
  from public.team_members t
  union all
  select s.role_team_id, s.target_user_id, s.role_team_role
  from public.view_as_sessions s
  where s.target_kind = 'role'
    and s.role_team_id is not null
    and s.ended_at is null
    and s.expires_at > now()
    and s.target_user_id = auth.uid();

revoke all on crm_private.effective_workspace_members from public, anon, authenticated;
revoke all on crm_private.effective_team_members from public, anon, authenticated;

-- ============================================================
-- 4. Las 7 funciones de permisos leen las vistas efectivas
-- ============================================================
-- Se toma el cuerpo vigente (no una copia), se sustituyen las dos tablas y se
-- aborta si alguna función no existe, no es única o queda sin cambiar.

do $$
declare
  v_names text[] := array[
    'is_workspace_member', 'ws_role', 'is_ws_admin', 'is_team_member',
    'is_team_supervisor', 'can_see_contact_row', 'is_ws_supervisor'
  ];
  v_name text;
  v_oid oid;
  v_n int;
  v_def text;
  v_new text;
begin
  foreach v_name in array v_names loop
    select count(*) into v_n
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = v_name;
    if v_n <> 1 then
      raise exception '00040: se esperaba exactamente una función public.% y hay %', v_name, v_n;
    end if;

    select p.oid into v_oid
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = v_name;
    v_def := pg_get_functiondef(v_oid);
    v_new := replace(replace(v_def,
      'public.workspace_members', 'crm_private.effective_workspace_members'),
      'public.team_members', 'crm_private.effective_team_members');

    -- Debe leer alguna vista efectiva y no quedar ninguna lectura directa de
    -- las tablas reales (con o sin esquema).
    if v_new !~ 'crm_private\.effective_(workspace|team)_members' then
      raise exception '00040: % no lee workspace_members ni team_members; no se reconoce su cuerpo', v_name;
    end if;
    if regexp_replace(v_new, 'crm_private\.effective_(workspace|team)_members', '', 'g')
         ~ '(workspace_members|team_members)' then
      raise exception '00040: % aún menciona workspace_members/team_members sin esquema conocido', v_name;
    end if;
    if v_new !~* 'security definer' then
      raise exception '00040: % ya no es security definer; se aborta', v_name;
    end if;

    if v_new <> v_def then
      execute v_new;
    end if;
  end loop;

  -- Comprobación final: las 7 leen solo vistas efectivas.
  for v_name in
    select p.proname from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = any (v_names)
      and (pg_get_functiondef(p.oid) !~ 'crm_private\.effective_'
           or regexp_replace(pg_get_functiondef(p.oid), 'crm_private\.effective_(workspace|team)_members', '', 'g')
                ~ '(workspace_members|team_members)')
  loop
    raise exception '00040: % no quedó apuntando a las vistas efectivas', v_name;
  end loop;
end $$;

-- Nombre para mostrar de una cuenta (mismo criterio que displayName() de
-- lib/team-rules.ts: nombre completo, name, parte local del correo).
create or replace function crm_private.display_name_of(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data->>'name'), ''),
    nullif(split_part(u.email, '@', 1), ''),
    'Sin nombre'
  )
  from auth.users u where u.id = p_user;
$$;
revoke all on function crm_private.display_name_of(uuid) from public, anon, authenticated;

-- ============================================================
-- 5. Pre-request: cambia la identidad de la petición
-- ============================================================
-- Debe ser mínimo: se ejecuta en cada petición de la API. Si falla, no deja la
-- API caída: avisa y la petición sigue con su identidad real.

create or replace function crm_private.view_as_pre_request()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c jsonb;
  s record;
  h json;
  v_ro boolean := false;
  v_claims text;
  v_sub text;
begin
  -- OJO: transaction_read_only NO se puede fijar dentro del bloque con EXCEPTION:
  -- una subtransacción restaura el modo de solo lectura al terminar. Por eso el
  -- bloque solo DECIDE (variables) y los set_config se hacen después, fuera.
  begin
    -- Candado de los clientes del servidor (también service_role).
    h := nullif(current_setting('request.headers', true), '')::json;
    if h is not null and h->>'x-crm-read-only' = '1' then
      v_ro := true;
    end if;

    c := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    if c is not null
       and c->>'role' is not distinct from 'authenticated'
       and c->>'session_id' is not null
       and c->>'sub' is not null then
      select * into s
      from public.view_as_sessions v
      where v.auth_session_id = (c->>'session_id')::uuid
        and v.viewer_id = (c->>'sub')::uuid
        and v.ended_at is null
        and v.expires_at + interval '5 minutes' > now();
      if found then
        -- Vista sin cerrar: desde que empieza hasta 5 minutos tras caducar la
        -- base no deja escribir con esta sesión.
        v_ro := true;
        -- Solo cambia la identidad si sigue vigente y el Dueño sigue siendo Dueño.
        if s.expires_at > now()
           and exists (
             select 1 from public.workspace_members m
             where m.workspace_id = s.workspace_id
               and m.user_id = s.viewer_id
               and m.role = 'owner'
           ) then
          v_sub := s.target_user_id::text;
          v_claims := (c || jsonb_build_object(
              'sub', s.target_user_id,
              'view_as', jsonb_build_object('sid', s.id, 'by', s.viewer_id)
          ))::text;
        end if;
      end if;
    end if;
  exception when others then
    -- Si algo falla se deja pasar con la identidad real (nunca se cae la API).
    -- Pero si ya se había decidido el solo lectura, se conserva.
    raise warning 'view_as_pre_request: % (%)', sqlerrm, sqlstate;
    v_sub := null;
    v_claims := null;
  end;

  if v_ro then
    perform set_config('transaction_read_only', 'on', true);
  end if;
  if v_claims is not null then
    perform set_config('request.jwt.claims', v_claims, true);
    perform set_config('request.jwt.claim.sub', v_sub, true);
  end if;
end;
$$;

revoke all on function crm_private.view_as_pre_request() from public;
-- Imprescindible: sin esto cae TODA la API. PostgREST la llama con el rol de la
-- petición (anon, authenticated o service_role).
grant execute on function crm_private.view_as_pre_request() to anon, authenticated, service_role;

-- ============================================================
-- 6. view_as_current: lo que la base aplicó a esta petición
-- ============================================================
-- Devuelve null si la petición no está en vista (o ya caducó). El id que lee
-- viene del claim que SOLO pone el pre-request (un JWT firmado no puede traerlo).

create or replace function public.view_as_current()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c jsonb;
  s record;
  v_sid uuid;
  v_email text;
  v_name text;
  v_team text;
begin
  c := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  if c is null or c->'view_as'->>'sid' is null then
    return null;
  end if;
  v_sid := (c->'view_as'->>'sid')::uuid;
  select * into s from public.view_as_sessions v
  where v.id = v_sid
    and v.target_user_id = auth.uid()
    and v.ended_at is null
    and v.expires_at > now();
  if not found then
    return null;
  end if;
  if s.target_kind = 'person' then
    select u.email, crm_private.display_name_of(u.id)
      into v_email, v_name
    from auth.users u where u.id = s.target_user_id;
  else
    v_name := s.target_label;
  end if;
  if s.role_team_id is not null then
    select t.name into v_team from public.teams t where t.id = s.role_team_id;
  end if;
  return jsonb_build_object(
    'session_id', s.id,
    'workspace_id', s.workspace_id,
    'viewer_id', s.viewer_id,
    'kind', s.target_kind,
    'target_user_id', s.target_user_id,
    'label', s.target_label,
    'detail', s.target_detail,
    'name', v_name,
    'email', v_email,
    'role_ws', s.role_ws,
    'team_id', s.role_team_id,
    'team_name', v_team,
    'team_role', s.role_team_role,
    'started_at', s.started_at,
    'expires_at', s.expires_at
  );
end;
$$;

revoke all on function public.view_as_current() from public, anon;
grant execute on function public.view_as_current() to authenticated, service_role;

-- ============================================================
-- 7. view_as_start / view_as_stop / view_as_touch (solo servidor)
-- ============================================================
-- p_kind 'person': p_target_user = la persona. p_kind 'role': p_role es
-- 'admin' | 'supervisor' | 'agent' (estos dos con p_team). Devuelve un jsonb
-- con la misma forma que view_as_current, o lanza un error con mensaje estable
-- (view_as_not_owner, view_as_self, view_as_target_invalid, view_as_foreign_workspace,
-- view_as_team_invalid, view_as_bad_args).

create or replace function public.view_as_start(
  p_viewer uuid,
  p_auth_session uuid,
  p_workspace uuid,
  p_kind text,
  p_target_user uuid default null,
  p_role text default null,
  p_team uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_viewer_name text;
  v_target_id uuid;
  v_label text;
  v_detail text;
  v_role_ws text;
  v_team_role text;
  v_team_id uuid;
  v_team_name text;
  v_row public.view_as_sessions;
begin
  if p_viewer is null or p_auth_session is null or p_workspace is null or p_kind not in ('person', 'role') then
    raise exception 'view_as_bad_args' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace and m.user_id = p_viewer and m.role = 'owner'
  ) then
    raise exception 'view_as_not_owner' using errcode = '42501';
  end if;

  v_viewer_name := crm_private.display_name_of(p_viewer);

  if p_kind = 'person' then
    if p_target_user is null then
      raise exception 'view_as_bad_args' using errcode = '22023';
    end if;
    if p_target_user = p_viewer then
      raise exception 'view_as_self' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = p_workspace and m.user_id = p_target_user
    ) then
      raise exception 'view_as_target_invalid' using errcode = '22023';
    end if;
    -- Nadie que pertenezca a un espacio donde quien mira no sea Dueño.
    if exists (
      select 1 from public.workspace_members o
      where o.user_id = p_target_user
        and o.workspace_id <> p_workspace
        and not exists (
          select 1 from public.workspace_members w
          where w.workspace_id = o.workspace_id and w.user_id = p_viewer and w.role = 'owner'
        )
    ) then
      raise exception 'view_as_foreign_workspace' using errcode = '42501';
    end if;
    v_target_id := p_target_user;
    select crm_private.display_name_of(u.id), u.email
      into v_label, v_detail from auth.users u where u.id = p_target_user;
  else
    if p_role not in ('admin', 'supervisor', 'agent') then
      raise exception 'view_as_bad_args' using errcode = '22023';
    end if;
    if p_role = 'admin' then
      v_role_ws := 'admin';
      v_label := 'Administrador';
    else
      select t.id, t.name into v_team_id, v_team_name
      from public.teams t
      where t.id = p_team and t.workspace_id = p_workspace and t.archived_at is null;
      if v_team_id is null then
        raise exception 'view_as_team_invalid' using errcode = '22023';
      end if;
      v_role_ws := 'member';
      v_team_role := p_role;
      v_label := case p_role when 'supervisor' then 'Supervisor de ' else 'Asesor de ' end || v_team_name;
    end if;
    v_target_id := gen_random_uuid();   -- no existe en auth.users ni en ninguna tabla real
    v_detail := 'Ejemplo por rol, sin cuenta';
  end if;

  -- Cierra la vista anterior de esta sesión de Auth (y las caducadas sin cerrar).
  update public.view_as_sessions v
     set ended_at = now(),
         end_reason = case when v.expires_at <= now() then 'expired' else 'replaced' end
   where v.auth_session_id = p_auth_session and v.ended_at is null;

  insert into public.view_as_sessions (
    workspace_id, viewer_id, viewer_name, auth_session_id, target_kind, target_user_id,
    target_label, target_detail, role_ws, role_team_id, role_team_role, expires_at
  ) values (
    p_workspace, p_viewer, v_viewer_name, p_auth_session, p_kind, v_target_id,
    v_label, v_detail, v_role_ws, v_team_id, v_team_role, now() + interval '30 minutes'
  ) returning * into v_row;

  return jsonb_build_object(
    'session_id', v_row.id,
    'workspace_id', v_row.workspace_id,
    'viewer_id', v_row.viewer_id,
    'kind', v_row.target_kind,
    'target_user_id', v_row.target_user_id,
    'label', v_row.target_label,
    'detail', v_row.target_detail,
    'role_ws', v_row.role_ws,
    'team_id', v_row.role_team_id,
    'team_name', v_team_name,
    'team_role', v_row.role_team_role,
    'started_at', v_row.started_at,
    'expires_at', v_row.expires_at
  );
end;
$$;

create or replace function public.view_as_stop(
  p_viewer uuid,
  p_auth_session uuid,
  p_reason text default 'manual'
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int;
begin
  update public.view_as_sessions v
     set ended_at = now(),
         end_reason = case
           when v.expires_at <= now() then 'expired'
           when p_reason in ('manual', 'revoked') then p_reason
           else 'manual' end
   where v.auth_session_id = p_auth_session
     and v.viewer_id = p_viewer
     and v.ended_at is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- Marca de actividad y sección abierta. Devuelve expires_at si la vista sigue
-- activa, o null si ya no (caducada o cerrada).
create or replace function public.view_as_touch(
  p_viewer uuid,
  p_auth_session uuid,
  p_section text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exp timestamptz;
begin
  update public.view_as_sessions v
     set last_seen_at = now(),
         sections = case
           when p_section is null or length(p_section) > 60 then v.sections
           when cardinality(v.sections) > 0 and v.sections[cardinality(v.sections)] = p_section then v.sections
           when cardinality(v.sections) >= 200 then v.sections
           else array_append(v.sections, p_section) end
   where v.auth_session_id = p_auth_session
     and v.viewer_id = p_viewer
     and v.ended_at is null
     and v.expires_at > now()
  returning v.expires_at into v_exp;
  return v_exp;
end;
$$;

revoke all on function public.view_as_start(uuid, uuid, uuid, text, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.view_as_stop(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.view_as_touch(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.view_as_start(uuid, uuid, uuid, text, uuid, text, uuid) to service_role;
grant execute on function public.view_as_stop(uuid, uuid, text) to service_role;
grant execute on function public.view_as_touch(uuid, uuid, text) to service_role;

-- ============================================================
-- 8. Activar el pre-request (aborta si ya hay otro)
-- ============================================================

do $$
declare
  v_cur text;
begin
  select substring(c from '^pgrst\.db_pre_request=(.*)$') into v_cur
  from pg_roles r, unnest(r.rolconfig) c
  where r.rolname = 'authenticator' and c like 'pgrst.db_pre_request=%';

  if v_cur is not null and v_cur <> 'crm_private.view_as_pre_request' then
    raise exception '00040: authenticator ya tiene otro pgrst.db_pre_request (%). No se pisa; revisar a mano.', v_cur;
  end if;

  alter role authenticator set pgrst.db_pre_request = 'crm_private.view_as_pre_request';
end $$;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';


-- ============================================================
-- MIGRATION 41: CONFIABILIDAD DE LA ENTRADA Y SENAL DE VIDA
-- ============================================================
-- Tanda 1A (previa a producción): no perder mensajes entrantes y poder vigilar
-- que el sistema esté vivo.
--
-- Qué hace (dos temas, todo aditivo):
--
-- 1. webhook_events deja de ser solo una lista de ids vistos y pasa a ser la
--    BANDEJA DE ENTRADA DURABLE de los mensajes de Zernio (CONF-06 / CONF-07):
--      * status: 'received' (llegó, aún sin guardar contacto y chat),
--        'stored' (contacto y chat guardados; falta el trabajo posterior:
--        gestión, reparto, bot), 'processed' (todo hecho) o 'failed' (se agotaron
--        los intentos; los administradores reciben un aviso).
--      * payload: el cuerpo YA VERIFICADO (firma correcta), reducido a lo
--        necesario para reprocesar (texto, remitente, ids). No guarda fotos,
--        enlaces de archivos ni la foto de perfil. Se pone en NULL en cuanto el
--        evento queda 'processed' (no se conservan datos personales de lo que
--        ya se hizo); solo permanece en los pendientes o fallidos.
--      * attempts / last_error / locked_until: reintentos con tope y un candado
--        corto para que dos ejecuciones no procesen a la vez.
--      * contact_id / conversation_id / is_first_message / cases_ok_at /
--        flows_started_at: avance guardado, para que un reintento NO repita lo
--        ya hecho (no duplica chat, gestión ni respuesta del bot).
--    Filas anteriores a esta migración (y las que escriba el código anterior,
--    que solo manda event_id) quedan como 'processed' sin payload: el barrido
--    las ignora. Poda: 'processed' a las 48 h (como hasta ahora) y cualquier
--    otra a los 7 días.
--
-- 2. cron_runs: una fila por tarea automática (jobs, sequences, media_cleanup)
--    con su último inicio, último fin correcto, último error y duración. La
--    escribe cada cron y la lee /api/health y la tarjeta "Estado del sistema"
--    de Configuración. RLS activada SIN políticas y sin permisos para usuarios
--    ni anónimos: solo el servidor (service_role), como view_as_sessions.
--
-- Orden de despliegue: aplicar esta migración ANTES de desplegar el código.
-- Es segura con el código anterior: todas las columnas nuevas tienen valor por
-- defecto o admiten NULL, y el código anterior solo usa event_id / received_at
-- (sus filas nuevas quedan 'processed'). Es idempotente: se puede volver a
-- ejecutar. El código nuevo, si la migración aún no está, sigue procesando los
-- mensajes sin la bandeja durable (pierde la recuperación, no el mensaje).
--
-- Reprocesar a mano un evento fallido (dentro de los 7 días que se conserva):
--   update public.webhook_events
--      set status = 'received', attempts = 0, locked_until = null, last_error = null
--    where event_id = '<id>' and status = 'failed' and payload is not null;
-- El barrido del cron lo retoma en la siguiente pasada.

-- ============================================================
-- 1. webhook_events: bandeja de entrada durable
-- ============================================================

alter table public.webhook_events
  add column if not exists status text not null default 'processed',
  add column if not exists event_type text,
  add column if not exists channel_id uuid,
  add column if not exists payload jsonb,
  add column if not exists attempts integer not null default 0,
  add column if not exists last_error text,
  add column if not exists locked_until timestamptz,
  add column if not exists contact_id uuid,
  add column if not exists conversation_id uuid,
  add column if not exists is_first_message boolean,
  add column if not exists cases_ok_at timestamptz,
  add column if not exists flows_started_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists processed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'webhook_events_status_check'
      and conrelid = 'public.webhook_events'::regclass
  ) then
    alter table public.webhook_events
      add constraint webhook_events_status_check
      check (status in ('received', 'stored', 'processed', 'failed'));
  end if;
end $$;

-- El barrido del cron mira solo los pendientes; los fallidos se listan en Configuración.
create index if not exists webhook_events_pending_idx
  on public.webhook_events (received_at)
  where status in ('received', 'stored');
create index if not exists webhook_events_failed_idx
  on public.webhook_events (received_at)
  where status = 'failed';

comment on column public.webhook_events.status is
  'received = llegó sin guardar; stored = contacto y chat guardados, falta el trabajo posterior; processed = hecho; failed = se agotaron los intentos.';
comment on column public.webhook_events.payload is
  'Cuerpo verificado y reducido para reprocesar. NULL en cuanto el evento queda processed.';

-- Sin permisos para usuarios ni anónimos (ya tenía RLS sin políticas).
alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from public, anon, authenticated;
grant select, insert, update, delete on public.webhook_events to service_role;

-- ============================================================
-- 2. cron_runs: señal de vida de las tareas automáticas
-- ============================================================

create table if not exists public.cron_runs (
  name text primary key,
  last_started_at timestamptz,
  last_ok_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  last_duration_ms integer,
  -- Conteos pequeños de la última pasada (sin datos de personas).
  last_stats jsonb,
  updated_at timestamptz not null default now()
);

alter table public.cron_runs enable row level security;
-- Sin políticas a propósito. Sin permisos para usuarios ni anónimos.
revoke all on public.cron_runs from public, anon, authenticated;
grant select, insert, update, delete on public.cron_runs to service_role;

comment on table public.cron_runs is
  'Última ejecución de cada tarea automática (jobs, sequences, media_cleanup). La lee /api/health y Configuración > Estado del sistema.';

notify pgrst, 'reload schema';


-- ============================================================
-- MIGRATION 42: INDICES Y POLITICAS RLS DE RENDIMIENTO
-- ============================================================
-- Tanda 1B (rendimiento): índices que faltan y políticas RLS que evalúan
-- auth.uid() una sola vez por consulta (informe de base de datos BD-6, BD-5, BD-18).
--
-- 1. Índices de claves foráneas y de consulta (BD-6). Hoy las tablas son
--    pequeñas y no se nota, pero con volumen cada una de estas búsquedas se
--    vuelve una lectura secuencial:
--      * conversations(contact_id): Bandeja, Gestiones, Métricas y cada borrado
--        de contacto (cascada). El único índice con contact_id empieza por
--        channel_id y no sirve para buscar solo por contacto.
--      * sequence_enrollments(next_step_at) parcial: el cron de secuencias
--        (cada minuto) filtra status = 'active' y next_step_at <= ahora.
--      * Claves foráneas sin índice que usan las pantallas, los crons y los
--        borrados en cascada / "set null" (contactos, usuarios, flujos, etiquetas).
--    Todos con `create index if not exists`. NO se borra ningún índice.
--
-- 2. Búsqueda de texto de Contactos (BD-6): la búsqueda usa
--    `display_name/email/phone ilike '%texto%'` (contactos y Gestiones). Un
--    índice normal no ayuda con el comodín al inicio; sí uno trigram (GIN).
--    Se instala la extensión pg_trgm (viene incluida en Supabase; es una
--    extensión "de confianza", sin permisos especiales) en el esquema
--    `extensions` si existe, y si no en `public`. Solo agrega un tipo de índice;
--    no cambia ninguna consulta ni resultado.
--
-- 3. Políticas RLS con `auth.uid()` (BD-5): 11 políticas lo llamaban una vez
--    POR FILA; envuelto en `(select auth.uid())` Postgres lo evalúa una sola
--    vez por consulta (recomendación oficial de Supabase, "initplan"). El
--    significado de la política no cambia: auth.uid() es estable dentro de la
--    consulta, y también bajo "Ver como" (el pre-request fija el sub antes de
--    la consulta). El bloque NO reescribe las políticas a mano: lee el texto
--    actual de cada una en pg_policies, cambia únicamente `auth.uid()` por
--    `(select auth.uid())` y usa ALTER POLICY (mismo nombre, misma orden, mismos
--    roles). Antes de tocar nada comprueba que existen exactamente las 11
--    esperadas, y al final comprueba que (a) siguen siendo 11, (b) orden,
--    tipo y roles son los mismos, (c) el texto, deshaciendo el envoltorio, es
--    idéntico al de antes y (d) ya no queda ningún auth.uid() suelto. Si algo
--    no cuadra, lanza una excepción y la migración entera se revierte (el
--    bloque es una sola sentencia atómica).
--
-- Aditiva e idempotente: se puede volver a ejecutar (los índices ya existen y
-- las políticas ya envueltas se omiten).
--
-- Qué NO hace: no borra índices. Los "sin uso" (30) lo están porque la base es
-- diminuta; los redundantes por prefijo para revisar tras 2-4 semanas de uso
-- real, SIN tocarlos aquí: idx_contacts_workspace (cubierto por
-- idx_contacts_last_interaction), idx_conversations_workspace frente a
-- idx_conversations_status, idx_cases_next_action frente al parcial
-- idx_cases_next_action_pending e idx_comment_logs_channel_id frente al único
-- (channel_id, platform_comment_id).
--
-- Bloqueos y duración: CREATE INDEX (sin CONCURRENTLY, porque se ejecuta en una
-- transacción) toma un bloqueo que ESPERA a las escrituras en curso y bloquea
-- las nuevas escrituras de esa tabla mientras se construye (las lecturas
-- siguen). Con tablas de miles de filas cada índice tarda milisegundos; el
-- conjunto completo, del orden de 1-5 s. ALTER POLICY toma un bloqueo breve
-- sobre cada tabla. Aplicada como UNA transacción (apply_migration o el editor
-- SQL de Supabase) lleva lock_timeout = 10 s: si una transacción larga lo
-- impidiera, falla sin dejar nada a medias en vez de colgar la aplicación, y
-- basta con volver a ejecutarla. Si en el futuro hubiera tablas con millones de
-- filas, crear estos índices a mano con CONCURRENTLY.
--
-- Orden de despliegue: independiente del código (no cambia ninguna consulta ni
-- función). Se puede aplicar antes o después de desplegar; lo recomendable es
-- aplicarla en una hora de poco tráfico.

set local lock_timeout = '10s';

-- ============================================================
-- 1. Índices de claves foráneas y consultas frecuentes (BD-6)
-- ============================================================

-- El más importante: conversaciones de un contacto (Bandeja, Gestiones, Métricas, borrado en cascada).
create index if not exists idx_conversations_contact
  on public.conversations (contact_id);

-- Cron de secuencias (cada minuto): solo las inscripciones activas, por fecha del próximo paso.
create index if not exists idx_sequence_enrollments_due
  on public.sequence_enrollments (next_step_at)
  where status = 'active';

-- Borrado de contacto (cascada) y consultas por contacto.
create index if not exists idx_sequence_enrollments_contact
  on public.sequence_enrollments (contact_id);
create index if not exists idx_analytics_events_contact
  on public.analytics_events (contact_id);
create index if not exists idx_broadcast_recipients_contact
  on public.broadcast_recipients (contact_id);
-- El que existe (idx_flow_sessions_contact_active) es parcial: status = 'active'.
create index if not exists idx_flow_sessions_contact
  on public.flow_sessions (contact_id);
-- Borrar un flujo / analítica por flujo.
create index if not exists idx_flow_sessions_flow
  on public.flow_sessions (flow_id);
-- La clave primaria de contact_tags empieza por contact_id: faltaba por etiqueta (filtrar y borrar etiquetas).
create index if not exists idx_contact_tags_tag
  on public.contact_tags (tag_id);

-- Historial de actividad por conversación y por autor.
create index if not exists idx_activity_conversation
  on public.activity (conversation_id);
create index if not exists idx_activity_actor
  on public.activity (actor_id);

-- Autor del mensaje (al borrar un usuario se pone en null).
create index if not exists idx_messages_sent_by_user
  on public.messages (sent_by_user_id);

-- Quién creó / cerró / resolvió una gestión (al borrar un usuario se pone en null).
create index if not exists idx_cases_created_by
  on public.cases (created_by);
create index if not exists idx_cases_closed_by
  on public.cases (closed_by);
create index if not exists idx_cases_solution_by
  on public.cases (solution_by);

-- ============================================================
-- 2. Búsqueda de texto con ilike '%texto%' en contactos (BD-6)
-- ============================================================

do $$
declare
  v_schema text;
begin
  -- Si ya está instalada se respeta su esquema; si no, `extensions` (Supabase) o `public`.
  select n.nspname into v_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';

  if v_schema is null then
    v_schema := case when exists (select 1 from pg_namespace where nspname = 'extensions')
                     then 'extensions' else 'public' end;
    execute format('create extension if not exists pg_trgm with schema %I', v_schema);
  end if;

  execute format(
    'create index if not exists idx_contacts_display_name_trgm on public.contacts using gin (display_name %I.gin_trgm_ops)',
    v_schema);
  execute format(
    'create index if not exists idx_contacts_email_trgm on public.contacts using gin (email %I.gin_trgm_ops)',
    v_schema);
  execute format(
    'create index if not exists idx_contacts_phone_trgm on public.contacts using gin (phone %I.gin_trgm_ops)',
    v_schema);
end $$;

-- ============================================================
-- 3. Políticas RLS: auth.uid() -> (select auth.uid()) (BD-5)
-- ============================================================

do $$
declare
  -- Las 11 políticas que el asesor de rendimiento marcó (auth_rls_initplan).
  v_expected constant text[] := array[
    'workspace_members.workspace_members_select',
    'workspace_members.workspace_members_update',
    'workspace_members.workspace_members_delete',
    'case_notes.case_notes_insert',
    'notifications.notifications_select',
    'notifications.notifications_update',
    'saved_replies.saved_replies_select',
    'saved_replies.saved_replies_insert',
    'saved_replies.saved_replies_update',
    'saved_replies.saved_replies_delete',
    'spell_words.spell_words_insert'
  ];
  -- Texto de la expresión ya envuelta, tal como lo devuelve Postgres.
  c_wrapped constant text := '( SELECT auth.uid() AS uid)';
  c_mark constant text := '@@UID_ENVUELTO@@';
  r record;
  v_n int;
  v_qual text;
  v_check text;
  v_sql text;
  v_changed int := 0;
  v_before jsonb := '[]'::jsonb;
  v_after jsonb := '[]'::jsonb;
begin
  -- Comprobación previa: exactamente las 11 esperadas.
  select count(*) into v_n
  from pg_policies
  where schemaname = 'public' and (tablename || '.' || policyname) = any (v_expected);
  if v_n <> 11 then
    raise exception '00042: se esperaban 11 políticas y hay % (revisar a mano antes de continuar)', v_n;
  end if;

  -- Estado "antes": orden, tipo, roles y texto normalizado (sin el envoltorio).
  select coalesce(jsonb_agg(jsonb_build_object(
           'p', tablename || '.' || policyname,
           'cmd', cmd,
           'permissive', permissive,
           'roles', roles::text,
           'qual', replace(coalesce(qual, ''), c_wrapped, 'auth.uid()'),
           'chk', replace(coalesce(with_check, ''), c_wrapped, 'auth.uid()'))
         order by tablename, policyname), '[]'::jsonb)
    into v_before
  from pg_policies
  where schemaname = 'public' and (tablename || '.' || policyname) = any (v_expected);

  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public' and (tablename || '.' || policyname) = any (v_expected)
    order by tablename, policyname
  loop
    -- Se protegen los ya envueltos (idempotencia) y se envuelven los sueltos.
    v_qual := replace(replace(replace(coalesce(r.qual, ''), c_wrapped, c_mark),
                      'auth.uid()', '(select auth.uid())'), c_mark, c_wrapped);
    v_check := replace(replace(replace(coalesce(r.with_check, ''), c_wrapped, c_mark),
                       'auth.uid()', '(select auth.uid())'), c_mark, c_wrapped);

    if v_qual = coalesce(r.qual, '') and v_check = coalesce(r.with_check, '') then
      continue; -- ya estaba envuelta
    end if;

    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if r.qual is not null then
      v_sql := v_sql || ' using (' || v_qual || ')';
    end if;
    if r.with_check is not null then
      v_sql := v_sql || ' with check (' || v_check || ')';
    end if;
    execute v_sql;
    v_changed := v_changed + 1;
  end loop;

  -- Comprobación final: mismo número, mismas órdenes/roles, mismo texto esencial, sin auth.uid() suelto.
  select count(*) into v_n
  from pg_policies
  where schemaname = 'public' and (tablename || '.' || policyname) = any (v_expected);
  if v_n <> 11 then
    raise exception '00042: tras el cambio hay % políticas y se esperaban 11; se revierte todo', v_n;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'p', tablename || '.' || policyname,
           'cmd', cmd,
           'permissive', permissive,
           'roles', roles::text,
           'qual', replace(coalesce(qual, ''), c_wrapped, 'auth.uid()'),
           'chk', replace(coalesce(with_check, ''), c_wrapped, 'auth.uid()'))
         order by tablename, policyname), '[]'::jsonb)
    into v_after
  from pg_policies
  where schemaname = 'public' and (tablename || '.' || policyname) = any (v_expected);

  if v_after is distinct from v_before then
    raise exception '00042: el texto, la orden o los roles de alguna política cambiaron; se revierte todo';
  end if;

  select count(*) into v_n
  from pg_policies
  where schemaname = 'public'
    and (tablename || '.' || policyname) = any (v_expected)
    and (replace(coalesce(qual, ''), c_wrapped, '') like '%auth.uid()%'
         or replace(coalesce(with_check, ''), c_wrapped, '') like '%auth.uid()%');
  if v_n <> 0 then
    raise exception '00042: % políticas aún tienen auth.uid() sin envolver; se revierte todo', v_n;
  end if;

  raise notice '00042: % políticas reescritas con (select auth.uid())', v_changed;
end $$;



-- ============================================================
-- MIGRATION 43: DEFENSA (TOPES, REGISTRO DE SUBIDAS, CIERRE DE SESIONES)
-- ============================================================
-- Tanda 2 (previa a producción): defensa y abuso.
--
-- Qué hace (tres temas, todo aditivo e idempotente):
--
-- 1. Topes de frecuencia por usuario (SEG-01). Las funciones de Vercel no
--    comparten memoria, así que el contador vive en la base:
--      * rate_limit_hits: una fila por (clave, ventana). La clave la arma el
--        servidor ("message_send:min:<usuario>"); no guarda correos ni datos
--        personales (los correos se mezclan con un hash antes de llegar aquí).
--      * rate_limit_hit(clave, tope, segundos): suma 1 en la ventana fija actual
--        de forma ATÓMICA (insert ... on conflict do update) y devuelve si aún
--        está dentro del tope, cuántos van y cuántos segundos faltan para que
--        la ventana se reinicie. Solo la puede ejecutar el servidor (service_role).
--      La poda de filas viejas la hace el cron diario (media-cleanup).
--
-- 2. media_uploads (SEG-10): registro de los enlaces de subida que se entregaron
--    (chat o respuesta guardada). Sirve para (a) poner un tope de subidas sin
--    enviar por usuario y (b) que el cron diario borre del bucket los archivos
--    que nadie llegó a enviar ni a guardar en una respuesta. Se marca used_at
--    cuando el archivo se usa; el cron además comprueba message_media y
--    saved_replies antes de borrar nada.
--
-- 3. revoke_user_sessions (SEG-09): cierra TODAS las sesiones abiertas de una
--    persona (borra sus filas de auth.sessions y de auth.refresh_tokens). La
--    API de administración de supabase-js 2.95 solo sabe cerrar la sesión de un
--    JWT concreto (auth.admin.signOut(jwt)), no la de un usuario por id; esta
--    función es la forma de hacerlo sin conocer su token. Solo service_role.
--
-- RLS activada SIN políticas y sin permisos para anon/authenticated en las dos
-- tablas, como cron_runs (00041): solo el servidor las toca.
--
-- Orden de despliegue: aplicar esta migración ANTES de desplegar el código. Es
-- segura con el código anterior (solo agrega objetos nuevos que ese código no
-- usa). Si el código nuevo corre sin la migración, los topes de frecuencia
-- "dejan pasar" (y lo registran), el registro de subidas no se anota y el cierre
-- de sesiones se omite con un aviso en el log: nada se bloquea.
-- Es idempotente: se puede volver a ejecutar.

-- ============================================================
-- 1. Topes de frecuencia
-- ============================================================

create table if not exists public.rate_limit_hits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

-- La poda diaria borra por antigüedad de la ventana.
create index if not exists rate_limit_hits_window_idx
  on public.rate_limit_hits (window_start);

alter table public.rate_limit_hits enable row level security;
-- Sin políticas a propósito. Sin permisos para usuarios ni anónimos.
revoke all on public.rate_limit_hits from public, anon, authenticated;
grant select, insert, update, delete on public.rate_limit_hits to service_role;

comment on table public.rate_limit_hits is
  'Contadores de ventana fija para los topes de frecuencia (lib/rate-limit.ts). Se podan a diario desde /api/cron/media-cleanup.';

create or replace function public.rate_limit_hit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, current_hits integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_start timestamptz;
  v_hits integer;
begin
  if p_bucket is null or length(p_bucket) = 0 or length(p_bucket) > 200 then
    raise exception 'rate_limit_invalid_bucket';
  end if;
  if p_limit is null or p_limit < 1 or p_window_seconds is null
     or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'rate_limit_invalid_args';
  end if;

  -- Ventana fija alineada al reloj (epoch): todos los servidores coinciden.
  v_start := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);

  -- Un solo enunciado: dos peticiones simultáneas nunca leen el mismo valor.
  insert into public.rate_limit_hits as r (bucket, window_start, hits)
  values (p_bucket, v_start, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;

  allowed := v_hits <= p_limit;
  current_hits := v_hits;
  retry_after_seconds := greatest(
    1,
    ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - v_now)))::integer
  );
  return next;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- ============================================================
-- 2. Subidas pendientes (SEG-10)
-- ============================================================

create table if not exists public.media_uploads (
  path text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Sin llave foránea: si se borra la cuenta, el cron igual debe poder limpiar el archivo.
  user_id uuid not null,
  source text not null check (source in ('chat', 'reply')),
  created_at timestamptz not null default now(),
  used_at timestamptz
);

-- Tope por usuario (subidas sin usar recientes) y limpieza por antigüedad.
create index if not exists media_uploads_pending_user_idx
  on public.media_uploads (user_id, created_at)
  where used_at is null;
create index if not exists media_uploads_pending_age_idx
  on public.media_uploads (created_at)
  where used_at is null;

alter table public.media_uploads enable row level security;
revoke all on public.media_uploads from public, anon, authenticated;
grant select, insert, update, delete on public.media_uploads to service_role;

comment on table public.media_uploads is
  'Enlaces de subida entregados (chat o respuesta guardada). used_at se llena al enviar o guardar; el cron borra del bucket lo que sigue sin usar pasadas 48 h.';

-- ============================================================
-- 3. Cerrar las sesiones de una persona (SEG-09)
-- ============================================================

create or replace function public.revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if p_user_id is null then
    raise exception 'revoke_user_sessions_invalid_user';
  end if;

  -- Borrar la sesión impide renovar el token (refresh) y hace que Auth rechace
  -- el token de acceso restante cuando se le consulta. Los tokens de refresco
  -- caen en cascada; el segundo delete es un cinturón por si no hubiera cascada.
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_count = row_count;

  begin
    delete from auth.refresh_tokens where user_id::text = p_user_id::text;
  exception when others then
    null; -- esquema distinto de Auth: la sesión ya se borró, que es lo que importa
  end;

  return v_count;
end;
$$;

revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

notify pgrst, 'reload schema';



-- ============================================================
-- MIGRATION 44: CONSENTIMIENTO DE PUBLICIDAD Y DATOS DEL CLIENTE
-- ============================================================
-- Tanda 3 (previa a producción): consentimiento de publicidad y datos del cliente.
--
-- Qué hace (todo aditivo e idempotente):
--
-- 1. Consentimiento de publicidad en `contacts` (PRIV-01). Cinco columnas nuevas:
--      marketing_status      'unknown' (sin registrar) | 'accepted' (aceptó) | 'opted_out' (baja)
--      marketing_status_at   cuándo se anotó el estado actual
--      marketing_source      de dónde salió: 'manual' (un asesor), 'keyword' (palabra clave de
--                            Configuración), 'import' (declaración al importar), 'flow' (un flujo),
--                            'legacy' (ya estaba de baja antes de esta migración), 'erased'
--      marketing_set_by      quién lo anotó (null = el propio cliente o el sistema)
--      marketing_note        nota libre o versión del texto que aceptó
--    Los contactos existentes pasan a 'unknown', salvo los que ya tenían
--    is_subscribed = false, que pasan a 'opted_out' (origen 'legacy').
--
-- 2. Convivencia con `is_subscribed` (que mucho código y los flujos siguen usando).
--    Regla: is_subscribed = (marketing_status <> 'opted_out'), es decir "no se dio de
--    baja". Un trigger BEFORE INSERT/UPDATE (sync_contact_consent) lo mantiene siempre
--    coherente, venga el cambio de donde venga:
--      * Código nuevo: cambia marketing_status y el trigger ajusta is_subscribed.
--      * Código anterior o flujos: cambian is_subscribed = false -> baja ('flow');
--        is_subscribed = true sobre una baja -> 'accepted' (origen 'flow', el cliente
--        pidió el alta). Poner true sobre quien no estaba de baja no cambia nada.
--    Así el código anterior sigue funcionando con la migración aplicada.
--    Si el cambio de consentimiento llega con la sesión de una persona (API de datos y
--    no el servidor de la app), el trigger fija autor (esa persona), origen 'manual' y
--    fecha: no se puede fabricar un "aceptó" sin rastro ni a nombre de otro.
--    La publicidad (difusiones, secuencias, plantillas de publicidad) pide
--    marketing_status = 'accepted'; is_subscribed solo dice "no está de baja".
--
-- 3. Borrado de los datos de un cliente (PRIV-06 / BD-10, solo contacto):
--      * contact_erasures: registro de cada borrado (quién, cuándo, qué se quitó y qué
--        archivos faltan por borrar del almacenamiento). Los administradores lo leen;
--        escribe solo el servidor.
--      * erase_contact_data(espacio, contacto, quien): UNA transacción que anonimiza el
--        contacto y borra mensajes, archivos (filas), notas, canales, campos, etiquetas,
--        sesiones de flujo, inscripciones, destinatarios de difusión, avisos del
--        cliente y el contenido de sus mensajes de Zernio aún sin procesar. Conserva la fila del contacto SIN datos personales ("Cliente
--        eliminado", de baja) y sus gestiones sin texto libre (los reclamos conservan
--        además la solución escrita). Devuelve la lista de archivos del almacenamiento
--        para que la app los borre y, si falla, quede pendiente y se pueda reintentar.
--      * Se quita el borrado directo de contactos para usuarios (contacts_delete): un
--        borrado por la API dejaba archivos huérfanos y sin registro. La app no lo usa
--        (sus borrados internos van con la clave de servicio).
--
-- Orden de despliegue: aplicar esta migración ANTES de desplegar el código. Es segura
-- con el código anterior (solo agrega columnas con valor por defecto, un trigger que
-- mantiene is_subscribed y objetos nuevos que ese código no usa). Si el código nuevo
-- corriera SIN la migración, las pantallas de contactos y las difusiones fallarían
-- (consultan las columnas nuevas): por eso va primero.
-- Es idempotente: se puede volver a ejecutar.

set local lock_timeout = '10s';

-- ============================================================
-- 1. Columnas de consentimiento
-- ============================================================

alter table public.contacts
  add column if not exists marketing_status text not null default 'unknown',
  add column if not exists marketing_status_at timestamptz,
  add column if not exists marketing_source text,
  add column if not exists marketing_set_by uuid references auth.users(id) on delete set null,
  add column if not exists marketing_note text,
  add column if not exists erased_at timestamptz,
  add column if not exists erased_by uuid references auth.users(id) on delete set null;

alter table public.contacts drop constraint if exists contacts_marketing_status_check;
alter table public.contacts
  add constraint contacts_marketing_status_check
  check (marketing_status in ('unknown', 'accepted', 'opted_out'));

alter table public.contacts drop constraint if exists contacts_marketing_note_check;
alter table public.contacts
  add constraint contacts_marketing_note_check
  check (marketing_note is null or char_length(marketing_note) <= 500);

comment on column public.contacts.marketing_status is
  'Consentimiento de publicidad: unknown (sin registrar), accepted (aceptó), opted_out (baja). is_subscribed = (marketing_status <> ''opted_out'') lo mantiene el trigger sync_contact_consent.';
comment on column public.contacts.marketing_source is
  'Origen del estado: manual, keyword, import, flow, legacy, erased.';
comment on column public.contacts.erased_at is
  'Cuándo se borraron los datos personales del cliente (la fila queda anónima). Ver erase_contact_data.';

-- Contactos que ya estaban de baja antes de esta migración.
update public.contacts
   set marketing_status = 'opted_out',
       marketing_status_at = now(),
       marketing_source = 'legacy'
 where is_subscribed = false
   and marketing_status = 'unknown';

-- Apoyo del filtro de Contactos y del cálculo de destinatarios.
create index if not exists idx_contacts_marketing_status
  on public.contacts (workspace_id, marketing_status);

-- ============================================================
-- 2. Trigger de convivencia con is_subscribed
-- ============================================================

create or replace function public.sync_contact_consent()
returns trigger
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
begin
  -- Escritura con la sesión de una PERSONA (API de datos) que fija o cambia el
  -- consentimiento: autor, origen y fecha los pone la base, no el cliente. Así nadie
  -- puede dejar un "aceptó" sin rastro ni a nombre de otra persona. El servidor de la
  -- app escribe con la clave de servicio (auth.uid() es null) y sigue poniendo sus
  -- propios valores (importación, palabra clave, etc.).
  if v_user is not null
     and ((tg_op = 'INSERT' and new.marketing_status <> 'unknown')
          or (tg_op = 'UPDATE' and new.marketing_status is distinct from old.marketing_status)) then
    new.marketing_set_by := v_user;
    new.marketing_source := 'manual';
    new.marketing_status_at := now();
  end if;

  if tg_op = 'INSERT' then
    -- Código anterior que crea un contacto ya dado de baja.
    if new.is_subscribed is false and new.marketing_status = 'unknown' then
      new.marketing_status := 'opted_out';
      new.marketing_status_at := coalesce(new.marketing_status_at, now());
      new.marketing_source := coalesce(new.marketing_source, 'legacy');
    end if;
    new.is_subscribed := (new.marketing_status <> 'opted_out');
    return new;
  end if;

  if new.marketing_status is distinct from old.marketing_status then
    -- Cambio hecho con el modelo nuevo: gana marketing_status.
    if new.marketing_status_at is not distinct from old.marketing_status_at then
      new.marketing_status_at := now();
    end if;
    new.is_subscribed := (new.marketing_status <> 'opted_out');
  elsif new.is_subscribed is distinct from old.is_subscribed then
    -- Cambio hecho con el código anterior o por un flujo (baja o alta).
    if new.is_subscribed is false then
      new.marketing_status := 'opted_out';
      new.marketing_source := 'flow';
      new.marketing_set_by := null;
      new.marketing_note := null;
      new.marketing_status_at := now();
    elsif old.marketing_status = 'opted_out' then
      new.marketing_status := 'accepted';
      new.marketing_source := 'flow';
      new.marketing_set_by := null;
      new.marketing_note := null;
      new.marketing_status_at := now();
    else
      -- Ya no estaba de baja: is_subscribed vuelve a decir lo que corresponde.
      new.is_subscribed := true;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_contact_consent() from public, anon, authenticated;

drop trigger if exists sync_contact_consent on public.contacts;
create trigger sync_contact_consent
  before insert or update on public.contacts
  for each row execute function public.sync_contact_consent();

-- ============================================================
-- 3. Registro de borrados y borrado de un cliente
-- ============================================================

create table if not exists public.contact_erasures (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Sin llave foránea a propósito: es solo la constancia; la fila anónima del contacto sigue existiendo.
  contact_id uuid not null,
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  -- Cuántas cosas se quitaron y qué se conservó (solo números, sin datos personales).
  summary jsonb not null default '{}'::jsonb,
  -- Archivos del almacenamiento que faltan por borrar (vacío = todo borrado).
  files_pending text[] not null default '{}',
  files_total integer not null default 0,
  files_done_at timestamptz,
  last_file_error text,
  file_attempts integer not null default 0
);

create index if not exists idx_contact_erasures_contact on public.contact_erasures (contact_id, requested_at desc);
create index if not exists idx_contact_erasures_workspace on public.contact_erasures (workspace_id, requested_at desc);

alter table public.contact_erasures enable row level security;
drop policy if exists contact_erasures_select on public.contact_erasures;
create policy contact_erasures_select on public.contact_erasures
  for select using (public.is_ws_admin(workspace_id));
revoke all on public.contact_erasures from public, anon, authenticated;
grant select on public.contact_erasures to authenticated;
grant select, insert, update, delete on public.contact_erasures to service_role;

comment on table public.contact_erasures is
  'Constancia de cada borrado de datos de un cliente y de los archivos que faltan por quitar del almacenamiento (lib/contact-erase.ts).';

create or replace function public.erase_contact_data(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact public.contacts%rowtype;
  v_paths text[];
  v_extra text[];
  v_erasure uuid;
  v_conversations integer;
  v_messages integer;
  v_files integer;
  v_notes integer;
  v_cases integer;
  v_claims integer;
begin
  select * into v_contact
    from public.contacts
   where id = p_contact_id and workspace_id = p_workspace_id
   for update;
  if not found then
    raise exception 'contact_not_found' using errcode = 'P0002';
  end if;
  if v_contact.erased_at is not null then
    return jsonb_build_object('already_erased', true);
  end if;

  -- Archivos: los que registran las filas de message_media y cualquier otro que haya
  -- quedado en la carpeta de sus chats (por ejemplo un archivo subido y nunca enviado).
  select coalesce(array_agg(distinct mm.storage_path) filter (where mm.storage_path is not null), '{}')
    into v_paths
    from public.message_media mm
    join public.conversations c on c.id = mm.conversation_id
   where c.contact_id = p_contact_id;

  -- Los archivos sueltos son un extra: si el almacenamiento no se puede consultar desde aquí,
  -- se sigue solo con los que registra message_media (nunca se aborta el borrado por esto).
  if to_regclass('storage.objects') is not null then
    begin
      execute $q$
        select coalesce(array_agg(distinct o.name), '{}')
          from storage.objects o
          join public.conversations c
            on o.name like $1 || '/conv/' || c.id::text || '/%'
         where o.bucket_id = 'chat-media'
           and c.contact_id = $2
      $q$ into v_extra using p_workspace_id::text, p_contact_id;
      select coalesce(array_agg(distinct p), '{}') into v_paths
        from unnest(v_paths || coalesce(v_extra, '{}')) as p;
    exception when others then
      raise warning 'erase_contact_data: no se pudo listar el almacenamiento (%)', sqlerrm;
    end;
  end if;

  select count(*) into v_conversations from public.conversations where contact_id = p_contact_id;
  select count(*) into v_messages
    from public.messages m join public.conversations c on c.id = m.conversation_id
   where c.contact_id = p_contact_id;
  select count(*) into v_files
    from public.message_media mm join public.conversations c on c.id = mm.conversation_id
   where c.contact_id = p_contact_id;
  select count(*) into v_notes from public.case_notes where contact_id = p_contact_id;
  select count(*) into v_cases from public.cases where contact_id = p_contact_id;
  select count(*) into v_claims
    from public.cases ca join public.case_types ct on ct.id = ca.case_type_id
   where ca.contact_id = p_contact_id and ct.protected;

  -- Mensajes y archivos (las conversaciones quedan vacías, sin vínculo con la plataforma).
  delete from public.message_media
   where conversation_id in (select id from public.conversations where contact_id = p_contact_id);
  delete from public.messages
   where conversation_id in (select id from public.conversations where contact_id = p_contact_id);
  update public.conversations
     set late_conversation_id = null,
         last_message_preview = null,
         complaint_excerpt = null,
         status = 'closed',
         unread_count = 0
   where contact_id = p_contact_id;

  -- Notas internas (texto libre).
  delete from public.case_notes where contact_id = p_contact_id;

  -- Gestiones: se conservan con su tipo, pasos, fechas y resultado, sin texto libre.
  -- En los reclamos (tipos protegidos) se conserva además la solución escrita.
  update public.cases c
     set next_action_note = null,
         close_request = null,
         outcome_note = case
           when coalesce((select ct.protected from public.case_types ct where ct.id = c.case_type_id), false)
           then c.outcome_note end,
         solution_note = case
           when coalesce((select ct.protected from public.case_types ct where ct.id = c.case_type_id), false)
           then c.solution_note end
   where c.contact_id = p_contact_id;

  -- Historial: el que no es de una gestión se borra; el de las gestiones pierde el texto libre.
  delete from public.activity where contact_id = p_contact_id and case_id is null;
  update public.activity
     set meta = meta - 'text' - 'name' - 'comment' - 'excerpt' - 'params' - 'error' - 'keyword' - 'note'
   where contact_id = p_contact_id and case_id is not null;

  -- Identificadores, campos, etiquetas y todo lo que ligue a la persona.
  delete from public.contact_channels where contact_id = p_contact_id;
  delete from public.contact_custom_fields where contact_id = p_contact_id;
  delete from public.contact_tags where contact_id = p_contact_id;
  delete from public.flow_sessions where contact_id = p_contact_id;
  delete from public.sequence_enrollments where contact_id = p_contact_id;
  delete from public.broadcast_recipients where contact_id = p_contact_id;
  delete from public.notifications where link like '%' || p_contact_id::text || '%';
  delete from public.scheduled_jobs where status = 'pending' and payload::text like '%' || p_contact_id::text || '%';
  -- Mensajes de Zernio que no terminaron de procesarse guardan aún el texto y el remitente
  -- (bandeja durable, 00041): se vacía el contenido y se dan por cerrados.
  update public.webhook_events
     set payload = null, status = 'processed', processed_at = coalesce(processed_at, now())
   where contact_id = p_contact_id and payload is not null;
  update public.analytics_events set contact_id = null where contact_id = p_contact_id;

  -- El contacto queda anónimo y de baja de publicidad para siempre.
  update public.contacts
     set display_name = 'Cliente eliminado',
         email = null,
         phone = null,
         avatar_url = null,
         metadata = null,
         source = jsonb_build_object('erased', true),
         key_date = null,
         is_subscribed = false,
         marketing_status = 'opted_out',
         marketing_status_at = now(),
         marketing_source = 'erased',
         marketing_set_by = p_actor_id,
         marketing_note = null,
         erased_at = now(),
         erased_by = p_actor_id
   where id = p_contact_id;

  insert into public.contact_erasures (workspace_id, contact_id, requested_by, summary, files_pending, files_total)
  values (
    p_workspace_id,
    p_contact_id,
    p_actor_id,
    jsonb_build_object(
      'conversations', v_conversations,
      'messages', v_messages,
      'files', v_files,
      'notes', v_notes,
      'cases_kept', v_cases,
      'claims_kept', v_claims
    ),
    v_paths,
    coalesce(array_length(v_paths, 1), 0)
  )
  returning id into v_erasure;

  -- Si no había archivos, el borrado ya está completo.
  update public.contact_erasures set files_done_at = now()
   where id = v_erasure and files_total = 0;

  insert into public.activity (workspace_id, contact_id, type, actor_id, meta)
  values (
    p_workspace_id,
    p_contact_id,
    'contact_data_erased',
    p_actor_id,
    jsonb_build_object('erasure_id', v_erasure, 'cases_kept', v_cases, 'claims_kept', v_claims)
  );

  return jsonb_build_object(
    'already_erased', false,
    'erasure_id', v_erasure,
    'paths', to_jsonb(v_paths),
    'summary', jsonb_build_object(
      'conversations', v_conversations,
      'messages', v_messages,
      'files', v_files,
      'notes', v_notes,
      'cases_kept', v_cases,
      'claims_kept', v_claims
    )
  );
end;
$$;

revoke all on function public.erase_contact_data(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.erase_contact_data(uuid, uuid, uuid) to service_role;

-- ============================================================
-- 4. Sin borrado directo de contactos para usuarios
-- ============================================================
-- El borrado de un cliente se hace con erase_contact_data (deja constancia y borra los
-- archivos). El administrador ya no puede borrar contactos por la API de datos.
drop policy if exists contacts_delete on public.contacts;
revoke delete on public.contacts from anon, authenticated;



-- ============================================================
-- MIGRATION 45: BUSQUEDA SIN TILDES Y VOLUMEN
-- ============================================================
-- Tanda 4 (volumen y mejoras de uso): búsqueda sin tildes ni formato de
-- teléfono hecha en la base, y conteos agregados para Analítica y Métricas.
--
-- QUÉ HACE
--   1. Extensión `unaccent` y tres funciones inmutables de normalización:
--        f_unaccent(texto)       quita tildes (ñ -> n)
--        f_norm(texto)           minúsculas, sin tildes ("Peña" -> "pena")
--        f_phone_digits(texto)   solo los dígitos ("+51 987 654 321" -> "51987654321")
--   2. Índices GIN trigram sobre esas expresiones (nombre, correo y teléfono de
--      contactos; vista previa del último mensaje de los chats) y un índice de
--      eventos de analítica por (espacio, tipo, fecha).
--   3. Funciones de búsqueda (devuelven filas completas de la tabla, así que la
--      app puede seguir encadenando filtros, orden, página y conteo):
--        search_contacts(espacio, texto)  -> contactos
--        search_cases(espacio, texto)     -> gestiones de los contactos que coinciden
--        search_inbox(espacio, texto, n)  -> chats (por contacto o por último mensaje)
--   4. Conteos agregados (SECURITY INVOKER: corren con los permisos de quien
--      llama, la RLS decide qué cuenta):
--        analytics_flow_stats   inicios y terminaciones por flujo
--        analytics_daily        enviados / fallidos / contactos nuevos por día (hora de Lima)
--        metrics_inbound_hourly mensajes entrantes por hora y canal
--
-- POR QUÉ LAS BÚSQUEDAS SON SECURITY DEFINER (razón escrita)
--   Con RLS, Postgres evalúa la política (can_see_contact_row) ANTES que un
--   `ilike` del usuario, porque `ilike` no es "leakproof"; por eso el índice
--   trigram NO se usa si se busca con la tabla directa (medido: lectura
--   secuencial de toda la tabla, con can_see_contact_row en cada fila: 0,6 s
--   para un administrador y 1,5 s para un asesor con solo 40 000 contactos, y
--   crece linealmente). Las funciones buscan primero por índice y aplican DESPUÉS,
--   solo a las filas que coinciden, el MISMO permiso que la política:
--   can_see_contact_row(...) (que lee auth.uid(), así que "Ver como" funciona
--   igual) y exigen ser miembro del espacio. Un asesor no recibe por la función
--   nada que no vea por la tabla. El ayudante crm_private.contact_match vive en
--   un esquema que la API no expone y nadie puede ejecutarlo directamente.
--
-- ÍNDICES NUEVOS FRENTE A LOS DE LA 00042 (no se borra ninguno)
--   idx_contacts_display_name_trgm / _email_trgm / _phone_trgm (00042) indexan el
--   texto crudo y sirven para `ilike` con la tabla directa. Los nuevos
--   (idx_contacts_name_norm_trgm, _email_norm_trgm, _phone_digits_trgm) indexan
--   el texto normalizado y son los que usa la búsqueda desde ahora. En la
--   práctica los de la 00042 quedan sin uso (la app ya no hace `ilike` directo
--   sobre esas columnas): se pueden retirar con calma tras 2-4 semanas
--   mirando pg_stat_user_indexes, en otra migración.
--
-- BLOQUEOS Y DURACIÓN
--   CREATE INDEX (sin CONCURRENTLY, por la transacción) bloquea las ESCRITURAS
--   de la tabla mientras se construye. Con decenas de miles de contactos son
--   segundos. Con lock_timeout de 10 s: si hay una transacción larga, falla
--   limpio y se vuelve a ejecutar. Los índices sobre conversations penalizan un
--   poco cada mensaje nuevo (la vista previa cambia): es el costo de buscar por
--   texto del mensaje con índice.
--
-- ORDEN DE DESPLIEGUE: aplicar ANTES de desplegar el código. Es aditiva e
-- idempotente y no cambia nada para el código anterior (que no usa estas
-- funciones). El código nuevo, si la migración falta, no encuentra las
-- funciones: la búsqueda muestra un aviso en vez de resultados.

set local lock_timeout = '10s';

-- ============================================================
-- 1. unaccent y normalización
-- ============================================================

do $$
declare
  v_schema text;
begin
  select n.nspname into v_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'unaccent';
  if v_schema is null then
    v_schema := case when exists (select 1 from pg_namespace where nspname = 'extensions')
                     then 'extensions' else 'public' end;
    execute format('create extension if not exists unaccent with schema %I', v_schema);
  end if;

  -- El envoltorio fija el diccionario por nombre completo: así es inmutable y se puede indexar.
  execute format($f$
    create or replace function public.f_unaccent(p text)
    returns text
    language sql
    immutable
    parallel safe
    strict
    as $body$ select %1$I.unaccent('%1$I.unaccent'::regdictionary, p) $body$
  $f$, v_schema);
end $$;

create or replace function public.f_norm(p text)
returns text
language sql
immutable
parallel safe
as $$ select lower(public.f_unaccent(coalesce(p, ''))) $$;

create or replace function public.f_phone_digits(p text)
returns text
language sql
immutable
parallel safe
as $$ select regexp_replace(coalesce(p, ''), '\D', '', 'g') $$;

-- ============================================================
-- 2. Índices de texto sobre lo normalizado (+ eventos de analítica)
-- ============================================================

do $$
declare
  v_schema text;
begin
  select n.nspname into v_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';
  if v_schema is null then
    v_schema := case when exists (select 1 from pg_namespace where nspname = 'extensions')
                     then 'extensions' else 'public' end;
    execute format('create extension if not exists pg_trgm with schema %I', v_schema);
  end if;

  execute format('create index if not exists idx_contacts_name_norm_trgm on public.contacts using gin ((public.f_norm(display_name)) %I.gin_trgm_ops)', v_schema);
  execute format('create index if not exists idx_contacts_email_norm_trgm on public.contacts using gin ((public.f_norm(email)) %I.gin_trgm_ops)', v_schema);
  execute format('create index if not exists idx_contacts_phone_digits_trgm on public.contacts using gin ((public.f_phone_digits(phone)) %I.gin_trgm_ops)', v_schema);
  execute format('create index if not exists idx_conversations_preview_norm_trgm on public.conversations using gin ((public.f_norm(last_message_preview)) %I.gin_trgm_ops)', v_schema);
end $$;

-- Conteos de Analítica y Métricas por espacio, tipo y fecha.
create index if not exists idx_analytics_events_ws_type_created
  on public.analytics_events (workspace_id, event_type, created_at);

-- ============================================================
-- 3. Búsqueda
-- ============================================================

-- Ayudante interno: contactos del espacio que coinciden Y que la persona puede ver.
-- Texto: nombre o correo sin tildes; si parece un teléfono (solo dígitos, espacios,
-- + - . ( )), también por los dígitos del teléfono guardado.
create or replace function crm_private.contact_match(p_workspace uuid, p_q text)
returns table (id uuid)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_q text := public.f_norm(btrim(coalesce(p_q, '')));
  v_digits text := public.f_phone_digits(p_q);
  v_pat text;
  v_dpat text;
  v_phoneish boolean;
begin
  if v_q = '' or p_workspace is null or auth.uid() is null then
    return;
  end if;
  -- Debe ser miembro del espacio (can_see_contact_row también lo exige, pero así
  -- ni siquiera se busca).
  if not public.is_workspace_member(p_workspace) then
    return;
  end if;
  v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_phoneish := p_q ~ '^[0-9+()\s.-]+$' and length(v_digits) >= 3;
  v_dpat := '%' || v_digits || '%';

  -- Primero los candidatos por índice (un SELECT por columna, cada uno con su índice
  -- trigram) y SOLO a ellos se les aplica el permiso: así el costo no depende del
  -- tamaño de la tabla sino del número de coincidencias.
  return query
    with cand as materialized (
      select c.id, c.workspace_id, c.owner_id, c.team_id
      from public.contacts c
      where c.workspace_id = p_workspace and public.f_norm(c.display_name) like v_pat
      union
      select c.id, c.workspace_id, c.owner_id, c.team_id
      from public.contacts c
      where c.workspace_id = p_workspace and public.f_norm(c.email) like v_pat
      union
      select c.id, c.workspace_id, c.owner_id, c.team_id
      from public.contacts c
      where v_phoneish and c.workspace_id = p_workspace and public.f_phone_digits(c.phone) like v_dpat
    )
    select k.id
    from cand k
    where public.can_see_contact_row(k.workspace_id, k.id, k.owner_id, k.team_id);
end;
$$;
revoke all on function crm_private.contact_match(uuid, text) from public, anon, authenticated;

create or replace function public.search_contacts(p_workspace uuid, p_q text)
returns setof public.contacts
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select c.*
  from public.contacts c
  where c.id in (select m.id from crm_private.contact_match(p_workspace, p_q) m);
$$;

create or replace function public.search_cases(p_workspace uuid, p_q text)
returns setof public.cases
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select k.*
  from public.cases k
  where k.workspace_id = p_workspace
    and k.contact_id in (select m.id from crm_private.contact_match(p_workspace, p_q) m);
$$;

-- Chats: por nombre/correo/teléfono del contacto o por el último mensaje. Los más recientes primero.
create or replace function public.search_inbox(p_workspace uuid, p_q text, p_limit integer default 100)
returns setof public.conversations
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_q text := public.f_norm(btrim(coalesce(p_q, '')));
  v_pat text;
begin
  if v_q = '' or p_workspace is null or auth.uid() is null
     or not public.is_workspace_member(p_workspace) then
    return;
  end if;
  v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
    select v.*
    from public.conversations v
    where v.id in (
      select cv.id from public.conversations cv
      where cv.workspace_id = p_workspace
        and cv.contact_id in (select m.id from crm_private.contact_match(p_workspace, p_q) m)
      union
      select cv.id from public.conversations cv
      where cv.workspace_id = p_workspace
        and public.f_norm(cv.last_message_preview) like v_pat
        and public.can_see_contact(cv.contact_id)
    )
    order by v.last_message_at desc nulls last, v.id
    limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

revoke all on function public.search_contacts(uuid, text) from public, anon;
revoke all on function public.search_cases(uuid, text) from public, anon;
revoke all on function public.search_inbox(uuid, text, integer) from public, anon;
grant execute on function public.search_contacts(uuid, text) to authenticated, service_role;
grant execute on function public.search_cases(uuid, text) to authenticated, service_role;
grant execute on function public.search_inbox(uuid, text, integer) to authenticated, service_role;

-- ============================================================
-- 4. Conteos agregados (SECURITY INVOKER: la RLS de quien llama decide)
-- ============================================================

-- Inicios y terminaciones de cada flujo en el rango [p_from, p_to].
create or replace function public.analytics_flow_stats(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns table (flow_id uuid, starts bigint, completions bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select e.flow_id,
         count(*) filter (where e.event_type = 'flow_started'),
         count(*) filter (where e.event_type = 'flow_completed')
  from public.analytics_events e
  where e.workspace_id = p_workspace
    and e.event_type in ('flow_started', 'flow_completed')
    and e.flow_id is not null
    and e.created_at >= p_from and e.created_at <= p_to
  group by e.flow_id;
$$;

-- Mensajes enviados / fallidos y contactos nuevos por día (hora de Lima) en el rango.
create or replace function public.analytics_daily(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns table (day date, sent bigint, failed bigint, new_contacts bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select d.day,
         coalesce(sum(d.sent), 0)::bigint,
         coalesce(sum(d.failed), 0)::bigint,
         coalesce(sum(d.new_contacts), 0)::bigint
  from (
    select (e.created_at at time zone 'America/Lima')::date as day,
           (e.event_type = 'message_sent')::int as sent,
           (e.event_type = 'message_failed')::int as failed,
           0 as new_contacts
    from public.analytics_events e
    where e.workspace_id = p_workspace
      and e.event_type in ('message_sent', 'message_failed')
      and e.created_at >= p_from and e.created_at <= p_to
    union all
    select (c.created_at at time zone 'America/Lima')::date, 0, 0, 1
    from public.contacts c
    where c.workspace_id = p_workspace
      and c.created_at >= p_from and c.created_at <= p_to
  ) d
  group by d.day
  order by d.day;
$$;

-- Mensajes entrantes por hora (UTC, que coincide con la hora de Lima: UTC-5 fijo) y canal.
create or replace function public.metrics_inbound_hourly(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns table (hour_start timestamptz, platform text, n bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select date_trunc('hour', e.created_at),
         e.metadata->>'platform',
         count(*)
  from public.analytics_events e
  where e.workspace_id = p_workspace
    and e.event_type = 'message_received'
    and e.created_at >= p_from and e.created_at < p_to
  group by 1, 2;
$$;

revoke all on function public.analytics_flow_stats(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.analytics_daily(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.metrics_inbound_hourly(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_flow_stats(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.analytics_daily(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.metrics_inbound_hourly(uuid, timestamptz, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';



-- ============================================================
-- MIGRATION 46: DIFUSIONES: PAUSAR, REANUDAR Y CANCELAR
-- ============================================================
-- Tanda 5 (previa a producción): difusiones que se pueden pausar, reanudar y
-- cancelar, y que una difusión grande no frene lo demás.
--
-- QUÉ HACE (todo aditivo e idempotente)
--   1. broadcasts.status admite un valor nuevo, 'paused' (En pausa). La
--      restricción se vuelve a crear con la lista completa:
--        draft, scheduled, sending, paused, completed, cancelled.
--   2. broadcasts: columnas para explicar una pausa y llevar la cuenta de fallos
--      seguidos (el corte automático cuando Zernio o WhatsApp fallan en serie):
--        paused_at              cuándo se pausó
--        paused_reason          'manual' (la pausó una persona) o 'auto_failures'
--                               (se pausó sola por fallos seguidos)
--        pause_note             la frase en español que ve el equipo
--        consecutive_failures   envíos fallidos seguidos (se pone en 0 con cada
--                               envío bueno y al reanudar)
--        cancelled_at           cuándo se canceló
--   3. broadcast_recipients.claimed_at: cuándo el cron tomó al destinatario para
--      enviarle. Permite reconocer un envío que se quedó "enviando" porque la
--      función se cortó (pasa a fallido con el aviso de revisar el chat, igual
--      que antes), y un índice parcial para encontrarlos rápido.
--      El estado de destinatario 'cancelled' (cancelado) no necesita cambio: la
--      columna status es texto libre.
--
-- CÓMO ENVÍA AHORA EL CRON
--   Ya no hay un trabajo por destinatario en scheduled_jobs: cada pasada del
--   cron (cada minuto) toma de la tabla broadcast_recipients un lote de los
--   'pending' de las difusiones en estado 'sending'. Pausar y cancelar son un
--   cambio de estado de la difusión: la siguiente pasada ya no envía.
--   Los trabajos 'send_broadcast' que pudieran quedar de antes se siguen
--   procesando con las mismas reglas (no hay ninguno en producción todavía).
--
-- BLOQUEOS
--   Cambiar la restricción de broadcasts toma un candado breve sobre una tabla
--   pequeña (una fila por difusión). El índice parcial sobre broadcast_recipients
--   no incluye filas hoy en producción. Con lock_timeout de 10 s: si hubiera una
--   transacción larga, falla limpio y se vuelve a ejecutar.
--
-- ORDEN DE DESPLIEGUE: aplicar esta migración ANTES de desplegar el código. Es
-- segura con el código anterior (que no conoce 'paused', ni 'cancelled' en
-- destinatarios, ni estas columnas). Si el código nuevo corre sin la migración,
-- pausar falla con el aviso "No se pudo completar la operación" y el cron no
-- puede leer las columnas nuevas (la pasada de difusiones se omite y queda en el
-- registro); nada se envía de más.
-- Es idempotente: se puede volver a ejecutar.

set local lock_timeout = '10s';

-- ============================================================
-- 1. Estado 'paused'
-- ============================================================

alter table public.broadcasts drop constraint if exists broadcasts_status_check;
alter table public.broadcasts
  add constraint broadcasts_status_check
  check (status in ('draft', 'scheduled', 'sending', 'paused', 'completed', 'cancelled'));

-- ============================================================
-- 2. Columnas de la difusión
-- ============================================================

alter table public.broadcasts add column if not exists paused_at timestamptz;
alter table public.broadcasts add column if not exists paused_reason text;
alter table public.broadcasts add column if not exists pause_note text;
alter table public.broadcasts add column if not exists consecutive_failures integer not null default 0;
alter table public.broadcasts add column if not exists cancelled_at timestamptz;

-- ============================================================
-- 3. Destinatarios
-- ============================================================

alter table public.broadcast_recipients add column if not exists claimed_at timestamptz;

create index if not exists idx_broadcast_recipients_sending
  on public.broadcast_recipients (claimed_at)
  where status = 'sending';

notify pgrst, 'reload schema';


-- ============================================================
-- MIGRATION 47: AJUSTES DE VOLUMEN (INDICES Y ANALITICA)
-- ============================================================
-- Ajustes de volumen hallados al medir con 50 000 contactos, 20 000 chats, 30 000
-- gestiones y 300 000 eventos (verificación previa a producción). Aditiva e idempotente.
--
-- QUÉ HACE
--   1. Índices con el MISMO orden que piden las pantallas. Las que ya existían
--      (idx_contacts_last_interaction, idx_conversations_workspace) ordenan DESC con
--      NULLS FIRST (lo que da Postgres por omisión), pero la app pide
--      `order by ... desc nulls last, id`; con ese orden Postgres no podía usar el
--      índice y leía y ordenaba toda la tabla en cada página (Contactos: 0,8 s el dueño,
--      3-4 s un asesor; Bandeja "Todos": 0,9-2,2 s). Con el índice a la medida, la
--      primera página lee solo las filas que muestra.
--        contacts       (espacio, última interacción desc nulls last, id)
--        contacts       (espacio, nombre asc nulls last, id)  y  (… desc nulls last, id)
--        contacts       (espacio, fecha clave asc nulls last, id)
--        contacts       (espacio, creación desc, id)
--        conversations  (espacio, último mensaje desc nulls last, id)
--        cases          (espacio, creación desc, id)   <- lectura por páginas de Métricas,
--                                                         Por cliente y Tablero
--      No se borra ninguno de los anteriores.
--   2. Las tres funciones de Analítica y Métricas (analytics_flow_stats,
--      analytics_daily, metrics_inbound_hourly) pasan de SECURITY INVOKER a SECURITY
--      DEFINER con la comprobación de permiso HECHA UNA VEZ. Motivo medido: la política
--      de analytics_events (is_ws_admin OR is_ws_supervisor) se evaluaba FILA POR FILA
--      sobre las 100 000 a 300 000 filas del rango (≈ 40 µs cada una): 3 s el dueño,
--      7-13 s un supervisor y hasta 12 s un asesor que no ve ninguna (superando los 8 s de
--      statement_timeout de `authenticated`: la pantalla de Métricas fallaba). Ahora la
--      función comprueba una sola vez el MISMO permiso de la política (administrador o
--      supervisor del espacio; service_role pasa, como antes con BYPASSRLS) y agrupa
--      con índice. Quien no tiene permiso recibe cero filas, igual que antes.
--      En analytics_daily, la parte de contactos nuevos sigue contando solo los
--      contactos que la persona puede ver (can_see_contact_row, el mismo permiso de la
--      política de contacts), con el atajo de que un administrador los ve todos.
--      "Ver como" funciona igual: los ayudantes leen auth.uid() / la vista activa.
--      Los ayudantes viven en crm_private (no expuesto por la API, sin permisos para
--      usuarios) y todas las funciones fijan search_path.
--
-- LO QUE NO SE ARREGLA AQUÍ (rediseño; ver informe de la verificación)
--   * Conteos exactos y listas con filtro para supervisores y asesores recorren las
--     filas con la política por fila (can_see_contact_row ≈ 20-80 µs): Contactos con
--     50 000 contactos tarda 3-4 s en contar para un asesor.
--   * Métricas lee las gestiones por páginas con OFFSET; cada página repite el trabajo.
--
-- BLOQUEOS: CREATE INDEX (sin CONCURRENTLY, por la transacción) bloquea las escrituras
-- de esa tabla mientras se construye: segundos con decenas de miles de filas. Con
-- lock_timeout de 10 s falla limpio si hubiera una transacción larga, y se reintenta.
-- ORDEN DE DESPLIEGUE: antes o después del código es indiferente; no cambia ningún
-- resultado, solo el tiempo. Es idempotente: se puede volver a ejecutar.

set local lock_timeout = '10s';

-- ============================================================
-- 1. Índices con el orden de las pantallas
-- ============================================================

create index if not exists idx_contacts_ws_last_interaction_nl
  on public.contacts (workspace_id, last_interaction_at desc nulls last, id);

create index if not exists idx_contacts_ws_name
  on public.contacts (workspace_id, display_name asc nulls last, id);

create index if not exists idx_contacts_ws_name_desc
  on public.contacts (workspace_id, display_name desc nulls last, id);

create index if not exists idx_contacts_ws_key_date_nl
  on public.contacts (workspace_id, key_date asc nulls last, id);

create index if not exists idx_contacts_ws_created
  on public.contacts (workspace_id, created_at desc, id);

create index if not exists idx_conversations_ws_last_message_nl
  on public.conversations (workspace_id, last_message_at desc nulls last, id);

create index if not exists idx_cases_ws_created
  on public.cases (workspace_id, created_at desc, id);

-- ============================================================
-- 2. Analítica y Métricas: permiso comprobado una sola vez
-- ============================================================

-- ¿Puede leer los eventos de analítica del espacio? Mismo criterio que la política
-- analytics_events_select (administrador o supervisor), más service_role.
create or replace function crm_private.can_read_analytics(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.role() = 'service_role'
      or public.is_ws_admin(p_workspace)
      or public.is_ws_supervisor(p_workspace);
$$;

-- ¿Ve todos los contactos del espacio sin mirar fila por fila? Administrador (o service_role).
create or replace function crm_private.sees_all_contacts(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.role() = 'service_role' or public.is_ws_admin(p_workspace);
$$;

revoke all on function crm_private.can_read_analytics(uuid) from public, anon, authenticated;
revoke all on function crm_private.sees_all_contacts(uuid) from public, anon, authenticated;

create or replace function public.analytics_flow_stats(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns table (flow_id uuid, starts bigint, completions bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.flow_id,
         count(*) filter (where e.event_type = 'flow_started'),
         count(*) filter (where e.event_type = 'flow_completed')
  from public.analytics_events e
  where (select crm_private.can_read_analytics(p_workspace))
    and e.workspace_id = p_workspace
    and e.event_type in ('flow_started', 'flow_completed')
    and e.flow_id is not null
    and e.created_at >= p_from and e.created_at <= p_to
  group by e.flow_id;
$$;

create or replace function public.analytics_daily(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns table (day date, sent bigint, failed bigint, new_contacts bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.day,
         coalesce(sum(d.sent), 0)::bigint,
         coalesce(sum(d.failed), 0)::bigint,
         coalesce(sum(d.new_contacts), 0)::bigint
  from (
    select (e.created_at at time zone 'America/Lima')::date as day,
           (e.event_type = 'message_sent')::int as sent,
           (e.event_type = 'message_failed')::int as failed,
           0 as new_contacts
    from public.analytics_events e
    where (select crm_private.can_read_analytics(p_workspace))
      and e.workspace_id = p_workspace
      and e.event_type in ('message_sent', 'message_failed')
      and e.created_at >= p_from and e.created_at <= p_to
    union all
    select (c.created_at at time zone 'America/Lima')::date, 0, 0, 1
    from public.contacts c
    where c.workspace_id = p_workspace
      and c.created_at >= p_from and c.created_at <= p_to
      and ((select crm_private.sees_all_contacts(p_workspace))
           or public.can_see_contact_row(c.workspace_id, c.id, c.owner_id, c.team_id))
  ) d
  group by d.day
  order by d.day;
$$;

create or replace function public.metrics_inbound_hourly(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns table (hour_start timestamptz, platform text, n bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select date_trunc('hour', e.created_at),
         e.metadata->>'platform',
         count(*)
  from public.analytics_events e
  where (select crm_private.can_read_analytics(p_workspace))
    and e.workspace_id = p_workspace
    and e.event_type = 'message_received'
    and e.created_at >= p_from and e.created_at < p_to
  group by 1, 2;
$$;

revoke all on function public.analytics_flow_stats(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.analytics_daily(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.metrics_inbound_hourly(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_flow_stats(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.analytics_daily(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.metrics_inbound_hourly(uuid, timestamptz, timestamptz) to authenticated, service_role;

analyze public.contacts;
analyze public.conversations;
analyze public.cases;

notify pgrst, 'reload schema';
