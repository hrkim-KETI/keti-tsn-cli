/**
 * Input Loader - Common module for loading YANG/SID inputs
 *
 * This module extracts the shared loadInputs logic from both
 * tsc2cbor.js and cbor2tsc.js to eliminate code duplication.
 *
 * Supports pre-compiled cache for fast loading.
 *
 * @module input-loader
 */

import { buildSidTree, augmentSidTreeWithAliases } from './sid-resolver.js';
import { extractYangTypes } from './yang-type-extractor.js';
import fs from 'fs';
import path from 'path';

// Cache version - increment when cache format changes
const CACHE_VERSION = 1;

/**
 * Get cache file path for a YANG cache directory
 */
function getCacheFilePath(yangCacheDir) {
  const dirName = path.basename(yangCacheDir);
  return path.join(path.dirname(yangCacheDir), `${dirName}.cache.json`);
}

/**
 * Check if cache is valid (exists and newer than source files)
 */
async function isCacheValid(cacheFile, yangCacheDir) {
  try {
    const cacheStat = await fs.promises.stat(cacheFile);
    const cacheTime = cacheStat.mtimeMs;

    // Check if any source file is newer than cache
    const files = await fs.promises.readdir(yangCacheDir);
    for (const file of files) {
      if (file.endsWith('.yang') || file.endsWith('.sid')) {
        const fileStat = await fs.promises.stat(path.join(yangCacheDir, file));
        if (fileStat.mtimeMs > cacheTime) {
          return false; // Source file is newer
        }
      }
    }
    return true;
  } catch {
    return false; // Cache doesn't exist
  }
}

/**
 * Serialize Maps and Sets to JSON-compatible format
 */
function serializeData(sidTree, typeTable) {
  return {
    version: CACHE_VERSION,
    timestamp: Date.now(),
    sidTree: {
      pathToSid: [...sidTree.pathToSid],
      sidToPath: [...sidTree.sidToPath],
      prefixedPathToSid: [...sidTree.prefixedPathToSid],
      sidToPrefixedPath: [...sidTree.sidToPrefixedPath],
      pathToPrefixed: [...sidTree.pathToPrefixed],
      identityToSid: [...sidTree.identityToSid],
      sidToIdentity: [...sidTree.sidToIdentity],
      nodeInfo: [...sidTree.nodeInfo],
      leafToPaths: [...sidTree.leafToPaths]
    },
    typeTable: {
      types: [...typeTable.types].map(([k, v]) => [k, serializeTypeInfo(v)]),
      identities: [...typeTable.identities].map(([k, v]) => [k, serializeIdentity(v)]),
      typedefs: [...typeTable.typedefs].map(([k, v]) => [k, serializeTypeInfo(v)]),
      choiceNames: [...typeTable.choiceNames],
      caseNames: [...typeTable.caseNames],
      nodeOrders: [...typeTable.nodeOrders]
    }
  };
}

/**
 * Serialize type info (handle nested Maps)
 */
function serializeTypeInfo(typeInfo) {
  if (!typeInfo) return typeInfo;
  const result = { ...typeInfo };
  if (typeInfo.enum) {
    result.enum = {
      nameToValue: [...typeInfo.enum.nameToValue],
      valueToName: [...typeInfo.enum.valueToName]
    };
  }
  return result;
}

/**
 * Serialize identity info
 */
function serializeIdentity(identity) {
  if (!identity) return identity;
  return {
    ...identity,
    bases: identity.bases ? [...identity.bases] : []
  };
}

/**
 * Deserialize JSON data back to Maps and Sets
 */
function deserializeData(data) {
  if (data.version !== CACHE_VERSION) {
    throw new Error('Cache version mismatch');
  }

  const sidTree = {
    pathToSid: new Map(data.sidTree.pathToSid),
    sidToPath: new Map(data.sidTree.sidToPath),
    prefixedPathToSid: new Map(data.sidTree.prefixedPathToSid),
    sidToPrefixedPath: new Map(data.sidTree.sidToPrefixedPath),
    pathToPrefixed: new Map(data.sidTree.pathToPrefixed),
    identityToSid: new Map(data.sidTree.identityToSid),
    sidToIdentity: new Map(data.sidTree.sidToIdentity),
    nodeInfo: new Map(data.sidTree.nodeInfo),
    leafToPaths: new Map(data.sidTree.leafToPaths)
  };

  const typeTable = {
    types: new Map(data.typeTable.types.map(([k, v]) => [k, deserializeTypeInfo(v)])),
    identities: new Map(data.typeTable.identities.map(([k, v]) => [k, deserializeIdentity(v)])),
    typedefs: new Map(data.typeTable.typedefs.map(([k, v]) => [k, deserializeTypeInfo(v)])),
    choiceNames: new Set(data.typeTable.choiceNames),
    caseNames: new Set(data.typeTable.caseNames),
    nodeOrders: new Map(data.typeTable.nodeOrders)
  };

  return { sidTree, typeTable };
}

