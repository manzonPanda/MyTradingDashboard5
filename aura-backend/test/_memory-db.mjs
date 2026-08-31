/**
 * In-memory supabase client used by the Behavior Engine test suites.
 *
 * Supports the exact query surface the stores use: select/eq/in/order/limit,
 * maybeSingle/single, upsert/update/insert (chainable, thenable).
 *
 * IMPORTANT fidelity notes:
 *   - a mutation (insert/upsert/update) makes the NEXT select/single return
 *     the affected rows even when the new values no longer match the update
 *     filters (matches supabase/PostgREST behavior).
 *   - upsert honors onConflict (merge-or-insert).
 */

export function makeMemoryDb() {
  const tables = new Map();
  const getT = (name) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };
  const clone = (obj) => (typeof obj === 'object' && obj !== null ? { ...obj } : obj);
  const idFor = (table, prefix) => `${prefix || table}-${getT(table).length}-${Math.random().toString(36).slice(2, 8)}`;

  const db = {
    tables,
    reset() { tables.clear(); },
    insert(table, rows) {
      for (const r of Array.isArray(rows) ? rows : [rows]) {
        getT(table).push({ ...clone(r), id: r.id || idFor(table) });
      }
    },
    fetchAll(table) { return getT(table).map(clone); },
  };

  db.from = (table) => {
    const rows = () => getT(table);
    const state = {
      filters: [],
      orderBy: null,
      ascending: true,
      limitVal: null,
      updatePatch: null,
      upsertPayload: null,
      onConflict: null,
      insertRow: null,
      selectStr: null,
      countMode: null,
    };

    // Parse embedded resources from the select string: alias:child_table(cols)
    const EMBED_RE = /([A-Za-z_][A-Za-z0-9_]*):([A-Za-z_][A-Za-z0-9_]*)\(([^)]*)\)/g;

    const applyEmbeds = (out) => {
      if (!state.selectStr) return out;
      let m;
      EMBED_RE.lastIndex = 0;
      while ((m = EMBED_RE.exec(state.selectStr))) {
        const [, alias, childTable, colsStr] = m;
        if (!tables.has(childTable)) { for (const row of out) row[alias] = []; continue; }
        // Generic FK match: any child column ending in '_id' whose value
        // equals the parent row id (covers behavior_id, trade_id, …).
        const cols = colsStr.split(',').map((s) => s.trim());
        for (const row of out) {
          row[alias] = getT(childTable)
            .filter((c) => Object.entries(c).some(([k, v]) => k.endsWith('_id') && String(v) === String(row.id)))
            .map((c) => {
              if (cols.includes('*')) return clone(c);
              const picked = {};
              for (const col of cols) if (col) picked[col] = c[col];
              return picked;
            });
        }
      }
      return out;
    };

    const matches = (row) => state.filters.every(({ col, val }) => {
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        // range filter { gte, lte, gt, lt }
        const cell = row[col];
        if (cell === undefined || cell === null) return false;
        const cellV = typeof cell === 'string' && !isNaN(Date.parse(cell)) ? Date.parse(cell) : Number(cell);
        const norm = (x) => (typeof x === 'string' && !isNaN(Date.parse(x)) ? Date.parse(x) : Number(x));
        if (val.gte !== undefined && !(cellV >= norm(val.gte))) return false;
        if (val.lte !== undefined && !(cellV <= norm(val.lte))) return false;
        if (val.gt !== undefined && !(cellV > norm(val.gt))) return false;
        if (val.lt !== undefined && !(cellV < norm(val.lt))) return false;
        return true;
      }
      if (Array.isArray(val)) return val.includes(row[col]) || val.map(String).includes(String(row[col]));
      return row[col] === val || String(row[col]) === String(val);
    });

    const applyMutation = () => {
      const touched = [];
      if (state.insertRow !== null) {
        const p = clone(state.insertRow);
        p.id = p.id || idFor(table);
        getT(table).push(p);
        state.insertRow = null;
        touched.push(p.id);
        state.lastTouched = touched;
        return touched.length > 0;
      }
      if (state.upsertPayload !== null) {
        const p = clone(state.upsertPayload);
        const t = rows();
        const cols = state.onConflict ? state.onConflict.split(',') : null;
        if (cols) {
          const idx = t.findIndex((r) => cols.every((c) => r[c] !== undefined && String(r[c]) === String(p[c])));
          if (idx >= 0) {
            if (state.ignoreDuplicates) { touched.push(t[idx].id); } // no-op, return existing
            else { t[idx] = { ...t[idx], ...p }; touched.push(t[idx].id); }
          }
          else { p.id = p.id || idFor(table); t.push(p); touched.push(p.id); }
        } else {
          p.id = p.id || idFor(table);
          t.push(p);
          touched.push(p.id);
        }
        state.upsertPayload = null;
        state.lastTouched = touched;
        return touched.length > 0;
      }
      if (state.updatePatch !== null) {
        const filtered = rows().filter(matches);
        for (const r of filtered) { Object.assign(r, clone(state.updatePatch)); touched.push(r.id); }
        state.updatePatch = null;
        state.lastTouched = touched;
        return touched.length > 0;
      }
      return false;
    };

    const runQuery = () => {
      const mutated = applyMutation();
      let rowsList = rows();
      if (mutated && state.lastTouched && state.lastTouched.length) {
        rowsList = rowsList.filter((r) => state.lastTouched.includes(r.id));
        state.lastTouched = null;
      } else {
        rowsList = rowsList.filter(matches);
      }
      let out = rowsList.map(clone);
      if (state.orderBy) {
        out.sort((a, b) => (state.ascending ? (a[state.orderBy] > b[state.orderBy] ? 1 : -1) : (a[state.orderBy] < b[state.orderBy] ? 1 : -1)));
      }
      if (state.limitVal) out = out.slice(0, state.limitVal);
      return out;
    };

    const api = {
      select(fields, opts = {}) {
        if (typeof fields === 'string') state.selectStr = fields;
        if (opts?.count) state.countMode = opts.count;
        return api;
      },
      eq(col, val) { state.filters.push({ col, val }); return api; },
      in(col, vals) { state.filters.push({ col, val: Array.isArray(vals) ? vals : [vals] }); return api; },
      gte(col, val) { state.filters.push({ col, val: { gte: val } }); return api; },
      lte(col, val) { state.filters.push({ col, val: { lte: val } }); return api; },
      gt(col, val) { state.filters.push({ col, val: { gt: val } }); return api; },
      lt(col, val) { state.filters.push({ col, val: { lt: val } }); return api; },
      order(col, opts = {}) { state.orderBy = col; state.ascending = opts.ascending !== false; return api; },
      limit(n) { state.limitVal = n; return api; },
      maybeSingle() { const out = applyEmbeds(runQuery()); return Promise.resolve({ data: out[0] ?? null, error: null }); },
      single() { const out = applyEmbeds(runQuery()); return Promise.resolve({ data: out[0] ?? null, error: null }); },
      upsert(payload, opts = {}) { state.upsertPayload = clone(payload); state.onConflict = opts?.onConflict ?? null; state.ignoreDuplicates = !!opts?.ignoreDuplicates; return api; },
      update(patch) { state.updatePatch = clone(patch); return api; },
      insert(payload) { state.insertRow = clone(payload); return api; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          applyMutation();
          let out = rows().filter(matches).map(clone);
          if (state.orderBy) {
            out.sort((a, b) => (state.ascending ? (a[state.orderBy] > b[state.orderBy] ? 1 : -1) : (a[state.orderBy] < b[state.orderBy] ? 1 : -1)));
          }
          if (state.limitVal) out = out.slice(0, state.limitVal);
          out = applyEmbeds(out);
          if (state.countMode) {
            state.countMode = null;
            return resolve({ data: [], error: null, count: out.length });
          }
          return resolve({ data: out, error: null });
        }, reject);
      },
    };
    return api;
  };

  return db;
}