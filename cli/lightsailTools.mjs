#!/usr/bin/env node
import { Command } from 'commander';
import { LightSailManager } from './../src/LightSailManager.mjs';

const program = new Command();

program
  .name('lightsailTools')
  .description('Attach a certificate to a Lightsail container and update DNS records (default command).')
  .version('1.0.0')
  .requiredOption('--container-name <containerName>', 'Lightsail container name (wrap in quotes if contains hyphens)')
  .requiredOption('--domain-name <domainName>', 'Fully qualified domain name')
  .option('-c, --cert-name <certName>', 'Optional custom certificate name')
  .option('-z, --dns-zone <dnsZoneName>', 'Optional DNS zone name (otherwise inferred)')
  .option('-r, --region <region>', 'AWS region (default: ca-central-1)', 'ca-central-1')
  .action(async (options) => {
    try {
      const manager = new LightSailManager(options.region);
      await manager.attachCert(options.containerName, options.domainName, options.certName);
      await manager.updateDNS(options.containerName, options.domainName, options.dnsZone);
      console.log('✅ Operation completed successfully.');
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

if (!process.argv.slice(2).length) {
  program.outputHelp();
  process.exit(1);
}

program.parse(process.argv);
