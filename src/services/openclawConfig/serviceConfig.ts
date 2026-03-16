import * as vscode from 'vscode';

import {
    getExplicitModeHints,
    resolveGatewayConfig,
    resolveLocalConfig,
    resolveOpenClawCliConfig
} from './discovery';
import type { ResolvedServiceConfig } from './types';

export async function resolveOpenClawServiceConfigInternal(extensionPath: string): Promise<ResolvedServiceConfig> {
    const config = vscode.workspace.getConfiguration('openclaw');
    const configMode = config.get<'auto' | 'gateway' | 'local' | 'openclaw'>('configMode', 'openclaw');
    const explicitModeHints = getExplicitModeHints(config);

    const openClawCli = await resolveOpenClawCliConfig(config, extensionPath);
    const localConfig = await resolveLocalConfig(config, extensionPath);
    const gatewayConfig = await resolveGatewayConfig(config, extensionPath);

    switch (configMode) {
        case 'openclaw':
            if (openClawCli) {
                return openClawCli;
            }
            break;
        case 'local':
            if (localConfig) {
                return localConfig;
            }
            break;
        case 'gateway':
            return gatewayConfig;
        case 'auto':
        default:
            if (explicitModeHints.openclaw && openClawCli) {
                return openClawCli;
            }
            if (explicitModeHints.local && localConfig) {
                return localConfig;
            }
            if (openClawCli) {
                return openClawCli;
            }
            if (localConfig) {
                return localConfig;
            }
            if (explicitModeHints.gateway) {
                return gatewayConfig;
            }
            break;
    }

    return gatewayConfig;
}
