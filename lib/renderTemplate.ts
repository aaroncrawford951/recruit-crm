type Vars = Record<string, string | null | undefined>;

function normKey(k: string) {
  return k.trim().toLowerCase().replace(/\s+/g, "_");
}

export function renderTemplate(template: string, vars: Vars) {
  if (!template) return "";

  // Build a normalized map so {{FirstName}}, {{ first_name }}, {{first name}} all work
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(vars || {})) {
    map.set(normKey(k), (v ?? "").toString());
  }

  return template.replace(/{{\s*([^}]+)\s*}}/g, (_match, rawKey) => {
    const key = normKey(String(rawKey));
    // If we don't have it, leave empty (or return the original token if you prefer)
    return map.get(key) ?? "";
  });
}
