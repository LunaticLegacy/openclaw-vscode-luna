import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { t } from '../../i18n';
import { GatewayServiceConfig } from '../openclawConfig';
import { ServiceEventSink } from './types';

export class GatewayTransport {
    private readonly client: AxiosInstance;

    constructor(config: GatewayServiceConfig, private readonly emitEvent: ServiceEventSink) {
        this.client = axios.create({
            baseURL: config.gatewayUrl.replace(/\/$/, ''),
            timeout: 60000,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.gatewayToken}`
            }
        });
        this.setupInterceptors();
    }

    public async checkConnection(): Promise<boolean> {
        try {
            const response = await this.client.get('/api/status', { timeout: 5000 });
            return response.status === 200;
        } catch {
            return false;
        }
    }

    public async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
        const response = await this.client.get<T>(url, config);
        return response.data;
    }

    public async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
        const response = await this.client.post<T>(url, data, config);
        return response.data;
    }

    public async patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
        const response = await this.client.patch<T>(url, data, config);
        return response.data;
    }

    public async delete(url: string, config?: AxiosRequestConfig): Promise<void> {
        await this.client.delete(url, config);
    }

    public async postStream(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<AsyncIterable<Buffer>> {
        const response = await this.client.post(url, data, {
            ...config,
            responseType: 'stream'
        });
        return response.data as AsyncIterable<Buffer>;
    }

    private setupInterceptors(): void {
        this.client.interceptors.request.use(
            requestConfig => {
                this.emitEvent('request', requestConfig);
                return requestConfig;
            },
            error => {
                this.emitEvent('error', error);
                return Promise.reject(error);
            }
        );

        this.client.interceptors.response.use(
            response => {
                this.emitEvent('response', response);
                return response;
            },
            (error: unknown) => {
                this.emitEvent('error', error);
                return Promise.reject(this.handleError(error));
            }
        );
    }

    private handleError(error: unknown): Error {
        const maybeError = error as {
            response?: {
                status?: number;
                data?: { message?: string };
            };
            request?: unknown;
            message?: string;
        };

        if (maybeError.response) {
            const status = maybeError.response.status;
            const data = maybeError.response.data;
            const buildError = (message: string): Error => {
                const mapped = new Error(message) as Error & { status?: number };
                mapped.status = status;
                return mapped;
            };

            switch (status) {
                case 401:
                    return buildError(t('service.authFailed'));
                case 403:
                    return buildError(t('service.accessDenied'));
                case 404:
                    return buildError(data?.message || t('service.resourceNotFound'));
                case 429:
                    return buildError(t('service.rateLimit'));
                case 500:
                    return buildError(t('service.remoteError'));
                default:
                    return buildError(data?.message || t('service.httpError', {
                        status: status || 0,
                        message: maybeError.message || t('service.requestFailed')
                    }));
            }
        }

        if (maybeError.request) {
            return new Error(t('service.connectFailed'));
        }

        if (error instanceof Error) {
            return error;
        }

        return new Error(String(error));
    }
}
