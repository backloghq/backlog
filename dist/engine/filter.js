/**
 * Filter translator — converts backlog filter syntax to agentdb JSON filter objects.
 * Handles virtual tags, date resolution, numeric IDs, and UUIDs on top of agentdb's compact filter parser.
 */
import { resolveDate, formatDate } from "./dates.js";
import { parseCompactFilter } from "@backloghq/agentdb";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Virtual filter tags defined in task-schema.ts — these are NOT regular tags
const VIRTUAL_TAGS = new Set([
    "+OVERDUE", "+ACTIVE", "+BLOCKED", "+UNBLOCKED", "+READY", "+BLOCKING",
    "+WAITING", "+PENDING", "+COMPLETED", "+DELETED", "+RECURRING",
    "+TAGGED", "+ANNOTATED", "+PROJECT", "+PRIORITY", "+DUE", "+SCHEDULED",
    "+TODAY", "+TOMORROW", "+WEEK", "+UDA",
]);
// Date modifiers that need resolution
const DATE_MODIFIERS = new Set(["before", "after", "by"]);
/**
 * Compile a backlog filter string into an agentdb JSON filter object.
 */
export function compileFilter(filter) {
    const trimmed = filter.trim();
    if (!trimmed)
        return {};
    // Special case: bare numeric ID
    if (/^\d+$/.test(trimmed)) {
        return { id: parseInt(trimmed, 10) };
    }
    // Special case: bare UUID
    if (UUID_RE.test(trimmed)) {
        return { _id: trimmed };
    }
    // Pre-process: extract virtual tags and resolve dates
    const { cleaned, virtualKeys } = extractVirtualTags(trimmed);
    const processed = preprocessDateModifiers(cleaned);
    // Let agentdb handle the remaining filter syntax
    let result;
    if (processed.trim()) {
        result = parseCompactFilter(processed, "tags");
    }
    else {
        result = {};
    }
    // Merge virtual tag keys into filter
    for (const key of virtualKeys) {
        result[key] = true;
    }
    return result;
}
/**
 * Extract virtual tag tokens (+OVERDUE, +ACTIVE, etc.) from the filter string.
 * Returns the cleaned string (without virtual tags) and the extracted keys.
 */
function extractVirtualTags(filter) {
    const virtualKeys = [];
    const parts = [];
    for (const token of filter.split(/\s+/)) {
        if (VIRTUAL_TAGS.has(token.toUpperCase())) {
            virtualKeys.push(token.toUpperCase());
        }
        else {
            parts.push(token);
        }
    }
    return { cleaned: parts.join(" "), virtualKeys };
}
/**
 * Resolve date values in modifier expressions.
 */
function preprocessDateModifiers(filter) {
    return filter.replace(/(\w+)\.(before|after|by):(\S+)/gi, (match, field, modifier, value) => {
        if (!DATE_MODIFIERS.has(modifier.toLowerCase()))
            return match;
        try {
            const resolved = formatDate(resolveDate(value));
            return `${field}.${modifier}:${resolved}`;
        }
        catch {
            return match;
        }
    });
}
