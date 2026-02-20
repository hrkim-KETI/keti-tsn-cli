/**
 * Post command (CoAP POST for RPC/action invocation)
 *
 * Invokes YANG RPC operations on device using CoAP POST.
 * Used for operations like save-config, factory-reset, etc.
 * Supports both Serial, WiFi, and Ethernet transports.
 *
 * Note: Multiple RPC entries are sent sequentially (one POST per entry).
 */

import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

import { YangCatalogManager } from '../../tsc2cbor/lib/yang-catalog/yang-catalog.js';
import { Tsc2CborConverter } from '../../tsc2cbor/tsc2cbor.js';
import { Cbor2TscConverter } from '../../tsc2cbor/cbor2tsc.js';
import { createTransport } from '../../tsc2cbor/lib/transport/index.js';
import { isInstanceIdentifierFormat } from '../../tsc2cbor/lib/encoder/transformer-instance-id.js';

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
 * Invoke RPC operations on device via CoAP POST
 * @param {string} file - Input YAML file (instance-identifier format with RPC paths)
 * @param {object} options - Command options
 */
export async function postCommand(file, options) {
  const verbose = options.verbose || false;
  const transportType = options.transport || 'serial';

  if (!fs.existsSync(file)) {
    throw new Error(`Input file not found: ${file}`);
  }

  // Find YANG cache
  const yangCacheDir = await findYangCache(options.cache);

  // Parse YAML file
  const yamlContent = fs.readFileSync(file, 'utf8');
  const parsedData = yaml.load(yamlContent);

  if (!isInstanceIdentifierFormat(parsedData)) {
    throw new Error(
      'POST requires instance-identifier format.\n' +
      'Example:\n' +
      '  - "/mchp-velocitysp-system:save-config":'
    );
  }

  const postItems = parsedData;

  if (verbose) {
    console.log(`Found ${postItems.length} RPC operation(s)`);
  }

  // Create converter for CBOR encoding
  const encoder = new Tsc2CborConverter(yangCacheDir);

  // Create decoder for response decoding
  const decoder = new Cbor2TscConverter(yangCacheDir);

  // Create transport and connect
  const transport = createTransport(transportType, { verbose });

  try {
    // Connect based on transport type
    if (transportType === 'wifi' || transportType === 'eth') {
      if (verbose) console.log(`Connecting to ${options.host}:${options.port} via ${transportType}...`);
      await transport.connect({ host: options.host, port: options.port });
    } else {
      if (verbose) console.log(`Connecting to ${options.device}...`);
      await transport.connect({ device: options.device });
    }
    if (verbose) console.log('Connected.\n');

    await transport.waitForReady(5000);

    // Process each RPC item sequentially
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < postItems.length; i++) {
      const item = postItems[i];
      const itemPath = Object.keys(item)[0];

      if (verbose) {
        console.log(`\n[${i + 1}/${postItems.length}] POST: ${itemPath}`);
      }

      try {
        // Convert single item to CBOR
        const singleItemYaml = yaml.dump([item]);
        const encodeResult = await encoder.convertString(singleItemYaml, { verbose: false });
        const postData = encodeResult.cbor;

        if (verbose) {
          console.log(`  CBOR size: ${postData.length} bytes`);
        }

        // Send POST request
        const response = await transport.sendPostRequest(postData);

        if (!response.isSuccess()) {
          console.error(`  Failed: CoAP code ${response.code}`);

          // Try to decode error response payload if present
          if (response.payload && response.payload.length > 0) {
            try {
              const errorResult = await decoder.convertBuffer(response.payload, {
                verbose: false,
                outputFormat: 'rfc7951'
              });
              console.error(`  Error details: ${errorResult.yaml}`);
            } catch (decodeErr) {
              console.error(`  Error payload (${response.payload.length} bytes): ${response.payload.toString('hex')}`);
            }
          }

          failCount++;
          continue;
        }

        if (verbose) {
          console.log(`  Success`);
        }

        // Display response payload if present
        if (response.payload && response.payload.length > 0) {
          try {
            const result = await decoder.convertBuffer(response.payload, {
              verbose: false,
              outputFormat: 'rfc7951'
            });
            console.log(result.yaml);
          } catch (decodeErr) {
            if (verbose) {
              console.log(`  Response payload (${response.payload.length} bytes): ${response.payload.toString('hex')}`);
            }
          }
        }

        successCount++;

      } catch (err) {
        console.error(`  Error: ${err.message}`);
        failCount++;
        continue;
      }
    }

    // Summary
    if (verbose || failCount > 0) {
      console.log(`\n--- Summary ---`);
      console.log(`Total: ${postItems.length}, Success: ${successCount}, Failed: ${failCount}`);
    }

    if (failCount > 0 && successCount === 0) {
      throw new Error('All POST operations failed');
    }

  } finally {
    if (transport.getConnectionStatus()) {
      await transport.disconnect();
    }
  }
}
