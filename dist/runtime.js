import { $ as assertPersistedKeyPolicy, A as reconcileAgentSessionId, At as withTimeout, Bt as isAcpResourceNotFoundError, C as trimConversationForRuntime, D as sessionOptionsFromRecord, E as persistSessionOptions, I as isRequestedModelUnsupportedError, It as formatErrorMessage, L as modelStateFromConfigOptions, Lt as isRetryablePromptError, M as REQUESTED_MODEL_UNSUPPORTED_ERROR_CODE, Mt as listBuiltInAgents, N as REQUESTED_MODEL_UNSUPPORTED_REASONS, O as applyConversation, P as RequestedModelUnsupportedError, Pt as resolveAgentCommand, Q as writeSessionRecord, Qt as asRecord, S as recordSessionUpdate, Xt as SESSION_RECORD_SCHEMA, Z as resolveSessionRecord, Zt as asOptionalString, _ as cloneSessionAcpxState, a as withConnectedSession, an as SessionNotFoundError$1, b as recordClientOperation, c as currentModelIdFromSetModelResponse, ct as parseSessionRecord, d as setDesiredConfigOption, en as deriveAgentFromSessionKey, f as setDesiredModeId, ft as defaultSessionEventLog, g as applyConfigOptionsToState, h as applyConfigOptionsToRecord, i as runPromptTurn, j as AcpClient, jt as DEFAULT_AGENT_NAME, k as applyLifecycleSnapshotToRecord, l as clearDesiredConfigOption, lt as parsePromptEventLine, m as syncAdvertisedModelState, n as SessionEventWriter, o as connectAndLoadSession, p as setDesiredModelId, r as listSessionEvents, s as applyRequestedModelIfAdvertised, t as LiveSessionCheckpoint, u as setCurrentModelId, ut as serializeSessionRecordForDisk, v as cloneSessionConversation, w as advertisedModelState, x as recordPromptSubmission, y as createSessionConversation, zt as extractAcpError } from "./live-checkpoint-CRnvPQAH.js";
import path from "node:path";
import { RequestError } from "@agentclientprotocol/sdk";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
//#region src/session/event-store/from-acp.ts
const LIFTERS = {
	agent_message_chunk: (u, seq, ts) => [{
		kind: "agent_message_chunk",
		seq,
		ts,
		content: u.content
	}],
	user_message_chunk: (u, seq, ts) => [{
		kind: "user_message_chunk",
		seq,
		ts,
		content: u.content
	}],
	agent_thought_chunk: (u, seq, ts) => [{
		kind: "agent_thought_chunk",
		seq,
		ts,
		content: u.content
	}],
	tool_call: (u, seq, ts) => [{
		kind: "tool_call",
		seq,
		ts,
		toolCallId: u.toolCallId,
		title: u.title,
		toolKind: u.kind,
		status: u.status,
		content: u.content,
		locations: u.locations,
		rawInput: u.rawInput,
		rawOutput: u.rawOutput
	}],
	tool_call_update: (u, seq, ts) => [{
		kind: "tool_call_update",
		seq,
		ts,
		toolCallId: u.toolCallId,
		title: u.title ?? void 0,
		toolKind: u.kind ?? void 0,
		status: u.status ?? void 0,
		content: u.content ?? void 0,
		locations: u.locations ?? void 0,
		rawInput: u.rawInput,
		rawOutput: u.rawOutput
	}],
	available_commands_update: (u, seq, ts) => [{
		kind: "available_commands_update",
		seq,
		ts,
		availableCommands: u.availableCommands
	}],
	current_mode_update: (u, seq, ts) => [{
		kind: "current_mode_update",
		seq,
		ts,
		currentModeId: u.currentModeId
	}],
	config_option_update: (u, seq, ts) => {
		let s = seq;
		return u.configOptions.map((opt) => ({
			kind: "config_option_update",
			seq: s++,
			ts,
			configId: opt.id,
			value: opt.currentValue
		}));
	},
	session_info_update: (u, seq, ts) => [{
		kind: "session_info_update",
		seq,
		ts,
		info: {
			title: u.title,
			updatedAt: u.updatedAt
		}
	}],
	usage_update: (u, seq, ts) => [{
		kind: "usage_update",
		seq,
		ts,
		usage: {
			used: u.used,
			size: u.size,
			cost: u.cost
		}
	}],
	plan: (u, seq, ts) => [{
		kind: "plan",
		seq,
		ts,
		entries: u.entries
	}],
	plan_update: (u, seq, ts) => [{
		kind: "plan_update",
		seq,
		ts,
		plan: u.plan
	}],
	plan_removed: (u, seq, ts) => [{
		kind: "plan_removed",
		seq,
		ts,
		id: u.id
	}]
};
function fromAcp(update, seq, ts) {
	const lifter = LIFTERS[update.sessionUpdate];
	if (!lifter) return [];
	return lifter(update, seq, ts);
}
//#endregion
//#region src/runtime/public/errors.ts
var AcpRuntimeError = class extends Error {
	code;
	cause;
	constructor(code, message, options) {
		super(message);
		this.name = "AcpRuntimeError";
		this.code = code;
		this.cause = options?.cause;
	}
};
function isAcpRuntimeError(value) {
	return value instanceof AcpRuntimeError;
}
//#endregion
//#region src/runtime/engine/bus.ts
const DEFAULT_QUEUE_CAP = 1024;
function createBus(options = {}) {
	const cap = options.queueCap ?? DEFAULT_QUEUE_CAP;
	const handlers = /* @__PURE__ */ new Set();
	const iterators = /* @__PURE__ */ new Set();
	function dispatch(ev) {
		for (const h of handlers) try {
			h(ev);
		} catch {}
		for (const it of iterators) pushIntoIterator(it, ev, cap);
	}
	function subscribe(handler) {
		handlers.add(handler);
		return () => {
			handlers.delete(handler);
		};
	}
	function iterate() {
		return { [Symbol.asyncIterator]() {
			const it = {
				queue: [],
				pending: [],
				closed: false
			};
			iterators.add(it);
			return {
				next() {
					if (it.closed) return Promise.resolve({
						value: void 0,
						done: true
					});
					if (it.queue.length > 0) return Promise.resolve({
						value: it.queue.shift(),
						done: false
					});
					return new Promise((resolve) => {
						it.pending.push(resolve);
					});
				},
				return() {
					it.closed = true;
					iterators.delete(it);
					for (const resolve of it.pending) resolve({
						value: void 0,
						done: true
					});
					it.pending.length = 0;
					return Promise.resolve({
						value: void 0,
						done: true
					});
				}
			};
		} };
	}
	return {
		subscribe,
		dispatch,
		iterate
	};
}
function pushIntoIterator(it, ev, cap) {
	if (it.pending.length > 0) {
		it.pending.shift()?.({
			value: ev,
			done: false
		});
		return;
	}
	if (it.queue.length >= cap) {
		it.queue.shift();
		console.warn(`acpx bus: dropped oldest event (queue cap ${cap} exceeded)`);
	}
	it.queue.push(ev);
}
//#endregion
//#region src/runtime/engine/reuse-policy.ts
function shouldReuseExistingRecord(record, params) {
	if (record.acpx?.reset_on_next_ensure === true) return false;
	if (path.resolve(record.cwd) !== path.resolve(params.cwd)) return false;
	if (record.agentCommand !== params.agentCommand) return false;
	if (params.resumeSessionId && record.acpSessionId !== params.resumeSessionId) return false;
	return true;
}
//#endregion
//#region src/runtime/engine/manager.ts
function createDeferred() {
	let resolve;
	let reject;
	return {
		promise: new Promise((res, rej) => {
			resolve = res;
			reject = rej;
		}),
		resolve,
		reject
	};
}
var AsyncEventQueue = class {
	items = [];
	waits = [];
	closed = false;
	push(item) {
		if (this.closed) return;
		const waiter = this.waits.shift();
		if (waiter) {
			waiter.resolve(item);
			return;
		}
		this.items.push(item);
	}
	close() {
		if (this.closed) return;
		this.closed = true;
		for (const waiter of this.waits.splice(0)) waiter.resolve(null);
	}
	clear() {
		this.items.length = 0;
	}
	async next() {
		if (this.items.length > 0) return this.items.shift() ?? null;
		if (this.closed) return null;
		const waiter = createDeferred();
		this.waits.push(waiter);
		return await waiter.promise;
	}
	async *iterate() {
		while (true) {
			const next = await this.next();
			if (!next) return;
			yield next;
		}
	}
};
function isoNow() {
	return (/* @__PURE__ */ new Date()).toISOString();
}
function isUnsupportedSessionCloseError(error) {
	const acp = extractAcpError(error);
	if (!acp) return false;
	if (acp.code === -32601 || acp.code === -32602) return true;
	if (acp.code !== -32603 || !acp.data || typeof acp.data !== "object") return false;
	const details = acp.data.details;
	return typeof details === "string" && details.toLowerCase().includes("invalid params");
}
function createInitialRecord(params) {
	const now = isoNow();
	return {
		schema: "acpx.session.v1",
		acpxRecordId: params.recordId,
		acpSessionId: params.sessionId,
		agentSessionId: params.agentSessionId,
		agentCommand: params.agentCommand,
		cwd: params.cwd,
		name: params.sessionName,
		createdAt: now,
		lastUsedAt: now,
		lastSeq: 0,
		eventLog: defaultSessionEventLog(params.recordId),
		closed: false,
		closedAt: void 0,
		...createSessionConversation(now),
		acpx: {}
	};
}
function createRecordId(sessionKey, mode) {
	if (mode === "persistent") return sessionKey;
	return `${sessionKey}:oneshot:${randomUUID()}`;
}
function resumePolicyForSessionMode(mode) {
	return mode === "persistent" ? "same-session-only" : "allow-new";
}
function legacyTerminalEventFromTurnResult(result) {
	if (result.status === "failed") return {
		type: "error",
		...result.error
	};
	return {
		type: "done",
		...result.stopReason ? { stopReason: result.stopReason } : {}
	};
}
function readDetailCode(meta) {
	const value = meta?.detailCode;
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
function statusSummary(record) {
	return [
		`session=${record.acpxRecordId}`,
		`backendSessionId=${record.acpSessionId}`,
		record.agentSessionId ? `agentSessionId=${record.agentSessionId}` : null,
		record.pid != null ? `pid=${record.pid}` : null,
		record.closed ? "closed" : "open"
	].filter(Boolean).join(" ");
}
function isSessionConfigSelectOption(value) {
	return typeof value === "object" && value !== null && typeof value.value === "string";
}
function flattenSelectOptions(option) {
	if (option.type !== "select") return [];
	const flat = [];
	for (const entry of option.options) {
		if (isSessionConfigSelectOption(entry)) {
			flat.push(entry);
			continue;
		}
		const groupOptions = entry.options;
		if (Array.isArray(groupOptions)) {
			for (const groupOption of groupOptions) if (isSessionConfigSelectOption(groupOption)) flat.push(groupOption);
		}
	}
	return flat;
}
function modelIdsFromConfigOptions(record) {
	const options = record.acpx?.config_options;
	if (!options) return;
	const modelOption = options.find((option) => option.category === "model" && option.type === "select");
	if (!modelOption) return;
	const flatOptions = flattenSelectOptions(modelOption);
	if (flatOptions.length === 0) return;
	return flatOptions.map((entry) => entry.value);
}
function buildModelsField(record) {
	const currentModelId = record.acpx?.current_model_id;
	const advertised = modelIdsFromConfigOptions(record) ?? record.acpx?.available_models;
	if (!advertised || advertised.length === 0) return currentModelId === void 0 ? {} : { models: {
		currentModelId,
		availableModelIds: []
	} };
	return { models: {
		...currentModelId !== void 0 ? { currentModelId } : {},
		availableModelIds: [...advertised]
	} };
}
function tokenUsageToBreakdown(usage) {
	if (!usage) return;
	const breakdown = {};
	assignUsageBreakdownField(breakdown, "inputTokens", usage.input_tokens);
	assignUsageBreakdownField(breakdown, "outputTokens", usage.output_tokens);
	assignUsageBreakdownField(breakdown, "cachedReadTokens", usage.cache_read_input_tokens);
	assignUsageBreakdownField(breakdown, "cachedWriteTokens", usage.cache_creation_input_tokens);
	assignUsageBreakdownField(breakdown, "thoughtTokens", usage.thought_tokens);
	assignUsageBreakdownField(breakdown, "totalTokens", usage.total_tokens);
	return Object.keys(breakdown).length > 0 ? breakdown : void 0;
}
function assignUsageBreakdownField(breakdown, key, value) {
	if (value !== void 0) breakdown[key] = value;
}
function buildUsageField(record) {
	const cumulative = tokenUsageToBreakdown(record.cumulative_token_usage);
	const perRequestEntries = Object.entries(record.request_token_usage ?? {}).map(([id, value]) => [id, tokenUsageToBreakdown(value)]).filter((entry) => entry[1] !== void 0);
	const perRequest = perRequestEntries.length > 0 ? Object.fromEntries(perRequestEntries) : void 0;
	const cost = record.cumulative_cost;
	const usage = {
		...cumulative ? { cumulative } : {},
		...cost ? { cost } : {},
		...perRequest ? { perRequest } : {}
	};
	return Object.keys(usage).length > 0 ? { usage } : {};
}
function buildAvailableCommandsField(record) {
	const commands = record.acpx?.available_commands;
	if (!commands || commands.length === 0) return {};
	return { availableCommands: commands };
}
function advertisedConfigOptionIds(record) {
	const configOptions = record.acpx?.config_options;
	if (!configOptions) return;
	return new Set(configOptions.map((option) => option.id).filter((id) => typeof id === "string" && id.trim().length > 0));
}
function resolveSupportedConfigOptionId(record, configId) {
	const advertisedIds = advertisedConfigOptionIds(record);
	if (!advertisedIds) return configId;
	if (advertisedIds.has(configId)) return configId;
	if (configId === "thinking" && advertisedIds.has("effort")) return "effort";
	const supported = [...advertisedIds].toSorted();
	const supportedText = supported.length > 0 ? supported.join(", ") : "none";
	throw new AcpRuntimeError("ACP_BACKEND_UNSUPPORTED_CONTROL", `ACP session ${record.acpxRecordId} does not advertise config option '${configId}'. Supported config options: ${supportedText}.`);
}
function applyConfigOptionResponseToTurn(turn, response) {
	if (!response?.configOptions) return;
	turn.acpxState = applyConfigOptionsToState(turn.acpxState, response.configOptions);
}
function applyDesiredConfigOptionToTurn(turn, configId, value) {
	const nextState = cloneSessionAcpxState(turn.acpxState) ?? {};
	if (configId === modelStateFromConfigOptions(nextState.config_options)?.configId) {
		nextState.session_options = {
			...nextState.session_options,
			model: value
		};
		clearDesiredConfigOption(nextState, configId);
	} else if (configId === "mode") nextState.desired_mode_id = value;
	else nextState.desired_config_options = {
		...nextState.desired_config_options,
		[configId]: value
	};
	turn.acpxState = nextState;
}
function applyDesiredConfigOptionToRecord(record, configId, value) {
	if (configId === modelStateFromConfigOptions(record.acpx?.config_options)?.configId) setDesiredModelId(record, value, configId);
	else if (configId === "mode") setDesiredModeId(record, value);
	else setDesiredConfigOption(record, configId, value);
}
async function createOrLoadRuntimeSession(client, resumeSessionId, cwd) {
	if (resumeSessionId) {
		if (client.supportsResumeSession()) {
			const resumed = await client.resumeSession(resumeSessionId, cwd);
			return {
				sessionId: resumeSessionId,
				agentSessionId: resumed.agentSessionId,
				sessionResult: resumed
			};
		}
		if (!client.supportsLoadSession()) throw new Error(`Agent does not support session/resume or session/load; cannot resume session ${resumeSessionId}`);
		const loaded = await client.loadSession(resumeSessionId, cwd);
		return {
			sessionId: resumeSessionId,
			agentSessionId: loaded.agentSessionId,
			sessionResult: loaded
		};
	}
	const created = await client.createSession(cwd);
	return {
		sessionId: created.sessionId,
		agentSessionId: created.agentSessionId,
		sessionResult: created
	};
}
var AcpRuntimeManager = class {
	options;
	deps;
	activeControllers = /* @__PURE__ */ new Map();
	pendingPersistentClients = /* @__PURE__ */ new Map();
	closingActiveRecords = /* @__PURE__ */ new Set();
	bus = createBus();
	acpxSeq = 0;
	constructor(options, deps = {}) {
		this.options = options;
		this.deps = deps;
	}
	onEvent(handler) {
		return this.bus.subscribe(handler);
	}
	events() {
		return this.bus.iterate();
	}
	dispatchEvent(ev) {
		this.bus.dispatch(ev);
	}
	createClient(options) {
		return this.deps.clientFactory?.(options) ?? new AcpClient(options);
	}
	async readPendingPersistentClient(record, options) {
		const pendingClient = this.pendingPersistentClients.get(record.acpxRecordId);
		if (!pendingClient) return;
		if (!pendingClient.hasReusableSession(record.acpSessionId)) {
			this.pendingPersistentClients.delete(record.acpxRecordId);
			await pendingClient.close().catch(() => {});
			return;
		}
		if (options.consume) this.pendingPersistentClients.delete(record.acpxRecordId);
		return pendingClient;
	}
	async closePendingPersistentClient(recordId) {
		const pendingClient = this.pendingPersistentClients.get(recordId);
		if (!pendingClient) return;
		this.pendingPersistentClients.delete(recordId);
		await pendingClient.close().catch(() => {});
	}
	async refreshClosedState(record) {
		if (!this.closingActiveRecords.has(record.acpxRecordId)) return record.closed === true;
		const latest = await this.options.sessionStore.load(record.acpxRecordId).catch(() => void 0);
		record.closed = true;
		record.closedAt = latest?.closedAt ?? record.closedAt ?? isoNow();
		if (latest?.acpx) record.acpx = {
			...record.acpx,
			...latest.acpx
		};
		return true;
	}
	async retainPersistentClientAfterTurn(input) {
		const { record, client } = input;
		if (!!record.acpxRecordId.includes(":oneshot:") || record.closed || !client.hasReusableSession(record.acpSessionId)) return false;
		const previousClient = this.pendingPersistentClients.get(record.acpxRecordId);
		this.pendingPersistentClients.set(record.acpxRecordId, client);
		if (previousClient && previousClient !== client) await previousClient.close().catch(() => {});
		return true;
	}
	async withRuntimeControlSession(record, sessionMode, run) {
		const pendingClient = await this.readPendingPersistentClient(record, { consume: false });
		if (pendingClient) {
			const value = await run({
				client: pendingClient,
				sessionId: record.acpSessionId,
				record
			});
			record.lastUsedAt = isoNow();
			record.closed = false;
			record.closedAt = void 0;
			record.protocolVersion = pendingClient.initializeResult?.protocolVersion;
			record.agentCapabilities = pendingClient.initializeResult?.agentCapabilities;
			applyLifecycleSnapshotToRecord(record, pendingClient.getAgentLifecycleSnapshot());
			return {
				value,
				record
			};
		}
		const result = await withConnectedSession({
			sessionRecordId: record.acpxRecordId,
			loadRecord: async (sessionRecordId) => await this.requireRecord(sessionRecordId),
			saveRecord: async (connectedRecord) => await this.options.sessionStore.save(connectedRecord),
			createClient: (options) => this.createClient(options),
			mcpServers: [...this.options.mcpServers ?? []],
			permissionMode: this.options.permissionMode,
			nonInteractivePermissions: this.options.nonInteractivePermissions,
			onPermissionRequest: this.options.onPermissionRequest,
			verbose: this.options.verbose,
			timeoutMs: this.options.timeoutMs,
			resumePolicy: resumePolicyForSessionMode(sessionMode),
			run
		});
		return {
			value: result.value,
			record: result.record
		};
	}
	async ensureSession(input) {
		const cwd = path.resolve(input.cwd?.trim() || this.options.cwd);
		const agentCommand = this.options.agentRegistry.resolve(input.agent);
		const existing = await this.options.sessionStore.load(input.sessionKey);
		if (input.mode === "persistent" && existing && shouldReuseExistingRecord(existing, {
			cwd,
			agentCommand,
			resumeSessionId: input.resumeSessionId
		})) {
			existing.closed = false;
			existing.closedAt = void 0;
			this.closingActiveRecords.delete(existing.acpxRecordId);
			await this.options.sessionStore.save(existing);
			return existing;
		}
		const client = this.createClient({
			agentCommand,
			cwd,
			mcpServers: [...this.options.mcpServers ?? []],
			permissionMode: this.options.permissionMode,
			nonInteractivePermissions: this.options.nonInteractivePermissions,
			onPermissionRequest: this.options.onPermissionRequest,
			verbose: this.options.verbose,
			sessionOptions: input.sessionOptions
		});
		let keepClientOpen = false;
		try {
			await client.start();
			const session = await createOrLoadRuntimeSession(client, input.resumeSessionId, cwd);
			const record = await this.createAndSaveRuntimeRecord({
				input,
				client,
				agentCommand,
				cwd,
				session
			});
			keepClientOpen = await this.keepPersistentClient(input.mode, record.acpxRecordId, client);
			return record;
		} finally {
			if (!keepClientOpen) await client.close();
		}
	}
	async createAndSaveRuntimeRecord(params) {
		const { input, client, agentCommand, cwd, session } = params;
		const record = createInitialRecord({
			recordId: createRecordId(input.sessionKey, input.mode),
			sessionName: input.sessionKey,
			sessionId: session.sessionId,
			agentCommand,
			cwd,
			agentSessionId: session.agentSessionId
		});
		this.closingActiveRecords.delete(record.acpxRecordId);
		record.protocolVersion = client.initializeResult?.protocolVersion;
		record.agentCapabilities = client.initializeResult?.agentCapabilities;
		applyConfigOptionsToRecord(record, session.sessionResult);
		const modelApplication = await applyRequestedModelIfAdvertised({
			client,
			sessionId: session.sessionId,
			requestedModel: input.sessionOptions?.model,
			models: session.sessionResult.models,
			agentCommand,
			timeoutMs: this.options.timeoutMs
		});
		applyConfigOptionsToRecord(record, modelApplication.response);
		syncAdvertisedModelState(record, modelApplication.response ? modelStateFromConfigOptions(modelApplication.response.configOptions) : session.sessionResult.models);
		if (modelApplication.applied) setCurrentModelId(record, currentModelIdFromSetModelResponse(modelApplication.response, input.sessionOptions?.model));
		applyLifecycleSnapshotToRecord(record, client.getAgentLifecycleSnapshot());
		persistSessionOptions(record, input.sessionOptions);
		await this.options.sessionStore.save(record);
		return record;
	}
	async keepPersistentClient(mode, recordId, client) {
		if (mode !== "persistent") return false;
		const previousClient = this.pendingPersistentClients.get(recordId);
		this.pendingPersistentClients.set(recordId, client);
		await previousClient?.close().catch(() => {});
		return true;
	}
	startTurn(input) {
		const promptInput = input.content;
		const queue = new AsyncEventQueue();
		const result = createDeferred();
		const sessionReady = createDeferred();
		sessionReady.promise.catch(() => {});
		let resultSettled = false;
		const state = {
			pendingCancel: false,
			turnActive: true,
			activeController: null
		};
		let streamClosed = false;
		const settleResult = (next) => {
			if (resultSettled) return;
			resultSettled = true;
			result.resolve(next);
		};
		const closeStream = () => {
			if (streamClosed) return;
			streamClosed = true;
			queue.clear();
			queue.close();
		};
		const requestCancel = async () => {
			if (state.activeController) return await state.activeController.requestCancelActivePrompt();
			if (!state.turnActive) return false;
			state.pendingCancel = true;
			return true;
		};
		const abortHandler = () => {
			requestCancel();
		};
		if (input.signal) {
			if (input.signal.aborted) {
				closeStream();
				settleResult({
					status: "cancelled",
					stopReason: "cancelled"
				});
				return {
					requestId: input.requestId,
					events: queue.iterate(),
					result: result.promise,
					cancel: async () => {},
					closeStream: async () => {}
				};
			}
			input.signal.addEventListener("abort", abortHandler, { once: true });
		}
		this.runRuntimeTurnTask({
			input,
			promptInput,
			queue,
			sessionReady,
			state,
			settleResult,
			abortHandler
		});
		return {
			requestId: input.requestId,
			events: queue.iterate(),
			result: result.promise,
			cancel: async () => {
				await requestCancel();
			},
			closeStream: async () => {
				closeStream();
			}
		};
	}
	async runRuntimeTurnTask(task) {
		let turn;
		try {
			turn = await this.prepareRuntimeTurn(task);
			const { sessionId, resumed, loadError } = await this.connectRuntimeTurn(task, turn);
			await this.resolveRuntimeTurnReady(task, turn, resumed, loadError);
			if (this.cancelRuntimeTurnBeforePrompt(task)) return;
			await this.applyPendingRuntimeTurnCancel(task, turn);
			const response = await runPromptTurn({
				client: turn.client,
				sessionId,
				prompt: task.promptInput,
				timeoutMs: task.input.timeoutMs ?? this.options.timeoutMs,
				conversation: turn.conversation,
				promptMessageId: turn.promptMessageId
			});
			await this.saveCompletedRuntimeTurn(turn, response.stopReason);
			task.settleResult({
				status: response.stopReason === "cancelled" ? "cancelled" : "completed",
				...response.stopReason ? { stopReason: response.stopReason } : {}
			});
		} catch (error) {
			this.failRuntimeTurn(task, error);
		} finally {
			await this.finalizeRuntimeTurn(task, turn);
		}
	}
	async prepareRuntimeTurn(task) {
		const record = await this.requireRecord(task.input.handle.acpxRecordId ?? task.input.handle.sessionKey);
		const conversation = cloneSessionConversation(record);
		let acpxState = cloneSessionAcpxState(record.acpx);
		const promptStartedAt = isoNow();
		const promptMessageId = recordPromptSubmission(conversation, task.promptInput, promptStartedAt);
		trimConversationForRuntime(conversation);
		record.lastPromptAt = promptStartedAt;
		record.lastUsedAt = promptStartedAt;
		record.acpx = acpxState;
		applyConversation(record, conversation);
		await this.options.sessionStore.save(record);
		const pendingClient = await this.readPendingPersistentClient(record, { consume: true });
		const client = pendingClient ?? this.createTurnClient(record);
		const turn = {
			record,
			conversation,
			acpxState,
			liveCheckpoint: this.createRuntimeTurnCheckpoint(record, conversation, () => turn.acpxState),
			client,
			pendingClient,
			promptMessageId,
			activeSessionId: record.acpSessionId
		};
		task.state.activeController = this.buildRuntimeTurnController(task, turn);
		this.activeControllers.set(record.acpxRecordId, task.state.activeController);
		this.installRuntimeTurnEventHandlers(task, turn);
		return turn;
	}
	createTurnClient(record) {
		return this.createClient({
			agentCommand: record.agentCommand,
			cwd: record.cwd,
			acpxRecordId: record.acpxRecordId,
			mcpServers: [...this.options.mcpServers ?? []],
			permissionMode: this.options.permissionMode,
			nonInteractivePermissions: this.options.nonInteractivePermissions,
			onPermissionRequest: this.options.onPermissionRequest,
			verbose: this.options.verbose,
			sessionOptions: sessionOptionsFromRecord(record)
		});
	}
	createRuntimeTurnCheckpoint(record, conversation, readAcpxState) {
		return new LiveSessionCheckpoint({ save: async () => {
			record.lastUsedAt = isoNow();
			record.acpx = readAcpxState();
			applyConversation(record, conversation);
			await this.refreshClosedState(record);
			await this.options.sessionStore.save(record);
		} });
	}
	buildRuntimeTurnController(task, turn) {
		return {
			hasActivePrompt: () => turn.client.hasActivePrompt(),
			requestCancelActivePrompt: async () => await this.requestRuntimeTurnCancel(task, turn),
			setSessionMode: async (modeId) => {
				await this.waitForRuntimeControlSession(task, turn);
				await turn.client.setSessionMode(turn.activeSessionId, modeId);
				const nextState = cloneSessionAcpxState(turn.acpxState) ?? {};
				nextState.desired_mode_id = modeId;
				turn.acpxState = nextState;
			},
			setSessionModel: async (modelId) => {
				await this.waitForRuntimeControlSession(task, turn);
				const models = advertisedModelState(turn.acpxState);
				const response = await turn.client.setSessionModel(turn.activeSessionId, modelId, models);
				applyConfigOptionResponseToTurn(turn, response);
				const nextState = cloneSessionAcpxState(turn.acpxState) ?? {};
				nextState.session_options = {
					...nextState.session_options,
					model: modelId
				};
				nextState.current_model_id = currentModelIdFromSetModelResponse(response, modelId);
				clearDesiredConfigOption(nextState, models?.configId);
				turn.acpxState = nextState;
				return response;
			},
			setSessionConfigOption: async (configId, value) => {
				return (await task.state.activeController.setResolvedSessionConfigOption(configId, value)).response;
			},
			setResolvedSessionConfigOption: async (configId, value) => await this.setRuntimeResolvedSessionConfigOption(task, turn, configId, value)
		};
	}
	async waitForRuntimeControlSession(task, turn) {
		if (turn.client.hasActivePrompt()) return;
		await task.sessionReady.promise;
	}
	async requestRuntimeTurnCancel(task, turn) {
		if (turn.client.hasActivePrompt()) return await turn.client.requestCancelActivePrompt();
		if (!task.state.turnActive) return false;
		task.state.pendingCancel = true;
		return true;
	}
	async setRuntimeResolvedSessionConfigOption(task, turn, configId, value) {
		await this.waitForRuntimeControlSession(task, turn);
		const resolvedConfigId = resolveSupportedConfigOptionId({
			...turn.record,
			acpx: turn.acpxState ?? void 0
		}, configId);
		const response = await turn.client.setSessionConfigOption(turn.activeSessionId, resolvedConfigId, value);
		this.applyRuntimeConfigOptionState(turn, resolvedConfigId, value, response);
		return {
			configId: resolvedConfigId,
			response
		};
	}
	applyRuntimeConfigOptionState(turn, configId, value, response) {
		applyConfigOptionResponseToTurn(turn, response);
		applyDesiredConfigOptionToTurn(turn, configId, value);
	}
	installRuntimeTurnEventHandlers(task, turn) {
		turn.client.setEventHandlers({
			onSessionUpdate: (notification) => {
				turn.acpxState = recordSessionUpdate(turn.conversation, turn.acpxState, notification);
				trimConversationForRuntime(turn.conversation);
				turn.liveCheckpoint.request();
				this.emitRuntimeTurnEvent(task, {
					jsonrpc: "2.0",
					method: "session/update",
					params: notification
				});
				this.mirrorSessionUpdateToEventFirst(turn, notification.update);
			},
			onClientOperation: (operation) => {
				turn.acpxState = recordClientOperation(turn.conversation, turn.acpxState, operation);
				trimConversationForRuntime(turn.conversation);
				turn.liveCheckpoint.request();
				this.emitRuntimeTurnEvent(task, {
					type: "client_operation",
					...operation
				});
			}
		});
	}
	emitRuntimeTurnEvent(task, payload) {
		const parsed = parsePromptEventLine(JSON.stringify(payload));
		if (!parsed) return;
		task.queue.push(parsed);
	}
	mirrorSessionUpdateToEventFirst(turn, update) {
		const ts = (/* @__PURE__ */ new Date()).toISOString();
		const acpxEvents = fromAcp(update, ++this.acpxSeq, ts);
		for (const ev of acpxEvents) this.dispatchEvent(ev);
		const eventStore = this.deps.eventStore;
		if (!eventStore) return;
		eventStore.appendWire(turn.record.acpxRecordId, update, ts).catch((e) => {
			console.warn(`acpx eventStore.appendWire failed: ${String(e)}`);
		});
	}
	async connectRuntimeTurn(task, turn) {
		const loaded = turn.pendingClient ? {
			sessionId: turn.record.acpSessionId,
			resumed: false,
			loadError: void 0
		} : await this.connectRuntimeTurnClient(task, turn);
		turn.acpxState = cloneSessionAcpxState(turn.record.acpx);
		return loaded;
	}
	async connectRuntimeTurnClient(task, turn) {
		return await connectAndLoadSession({
			client: turn.client,
			record: turn.record,
			resumePolicy: resumePolicyForSessionMode(task.input.sessionMode),
			timeoutMs: this.options.timeoutMs,
			activeController: task.state.activeController,
			onClientAvailable: () => this.publishRuntimeTurnController(task, turn),
			onConnectedRecord: (connectedRecord) => {
				connectedRecord.lastPromptAt = isoNow();
			},
			onSessionIdResolved: (sessionIdValue) => {
				turn.activeSessionId = sessionIdValue;
			}
		});
	}
	publishRuntimeTurnController(task, turn) {
		const controller = task.state.activeController;
		if (controller) this.activeControllers.set(turn.record.acpxRecordId, controller);
	}
	async resolveRuntimeTurnReady(task, turn, resumed, loadError) {
		task.sessionReady.resolve();
		turn.record.lastRequestId = task.input.requestId;
		turn.record.lastPromptAt = isoNow();
		turn.record.closed = false;
		turn.record.closedAt = void 0;
		turn.record.lastUsedAt = isoNow();
		await turn.liveCheckpoint.checkpoint();
		this.emitRuntimeTurnLoadStatus(task, resumed, loadError);
	}
	emitRuntimeTurnLoadStatus(task, resumed, loadError) {
		if (!resumed && !loadError) return;
		this.emitRuntimeTurnEvent(task, {
			type: "status",
			text: loadError ? `session reconnect fallback: ${loadError}` : "session resumed"
		});
	}
	cancelRuntimeTurnBeforePrompt(task) {
		if (!task.state.pendingCancel && !task.input.signal?.aborted) return false;
		task.state.pendingCancel = false;
		task.settleResult({
			status: "cancelled",
			stopReason: "cancelled"
		});
		return true;
	}
	async applyPendingRuntimeTurnCancel(task, turn) {
		if (!task.state.pendingCancel || !turn.client.hasActivePrompt()) return false;
		const cancelled = await turn.client.requestCancelActivePrompt();
		if (cancelled) task.state.pendingCancel = false;
		return cancelled;
	}
	async saveCompletedRuntimeTurn(turn, _stopReason) {
		turn.record.acpSessionId = turn.activeSessionId;
		reconcileAgentSessionId(turn.record, turn.record.agentSessionId);
		turn.record.protocolVersion = turn.client.initializeResult?.protocolVersion;
		turn.record.agentCapabilities = turn.client.initializeResult?.agentCapabilities;
		turn.record.acpx = turn.acpxState;
		applyConversation(turn.record, turn.conversation);
		applyLifecycleSnapshotToRecord(turn.record, turn.client.getAgentLifecycleSnapshot());
		await this.options.sessionStore.save(turn.record);
	}
	failRuntimeTurn(task, error) {
		task.sessionReady.reject(error);
		const acpError = error instanceof AcpRuntimeError ? error : new AcpRuntimeError("ACP_TURN_FAILED", formatErrorMessage(error), { cause: error });
		const meta = asRecord(error);
		const retryable = typeof meta?.retryable === "boolean" ? meta.retryable : isRetryablePromptError(error);
		const detailCode = readDetailCode(meta);
		task.settleResult({
			status: "failed",
			error: {
				message: acpError.message,
				code: acpError.code,
				retryable,
				...detailCode ? { detailCode } : {},
				cause: acpError.cause
			}
		});
	}
	async finalizeRuntimeTurn(task, turn) {
		task.state.turnActive = false;
		task.input.signal?.removeEventListener("abort", task.abortHandler);
		turn?.client.clearEventHandlers();
		if (!(turn ? await this.finalizeRuntimeTurnRecord(turn) : false)) await turn?.client.close().catch(() => {});
		if (turn) {
			this.activeControllers.delete(turn.record.acpxRecordId);
			this.closingActiveRecords.delete(turn.record.acpxRecordId);
		}
		task.queue.close();
	}
	async finalizeRuntimeTurnRecord(turn) {
		applyLifecycleSnapshotToRecord(turn.record, turn.client.getAgentLifecycleSnapshot());
		turn.record.acpx = turn.acpxState;
		applyConversation(turn.record, turn.conversation);
		turn.record.lastUsedAt = isoNow();
		await turn.liveCheckpoint.flush().catch(() => {});
		const closed = await this.refreshClosedState(turn.record);
		await this.options.sessionStore.save(turn.record).catch(() => {});
		if (closed) return false;
		return await this.retainPersistentClientAfterTurn({
			record: turn.record,
			client: turn.client
		});
	}
	async *runTurn(input) {
		const turn = this.startTurn(input);
		yield* turn.events;
		yield legacyTerminalEventFromTurnResult(await turn.result);
	}
	async getStatus(handle) {
		const record = await this.requireRecord(handle.acpxRecordId ?? handle.sessionKey);
		return {
			summary: statusSummary(record),
			acpxRecordId: record.acpxRecordId,
			backendSessionId: record.acpSessionId,
			agentSessionId: record.agentSessionId,
			...buildModelsField(record),
			...buildUsageField(record),
			...buildAvailableCommandsField(record),
			details: {
				cwd: record.cwd,
				lastUsedAt: record.lastUsedAt,
				closed: record.closed === true,
				...record.acpx?.config_options !== void 0 ? { configOptions: structuredClone(record.acpx.config_options) } : {}
			}
		};
	}
	async setMode(handle, mode, sessionMode = "persistent") {
		const record = await this.requireRecord(handle.acpxRecordId ?? handle.sessionKey);
		const controller = this.activeControllers.get(record.acpxRecordId);
		let targetRecord = record;
		if (controller) await controller.setSessionMode(mode);
		else targetRecord = (await this.withRuntimeControlSession(record, sessionMode, async ({ client, sessionId }) => {
			await client.setSessionMode(sessionId, mode);
		})).record;
		setDesiredModeId(targetRecord, mode);
		await this.options.sessionStore.save(targetRecord);
	}
	async setConfigOption(handle, key, value, sessionMode = "persistent") {
		const record = await this.requireRecord(handle.acpxRecordId ?? handle.sessionKey);
		const controller = this.activeControllers.get(record.acpxRecordId);
		if (controller) {
			const { configId, response } = await controller.setResolvedSessionConfigOption(key, value);
			applyConfigOptionsToRecord(record, response);
			applyDesiredConfigOptionToRecord(record, configId, value);
			await this.options.sessionStore.save(record);
			return;
		}
		const result = await this.withRuntimeControlSession(record, sessionMode, async ({ client, sessionId, record: connectedRecord }) => {
			const configId = resolveSupportedConfigOptionId(connectedRecord, key);
			applyConfigOptionsToRecord(connectedRecord, await client.setSessionConfigOption(sessionId, configId, value));
			applyDesiredConfigOptionToRecord(connectedRecord, configId, value);
		});
		await this.options.sessionStore.save(result.record);
	}
	async cancel(handle) {
		await this.activeControllers.get(handle.acpxRecordId ?? handle.sessionKey)?.requestCancelActivePrompt();
	}
	async close(handle, options = {}) {
		const record = await this.requireRecord(handle.acpxRecordId ?? handle.sessionKey);
		if (this.activeControllers.has(record.acpxRecordId)) this.closingActiveRecords.add(record.acpxRecordId);
		await this.cancel(handle);
		if (options.discardPersistentState) {
			await this.closeBackendSession(record);
			record.acpx = {
				...record.acpx,
				reset_on_next_ensure: true
			};
		} else await this.closePendingPersistentClient(record.acpxRecordId);
		record.closed = true;
		record.closedAt = isoNow();
		await this.options.sessionStore.save(record);
	}
	async closeBackendSession(record) {
		const pendingClient = await this.readPendingPersistentClient(record, { consume: true });
		const client = pendingClient ?? this.createClient({
			agentCommand: record.agentCommand,
			cwd: record.cwd,
			acpxRecordId: record.acpxRecordId,
			mcpServers: [...this.options.mcpServers ?? []],
			permissionMode: this.options.permissionMode,
			nonInteractivePermissions: this.options.nonInteractivePermissions,
			onPermissionRequest: this.options.onPermissionRequest,
			verbose: this.options.verbose
		});
		try {
			if (!pendingClient) await withTimeout(client.start(), this.options.timeoutMs);
			if (!client.supportsCloseSession()) throw new AcpRuntimeError("ACP_BACKEND_UNSUPPORTED_CONTROL", `Agent does not support session/close for ${record.acpxRecordId}.`);
			await withTimeout(client.closeSession(record.acpSessionId), this.options.timeoutMs);
		} catch (error) {
			if (isUnsupportedSessionCloseError(error)) throw new AcpRuntimeError("ACP_BACKEND_UNSUPPORTED_CONTROL", `Agent does not support session/close for ${record.acpxRecordId}.`, { cause: error });
			if (isAcpResourceNotFoundError(error)) return;
			throw error;
		} finally {
			await client.close().catch(() => {});
		}
	}
	async requireRecord(sessionId) {
		const record = await this.options.sessionStore.load(sessionId);
		if (!record) throw new Error(`ACP session not found: ${sessionId}`);
		return record;
	}
};
//#endregion
//#region src/runtime/public/file-session-store.ts
function safeSessionId(sessionId) {
	return encodeURIComponent(sessionId);
}
var FileSessionStore = class {
	stateDir;
	constructor(stateDir) {
		this.stateDir = stateDir;
	}
	get sessionDir() {
		return path.join(this.stateDir, "sessions");
	}
	filePath(sessionId) {
		return path.join(this.sessionDir, `${safeSessionId(sessionId)}.json`);
	}
	async ensureDir() {
		await fs.mkdir(this.sessionDir, { recursive: true });
	}
	async load(sessionId) {
		await this.ensureDir();
		let payload;
		try {
			payload = await fs.readFile(this.filePath(sessionId), "utf8");
		} catch (error) {
			if (error.code === "ENOENT") return;
			throw error;
		}
		let parsed;
		try {
			parsed = JSON.parse(payload);
		} catch {
			return;
		}
		return parseSessionRecord(parsed) ?? void 0;
	}
	async save(record) {
		await this.ensureDir();
		const persisted = serializeSessionRecordForDisk(record);
		assertPersistedKeyPolicy(persisted);
		const file = this.filePath(record.acpxRecordId);
		const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
		const payload = JSON.stringify(persisted, null, 2);
		await fs.writeFile(tempFile, `${payload}\n`, "utf8");
		await fs.rename(tempFile, file);
	}
};
function createFileSessionStore(options) {
	return new FileSessionStore(path.resolve(options.stateDir));
}
//#endregion
//#region src/runtime/public/handle-state.ts
const ACPX_RUNTIME_HANDLE_PREFIX = "acpx:v2:";
function encodeAcpxRuntimeHandleState(state) {
	return `${ACPX_RUNTIME_HANDLE_PREFIX}${Buffer.from(JSON.stringify(state), "utf8").toString("base64url")}`;
}
function decodeAcpxRuntimeHandleState(runtimeSessionName) {
	const trimmed = runtimeSessionName.trim();
	if (!trimmed.startsWith(ACPX_RUNTIME_HANDLE_PREFIX)) return null;
	try {
		const raw = Buffer.from(trimmed.slice(8), "base64url").toString("utf8");
		const parsed = JSON.parse(raw);
		const name = asOptionalString(parsed.name);
		const agent = asOptionalString(parsed.agent);
		const cwd = asOptionalString(parsed.cwd);
		const mode = asOptionalString(parsed.mode);
		if (!name || !agent || !cwd || mode !== "persistent" && mode !== "oneshot") return null;
		return {
			name,
			agent,
			cwd,
			mode,
			acpxRecordId: asOptionalString(parsed.acpxRecordId),
			backendSessionId: asOptionalString(parsed.backendSessionId),
			agentSessionId: asOptionalString(parsed.agentSessionId)
		};
	} catch {
		return null;
	}
}
function writeHandleState(handle, state) {
	handle.runtimeSessionName = encodeAcpxRuntimeHandleState(state);
	handle.cwd = state.cwd;
	handle.acpxRecordId = state.acpxRecordId;
	handle.backendSessionId = state.backendSessionId;
	handle.agentSessionId = state.agentSessionId;
}
//#endregion
//#region src/runtime/public/probe.ts
function isPrimitiveDetail(value) {
	return value == null || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint" || typeof value === "symbol";
}
function formatFunctionDetail(value) {
	return value.name ? `[Function ${value.name}]` : "[Function]";
}
function serializeRuntimeDetail(value) {
	const seen = /* @__PURE__ */ new WeakSet();
	return JSON.stringify(value, (_key, nested) => {
		if (nested instanceof Error) return nested.message || nested.name;
		if (nested && typeof nested === "object") {
			if (seen.has(nested)) return "[Circular]";
			seen.add(nested);
		}
		return nested;
	}) ?? "undefined";
}
function formatRuntimeDetail(value) {
	if (value instanceof Error) return value.message || value.name;
	if (typeof value === "string") return value;
	if (isPrimitiveDetail(value)) return String(value);
	if (typeof value === "function") return formatFunctionDetail(value);
	try {
		return serializeRuntimeDetail(value);
	} catch {
		return "unserializable object";
	}
}
function normalizeRuntimeDetails(details) {
	return details?.map((detail) => formatRuntimeDetail(detail));
}
async function probeRuntime(options, deps = {}) {
	const agentName = options.probeAgent?.trim() || "codex";
	const agentCommand = options.agentRegistry.resolve(agentName);
	const client = createProbeClient(options, agentCommand, deps);
	try {
		await client.start();
		return {
			ok: true,
			message: "embedded ACP runtime ready",
			details: [
				`agent=${agentName}`,
				`command=${agentCommand}`,
				`cwd=${options.cwd}`,
				...client.initializeResult?.protocolVersion ? [`protocolVersion=${client.initializeResult.protocolVersion}`] : []
			]
		};
	} catch (error) {
		return {
			ok: false,
			message: "embedded ACP runtime probe failed",
			details: [
				`agent=${agentName}`,
				`command=${agentCommand}`,
				`cwd=${options.cwd}`,
				formatRuntimeDetail(error)
			]
		};
	} finally {
		await client.close().catch(() => {});
	}
}
function createProbeClient(options, agentCommand, deps) {
	const clientOptions = {
		agentCommand,
		cwd: options.cwd,
		mcpServers: [...options.mcpServers ?? []],
		permissionMode: options.permissionMode,
		nonInteractivePermissions: options.nonInteractivePermissions,
		verbose: options.verbose
	};
	return deps.clientFactory?.(clientOptions) ?? new AcpClient(clientOptions);
}
//#endregion
//#region src/session/event-store/events.ts
const ACPX_EVENT_SCHEMA = "v1";
const DOMAIN_KINDS = /* @__PURE__ */ new Set([
	"header",
	"session_closed",
	"session_reconnected",
	"desired_mode_set",
	"desired_model_set",
	"desired_config_option_set",
	"session_renamed",
	"agent_lifecycle_snapshot"
]);
function isAcpxDomainKind(kind) {
	return DOMAIN_KINDS.has(kind);
}
//#endregion
//#region src/session/event-store/reduce.ts
function appendChunk(state, role, content, bucket, seq) {
	const messages = state.messages.slice();
	const last = messages[messages.length - 1];
	if (last && last.role === role) {
		const prev = last[bucket] ?? [];
		messages[messages.length - 1] = {
			...last,
			[bucket]: prev.concat(content)
		};
	} else messages.push({
		role,
		content: bucket === "content" ? [content] : [],
		thinking: bucket === "thinking" ? [content] : void 0
	});
	return {
		...state,
		messages,
		lastSeq: seq
	};
}
function mergeToolCall(state, snapshot, seq) {
	const toolCalls = new Map(state.toolCalls);
	const existing = toolCalls.get(snapshot.toolCallId);
	const next = existing ? {
		...existing,
		...snapshot
	} : snapshot;
	toolCalls.set(snapshot.toolCallId, next);
	return {
		...state,
		toolCalls,
		lastSeq: seq
	};
}
function pickDefined(obj) {
	const out = {};
	for (const k of Object.keys(obj)) if (obj[k] !== void 0) out[k] = obj[k];
	return out;
}
const HANDLERS = {
	header: (_state, e) => ({
		acpxRecordId: e.acpxRecordId,
		acpSessionId: e.acpSessionId,
		cwd: e.cwd,
		agentCommand: e.agentCommand,
		agentCapabilities: e.agentCapabilities,
		createdAt: e.createdAt,
		messages: [],
		toolCalls: /* @__PURE__ */ new Map(),
		lastSeq: 0
	}),
	agent_message_chunk: (s, e) => appendChunk(s, "agent", e.content, "content", e.seq),
	user_message_chunk: (s, e) => appendChunk(s, "user", e.content, "content", e.seq),
	agent_thought_chunk: (s, e) => appendChunk(s, "agent", e.content, "thinking", e.seq),
	tool_call: (s, e) => mergeToolCall(s, {
		toolCallId: e.toolCallId,
		title: e.title,
		toolKind: e.toolKind,
		status: e.status,
		content: e.content,
		locations: e.locations,
		rawInput: e.rawInput,
		rawOutput: e.rawOutput
	}, e.seq),
	tool_call_update: (s, e) => {
		return mergeToolCall(s, pickDefined({
			toolCallId: e.toolCallId,
			title: e.title,
			toolKind: e.toolKind,
			status: e.status,
			content: e.content,
			locations: e.locations,
			rawInput: e.rawInput,
			rawOutput: e.rawOutput
		}), e.seq);
	},
	available_commands_update: (s, e) => ({
		...s,
		availableCommands: e.availableCommands,
		lastSeq: e.seq
	}),
	current_mode_update: (s, e) => ({
		...s,
		currentModeId: e.currentModeId,
		lastSeq: e.seq
	}),
	config_option_update: (s, e) => {
		const configOptions = {
			...s.configOptions,
			[e.configId]: e.value
		};
		return {
			...s,
			configOptions,
			lastSeq: e.seq
		};
	},
	session_info_update: (s, e) => ({
		...s,
		sessionInfo: e.info,
		lastSeq: e.seq
	}),
	usage_update: (s, e) => {
		const tokenUsage = { tokens: {
			used: e.usage.used,
			size: e.usage.size
		} };
		if (e.usage.cost) tokenUsage.totalCostUsd = e.usage.cost.amount;
		return {
			...s,
			tokenUsage,
			lastSeq: e.seq
		};
	},
	plan: (s, e) => ({
		...s,
		currentPlan: { entries: e.entries },
		lastSeq: e.seq
	}),
	plan_update: (s, e) => {
		const lastSeq = e.seq;
		if (e.plan.type === "items") return {
			...s,
			currentPlan: { entries: e.plan.entries },
			lastSeq
		};
		if (e.plan.type === "file") return {
			...s,
			currentPlanFile: e.plan,
			lastSeq
		};
		return {
			...s,
			currentPlanMarkdown: e.plan,
			lastSeq
		};
	},
	plan_removed: (s, e) => {
		const next = {
			...s,
			lastSeq: e.seq
		};
		delete next.currentPlan;
		delete next.currentPlanFile;
		delete next.currentPlanMarkdown;
		return next;
	},
	session_closed: (s, e) => ({
		...s,
		closed: {
			closedAt: e.closedAt,
			lastAgentExitCode: e.lastAgentExitCode ?? null
		},
		lastSeq: e.seq
	}),
	session_reconnected: (s, e) => {
		const next = {
			...s,
			acpSessionId: e.acpSessionId,
			lastSeq: e.seq
		};
		delete next.closed;
		return next;
	},
	desired_mode_set: (s, e) => {
		const next = {
			...s,
			lastSeq: e.seq
		};
		if (e.modeId === null) delete next.desiredModeId;
		else next.desiredModeId = e.modeId;
		return next;
	},
	desired_model_set: (s, e) => {
		const next = {
			...s,
			lastSeq: e.seq
		};
		if (e.modelId === null) delete next.desiredModelId;
		else next.desiredModelId = e.modelId;
		return next;
	},
	desired_config_option_set: (s, e) => {
		const desiredConfigOptions = { ...s.desiredConfigOptions };
		if (e.value === null) delete desiredConfigOptions[e.configId];
		else desiredConfigOptions[e.configId] = e.value;
		return {
			...s,
			desiredConfigOptions,
			lastSeq: e.seq
		};
	},
	session_renamed: (s, e) => {
		const next = {
			...s,
			lastSeq: e.seq
		};
		if (e.name === null) delete next.name;
		else next.name = e.name;
		return next;
	},
	agent_lifecycle_snapshot: (s, e) => ({
		...s,
		agentLifecycle: {
			pid: e.pid,
			agentStartedAt: e.agentStartedAt,
			lastPromptAt: e.lastPromptAt
		},
		lastSeq: e.seq
	})
};
function reduce(state, event) {
	if (state === null) {
		if (event.kind !== "header") throw new Error(`reduce: first event must be 'header', got '${event.kind}'`);
		return HANDLERS.header({}, event);
	}
	const handler = HANDLERS[event.kind];
	return handler(state, event);
}
//#endregion
//#region src/session/event-store/types.ts
var SessionExistsError = class extends Error {
	sessionId;
	constructor(sessionId) {
		super(`session already exists: ${sessionId}`);
		this.name = "SessionExistsError";
		this.sessionId = sessionId;
	}
};
var SessionNotFoundError = class extends Error {
	sessionId;
	constructor(sessionId) {
		super(`session not found: ${sessionId}`);
		this.name = "EventStoreSessionNotFoundError";
		this.sessionId = sessionId;
	}
};
var SessionClosedError = class extends Error {
	sessionId;
	constructor(sessionId) {
		super(`session is closed: ${sessionId}`);
		this.name = "SessionClosedError";
		this.sessionId = sessionId;
	}
};
//#endregion
//#region src/session/event-store/synthesize.ts
function synthesizeHeader(record) {
	return {
		kind: "header",
		seq: 0,
		ts: record.createdAt,
		schema: "v1",
		acpxRecordId: record.acpxRecordId,
		acpSessionId: record.acpSessionId,
		cwd: record.cwd,
		agentCommand: record.agentCommand,
		agentCapabilities: record.agentCapabilities,
		createdAt: record.createdAt
	};
}
function synthesizeDesiredState(record, seqStart) {
	const out = [];
	let seq = seqStart;
	const ts = stateTs(record);
	const ax = record.acpx ?? {};
	const modelId = ax.session_options?.model;
	const configs = ax.desired_config_options;
	if (ax.desired_mode_id !== void 0) out.push({
		kind: "desired_mode_set",
		seq: seq++,
		ts,
		schema: "v1",
		modeId: ax.desired_mode_id
	});
	if (modelId !== void 0) out.push({
		kind: "desired_model_set",
		seq: seq++,
		ts,
		schema: "v1",
		modelId
	});
	for (const [configId, value] of Object.entries(configs ?? {})) out.push({
		kind: "desired_config_option_set",
		seq: seq++,
		ts,
		schema: "v1",
		configId,
		value
	});
	if (record.name !== void 0) out.push({
		kind: "session_renamed",
		seq,
		ts,
		schema: "v1",
		name: record.name
	});
	return out;
}
function stateTs(record) {
	return record.lastUsedAt || record.createdAt;
}
function synthesizeClose(record, seq) {
	if (!record.closed || !record.closedAt) throw new Error("synthesizeClose called on non-closed record");
	return {
		kind: "session_closed",
		seq,
		ts: record.closedAt,
		schema: "v1",
		closedAt: record.closedAt,
		lastAgentExitCode: record.lastAgentExitCode,
		lastAgentExitSignal: record.lastAgentExitSignal,
		lastAgentDisconnectReason: record.lastAgentDisconnectReason
	};
}
function synthesizeReconnected(record, seq) {
	return {
		kind: "session_reconnected",
		seq,
		ts: stateTs(record),
		schema: "v1",
		acpSessionId: record.acpSessionId
	};
}
//#endregion
//#region src/session/event-store/store.ts
function seedRecord(input) {
	const now = input.createdAt ?? (/* @__PURE__ */ new Date()).toISOString();
	return {
		schema: SESSION_RECORD_SCHEMA,
		acpxRecordId: input.acpxRecordId,
		acpSessionId: input.acpSessionId,
		agentCommand: input.agentCommand,
		cwd: input.cwd,
		createdAt: now,
		lastUsedAt: now,
		lastSeq: 0,
		eventLog: defaultSessionEventLog(input.acpxRecordId),
		closed: false,
		agentCapabilities: input.agentCapabilities,
		messages: [],
		updated_at: now,
		cumulative_token_usage: {},
		request_token_usage: {},
		acpx: {}
	};
}
async function loadOrThrow(p, sessionId) {
	const record = await p.loadRecord(sessionId);
	if (!record) throw new SessionNotFoundError(sessionId);
	return record;
}
function applyModeSection(acpx, modeId) {
	if (modeId === void 0) return;
	if (modeId === null) {
		delete acpx.desired_mode_id;
		return;
	}
	acpx.desired_mode_id = modeId;
}
function applyModelSection(acpx, modelId) {
	if (modelId === void 0) return;
	const session_options = { ...acpx.session_options };
	if (modelId === null) delete session_options.model;
	else session_options.model = modelId;
	acpx.session_options = session_options;
}
function applyConfigSection(acpx, patch) {
	if (!patch) return;
	const out = { ...acpx.desired_config_options };
	for (const [k, v] of Object.entries(patch)) if (v === null) delete out[k];
	else out[k] = v;
	acpx.desired_config_options = out;
}
function applyNameSection(record, name) {
	if (name === void 0) return;
	if (name === null) {
		delete record.name;
		return;
	}
	record.name = name;
}
function applyDesiredPatch(record, patch) {
	const acpx = { ...record.acpx };
	applyModeSection(acpx, patch.modeId);
	applyModelSection(acpx, patch.modelId);
	applyConfigSection(acpx, patch.configOptions);
	const next = {
		...record,
		acpx
	};
	applyNameSection(next, patch.name);
	return next;
}
function diffModeSection(prev, modeId, seq, ts) {
	if (modeId === void 0) return;
	if (modeId === (prev.acpx?.desired_mode_id ?? null)) return;
	return {
		kind: "desired_mode_set",
		seq,
		ts,
		schema: "v1",
		modeId
	};
}
function diffModelSection(prev, modelId, seq, ts) {
	if (modelId === void 0) return;
	if (modelId === (prev.acpx?.session_options?.model ?? null)) return;
	return {
		kind: "desired_model_set",
		seq,
		ts,
		schema: "v1",
		modelId
	};
}
function diffConfigSection(prev, patch, seqStart, ts) {
	if (!patch) return [];
	const prevMap = prev.acpx?.desired_config_options ?? {};
	const out = [];
	let seq = seqStart;
	for (const [configId, value] of Object.entries(patch)) {
		const before = prevMap[configId];
		if (before === void 0 && value === null) continue;
		if (before === value) continue;
		out.push({
			kind: "desired_config_option_set",
			seq: seq++,
			ts,
			schema: "v1",
			configId,
			value
		});
	}
	return out;
}
function diffNameSection(prev, name, seq, ts) {
	if (name === void 0) return;
	if (name === (prev.name ?? null)) return;
	return {
		kind: "session_renamed",
		seq,
		ts,
		schema: "v1",
		name
	};
}
function diffDesiredEvents(before, patch, seqStart, ts) {
	const out = [];
	let seq = seqStart;
	const mode = diffModeSection(before, patch.modeId, seq, ts);
	if (mode) {
		out.push(mode);
		seq += 1;
	}
	const model = diffModelSection(before, patch.modelId, seq, ts);
	if (model) {
		out.push(model);
		seq += 1;
	}
	const cfg = diffConfigSection(before, patch.configOptions, seq, ts);
	out.push(...cfg);
	seq += cfg.length;
	const name = diffNameSection(before, patch.name, seq, ts);
	if (name) out.push(name);
	return out;
}
function liftFrame(frame, seq, ts) {
	const candidate = frame;
	if (candidate.method !== "session/update") return [];
	const params = candidate.params;
	if (!params || typeof params.update !== "object" || params.update === null) return [];
	return fromAcp(params.update, seq, ts);
}
async function* iterateEvents(p, sessionId) {
	const record = await loadOrThrow(p, sessionId);
	yield synthesizeHeader(record);
	let seq = 1;
	for (const desired of synthesizeDesiredState(record, seq)) {
		yield desired;
		seq += 1;
	}
	for await (const frame of p.readFrames(sessionId)) {
		const lifted = liftFrame(frame, seq, (/* @__PURE__ */ new Date()).toISOString());
		for (const event of lifted) {
			yield event;
			seq += 1;
		}
	}
	if (record.closed === true && record.closedAt) yield synthesizeClose(record, seq);
}
async function foldState(p, sessionId) {
	let state = null;
	for await (const event of iterateEvents(p, sessionId)) state = reduce(state, event);
	if (!state) throw new SessionNotFoundError(sessionId);
	return state;
}
async function createSessionImpl(p, input) {
	if (await p.loadRecord(input.acpxRecordId)) throw new SessionExistsError(input.acpxRecordId);
	const record = seedRecord(input);
	await p.saveRecord(record);
	return record;
}
async function appendWireImpl(p, sessionId, update, ts) {
	const record = await loadOrThrow(p, sessionId);
	if (record.closed === true) throw new SessionClosedError(sessionId);
	const frame = {
		jsonrpc: "2.0",
		method: "session/update",
		params: {
			sessionId: record.acpSessionId,
			update
		}
	};
	await p.writeFrame(sessionId, frame);
	const startSeq = record.lastSeq + 1;
	const events = fromAcp(update, startSeq, ts);
	if (events.length === 0) return events;
	const fresh = await p.loadRecord(sessionId) ?? record;
	await p.saveRecord({
		...fresh,
		lastSeq: startSeq + events.length - 1,
		lastUsedAt: ts,
		updated_at: ts,
		eventLog: {
			...fresh.eventLog,
			last_write_at: ts
		}
	});
	return events;
}
async function setDesiredImpl(p, sessionId, patch, ts) {
	const record = await loadOrThrow(p, sessionId);
	if (record.closed === true) throw new SessionClosedError(sessionId);
	const after = applyDesiredPatch(record, patch);
	const events = diffDesiredEvents(record, patch, record.lastSeq + 1, ts);
	if (events.length === 0) {
		await p.saveRecord({
			...after,
			updated_at: ts
		});
		return events;
	}
	const endSeq = events[events.length - 1].seq;
	await p.saveRecord({
		...after,
		lastSeq: endSeq,
		lastUsedAt: ts,
		updated_at: ts,
		eventLog: {
			...after.eventLog,
			last_write_at: ts
		}
	});
	return events;
}
async function closeSessionImpl(p, sessionId, exit, ts) {
	const record = await loadOrThrow(p, sessionId);
	if (record.closed === true) throw new SessionClosedError(sessionId);
	const closedAt = exit?.closedAt ?? ts;
	const liveSeq = record.lastSeq + 1;
	const closed = {
		...record,
		closed: true,
		closedAt,
		lastAgentExitCode: exit?.lastAgentExitCode,
		lastAgentExitSignal: exit?.lastAgentExitSignal,
		lastAgentDisconnectReason: exit?.lastAgentDisconnectReason,
		lastUsedAt: ts,
		updated_at: ts
	};
	await p.saveRecord(closed);
	return synthesizeClose(closed, liveSeq);
}
async function reopenSessionImpl(p, sessionId, newAcpSessionId, ts) {
	const record = await loadOrThrow(p, sessionId);
	if (record.closed !== true) throw new Error(`session is not closed: ${sessionId}`);
	const liveSeq = record.lastSeq + 1;
	const reopened = {
		...record,
		acpSessionId: newAcpSessionId,
		closed: void 0,
		closedAt: void 0,
		lastAgentExitCode: void 0,
		lastAgentExitSignal: void 0,
		lastAgentDisconnectReason: void 0,
		lastUsedAt: ts,
		updated_at: ts
	};
	await p.saveRecord(reopened);
	return synthesizeReconnected(reopened, liveSeq);
}
function createEventStore(p) {
	return {
		createSession(input) {
			return createSessionImpl(p, input);
		},
		appendWire(sessionId, update, ts = (/* @__PURE__ */ new Date()).toISOString()) {
			return appendWireImpl(p, sessionId, update, ts);
		},
		setDesired(sessionId, patch) {
			return setDesiredImpl(p, sessionId, patch, (/* @__PURE__ */ new Date()).toISOString());
		},
		closeSession(sessionId, exit) {
			return closeSessionImpl(p, sessionId, exit, (/* @__PURE__ */ new Date()).toISOString());
		},
		reopenSession(sessionId, newAcpSessionId) {
			return reopenSessionImpl(p, sessionId, newAcpSessionId, (/* @__PURE__ */ new Date()).toISOString());
		},
		events(sessionId) {
			return iterateEvents(p, sessionId);
		},
		getState(sessionId) {
			return foldState(p, sessionId);
		}
	};
}
//#endregion
//#region src/session/event-store/file-storage.ts
function isEnoent(e) {
	return e instanceof Error && "code" in e && e.code === "ENOENT";
}
function fileStorage(_stateDir) {
	return {
		async writeFrame(sessionId, frame) {
			const record = await resolveSessionRecord(sessionId);
			const writer = await SessionEventWriter.open(record);
			try {
				await writer.appendMessage(frame, { checkpoint: false });
				const writerRecord = writer.getRecord();
				await writeSessionRecord({
					...await resolveSessionRecord(sessionId),
					eventLog: writerRecord.eventLog
				});
			} finally {
				await writer.close({ checkpoint: false });
			}
		},
		async *readFrames(sessionId) {
			const frames = await listSessionEvents(sessionId);
			for (const frame of frames) yield frame;
		},
		async loadRecord(sessionId) {
			try {
				return await resolveSessionRecord(sessionId);
			} catch (e) {
				if (isEnoent(e)) return;
				if (e instanceof SessionNotFoundError$1) return;
				throw e;
			}
		},
		async saveRecord(record) {
			await writeSessionRecord(record);
		}
	};
}
//#endregion
//#region src/session/event-store/memory-storage.ts
function memoryStorage() {
	const frames = /* @__PURE__ */ new Map();
	const records = /* @__PURE__ */ new Map();
	return {
		async writeFrame(sessionId, frame) {
			const buf = frames.get(sessionId) ?? [];
			buf.push(frame);
			frames.set(sessionId, buf);
		},
		async *readFrames(sessionId) {
			const buf = frames.get(sessionId) ?? [];
			for (const frame of buf) yield frame;
		},
		async loadRecord(sessionId) {
			return records.get(sessionId);
		},
		async saveRecord(record) {
			records.set(record.acpxRecordId, { ...record });
		}
	};
}
//#endregion
//#region src/runtime.ts
const ACPX_BACKEND_ID = "acpx";
const ACPX_CAPABILITIES = { controls: [
	"session/set_mode",
	"session/set_config_option",
	"session/status"
] };
function createAgentRegistry(params) {
	return {
		resolve(agentName) {
			return resolveAgentCommand(agentName, params?.overrides);
		},
		list() {
			return listBuiltInAgents(params?.overrides);
		}
	};
}
var AcpxRuntime = class {
	options;
	testOptions;
	healthy = false;
	manager = null;
	managerPromise = null;
	constructor(options, testOptions) {
		this.options = options;
		this.testOptions = testOptions;
	}
	isHealthy() {
		return this.healthy;
	}
	async probeAvailability() {
		const report = await this.runProbe();
		this.healthy = report.ok;
	}
	async doctor() {
		const report = await this.runProbe();
		this.healthy = report.ok;
		return {
			ok: report.ok,
			code: report.ok ? void 0 : "ACP_BACKEND_UNAVAILABLE",
			message: report.message,
			details: normalizeRuntimeDetails(report.details)
		};
	}
	async ensureSession(input) {
		const sessionName = input.sessionKey.trim();
		if (!sessionName) throw new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "ACP session key is required.");
		const agent = input.agent.trim();
		if (!agent) throw new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "ACP agent id is required.");
		const record = await (await this.getManager()).ensureSession({
			sessionKey: sessionName,
			agent,
			mode: input.mode,
			cwd: input.cwd ?? this.options.cwd,
			resumeSessionId: input.resumeSessionId,
			sessionOptions: input.sessionOptions
		});
		const handle = {
			sessionKey: input.sessionKey,
			backend: ACPX_BACKEND_ID,
			runtimeSessionName: "",
			cwd: record.cwd,
			acpxRecordId: record.acpxRecordId,
			backendSessionId: record.acpSessionId,
			agentSessionId: record.agentSessionId
		};
		writeHandleState(handle, {
			name: sessionName,
			agent,
			cwd: record.cwd,
			mode: input.mode,
			acpxRecordId: record.acpxRecordId,
			backendSessionId: record.acpSessionId,
			agentSessionId: record.agentSessionId
		});
		return handle;
	}
	startTurn(input) {
		const { handle, state } = this.resolveManagerHandle(input.handle);
		const turnPromise = this.getManager().then((manager) => manager.startTurn({
			handle,
			content: input.content,
			mode: input.mode,
			sessionMode: state.mode,
			requestId: input.requestId,
			timeoutMs: input.timeoutMs,
			signal: input.signal
		}));
		return {
			requestId: input.requestId,
			events: { async *[Symbol.asyncIterator]() {
				yield* (await turnPromise).events;
			} },
			get result() {
				return turnPromise.then((turn) => turn.result);
			},
			cancel(inputArgs) {
				return turnPromise.then((turn) => turn.cancel(inputArgs));
			},
			closeStream(inputArgs) {
				return turnPromise.then((turn) => turn.closeStream(inputArgs));
			}
		};
	}
	async *runTurn(input) {
		const { handle, state } = this.resolveManagerHandle(input.handle);
		yield* (await this.getManager()).runTurn({
			handle,
			content: input.content,
			mode: input.mode,
			sessionMode: state.mode,
			requestId: input.requestId,
			timeoutMs: input.timeoutMs,
			signal: input.signal
		});
	}
	async getCapabilities(input) {
		if (!input?.handle) return ACPX_CAPABILITIES;
		const { handle } = this.resolveManagerHandle(input.handle);
		const record = await this.options.sessionStore.load(handle.acpxRecordId ?? handle.sessionKey);
		if (!record?.acpx?.config_options) return ACPX_CAPABILITIES;
		const configOptionKeys = Array.from(new Set(record.acpx.config_options.map((option) => option.id).filter((id) => typeof id === "string" && id.trim().length > 0)));
		return {
			...ACPX_CAPABILITIES,
			...configOptionKeys.length > 0 ? { configOptionKeys } : {}
		};
	}
	async getStatus(input) {
		const { handle } = this.resolveManagerHandle(input.handle);
		return await (await this.getManager()).getStatus(handle);
	}
	async setMode(input) {
		const { handle, state } = this.resolveManagerHandle(input.handle);
		await (await this.getManager()).setMode(handle, input.mode, state.mode);
	}
	async setConfigOption(input) {
		const { handle, state } = this.resolveManagerHandle(input.handle);
		await (await this.getManager()).setConfigOption(handle, input.key, input.value, state.mode);
	}
	async cancel(input) {
		const { handle } = this.resolveManagerHandle(input.handle);
		await (await this.getManager()).cancel(handle);
	}
	async close(input) {
		const { handle } = this.resolveManagerHandle(input.handle);
		await (await this.getManager()).close(handle, { discardPersistentState: input.discardPersistentState });
	}
	async getManager() {
		if (this.manager) return this.manager;
		if (!this.managerPromise) this.managerPromise = Promise.resolve(this.testOptions?.managerFactory?.(this.options) ?? new AcpRuntimeManager(this.options, { eventStore: createEventStore(fileStorage()) })).then((manager) => {
			this.manager = manager;
			return manager;
		});
		return await this.managerPromise;
	}
	async runProbe() {
		return await (this.testOptions?.probeRunner?.(this.options) ?? probeRuntime(this.options));
	}
	resolveManagerHandle(handle) {
		const state = this.resolveHandleState(handle);
		return {
			handle: {
				...handle,
				acpxRecordId: state.acpxRecordId ?? handle.acpxRecordId ?? handle.sessionKey
			},
			state
		};
	}
	resolveHandleState(handle) {
		const decoded = decodeAcpxRuntimeHandleState(handle.runtimeSessionName);
		if (decoded) return {
			...decoded,
			acpxRecordId: decoded.acpxRecordId ?? handle.acpxRecordId,
			backendSessionId: decoded.backendSessionId ?? handle.backendSessionId,
			agentSessionId: decoded.agentSessionId ?? handle.agentSessionId
		};
		const runtimeSessionName = handle.runtimeSessionName.trim();
		if (!runtimeSessionName) throw new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "Invalid embedded ACP runtime handle: runtimeSessionName is missing.");
		return {
			name: runtimeSessionName,
			agent: deriveAgentFromSessionKey(handle.sessionKey, DEFAULT_AGENT_NAME),
			cwd: handle.cwd ?? this.options.cwd,
			mode: "persistent",
			acpxRecordId: handle.acpxRecordId,
			backendSessionId: handle.backendSessionId,
			agentSessionId: handle.agentSessionId
		};
	}
};
function createAcpRuntime(options) {
	return new AcpxRuntime(options);
}
function createRuntimeStore(options) {
	return createFileSessionStore(options);
}
//#endregion
export { ACPX_BACKEND_ID, ACPX_EVENT_SCHEMA, AcpRuntimeError, AcpxRuntime, DEFAULT_AGENT_NAME, REQUESTED_MODEL_UNSUPPORTED_ERROR_CODE, REQUESTED_MODEL_UNSUPPORTED_REASONS, RequestError, RequestedModelUnsupportedError, SessionClosedError, SessionExistsError, SessionNotFoundError, createAcpRuntime, createAgentRegistry, createEventStore, createFileSessionStore, createRuntimeStore, decodeAcpxRuntimeHandleState, encodeAcpxRuntimeHandleState, fileStorage, fromAcp, isAcpRuntimeError, isAcpxDomainKind, isRequestedModelUnsupportedError, memoryStorage, reduce };

//# sourceMappingURL=runtime.js.map