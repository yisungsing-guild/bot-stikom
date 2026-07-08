const { query, tryStructuredScheduleAnswer, tryStructuredScheduleOverviewAnswer } = require('./src/engine/ragEngine');
(async () => {
  try {
    const q = 'jadwal gelombang 4';
    const res = await query(q);
    console.log('QUERY', JSON.stringify(res, null, 2));
    const res2 = tryStructuredScheduleAnswer(q, []);
    console.log('SCHEDULE_ANSWER', JSON.stringify(res2, null, 2));
    const res3 = tryStructuredScheduleOverviewAnswer(q);
    console.log('SCHEDULE_OVERVIEW', JSON.stringify(res3, null, 2));
  } catch (e) {
    console.error(e && e.stack);
  }
})();
