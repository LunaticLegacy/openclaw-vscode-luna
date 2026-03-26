import * as assert from 'assert/strict';
import { mapOpenClawUsage } from '../../services/openclaw/usageService';

suite('usageService', () => {
    test('maps OpenClaw usage by channel and day', () => {
        const usage = mapOpenClawUsage({
            sessions: [
                {
                    key: 'session-chat',
                    sessionId: 'session-chat',
                    agentId: 'agent-1',
                    channel: 'chat',
                    model: 'model-a',
                    usage: {
                        input: 80,
                        output: 20,
                        totalTokens: 100,
                        totalCost: 1.25,
                        dailyBreakdown: [
                            { date: '2026-03-09', tokens: 70, cost: 1.0 },
                            { date: '2026-03-10', tokens: 30, cost: 0.25 }
                        ],
                        dailyMessageCounts: [
                            { date: '2026-03-09', user: 2, total: 4 },
                            { date: '2026-03-10', user: 1, total: 2 }
                        ],
                        messageCounts: {
                            user: 3,
                            total: 6
                        }
                    }
                },
                {
                    key: 'session-cron',
                    sessionId: 'session-cron',
                    agentId: 'agent-2',
                    channel: 'cron',
                    model: 'model-b',
                    usage: {
                        input: 30,
                        output: 20,
                        totalTokens: 50,
                        totalCost: 0.75,
                        dailyBreakdown: [
                            { date: '2026-03-10', tokens: 50, cost: 0.75 }
                        ],
                        dailyMessageCounts: [
                            { date: '2026-03-10', user: 2, total: 3 }
                        ],
                        messageCounts: {
                            user: 2,
                            total: 3
                        }
                    }
                }
            ]
        }, undefined);

        assert.equal(usage.byChannel?.chat?.requests, 3);
        assert.equal(usage.byChannel?.chat?.tokens, 100);
        assert.equal(usage.byChannel?.cron?.requests, 2);
        assert.equal(usage.byChannel?.cron?.tokens, 50);
        assert.equal(usage.byChannelByDay?.['2026-03-09']?.chat?.requests, 2);
        assert.equal(usage.byChannelByDay?.['2026-03-09']?.chat?.tokens, 70);
        assert.equal(usage.byChannelByDay?.['2026-03-10']?.chat?.requests, 1);
        assert.equal(usage.byChannelByDay?.['2026-03-10']?.cron?.requests, 2);
        assert.equal(usage.byChannelByDay?.['2026-03-10']?.cron?.tokens, 50);
    });
});
