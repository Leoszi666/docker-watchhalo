// Thin fetch helpers around the DockerWatch Lite API (PRD §7).

async function parseJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function request(path, options) {
  let res;
  try {
    res = await fetch(path, options);
  } catch {
    const error = new Error('Cannot reach the server.');
    error.kind = 'network';
    throw error;
  }

  const body = await parseJson(res);

  if (!res.ok) {
    // 503 from GET /api/containers means the Docker socket is unreadable.
    const error = new Error(body?.error || `Request failed with status ${res.status}.`);
    error.kind = 'api';
    error.status = res.status;
    throw error;
  }
  if (body == null) {
    const error = new Error('Invalid response from server.');
    error.kind = 'api';
    error.status = res.status;
    throw error;
  }
  return body;
}

export function fetchContainers() {
  return request('/api/containers');
}

export function fetchSnapshots() {
  return request('/api/snapshots');
}

export function createSnapshot(snapshot) {
  return request('/api/snapshots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  });
}

export function sendDiscordAlert(containerId) {
  return request(`/api/containers/${encodeURIComponent(containerId)}/alert`, {
    method: 'POST',
  });
}
