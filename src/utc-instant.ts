const WHOLE_SECOND_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;

/**
 * Milliseconds since the epoch for a whole-second UTC time such as
 * `2026-01-01T00:00:00Z`, or `null` for anything else. A date that does not
 * exist, such as February 30, is not silently moved to a real one.
 */
export const wholeSecondUtc = (value: string): number | null => {
  if (!WHOLE_SECOND_UTC.test(value)) {
    return null;
  }
  const time = Date.parse(value);
  return !Number.isNaN(time) &&
    new Date(time).toISOString() === `${value.slice(0, -1)}.000Z`
    ? time
    : null;
};
