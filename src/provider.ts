import {
  createAssistantMessageEventStream,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions
} from "@earendil-works/pi-ai";
import { resolveActiveCredentials } from "./auth.js";
import {
  getActiveEndpoint,
  getClientHeaders,
  prewarmTlsConnection,
  resolveProjectId
} from "./client.js";
import { resolveRuntimeModelConfig } from "./models.js";
import { loadProjectRules } from "./rules-loader.js";
import { handleQuotaExhaustedFailover } from "./fallback-handler.js";
import type {
  GeminiContent,
  GeminiFunctionDeclaration,
  GeminiPart,
  StreamGenerateContentRequestBody
} from "./types.js";

/**
 * Traduce el historial y mensajes de Pi al formato de contenido de Gemini / Antigravity
 */
function buildGeminiContents(context: Context): GeminiContent[] {
  const contents: GeminiContent[] = [];

  for (const msg of context.messages) {
    if (msg.role === "user") {
      const parts: GeminiPart[] = [];
      if (typeof msg.content === "string") {
        if (msg.content.trim()) parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text" && typeof (block as any).text === "string" && (block as any).text.trim()) {
            parts.push({ text: (block as any).text });
          } else if (block.type === "image") {
            parts.push({
              inlineData: {
                mimeType: (block as any).mimeType || "image/png",
                data: (block as any).data || ""
              }
            });
          }
        }
      }
      if (parts.length > 0) {
        contents.push({ role: "user", parts });
      }
    } else if (msg.role === "assistant") {
      const parts: GeminiPart[] = [];
      const content = (msg as any).content;
      if (typeof content === "string") {
        if (content.trim()) parts.push({ text: content });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && typeof (block as any).text === "string" && (block as any).text.trim()) {
            parts.push({ text: (block as any).text });
          } else if (block.type === "toolCall") {
            parts.push({
              functionCall: {
                name: (block as any).name,
                args: ((block as any).arguments as Record<string, unknown>) || {}
              }
            });
          }
        }
      }
      if (parts.length > 0) {
        contents.push({ role: "model", parts });
      }
    } else if (msg.role === "toolResult") {
      const resText = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: msg.toolName || "tool",
              response: { result: resText }
            }
          }
        ]
      });
    }
  }

  return contents;
}

/**
 * Convierte las herramientas registradas en Pi al esquema de declaraciones de función de Google
 */
function buildGeminiToolDeclarations(tools?: any[]): GeminiFunctionDeclaration[] {
  if (!tools || tools.length === 0) return [];
  const declarations: GeminiFunctionDeclaration[] = [];

  for (const t of tools) {
    declarations.push({
      name: t.name,
      description: t.description || `Tool ${t.name}`,
      parameters: (t.parameters || t.inputSchema || { type: "object", properties: {} }) as Record<
        string,
        unknown
      >
    });
  }

  return declarations;
}

/**
 * Motor principal de streaming: crea y gestiona la conexión Server-Sent Events con Antigravity
 */
