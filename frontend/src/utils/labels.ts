/**
 * Label mappings for server configuration fields.
 * Maps section and key to human-readable labels with proper capitalization.
 */

export const labelMap: Record<string, Record<string, string>> = {
  connection: {
    type: 'Type',
    gateway_ip: 'Gateway IP',
    gateway_port: 'Gateway Port',
    local_ip: 'Local IP',
    individual_address: 'Individual Address',
    route_back: 'Route Back',
    multicast_group: 'Multicast Group',
    multicast_port: 'Multicast Port',
    live_source: 'Live Source',
  },
  security: {
    knxkeys_file: 'KNX Keys File',
    knxkeys_password: 'KNX Keys Password',
    user_id: 'User ID',
    user_password: 'User Password',
    device_password: 'Device Password',
    backbone_key: 'Backbone Key',
    latency_ms: 'Latency (ms)',
  },
};

/**
 * Get a human-readable label for a configuration key.
 * Falls back to replacing underscores with spaces if not found in the map.
 */
export const getLabel = (section: string, key: string): string => {
  return labelMap[section]?.[key] ?? key.replace(/_/g, ' ');
};

/**
 * Extract filename from a file path.
 * Handles both Unix (/) and Windows (\) path separators.
 */
export const getFileName = (filePath: string | null | undefined): string | null => {
  if (!filePath) return null;
  return filePath.split(/[/\\]/).pop() ?? null;
};
