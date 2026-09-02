/**
 * Behavior Engine — AnalysisJobStore
 *
 * Concurrency-safe claim + lifecycle for ai_analyses rows.
 *
 * Claiming is safe across multiple backend workers: it uses an ATOMIC
 * conditional UPDATE (`status='queued' AND attempts < max_attempts`), so a
 * second worker that races on the same job matches 0 rows and can never
 * process the same job twice.
 *
 * Stale-lock recovery: a worker that crashes leaves its job in `running` with
 * its `updated_at` heartbeat frozen. claimNext() also reclaims RUNNING jobs
 * whose lock has expired (updated_at older than DEFAULT_STALE_LOCK_MS):
 *   - attempts < max_attempts → reclaimed (attempts incremented, lock
 *     refreshed to now) so a crash can never permanently strand a job;
 *   - attempts >= max_attempts → finalized to `failed`, never reclaimed, so
 *     permanently exhausted jobs cannot loop forever.
 * Reclaim is a single conditional UPDATE that re-checks status + staleness,
 * so two workers racing the same expired job still only ever win once, and
 * jobs whose lock is still valid are never touched.
 *
 * Lifecycle: queued → running → done | failed | skipped
 *   running + retry available → queued (on transient failure)
 *   running + attempts exhausted → failed
 *   running + intentionally abandoned → skipped
 *   running + expired lock → re-claimed (attempts < max) or failed (exhausted)
 */

/**
 * How old a `running` job's lock must be before another worker may reclaim it.
 * `updated_at` is refreshed on every claim (and by the set_updated_at trigger),
 * so an abandoned job's updated_at stops advancing and eventually crosses this
 * threshold. Overridable per claim via `claimNext(accountIds, { staleMs })`.
 */
export const DEFAULT_STALE_LOCK_MS = 10 * 60 * 1000; // 10 minutes

export class AnalysisJobStore {
  constructor(supabase) {
    this.supabase = supabase;
  }

  /** Enqueue an analysis job (idempotent per trigger+trade). */
  async enqueue(userId, accountId, { trigger = 'trade_saved', tradeId = null, priority = false } = {}) {
    const { data, error } = await this.supabase
      .from('ai_analyses')
      .insert({
        user_id: userId,
        account_id: accountId,
        trigger,
        trade_id: tradeId,
        status: 'queued',
        attempts: 0,
      })
      .select()
      .single();
    if (error) throw new Error(`analysis enqueue failed: ${error.message}`);
    return data;
  }

