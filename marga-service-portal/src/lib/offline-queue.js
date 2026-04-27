import { uid } from './utils.js';

const KEY = 'msp_tech_offline_queue_v1';

function readQueue() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn('Unable to parse offline queue', error);
    return [];
  }
}

function writeQueue(queue) {
  localStorage.setItem(KEY, JSON.stringify(queue));
}

export function getQueue() {
  return readQueue();
}

export function queueSize() {
  return readQueue().length;
}

export function enqueue(action) {
  const queue = readQueue();
  queue.push({ id: uid('queue'), queuedAt: new Date().toISOString(), ...action });
  writeQueue(queue);
  return queue.length;
}

export function removeQueueItem(id) {
  const queue = readQueue().filter((item) => item.id !== id);
  writeQueue(queue);
  return queue.length;
}

export function replaceQueue(items) {
  writeQueue(Array.isArray(items) ? items : []);
}
