---
name: run-qa
description: Execute comprehensive quality assurance suite including testing, linting, validation, and health checks
keywords: [qa, test, lint, quality, check, validation, contract, health]
---

# Quality Assurance Suite

This skill runs the complete Lunar-Limb QA pipeline: unit tests, type checking, documentation linting, code validation, contract verification, and health assessment.

## Agent Path: Driver Script

The primary way to run QA checks is via the Node.js driver script, which orchestrates all checks and provides a comprehensive report:

```bash
node .claude/skills/run-qa/driver.mjs
```

This script runs:
1. **Type Checking** (`npm run check`) — Astro type validation
2. **Unit Tests** (`npm run test`) — Vitest test suite
3. **Documentation Linting** (`npm run docs:lint`) — Editorial review
4. **Documentation Testing** (`npm run docs:test`) — Link and reference validation
5. **Code Validation** (`npm run docs:code`) — Verify code blocks in docs
6. **Contract Validation** (`npm run contract`) — Ensure examples match API specs
7. **Health Assessment** (`npm run docs:health`) — Documentation quality metrics

The output shows colored pass/fail status, timing, and detailed error information for any failures.

## Prerequisites

**System Requirements:**
- Node.js 20.19.0 or higher

**Installation:**
```bash
npm install
```

## Build

No separate build step is needed for QA. The project structure is already in place.

## Individual Check Commands

You can also run individual QA checks directly:

```bash
# Type checking
npm run check

# Unit tests
npm run test

# Unit tests in watch mode (live reload as you edit)
npm run test:watch

# Documentation linting
npm run docs:lint

# Documentation testing (links, anchors, references)
npm run docs:test

# Validate code blocks in documentation
npm run docs:code

# Contract validation (examples vs API specs)
npm run contract

# Documentation health score
npm run docs:health

# All advanced checks
npm run ai:eval
npm run gaps
```

## Running the Full QA Suite

**Agent Path (Recommended):**
```bash
node .claude/skills/run-qa/driver.mjs
```

**What to expect:**
- ✅ Each check shows pass/fail status with execution time
- ❌ Failed checks display error details
- 📊 Summary report shows overall health

The script exits with code 0 if all checks pass, 1 if any fail.

## Quick Smoke Test (Human Path)

To quickly verify the project is healthy without running everything:

```bash
npm run check && npm run test
```

This runs type checking and unit tests (fastest checks).

## Project Structure

```
.claude/skills/run-qa/
├── SKILL.md          (this file)
└── driver.mjs        (QA orchestration script)

src/                  (source code)
tests/                (unit tests)
src/schemas/          (AsyncAPI and API specs)
src/content/          (documentation)
```

## Gotchas

### 1. Line Ending Differences (CRLF vs LF)
**Problem:** Tests fail with message like "expected '\n' to be '\r\n'"

The AsyncAPI generator may produce different line endings on Windows vs Unix. This causes snapshot test failures.

**Workaround:** Regenerate the generated file:
```bash
npm run docs:asyncapi
git add src/content/docs/api/streetlights-kafka.md
```

### 2. Type Checking Takes 30+ Seconds
The `astro check` command is thorough but slow. It validates the entire Astro project structure and dependencies. This is normal.

### 3. Documentation Tests Skip If No Content
If `docs:test` shows warnings about missing documentation, this is expected if the content directory is empty.

### 4. Contract Validation Requires Specs
The `contract` check looks for OpenAPI/AsyncAPI specs in `src/schemas/`. If none are present, the check will show "no specs found" — this is OK during initial setup.

## Troubleshooting

### Tests fail immediately with "ENOENT: no such file"
```
Error: ENOENT: no such file or directory
```
**Solution:** Run `npm install` to ensure all dependencies are installed.

### Type checking fails with "Cannot find module"
```
error: Cannot find module '@astrojs/starlight'
```
**Solution:** Dependencies may be incomplete. Try:
```bash
npm ci --prefer-offline
```

### Documentation tests report broken links
```
FAIL: Found 5 broken links
```
**Cause:** Documentation references non-existent pages or anchors.

**Solution:** Verify the links in your markdown files, or check the detailed error output for specific broken references.

### Unit test "corresponde ao arquivo comitado" fails
```
expected '---\r\n' to be '---\n'
```
**Cause:** Windows line-ending mismatch in AsyncAPI generated file.

**Solution:**
```bash
npm run docs:asyncapi
git add src/content/docs/api/*.md
npm run test
```

### Contract validation fails
```
FAIL: Contract violations detected
```
**Cause:** Documentation examples don't match actual API specifications.

**Solution:** 
1. Review the error output to identify which examples are wrong
2. Update either the documentation or the spec to match
3. Run `npm run contract` again to verify

## Output Examples

### Successful Run
```
============================================================
Lunar-Limb Quality Assurance Suite
============================================================

⏳ Running: Type Checking (Astro)
✅ type-check (34.22s)

⏳ Running: Unit Tests (Vitest)
✅ unit-tests (2.15s)

⏳ Running: Documentation Linting
✅ lint (0.82s)

============================================================
Quality Assurance Summary
============================================================

Total Checks: 7
✅ Passed: 7
⏱️  Total Time: 45.32s
```

### Failed Run
```
❌ unit-tests (2.15s)
   Error: 1 test failed

⚠️  Failed Checks Details:

unit-tests:
  FAIL  tests/asyncapi.test.ts > página gerada > corresponde ao arquivo comitado
  AssertionError: expected '---\r\n' to be '---\n'
```

## Integration with CI/CD

To run QA checks in GitHub Actions or similar CI:

```yaml
- name: Install dependencies
  run: npm ci

- name: Run QA Suite
  run: node .claude/skills/run-qa/driver.mjs
```

This ensures all quality gates pass before merging.
