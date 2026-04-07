import { resolveDate, isOverdue, isDueToday, isDueThisWeek, isDueThisMonth, isDueThisQuarter, isDueThisYear } from "./dates.js";
export function compileFilter(filter, taskGetter) {
    const trimmed = filter.trim();
    if (!trimmed)
        return () => true;
    const tokens = tokenize(trimmed);
    return buildPredicate(tokens, taskGetter);
}
function tokenize(input) {
    const tokens = [];
    const parts = splitRespectingParens(input);
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed)
            continue;
        if (trimmed === "(") {
            tokens.push({ type: "lparen" });
            continue;
        }
        if (trimmed === ")") {
            tokens.push({ type: "rparen" });
            continue;
        }
        if (trimmed.toLowerCase() === "and") {
            tokens.push({ type: "and" });
            continue;
        }
        if (trimmed.toLowerCase() === "or") {
            tokens.push({ type: "or" });
            continue;
        }
        // Tag: +tag or -tag
        if (/^[+-]\w/.test(trimmed)) {
            const positive = trimmed[0] === "+";
            const name = trimmed.substring(1);
            if (name === name.toUpperCase() && name.length > 1) {
                tokens.push({ type: "vtag", name, positive });
            }
            else {
                tokens.push({ type: "tag", name, positive });
            }
            continue;
        }
        // Bare numeric ID (e.g., "1", "42")
        if (/^\d+$/.test(trimmed)) {
            tokens.push({ type: "attr", name: "id", modifier: "is", value: trimmed });
            continue;
        }
        // UUID (e.g., "abc123-...")
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
            tokens.push({ type: "attr", name: "uuid", modifier: "is", value: trimmed });
            continue;
        }
        // Attribute: name.modifier:value or name:value
        const attrMatch = trimmed.match(/^(\w+)(?:\.(\w+))?:(.*)$/);
        if (attrMatch) {
            tokens.push({
                type: "attr",
                name: attrMatch[1],
                modifier: attrMatch[2] || "is",
                value: attrMatch[3],
            });
            continue;
        }
        // Bare text — search in description
        tokens.push({ type: "text", raw: trimmed });
    }
    return tokens;
}
function splitRespectingParens(input) {
    const parts = [];
    let current = "";
    for (const char of input) {
        if (char === "(" || char === ")") {
            if (current.trim())
                parts.push(current.trim());
            parts.push(char);
            current = "";
        }
        else if (char === " " || char === "\t") {
            if (current.trim())
                parts.push(current.trim());
            current = "";
        }
        else {
            current += char;
        }
    }
    if (current.trim())
        parts.push(current.trim());
    return parts;
}
function buildPredicate(tokens, taskGetter) {
    if (tokens.length === 0)
        return () => true;
    // Parse with OR having lowest precedence
    const { predicate, rest } = parseOr(tokens, 0, taskGetter);
    if (rest < tokens.length) {
        // Remaining tokens — combine with AND
        const remaining = buildPredicate(tokens.slice(rest), taskGetter);
        return (t) => predicate(t) && remaining(t);
    }
    return predicate;
}
function parseOr(tokens, pos, taskGetter) {
    let { predicate: left, rest: nextPos } = parseAnd(tokens, pos, taskGetter);
    while (nextPos < tokens.length && tokens[nextPos].type === "or") {
        const { predicate: right, rest: afterRight } = parseAnd(tokens, nextPos + 1, taskGetter);
        const prevLeft = left;
        left = (t) => prevLeft(t) || right(t);
        nextPos = afterRight;
    }
    return { predicate: left, rest: nextPos };
}
function parseAnd(tokens, pos, taskGetter) {
    let { predicate: left, rest: nextPos } = parsePrimary(tokens, pos, taskGetter);
    while (nextPos < tokens.length) {
        const tok = tokens[nextPos];
        if (tok.type === "or" || tok.type === "rparen")
            break;
        if (tok.type === "and") {
            const { predicate: right, rest: afterRight } = parsePrimary(tokens, nextPos + 1, taskGetter);
            const prevLeft = left;
            left = (t) => prevLeft(t) && right(t);
            nextPos = afterRight;
        }
        else {
            // Implicit AND
            const { predicate: right, rest: afterRight } = parsePrimary(tokens, nextPos, taskGetter);
            const prevLeft = left;
            left = (t) => prevLeft(t) && right(t);
            nextPos = afterRight;
        }
    }
    return { predicate: left, rest: nextPos };
}
function parsePrimary(tokens, pos, taskGetter) {
    if (pos >= tokens.length)
        return { predicate: () => true, rest: pos };
    const tok = tokens[pos];
    if (tok.type === "lparen") {
        const { predicate, rest } = parseOr(tokens, pos + 1, taskGetter);
        // Skip rparen
        const afterParen = rest < tokens.length && tokens[rest].type === "rparen" ? rest + 1 : rest;
        return { predicate, rest: afterParen };
    }
    return { predicate: tokenToPredicate(tok, taskGetter), rest: pos + 1 };
}
function tokenToPredicate(token, taskGetter) {
    switch (token.type) {
        case "tag": return tagPredicate(token.name, token.positive);
        case "vtag": return virtualTagPredicate(token.name, token.positive, taskGetter);
        case "attr": return attrPredicate(token.name, token.modifier, token.value);
        case "text": return textPredicate(token.raw);
        default: return () => true;
    }
}
function tagPredicate(name, positive) {
    return (t) => {
        const has = t.tags?.includes(name) ?? false;
        return positive ? has : !has;
    };
}
function virtualTagPredicate(name, positive, taskGetter) {
    const check = virtualTagCheck(name, taskGetter);
    return (t) => positive ? check(t) : !check(t);
}
function virtualTagCheck(name, taskGetter) {
    switch (name) {
        case "PENDING": return (t) => t.status === "pending";
        case "COMPLETED": return (t) => t.status === "completed";
        case "DELETED": return (t) => t.status === "deleted";
        case "WAITING": return (t) => t.status === "pending" && !!t.wait && new Date(t.wait) > new Date();
        case "RECURRING": return (t) => t.status === "recurring";
        case "ACTIVE": return (t) => !!t.start;
        case "BLOCKED": return (t) => blockedCheck(t, taskGetter);
        case "BLOCKING": return (t) => !!t._blocking;
        case "UNBLOCKED": return (t) => !blockedCheck(t, taskGetter);
        case "READY": return (t) => t.status === "pending" && !blockedCheck(t, taskGetter) && (!t.scheduled || new Date(t.scheduled) <= new Date());
        case "OVERDUE": return (t) => !!t.due && isOverdue(t.due);
        case "TODAY": return (t) => !!t.due && isDueToday(t.due);
        case "TOMORROW": return (t) => {
            if (!t.due)
                return false;
            const d = new Date(t.due);
            const tom = new Date();
            tom.setDate(tom.getDate() + 1);
            return d.getFullYear() === tom.getFullYear() && d.getMonth() === tom.getMonth() && d.getDate() === tom.getDate();
        };
        case "YESTERDAY": return (t) => {
            if (!t.due)
                return false;
            const d = new Date(t.due);
            const yes = new Date();
            yes.setDate(yes.getDate() - 1);
            return d.getFullYear() === yes.getFullYear() && d.getMonth() === yes.getMonth() && d.getDate() === yes.getDate();
        };
        case "WEEK": return (t) => !!t.due && isDueThisWeek(t.due);
        case "MONTH": return (t) => !!t.due && isDueThisMonth(t.due);
        case "QUARTER": return (t) => !!t.due && isDueThisQuarter(t.due);
        case "YEAR": return (t) => !!t.due && isDueThisYear(t.due);
        case "DUE": return (t) => !!t.due;
        case "SCHEDULED": return (t) => !!t.scheduled;
        case "TAGGED": return (t) => !!t.tags && t.tags.length > 0;
        case "ANNOTATED": return (t) => !!t.annotations && t.annotations.length > 0;
        case "PROJECT": return (t) => !!t.project;
        case "PRIORITY": return (t) => !!t.priority;
        case "UDA": return (t) => !!t.agent || !!t.has_doc;
        default: return () => false;
    }
}
function blockedCheck(t, taskGetter) {
    if (!t.depends || t.depends.length === 0)
        return false;
    if (!taskGetter) {
        // Without task lookup, fall back to checking if deps exist
        return true;
    }
    return t.depends.some((uuid) => {
        const dep = taskGetter(uuid);
        // Blocked if dep not found (could be external) or dep is still pending/waiting/recurring
        return !dep || (dep.status !== "completed" && dep.status !== "deleted");
    });
}
function attrPredicate(name, modifier, value) {
    return (t) => {
        // Numeric ID comparison
        if (name === "id") {
            return t.id === parseInt(value, 10);
        }
        const taskValue = getTaskAttr(t, name);
        // Date-based attributes
        if (isDateAttr(name) && value) {
            const taskDate = taskValue ? new Date(taskValue) : null;
            if (!taskDate)
                return modifier === "none";
            const targetDate = resolveDate(value);
            switch (modifier) {
                case "before":
                case "under":
                case "below":
                    return taskDate < targetDate;
                case "after":
                case "over":
                case "above":
                    return taskDate > targetDate;
                case "by":
                    return taskDate <= targetDate;
                default:
                    return sameDay(taskDate, targetDate);
            }
        }
        // none/any modifiers
        if (modifier === "none")
            return taskValue === undefined || taskValue === null || taskValue === "";
        if (modifier === "any")
            return taskValue !== undefined && taskValue !== null && taskValue !== "";
        const strValue = String(taskValue ?? "");
        const target = value;
        switch (modifier) {
            case "is":
            case "equals":
                return strValue.toLowerCase() === target.toLowerCase();
            case "isnt":
            case "not":
                return strValue.toLowerCase() !== target.toLowerCase();
            case "has":
            case "contains":
                return strValue.toLowerCase().includes(target.toLowerCase());
            case "hasnt":
                return !strValue.toLowerCase().includes(target.toLowerCase());
            case "startswith":
            case "left":
                return strValue.toLowerCase().startsWith(target.toLowerCase());
            case "endswith":
            case "right":
                return strValue.toLowerCase().endsWith(target.toLowerCase());
            default:
                return strValue.toLowerCase() === target.toLowerCase();
        }
    };
}
function textPredicate(text) {
    const lower = text.toLowerCase();
    return (t) => {
        if (t.description.toLowerCase().includes(lower))
            return true;
        if (t.annotations?.some((a) => a.description.toLowerCase().includes(lower)))
            return true;
        return false;
    };
}
function getTaskAttr(t, name) {
    const key = name;
    return t[key];
}
function isDateAttr(name) {
    return ["due", "entry", "modified", "end", "start", "wait", "scheduled", "until"].includes(name);
}
function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
}
