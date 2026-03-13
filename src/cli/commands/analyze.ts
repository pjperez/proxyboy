export async function analyze(options: { query?: string; file?: string }): Promise<void> {
  console.log(`\n  🤖 ProxyBoy AI Analysis`);
  console.log(`  ───────────────────────\n`);

  if (!options.query && !options.file) {
    console.log('  Usage: proxyboy analyze --query "Find slow requests"');
    console.log('         proxyboy analyze --file traffic.har\n');
    return;
  }

  if (options.file) {
    console.log(`  📂 Analyzing HAR file: ${options.file}`);
  }

  if (options.query) {
    console.log(`  🔍 Query: ${options.query}\n`);
    console.log('  ⏳ Connecting to Copilot agent...');
    
    try {
      const { CopilotClient, approveAll } = await import('@github/copilot-sdk');
      const client = new CopilotClient();
      await client.start();
      const session = await client.createSession({
        model: 'claude-sonnet-4',
        onPermissionRequest: approveAll,
      });
      
      console.log('  ✅ Connected\n');
      
      const response = await session.sendAndWait({
        prompt: `Analyze this network debugging query: ${options.query}`,
      });
      
      console.log(`  ${response?.data?.content || 'No response'}\n`);
      await client.stop();
    } catch (error: any) {
      console.error(`  ❌ Agent error: ${error.message}`);
      console.log('  💡 Make sure Copilot CLI is installed and authenticated.\n');
    }
  }
}
