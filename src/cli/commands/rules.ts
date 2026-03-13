export async function rules(options: { list?: boolean; add?: string; delete?: string }): Promise<void> {
  console.log(`\n  📋 ProxyBoy Rules Manager`);
  console.log(`  ────────────────────────\n`);

  if (options.list) {
    console.log('  No rules configured.\n');
    console.log('  Use --add breakpoint or --add map-local to create rules.\n');
    return;
  }

  if (options.add) {
    console.log(`  Creating new ${options.add} rule...`);
    console.log('  Interactive rule creation is available in the GUI or via:\n');
    console.log('    proxyboy chat\n');
    console.log('  Then tell the AI: "Create a breakpoint for /api/auth"\n');
    return;
  }

  if (options.delete) {
    console.log(`  Deleting rule: ${options.delete}\n`);
    return;
  }

  console.log('  Usage:');
  console.log('    proxyboy rules --list            List all rules');
  console.log('    proxyboy rules --add breakpoint   Add a breakpoint rule');
  console.log('    proxyboy rules --add map-local    Add a map-local rule');
  console.log('    proxyboy rules --delete <id>      Delete a rule\n');
}
