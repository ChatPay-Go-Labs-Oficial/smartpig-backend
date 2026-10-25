const EXPERIENCE_TIME_ZONE = 'America/Sao_Paulo';

export function dailyRewardWindow(now = new Date()) {
  return {
    date: saoPauloDateKey(now),
    nextAvailableAt: nextSaoPauloMidnight(now),
  };
}

function saoPauloDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: EXPERIENCE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function nextSaoPauloMidnight(now: Date): Date {
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: EXPERIENCE_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  const dateValue = (type: Intl.DateTimeFormatPartTypes) =>
    Number(dateParts.find((part) => part.type === type)?.value);
  const targetAsUtc = Date.UTC(
    dateValue('year'),
    dateValue('month') - 1,
    dateValue('day') + 1,
  );

  // Convert the next local midnight to an instant without hardcoding UTC-03.
  // Iterating also handles a future timezone/DST rule change in the IANA data.
  let instant = targetAsUtc;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: EXPERIENCE_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = formatter.formatToParts(new Date(instant));
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    const representedAsUtc = Date.UTC(
      value('year'),
      value('month') - 1,
      value('day'),
      value('hour'),
      value('minute'),
      value('second'),
    );
    instant += targetAsUtc - representedAsUtc;
  }
  return new Date(instant);
}
