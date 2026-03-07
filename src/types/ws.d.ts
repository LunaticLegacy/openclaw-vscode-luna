declare module 'ws' {
    import { EventEmitter } from 'events';

    export type RawData = string | Buffer | Buffer[];

    class WebSocket extends EventEmitter {
        static readonly OPEN: number;
        readyState: number;

        constructor(address: string);

        send(data: string, cb?: (error?: Error) => void): void;
        close(code?: number, data?: string): void;
        terminate(): void;

        on(event: 'message', listener: (data: RawData) => void): this;
        on(event: 'error', listener: (error: Error) => void): this;
        on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
    }

    export default WebSocket;
}
