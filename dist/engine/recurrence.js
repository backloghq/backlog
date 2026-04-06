import { randomUUID } from "node:crypto";
import { formatDate } from "./dates.js";
const DAY_MS = 86400000;
/**
 * Generate pending instances from recurring task templates.
 * Called on read — creates instances up to `limit` ahead of now.
 */
export function generateInstances(allTasks, nextIdFn, limit = 3) {
    const templates = allTasks.filter((t) => t.status === "recurring" && t.recur && t.due);
    const generated = [];
    for (const template of templates) {
        // Find existing children of this template
        const children = allTasks.filter((t) => t.parent === template.uuid);
        const pendingChildren = children.filter((t) => t.status === "pending");
        // Don't generate if there are already enough pending instances
        if (pendingChildren.length >= limit)
            continue;
        // Find the latest due date among children (or use template's due as start)
        const latestDue = children.length > 0
            ? children
                .filter((c) => c.due)
                .reduce((max, c) => (c.due > max ? c.due : max), template.due)
            : null;
        const startDate = latestDue ? new Date(latestDue) : new Date(template.due);
        const untilDate = template.until ? new Date(template.until) : null;
        // Generate instances to fill up to `limit` pending
        let count = pendingChildren.length;
        let current = latestDue ? addRecurrence(startDate, template.recur) : startDate;
        // If no children yet, start from the template's due date
        if (!latestDue) {
            if (current <= new Date()) {
                // Due is in the past — create one for now
            }
        }
        else {
            // Skip to next occurrence after latest child
            current = addRecurrence(new Date(latestDue), template.recur);
        }
        while (count < limit) {
            if (untilDate && current > untilDate)
                break;
            const instance = {
                uuid: randomUUID(),
                id: nextIdFn(),
                description: template.description,
                status: "pending",
                entry: formatDate(new Date()),
                modified: formatDate(new Date()),
                due: formatDate(current),
                parent: template.uuid,
                ...(template.project && { project: template.project }),
                ...(template.tags && { tags: [...template.tags] }),
                ...(template.priority && { priority: template.priority }),
                ...(template.agent && { agent: template.agent }),
            };
            generated.push(instance);
            count++;
            current = addRecurrence(current, template.recur);
        }
    }
    return generated;
}
function addRecurrence(date, recur) {
    const lower = recur.toLowerCase();
    // Parse numeric+unit patterns
    const match = lower.match(/^(\d+)?\s*(d|day|days|w|wk|wks|week|weeks|m|mo|month|months|q|qtr|quarter|quarters|y|yr|year|years|daily|weekly|weekdays|biweekly|fortnight|monthly|quarterly|semiannual|annual|yearly|biannual|biyearly)s?$/);
    if (!match)
        return new Date(date.getTime() + DAY_MS); // fallback: daily
    const n = match[1] ? parseInt(match[1], 10) : 1;
    const unit = match[2];
    const result = new Date(date);
    // Named frequencies
    switch (unit) {
        case "daily": return new Date(date.getTime() + DAY_MS);
        case "weekly": return new Date(date.getTime() + 7 * DAY_MS);
        case "weekdays": {
            const next = new Date(date.getTime() + DAY_MS);
            while (next.getDay() === 0 || next.getDay() === 6) {
                next.setTime(next.getTime() + DAY_MS);
            }
            return next;
        }
        case "biweekly":
        case "fortnight": return new Date(date.getTime() + 14 * DAY_MS);
        case "monthly": {
            result.setMonth(result.getMonth() + 1);
            return result;
        }
        case "quarterly": {
            result.setMonth(result.getMonth() + 3);
            return result;
        }
        case "semiannual": {
            result.setMonth(result.getMonth() + 6);
            return result;
        }
        case "annual":
        case "yearly": {
            result.setFullYear(result.getFullYear() + 1);
            return result;
        }
        case "biannual":
        case "biyearly": {
            result.setFullYear(result.getFullYear() + 2);
            return result;
        }
    }
    // Numeric patterns
    if (unit.startsWith("d"))
        return new Date(date.getTime() + n * DAY_MS);
    if (unit.startsWith("w"))
        return new Date(date.getTime() + n * 7 * DAY_MS);
    if (unit === "m" || unit.startsWith("mo")) {
        result.setMonth(result.getMonth() + n);
        return result;
    }
    if (unit.startsWith("q")) {
        result.setMonth(result.getMonth() + n * 3);
        return result;
    }
    if (unit.startsWith("y")) {
        result.setFullYear(result.getFullYear() + n);
        return result;
    }
    return new Date(date.getTime() + DAY_MS); // fallback
}
