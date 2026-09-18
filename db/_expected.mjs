/**
 * AURA Dashboard — expected schema (verification contract for db/verify_schema.mjs).
 *
 * GENERATED from the local database after db/compare_source_schema.mjs proved
 * it reproduces the live Supabase schema (252 columns / 20 tables, types and
 * nullability identical), with these documented deviations:
 *   * aura_users replaces auth.users as the FK target (no Supabase counterpart);
 *   * ai_memories.embedding + its HNSW index are intentionally not created.
 *
 * fks[].onDelete === null means "no ON DELETE clause" (PostgreSQL NO ACTION).
 * uniques[] lists UNIQUE *constraint* names only; idx_trades_ticket_unique is a
 * partial UNIQUE INDEX and is asserted separately by verify_schema.mjs.
 */

export const EXPECTED_TABLE_COUNT = 21;

export const EXPECTED_COLUMN_TYPES = {
  'trades.ticket': 'numeric',
  'trades.time_open': 'timestamp without time zone',
  'trades.time_close': 'timestamp without time zone',
  'trades.time_open_ph': 'timestamp without time zone',
  'trades.time_close_ph': 'timestamp without time zone',
  'trades.created_at': 'timestamp with time zone',
  'trades.updated_at': 'timestamp with time zone',
  'trade_screenshots.ticket': 'text',
  'user_settings.user_id': 'uuid',
  'user_settings.trading_day_reset_time': 'time without time zone',
  'user_settings.updated_at': 'timestamp with time zone',
  'profiles.started_trading_date': 'date',
  'certificates.passed_date': 'date',
  'accounts.drawdown_stop_at_initial_balance': 'boolean',
  'ai_analyses.trigger': 'text',
  'ai_analyses.attempts': 'smallint',
  'ai_analyses.input_summary': 'jsonb',
  'ai_analyses.raw_response': 'jsonb',
  'behaviors.confidence': 'numeric',
  'behavior_evidence.metrics_snapshot': 'jsonb',
  'trading_briefs.payload': 'jsonb',
  'behavior_config.thresholds': 'jsonb',
};

/** aura_app gets SELECT only on these tables (least privilege, Phase 2/3). */
export const READ_ONLY_FOR_APP = ['aura_users'];

