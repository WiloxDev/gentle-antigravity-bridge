export const PROVIDER_ID = "gentle-antigravity";
export const PROVIDER_LABEL = "Google Antigravity";
export const PROVIDER_PREFIX = "antigravity";
export const COMMAND_ROOT = "agy";
export const COMMAND_ALIAS = "antigravity";

/**
 * OAuth Token and Session Credential Definitions
 */
export interface AntigravityOAuthCredentials {
  token: string;
  projectId?: string;
  email?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface AntigravityAccountRecord {
  email: string;
  token: string;
  refreshToken?: string;
  expiresAt?: number;
  projectId?: string;
  isDefault?: boolean;
  tier?: string;
  lastUsedAt: number;
}

export interface AntigravityAccountsStore {
  activeEmail?: string;
  accounts: Record<string, AntigravityAccountRecord>;
}

/**
 * Cloud Code Assist / Antigravity Wire Envelopes
 */
export interface CloudCodeTierInfo {
  id?: string;
  name?: string;
  description?: string;
}

export interface CloudCodeAssistMetadata {
  ideType?: string;
  platform?: string;
  pluginType?: string;
  version?: string;
}

export interface LoadCodeAssistResponse {
  currentTier?: CloudCodeTierInfo;
  paidTier?: CloudCodeTierInfo;
  cloudaicompanionProject?: string | { id?: string };
  antigravityProjectId?: string;
  projectId?: string;
}

export interface DynamicModelCandidate {
  id: string;
  displayName?: string;
  model?: string;
  modelProvider?: string;
  apiProvider?: string;
  maxOutputTokens?: number;
  contextWindow?: number;
  thinkingSupported?: boolean;
  isDefault?: boolean;
}

export interface AvailableModelsResponse {
  models?: Record<string, {
    displayName?: string;
    model?: string;
    modelProvider?: string;
    apiProvider?: string;
    maxOutputTokens?: number;
    contextWindow?: number;
  }>;
  defaultAgentModelId?: string;
}

/**
 * Quota Telemetry Models
 */
export interface QuotaWindow {
  durationSeconds: number;
  usedTokens: number;
  maxTokens: number;
  remainingFraction: number; // 0.0 to 1.0
  resetAtEpochMs?: number;
}

export interface QuotaGroup {
  groupId: string;
  displayName: string;
  fiveHourWindow?: QuotaWindow;
  weeklyWindow?: QuotaWindow;
}

export interface AccountQuotaSummary {
  planLabel: string;
  groups: QuotaGroup[];
  fetchedAt: number;
}

export interface GentleShellUsageSegment {
  label: string;
  percentUsed: number;
  timeRemaining?: string;
  status: "normal" | "warning" | "critical";
}

export interface GentleShellUsageModel {
  providerId: string;
  badge: string;
  displayLine: string;
  segments: GentleShellUsageSegment[];
  resetAtText?: string;
}

/**
 * Gemini Part & Content Schema for Wire Streaming
 */
export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export interface GeminiContent {
  role: "user" | "model" | "system";
  parts: GeminiPart[];
}

export interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface GeminiGenerationConfig {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  thinkingConfig?: {
    thinkingBudget?: number;
  };
}

export interface StreamGenerateContentRequestBody {
  contents: GeminiContent[];
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  tools?: Array<{
    functionDeclarations: GeminiFunctionDeclaration[];
  }>;
  generationConfig?: GeminiGenerationConfig;
}

/**
 * Doctor Diagnostic Results
 */
export interface DoctorCheckItem {
  name: string;
  passed: boolean;
  message: string;
  latencyMs?: number;
  details?: string;
}

export interface DoctorReport {
  timestamp: number;
  allPassed: boolean;
  checks: DoctorCheckItem[];
}