  /**
   * Find an existing ACTIVE (queued or running) analysis job for a trade.
   * If one exists, the caller should reuse it instead of creating a duplicate.
   * Completed/failed jobs are NOT returned — they represent past attempts,
   * and a new job may reasonably be enqueued for a re-analysis.
   */
  async findExisting(accountId, tradeId) {
    const { data, error } = await this.supabase
      .from('ai_analyses')
      .select('*')
      .eq('account_id', accountId)
      .eq('trade_id', tradeId)
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error && error.code !== 'PGRST116') {
      throw new Error(`analysis lookup failed: ${error.message}`);
    }
    return data ?? null;
  }

  /**
   * Atomically claim the next batch of jobs.
   * With accountIds, only those accounts' jobs are claimable; with null it
   * claims globally across all users/accounts (the standard worker mode).
   * Returns rows this worker owns exclusively.
   *
   * Order: queued jobs first (existing behavior), then STALE running jobs
   * whose lock has expired (`updated_at` older than `staleMs`).
   *
   * Concurrency-safe: every claim is a single conditional UPDATE whose WHERE
   * re-checks the preconditions (id + status + staleness + attempts), so a
   * second worker racing the same job matches 0 rows and can never double
   * process it. Running jobs with a valid (fresh) lock are never reclaimed.
   *
   * @param {string[]|null} accountIds
   * @param {{ batchSize?: number, staleMs?: number }} [opts]
   */
  async claimNext(accountIds = null, { batchSize = 1, staleMs = DEFAULT_STALE_LOCK_MS } = {}) {
    const staleIso = new Date(Date.now() - staleMs).toISOString();
    const claimed = [];

    // 1) queued jobs (unchanged behavior)
    const queued = await this._lookup(accountIds, { status: 'queued' }, batchSize);
    for (const row of queued) {
      if (claimed.length >= batchSize) break;
      const c = await this._claimQueued(row);
      if (c) claimed.push(c);
    }

    // 2) expired-lock running jobs — reclaim when attempts remain, otherwise
    //    finalize (so abandoned exhausted jobs terminate instead of looping).
    if (claimed.length < batchSize) {
      const stale = await this._lookupStale(accountIds, staleIso, batchSize - claimed.length);
      for (const row of stale) {
        if (claimed.length >= batchSize) break;
        const recovered = await this._reclaimRunning(row, staleIso);
        if (recovered) claimed.push(recovered);
        else await this._finalizeExhausted(row, staleIso);
      }
    }

    return claimed;
  }

  /** Select queued (or other simple status) candidates, newest first. */
  async _lookup(accountIds, { status }, limit) {
    let q = this.supabase
      .from('ai_analyses')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (Array.isArray(accountIds) && accountIds.length) q = q.in('account_id', accountIds);
    const { data, error } = await q;
    if (error) throw new Error(`analysis claim lookup failed: ${error.message}`);
    return data || [];
  }

  /** Select running jobs whose lock has expired, oldest lock first. */
  async _lookupStale(accountIds, staleIso, limit) {
    let q = this.supabase
      .from('ai_analyses')
      .select('*')
      .eq('status', 'running')
      .lt('updated_at', staleIso)
      .order('updated_at', { ascending: true })
      .limit(limit);
    if (Array.isArray(accountIds) && accountIds.length) q = q.in('account_id', accountIds);
    const { data, error } = await q;
    if (error) throw new Error(`analysis stale claim lookup failed: ${error.message}`);
    return data || [];
  }

  /** Atomic claim of a queued job (only matches while still queued). */
  async _claimQueued(row) {
    const { data, error } = await this.supabase
      .from('ai_analyses')
      .update({
        status: 'running',
        attempts: Number(row.attempts || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('status', 'queued')
      .select()
      .single();
    if (error) return null;
    return data;
  }

  /**
   * Atomic reclaim of a stale running job. The WHERE re-checks the current
   * row still has an EXPIRED lock and still has attempts left, so:
   *   - a second worker that raced and lost matches 0 rows → null;
   *   - a job whose lock was refreshed by a live worker no longer matches;
   *   - an exhausted job no longer matches (finalized instead).
   */
  async _reclaimRunning(row, staleIso) {
    const maxAttempts = Number(row.max_attempts || 3);
    const { data, error } = await this.supabase
      .from('ai_analyses')
      .update({
        status: 'running',
        attempts: Number(row.attempts || 0) + 1,
        updated_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('id', row.id)
      .eq('status', 'running')
      .lt('updated_at', staleIso)
      .lt('attempts', maxAttempts)
      .select()
      .single();
    if (error) return null;
    return data;
  }

  /**
   * Best-effort, idempotent finalize of an abandoned job whose attempts are
   * exhausted: running + expired lock + attempts >= max_attempts → failed.
   * Only ever called for rows our snapshot shows as exhausted, and the UPDATE
   * WHERE re-checks status/staleness/attempts so it can never fail a job that
   * another worker legitimately reclaimed.
   */
  async _finalizeExhausted(row, staleIso) {
    const maxAttempts = Number(row.max_attempts || 3);
    const attempts = Number(row.attempts || 0);
    if (attempts < maxAttempts) return; // reclaimable — leave to the worker
    try {
      await this.supabase
        .from('ai_analyses')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          last_error: `abandoned: lock expired after ${attempts}/${maxAttempts} attempts`,
        })
        .eq('id', row.id)
        .eq('status', 'running')
        .lt('updated_at', staleIso)
        .gte('attempts', maxAttempts);
    } catch {
      // best-effort cleanup; a concurrent claim/finalize is the usual cause
    }
  }

  /** Mark a running job done (with optional raw response / model). */
  async markDone(jobId, { rawResponse = null, model = null, promptVersion = null, inputSummary = null } = {}) {
    return this._update(jobId, {
      status: 'done',
      raw_response: rawResponse,
      model: model ?? null,
      prompt_version: promptVersion ?? null,
      input_summary: inputSummary ?? null,
      finished_at: new Date().toISOString(),
      last_error: null,
    });
  }

  /** Mark a running job failed (attempts exhausted) or requeue for retry. */
  async markFailed(jobId, { error = null, maxAttempts = 3, progress = 1, forceFail = false } = {}) {
    const nextAttempts = progress + 1;
    const final = forceFail || nextAttempts >= (maxAttempts || 3);
    return this._update(jobId, {
      status: final ? 'failed' : 'queued',
      attempts: final ? Math.max(nextAttempts, maxAttempts || 3) : nextAttempts,
      last_error: error ? String(error).slice(0, 1000) : null,
      finished_at: final ? new Date().toISOString() : null,
    });
  }

  /** Mark a running job skipped (e.g. nothing to analyze). */
  async markSkipped(jobId, { reason = null } = {}) {
    return this._update(jobId, {
      status: 'skipped',
      last_error: reason ? String(reason).slice(0, 1000) : null,
      finished_at: new Date().toISOString(),
    });
  }

  /** Analyze-status lookups for the API surface. */
  async getStatus(userId, accountId, jobId) {
    const { data, error } = await this.supabase
      .from('ai_analyses')
      .select('id, trigger, trade_id, status, attempts, max_attempts, last_error, model, prompt_version, input_summary, created_at, updated_at')
      .eq('id', jobId)
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw new Error(`analysis status lookup failed: ${error.message}`);
    return data ?? null;
  }

  async _update(jobId, patch) {
    const { data, error } = await this.supabase
      .from('ai_analyses')
      .update(patch)
      .eq('id', jobId)
      .select()
      .single();
    if (error) throw new Error(`analysis update failed: ${error.message}`);
    return data;
  }
}