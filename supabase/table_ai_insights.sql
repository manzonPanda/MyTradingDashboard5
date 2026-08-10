-- AURA AI - Generated insights and proactive alerts
-- Stores AI-generated insights, coaching tips, and proactive notifications

create table public.ai_insights (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  insight_type text not null check (
    insight_type in (
      'performance_review',
      'behavioral_pattern',
      'risk_warning',
      'coaching_tip',
      'proactive_alert',
      'weekly_review',
      'daily_summary'
    )
  ),
  title text not null,
  content text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical', 'positive')),
  related_data jsonb null,
  is_read boolean not null default false,
  is_dismissed boolean not null default false,
  created_at timestamp with time zone not null default now(),
  constraint ai_insights_pkey primary key (id),
  constraint ai_insights_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
) tablespace pg_default;

create index if not exists idx_ai_insights_user_created
  on public.ai_insights using btree (user_id, created_at desc)
  tablespace pg_default;

create index if not exists idx_ai_insights_user_unread
  on public.ai_insights using btree (user_id, is_read, is_dismissed)
  tablespace pg_default;