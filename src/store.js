'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Small document store persisted as JSON on a Docker volume. Writes are atomic
 * (write to a temp file, then rename). The repository interface (insert/find/update/remove)
 * keeps the rest of the app independent of storage, so it can be swapped for PostgreSQL later.
 */

const COLLECTIONS = ['users', 'sprints', 'interviews'];

function emptyState() {
  return { users: [], sprints: [], interviews: [] };
}

function loadState(file) {
  if (!file || !fs.existsSync(file)) {
    return emptyState();
  }
  try {
    return { ...emptyState(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return emptyState();
  }
}

function createStore({ dataDir = null } = {}) {
  const file = dataDir ? path.join(dataDir, 'proofsprint.json') : null;
  const state = loadState(file);

  function persist() {
    if (!file) {
      return;
    }
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file);
  }

  function rows(name) {
    if (!COLLECTIONS.includes(name)) {
      throw new Error(`Unknown collection: ${name}`);
    }
    return state[name];
  }

  function insert(name, doc) {
    const now = new Date().toISOString();
    const row = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, ...doc };
    rows(name).push(row);
    persist();
    return row;
  }

  function find(name, predicate = () => true) {
    return rows(name).filter(predicate);
  }

  function findOne(name, predicate) {
    return rows(name).find(predicate) || null;
  }

  function update(name, id, patch) {
    const row = findOne(name, (r) => r.id === id);
    if (!row) {
      return null;
    }
    Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    persist();
    return row;
  }

  function remove(name, id) {
    const list = rows(name);
    const index = list.findIndex((r) => r.id === id);
    if (index === -1) {
      return false;
    }
    list.splice(index, 1);
    persist();
    return true;
  }

  function isWritable() {
    if (!file) {
      return true;
    }
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.accessSync(dataDir, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  return { insert, find, findOne, update, remove, isWritable, count: (name) => rows(name).length };
}

module.exports = { createStore, COLLECTIONS };
