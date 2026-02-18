/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ==========================================================================
    // 3-Layer Architecture Rules
    // ==========================================================================
    // Architecture: extension.ts orchestrates server/, state/, display/
    //
    // Allowed dependencies:
    //   - extension.ts → server/, state/, display/ (orchestrator)
    //   - display/ → state/, server/ (providers need indexing + server)
    //   - state/ → server/ (indexing needs server for parsing)
    //   - Any layer → constants/ (shared constants)
    //
    // Forbidden dependencies:
    //   - server/ → state/, display/ (server layer is independent)
    //   - state/ → display/ (state should not know about VS Code providers)
    // ==========================================================================

    {
      name: "server-cannot-import-state",
      comment: "Server layer must not depend on state layer",
      severity: "error",
      from: { path: "^src/server/" },
      to: { path: "^src/state/" },
    },
    {
      name: "server-cannot-import-display",
      comment: "Server layer must not depend on display layer",
      severity: "error",
      from: { path: "^src/server/" },
      to: { path: "^src/display/" },
    },
    {
      name: "state-cannot-import-display",
      comment:
        "State layer must not depend on display layer. " +
        "If you need shared types, move them to state/types.ts.",
      severity: "error",
      from: { path: "^src/state/" },
      to: { path: "^src/display/" },
    },

    // ==========================================================================
    // General Best Practices
    // ==========================================================================

    {
      name: "no-circular",
      comment: "No circular dependencies allowed",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      comment:
        "Files that are not reachable from the entry points. " +
        "Consider removing or connecting them.",
      severity: "warn",
      from: {
        orphan: true,
        pathNot: ["\\.test\\.ts$", "\\.d\\.ts$", "__tests__/", "__mocks__/"],
      },
      to: {},
    },
    {
      name: "not-to-unresolvable",
      comment: "Don't import modules that cannot be resolved",
      severity: "error",
      from: {},
      to: {
        couldNotResolve: true,
        pathNot: ["^vscode$"],
      },
    },
    {
      name: "not-to-dev-dep",
      comment: "Don't import devDependencies from production code",
      severity: "error",
      from: {
        path: "^src/",
        pathNot: ["\\.test\\.ts$", "__tests__/", "__mocks__/", "src/test/"],
      },
      to: {
        dependencyTypes: ["npm-dev"],
        // vscode is a virtual module provided at runtime, but resolves to @types/vscode in devDeps
        pathNot: ["@types/vscode"],
      },
    },
  ],
  options: {
    doNotFollow: {
      path: ["node_modules"],
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      mainFields: ["main", "types", "typings"],
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
    exclude: ["__tests__/", "__mocks__/"],
  },
};
