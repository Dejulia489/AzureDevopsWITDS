const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'connections.json');

/**
 * Reads the connections config file and returns the parsed object.
 * @returns {Promise<{ connections: Array }>}
 */
async function _readConfig() {
  const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Writes the config object to the connections JSON file with pretty formatting.
 * @param {{ connections: Array }} config
 * @returns {Promise<void>}
 */
async function _writeConfig(config) {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Returns all connections from the config file.
 * @returns {Promise<Array<{ id: string, name: string, orgUrl: string, pat: string }>>}
 */
async function getConnections() {
  const config = await _readConfig();
  return config.connections;
}

/**
 * Returns a single connection by its id, or null if not found.
 * @param {string} id
 * @returns {Promise<{ id: string, name: string, orgUrl: string, pat: string } | null>}
 */
async function getConnection(id) {
  const config = await _readConfig();
  const connection = config.connections.find((c) => c.id === id);
  return connection || null;
}

/**
 * Adds a new connection to the config file.
 * @param {{ name: string, orgUrl: string, pat: string }} params
 * @returns {Promise<{ id: string, name: string, orgUrl: string, pat: string }>}
 */
async function addConnection({ name, orgUrl, pat }) {
  const config = await _readConfig();
  const newConnection = {
    id: uuidv4(),
    name,
    orgUrl,
    pat,
  };
  config.connections.push(newConnection);
  await _writeConfig(config);
  return newConnection;
}

/**
 * Updates an existing connection by its id.
 * @param {string} id
 * @param {Partial<{ name: string, orgUrl: string, pat: string }>} updates
 * @returns {Promise<{ id: string, name: string, orgUrl: string, pat: string } | null>}
 */
async function updateConnection(id, updates) {
  const config = await _readConfig();
  const index = config.connections.findIndex((c) => c.id === id);
  if (index === -1) {
    return null;
  }
  config.connections[index] = { ...config.connections[index], ...updates, id };
  await _writeConfig(config);
  return config.connections[index];
}

/**
 * Deletes a connection by its id.
 * @param {string} id
 * @returns {Promise<boolean>} true if a connection was deleted, false if not found
 */
async function deleteConnection(id) {
  const config = await _readConfig();
  const initialLength = config.connections.length;
  config.connections = config.connections.filter((c) => c.id !== id);
  if (config.connections.length === initialLength) {
    return false;
  }
  await _writeConfig(config);
  return true;
}

module.exports = {
  getConnections,
  getConnection,
  addConnection,
  updateConnection,
  deleteConnection,
  _readConfig,
  _writeConfig,
};
