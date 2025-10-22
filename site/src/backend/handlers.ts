import type { Api, HealthResponse } from "../shared/api.js";
import type { EmailSignup, SignupRequest, SignupResponse } from "../shared/types.js";
import type { FileStore } from "./storage.js";

// Email validation regex (basic)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Create API handlers
 */
export function createHandlers(signupsStore: FileStore<EmailSignup[] | string>): Api {
	return {
		async health(): Promise<HealthResponse> {
			return {
				status: "healthy",
				timestamp: new Date().toISOString(),
			};
		},

		async signup(request: SignupRequest): Promise<SignupResponse> {
			const { email } = request;

			// Validate email format
			if (!email || typeof email !== "string") {
				throw new Error("Email is required");
			}

			if (!EMAIL_REGEX.test(email)) {
				throw new Error("Invalid email format");
			}

			// Get current signups array
			const signups = (signupsStore.getItem("signups") as EmailSignup[]) || [];

			// Check if email already exists
			const existingSignup = signups.find((signup) => signup.email.toLowerCase() === email.toLowerCase());

			if (existingSignup) {
				// Don't reveal that email is already registered - return success
				console.log(`✓ Duplicate signup attempt: ${email}`);
				return {
					success: true,
				};
			}

			// Create new signup
			const signup: EmailSignup = {
				email: email.toLowerCase(),
				timestamp: new Date().toISOString(),
				notified: false,
			};

			// Add to array and save
			signups.push(signup);
			signupsStore.setItem("signups", signups);

			console.log(`✓ New signup: ${signup.email}`);

			return {
				success: true,
			};
		},
	};
}
