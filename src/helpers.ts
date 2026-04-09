export function parseTags(tags: string | undefined): string[] {
  if (!tags) return [];
  const trimmed = tags.trim();
  if (trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as string[];
    } catch {
      return [];
    }
  }
  return trimmed.split(",").map((t) => t.trim()).filter(Boolean);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function safe<T>(fn: (args: T) => Promise<any>): (args: T) => Promise<any> {
  return async (args: T) => {
    try {
      return await fn(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: message }], isError: true };
    }
  };
}
