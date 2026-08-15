#!/usr/bin/env node
/**
 * Finds internal error text reaching an HTTP error response body (CWE-209).
 *
 * WHY THIS EXISTS
 *
 * `errorMessage(err)` returns whatever the underlying library said. On these
 * routes that has meant Appwrite connection details, collection ids, jsonwebtoken
 * internals and SMTP hostnames. Putting it in a 4xx/5xx body hands that to the
 * caller. On an UNAUTHENTICATED route — the password-reset endpoints — the caller
 * is anyone who can reach the host, which turns a 500 into a reconnaissance
 * primitive. The cause belongs in the log, not the response.
 *
 * WHY AN AST WALK AND NOT A REGEX
 *
 * The obvious regex looks for `errorMessage(` on the same line as `.json(`. It
 * misses the shape that actually dominates this codebase:
 *
 *   } catch (err) {
 *     const message = errorMessage(err);          // the leak is created here
 *     logger.error('...', { ...errorContext(err) });
 *     res.status(500).json({ error: message });   // nothing here looks like an error
 *   }
 *
 * Nothing on the responding line names an error. A regex also cannot follow a
 * `.json({ … })` split across lines, and a `[^}]*` character class breaks on any
 * nested object in the payload. This is the same extracted-const trap that hid 15
 * logger sites behind a comment claiming that class was "already at zero".
 *
 * WHAT COUNTS AS A LEAK
 *
 * A `res.status(4xx|5xx).json(...)` / `.send(...)` whose payload contains, at any
 * depth, an expression that resolves to internal error text:
 *
 *   errorMessage(x) / toMessage(x)      a call to the shared reducer
 *   x.message                           property access on anything
 *   String(err)                         explicit stringify of a caught value
 *   an identifier bound to any of the above by a const/let in the same file
 *
 * The identifier pass is one level deep and file-scoped. It is deliberately not a
 * full dataflow analysis: it catches the extracted-const form, which is the shape
 * that hides, and reports nothing it cannot point at.
 *
 * WHAT IS NOT A LEAK
 *
 * A literal string, however unhelpful. `res.status(500).json({ error: 'failed' })`
 * is fine — this tool is about disclosure, not about message quality. A 2xx body
 * is also out of scope: this looks only at explicit 4xx/5xx statuses.
 *
 * USAGE
 *   node scripts/auditResponseErrorLeaks.js            summary
 *   node scripts/auditResponseErrorLeaks.js --list     every site
 *   node scripts/auditResponseErrorLeaks.js --max=N    ratchet: exit 1 above N
 *   node scripts/auditResponseErrorLeaks.js --min=N    floor:   exit 1 below N
 *
 * Ratchet, not cliff. Do not guess the baseline — run it, then commit the number
 * it prints. A baseline set from an unverified estimate is how the logger gate sat
 * at 177 while the real count was 156.
 *
 * WHY THERE IS A FLOOR AND NOT JUST A CEILING
 *
 * Unlike the logger gate next to it in ci.yml, zero is the WRONG answer here. The
 * surviving sites are two deliberate categories: 403/409 authorization and state
 * feedback about the caller's own access, and 4xx validation feedback about the
 * caller's own input. Both tell the caller something they are entitled to know and
 * that clients act on. A future contributor who runs this tool, reads "leaks", and
 * sweeps the remainder to zero would break real client behaviour while making a
 * security tool report success. --min makes that specific mistake fail CI.
 *
 * WHAT --min DOES NOT DO. It counts sites; it does not pin WHICH sites. Removing
 * one legitimate 403 message while introducing one new genuine leak leaves the
 * count unchanged and passes both bounds. It is a tripwire for the sweep-to-zero
 * failure mode, which is the realistic one, not a per-site contract.
 *
 * A drop below the floor is not automatically a bug — deleting a route legitimately
 * removes its 403. The floor's job is to make that a decision someone states, by
 * lowering the number in the same PR, rather than a silent side effect.
 */

const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '..');
const SRC = path.join(BACKEND, 'src');
const ts = require(path.join(BACKEND, 'node_modules', 'typescript'));

const args = process.argv.slice(2);
const wantList = args.includes('--list');
const maxArg = args.find((a) => a.startsWith('--max='));
const max = maxArg ? Number(maxArg.slice('--max='.length)) : null;
const minArg = args.find((a) => a.startsWith('--min='));
const min = minArg ? Number(minArg.slice('--min='.length)) : null;

const REDUCERS = new Set(['errorMessage', 'toMessage']);

/** Test files excluded: an assertion may legitimately reference a leaked shape. */
function sourceFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!/node_modules|dist|\.git/.test(p)) sourceFiles(p, out);
        } else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) {
            out.push(p);
        }
    }
    return out;
}