export function createAntigravityStream(
  model: Model<any>,
  context: Context,
  options?: SimpleStreamOptions
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    try {
      prewarmTlsConnection();

      // 1. Resolver y auto-refrescar credenciales
      let creds = await resolveActiveCredentials((options as any)?.apiKey);
      const projectId = await resolveProjectId(creds.token, creds.projectId, creds.email);

      // 2. Resolver modelo y presupuesto de pensamiento
      const effort = (options as any)?.reasoningEffort || (options as any)?.reasoning || "off";
      const { runtimeModelId, thinkingBudget } = resolveRuntimeModelConfig(model.id, effort);

      // 3. Compilar instrucciones de sistema (incluyendo reglas locales de proyecto)
      const projectRules = loadProjectRules();
      const rulesPrompt = projectRules.length > 0
        ? `\n\n[Project Rules & Constraints]:\n${projectRules.map(r => `--- ${r.name} ---\n${r.content}`).join("\n\n")}`
        : "";

      const fullSystemPrompt = `${context.systemPrompt || "You are Antigravity, an expert software engineering assistant."}${rulesPrompt}`;

      // 4. Construir cuerpo del request para Google Cloud Code Assist
      const contents = buildGeminiContents(context);
      const toolDeclarations = buildGeminiToolDeclarations((options as any)?.tools);

      const requestBody: StreamGenerateContentRequestBody = {
        contents,
        systemInstruction: {
          parts: [{ text: fullSystemPrompt }]
        },
        generationConfig: {
          maxOutputTokens: model.maxTokens || 65536,
          temperature: (options as any)?.temperature ?? 0.2
        }
      };

      if (thinkingBudget !== undefined && thinkingBudget !== 0) {
        requestBody.generationConfig!.thinkingConfig = {
          thinkingBudget: thinkingBudget === -1 ? -1 : thinkingBudget
        };
      }

      if (toolDeclarations.length > 0) {
        requestBody.tools = [{ functionDeclarations: toolDeclarations }];
      }

      const endpoint = getActiveEndpoint();
      const sseUrl = `${endpoint}/v1internal:streamGenerateContent?alt=sse`;

      let response = await fetch(sseUrl, {
        method: "POST",
        headers: getClientHeaders(creds.token),
        body: JSON.stringify(requestBody),
        signal: options?.signal
      });

      // 5. Manejo inteligente de cuota agotada (HTTP 429) con conmutación en caliente
      if (response.status === 429) {
        const errText = await response.text();
        const failoverAccount = await handleQuotaExhaustedFailover(creds.email);
        if (failoverAccount) {
          creds = { token: failoverAccount.token, email: failoverAccount.email };
          response = await fetch(sseUrl, {
            method: "POST",
            headers: getClientHeaders(creds.token),
            body: JSON.stringify(requestBody),
            signal: options?.signal
          });
        } else {
          throw new Error(`Cuota de Antigravity agotada (HTTP 429): ${errText.slice(0, 200)}`);
        }
      }

      if (!response.ok) {
        const errorBody = await response.text();
        if (response.status === 403 && errorBody.includes("VALIDATION_REQUIRED")) {
          throw new Error("Se requiere verificación en tu cuenta Google. Abre accounts.google.com para verificar.");
        }
        throw new Error(`Antigravity error HTTP ${response.status}: ${errorBody.slice(0, 300)}`);
      }

      if (!response.body) {
        throw new Error("El endpoint de Antigravity no retornó un body de streaming.");
      }

      // 6. Consumo y despacho de Server-Sent Events (SSE)
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) continue;

          const jsonStr = trimmed.slice(5).trim();
          if (jsonStr === "[DONE]") continue;

          try {
            const chunk = JSON.parse(jsonStr) as any;
            const candidate = chunk.candidates?.[0];

            if (candidate?.content?.parts) {
              for (const part of candidate.content.parts) {
                if (part.thought || (part as any).thinking) {
                  const thoughtText = part.thought || (part as any).thinking;
                  (stream as any).thinkingDelta?.(thoughtText);
                }
                if (part.text) {
                  (stream as any).textDelta?.(part.text);
                }
                if (part.functionCall) {
                  (stream as any).toolCall?.({
                    name: part.functionCall.name,
                    arguments: part.functionCall.args || {}
                  });
                }
              }
            }

            if (chunk.usageMetadata) {
              const meta = chunk.usageMetadata;
              (stream as any).usage?.({
                promptTokens: meta.promptTokenCount || 0,
                outputTokens: meta.candidatesTokenCount || 0,
                totalTokens: meta.totalTokenCount || 0
              });
            }
          } catch {
            // Ignorar líneas malformadas transitorias en SSE
          }
        }
      }

      (stream as any).done?.();
    } catch (err) {
      if (options?.signal?.aborted) {
        (stream as any).done?.();
        return;
      }
      (stream as any).error?.(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return stream;
}
