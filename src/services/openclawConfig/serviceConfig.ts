import * as vscode from 'vscode';

import {
    getExplicitModeHints,
    resolveGatewayConfig,
    resolveLocalConfig,
    resolveOpenClawCliConfig
} from './discovery';
import type { ResolvedServiceConfig } from './types';

/**
 * 内部函数：解析openclaw配置。
 * 根据用户设置的configMode和实际环境中可用的配置，决定最终使用哪个配置。
 * 
 * @param extensionPath 插件路径，用于解析相对路径配置项
 * @returns async，返回解析好的配置
 */
export async function resolveOpenClawServiceConfigInternal(extensionPath: string): Promise<ResolvedServiceConfig> {
    const config = vscode.workspace.getConfiguration('openclaw');   // 获取内容
    const configMode = config.get<'auto' | 'gateway' | 'local' | 'openclaw'>('configMode', 'openclaw'); // 默认使用openclaw cli模式
    const explicitModeHints = getExplicitModeHints(config); // 是否存在这些配置

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
