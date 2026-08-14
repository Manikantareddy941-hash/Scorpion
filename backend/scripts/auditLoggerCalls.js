#!/usr/bin/env node
/**
 * Finds logger calls that pass a second positional argument winston will discard.
 *
 * WHY THIS EXISTS
 *
 * services/logger.ts composes winston.format.json() (and prettyPrint() outside
 * production) WITHOUT winston.format.splat(). A second positional STRING argument
 * is therefore held on a Symbol key and never serialised:
 *
 *     logger.error('[X] failed:', err.message)
 *     -> {"level":"error","message":"[X] failed:"}
 *
 * The reason is gone. The call site looks correct, the test asserting the
 * argument was "passed to" the logger passes, and the log line says nothing.
 * Adding format.splat() does NOT fix this — with no %s placeholder winston
 * Object.assigns the string into meta and it spreads one key per character:
 *
 *     {"0":"t","1":"h","2":"e",...}
 *
 * So the fix is per-site: pass an object, normally `errorContext(err)`.
 *
 * WHY AN AST WALK AND NOT A REGEX
 *
 * A line-based scan cannot see a call split across lines, and there are such
 * calls in this repo. It also cannot tell `errorContext(err)` (correct) from
 * `err` (wrong), because both are "a second argument that isn't an object
 * literal" on the line. Both mistakes push the count in the wrong direction:
 * the first understates the work, the second reports finished work as pending.
 *
 * A SITE IS ACCEPTABLE WHEN arguments[1] IS:
 *   - an object literal            logger.error('msg', { event: 'x', ...errorContext(err) })
 *   - a call to errorContext(...)  logger.error('msg', errorContext(err))
 * Anything else is reported, including a bare `err`.
 *
 * WHAT A BARE `err` ACTUALLY DOES — measured against this repo's winston 3.19,
 * because an earlier version of this comment claimed it was dropped and it is not:
 *
 *     logger.error('msg', new Error('BOOM'))
 *     -> {"message":"msg BOOM","stack":"Error: BOOM\n    at ..."}
 *
 * winston special-cases an Error INSTANCE: the message is appended and `stack` is
 * lifted. So a bare `err` holding an Error loses nothing today, and the count this
 * tool prints is NOT a count of sites losing their cause. Two report as offending
 * for different reasons, and only one of them is data loss:
 *
 *   err.message / toMessage(err)  string  -> DROPPED. Real loss.
 *   err                           Error   -> survives, but unindexed. Style.
 *   err                           string  -> DROPPED. Real loss, same as the first.
 *
 * This is therefore a CANONICAL-FORM RATCHET, not a data-loss counter. The reason
 * to convert a surviving bare `err` is that winston flattens it into the `message`
 * text, so Loki gets no queryable `error` field and no `event` key to index on —
 * `{ ...errorContext(err) }` is what makes a failure findable rather than readable.
 *
 * One thing the old comment had right: do NOT "fix" a bare Error by spreading it.
 * `{ ...err }` yields `{}`, because message and stack are non-enumerable.
 *
 * USAGE
 *   node scripts/auditLoggerCalls.js            summary
 *   node scripts/auditLoggerCalls.js --list     every offending site
 *   node scripts/auditLoggerCalls.js --max=0    exit 1 above the baseline
 *
 * --max let CI hold the line while the conversion landed incrementally. The
 * conversion is finished and CI now runs --max=0, so this is a regression guard
 * rather than a ratchet. A new offending site is a new site, not a higher
 * baseline: convert the call, do not raise the number.
 *
 * SCOPE, so the number is not misread: isAcceptable() treats a bare
 * `errorContext(err)` call and an object literal as equally acceptable. The
 * separate migration adding `event:` keys therefore moves sites from one
 * acceptable form to another and does not move this count at all. 186 -> 177 was
 * the bare-`err` sweep in #216; 177 -> 174 is the three bare-`error` sites in
 * authRoutes, converted alongside slice 6; 174 -> 156 is the 18 string-argument
 * sites fixed in #226. Slices 1-5 moved it by zero, exactly as expected.
 * Measuring event-key coverage would mean requiring an object
 * literal that CONTAINS an `event` property — a different and much larger
 * baseline, and a separate script rather than a change to this one.
 *
 * CORRECTION. This block used to claim the string-argument sites — the ones that
 * genuinely lose their cause — were at zero after #212/#214. They were not: 18
 * survived until #226. The claim held only because the grep suggested below
 * matches `\w+.message` as the argument, and the survivors were all
 *
 *     const message = errorMessage(err);
 *     logger.error('[X]', message);
 *
 * where the argument is a plain local. Same drop, different syntax, invisible to
 * that grep. Trust `--list` over the grep; the AST walk sees the argument's shape
 * rather than its spelling. The grep is kept only because it is still a fast
 * first pass:
 *
 *   grep -rnE "logger\.(error|warn|info)\(.*,\s*\w+(\?)?\.message\s*\)" src --include=*.ts
 *
 * What remains here is bare `err` awaiting the errorContext() form: an Error
 * instance, which winston does preserve. Worth doing for indexability, not worth
 * paging anyone over. If `--list` ever shows an arg2 that is not an error-shaped
 * identifier, that one IS losing its cause and is worth paging over.
 */

