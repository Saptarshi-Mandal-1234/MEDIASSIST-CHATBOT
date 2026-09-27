const { init, db } = require('./database');
init().then(() => console.log('Reference database ready. Existing health records preserved.')).catch(() => { console.error('Database initialization failed. Check your database settings.'); process.exitCode = 1; }).finally(() => db.close());
