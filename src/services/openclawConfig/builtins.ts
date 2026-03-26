const freezeStringList = (values: string[]): readonly string[] => Object.freeze(values);

export const BUILTIN_OPENCLAW_AUTH_PROVIDER_IDS: readonly string[] = Object.freeze([
    'amazon-bedrock',
    'anthropic',
    'byteplus',
    'byteplus-plan',
    'cerebras',
    'cloudflare-ai-gateway',
    'gemini',
    'github-copilot',
    'google',
    'google-antigravity',
    'google-gemini-cli',
    'google-vertex',
    'groq',
    'huggingface',
    'kilocode',
    'kimi-coding',
    'litellm',
    'lmstudio',
    'minimax',
    'mistral',
    'moonshot',
    'nvidia',
    'ollama',
    'openai',
    'openai-codex',
    'opencode',
    'openrouter',
    'qianfan',
    'qwen-portal',
    'synthetic',
    'together',
    'venice',
    'vercel-ai-gateway',
    'vllm',
    'volcengine',
    'volcengine-plan',
    'xai',
    'xiaomi',
    'zai'
]);

const BUILTIN_OPENCLAW_DEFAULT_MODELS_BY_PROVIDER: Readonly<Record<string, readonly string[]>> = Object.freeze({
    'amazon-bedrock': freezeStringList([
        'amazon-bedrock/us.anthropic.claude-opus-4-6-v1:0'
    ]),
    anthropic: freezeStringList([
        'anthropic/claude-opus-4-6',
        'anthropic/claude-sonnet-4-6',
        'anthropic/claude-haiku-4-5'
    ]),
    byteplus: freezeStringList([
        'byteplus/seed-1-8-251228',
        'byteplus/kimi-k2-5-260127',
        'byteplus/glm-4-7-251222'
    ]),
    'byteplus-plan': freezeStringList([
        'byteplus-plan/ark-code-latest',
        'byteplus-plan/doubao-seed-code',
        'byteplus-plan/kimi-k2.5',
        'byteplus-plan/kimi-k2-thinking',
        'byteplus-plan/glm-4.7'
    ]),
    cerebras: freezeStringList([
        'cerebras/zai-glm-4.7',
        'cerebras/zai-glm-4.6'
    ]),
    'cloudflare-ai-gateway': freezeStringList([
        'cloudflare-ai-gateway/claude-sonnet-4-5'
    ]),
    gemini: freezeStringList([
        'google/gemini-3.1-pro-preview',
        'google/gemini-3-flash-preview',
        'google/gemini-3.1-flash-lite-preview'
    ]),
    'github-copilot': freezeStringList([
        'github-copilot/gpt-4o',
        'github-copilot/gpt-4.1'
    ]),
    google: freezeStringList([
        'google/gemini-3.1-pro-preview',
        'google/gemini-3-flash-preview',
        'google/gemini-3.1-flash-lite-preview'
    ]),
    'google-antigravity': freezeStringList([
        'google-antigravity/claude-opus-4-6-thinking',
        'google-antigravity/gemini-3-flash'
    ]),
    'google-gemini-cli': freezeStringList([]),
    'google-vertex': freezeStringList([
        'google-vertex/gemini-3.1-pro-preview',
        'google-vertex/gemini-3-flash-preview'
    ]),
    groq: freezeStringList([]),
    huggingface: freezeStringList([
        'huggingface/deepseek-ai/DeepSeek-R1',
        'huggingface/deepseek-ai/DeepSeek-V3.2',
        'huggingface/Qwen/Qwen3-8B',
        'huggingface/meta-llama/Llama-3.3-70B-Instruct'
    ]),
    kilocode: freezeStringList([
        'kilocode/kilo/auto',
        'kilocode/anthropic/claude-sonnet-4',
        'kilocode/openai/gpt-5.2',
        'kilocode/google/gemini-3-pro-preview'
    ]),
    'kimi-coding': freezeStringList([
        'kimi-coding/k2p5'
    ]),
    litellm: freezeStringList([
        'litellm/claude-opus-4-6',
        'litellm/gpt-4o'
    ]),
    lmstudio: freezeStringList([
        'lmstudio/minimax-m2.5-gs32'
    ]),
    minimax: freezeStringList([
        'minimax/MiniMax-M2.5',
        'minimax/MiniMax-M2.5-highspeed'
    ]),
    mistral: freezeStringList([
        'mistral/mistral-large-latest'
    ]),
    moonshot: freezeStringList([
        'moonshot/kimi-k2.5',
        'moonshot/kimi-k2-0905-preview',
        'moonshot/kimi-k2-turbo-preview',
        'moonshot/kimi-k2-thinking',
        'moonshot/kimi-k2-thinking-turbo'
    ]),
    nvidia: freezeStringList([
        'nvidia/nvidia/llama-3.1-nemotron-70b-instruct',
        'nvidia/meta/llama-3.3-70b-instruct',
        'nvidia/nvidia/mistral-nemo-minitron-8b-8k-instruct'
    ]),
    ollama: freezeStringList([
        'ollama/gpt-oss:20b',
        'ollama/llama3.3',
        'ollama/qwen2.5-coder:32b',
        'ollama/deepseek-r1:32b'
    ]),
    opencode: freezeStringList([
        'opencode/claude-opus-4-6'
    ]),
    openai: freezeStringList([
        'openai/gpt-5.4',
        'openai/gpt-5.4-pro',
        'openai/gpt-5-mini'
    ]),
    'openai-codex': freezeStringList([
        'openai-codex/gpt-5.4'
    ]),
    openrouter: freezeStringList([
        'openrouter/anthropic/claude-sonnet-4-5',
        'openrouter/openai/gpt-5',
        'openrouter/google/gemini-2.5-pro'
    ]),
    qianfan: freezeStringList([
        'qianfan/ernie-4.5-300b-a47b',
        'qianfan/deepseek-v3.1',
        'qianfan/deepseek-r1-0528'
    ]),
    'qwen-portal': freezeStringList([
        'qwen-portal/qwen3-coder-plus'
    ]),
    synthetic: freezeStringList([
        'synthetic/claude-sonnet-4-5',
        'synthetic/gpt-5.2'
    ]),
    together: freezeStringList([
        'together/deepseek-ai/DeepSeek-R1',
        'together/Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8',
        'together/openai/gpt-oss-120b'
    ]),
    venice: freezeStringList([
        'venice/deepseek-r1-671b'
    ]),
    'vercel-ai-gateway': freezeStringList([
        'vercel-ai-gateway/openai/gpt-5'
    ]),
    vllm: freezeStringList([
        'vllm/openai/gpt-oss-20b'
    ]),
    volcengine: freezeStringList([
        'volcengine/deepseek-v3.1',
        'volcengine/deepseek-r1-250528'
    ]),
    'volcengine-plan': freezeStringList([
        'volcengine-plan/seed-1.8',
        'volcengine-plan/doubao-seed-1.6',
        'volcengine-plan/doubao-seed-thinking'
    ]),
    xai: freezeStringList([
        'xai/grok-4'
    ]),
    xiaomi: freezeStringList([
        'xiaomi/mimo-v2-flash'
    ]),
    zai: freezeStringList([
        'zai/glm-5',
        'zai/glm-4.7',
        'zai/glm-4.6'
    ])
});

export function getBuiltInOpenClawAuthProviderIds(): string[] {
    return [...BUILTIN_OPENCLAW_AUTH_PROVIDER_IDS];
}

export function getBuiltInOpenClawDefaultModelsByProvider(): Record<string, string[]> {
    return Object.fromEntries(
        Object.entries(BUILTIN_OPENCLAW_DEFAULT_MODELS_BY_PROVIDER)
            .map(([providerId, modelRefs]: any) => [providerId, [...modelRefs]])
    );
}
