import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".github",
  "node_modules",
  "tests",
  "__tests__",
  ".credential-tests",
  ".backup-tests",
  "dist",
  "build",
]);
const CONSOLE_METHODS = new Set(["log", "warn", "error", "info", "debug", "trace"]);

function isTestFile(file) {
  const base = path.basename(file);
  return /(?:^|\.)(?:test|spec)\.[cm]?[jt]sx?$/.test(base);
}

function collectFiles(root, output = []) {
  if (!fs.existsSync(root)) return output;
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    if (SOURCE_EXTENSIONS.has(path.extname(root)) && !isTestFile(root)) output.push(root);
    return output;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    collectFiles(path.join(root, entry.name), output);
  }
  return output;
}

function isDevIdentifier(node) {
  return ts.isIdentifier(node) && node.text === "__DEV__";
}

function isPositiveDevCondition(node) {
  if (isDevIdentifier(node)) return true;
  if (ts.isParenthesizedExpression(node)) return isPositiveDevCondition(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return isPositiveDevCondition(node.left);
  }
  return false;
}

function isNegativeDevCondition(node) {
  if (ts.isParenthesizedExpression(node)) return isNegativeDevCondition(node.expression);
  return ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.ExclamationToken &&
    isDevIdentifier(node.operand);
}

function nodeIsWithin(node, container) {
  return node.pos >= container.pos && node.end <= container.end;
}

function isDevOnly(node) {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isIfStatement(parent)) {
      if (nodeIsWithin(node, parent.thenStatement) && isPositiveDevCondition(parent.expression)) return true;
      if (parent.elseStatement && nodeIsWithin(node, parent.elseStatement) && isNegativeDevCondition(parent.expression)) return true;
    }
    if (ts.isConditionalExpression(parent)) {
      if (nodeIsWithin(node, parent.whenTrue) && isPositiveDevCondition(parent.condition)) return true;
      if (nodeIsWithin(node, parent.whenFalse) && isNegativeDevCondition(parent.condition)) return true;
    }
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      nodeIsWithin(node, parent.right) &&
      isPositiveDevCondition(parent.left)
    ) {
      return true;
    }
    current = parent;
  }
  return false;
}

function directConsoleMethod(call) {
  const expression = call.expression;
  if (!ts.isPropertyAccessExpression(expression)) return null;
  if (!CONSOLE_METHODS.has(expression.name.text)) return null;
  if (ts.isIdentifier(expression.expression) && expression.expression.text === "console") {
    return expression.name.text;
  }
  if (
    ts.isPropertyAccessExpression(expression.expression) &&
    ts.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === "globalThis" &&
    expression.expression.name.text === "console"
  ) {
    return expression.name.text;
  }
  return null;
}

export function findConsoleViolations(sourceText, fileName = "fixture.ts") {
  const kind = fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, kind);
  const violations = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const method = directConsoleMethod(node);
      if (method && !isDevOnly(node)) {
        const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
        violations.push({ method, line: line + 1, column: character + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

function selfTest() {
  const fixture = `
console.log("reject");
if (__DEV__) { console.warn("allowed"); }
if (!__DEV__) { doWork(); } else { console.error("allowed"); }
__DEV__ && console.info("allowed");
`;
  const violations = findConsoleViolations(fixture, "fixture.ts");
  if (violations.length !== 1 || violations[0].method !== "log") {
    process.stderr.write(`console guard self-test failed: ${JSON.stringify(violations)}\n`);
    process.exit(1);
  }
  process.stdout.write("console guard self-test: pass\n");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const roots = ["artifacts/legendstream-xplayer", "artifacts/api-server", "lib", "scripts"];
const files = roots.flatMap((root) => collectFiles(root));
const violations = [];
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  for (const violation of findConsoleViolations(source, file)) {
    violations.push({ file, ...violation });
  }
}

if (violations.length) {
  process.stderr.write("Direct console.* calls are forbidden outside tests and __DEV__ guards. Use the redacting logger instead.\n");
  for (const violation of violations) {
    process.stderr.write(`${violation.file}:${violation.line}:${violation.column} console.${violation.method}\n`);
  }
  process.exit(1);
}

process.stdout.write(`console guard: pass (${files.length} source files scanned)\n`);
