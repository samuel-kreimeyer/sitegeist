import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { type CustomProvider, getAppStorage, SettingsTab } from "@mariozechner/pi-web-ui";
import { html, type TemplateResult } from "lit";
import { Ollama } from "ollama/browser";

export class OllamaSettingsTab extends SettingsTab {
	private url = "http://localhost:11434";
	private models: string[] = [];
	private selectedModel = "";
	private contextLength = 0;
	private status: "idle" | "loading" | "connected" | "error" = "idle";
	private errorMessage = "";

	getTabName(): string {
		return "Ollama";
	}

	override async connectedCallback() {
		super.connectedCallback();
		const storage = getAppStorage();
		this.url = (await storage.settings.get<string>("ollama.url")) || "http://localhost:11434";
		this.selectedModel = (await storage.settings.get<string>("ollama.model")) || "";
		this.contextLength = (await storage.settings.get<number>("ollama.contextLength")) || 0;
		await this.refreshModels();
	}

	async refreshModels() {
		this.status = "loading";
		this.requestUpdate();
		try {
			const ollama = new Ollama({ host: this.url });
			const { models } = await ollama.list();
			this.models = models.map((m) => m.name);
			this.status = "connected";
			if (this.selectedModel && !this.models.includes(this.selectedModel)) {
				this.selectedModel = this.models[0] || "";
			} else if (!this.selectedModel) {
				this.selectedModel = this.models[0] || "";
			}
		} catch (err) {
			this.status = "error";
			this.errorMessage = err instanceof Error ? err.message : "Cannot connect to Ollama";
			this.models = [];
		}
		this.requestUpdate();
	}

	private async saveUrl() {
		const storage = getAppStorage();
		await storage.settings.set("ollama.url", this.url);
		// Keep the CustomProvidersStore entry in sync so ModelSelector discovers models from the new URL
		const provider: CustomProvider = {
			id: "ollama-local",
			name: "ollama",
			type: "ollama",
			baseUrl: this.url,
		};
		await storage.customProviders.set(provider);
		await this.refreshModels();
	}

	async saveModel(model: string) {
		this.selectedModel = model;
		const storage = getAppStorage();
		await storage.settings.set("ollama.model", model);
		this.requestUpdate();
	}

	private async saveContextLength(value: number) {
		this.contextLength = value;
		const storage = getAppStorage();
		await storage.settings.set("ollama.contextLength", value);
	}

	getSelectedModel(): string {
		return this.selectedModel;
	}

	render(): TemplateResult {
		return html`
			<div class="flex flex-col gap-6">
				<div>
					<h3 class="text-sm font-semibold text-foreground mb-2">Ollama Server</h3>
					<p class="text-xs text-muted-foreground mb-3">
						Local Ollama instance. Default port is 11434.
						Make sure Ollama is running: <code class="font-mono">ollama serve</code>
					</p>
					<div class="flex gap-2">
						${Input({
							type: "text",
							value: this.url,
							placeholder: "http://localhost:11434",
							className: "flex-1",
							onInput: (e: Event) => {
								this.url = (e.target as HTMLInputElement).value;
							},
						})}
						${Button({
							variant: "outline",
							size: "sm",
							onClick: () => this.saveUrl(),
							children: "Connect",
						})}
					</div>
					<div class="mt-2 text-xs">
						${
							this.status === "connected"
								? html`<span class="text-green-600 dark:text-green-400">Connected — ${this.models.length} model(s) available</span>`
								: this.status === "loading"
									? html`<span class="text-muted-foreground">Connecting...</span>`
									: this.status === "error"
										? html`<span class="text-destructive">${this.errorMessage}</span>`
										: html``
						}
					</div>
				</div>

				${
					this.status === "connected" && this.models.length > 0
						? html`
						<div>
							<h3 class="text-sm font-semibold text-foreground mb-2">Model</h3>
							<div class="flex flex-col gap-2">
								${this.models.map(
									(model) => html`
										<label class="flex items-center gap-3 p-3 rounded-lg border cursor-pointer
											${model === this.selectedModel ? "border-primary bg-primary/5" : "border-border hover:border-border/80"}">
											<input
												type="radio"
												name="ollama-model"
												.checked=${model === this.selectedModel}
												@change=${() => this.saveModel(model)}
												class="accent-primary"
											/>
											<span class="text-sm text-foreground font-mono">${model}</span>
										</label>
									`,
								)}
							</div>
						</div>

						<div>
							<h3 class="text-sm font-semibold text-foreground mb-1">Context Length</h3>
							<p class="text-xs text-muted-foreground mb-2">
								Maximum tokens sent to the model per request (context window).
								Set to 0 to use the value reported by Ollama for the model.
								To change the actual inference context Ollama allocates, set
								<code class="font-mono">num_ctx</code> in the model's Modelfile.
							</p>
							${Input({
								type: "number",
								value: String(this.contextLength),
								placeholder: "0 (use model default)",
								onInput: (e: Event) => {
									const v = Number.parseInt((e.target as HTMLInputElement).value, 10) || 0;
									this.saveContextLength(v);
								},
							})}
						</div>
					`
						: html``
				}

				${
					this.status === "error"
						? html`
						<div class="p-3 rounded-lg bg-secondary/20 border border-border text-xs text-muted-foreground">
							Ensure Ollama is running and accessible at the URL above.
						</div>
					`
						: html``
				}
			</div>
		`;
	}
}

if (!customElements.get("ollama-settings-tab")) {
	customElements.define("ollama-settings-tab", OllamaSettingsTab);
}
