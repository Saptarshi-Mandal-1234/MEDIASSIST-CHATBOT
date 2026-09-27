// Small adapter for the SQL statements used by this app. Values stay parameterized.
function createPostgres(pool) {
  function statement(sql, values) {
    let index = 0;
    if (values.length === 1 && values[0] && typeof values[0] === 'object' && !Array.isArray(values[0])) {
      const named = values[0]; values = [];
      sql = sql.replace(/@(\w+)/g, (_, name) => { values.push(named[name]); return '$' + (++index); });
    } else sql = sql.replace(/\?/g, () => '$' + (++index));
    return { text: sql, values };
  }
  return {
    exec(sql) { return pool.query(sql); },
    prepare(sql) {
      return {
        async all(...values) { return (await pool.query(statement(sql, values))).rows; },
        async get(...values) { return (await pool.query(statement(sql, values))).rows[0]; },
        async run(...values) {
          const insert = /^\s*INSERT\b/i.test(sql);
          const result = await pool.query(statement(sql.trim() + (insert ? ' RETURNING id' : ''), values));
          return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id };
        }
      };
    },
    close() { return pool.end(); }
  };
}
module.exports = { createPostgres };
