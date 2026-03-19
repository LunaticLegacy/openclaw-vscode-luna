export const MEMORY_LAYOUT = {
    core: 'core',
    agents: 'agents',
    swarm: 'swarm',
    logs: 'logs',
    snapshots: 'snapshots',
    exports: 'exports',
    presets: 'presets',
    meta: 'meta'
} as const;

export const CORE_FILES = {
    soul: 'SOUL.md',
    user: 'USER.md',
    system: 'SYSTEM.md',
    identity: 'IDENTITY.md'
} as const;

export const AGENT_SETTINGS_FILE = '.openclaw-vscode-agent.json';

export const MEMORY_LAYOUT_VERSION = '1.0.0';
