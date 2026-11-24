/**
 * The Quiet Fight — flexible 100-day journey core.
 * Portable pure functions. No API calls, no tracking or access to private notes.
 */
export const JOURNEY_LENGTH = 100;

/** Short optional activities when someone does not fancy a full lesson. */
export const QUICK_ACTIVITIES = Object.freeze([
  { id: 'grounding', title: 'Find your feet', minutes: 2, category: 'steady', description: 'Take a moment, notice where you are and name three things you can see or feel.' },
  { id: 'unsent-message', title: 'Words you do not have to send', minutes: 5, category: 'reflect', description: 'Write what you wish you could say. Keep it private. No pressure to share.' },
  { id: 'one-small-thing', title: 'One small thing', minutes: 3, category: 'practical', description: 'Choose one manageable thing you can do for yourself today.' },
  { id: 'child-memory', title: 'A moment that mattered', minutes: 4, category: 'dad', description: 'Remember an ordinary moment with your child. It does not need to become a task.' },
  { id: 'calm-reply', title: 'Pause before replying', minutes: 5, category: 'co-parent', description: 'Take a moment before replying to a difficult message. Keep it child-focused.' },
  { id: 'handover-plan', title: 'Plan your next handover', minutes: 5, category: 'co-parent', description: 'Choose a simple, calm plan for what you can control.' },
]);

export function validateProgress(progress) {
  const completed = Array.isArray(progress?.completedDays) ? progress.completedDays : [];
  const completedDays = [...new Set(completed.filter(Number.isInteger).filter(d => d >= 1 && d <= JOURNEY_LENGTH))].sort((a,b) => a-b);
  const optionalActivityCounts = {};
  for (const item of QUICK_ACTIVITIES) {
    const n = progress?.optionalActivityCounts?.[item.id];
    optionalActivityCounts[item.id] = Number.isInteger(n) && n >= 0 ? Math.min(n, 10000) : 0;
  }
  return { completedDays, optionalActivityCounts };
}

export function nextAvailableDay(progress) {
  const done = new Set(validateProgress(progress).completedDays);
  for (let day=1; day<=JOURNEY_LENGTH; day++) {
    if (!done.has(day)) return day;
  }
  return null;
}

/**
 * No 24-hour timer. Complete Day 1 and immediately unlock Day 2.
 * Do not allow skipping new lessons before previous day is completed.
 */
export function completeJourneyDay(progress, day) {
  if (!Number.isInteger(day) || day < 1 || day > JOURNEY_LENGTH) throw new RangeError('Invalid journey day');
  const current = validateProgress(progress);
  const next = nextAvailableDay(current);
  if (current.completedDays.includes(day)) return { ...current, completedDay: day, alreadyCompleted: true, nextDay: next };
  if (day !== next) throw new Error('Complete the previous journey day first');
  const updated = validateProgress({ ...current, completedDays: [...current.completedDays, day] });
  return { ...updated, completedDay: day, alreadyCompleted: false, nextDay: nextAvailableDay(updated) };
}

export function recordOptionalActivity(progress, activityId) {
  if (!QUICK_ACTIVITIES.some(x => x.id === activityId)) throw new Error('Unknown activity');
  const current = validateProgress(progress);
  return validateProgress({
    ...current,
    optionalActivityCounts: {
      ...current.optionalActivityCounts,
      [activityId]: Math.min(10000, current.optionalActivityCounts[activityId] + 1)
    }
  });
}

export function journeyOverview(progress) {
  const current = validateProgress(progress);
  return {
    completedCount: current.completedDays.length,
    remainingCount: JOURNEY_LENGTH - current.completedDays.length,
    nextDay: nextAvailableDay(current),
    complete: current.completedDays.length === JOURNEY_LENGTH,
    canContinueToday: current.completedDays.length < JOURNEY_LENGTH,
    optionalActivityCount: Object.values(current.optionalActivityCounts).reduce((a,b) => a+b,0),
    // No streaks: taking a break isn't a failure.
  };
}

/** Stateless UI model. UI can render these choices as existing dark rounded cards. */
export function nextStepChoices(progress) {
  const overview = journeyOverview(progress);
  return {
    heading: overview.complete ? 'Your 100 days are complete' : 'Your journey. Your pace.',
    description: overview.complete
      ? 'You can revisit any day or choose something else whenever you need it.'
      : 'One day is enough. More than one is fine too. You decide.',
    primary: overview.nextDay ? { type:'journey-day', day: overview.nextDay, label: 'Continue to Day ' + overview.nextDay } : null,
    secondary: QUICK_ACTIVITIES.map(a=>({type:'optional-activity', ...a})),
    completedDays: [...validateProgress(progress).completedDays],
  };
}
