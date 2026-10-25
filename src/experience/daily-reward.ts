/** Sao Paulo has UTC-03:00 year-round; derive the date through its IANA zone. */
export function dailyRewardWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const date = `${part('year')}-${part('month')}-${part('day')}`;
  const nextAvailableAt = new Date(
    new Date(`${date}T00:00:00-03:00`).getTime() + 86400000,
  );
  return { date, nextAvailableAt };
}
