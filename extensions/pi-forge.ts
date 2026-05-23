/**
 * Pi Forge extension for Pi Coding Agent.
 *
 * This attaches Pi Forge to interactive Pi sessions. Kimi (via pi-kimi-coder)
 * remains the coding agent; Pi Forge supplies planning, status, and gate tools.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExecResult } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

const GoalParams = Type.Object({
	goal: Type.String({ description: "The implementation goal to pass to Pi Forge." }),
});

const StatusParams = Type.Object({
	goalId: Type.Optional(Type.String({ description: "Optional Pi Forge goal id to inspect." })),
});

const EmptyParams = Type.Object({});

interface ForgeCommandResult {
	command: string;
	args: string[];
	cwd: string;
	code: number;
	killed: boolean;
	stdout: string;
	stderr: string;
}

export default function piForgeExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "pi_forge_plan",
		label: "Pi Forge Plan",
		description:
			"Run Pi Forge in dry-run mode to decompose a goal into proof-carrying tasks. Use this before making code changes for a Forge-driven workflow.",
		promptSnippet: "pi_forge_plan - Decompose a goal with Pi Forge before implementing it.",
		promptGuidelines: [
			"For Forge workflows, call pi_forge_plan first, then implement with normal Pi tools.",
			"Pi Forge uses the Pi SDK worker to generate code inside isolated git worktrees when available.",
		],
		parameters: GoalParams,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const result = await runForge(pi, ctx, ["forge", params.goal, "--config", "config.yaml", "--dry-run"], signal);
			return toolResult(result);
		},
	});

	pi.registerTool({
		name: "pi_forge_run",
		label: "Pi Forge Run",
		description:
			"Run the Pi Forge batch orchestrator for a goal. Pi Forge will spawn an agent session per task to edit files in isolated worktrees when the Pi SDK is available.",
		promptSnippet: "pi_forge_run - Run the Pi Forge batch harness for a goal.",
		parameters: GoalParams,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const result = await runForge(pi, ctx, ["forge", params.goal, "--config", "config.yaml"], signal);
			return toolResult(result);
		},
	});

	pi.registerTool({
		name: "pi_forge_status",
		label: "Pi Forge Status",
		description: "Show Pi Forge task graph and evidence status, optionally for a specific goal id.",
		promptSnippet: "pi_forge_status - Inspect saved Pi Forge task graphs and evidence ledgers.",
		parameters: StatusParams,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const args = ["status"];
			if (params.goalId) args.push("--goal", params.goalId);
			const result = await runForge(pi, ctx, args, signal);
			return toolResult(result);
		},
	});

	pi.registerTool({
		name: "pi_forge_check",
		label: "Pi Forge Check",
		description: "Run Pi Forge repository quality gates with npm run check.",
		promptSnippet: "pi_forge_check - Run the repo's typecheck, lint, and test gates.",
		parameters: EmptyParams,
		async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
			const root = findForgeRoot(ctx.cwd);
			const result = await exec(pi, "npm", ["run", "check"], root, signal);
			return toolResult(result);
		},
	});

	pi.registerCommand("forge", {
		description: "Start a Pi Forge-guided implementation workflow",
		handler: async (args, ctx) => {
			const goal = args.trim();
			if (!goal) {
				ctx.ui.notify("Usage: /forge <goal>", "warning");
				return;
			}
			if (!ctx.isIdle()) {
				ctx.ui.notify("Agent is busy. Send /forge again when the current turn finishes.", "warning");
				return;
			}

			pi.sendUserMessage(buildForgeKickoff(goal));
		},
	});

	pi.registerCommand("forge-plan", {
		description: "Ask the agent to run only the Pi Forge dry-run planner",
		handler: async (args, ctx) => {
			const goal = args.trim();
			if (!goal) {
				ctx.ui.notify("Usage: /forge-plan <goal>", "warning");
				return;
			}
			if (!ctx.isIdle()) {
				ctx.ui.notify("Agent is busy. Send /forge-plan again when the current turn finishes.", "warning");
				return;
			}
			pi.sendUserMessage(`Call pi_forge_plan for this goal and summarize the task graph without editing files:\n\n${goal}`);
		},
	});

	pi.registerCommand("forge-status", {
		description: "Ask the agent to inspect Pi Forge saved state",
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Agent is busy. Send /forge-status again when the current turn finishes.", "warning");
				return;
			}
			const goalId = args.trim();
			const instruction = goalId
				? `Call pi_forge_status with goalId ${JSON.stringify(goalId)} and summarize the state.`
				: "Call pi_forge_status and summarize the active Pi Forge goals.";
			pi.sendUserMessage(instruction);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.hasUI && isForgeRoot(findForgeRoot(ctx.cwd))) {
			const modelName = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no model selected";
			ctx.ui.notify(`Pi Forge tools loaded (${modelName})`, "info");
		}
	});
}

function buildForgeKickoff(goal: string): string {
	return [
		"Run this as a Pi Forge-guided implementation.",
		"",
		`Goal: ${goal}`,
		"",
		"Workflow:",
		"1. Call pi_forge_plan for the goal and use the returned task graph as the implementation checklist.",
		"2. Pi Forge spawns a Pi SDK agent in each task worktree to generate code. You can also use normal Pi tools to inspect and edit files.",
		"3. Keep changes scoped to the planned tasks and preserve unrelated user changes.",
		"4. Run pi_forge_check before reporting completion.",
		"5. Summarize the plan, changed files, gate results, and any remaining risks.",
	].join("\n");
}

async function runForge(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	forgeArgs: string[],
	signal: AbortSignal | undefined
): Promise<ForgeCommandResult> {
	const root = findForgeRoot(ctx.cwd);
	const { command, args } = resolveForgeExecutable(root, forgeArgs);
	return exec(pi, command, args, root, signal);
}

async function exec(
	pi: ExtensionAPI,
	command: string,
	args: string[],
	cwd: string,
	signal: AbortSignal | undefined
): Promise<ForgeCommandResult> {
	const result = await pi.exec(command, args, {
		cwd,
		signal,
		timeout: DEFAULT_TIMEOUT_MS,
	});
	return normalizeExecResult(command, args, cwd, result);
}

function normalizeExecResult(command: string, args: string[], cwd: string, result: ExecResult): ForgeCommandResult {
	return {
		command,
		args,
		cwd,
		code: result.code,
		killed: result.killed,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

function resolveForgeExecutable(root: string, forgeArgs: string[]): { command: string; args: string[] } {
	if (existsSync(join(root, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx"))) {
		return { command: "npm", args: ["run", "dev", "--", ...forgeArgs] };
	}

	const builtCli = join(root, "dist", "cli", "index.js");
	if (existsSync(builtCli)) {
		return { command: "node", args: [builtCli, ...forgeArgs] };
	}
	return { command: "npm", args: ["run", "dev", "--", ...forgeArgs] };
}

function toolResult(result: ForgeCommandResult) {
	const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
	const text = [
		`Command: ${formatCommand(result.command, result.args)}`,
		`CWD: ${result.cwd}`,
		`Exit code: ${result.code}${result.killed ? " (killed)" : ""}`,
		output ? "" : undefined,
		output || "(no output)",
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");

	return {
		content: [{ type: "text" as const, text }],
		details: result,
	};
}

function formatCommand(command: string, args: string[]): string {
	return [command, ...args.map((arg) => JSON.stringify(arg))].join(" ");
}

function findForgeRoot(startDir: string): string {
	let dir = startDir;
	while (true) {
		if (isForgeRoot(dir)) return dir;
		const parent = dirname(dir);
		if (parent === dir) return startDir;
		dir = parent;
	}
}

function isForgeRoot(dir: string): boolean {
	const packagePath = join(dir, "package.json");
	const configPath = join(dir, "config.yaml");
	if (!existsSync(packagePath) || !existsSync(configPath)) return false;

	try {
		const parsed = JSON.parse(readFileSync(packagePath, "utf-8")) as { name?: string };
		return parsed.name === "pi-forge";
	} catch {
		return false;
	}
}
