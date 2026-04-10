/**
 * Filter translator — converts backlog filter syntax to agentdb JSON filter objects.
 * AgentDB handles matching, indexing, and virtual filter resolution.
 *
 * Backlog syntax → AgentDB JSON:
 *   project:backend       → { project: "backend" }
 *   priority:H            → { priority: "H" }
 *   due.before:friday     → { due: { $lt: "<resolved ISO date>" } }
 *   +bug                  → { tags: { $contains: "bug" } }  (via agentdb compact filter)
 *   -old                  → { tags: { $not: { $contains: "old" } } }
 *   +OVERDUE              → { "+OVERDUE": true }  (triggers schema virtualFilter)
 *   auth                  → { $text: "auth" }  (via agentdb text search)
 *   42                    → { id: 42 }  (numeric ID)
 *   <uuid>                → { _id: "<uuid>" }
 *   A or B                → { $or: [A, B] }
 *   (A or B) C            → { $and: [{ $or: [A, B] }, C] }
 */
import { resolveDate, formatDate } from "./dates.js";
import { parseCompactFilter } from "@backloghq/agentdb";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Date modifiers that need resolution
const DATE_MODIFIERS = new Set(["before", "after", "by"]);
/**
 * Compile a backlog filter string into an agentdb JSON filter object.
 * Handles backlog-specific syntax (date resolution, numeric IDs, UUIDs)
 * on top of agentdb's compact filter parser.
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
    // Pre-process: resolve dates in modifier expressions before passing to agentdb parser
    const processed = preprocessDateModifiers(trimmed);
    // Let agentdb's compact filter handle: +tag, -tag, field:value, field.modifier:value,
    // bare text ($text), boolean ops (and/or), parentheses, virtual tags (+OVERDUE etc)
    return parseCompactFilter(processed, "tags");
}
/**
 * Pre-process the filter string to resolve date values in modifier expressions.
 * Converts due.before:friday → due.before:2026-04-11T00:00:00Z
 * so that agentdb's $lt/$gt operators work with ISO date strings.
 */
function preprocessDateModifiers(filter) {
    // Match patterns like field.modifier:value where modifier is a date modifier
    return filter.replace(/(\w+)\.(before|after|by):(\S+)/gi, (match, field, modifier, value) => {
        if (!DATE_MODIFIERS.has(modifier.toLowerCase()))
            return match;
        try {
            const resolved = formatDate(resolveDate(value));
            return `${field}.${modifier}:${resolved}`;
        }
        catch {
            return match; // leave as-is if date resolution fails
        }
    });
}
