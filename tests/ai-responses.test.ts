import { afterEach, describe, expect, it, vi } from "vitest";
import { isTransientApiError } from "../src/lib/ai/fill";
import { initialGenerateProvider, isGenerateConfigured } from "../src/lib/ai/generate-state";
import { getResponsesConfig, responsesJson } from "../src/lib/ai/responses";

const config = { baseUrl: "https://responses.example.test/v1", apiKey: "test-responses-key", model: "test-model" };
const assistantOutput = { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: '{"core":"中心"}' }] };
const completed = { status: "completed", output: [assistantOutput] };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Responses 词条生成", () => {
  it("原样发送自定义推理等级，按顺序读取正文并拆分用量", async () => {
    const effort = "  custom-等级/2  ";
    vi.stubEnv("OPENAI_RESPONSES_BASE_URL", config.baseUrl);
    vi.stubEnv("OPENAI_RESPONSES_MODEL", config.model);
    vi.stubEnv("OPENAI_API_KEY", config.apiKey);
    vi.stubEnv("OPENAI_RESPONSES_REASONING_EFFORT", effort);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      status: "completed",
      output: [
        { type: "reasoning", summary: [{ type: "summary_text", text: '{"core":"推理摘要"}' }] },
        { type: "function_call", arguments: '{"core":"工具参数"}' },
        { ...assistantOutput, content: [{ type: "output_text", text: '{"core":' }, { type: "output_text", text: '"中心"}' }] },
      ],
      usage: {
        input_tokens: 1800, input_tokens_details: { cached_tokens: 1200 },
        output_tokens: 500, output_tokens_details: { reasoning_tokens: 120 }, cost: 0.01,
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const responses = getResponsesConfig("openai")!;
    await expect(responsesJson(responses, "system", "user", 6000)).resolves.toEqual({
      text: '{"core":"中心"}',
      usage: { input: 600, cachedInput: 1200, output: 500, reasoning: 120, cost: 0.01 },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${config.baseUrl}/responses`);
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${config.apiKey}` });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: config.model,
      input: [{ role: "system", content: "system" }, { role: "user", content: "user" }],
      text: { format: { type: "json_object" } },
      max_output_tokens: 6000,
      reasoning: { effort },
      store: false,
      stream: false,
    });
  });

  it.each([undefined, "", " \t "])("环境变量为 %j 时由上游决定推理行为", async (effort) => {
    vi.stubEnv("OPENAI_RESPONSES_BASE_URL", config.baseUrl);
    vi.stubEnv("OPENAI_RESPONSES_MODEL", config.model);
    vi.stubEnv("OPENAI_API_KEY", config.apiKey);
    vi.stubEnv("OPENAI_RESPONSES_REASONING_EFFORT", effort);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(completed));
    vi.stubGlobal("fetch", fetchMock);
    await responsesJson(getResponsesConfig("openai")!, "system", "user", 6000);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).not.toHaveProperty("reasoning");
  });

  it.each(["max_output_tokens", "length"])("输出预算用完（%s）时保留重试标记和用量", async (reason) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      status: "incomplete",
      incomplete_details: { reason },
      output: [{ type: "reasoning" }],
      usage: {
        input_tokens: 1800, input_tokens_details: { cached_tokens: 1200 },
        output_tokens: 6000, output_tokens_details: { reasoning_tokens: 6000 },
      },
    })));

    await expect(responsesJson(config, "system", "user", 6000)).rejects.toMatchObject({
      truncated: true,
      usage: { input: 600, cachedInput: 1200, output: 6000, reasoning: 6000 },
    });
  });

  it("上游明确不支持推理参数时省略该字段重试", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: { code: "unsupported_parameter", param: "reasoning.effort" } }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ output: [assistantOutput] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(responsesJson({ ...config, reasoningEffort: "custom" }, "system", "user", 6000)).resolves.toMatchObject({
      text: '{"core":"中心"}',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [first, second] = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(first.reasoning).toEqual({ effort: "custom" });
    expect(second).not.toHaveProperty("reasoning");
  });

  it("上游拒绝推理等级值时保留错误并清理密钥", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      error: { code: "unsupported_value", param: "reasoning.effort", message: `Unsupported effort (${config.apiKey})` },
    }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(responsesJson({ ...config, reasoningEffort: "custom" }, "system", "user", 6000))
      .rejects.toThrow("openai 接口 400: Unsupported effort ([redacted])");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { output: [{ ...assistantOutput, content: [...assistantOutput.content, { type: "refusal", refusal: "拒答原因" }] }], message: "模型拒绝生成词条：拒答原因" },
    { output: [{ ...assistantOutput, status: "incomplete" }], message: "词条正文未完成" },
    { output: [{ type: "reasoning", content: [{ type: "reasoning_text", text: "{}" }] }], message: "缺少词条正文" },
    { output: [], status: "incomplete", incomplete_details: { reason: "content_filter" }, message: "内容过滤中断" },
    { output: [], status: "cancelled", message: "cancelled" },
  ])("返回 $message 时标记为未生成并保留用量", async ({ message, ...payload }) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ...completed,
      ...payload,
      usage: { input_tokens: 12, output_tokens: 23, output_tokens_details: { reasoning_tokens: 10 } },
    })));
    await expect(responsesJson(config, "system", "user", 6000)).rejects.toMatchObject({
      message: expect.stringContaining(message),
      usage: { input: 12, cachedInput: 0, output: 23, reasoning: 10 },
      truncated: false,
      retryable: false,
    });
  });

  it("HTTP 200 中的模型端暂时故障可重试", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      status: "failed",
      error: { code: "server_error", message: "Provider failed to generate model output" },
    })));
    await responsesJson(config, "system", "user", 6000).then(
      () => { throw new Error("应当报告上游暂时故障"); },
      (error: unknown) => {
        expect(error).toMatchObject({ message: expect.stringContaining("Provider failed"), truncated: false });
        expect(isTransientApiError(error)).toBe(true);
      },
    );
  });

  it("响应体不是合法 JSON 时报告协议错误", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("Bad gateway HTML")));
    await expect(responsesJson(config, "system", "user", 6000)).rejects.toThrow("无效的 JSON 响应");
  });

  it("支持用量报告显式的 0 推理 Token", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      ...completed,
      usage: { input_tokens: 12, output_tokens: 23, output_tokens_details: { reasoning_tokens: 0 } },
    })));
    await expect(responsesJson(config, "system", "user", 6000)).resolves.toMatchObject({
      usage: { input: 12, cachedInput: 0, output: 23, reasoning: 0 },
    });
  });

  it("只有 OpenAI 连接时可首次生成，DeepSeek 已配置时仍优先", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("OPENAI_RESPONSES_BASE_URL", `${config.baseUrl}/`);
    vi.stubEnv("OPENAI_RESPONSES_MODEL", config.model);
    vi.stubEnv("OPENAI_RESPONSES_REASONING_EFFORT", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(isGenerateConfigured("openai")).toBe(false);
    vi.stubEnv("OPENAI_API_KEY", config.apiKey);
    expect(getResponsesConfig("openai")).toEqual(config);
    expect(initialGenerateProvider()).toBe("openai");
    vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek-key");
    expect(initialGenerateProvider()).toBe("deepseek");
  });
});