const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '..');
const SRC = path.join(BACKEND, 'src');
const ts = require(path.join(BACKEND, 'node_modules', 'typescript'));

const LEVELS = new Set(['error', 'warn', 'info', 'debug']);

const args = process.argv.slice(2);
const wantList = args.includes('--list');
const maxArg = args.find((a) => a.startsWith('--max='));
const max = maxArg ? Number(maxArg.slice('--max='.length)) : null;

/** Test files are excluded: an assertion may legitimately reference either form. */
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

function isAcceptable(node) {
    if (ts.isObjectLiteralExpression(node)) return true;
    return (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'errorContext'
    );
}

const offenders = [];
const helpers = [];

for (const file of sourceFiles(SRC)) {
    const sf = ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.ES2016,
        /* setParentNodes */ true,
    );
    const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const rel = path.relative(BACKEND, file).replace(/\\/g, '/');

    (function visit(node) {
        // Local re-declarations of the helpers logger.ts already exports.
        const helperName = /^(toMessage|errorMessage)$/;
        if (ts.isFunctionDeclaration(node) && node.name && helperName.test(node.name.text)) {
            helpers.push({ file: rel, name: node.name.text, line: lineOf(node) });
        }
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            helperName.test(node.name.text) &&
            node.initializer &&
            (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ) {
            helpers.push({ file: rel, name: node.name.text, line: lineOf(node) });
        }

        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
            const target = node.expression.expression;
            const level = node.expression.name.text;
            if (
                ts.isIdentifier(target) &&
                target.text === 'logger' &&
                LEVELS.has(level) &&
                node.arguments.length > 1 &&
                !isAcceptable(node.arguments[1])
            ) {
                offenders.push({
                    file: rel,
                    line: lineOf(node),
                    level,
                    arg: node.arguments[1].getText().replace(/\s+/g, ' ').slice(0, 60),
                });
            }
        }
        ts.forEachChild(node, visit);
    })(sf);
}

const byLevel = offenders.reduce((acc, o) => ({ ...acc, [o.level]: (acc[o.level] || 0) + 1 }), {});
const fileCount = new Set(offenders.map((o) => o.file)).size;

console.log(`logger sites not in canonical errorContext() form: ${offenders.length} across ${fileCount} files`);
console.log('  (mostly bare `err`, which winston preserves but does not index — see the header)');
console.log(`  by level: ${JSON.stringify(byLevel)}`);
console.log(`local toMessage/errorMessage declarations: ${helpers.length} (logger.ts exports both)`);

if (wantList) {
    console.log('');
    for (const o of offenders.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
        console.log(`${o.file}:${o.line} [${o.level}] arg2=${o.arg}`);
    }
}

if (max !== null) {
    if (Number.isNaN(max)) {
        console.error('--max requires a number');
        process.exit(2);
    }
    if (offenders.length > max) {
        console.error(`\nFAIL: ${offenders.length} sites exceeds the baseline of ${max}.`);
        process.exit(1);
    }
    console.log(`\nOK: at or below the baseline of ${max}.`);
}
