import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ProjectRuleFile {
  name: string;
  path: string;
  content: string;
}

/**
 * Escanea y carga reglas locales del proyecto (.claude/rules, AGENTS.md, CLAUDE.md)
 */
export function loadProjectRules(cwd = process.cwd()): ProjectRuleFile[] {
  const rules: ProjectRuleFile[] = [];

  // 1. Cargar AGENTS.md en la raíz
  const agentsPath = join(cwd, "AGENTS.md");
  if (existsSync(agentsPath)) {
    try {
      rules.push({
        name: "AGENTS.md",
        path: agentsPath,
        content: readFileSync(agentsPath, "utf-8")
      });
    } catch {
      // Ignorar si no es legible
    }
  }

  // 2. Cargar CLAUDE.md en la raíz
  const claudePath = join(cwd, "CLAUDE.md");
  if (existsSync(claudePath)) {
    try {
      rules.push({
        name: "CLAUDE.md",
        path: claudePath,
        content: readFileSync(claudePath, "utf-8")
      });
    } catch {
      // Ignorar
    }
  }

  // 3. Cargar directorio .claude/rules/*.md
  const claudeRulesDir = join(cwd, ".claude", "rules");
  if (existsSync(claudeRulesDir)) {
    try {
      const files = readdirSync(claudeRulesDir);
      for (const f of files) {
        if (f.endsWith(".md") || f.endsWith(".txt")) {
          const filePath = join(claudeRulesDir, f);
          rules.push({
            name: `.claude/rules/${f}`,
            path: filePath,
            content: readFileSync(filePath, "utf-8")
          });
        }
      }
    } catch {
      // Ignorar
    }
  }

  return rules;
}
