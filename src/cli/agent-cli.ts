import * as readline from 'readline';

export async function chat(): Promise<void> {
  console.log(`\n  🤖 ProxyBoy AI Chat`);
  console.log(`  ───────────────────`);
  console.log(`  Powered by GitHub Copilot SDK\n`);
  console.log(`  Type your questions about network debugging.`);
  console.log(`  Type 'exit' or 'quit' to leave.\n`);

  let client: any = null;
  let session: any = null;

  try {
    const { CopilotClient, approveAll } = await import('@github/copilot-sdk');
    client = new CopilotClient();
    await client.start();
    session = await client.createSession({
      model: 'claude-sonnet-4',
      onPermissionRequest: approveAll,
      systemMessage: {
        content: 'You are ProxyBoy AI, a network debugging assistant. Help users analyze HTTP/HTTPS traffic, create debugging rules, and troubleshoot network issues.',
      },
    });
    console.log('  ✅ Connected to Copilot\n');
  } catch (error: any) {
    console.error(`  ❌ Failed to connect: ${error.message}`);
    console.log('  💡 Make sure Copilot CLI is installed and authenticated.\n');
    console.log('  Running in offline mode (limited functionality).\n');
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '  \x1b[36myou\x1b[0m > ',
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (input === 'exit' || input === 'quit') {
      console.log('\n  👋 Goodbye!\n');
      if (client) await client.stop();
      rl.close();
      process.exit(0);
    }

    if (!input) {
      rl.prompt();
      return;
    }

    if (session) {
      process.stdout.write('  \x1b[35mai\x1b[0m > ');
      try {
        const response = await session.sendAndWait({ prompt: input });
        console.log(response?.data?.content || 'No response');
      } catch (error: any) {
        console.log(`Error: ${error.message}`);
      }
    } else {
      console.log('  \x1b[35mai\x1b[0m > Agent not connected. Please install Copilot CLI.');
    }

    console.log('');
    rl.prompt();
  });
}
