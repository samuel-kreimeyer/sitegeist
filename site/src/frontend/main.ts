import type { ErrorResponse, SignupRequest, SignupResponse } from "../shared/types.js";

// Handle both signup forms
function setupSignupForm(
	formId: string,
	emailInputId: string,
	successMessageId: string,
	errorMessageId: string
) {
	const form = document.getElementById(formId) as HTMLFormElement;
	if (!form) return;

	const emailInput = emailInputId
		? document.getElementById(emailInputId) as HTMLInputElement
		: form.querySelector('input[type="email"]') as HTMLInputElement;
	const successMessage = document.getElementById(successMessageId) as HTMLDivElement;
	const errorMessage = document.getElementById(errorMessageId) as HTMLDivElement;
	const submitButton = form.querySelector('button[type="submit"]') as HTMLButtonElement;

	form.addEventListener("submit", async (e) => {
		e.preventDefault();

		const email = emailInput.value.trim();

		if (!email) {
			showError(errorMessage, successMessage, "Please enter your email address");
			return;
		}

		// Disable form while submitting
		submitButton.disabled = true;
		submitButton.textContent = "Submitting...";

		try {
			const response = await fetch("/api/signup", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ email } satisfies SignupRequest),
			});

			const data = (await response.json()) as SignupResponse | ErrorResponse;

			if (!response.ok) {
				const errorData = data as ErrorResponse;
				showError(errorMessage, successMessage, errorData.error || "Something went wrong. Please try again.");
				return;
			}

			// Success!
			showSuccess(form, successMessage, errorMessage);
		} catch (error) {
			console.error("Signup error:", error);
			showError(errorMessage, successMessage, "Network error. Please check your connection and try again.");
		} finally {
			submitButton.disabled = false;
			submitButton.textContent = "Notify Me";
		}
	});
}

function showSuccess(form: HTMLFormElement, successMessage: HTMLDivElement, errorMessage: HTMLDivElement) {
	// Hide the form permanently
	form.style.display = "none";

	// Show success message (don't auto-hide)
	successMessage.classList.add("visible");
	errorMessage.classList.remove("visible");
}

function showError(errorMessage: HTMLDivElement, successMessage: HTMLDivElement, message: string) {
	errorMessage.textContent = message;
	errorMessage.classList.add("visible");
	successMessage.classList.remove("visible");

	// Hide error message after 5 seconds
	setTimeout(() => {
		errorMessage.classList.remove("visible");
	}, 5000);
}

// Setup both forms
setupSignupForm("signup-form", "email-input", "success-message", "error-message");
setupSignupForm("signup-form-bottom", "", "success-message-bottom", "error-message-bottom");

// Rotating tagline words with fade
const taglineWords = ["automate", "scrape", "research", "transform", "create", "analyze"];
let currentWordIndex = 0;
const wordElement = document.getElementById("tagline-word");

if (wordElement) {
	setInterval(() => {
		wordElement.classList.add("fade-out");
		setTimeout(() => {
			currentWordIndex = (currentWordIndex + 1) % taglineWords.length;
			wordElement.textContent = taglineWords[currentWordIndex];
			wordElement.classList.remove("fade-out");
		}, 300);
	}, 2000);
}

// Rotating CTA words with fade
const ctaWords = ["automate", "scrape", "research", "transform", "create", "analyze"];
let currentCtaWordIndex = 0;
const ctaWordElement = document.getElementById("cta-word");

if (ctaWordElement) {
	setInterval(() => {
		ctaWordElement.classList.add("fade-out");
		setTimeout(() => {
			currentCtaWordIndex = (currentCtaWordIndex + 1) % ctaWords.length;
			ctaWordElement.textContent = ctaWords[currentCtaWordIndex];
			ctaWordElement.classList.remove("fade-out");
		}, 300);
	}, 2000);
}
