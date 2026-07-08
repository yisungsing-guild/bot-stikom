function mergeNextProgramHint(prevData = {}, nextProgram) {
  const normalized = String(nextProgram || '').trim();
  if (!normalized) return prevData || {};

  const current =
    (prevData && prevData.currentProgramHint) ||
    (prevData && prevData.lastProgramHint) ||
    null;

  return {
    ...prevData,
    previousProgramHint:
      current && current !== normalized
        ? current
        : (prevData && prevData.previousProgramHint) || null,

    currentProgramHint: normalized,
    lastProgramHint: normalized
  };
}

module.exports = {
  mergeNextProgramHint
};
