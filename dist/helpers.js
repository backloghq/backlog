export function parseTags(tags) {
    if (!tags)
        return [];
    const trimmed = tags.trim();
    if (trimmed.startsWith("[")) {
        try {
            return JSON.parse(trimmed);
        }
        catch {
            return [];
        }
    }
    return trimmed.split(",").map((t) => t.trim()).filter(Boolean);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function safe(fn) {
    return async (args) => {
        try {
            return await fn(args);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text", text: message }], isError: true };
        }
    };
}
