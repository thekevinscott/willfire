import tseslint from 'typescript-eslint';

// Custom rule (issue #72): one multi-line function per source file. Only
// direct module-scope declarations count -- FunctionDeclaration at Program
// level (plain, export-wrapped, or export-default) and module-scope
// `const`/`let` declarators initialized with a function or arrow expression.
// Functions whose span is a single line are exempt, so trivial helpers can
// share a file. Nested functions and callback arguments never count.
const oneFunctionPerFile = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Allow at most one multi-line module-scope function per file.',
    },
    schema: [],
    messages: {
      extraFunction:
        "One multi-line function per file: move '{{name}}' to its own file ('{{first}}' already lives here).",
    },
  },
  create(context) {
    let firstName = null;

    const record = (reportNode, name, fnNode) => {
      if (fnNode.loc.end.line <= fnNode.loc.start.line) {
        return;
      }
      if (firstName === null) {
        firstName = name;
        return;
      }
      context.report({
        node: reportNode,
        messageId: 'extraFunction',
        data: { name, first: firstName },
      });
    };

    const functionDeclaration = (node) => {
      const name = node.id === null ? 'default' : node.id.name;
      record(node.id === null ? node : node.id, name, node);
    };

    const variableDeclarator = (node) => {
      if (node.init === null) {
        return;
      }
      if (node.init.type !== 'ArrowFunctionExpression' && node.init.type !== 'FunctionExpression') {
        return;
      }
      if (node.parent.kind !== 'const' && node.parent.kind !== 'let') {
        return;
      }
      const name = node.id.type === 'Identifier' ? node.id.name : 'function';
      record(node.id, name, node.init);
    };

    // Selectors anchored at Program keep nested functions and callback
    // arguments out by construction.
    return {
      'Program > FunctionDeclaration': functionDeclaration,
      'Program > ExportNamedDeclaration > FunctionDeclaration': functionDeclaration,
      'Program > ExportDefaultDeclaration > FunctionDeclaration': functionDeclaration,
      'Program > VariableDeclaration > VariableDeclarator': variableDeclarator,
      'Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator': variableDeclarator,
    };
  },
};

export default [
  {
    ignores: ['dist/', 'coverage/'],
  },
  // Stock rules for all of src, tests included.
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      'no-continue': 'error',
      semi: ['error', 'always'],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['src/**/*.ts'],
    // Test files keep their module-scope helpers; the one-function principle
    // is about source decomposition. The rest is the burn-down list: files
    // that predate the rule; remove each entry as #14 decomposes its file.
    ignores: [
      'src/**/*.test.ts',
      'src/cli/parseArgs.ts',
      'src/execute.ts',
      'src/jobs/expandJobs.ts',
      'src/matrix/expandMatrixDetailed.ts',
      'src/predict/finalizePrediction.ts',
      'src/verify.ts',
    ],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      local: {
        rules: {
          'one-function-per-file': oneFunctionPerFile,
        },
      },
    },
    rules: {
      'local/one-function-per-file': 'error',
    },
  },
];