/**
 * Deserialize type info
 */
function deserializeTypeInfo(typeInfo) {
  if (!typeInfo) return typeInfo;
  const result = { ...typeInfo };
  if (typeInfo.enum) {
    result.enum = {
      nameToValue: new Map(typeInfo.enum.nameToValue),
      valueToName: new Map(typeInfo.enum.valueToName)
    };
  }
  return result;
}

/**
 * Deserialize identity info
 */
function deserializeIdentity(identity) {
  if (!identity) return identity;
  return {
    ...identity,
    bases: identity.bases ? new Set(identity.bases) : new Set()
  };
}

/**
 * Load from cache file
 */
async function loadFromCache(cacheFile, verbose) {
  const data = JSON.parse(await fs.promises.readFile(cacheFile, 'utf8'));
  const result = deserializeData(data);

  if (verbose) {
    const sidCount = result.sidTree.pathToSid.size;
    const typeCount = result.typeTable.types.size;
    console.log(`  Loaded from cache: ${sidCount} SIDs, ${typeCount} types`);
  }

  return result;
}

/**
 * Save to cache file
 */
async function saveToCache(cacheFile, sidTree, typeTable, verbose) {
  const data = serializeData(sidTree, typeTable);
  await fs.promises.writeFile(cacheFile, JSON.stringify(data), 'utf8');

  if (verbose) {
    const stat = await fs.promises.stat(cacheFile);
    console.log(`  Cache saved: ${(stat.size / 1024).toFixed(1)} KB`);
  }
}

/**
 * Load and merge YANG/SID inputs from cache directory
 *
 * Uses pre-compiled cache if available for fast loading.
 *
 * @param {string} yangCacheDir - Directory containing .yang and .sid files
 * @param {boolean} verbose - Enable verbose logging
 * @param {object} options - Additional options
 * @param {boolean} options.noCache - Disable cache (force reload)
 * @returns {Promise<{sidTree: object, typeTable: object}>}
 */
