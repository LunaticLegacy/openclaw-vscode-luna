import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { t } from '../../i18n';
import { GatewayServiceConfig } from '../openclawConfig';
import { ServiceEventSink } from './types';

/**
 * GatewayTransport handles HTTP communication with the OpenClaw gateway service.
 * Provides methods for REST API calls and streaming requests with automatic
 * error handling and request/response interception.
 */
export class GatewayTransport {
    private readonly client: AxiosInstance;

    /**
     * Creates a new GatewayTransport instance.
     * @param config - Gateway service configuration including URL and token
     * @param emitEvent - Event sink for service events
     */
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

    /**
     * Checks if the gateway connection is healthy.
     * @returns True if connection is successful, false otherwise
     */
    public async checkConnection(): Promise<boolean> {
        try {
            const response = await this.client.get('/api/status', { timeout: 5000 });
            return response.status === 200;
        } catch {
            return false;
        }
    }

    /**
     * Sends a GET request to the gateway.
     * @param url - The URL path to request
     * @param config - Optional axios request configuration
     * @returns The response data
     */
    public async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
        const response = await this.client.get<T>(url, config);
        return response.data;
    }

    /**
     * Sends a POST request to the gateway.
     * @param url - The URL path to request
     * @param data - The request body data
     * @param config - Optional axios request configuration
     * @returns The response data
     */
    public async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
        const response = await this.client.post<T>(url, data, config);
        return response.data;
    }

    /**
     * Sends a PATCH request to the gateway.
     * @param url - The URL path to request
     * @param data - The request body data
     * @param config - Optional axios request configuration
     * @returns The response data
     */
    public async patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
        const response = await this.client.patch<T>(url, data, config);
        return response.data;
    }

    /**
     * Sends a DELETE request to the gateway.
     * @param url - The URL path to request
     * @param config - Optional axios request configuration
     */
    public async delete(url: string, config?: AxiosRequestConfig): Promise<void> {
        await this.client.delete(url, config);
    }

    /**
     * Sends a POST request and returns a streaming response.
     * @param url - The URL path to request
     * @param data - The request body data
     * @param config - Optional axios request configuration
     * @returns Async iterable of Buffer chunks
     */
    public async postStream(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<AsyncIterable<Buffer>> {
        const response = await this.client.post(url, data, {
            ...config,
            responseType: 'stream'
        });
        return response.data as AsyncIterable<Buffer>;
    }

    /**
     * Sets up request and response interceptors for logging.
     */
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

    /**
     * Handles HTTP errors and maps them to user-friendly messages.
     * @param error - The error to handle
     * @returns A formatted Error with status code
     */
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
