import type { LifeEvent, Preferences, Task, TimelineStatus } from "./types";

const DAY_MS = 86_400_000;
const DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh";
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string) {
  let value = formatterCache.get(timezone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    formatterCache.set(timezone, value);
  }
  return value;
}

function zonedParts(date: Date, timezone: string) {
  return Object.fromEntries(formatter(timezone).formatToParts(date).map(({ type, value }) => [type, value]));
}

export function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function dateKey(date: Date = new Date(), timezone = DEFAULT_TIMEZONE): string {
  const parts = zonedParts(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shiftDate(day: string, days: number): string {
  if (!isValidDateKey(day)) throw new Error("Choose a valid date.");
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${Math.floor(wrapped / 60).toString().padStart(2, "0")}:${Math.floor(wrapped % 60).toString().padStart(2, "0")}`;
}

/** Resolve an ISO local date and clock time without using the browser/server timezone. */
export function zonedDateTime(day: string, time: string, timezone = DEFAULT_TIMEZONE): Date {
  if (!isValidDateKey(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Choose a valid date and time.");
  const desired = Date.parse(`${day}T${time}:00Z`);
  let instant = desired;
  for (let step = 0; step < 4; step++) {
    const parts = zonedParts(new Date(instant), timezone);
    const represented = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    const adjustment = desired - represented;
    if (!adjustment) return new Date(instant);
    instant += adjustment;
  }
  // A nonexistent clock time during a DST transition must not silently move an appointment.
  const parts = zonedParts(new Date(instant), timezone);
  if (`${parts.year}-${parts.month}-${parts.day}` !== day || `${parts.hour}:${parts.minute}` !== time) {
    throw new Error("This local time does not exist in the selected timezone. Choose another time.");
  }
  return new Date(instant);
}

export function eventInstants(event: LifeEvent, timezone = DEFAULT_TIMEZONE): { start: Date; end: Date } {
  const endDay = event.endDate || (event.endTime <= event.startTime ? shiftDate(event.date, 1) : event.date);
  return { start: zonedDateTime(event.date, event.startTime, timezone), end: zonedDateTime(endDay, event.endTime, timezone) };
}

export const getEventDates = eventInstants;

export function eventDurationMinutes(event: LifeEvent, timezone = DEFAULT_TIMEZONE): number {
  const { start, end } = eventInstants(event, timezone);
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

export function formatDuration(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return hours ? `${hours}h${rest ? ` ${rest}m` : ""}` : `${rest}m`;
}

export function formatTime(time: string, format: "12" | "24" = "24"): string {
  if (format === "24") return time;
  const [hours, minutes] = time.split(":").map(Number);
  return `${hours % 12 || 12}:${minutes.toString().padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

function calendarDaySpan(event: LifeEvent): number {
  if (!event.endDate) return event.endTime <= event.startTime ? 1 : 0;
  return Math.max(0, Math.round((Date.parse(`${event.endDate}T00:00:00Z`) - Date.parse(`${event.date}T00:00:00Z`)) / DAY_MS));
}

function occurrence(master: LifeEvent, day: string): LifeEvent {
  return {
    ...master, id: `${master.id}::${day}`, parentId: master.id, date: day,
    endDate: master.endDate ? shiftDate(day, calendarDaySpan(master)) : undefined,
    recurrence: undefined, excludedDates: undefined,
  };
}

/** Expand weekly classes and keep overnight activities visible on both dates. */
export function eventsForDate(events: LifeEvent[], day: string, timezone = DEFAULT_TIMEZONE): LifeEvent[] {
  const dayStart = zonedDateTime(day, "00:00", timezone).getTime();
  const dayEnd = zonedDateTime(shiftDate(day, 1), "00:00", timezone).getTime();
  const result: LifeEvent[] = [];
  const intersects = (event: LifeEvent) => {
    const { start, end } = eventInstants(event, timezone);
    return start.getTime() < dayEnd && end.getTime() > dayStart;
  };
  for (const event of events) {
    if (!event.recurrence) {
      if (intersects(event)) result.push(event);
      continue;
    }
    // Calendar duration, rather than milliseconds, keeps weekly classes at the same local time across DST.
    const lookback = calendarDaySpan(event);
    for (let prior = lookback; prior >= 0; prior--) {
      const candidate = shiftDate(day, -prior);
      if (candidate < event.date || candidate > event.recurrence.until || event.excludedDates?.includes(candidate)) continue;
      const weekday = new Date(`${candidate}T12:00:00Z`).getUTCDay();
      if (!event.recurrence.daysOfWeek.includes(weekday)) continue;
      const expanded = occurrence(event, candidate);
      if (intersects(expanded)) result.push(expanded);
    }
  }
  return result.sort((a, b) => eventInstants(a, timezone).start.getTime() - eventInstants(b, timezone).start.getTime() || a.id.localeCompare(b.id));
}

export function statusForEvent(event: LifeEvent, now = new Date(), timezone = DEFAULT_TIMEZONE): TimelineStatus {
  if (event.status === "completed" || event.status === "skipped") return event.status;
  const { start, end } = eventInstants(event, timezone);
  if (now < start) return "upcoming";
  if (now >= end) return "unconfirmed";
  return "active";
}

export interface EventConflict { first: LifeEvent; second: LifeEvent }

/** Call with expanded occurrences (such as eventsForDate's result). Touching boundaries do not overlap. */
export function findConflicts(events: LifeEvent[], timezone = DEFAULT_TIMEZONE): EventConflict[] {
  const sorted = events.filter((event) => event.status !== "skipped").map((event) => ({ event, ...eventInstants(event, timezone) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const conflicts: EventConflict[] = [];
  for (let index = 0; index < sorted.length; index++) {
    for (let next = index + 1; next < sorted.length && sorted[next].start < sorted[index].end; next++) {
      if (sorted[index].event.id !== sorted[next].event.id && sorted[next].end > sorted[index].start) {
        conflicts.push({ first: sorted[index].event, second: sorted[next].event });
      }
    }
  }
  return conflicts;
}

function deadlineInstant(deadline: string, timezone: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return zonedDateTime(deadline, "23:59", timezone);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(deadline)) return zonedDateTime(deadline.slice(0, 10), deadline.slice(11, 16), timezone);
  return new Date(deadline);
}

/** Apply reviewed, dated replacements while keeping the rest of the calendar intact. */
export function applyEventOverlay(existing: LifeEvent[], proposed: LifeEvent[], options: { materializeOccurrences?: boolean } = {}): LifeEvent[] {
  const proposedIds = new Set(proposed.map(({ id }) => id));
  const occurrenceDates = new Map<string, Set<string>>();
  for (const event of proposed) {
    if (!event.parentId || !event.id.startsWith(`${event.parentId}::`)) continue;
    const originalDate = event.id.slice(event.parentId.length + 2);
    if (!isValidDateKey(originalDate)) continue;
    const dates = occurrenceDates.get(event.parentId) || new Set<string>();
    dates.add(originalDate);
    occurrenceDates.set(event.parentId, dates);
  }
  return [
    ...existing.filter(({ id }) => !proposedIds.has(id)).map((event) => {
      const dates = occurrenceDates.get(event.id);
      return dates && event.recurrence ? { ...event, excludedDates: [...new Set([...(event.excludedDates || []), ...dates])] } : event;
    }),
    ...proposed.map((event) => options.materializeOccurrences && event.parentId && event.id.startsWith(`${event.parentId}::`)
      ? { ...event, id: crypto.randomUUID(), recurrence: undefined, excludedDates: undefined }
      : event),
  ];
}

/** Check local clock times before adopting a timezone, including future weekly class dates. */
export function validateEventTimezone(events: LifeEvent[], timezone: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const checked = new Set<string>();
  const check = (event: LifeEvent) => {
    const key = `${event.date}|${event.startTime}|${event.endDate || ""}|${event.endTime}`;
    if (checked.has(key)) return;
    checked.add(key);
    try { eventInstants(event, timezone); } catch (error) {
      errors.push(`“${event.title}” on ${event.date}: ${error instanceof Error ? error.message : "Choose a valid date and time."}`);
    }
  };
  for (const event of events) {
    if (!event.recurrence) check(event);
    else {
      const days = Math.round((Date.parse(`${event.recurrence.until}T00:00:00Z`) - Date.parse(`${event.date}T00:00:00Z`)) / DAY_MS);
      if (days > 730) errors.push(`“${event.title}” repeats for more than two years. Shorten this series before changing timezone.`);
      else for (let offset = 0; offset <= days; offset++) {
        const day = shiftDate(event.date, offset);
        if (event.recurrence.daysOfWeek.includes(new Date(`${day}T12:00:00Z`).getUTCDay()) && !event.excludedDates?.includes(day)) check(occurrence(event, day));
        if (errors.length >= 5) break;
      }
    }
    if (errors.length >= 5) break;
  }
  return { valid: errors.length === 0, errors };
}

/** Validate proposals as overlays; omitted existing events are preserved, never implicitly deleted. */
export function validatePlan(proposed: LifeEvent[], existing: LifeEvent[], preferences: Preferences, tasks: Task[] = []): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const timezone = preferences.timezone;
  const proposedIds = new Set(proposed.map(({ id }) => id));
  if (proposedIds.size !== proposed.length) errors.push("The proposal contains duplicate activity IDs.");
  const combined = applyEventOverlay(existing, proposed);
  const days = new Set<string>();
  for (const event of proposed) {
    try {
      const previous = existing.find(({ id }) => id === event.id || id === event.parentId);
      if (previous?.fixed) {
        const original = previous.recurrence && event.parentId ? occurrence(previous, event.id.split("::")[1] || event.date) : previous;
        const a = eventInstants(original, timezone);
        const b = eventInstants(event, timezone);
        if (+a.start !== +b.start || +a.end !== +b.end || event.status === "skipped" || !event.fixed) errors.push(`“${previous.title}” is fixed and cannot be moved, unlocked or skipped.`);
      }
      if (previous?.recurrence && previous.id === event.id) errors.push(`“${previous.title}” is a recurring series. Propose a dated occurrence instead of replacing the series.`);
      const { start, end } = eventInstants(event, timezone);
      if (end <= start) { errors.push(`“${event.title}” must end after it starts.`); continue; }
      // New recurring series must be expanded and reviewed separately; AI proposals are finite dated blocks.
      if (event.recurrence) errors.push(`“${event.title}” must be proposed as individual dates, not an unbounded recurring series.`);
      const wake = zonedDateTime(event.date, preferences.wakeTime, timezone);
      const bedDay = preferences.bedTime <= preferences.wakeTime ? shiftDate(event.date, 1) : event.date;
      const bed = zonedDateTime(bedDay, preferences.bedTime, timezone);
      if (event.category !== "rest" && (start < wake || end > bed)) errors.push(`“${event.title}” falls outside your waking hours.`);
      const task = tasks.find(({ id }) => id === event.details?.taskId);
      if (task?.deadline && end > deadlineInstant(task.deadline, timezone)) errors.push(`“${event.title}” finishes after its task deadline.`);
      days.add(event.date);
      const endDay = dateKey(end, timezone);
      if (endDay !== event.date) days.add(endDay);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "An activity contains an invalid date or time.");
    }
  }
  const checkedPairs = new Set<string>();
  for (const day of days) {
    try {
      for (const { first, second } of findConflicts(eventsForDate(combined, day, timezone), timezone)) {
        const involvesProposal = proposedIds.has(first.id) || proposedIds.has(second.id) || (first.parentId && proposedIds.has(first.parentId)) || (second.parentId && proposedIds.has(second.parentId));
        const pair = [first.id, second.id].sort().join("|");
        if (involvesProposal && !checkedPairs.has(pair)) {
          errors.push(`“${first.title}” overlaps “${second.title}”.`);
          checkedPairs.add(pair);
        }
      }
    } catch {
      errors.push("The existing calendar contains an invalid activity. Please review its date and time.");
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