export async function loadYangInputs(yangCacheDir, verbose = false, options = {}) {
  const cacheFile = getCacheFilePath(yangCacheDir);

  // Try to load from cache first (unless disabled)
  if (!options.noCache && await isCacheValid(cacheFile, yangCacheDir)) {
    if (verbose) {
      console.log('Loading YANG/SID from cache...');
    }
    try {
      return await loadFromCache(cacheFile, verbose);
    } catch (err) {
      if (verbose) {
        console.log(`  Cache load failed: ${err.message}, rebuilding...`);
      }
    }
  }

  if (verbose) {
    console.log('Loading YANG/SID inputs...');
  }

  // Step 1: Load all SID files from cache directory (async)
  const allFiles = await fs.promises.readdir(yangCacheDir);
  const sidFiles = allFiles
    .filter(f => f.endsWith('.sid'))
    .map(f => path.join(yangCacheDir, f));

  if (verbose) {
    console.log(`  - Found ${sidFiles.length} SID files`);
  }

  // Step 2: Initialize merged SID tree structure
  const sidTree = {
    pathToSid: new Map(),
    sidToPath: new Map(),
    prefixedPathToSid: new Map(),
    sidToPrefixedPath: new Map(),
    pathToPrefixed: new Map(),
    identityToSid: new Map(),
    sidToIdentity: new Map(),
    nodeInfo: new Map(),
    leafToPaths: new Map()
  };

  // Load all SID files in parallel for better performance
  const sidTrees = await Promise.all(sidFiles.map(sidFile => buildSidTree(sidFile)));

  // Merge all SID trees
  for (const tree of sidTrees) {
    for (const [path, sid] of tree.pathToSid) {
      sidTree.pathToSid.set(path, sid);
    }
    for (const [sid, path] of tree.sidToPath) {
      sidTree.sidToPath.set(sid, path);
    }
    for (const [prefixedPath, sid] of tree.prefixedPathToSid) {
      sidTree.prefixedPathToSid.set(prefixedPath, sid);
    }
    for (const [sid, prefixedPath] of tree.sidToPrefixedPath) {
      sidTree.sidToPrefixedPath.set(sid, prefixedPath);
    }
    for (const [strippedPath, prefixedPath] of tree.pathToPrefixed) {
      sidTree.pathToPrefixed.set(strippedPath, prefixedPath);
    }
    for (const [identity, sid] of tree.identityToSid) {
      sidTree.identityToSid.set(identity, sid);
    }
    for (const [sid, identity] of tree.sidToIdentity) {
      sidTree.sidToIdentity.set(sid, identity);
    }
    // Merge leafToPaths index for fuzzy matching
    for (const [leaf, paths] of tree.leafToPaths) {
      const existing = sidTree.leafToPaths.get(leaf) || [];
      sidTree.leafToPaths.set(leaf, [...new Set([...existing, ...paths])]);
    }
  }

  // Step 3: Recalculate parent relationships for merged tree
  // This is necessary because parent might be from a different module
  for (const [nodePath, sid] of sidTree.pathToSid) {
    if (nodePath.startsWith('identity:') || nodePath.startsWith('feature:')) {
      continue;
    }

    const parts = nodePath.split('/').filter(p => p);
    let parent = null;

    for (let i = parts.length - 1; i > 0; i--) {
      const ancestorPath = parts.slice(0, i).join('/');
      if (sidTree.pathToSid.has(ancestorPath)) {
        parent = sidTree.pathToSid.get(ancestorPath);
        break;
      }
    }

    sidTree.nodeInfo.set(nodePath, {
      sid,
      parent,
      deltaSid: parent !== null ? sid - parent : sid,
      depth: parts.length,
      prefixedPath: sidTree.pathToPrefixed.get(nodePath) || sidTree.sidToPrefixedPath.get(sid) || nodePath
    });
  }

  // Step 4: Load all YANG files from cache directory
  const yangFiles = allFiles
    .filter(f => f.endsWith('.yang'))
    .map(f => path.join(yangCacheDir, f));

  if (verbose) {
    console.log(`  - Found ${yangFiles.length} YANG files`);
  }

  // Step 5: Initialize merged type table structure
  const typeTable = {
    types: new Map(),
    identities: new Map(),
    typedefs: new Map(),
    choiceNames: new Set(),
    caseNames: new Set(),
    nodeOrders: new Map()
  };

  // Load all YANG files in parallel for better performance
  const typeTables = await Promise.all(
    yangFiles.map(yangFile => extractYangTypes(yangFile, yangCacheDir))
  );

  // Merge all type tables
  for (const table of typeTables) {
    for (const [path, type] of table.types) {
      typeTable.types.set(path, type);
    }
    for (const [name, identityDef] of table.identities) {
      typeTable.identities.set(name, identityDef);
    }
    for (const [name, typedef] of table.typedefs) {
      typeTable.typedefs.set(name, typedef);
    }
    if (table.choiceNames) {
      for (const name of table.choiceNames) {
        typeTable.choiceNames.add(name);
      }
    }
    if (table.caseNames) {
      for (const name of table.caseNames) {
        typeTable.caseNames.add(name);
      }
    }
    if (table.nodeOrders) {
      for (const [nodeName, order] of table.nodeOrders) {
        typeTable.nodeOrders.set(nodeName, order);
      }
    }
  }

  // Step 6: Merge vendor-prefixed typedefs into base typedefs
  const mergedTypedefs = new Set();
  for (const [name, typedef] of typeTable.typedefs) {
    const vendorPrefixes = ['velocitysp-', 'mchp-'];
    for (const prefix of vendorPrefixes) {
      if (name.startsWith(prefix)) {
        const baseName = name.substring(prefix.length);
        const baseTypedef = typeTable.typedefs.get(baseName);

        if (baseTypedef && baseTypedef.enum && typedef.enum) {
          const mergedEnum = {
            nameToValue: new Map([...baseTypedef.enum.nameToValue, ...typedef.enum.nameToValue]),
            valueToName: new Map([...baseTypedef.enum.valueToName, ...typedef.enum.valueToName])
          };
          typeTable.typedefs.set(baseName, {
            ...typedef,
            enum: mergedEnum,
            original: baseName
          });
          mergedTypedefs.add(baseName);
          if (verbose) {
            console.log(`  - Merged ${name} into ${baseName} (${mergedEnum.nameToValue.size} enum values)`);
          }
        }
      }
    }
  }

  // Update leaf types that use merged typedefs
  for (const [path, typeInfo] of typeTable.types) {
    if (typeInfo.original && mergedTypedefs.has(typeInfo.original)) {
      const mergedTypedef = typeTable.typedefs.get(typeInfo.original);
      typeTable.types.set(path, {
        ...mergedTypedef,
        original: typeInfo.original
      });
    }
  }

  // Step 7: Build alias mappings for SID tree (choice/case handling)
  augmentSidTreeWithAliases(sidTree, typeTable.choiceNames, typeTable.caseNames);

  if (verbose) {
    const sidCount = sidTree.pathToSid.size;
    const typeCount = typeTable.types.size;
    const identityCount = typeTable.identities.size;

    let enumCount = 0;
    for (const typeInfo of typeTable.types.values()) {
      if (typeInfo.type === 'enumeration' && typeInfo.enum) {
        enumCount++;
      }
    }

    console.log(`  Loaded: ${sidCount} SID mappings`);
    console.log(`  Loaded: ${typeCount} types (${enumCount} enums), ${identityCount} identities`);
  }

  // Step 8: Save to cache for future fast loading
  if (!options.noCache) {
    try {
      await saveToCache(cacheFile, sidTree, typeTable, verbose);
    } catch (err) {
      // Cache save failure is not critical
      if (verbose) {
        console.log(`  Warning: Failed to save cache: ${err.message}`);
      }
    }
  }

  return { sidTree, typeTable };
}
