#!/usr/bin/env node
import { $ } from 'zx';


 /**
 * Clean a URL to use as a CNAME target.
 * Removes scheme (http/https) and trailing slashes.
 * @param {string} url 
 * @returns {string}
 */
function cleanCnameTarget(url) {
  if (!url) return '';
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export class LightSailManager {
  /**
   * @param {string} [region='ca-central-1'] AWS region
   */
  constructor(region = 'ca-central-1') {
    this.region = region;
    this.defaultDNSRegion = 'us-east-1'; // Lightsail DNS is only in us-east-1
  }
  


  /** * Generate a certificate name based on the domain.
   * Replaces non-alphanumeric characters with hy
   * phens and converts to lowercase.
   * @param {string} domainName
   * @return {string} Cleaned certificate name
   * */
  certNameFromDomain(domainName) {
    // Generate a certificate name based on the domain. Remove 'dot' and rplace with hyphens.
     return domainName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase() + '-cert';
  }


  async certExists(certName) {
    let certExists = false;
    try {
      const res = await $`aws lightsail get-certificates --region ${this.region} --query "certificates[?certificateName=='${certName}']" --output text`;
      certExists = res.stdout.trim() !== '';
      return certExists;
    } catch {
      return certExists; 
    }
  }

  /**
   * Attach a certificate to a Lightsail container. Create if it doesn't exist.
   */
  async attachCert(containerName, domainName, certName) {
  certName = certName || this.certNameFromDomain(domainName);

  this.certName = certName;

  // 1️⃣ Check if cert exists or is pending
  let certExists = await this.certExists(certName);

  if (!certExists) {
      console.log(`Certificate '${certName}' not found. Creating...`);
      try {
      await $`aws lightsail create-certificate --region ${this.defaultDNSRegion} --certificate-name ${certName} --domain-name ${domainName}`;
      console.log(`Certificate creation request sent.`);
      } catch (err) {
      if (err.stderr && err.stderr.includes("already exist")) {
          console.log(`Certificate '${certName}' already exists in AWS.`);
      } else {
          throw err;
      }
      }
  } else {
      console.log(`Certificate '${certName}' already exists.`);
  }

  // 2️⃣ Ensure DNS record exists
  const parts = domainName.split('.');
  let recordName, zoneName;
  if (parts.length === 2) {
      // apex record
      recordName = '@';
      zoneName = domainName;
  } else {
      recordName = parts[0];
      zoneName = parts.slice(1).join('.');
  }

  console.log(`Checking if DNS record '${recordName}' exists in zone '${zoneName}'...`);
  const dnsRecords = await $`aws lightsail get-domain --region ${this.defaultDNSRegion} --domain-name ${zoneName} --query "domain.domainEntries[].name" --output text`;
  const existingRecords = dnsRecords.stdout.split(/\s+/).filter(Boolean);

  const fullRecordName = recordName === '@' ? zoneName : `${recordName}.${zoneName}`;

  this.fullRecordName = fullRecordName;

  console.log(`DNS record '${fullRecordName}' not found. Creating CNAME record...`);
  const containerInfo = await $`aws lightsail get-container-services --region ${this.region} --service-name ${containerName} --query "containerServices[0].url" --output text`;
  const containerURLRaw = containerInfo.stdout.trim();
  const containerURL = containerURLRaw.replace(/^https?:\/\//, '').replace(/\/$/, '');

  if (!existingRecords.includes(fullRecordName)) {


  const domainEntry = {
      name: fullRecordName,
      type: "CNAME",
      target: containerURL
  };

  try {
      await $`aws lightsail create-domain-entry --region ${this.defaultDNSRegion} --domain-name ${zoneName} --domain-entry ${JSON.stringify(domainEntry)}`;
      console.log(`CNAME record '${fullRecordName}' -> '${containerURL}' created.`);
  } catch (err) {
      if (err.stderr && err.stderr.includes("already exists")) {
      console.log(`CNAME record '${fullRecordName}' already exists. Skipping creation.`);
      } else {
      throw err;
      }
  }
  } else {
  console.log(`DNS record '${fullRecordName}' already exists.`);
  }

  // 3️⃣ Map domain to container service (triggers HTTPS provisioning)
  console.log(`Mapping domain '${domainName}' to container service '${containerName}'...`);

  await $`aws lightsail update-container-service \
  --region ${this.region} \
  --service-name ${containerName} \
  --public-domain-names ${JSON.stringify({ '_': [domainName] })}`;

  console.log(`Domain attached successfully (SSL will be provisioned automatically).`);
  }

  /**
   * Update Lightsail DNS Zone for given container and domain.
   */
  async updateDNS(containerName, domainName, dnsZoneName) {
    const parts = domainName.split('.');
    if (parts.length < 2) throw new Error("Invalid domain name provided.");

    let recordName;
    if (dnsZoneName) {
      recordName = domainName.replace(`.${dnsZoneName}`, '');
    } else {
      if (parts.length === 2) {
        dnsZoneName = domainName;
        recordName = '@';
      } else {
        recordName = parts[0];
        dnsZoneName = parts.slice(1).join('.');
      }
    }

    console.log(`Updating DNS Zone '${dnsZoneName}' with record '${recordName}'...`);
    const containerInfo = await $`aws lightsail get-container-services --region ${this.region} --service-name ${containerName} --query "containerServices[0].url" --output text`;
    const containerURL = containerInfo.stdout.trim();

    await this.waitForDomainEntry(this.fullRecordName, dnsZoneName, this.defaultDNSRegion);


    // Get the domain entries
    const entriesRes = await $`aws lightsail get-domain --region ${this.defaultDNSRegion} --domain-name ${dnsZoneName} --query "domain.domainEntries" --output json`;
    const entries = JSON.parse(entriesRes.stdout);

    const existingEntry = entries.find(e => e.name === recordName && e.type === 'A');
    const cleanTarget = containerURL.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const domainEntry = {
      name: recordName,
      type: 'A',
      target: cleanTarget,
      isAlias: true
    };

    this.domainEntry = domainEntry;

    if (existingEntry) {
      // Update using the same ID
      const updatedEntry = {
        ...existingEntry,
        target: cleanTarget,
        isAlias: true
      };
      await $`aws lightsail update-domain-entry \
        --region ${this.region} \
        --domain-name ${dnsZoneName} \
        --domain-entry ${JSON.stringify(updatedEntry)}`;
    } else {
      // Create a new entry
      const newEntry = {
        name: this.fullRecordName,
        type: 'A',
        target: cleanTarget,
        isAlias: true
      };

    }



   }

  async waitForDomainEntry(domainName, zoneName, region, maxAttempts = 10, delayMs = 5000) {
    let attempts = 0;
    while (attempts < maxAttempts) {
        const res = await $`aws lightsail get-domain --region ${this.defaultDNSRegion} --domain-name ${zoneName} --query "domain.domainEntries[].name" --output text`;
        const entries = res.stdout.split(/\s+/).filter(Boolean);
        if (entries.includes(domainName)) {
        console.log(`Domain entry '${domainName}' now exists in zone '${zoneName}'.`);
        return;
        }
        attempts++;
        console.log(`Waiting for domain entry to propagate... (${attempts}/${maxAttempts})`);
        await new Promise(r => setTimeout(r, delayMs));
    }
    throw new Error(`Domain entry '${domainName}' did not appear in Lightsail DNS after ${maxAttempts * delayMs/1000}s.`);
    }

 }
