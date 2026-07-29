import { GoogleGenAI } from "@google/genai";
import { config } from "./config.js";

const client = new GoogleGenAI({ apiKey: config.geminiApiKey });

const MAX_TOOL_CALL_ROUNDS = 5;

async function executeFunctionCalls(functionCalls, toolHandlers, context) {
  const functionResponseParts = [];

  for (const call of functionCalls) {
    const handler = toolHandlers[call.name];
    let result;

    if (!handler) {
      result = { error: `Noma'lum funksiya: ${call.name}` };
    } else {
      try {
        result = await handler(call.args ?? {}, context);
      } catch (error) {
        result = { error: error.message };
      }
    }

    functionResponseParts.push({
      functionResponse: { name: call.name, response: { result } },
    });
  }

  return functionResponseParts;
}

export async function runConversation({
  contents,
  toolDeclarations,
  toolHandlers,
  context,
  systemInstruction,
}) {
  const currentContents = [...contents];
  const requestConfig = {
    tools: [{ functionDeclarations: toolDeclarations }],
    systemInstruction,
  };

  let response = await client.models.generateContent({
    model: config.geminiModel,
    contents: currentContents,
    config: requestConfig,
  });

  let round = 0;

  while ((response.functionCalls?.length ?? 0) > 0 && round < MAX_TOOL_CALL_ROUNDS) {
    round += 1;

    const modelParts = response.candidates?.[0]?.content?.parts ?? [];
    currentContents.push({ role: "model", parts: modelParts });

    const functionResponseParts = await executeFunctionCalls(
      response.functionCalls,
      toolHandlers,
      context
    );
    currentContents.push({ role: "user", parts: functionResponseParts });

    response = await client.models.generateContent({
      model: config.geminiModel,
      contents: currentContents,
      config: requestConfig,
    });
  }

  const finalParts = response.candidates?.[0]?.content?.parts ?? [{ text: response.text ?? "" }];
  currentContents.push({ role: "model", parts: finalParts });

  return {
    text: response.text ?? "",
    contents: currentContents,
  };
}
