export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  statusCode: number,
  message: string,
): asserts condition {
  if (!condition) throw new HttpError(statusCode, message);
}

export function created<T>(reply: import("fastify").FastifyReply, value: T): T {
  reply.code(201);
  return value;
}
