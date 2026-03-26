export interface ProgressReport {
    message?: string;
    increment?: number;
}

export interface ProgressReporter {
    report(value: ProgressReport): void;
}

export type WithProgressTask<T> = (progress: ProgressReporter) => Promise<T>;

export interface WebSocketServerOptions {
    port: number;
}

export interface GetOrCreateSessionOptions {
    refreshHistory?: boolean;
    sessionId?: string;
}

export type CapturedProgressRun<T> = (progressEvents: ProgressReport[]) => Promise<T>;

export type DebateStage =
    | 'broadcast'
    | 'opening'
    | `critique-${number}`
    | `revision-${number}`
    | `stop-check-${number}`
    | 'synthesis';

export interface SentMessageEntry {
    agentId: string;
    sessionId: string;
    stage: DebateStage;
    prompt: string;
}

export interface CollaborationFailure {
    agentId: string;
    stage: DebateStage;
}

export interface FakeCollaborationServiceOptions {
    appendTrailingEmptyAssistant?: boolean;
    stopAfterReviewRound?: number;
}
