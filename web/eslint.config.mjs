import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output and vendored bundles — not ours to lint. `public/` holds
    // third-party minified workers (pdf.worker.min.mjs alone accounted for
    // ~1600 findings, including every "error" in the tree), which would drown
    // the signal and make an errors-must-be-zero CI gate impossible.
    "dist/**",
    "release/**",
    "temp/**",
    "public/**",
    "**/*.min.js",
    "**/*.min.mjs",
  ]),
  {
    // The codebase already marks intentionally-unused bindings with a leading
    // underscore (required params it must keep for a signature, ignored
    // destructured entries, etc.). eslint-config-next enables the rule with no
    // options, so honour that convention explicitly. Severity stays "warn".
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // Plain .js/.cjs files in this tree are Electron main-process CommonJS
    // modules (e.g. src/lib/code-workspace/pty-manager.js, loaded by
    // main-web.js with require). ESM `import` is not available there, so
    // require() is the correct form rather than something to migrate.
    files: ["**/*.js", "**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
