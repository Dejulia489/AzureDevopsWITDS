const fs = require('fs/promises');
const path = require('path');

const TEMP_DIR = path.join(__dirname, '..', '..', 'temp');

/**
 * Ensures the temp directory exists before any file operation.
 * @returns {Promise<void>}
 */
async function _ensureTempDir() {
  await fs.mkdir(TEMP_DIR, { recursive: true });
}

/**
 * Builds the file path for a given connectionId and processId.
 * @param {string} connectionId
 * @param {string} processId
 * @returns {string}
 */
function _buildFilePath(connectionId, processId) {
  return path.join(TEMP_DIR, `${connectionId}_${processId}.json`);
}

/**
 * Saves process data to a temp JSON file.
 * @param {string} connectionId
 * @param {string} processId
 * @param {*} data
 * @returns {Promise<void>}
 */
async function saveProcessData(connectionId, processId, data) {
  await _ensureTempDir();
  const filePath = _buildFilePath(connectionId, processId);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Reads and returns process data from a temp file, or null if not found.
 * @param {string} connectionId
 * @param {string} processId
 * @returns {Promise<* | null>}
 */
async function getProcessData(connectionId, processId) {
  const filePath = _buildFilePath(connectionId, processId);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Lists all process data files for a given connection.
 * Returns an array of { connectionId, processId } objects.
 * @param {string} connectionId
 * @returns {Promise<Array<{ connectionId: string, processId: string }>>}
 */
async function listProcessData(connectionId) {
  try {
    const files = await fs.readdir(TEMP_DIR);
    const prefix = `${connectionId}_`;
    return files
      .filter((file) => file.startsWith(prefix) && file.endsWith('.json'))
      .map((file) => {
        const basename = file.replace('.json', '');
        const processId = basename.substring(prefix.length);
        return { connectionId, processId };
      });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * Deletes a specific temp file for the given connectionId and processId.
 * @param {string} connectionId
 * @param {string} processId
 * @returns {Promise<boolean>} true if deleted, false if file did not exist
 */
async function clearProcessData(connectionId, processId) {
  const filePath = _buildFilePath(connectionId, processId);
  try {
    await fs.unlink(filePath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

/**
 * Deletes all JSON files in the temp directory.
 * @returns {Promise<void>}
 */
async function clearAllProcessData() {
  try {
    const files = await fs.readdir(TEMP_DIR);
    const deletions = files
      .filter((file) => file.endsWith('.json'))
      .map((file) => fs.unlink(path.join(TEMP_DIR, file)));
    await Promise.all(deletions);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return;
    }
    throw err;
  }
}

/**
 * Reads all temp files and returns them as an array of
 * { connectionId, processId, data } objects.
 * @returns {Promise<Array<{ connectionId: string, processId: string, data: * }>>}
 */
async function getAllSessionData() {
  try {
    const files = await fs.readdir(TEMP_DIR);
    const jsonFiles = files.filter((file) => file.endsWith('.json'));
    const results = await Promise.all(
      jsonFiles.map(async (file) => {
        const basename = file.replace('.json', '');
        const separatorIndex = basename.indexOf('_');
        if (separatorIndex === -1) {
          return null;
        }
        const connectionId = basename.substring(0, separatorIndex);
        const processId = basename.substring(separatorIndex + 1);
        const filePath = path.join(TEMP_DIR, file);
        try {
          const raw = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(raw);
          return { connectionId, processId, data };
        } catch {
          return null;
        }
      })
    );
    return results.filter((entry) => entry !== null);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

module.exports = {
  saveProcessData,
  getProcessData,
  listProcessData,
  clearProcessData,
  clearAllProcessData,
  getAllSessionData,
};