/** Does this expression resolve to internal error text? */
function isErrorText(node, tainted) {
    if (!node) return false;

    // errorMessage(err) / toMessage(err)
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && REDUCERS.has(node.expression.text)) {
        return true;
    }
    // String(err) — only when the argument is not a literal.
    if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'String' &&
        node.arguments.length === 1 &&
        !ts.isStringLiteral(node.arguments[0])
    ) {
        return true;
    }
    // x.message / x?.message
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'message') return true;
    // an identifier bound to any of the above
    if (ts.isIdentifier(node) && tainted.has(node.text)) return true;

    // `a || b`, `a ?? b`, `cond ? a : b` — leaking on either arm still leaks.
    if (ts.isBinaryExpression(node)) {
        return isErrorText(node.left, tainted) || isErrorText(node.right, tainted);
    }
    if (ts.isConditionalExpression(node)) {
        return isErrorText(node.whenTrue, tainted) || isErrorText(node.whenFalse, tainted);
    }
    if (ts.isParenthesizedExpression(node)) return isErrorText(node.expression, tainted);
    return false;
}

/** Walk a response payload to any depth, returning the first leaking property. */
function findLeak(payload, tainted) {
    if (isErrorText(payload, tainted)) return '<payload>';
    if (ts.isObjectLiteralExpression(payload)) {
        for (const prop of payload.properties) {
            if (ts.isPropertyAssignment(prop)) {
                if (isErrorText(prop.initializer, tainted)) {
                    return prop.name.getText();
                }
                if (ts.isObjectLiteralExpression(prop.initializer)) {
                    const nested = findLeak(prop.initializer, tainted);
                    if (nested) return `${prop.name.getText()}.${nested}`;
                }
            }
            // { message } shorthand where `message` is tainted
            if (ts.isShorthandPropertyAssignment(prop) && tainted.has(prop.name.text)) {
                return prop.name.text;
            }
        }
    }
    return null;
}

/**
 * res.status(500) — the status must be a numeric 4xx/5xx literal. A computed
 * status is not assumed to be an error: reporting it would be a guess.
 */
function errorStatusOf(node) {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null;
    if (node.expression.name.text !== 'status') return null;
    const arg = node.arguments[0];
    if (!arg || !ts.isNumericLiteral(arg)) return null;
    const code = Number(arg.text);
    return code >= 400 && code < 600 ? code : null;
}

const leaks = [];

for (const file of sourceFiles(SRC)) {
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ES2016, true);
    const rel = path.relative(BACKEND, file).replace(/\\/g, '/');
    const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;

    // File-scoped taint set: identifiers initialised from error text anywhere in
    // the file. Coarser than per-scope tracking, and deliberately so — a name
    // reused for two different things is a readability problem the reviewer can
    // see, whereas a missed site is one nobody sees.
    const tainted = new Set();
    (function collect(node) {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            if (isErrorText(node.initializer, tainted)) tainted.add(node.name.text);
        }
        ts.forEachChild(node, collect);
    })(sf);
    // Second pass: a const initialised from an already-tainted const.
    (function collectAgain(node) {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            if (isErrorText(node.initializer, tainted)) tainted.add(node.name.text);
        }
        ts.forEachChild(node, collectAgain);
    })(sf);

    (function visit(node) {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
            const method = node.expression.name.text;
            if ((method === 'json' || method === 'send') && node.arguments.length === 1) {
                const status = errorStatusOf(node.expression.expression);
                if (status !== null) {
                    const where = findLeak(node.arguments[0], tainted);
                    if (where) {
                        leaks.push({
                            file: rel,
                            line: lineOf(node),
                            status,
                            key: where,
                            snippet: node.arguments[0].getText().replace(/\s+/g, ' ').slice(0, 70),
                        });
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    })(sf);
}

const byFile = {};
leaks.forEach((l) => { byFile[l.file] = (byFile[l.file] || 0) + 1; });

console.log(`internal error text in 4xx/5xx response bodies: ${leaks.length} across ${Object.keys(byFile).length} files`);

if (wantList) {
    console.log('');
    for (const l of leaks.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
        console.log(`${l.file}:${l.line} [${l.status}] ${l.key} <- ${l.snippet}`);
    }
} else {
    console.log('');
    Object.entries(byFile).sort((a, b) => b[1] - a[1]).forEach(([f, n]) => {
        console.log(`${String(n).padStart(3)}  ${f}`);
    });
}

if (Number.isNaN(max) || Number.isNaN(min)) {
    console.error('--max and --min require a number');
    process.exit(2);
}

if (max !== null && leaks.length > max) {
    console.error(`\nFAIL: ${leaks.length} sites exceeds the baseline of ${max}.`);
    process.exit(1);
}

// Below the floor, so something that was deliberately kept has gone. See the
// header: the remaining sites are authorization and validation feedback the
// caller is entitled to, not leaks. Confirm the removal was intended and lower
// --min in the same PR, or restore the message.
if (min !== null && leaks.length < min) {
    console.error(`\nFAIL: ${leaks.length} sites is below the floor of ${min}.`);
    console.error('A site that was deliberately kept has been removed. These are 403/409');
    console.error('authorization and 4xx validation messages the caller is entitled to —');
    console.error('run with --list, confirm the removal was intended, and lower --min in');
    console.error('the same PR. Do not sweep this count to zero.');
    process.exit(1);
}

if (max !== null || min !== null) {
    const bounds = [min !== null ? `floor ${min}` : null, max !== null ? `baseline ${max}` : null]
        .filter(Boolean).join(' / ');
    console.log(`\nOK: ${leaks.length} sites, within ${bounds}.`);
}
