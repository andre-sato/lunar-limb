#!/usr/bin/env node

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const DIM = '\x1b[2m';

class QARunner {
  constructor() {
    this.results = {};
    this.startTime = Date.now();
    this.failed = 0;
    this.passed = 0;
  }

  log(message, color = RESET) {
    console.log(`${color}${message}${RESET}`);
  }

  header(text) {
    console.log(`\n${BOLD}${BLUE}${'='.repeat(60)}${RESET}`);
    console.log(`${BOLD}${BLUE}${text}${RESET}`);
    console.log(`${BOLD}${BLUE}${'='.repeat(60)}${RESET}\n`);
  }

  async runCommand(name, command, displayName = null) {
    const display = displayName || name;
    this.log(`⏳ Running: ${display}`, YELLOW);

    const startTime = Date.now();
    let exitCode = 0;
    let output = '';
    let error = '';

    try {
      output = execSync(command, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024
      });
    } catch (e) {
      exitCode = e.status || 1;
      output = e.stdout?.toString() || '';
      error = e.stderr?.toString() || '';
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const success = exitCode === 0;

    this.results[name] = {
      success,
      duration,
      output,
      error,
      exitCode
    };

    if (success) {
      this.passed++;
      this.log(`✅ ${display} (${duration}s)`, GREEN);
    } else {
      this.failed++;
      this.log(`❌ ${display} (${duration}s)`, RED);
      if (error) {
        this.log(`   Error: ${error.split('\n')[0]}`, DIM);
      }
    }

    return success;
  }

  async runAllChecks() {
    this.header('Lunar-Limb Quality Assurance Suite');

    // Core checks
    await this.runCommand(
      'type-check',
      'npm run check --silent',
      'Type Checking (Astro)'
    );

    await this.runCommand(
      'unit-tests',
      'npm run test --silent',
      'Unit Tests (Vitest)'
    );

    await this.runCommand(
      'lint',
      'npm run docs:lint --silent',
      'Documentation Linting'
    );

    await this.runCommand(
      'docs-test',
      'npm run docs:test --silent',
      'Documentation Testing'
    );

    await this.runCommand(
      'docs-code',
      'npm run docs:code --silent',
      'Code Block Validation'
    );

    // Optional advanced checks (may take longer)
    this.log('\n📊 Running advanced quality checks...', BLUE);

    await this.runCommand(
      'contract',
      'npm run contract --silent',
      'Contract Validation'
    );

    await this.runCommand(
      'health',
      'npm run docs:health --silent',
      'Documentation Health Assessment'
    );

    // Summary
    this.printSummary();
  }

  printSummary() {
    const totalTime = ((Date.now() - this.startTime) / 1000).toFixed(2);
    const total = this.passed + this.failed;

    this.header('Quality Assurance Summary');

    this.log(`Total Checks: ${total}`, BOLD);
    this.log(`✅ Passed: ${this.passed}`, GREEN);
    if (this.failed > 0) {
      this.log(`❌ Failed: ${this.failed}`, RED);
    }
    this.log(`⏱️  Total Time: ${totalTime}s`, BLUE);

    // Detailed results
    this.log('\n📋 Detailed Results:', BOLD);
    Object.entries(this.results).forEach(([name, result]) => {
      const status = result.success ? `${GREEN}✅${RESET}` : `${RED}❌${RESET}`;
      this.log(`  ${status} ${name.padEnd(20)} ${DIM}${result.duration}s${RESET}`);
    });

    // Failed details
    if (this.failed > 0) {
      this.log('\n⚠️  Failed Checks Details:', RED + BOLD);
      Object.entries(this.results).forEach(([name, result]) => {
        if (!result.success) {
          this.log(`\n${YELLOW}${name}:${RESET}`);
          if (result.error) {
            const errorLines = result.error.split('\n').slice(0, 5);
            errorLines.forEach(line => {
              if (line.trim()) this.log(`  ${line}`, DIM);
            });
          }
          if (result.output) {
            const outputLines = result.output.split('\n').slice(0, 5);
            outputLines.forEach(line => {
              if (line.trim()) this.log(`  ${line}`, DIM);
            });
          }
        }
      });
    }

    // Exit code
    process.exit(this.failed > 0 ? 1 : 0);
  }
}

const runner = new QARunner();
await runner.runAllChecks();
