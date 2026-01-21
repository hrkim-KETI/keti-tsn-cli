/**
 * Fetch configuration command (iFETCH)
 *
 * Queries specific configuration values from device using CoAP iFETCH.
 * Uses instance-identifier format (YAML) and converts to SID array for the request.
 * Supports both Serial and WiFi transports.
 *
 * Note: iFETCH requires SID array format, not Delta-SID Map.
 */

import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

// Static imports for better performance (no dynamic import overhead)
import { YangCatalogManager } from '../../tsc2cbor/lib/yang-catalog/yang-catalog.js';
import { loadYangInputs } from '../../tsc2cbor/lib/common/input-loader.js';
import { isInstanceIdentifierFormat, extractSidsFromInstanceIdentifier } from '../../tsc2cbor/lib/encoder/transformer-instance-id.js';
import { createTransport } from '../../tsc2cbor/lib/transport/index.js';
import { Cbor2TscConverter } from '../../tsc2cbor/cbor2tsc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Find YANG cache directory
 */
async function findYangCache(cacheOption) {
  if (cacheOption) {
    if (!fs.existsSync(cacheOption)) {
      throw new Error(`Cache directory not found: ${cacheOption}`);
    }
    return cacheOption;
  }

  const yangCatalog = new YangCatalogManager();
  const catalogs = yangCatalog.listCachedCatalogs();

  if (catalogs.length === 0) {
    throw new Error(
      'No YANG catalog found. Please run "keti-tsn download" first, or specify -c <cache_dir>'
    );
  }

  return catalogs[0].path;
}

/**
 * Fetch specific configuration values from device
 * @param {string} file - Input YAML file (instance-identifier format)
 * @param {object} options - Command options
 */
export async function fetchCommand(file, options) {
  const verbose = options.verbose || false;
  const format = options.format || 'rfc7951';
  const transportType = options.transport || 'serial';

  if (!fs.existsSync(file)) {
    throw new Error(`Input file not found: ${file}`);
  }

  // Find YANG cache
  const yangCacheDir = await findYangCache(options.cache);

  // Load YANG/SID inputs
  if (verbose) {
    console.log('Converting query to CBOR...');
  }

  const { sidInfo, typeTable } = await loadYangInputs(yangCacheDir, verbose);

  // Parse YAML file
  const yamlContent = fs.readFileSync(file, 'utf8');
  const parsedData = yaml.load(yamlContent);

  // iFETCH requires SID array, not Delta-SID Map
  let query;

  if (isInstanceIdentifierFormat(parsedData)) {
    if (verbose) {
      console.log('\nDetected instance-identifier format');
      console.log('Extracting SIDs for iFETCH...');
    }

    // Extract SID entries from instance-identifier paths
    // Each entry is either a number (SID) or [SID, key1, key2, ...] for list entries
    const entries = extractSidsFromInstanceIdentifier(parsedData, sidInfo, { verbose });

    if (entries.length === 0) {
      throw new Error('No valid SIDs found in instance-identifier paths');
    }

    // For now, support single path query
    // Each entry becomes a separate CBOR in the sequence
    // If single entry: send it directly
    // If multiple: need CBOR sequence (TODO)
    if (entries.length === 1) {
      query = entries[0];  // Either number or [sid, key1, ...]
    } else {
      // Multiple entries - send as CBOR sequence
      // For now, just use first entry
      console.warn('Warning: Multiple paths not fully supported yet, using first path only');
      query = entries[0];
    }

    if (verbose) {
      const queryStr = Array.isArray(query)
        ? `[${query.map(v => typeof v === 'string' ? `"${v}"` : v).join(', ')}]`
        : query;
      console.log(`  Query: ${queryStr}`);
    }
  } else {
    throw new Error(
      'iFETCH requires instance-identifier format.\n' +
      'Example: - /ietf-interfaces:interfaces/interface[name="1"]:\n' +
      'Note: trailing colon is required to make it an object'
    );
  }

  if (verbose) {
    console.log(`Query type: ${Array.isArray(query) ? 'list entry' : 'single SID'}`);
  }

  // Create transport and connect
  const transport = createTransport(transportType, { verbose });

  try {
    // Connect based on transport type
    if (transportType === 'wifi') {
      if (verbose) console.log(`Connecting to WiFi proxy at ${options.host}:${options.port}...`);
      await transport.connect({ host: options.host, port: options.port });
    } else {
      if (verbose) console.log(`Connecting to ${options.device}...`);
      await transport.connect({ device: options.device });
    }
    if (verbose) console.log('Connected.\n');

    await transport.waitForReady(5000);

    if (verbose) console.log('Sending iFETCH request...');
    const response = await transport.sendiFetchRequest(query);

    if (!response.isSuccess()) {
      throw new Error(`iFETCH failed: CoAP code ${response.code}`);
    }

    const cborPayload = response.payload;
    if (verbose) console.log(`Received ${cborPayload.length} bytes`);

    // Decode response
    const decoder = new Cbor2TscConverter(yangCacheDir);
    const result = await decoder.convertBuffer(cborPayload, {
      verbose,
      outputFormat: format
    });

    if (options.output) {
      fs.writeFileSync(options.output, result.yaml, 'utf8');
      if (verbose) console.log(`\nResult saved to: ${options.output}`);
    } else {
      if (verbose) console.log('\n--- Result ---\n');
      console.log(result.yaml);
    }

  } finally {
    if (transport.getConnectionStatus()) {
      await transport.disconnect();
    }
  }
}
