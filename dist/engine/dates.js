const DAY_MS = 86400000;
export function resolveDate(input) {
    const now = new Date();
    const lower = input.toLowerCase().trim();
    // ISO 8601 or date-like
    if (/^\d{4}-\d{2}-\d{2}/.test(lower)) {
        const d = new Date(input);
        if (isNaN(d.getTime()))
            throw new Error(`Invalid date: "${input}"`);
        return d;
    }
    // Compound: now-7d, now+3w, today-1m, etc.
    const compoundMatch = lower.match(/^(\w+)([+-])(\d+\w+)$/);
    if (compoundMatch) {
        const base = resolveDate(compoundMatch[1]);
        const sign = compoundMatch[2] === "+" ? 1 : -1;
        const offset = parseRelative(compoundMatch[3]);
        if (offset) {
            const diffMs = offset.getTime() - now.getTime();
            return new Date(base.getTime() + sign * diffMs);
        }
    }
    // Named dates
    switch (lower) {
        case "now": return now;
        case "today": return startOfDay(now);
        case "yesterday": return startOfDay(addDays(now, -1));
        case "tomorrow": return startOfDay(addDays(now, 1));
        case "later":
        case "someday": return new Date("9999-12-30T23:59:59Z");
        // Week boundaries
        case "sow":
        case "soww": return startOfWeek(now);
        case "eow":
        case "eoww": return endOfWeek(now);
        // Month boundaries
        case "som": return startOfMonth(now);
        case "eom": return endOfMonth(now);
        // Quarter boundaries
        case "soq": return startOfQuarter(now);
        case "eoq": return endOfQuarter(now);
        // Year boundaries
        case "soy": return startOfYear(now);
        case "eoy": return endOfYear(now);
    }
    // Weekday names
    const weekday = parseWeekday(lower);
    if (weekday >= 0)
        return nextWeekday(now, weekday);
    // Relative: 3d, 2w, 1m, 1y, etc.
    const rel = parseRelative(lower);
    if (rel)
        return rel;
    // Fallback: try native Date parser
    const parsed = new Date(input);
    if (!isNaN(parsed.getTime()))
        return parsed;
    throw new Error(`Cannot parse date: '${input}'`);
}
export function formatDate(date) {
    return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
export function isOverdue(due) {
    return new Date(due) < new Date();
}
export function isDueToday(due) {
    const d = new Date(due);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate();
}
export function isDueThisWeek(due) {
    const d = new Date(due);
    const now = new Date();
    const sow = startOfWeek(now);
    const eow = endOfWeek(now);
    return d >= sow && d <= eow;
}
export function isDueThisMonth(due) {
    const d = new Date(due);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}
export function isDueThisQuarter(due) {
    const d = new Date(due);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() &&
        Math.floor(d.getMonth() / 3) === Math.floor(now.getMonth() / 3);
}
export function isDueThisYear(due) {
    const d = new Date(due);
    return d.getFullYear() === new Date().getFullYear();
}
function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d, n) {
    return new Date(d.getTime() + n * DAY_MS);
}
function startOfWeek(d) {
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day; // Monday start
    return startOfDay(addDays(d, diff));
}
function endOfWeek(d) {
    const sow = startOfWeek(d);
    return new Date(sow.getTime() + 7 * DAY_MS - 1);
}
function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
}
function startOfQuarter(d) {
    const q = Math.floor(d.getMonth() / 3);
    return new Date(d.getFullYear(), q * 3, 1);
}
function endOfQuarter(d) {
    const q = Math.floor(d.getMonth() / 3);
    return new Date(d.getFullYear(), (q + 1) * 3, 0, 23, 59, 59);
}
function startOfYear(d) {
    return new Date(d.getFullYear(), 0, 1);
}
function endOfYear(d) {
    return new Date(d.getFullYear(), 11, 31, 23, 59, 59);
}
function parseWeekday(s) {
    const days = {
        monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3,
        thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 0, sun: 0,
    };
    return days[s] ?? -1;
}
function nextWeekday(from, targetDay) {
    const current = from.getDay();
    let diff = targetDay - current;
    if (diff <= 0)
        diff += 7;
    return startOfDay(addDays(from, diff));
}
function parseRelative(s) {
    const match = s.match(/^(\d+)\s*(d|day|days|da|w|wk|wks|week|weeks|m|mo|month|months|q|qtr|qtrs|quarter|quarters|y|yr|yrs|year|years)s?$/);
    if (!match)
        return null;
    const n = parseInt(match[1], 10);
    const unit = match[2];
    const now = new Date();
    if (unit.startsWith("d"))
        return addDays(now, n);
    if (unit.startsWith("w"))
        return addDays(now, n * 7);
    if (unit.startsWith("mo") || unit === "m") {
        const d = new Date(now);
        d.setMonth(d.getMonth() + n);
        return d;
    }
    if (unit.startsWith("q")) {
        const d = new Date(now);
        d.setMonth(d.getMonth() + n * 3);
        return d;
    }
    if (unit.startsWith("y")) {
        const d = new Date(now);
        d.setFullYear(d.getFullYear() + n);
        return d;
    }
    return null;
}
