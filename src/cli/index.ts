#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('proxyboy')
  .description('ProxyBoy — Agentic HTTP/HTTPS Debugging Proxy')
  .version('1.0.0');

program
  .command('capture')
  .description('Start capturing HTTP/HTTPS traffic (headless mode)')
  .option('-p, --port <port>', 'Proxy port', '9090')
  .option('-h, --host <host>', 'Proxy host', '127.0.0.1')
  .action(async (options) => {
    const { capture } = await import('./commands/capture');
    await capture(options);
  });

program
  .command('analyze')
  .description('Analyze captured traffic with AI')
  .option('-q, --query <query>', 'Analysis query')
  .option('-f, --file <file>', 'HAR file to analyze')
  .action(async (options) => {
    const { analyze } = await import('./commands/analyze');
    await analyze(options);
  });

program
  .command('rules')
  .description('Manage proxy rules')
  .option('-l, --list', 'List all rules')
  .option('-a, --add <type>', 'Add a rule (breakpoint|map-local)')
  .option('-d, --delete <id>', 'Delete a rule')
  .action(async (options) => {
    const { rules } = await import('./commands/rules');
    await rules(options);
  });

program
  .command('chat')
  .description('Interactive AI chat for debugging')
  .action(async () => {
    const { chat } = await import('./agent-cli');
    await chat();
  });

program.parse();
