/** Server-Sent Events のレスポンスを簡単に作るヘルパー */
export function sseResponse(
  handler: (send: (event: string, data: unknown) => void, signal: AbortSignal) => Promise<void>,
  signal: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          /* ignore */
        }
      };
      try {
        await handler(send, signal);
      } catch (e) {
        send("error", { message: (e as Error).message });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
