#!/usr/bin/env node
// Validates template.json exactly the way create-scaffold-hbar 0.4.0 parses it,
// then checks that the manifest agrees with the packages/ in this repository.
//
// Why a separate check: the CLI reads template.json from GitHub before scaffolding
// and silently falls back to permissive defaults on any parse error
// (src/utils/template-capabilities.ts, `catch { return null }`), so a broken
// manifest does not fail a scaffold — it quietly changes what users get.
//
// The schema below is copied from create-scaffold-hbar 0.4.0, src/types.ts
// (https://github.com/hedera-dev/create-scaffold-hbar, tag v0.4.0, commit 5732f5e).
// create-scaffold-hbar is MIT licensed. Keep this copy in sync when the CLI's
// schema changes; the CLI version it mirrors is printed on every run.
//
// Usage: node tools/gate/validate-template-json.mjs [path/to/template.json]
// Packages are looked up next to the manifest (packages/<framework>/package.json).
// Exit codes: 0 valid, 1 invalid or unreadable.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const MIRRORED_CLI_VERSION = "0.4.0";

// ---- begin copy of create-scaffold-hbar 0.4.0 src/types.ts (comments trimmed) ----
const EnvVarSchema = z.object({
  key: z.string().min(1),
  description: z.string(),
});

const RenameEntrySchema = z.object({
  to: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
});

const TemplateCapabilitiesSchema = z.object({
  frontend: z.array(z.enum(["nextjs-app", "none"])).optional(),
  solidityFramework: z.array(z.enum(["hardhat", "foundry", "none"])).optional(),
  packageManager: z.array(z.enum(["yarn", "npm", "none"])).optional(),
});

const TemplateDefaultsSchema = z.object({
  frontend: z.enum(["nextjs-app", "none"]).optional(),
  solidityFramework: z.enum(["hardhat", "foundry", "none"]).optional(),
  packageManager: z.enum(["yarn", "npm", "none"]).optional(),
});

const TemplateOutroStepSchema = z
  .object({
    label: z.string().min(1).optional(),
    command: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
  })
  .refine(
    step => step.label !== undefined || step.command !== undefined || step.url !== undefined || step.text !== undefined,
    { message: "Each outro step must include at least one of 'label', 'command', 'url', or 'text'." },
  );

const TemplateOutroSectionSchema = z.object({
  title: z.string().min(1).optional(),
  steps: z.array(TemplateOutroStepSchema).min(1),
});

const TemplateOutroSchema = z
  .object({
    sections: z.array(TemplateOutroSectionSchema).min(1).optional(),
    steps: z.array(z.string().min(1)).min(1).optional(),
    installCommand: z.string().min(1).optional(),
  })
  .refine(outro => outro.sections !== undefined || outro.steps !== undefined || outro.installCommand !== undefined, {
    message: "Template outro must define at least one of 'sections', 'steps', or 'installCommand'.",
  });

const TemplateManifestBlockSchema = z.object({
  rename: z.record(z.string(), RenameEntrySchema).optional(),
  instructions: z.array(z.string()).optional(),
  requirements: z.record(z.string(), z.string()).optional(),
  envVars: z.array(EnvVarSchema).optional(),
  capabilities: TemplateCapabilitiesSchema.optional(),
  defaults: TemplateDefaultsSchema.optional(),
  outro: TemplateOutroSchema.optional(),
});

function normalizeTemplateManifestRaw(raw) {
  if (!raw || typeof raw !== "object") return raw;
  const o = { ...raw };
  if ("create-hbar" in o) {
    if (!("create-scaffold-hbar" in o)) {
      o["create-scaffold-hbar"] = o["create-hbar"];
    }
    delete o["create-hbar"];
  }
  return o;
}

const TemplateManifestSchema = z.preprocess(
  normalizeTemplateManifestRaw,
  z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    version: z.string().optional(),
    "create-scaffold-hbar": TemplateManifestBlockSchema.optional(),
  }),
);
// ---- end copy ----

/**
 * Checks the CLI does not enforce, but that break a scaffold when they drift:
 * defaults must be allowed by capabilities, and every declared framework must
 * exist as a package next to the manifest.
 */
export function consistencyProblems(manifest, repoRoot) {
  const problems = [];
  const block = manifest["create-scaffold-hbar"];
  if (!block?.capabilities) {
    problems.push(
      "create-scaffold-hbar.capabilities is missing: the CLI would offer every framework and package manager.",
    );
    return problems;
  }
  const { capabilities, defaults = {} } = block;
  for (const key of ["frontend", "solidityFramework", "packageManager"]) {
    const allowed = capabilities[key];
    if (!allowed || allowed.length === 0) {
      problems.push(`capabilities.${key} is missing or empty.`);
      continue;
    }
    if (defaults[key] !== undefined && !allowed.includes(defaults[key])) {
      problems.push(`defaults.${key} "${defaults[key]}" is not in capabilities.${key} [${allowed.join(", ")}].`);
    }
  }
  const declaredPackages = [
    ...(capabilities.solidityFramework ?? []).filter(fw => fw !== "none").map(fw => `packages/${fw}`),
    ...((capabilities.frontend ?? []).includes("nextjs-app") ? ["packages/nextjs"] : []),
  ];
  for (const dir of declaredPackages) {
    if (!fs.existsSync(path.join(repoRoot, dir, "package.json"))) {
      problems.push(`template.json declares ${dir}, but ${dir}/package.json does not exist.`);
    }
  }
  return problems;
}

/** Returns { ok, messages } for the manifest at `file`. */
export function validateTemplateJson(file) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    const hint =
      error?.code === "ENOENT"
        ? " (template.json lives only in the template repository; create-scaffold-hbar deletes it from scaffolded projects)"
        : "";
    return { ok: false, messages: [`cannot read ${file}: ${error.message}${hint}`] };
  }
  const parsed = TemplateManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      messages: parsed.error.issues.map(issue => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    };
  }
  const problems = consistencyProblems(parsed.data, path.dirname(path.resolve(file)));
  return { ok: problems.length === 0, messages: problems };
}

function main(file = "template.json") {
  const { ok, messages } = validateTemplateJson(file);
  const label = `${file} (schema of create-scaffold-hbar ${MIRRORED_CLI_VERSION})`;
  if (ok) {
    console.log(`PASS ${label}`);
    return 0;
  }
  console.error(`FAIL ${label}`);
  for (const message of messages) console.error(`  - ${message}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv[2]);
}