export const EXPECTED = {
  aura_users: { columns: ['id','email','created_at','updated_at'], pk: 'aura_users_pkey', uniques: ['aura_users_email_key'], checks: [], fks: [], indexes: [], triggers: ['aura_users_set_updated_at'] },
  prop_firms: { columns: ['id','name','logo_url','website_url','created_at'], pk: 'prop_firms_pkey', uniques: ['prop_firms_name_key'], checks: [], fks: [], indexes: [], triggers: [] },
  accounts: { columns: ['id','name','account_number','initial_balance','profit_target_percent','max_total_drawdown_percent','daily_loss_limit_percent','start_date','status','notes','created_at','updated_at','user_id','phase','prop_firm_id','platform','drawdown_mode','drawdown_basis','drawdown_stop_at_initial_balance','drawdown_eod_timezone'], pk: 'accounts_pkey', uniques: [], checks: ['accounts_phase_check','accounts_platform_check','accounts_drawdown_mode_check','accounts_drawdown_basis_check'], fks: [{name:'accounts_prop_firm_id_fkey',ref:'prop_firms',onDelete:'SET NULL'},{name:'accounts_user_id_fkey',ref:'aura_users',onDelete:'CASCADE'}], indexes: ['accounts_prop_firm_id_idx'], triggers: ['accounts_set_updated_at'] },
  trades: { columns: ['id','buy_sell','commission','daily_reflection','time_open','time_close','instrument','lots','pips','pnl','rules_violated','weekly_retrospective','mfe','price_close','price_open','risk_per_trade','rrr','sl','swap','ticket','tp','created_at','updated_at','held','account_id','mae','time_open_ph','time_close_ph'], pk: 'trades_pkey', uniques: [], checks: ['trades_buy_sell_check'], fks: [{name:'trades_account_id_fkey',ref:'accounts',onDelete:null}], indexes: ['idx_trades_date_start','idx_trades_instrument','idx_trades_ticket','idx_trades_ticket_unique','idx_trades_time_close_ph','idx_trades_time_open_ph'], triggers: ['trg_trades_updated_at'] },
  user_settings: { columns: ['user_id','daily_target_percent','weekly_r_target','default_chart_mode','trading_day_reset_time','default_account_id','show_account_balance','show_pnl','show_trading_activity','show_news_calendar','aura_enabled','aura_travel_duration_ms','aura_min_delay_ms','aura_max_delay_ms','aura_trail_length_percent','aura_stroke_width','aura_head_radius','aura_bloom_intensity','aura_fade_duration_ms','aura_color_start','aura_color_mid','aura_color_peak','aura_color_head','aura_min_targets','aura_max_targets','notifications_enabled','daily_goal_notification','goal_notification_sound','notification_volume','created_at','updated_at','live_trade_sound_threshold','live_trade_high_priority_sound_threshold','positive_gauge_percent_max','per_trade_gauge_auto_close_enabled'], pk: 'user_settings_pkey', uniques: [], checks: ['user_settings_default_chart_mode_check','user_settings_live_trade_sound_threshold_check','user_settings_live_trade_high_priority_sound_threshold_check'], fks: [{name:'user_settings_default_account_id_fkey',ref:'accounts',onDelete:'SET NULL'},{name:'user_settings_user_id_fkey',ref:'aura_users',onDelete:'CASCADE'}], indexes: [], triggers: ['user_settings_set_updated_at'] },
  profiles: { columns: ['id','display_name','avatar_url','started_trading_date','created_at','updated_at'], pk: 'profiles_pkey', uniques: [], checks: [], fks: [{name:'profiles_id_fkey',ref:'aura_users',onDelete:'CASCADE'}], indexes: [], triggers: ['profiles_set_updated_at'] },
  certificates: { columns: ['id','user_id','program_name','passed_date','status','file_path','notes','created_at','account_id'], pk: 'certificates_pkey', uniques: [], checks: ['certificates_status_check'], fks: [{name:'certificates_account_id_fkey',ref:'accounts',onDelete:'RESTRICT'},{name:'certificates_user_id_fkey',ref:'aura_users',onDelete:'CASCADE'}], indexes: ['certificates_account_id_idx'], triggers: [] },
  payouts: { columns: ['id','user_id','certificate_id','firm_name','amount','payout_date','notes','proof_url','created_at'], pk: 'payouts_pkey', uniques: [], checks: [], fks: [{name:'payouts_certificate_id_fkey',ref:'certificates',onDelete:'SET NULL'},{name:'payouts_user_id_fkey',ref:'aura_users',onDelete:'CASCADE'}], indexes: [], triggers: [] },
  roi_transactions: { columns: ['id','transaction_date','transaction_type','amount','note','image_url','account_id','created_at','updated_at','user_id'], pk: 'roi_transactions_pkey', uniques: [], checks: ['roi_transactions_amount_check','roi_transactions_transaction_type_check'], fks: [{name:'roi_transactions_account_id_fkey',ref:'accounts',onDelete:'SET NULL'},{name:'roi_transactions_user_id_fkey',ref:'aura_users',onDelete:'CASCADE'}], indexes: ['idx_roi_transactions_account_id','idx_roi_transactions_date','idx_roi_transactions_type','idx_roi_transactions_user_id'], triggers: ['trg_roi_transactions_updated_at'] },
  trade_screenshots: { columns: ['id','ticket','symbol','storage_path','captured_at','created_at'], pk: 'trade_screenshots_pkey', uniques: [], checks: [], fks: [], indexes: ['trade_screenshots_ticket_idx'], triggers: [] },
  ai_conversations: { columns: ['id','user_id','title','summary','created_at','updated_at'], pk: 'ai_conversations_pkey', uniques: [], checks: [], fks: [{name:'ai_conversations_user_id_fkey',ref:'aura_users',onDelete:'CASCADE'}], indexes: ['idx_ai_conversations_user_updated'], triggers: ['ai_conversations_set_updated_at'] },
  ai_messages: { columns: ['id','conversation_id','user_id','role','content','tool_calls','tool_name','token_count','created_at'], pk: 'ai_messages_pkey', uniques: [], checks: ['ai_messages_role_check'], fks: [{name:'ai_messages_conversation_id_fkey',ref:'ai_conversations',onDelete:'CASCADE'},{name:'ai_messages_user_id_fkey',ref:'aura_users',onDelete:'CASCADE'}], indexes: ['idx_ai_messages_conversation_created','idx_ai_messages_user_created'], triggers: [] },
  ai_memories: { columns: ['id','user_id','memory','memory_type','importance','source','is_active','expires_at','created_at','updated_at'], pk: 'ai_memories_pkey', uniques: [], checks: ['ai_memories_memory_type_check','ai_memories_importance_check'], fks: [{name:'ai_memories_user_id_fkey',ref:'aura_users',onDelete:'CASCADE'}], indexes: ['idx_ai_memories_user_active'], triggers: ['ai_memories_set_updated_at'] },
  ai_insights: { columns: ['id','user_id','insight_type','title','content','severity','related_data','is_read','is_dismissed','created_at'], pk: 'ai_insights_pkey', uniques: [], checks: ['ai_insights_insight_type_check','ai_insights_severity_check'], fks: [{name:'ai_insights_user_id_fkey',ref:'aura_users',onDelete:'CASCADE'}], indexes: ['idx_ai_insights_user_created','idx_ai_insights_user_unread'], triggers: [] },
  ai_analyses: { columns: ['id','user_id','account_id','trigger','trade_id','status','attempts','max_attempts','last_error','model','prompt_version','input_summary','raw_response','started_at','finished_at','created_at','updated_at'], pk: 'ai_analyses_pkey', uniques: [], checks: ['ai_analyses_trigger_check','ai_analyses_status_check'], fks: [{name:'ai_analyses_user_id_fkey',ref:'aura_users',onDelete:'CASCADE'},{name:'ai_analyses_account_id_fkey',ref:'accounts',onDelete:'CASCADE'},{name:'ai_analyses_trade_id_fkey',ref:'trades',onDelete:'SET NULL'}], indexes: ['idx_ai_analyses_account_status','idx_ai_analyses_status_created','idx_ai_analyses_user_created'], triggers: ['ai_analyses_set_updated_at'] },
  behaviors: { columns: ['id','user_id','account_id','name','name_key','behavior_type','description','status','occurrence_count','confidence','estimated_impact_pnl','estimated_impact_r','first_detected_at','last_detected_at','last_confirmed_at','model','created_at','updated_at'], pk: 'behaviors_pkey', uniques: ['behaviors_account_name_key_type_unique'], checks: ['behaviors_behavior_type_check','behaviors_status_check'], fks: [{name:'behaviors_user_id_fkey',ref:'aura_users',onDelete:'CASCADE'},{name:'behaviors_account_id_fkey',ref:'accounts',onDelete:'CASCADE'}], indexes: ['idx_behaviors_account_status','idx_behaviors_account_type_status','idx_behaviors_user'], triggers: ['behaviors_set_updated_at'] },
  behavior_evidence: { columns: ['id','user_id','account_id','behavior_id','analysis_id','trade_id','trade_ticket','trade_time_open','week_start','reflection_excerpt','reason','metrics_snapshot','evidence_confidence','created_at'], pk: 'behavior_evidence_pkey', uniques: ['behavior_evidence_behavior_trade_unique'], checks: [], fks: [{name:'behavior_evidence_user_id_fkey',ref:'aura_users',onDelete:'CASCADE'},{name:'behavior_evidence_account_id_fkey',ref:'accounts',onDelete:'CASCADE'},{name:'behavior_evidence_behavior_id_fkey',ref:'behaviors',onDelete:'CASCADE'},{name:'behavior_evidence_analysis_id_fkey',ref:'ai_analyses',onDelete:'SET NULL'},{name:'behavior_evidence_trade_id_fkey',ref:'trades',onDelete:'CASCADE'}], indexes: ['idx_behavior_evidence_account_created','idx_behavior_evidence_behavior','idx_behavior_evidence_trade','idx_behavior_evidence_user','idx_behavior_evidence_week'], triggers: [] },
  trading_rules: { columns: ['id','user_id','account_id','source_behavior_id','rule','rationale','confidence','evidence_summary','status','created_at','updated_at'], pk: 'trading_rules_pkey', uniques: ['trading_rules_account_rule_unique'], checks: ['trading_rules_status_check'], fks: [{name:'trading_rules_user_id_fkey',ref:'aura_users',onDelete:'CASCADE'},{name:'trading_rules_account_id_fkey',ref:'accounts',onDelete:'CASCADE'},{name:'trading_rules_source_behavior_id_fkey',ref:'behaviors',onDelete:'SET NULL'}], indexes: ['idx_trading_rules_account_status','idx_trading_rules_user'], triggers: ['trading_rules_set_updated_at'] },
  behavior_alerts: { columns: ['id','user_id','account_id','alert_type','severity','status','message','behavior_id','trade_id','analysis_id','dedupe_key','created_at'], pk: 'behavior_alerts_pkey', uniques: ['behavior_alerts_account_dedupe_unique'], checks: ['behavior_alerts_alert_type_check','behavior_alerts_severity_check','behavior_alerts_status_check'], fks: [{name:'behavior_alerts_user_id_fkey',ref:'aura_users',onDelete:'CASCADE'},{name:'behavior_alerts_account_id_fkey',ref:'accounts',onDelete:'CASCADE'},{name:'behavior_alerts_behavior_id_fkey',ref:'behaviors',onDelete:'SET NULL'},{name:'behavior_alerts_trade_id_fkey',ref:'trades',onDelete:'SET NULL'},{name:'behavior_alerts_analysis_id_fkey',ref:'ai_analyses',onDelete:'SET NULL'}], indexes: ['idx_behavior_alerts_account_status','idx_behavior_alerts_behavior','idx_behavior_alerts_user'], triggers: [] },
  trading_briefs: { columns: ['id','user_id','account_id','week_start','week_end','payload','model','prompt_version','generated_at','created_at','updated_at'], pk: 'trading_briefs_pkey', uniques: ['trading_briefs_account_week_unique'], checks: [], fks: [{name:'trading_briefs_user_id_fkey',ref:'aura_users',onDelete:'CASCADE'},{name:'trading_briefs_account_id_fkey',ref:'accounts',onDelete:'CASCADE'}], indexes: ['idx_trading_briefs_account_week','idx_trading_briefs_user'], triggers: ['trading_briefs_set_updated_at'] },
  behavior_config: { columns: ['id','user_id','account_id','thresholds','created_at','updated_at'], pk: 'behavior_config_pkey', uniques: ['behavior_config_account_unique'], checks: [], fks: [{name:'behavior_config_user_id_fkey',ref:'aura_users',onDelete:'CASCADE'},{name:'behavior_config_account_id_fkey',ref:'accounts',onDelete:'CASCADE'}], indexes: ['idx_behavior_config_user'], triggers: ['behavior_config_set_updated_at'] },
};
