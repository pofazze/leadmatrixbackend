// This file exports TypeScript types and interfaces used throughout the client application for type safety.

export interface MessageVariation {
    id: string;
    originalMessage: string;
    variedMessage: string;
    createdAt: Date;
}

export interface ApiResponse<T> {
    success: boolean;
    data: T;
    error?: string;
}

export interface OpenAIRequest {
    prompt: string;
    maxTokens?: number;
    temperature?: number;
}

export interface OpenAIResponse {
    id: string;
    choices: Array<{
        text: string;
        index: number;
    }>;
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}