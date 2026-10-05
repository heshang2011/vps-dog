/**
 * Builds the one-liner that installs the agent on a remote server.
 *
 * The dashboard is served by the Worker itself, so `window.location.origin`
 * *is* the URL the agent must report to — no extra configuration needed. (In
 * `vite dev` that resolves to the dev server, which is only reachable from your
 * machine; install against the deployed origin instead.)
 */

/** Raw URL of `agent/install.sh` in the upstream repository. */
export const INSTALL_SCRIPT_URL =
  'https://raw.githubusercontent.com/heshang2011/vps-dog/main/agent/install.sh';

/**
 * Single-quote a value for POSIX shells.
 *
 * `install.sh` already rejects double quotes, backslashes and newlines — a
 * node name like `x"\ntls_skip_verify: true` would otherwise inject keys into
 * the YAML file it writes. A single quote is still legal there, so it has to be
 * escaped here or it would terminate our quoting early.
 */
function quote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export interface InstallCommandInput {
  /** Worker base URL, i.e. `window.location.origin`. */
  origin: string;
  token: string;
  nodeName: string;
  /** Appended as `-r` when non-empty; the installer defaults it to empty. */
  region?: string | null;
}

/**
 * `curl -fsSL <install.sh> | sudo bash -s -- -s '<origin>' -t '<token>' -n '<name>' [-r '<region>']`
 *
 * `sudo` because the installer writes to `/usr/local/bin` and
 * `/etc/systemd/system`. The report interval and TLS flags keep their
 * installer defaults.
 */
export function buildInstallCommand({
  origin,
  token,
  nodeName,
  region,
}: InstallCommandInput): string {
  const args = [`-s ${quote(origin)}`, `-t ${quote(token)}`, `-n ${quote(nodeName)}`];

  const trimmedRegion = region?.trim() ?? '';
  if (trimmedRegion.length > 0) args.push(`-r ${quote(trimmedRegion)}`);

  return `curl -fsSL ${INSTALL_SCRIPT_URL} | sudo bash -s -- ${args.join(' ')}`;
}
