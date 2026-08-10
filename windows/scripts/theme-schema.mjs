// WorkBuddy Dream Skin — theme.json schema validation (Node >= 20, zero deps).
//
// A deliberately small JSON Schema subset validator tailored to
// `schemas/theme.schema.json`. It supports the keywords this project uses:
// type / required / properties / enum / minimum / maximum / pattern /
// minLength / maxLength / minItems / maxItems / items / additionalProperties.
// Unknown keywords are ignored (per JSON Schema semantics), so the validator
// never blocks on fields it does not understand.
//
// The full schema also lives as `schemas/theme.schema.json` so external tooling
// (editors, CI linters) can consume it; this module is the runtime copy used
// inside buildPayload() so a broken theme fails loudly at apply time.

export class ThemeSchemaError extends Error {
  constructor(errors) {
    super(`Invalid theme.json: ${errors.join("; ")}`);
    this.name = "ThemeSchemaError";
    this.errors = errors;
  }
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateAgainst(schema, value, path, errors) {
  if (schema == null || typeof schema !== "object") return;

  // type
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = types.some((t) => {
      switch (t) {
        case "string": return typeof value === "string";
        case "number": return typeof value === "number" && Number.isFinite(value);
        case "integer": return Number.isInteger(value);
        case "boolean": return typeof value === "boolean";
        case "object": return isPlainObject(value);
        case "array": return Array.isArray(value);
        case "null": return value === null;
        default: return true;
      }
    });
    if (!ok) errors.push(`${path}: expected type ${schema.type.join?.("|") ?? schema.type}, got ${Array.isArray(value) ? "array" : typeof value}`);
  }

  // enum
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => Object.is(e, value))) {
    errors.push(`${path}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`);
  }

  // numeric bounds
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: must be <= ${schema.maximum}`);
  }

  // string constraints
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: length must be >= ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: length must be <= ${schema.maxLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: must match ${schema.pattern}`);
  }

  // array constraints
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: must have >= ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: must have <= ${schema.maxItems} items`);
    if (isPlainObject(schema.items)) {
      for (let i = 0; i < value.length; i += 1) validateAgainst(schema.items, value[i], `${path}[${i}]`, errors);
    }
  }

  // object properties
  if (isPlainObject(value) && isPlainObject(schema.properties)) {
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (Object.hasOwn(value, key)) validateAgainst(sub, value[key], `${path}.${key}`, errors);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties, key)) errors.push(`${path}: unexpected property "${key}"`);
      }
    }
  }

  // required
  if (isPlainObject(value) && Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}: missing required property "${key}"`);
    }
  }
}

/**
 * Validate a parsed theme.json against the bundled schema.
 * @param {object} theme parsed theme.json
 * @param {object} [schema] schema to use (defaults to the bundled theme schema)
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateTheme(theme, schema = THEME_SCHEMA) {
  const errors = [];
  validateAgainst(schema, theme, "$", errors);
  return { valid: errors.length === 0, errors };
}

/** Throw ThemeSchemaError unless the theme is valid. Returns true otherwise. */
export function validateThemeJson(theme) {
  const { valid, errors } = validateTheme(theme);
  if (!valid) throw new ThemeSchemaError(errors);
  return true;
}

// Bundled copy of schemas/theme.schema.json (kept in sync by CI mirror checks).
const THEME_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/Guyzn/workbuddy-dream-skin/schemas/theme.schema.json",
  title: "WorkBuddy Dream Skin theme.json",
  description: "Schema for WorkBuddy Dream Skin theme.json files (bundled presets and installed themes).",
  type: "object",
  required: ["id", "name"],
  properties: {
    id: { type: "string", minLength: 1, pattern: "^[a-zA-Z0-9_-]+$" },
    name: { type: "string", minLength: 1 },
    brandSubtitle: { type: "string" },
    statusText: { type: "string" },
    quote: { type: "string" },
    appearance: { enum: ["auto", "light", "dark"] },
    artKey: { type: "string" },
    artMetadata: {
      type: "object",
      properties: {
        safeArea: { enum: ["left", "right", "center", "none"] },
        focusX: { type: "number", minimum: 0, maximum: 1 },
        focusY: { type: "number", minimum: 0, maximum: 1 },
        taskMode: { enum: ["ambient", "banner", "off", "auto"] },
        wide: { type: "boolean" },
        aspect: { type: "string" }
      }
    },
    art: {
      type: "object",
      properties: {
        file: { type: "string" },
        css: { type: "string" },
        gradient: { type: "string" },
        focusX: { type: "number", minimum: 0, maximum: 1 },
        focusY: { type: "number", minimum: 0, maximum: 1 },
        safeArea: { enum: ["left", "right", "center", "none", "auto"] },
        taskMode: { enum: ["ambient", "banner", "off", "auto"] }
      }
    },
    colors: {
      type: "object",
      properties: {
        accent: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        accentAlt: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        secondary: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        highlight: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" }
      }
    },
    explicitColorKeys: { type: "array", items: { type: "string" } },
    surfaceAlpha: { type: "number", minimum: 0, maximum: 1 },
    blur: { type: "number", minimum: 0, maximum: 64 },
    scrim: { type: "number", minimum: 0, maximum: 1 },
    homeScrim: { type: "number", minimum: 0, maximum: 1 },
    homeSelector: { type: "string" }
  },
  additionalProperties: true
};
