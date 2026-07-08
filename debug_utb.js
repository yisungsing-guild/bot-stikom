const { query } = require('./src/engine/ragEngine');

(async () => {
  try {
    // Log the query
    console.log('[DEBUG]', 'Testing: rincian biaya utb');
    
    // Call query and check internal state
    const res = await query('rincian biaya utb', null, {});
    
    console.log('[RESULT]', {
      success: res.success,
      source: res.source,
      answer: (String(res.answer || '').length > 200 ? String(res.answer || '').slice(0, 200) + '...' : res.answer),
    });
  } catch (e) {
    console.error('[ERROR]', e.message);
  }
})();
