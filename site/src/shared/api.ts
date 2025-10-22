import type { SignupRequest, SignupResponse } from "./types.js";

// Health check response
export interface HealthResponse {
	status: "healthy";
	timestamp: string;
}

// API interface - shared contract between client and server
export interface Api {
	// Health check (no auth required)
	health(): Promise<HealthResponse>;

	// Email signup (no auth required)
	signup(request: SignupRequest): Promise<SignupResponse>;
}

// Route definitions - used to auto-generate client and server
export interface RouteDefinition {
	method: "GET" | "POST" | "PATCH" | "DELETE";
	path: string;
	auth: boolean; // true = requires authentication
}

export const apiRoutes: Record<keyof Api, RouteDefinition> = {
	health: { method: "GET", path: "/health", auth: false },
	signup: { method: "POST", path: "/signup", auth: false },
};

// Helper types
export type ApiMethod = keyof Api;
export type ApiRequest<M extends ApiMethod> = Parameters<Api[M]>;
export type ApiResponse<M extends ApiMethod> = Awaited<ReturnType<Api[M]>>;
